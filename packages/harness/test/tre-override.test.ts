/**
 * tre-override.test.ts — TreMount override resolver + resolveChain harness tests (CORE-01).
 *
 * Tests the TreMount priority-based override resolution, tombstone handling,
 * same-priority tie-break, and resolveChain invariant.
 *
 * Test suites:
 *   "tre mount override"       — higher-priority wins, tombstone shadows lower
 *   "tre priority tie-break"   — pins the ACTUAL code-derived same-priority order
 *   "resolveChain invariant"   — winner === resolve() + tombstone representation
 *
 * Ground truth:
 *   swg-client-v2 TreeFile.cpp:285-308 (priority sort + std::lower_bound insert)
 *   swg-client-v2 TreeFile.cpp:437-461 (first-match-wins traverse)
 *   swg-client-v2 TreeFile_SearchNode.cpp:360-408 (binary search + tombstone)
 *   swg-client-v2 TreeFile.cpp:511-601 (fixUpFileName)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname_es = dirname(fileURLToPath(import.meta.url));

// Load the native addon via CJS require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  mountTreMount: (paths: string[], priorities: number[]) => string;
  resolveEntry: (mountHandle: string, name: string) => {
    winner: string | null;
    tombstone: boolean;
    archiveIndex: number;
    entryIndex: number;
  };
  resolveChain: (mountHandle: string, name: string) => {
    winner: string;
    shadows: string[];
    tombstone: boolean;
    winnerArchiveIndex: number;
  };
  searchMount: (mountHandle: string, query: { text: string; mode: 'substring' | 'glob' }) => Array<{
    entryIndex: number;
    archiveIndex: number;
  }>;
  readMountEntry: (mountHandle: string, archiveIndex: number, entryIndex: number) => ArrayBuffer;
  disposeTreMount: (mountHandle: string) => void;
};

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const TMPDIR = join(tmpdir(), 'swg-override-test');
mkdirSync(TMPDIR, { recursive: true });

/**
 * Build a minimal v0005 TRE archive in memory for override tests.
 *
 * v0005 layout (CRC-FIRST, 24-byte stride):
 *   Header 36 bytes (LE uint32): magic "EERT", version "0005", numberOfFiles,
 *     tocOffset, tocCompressor, sizeOfTOC, blockCompressor, sizeOfNameBlock, uncompSizeOfNameBlock
 *   TOC records (24 bytes each, crc-first):
 *     [0]  crc (uint32 LE)           — FORWARD CRC-32 of normalized name
 *     [4]  length (int32 LE)         — uncompressed size; 0 = tombstone
 *     [8]  offset (int32 LE)         — byte offset of payload
 *     [12] compressor (int32 LE)     — 0=none
 *     [16] compressedLength (int32 LE)
 *     [20] fileNameOffset (int32 LE)
 *
 * GROUND TRUTH: swg-client-v2 TreeFile_SearchNode.h:189 (crc-first struct);
 *               Crc.cpp Crc::calculate (forward CRC-32). Verified byte-exact vs real archives.
 */

function crc32(name: string): number {
  // FORWARD CRC-32 matching swg-client-v2 Crc.cpp (polynomial 0x04C11DB7, MSB-first).
  // Must match TreArchive.cpp's crcCalculate(): init=0xFFFFFFFF, finalXOR=0xFFFFFFFF.
  // Source: swg-client-v2 Crc.cpp (Crc::calculate).
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = (i << 24) >>> 0;
    for (let j = 0; j < 8; j++) c = (c & 0x80000000) ? (((c << 1) ^ 0x04C11DB7) >>> 0) : ((c << 1) >>> 0);
    table[i] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < name.length; i++) {
    const byte = name.charCodeAt(i) & 0xff;
    crc = (table[((crc >>> 24) ^ byte) & 0xFF] ^ (crc << 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0; // ensure unsigned
}

interface TreFileEntry {
  name: string;        // normalized (lowercase, forward-slash)
  payload: Buffer;     // can be empty for tombstone
  tombstone?: boolean; // if true, length==0 in TOC
}

function buildV0005Archive(entries: TreFileEntry[]): Buffer {
  // Sort entries by CRC (ascending) for binary-search to work.
  // Source: swg-client-v2 TreeFile_SearchNode.cpp:360-408 (binary search keyed on CRC).
  const sorted = [...entries].sort((a, b) => {
    const ca = crc32(a.name);
    const cb = crc32(b.name);
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    // CRC tie-break by name (case-insensitive, matching _stricmp behavior)
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  entries = sorted;

  // Build name block (null-terminated strings concatenated)
  const nameOffsets: number[] = [];
  let nameBlockStr = '';
  for (const entry of entries) {
    nameOffsets.push(nameBlockStr.length);
    nameBlockStr += entry.name + '\0';
  }
  const nameBlock = Buffer.from(nameBlockStr, 'ascii');
  const nameBlockLen = nameBlock.length;

  // Compute payload offsets
  // Payloads are stored AFTER the header (36 bytes), before the TOC.
  // Actually in real archives: header + payloads + TOC + nameBlock.
  // But for test purposes we can put: header + TOC (uncompressed) + names + payloads.
  // The TreArchive reads: header, then reads TOC from tocOffset with sizeOfTOC bytes,
  // then reads name block from (tocOffset + sizeOfTOC) with sizeOfNameBlock bytes.
  // Payloads are at their own offsets within the archive.
  //
  // Simplest layout: header | payloads | TOC | nameBlock
  // tocOffset = 36 + sum(payload sizes)
  const stride = 24;
  const numFiles = entries.length;
  const tocSize = numFiles * stride;

  // Payload layout: each payload placed sequentially after header
  const payloadOffsets: number[] = [];
  let payloadCursor = 36; // right after header
  for (const entry of entries) {
    payloadOffsets.push(payloadCursor);
    if (!entry.tombstone && entry.payload.length > 0) {
      payloadCursor += entry.payload.length;
    }
  }

  const tocOffset = payloadCursor; // TOC follows payloads
  const nameBlockOffset = tocOffset + tocSize;
  const totalSize = nameBlockOffset + nameBlockLen;

  const buf = Buffer.alloc(totalSize, 0);

  // Write header (36 bytes)
  buf.write('EERT', 0, 'ascii');
  buf.write('0005', 4, 'ascii');
  buf.writeUInt32LE(numFiles, 8);
  buf.writeUInt32LE(tocOffset, 12);
  buf.writeUInt32LE(0, 16);          // tocCompressor = 0 (none)
  buf.writeUInt32LE(tocSize, 20);    // sizeOfTOC (=uncompressed since compressor=0)
  buf.writeUInt32LE(0, 24);          // blockCompressor = 0
  buf.writeUInt32LE(nameBlockLen, 28); // sizeOfNameBlock
  buf.writeUInt32LE(nameBlockLen, 32); // uncompSizeOfNameBlock

  // Write payloads
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.tombstone && entry.payload.length > 0) {
      entry.payload.copy(buf, payloadOffsets[i]);
    }
  }

  // Write TOC records (crc-first, 24 bytes each)
  // Source: swg-client-v2 TreeFile_SearchNode.h:189.
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const baseOff = tocOffset + i * stride;
    const length  = entry.tombstone ? 0 : entry.payload.length;
    const compLen = length; // compressor=0, compressed==uncompressed
    const crcVal  = crc32(entry.name);
    const fnOff   = nameOffsets[i];

    buf.writeUInt32LE(crcVal,   baseOff + 0);   // [0]  crc
    buf.writeInt32LE(length,    baseOff + 4);   // [4]  length
    buf.writeInt32LE(payloadOffsets[i], baseOff + 8);  // [8]  offset
    buf.writeInt32LE(0,         baseOff + 12);  // [12] compressor=none
    buf.writeInt32LE(compLen,   baseOff + 16);  // [16] compressedLength
    buf.writeInt32LE(fnOff,     baseOff + 20);  // [20] fileNameOffset
  }

  // Write name block
  nameBlock.copy(buf, nameBlockOffset);

  return buf;
}

function writeTempArchive(name: string, content: Buffer): string {
  const filePath = join(TMPDIR, name);
  writeFileSync(filePath, content);
  return filePath;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('tre mount override', () => {
  it('higher-priority archive wins for a file present in both', () => {
    // Build two archives with the same file "object/creature/foo.iff"
    // lowPriority (priority=1): payload "LOW"
    // highPriority (priority=2): payload "HIGH"
    const sharedFile = 'object/creature/foo.iff';
    const lowArc = buildV0005Archive([
      { name: sharedFile, payload: Buffer.from('LOW') },
    ]);
    const highArc = buildV0005Archive([
      { name: sharedFile, payload: Buffer.from('HIGH') },
    ]);

    const lowPath  = writeTempArchive('low-prio.tre', lowArc);
    const highPath = writeTempArchive('high-prio.tre', highArc);

    // Mount: highPath has priority 2 (higher), lowPath has priority 1
    const handle = nativeCore.mountTreMount([lowPath, highPath], [1, 2]);
    try {
      const result = nativeCore.resolveEntry(handle, sharedFile);
      expect(result.winner).toBe(highPath);
      expect(result.tombstone).toBe(false);

      // The resolved payload should come from highArc
      const buf = nativeCore.readMountEntry(handle, result.archiveIndex, result.entryIndex);
      const text = Buffer.from(buf).toString('ascii').replace(/\0+$/, '');
      expect(text).toBe('HIGH');
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });

  it('length==0 tombstone in higher-priority archive shadows lower-priority archive', () => {
    const sharedFile = 'shared_landspeeder.msh';
    // lowArc has the real file
    const lowArc = buildV0005Archive([
      { name: sharedFile, payload: Buffer.from('REAL') },
    ]);
    // highArc has a tombstone (deletes the file)
    const highArc = buildV0005Archive([
      { name: sharedFile, payload: Buffer.from(''), tombstone: true },
    ]);

    const lowPath  = writeTempArchive('tombstone-low.tre', lowArc);
    const highPath = writeTempArchive('tombstone-high.tre', highArc);

    const handle = nativeCore.mountTreMount([lowPath, highPath], [1, 2]);
    try {
      const result = nativeCore.resolveEntry(handle, sharedFile);
      // Tombstone means the file is deleted; winner is null or tombstone=true
      expect(result.tombstone).toBe(true);
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });

  it('ShadowChain lists winner + shadowed archives highest-first', () => {
    const sharedFile = 'appearance/player.apt';
    const arc1 = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('ARC1') }]);
    const arc2 = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('ARC2') }]);
    const arc3 = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('ARC3') }]);

    const path1 = writeTempArchive('chain1.tre', arc1);
    const path2 = writeTempArchive('chain2.tre', arc2);
    const path3 = writeTempArchive('chain3.tre', arc3);

    // Priority: path3=3 (highest), path2=2, path1=1 (lowest)
    const handle = nativeCore.mountTreMount([path1, path2, path3], [1, 2, 3]);
    try {
      const chain = nativeCore.resolveChain(handle, sharedFile);
      expect(chain.winner).toBe(path3);
      expect(chain.shadows).toContain(path2);
      expect(chain.shadows).toContain(path1);
      // Shadows list is ordered highest-priority first among shadowed
      expect(chain.shadows.indexOf(path2)).toBeLessThan(chain.shadows.indexOf(path1));
      expect(chain.tombstone).toBe(false);
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });
});

describe('tre priority tie-break', () => {
  it('same-priority archives: pins the ACTUAL code-derived insertion order (settles code-vs-comment ambiguity)', () => {
    /**
     * Ground truth: swg-client-v2 TreeFile.cpp:304
     *   insertionPoint = std::lower_bound(begin, end, newNode, searchNodePriorityOrder)
     *   where searchNodePriorityOrder(a, b) = a->getPriority() > b->getPriority()
     *
     * std::lower_bound with strict predicate returns the first position where
     * the predicate is FALSE, i.e. first position where !(existing->priority > new->priority)
     * = first position where existing->priority <= new->priority.
     *
     * For EQUAL priorities: the first position where existing.priority <= new.priority
     * = the FIRST element in the existing equal-priority run (because for equal priorities,
     *   existing->priority <= new->priority is true from the start of the run).
     * So the new node is inserted BEFORE the existing equal-priority nodes.
     *
     * This test does NOT assert which is correct — it MEASURES the actual result
     * and asserts that result is stable (the test pins the code behavior).
     */
    const sharedFile = 'shared_object.iff';
    // Both archives have same file with different content
    const arcA = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('FIRST_MOUNTED') }]);
    const arcB = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('SECOND_MOUNTED') }]);

    const pathA = writeTempArchive('tiea.tre', arcA);
    const pathB = writeTempArchive('tieb.tre', arcB);

    // Mount with equal priorities
    // pathA is provided first in the array, pathB second
    const handle = nativeCore.mountTreMount([pathA, pathB], [5, 5]);
    try {
      const result = nativeCore.resolveEntry(handle, sharedFile);
      // The winner should be deterministic — record which one wins
      // std::lower_bound with strict > inserts the new node BEFORE equal-priority nodes
      // So pathA (first mounted, inserted first) sits after pathB was inserted before it.
      // Concretely: mount pathA at priority 5 → [pathA].
      // Then mount pathB at priority 5 → lower_bound(begin, end, pathB, priority>)
      //   finds first position where !(existing.priority > 5) = first where existing.priority <= 5
      //   = position 0 (pathA has priority 5, 5 <= 5 is true)
      // So pathB is inserted at index 0, before pathA → order is [pathB, pathA].
      // First-match-wins → pathB wins (second mounted beats first mounted at same priority).
      expect(result.winner).toBe(pathB); // SECOND mounted archive at same priority wins (inserted before)
      expect(result.tombstone).toBe(false);
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });
});

describe('resolveChain invariant', () => {
  it('non-tombstone: resolveChain(name).winner === resolve(name)', () => {
    const sharedFile = 'shared_vehicle.iff';
    const arc1 = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('V1') }]);
    const arc2 = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('V2') }]);

    const path1 = writeTempArchive('inv1.tre', arc1);
    const path2 = writeTempArchive('inv2.tre', arc2);

    const handle = nativeCore.mountTreMount([path1, path2], [1, 2]);
    try {
      const resolved = nativeCore.resolveEntry(handle, sharedFile);
      const chain    = nativeCore.resolveChain(handle, sharedFile);
      // Invariant: chain.winner must match the winning archive path
      expect(chain.winner).toBe(resolved.winner);
      expect(chain.tombstone).toBe(false);
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });

  it('tombstone winner: resolveChain reports tombstone=true with deleted-winner representation', () => {
    const sharedFile = 'deleted_file.iff';
    const arcLow  = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('REAL') }]);
    const arcHigh = buildV0005Archive([{ name: sharedFile, payload: Buffer.alloc(0), tombstone: true }]);

    const pathLow  = writeTempArchive('tomb-low-inv.tre', arcLow);
    const pathHigh = writeTempArchive('tomb-high-inv.tre', arcHigh);

    const handle = nativeCore.mountTreMount([pathLow, pathHigh], [1, 2]);
    try {
      const resolved = nativeCore.resolveEntry(handle, sharedFile);
      const chain    = nativeCore.resolveChain(handle, sharedFile);
      expect(resolved.tombstone).toBe(true);
      expect(chain.tombstone).toBe(true);
      // The chain winner points to the tombstone archive (the "deleting" archive)
      expect(chain.winner).toBe(pathHigh);
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });

  it('3-archive fixture with tombstone-in-the-middle: lower archives still shadowed', () => {
    const sharedFile = 'middle_tombstone.iff';
    const arc1 = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('LOWEST') }]);
    const arc2 = buildV0005Archive([{ name: sharedFile, payload: Buffer.alloc(0), tombstone: true }]); // tombstone in middle
    const arc3 = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('HIGHEST') }]);

    const path1 = writeTempArchive('mid-tomb1.tre', arc1);
    const path2 = writeTempArchive('mid-tomb2.tre', arc2);
    const path3 = writeTempArchive('mid-tomb3.tre', arc3);

    // path3=3 (highest), path2=2 (tombstone in middle), path1=1 (lowest)
    const handle = nativeCore.mountTreMount([path1, path2, path3], [1, 2, 3]);
    try {
      const chain = nativeCore.resolveChain(handle, sharedFile);
      // path3 wins (it's highest priority and has real content)
      expect(chain.winner).toBe(path3);
      expect(chain.tombstone).toBe(false);
      // Both lower archives are in shadows
      expect(chain.shadows).toContain(path2);
      expect(chain.shadows).toContain(path1);
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });

  it('tombstone-only fixture: resolveChain reports tombstone=true; lower archive shadowed', () => {
    const sharedFile = 'tombstone_only.iff';
    const arcReal = buildV0005Archive([{ name: sharedFile, payload: Buffer.from('REAL') }]);
    const arcTomb = buildV0005Archive([{ name: sharedFile, payload: Buffer.alloc(0), tombstone: true }]);

    const pathReal = writeTempArchive('tomb-only-real.tre', arcReal);
    const pathTomb = writeTempArchive('tomb-only-tomb.tre', arcTomb);

    const handle = nativeCore.mountTreMount([pathReal, pathTomb], [1, 2]);
    try {
      const chain = nativeCore.resolveChain(handle, sharedFile);
      expect(chain.tombstone).toBe(true);
      expect(chain.winner).toBe(pathTomb); // tombstone archive "wins" (it's deleting the file)
      expect(chain.shadows).toContain(pathReal);
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });
});
