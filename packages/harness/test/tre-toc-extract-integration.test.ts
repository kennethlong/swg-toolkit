/**
 * tre-toc-extract-integration.test.ts — End-to-end searchTOC extraction chain (F-2, gate D-16).
 *
 * Proves the full descriptor-based extraction chain that gate D-16 found broken:
 *   readTocIndex(tocPath).resolveFull(path) → nativeCore.extractMountAt(handle, ai, descriptor)
 *
 * Prior to gate D-16 fix (plan 04.3-12), the UI callers never supplied the descriptor, so
 * TOC-sourced entries silently returned null bytes. This test uses real native bindings
 * (no mocks) to prove the wired chain produces the correct payload bytes.
 *
 * Setup: synthetic v6000 TRE with numberOfFiles=0 (empty internal TOC) + synthetic .toc
 * with 1 entry pointing to a stored payload. Mounts via mountTreMountWithToc so the native
 * parseTocIntoMount wires the .toc entries as external entries on the mount.
 *
 * Source: 04.3-12-GATE-FINDINGS.md F-2 (BLOCKING — searchTOC extraction unwired in the UI);
 *         TreMount.cpp parseTocIntoMount (external entries injection);
 *         tocReader.ts readTocIndex / resolveFull (TS-side TOC parser);
 *         tre_binding.cpp ExtractMountAt (F-4/F-5 descriptor: Uint32Value, crc field).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { readTocIndex } from '../../renderer/src/services/tocReader.js';

const __dirname_es = dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  mountTreMountWithToc: (
    paths: string[],
    priorities: number[],
    tocPath: string,
    tocTreePath: string,
  ) => string;
  extractMountAt: (
    handle: string,
    archiveIndex: number,
    descriptor: {
      offset: number;
      length: number;
      compressedLength: number;
      compressor: number;
      crc?: number;
    },
  ) => { bytes?: ArrayBuffer; encrypted?: boolean };
  disposeTreMount: (handle: string) => void;
  readMountEntry: (handle: string, archiveIndex: number, entryIndex: number) => ArrayBuffer;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function le32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * Build a v6000 TRE with numberOfFiles=0 (empty internal TOC).
 *
 * The archive has a single stored payload at byte offset 36 (immediately after the
 * 36-byte header). The internal TOC has zero entries; all entries come from the
 * external .toc via parseTocIntoMount.
 *
 * @param payload  Payload bytes (compressor=0, stored — no inflation needed)
 * @returns        Full TRE file bytes
 */
function buildV6000EmptyTocTre(payload: Buffer): Buffer {
  // v6000 header (36 bytes):
  //   magic[0..3] = "EERT"; version[4..7] = "6000"
  //   numberOfFiles[8..11] = 0
  //   tocOffset[12..15] = 36  (TOC starts right after header, but sizeOfTOC=0)
  //   tocCompressor[16..19] = 0
  //   sizeOfTOC[20..23] = 0   (empty internal TOC)
  //   blockCompressor[24..27] = 0
  //   sizeOfNameBlock[28..31] = 0
  //   uncompSizeOfNameBlock[32..35] = 0
  const header = Buffer.concat([
    Buffer.from('EERT'),   // magic
    Buffer.from('6000'),   // version
    le32(0),               // numberOfFiles = 0
    le32(36),              // tocOffset = 36 (right after header)
    le32(0),               // tocCompressor = 0 (stored)
    le32(0),               // sizeOfTOC = 0 (no internal TOC entries)
    le32(0),               // blockCompressor = 0
    le32(0),               // sizeOfNameBlock = 0
    le32(0),               // uncompSizeOfNameBlock = 0
  ]);
  return Buffer.concat([header, payload]);
}

/**
 * Build a synthetic .toc file with 1 entry.
 *
 * .toc header (36 bytes) format (matches parseTocHeader in tocReader.ts):
 *   magic[0..3]     = 0x544F4320 LE (" COT" — LE bytes: 0x20, 0x43, 0x4F, 0x54)
 *   version[4..7]   = 0x30303031 LE ("1000" — LE bytes: 0x31, 0x30, 0x30, 0x30)
 *   tocCompressor[8]         = 0 (stored)
 *   fileNameBlockComp[9]     = 0 (stored)
 *   unusedOne[10], unusedTwo[11] = 0
 *   numberOfFiles[12..15]   = 1
 *   sizeOfTOC[16..19]       = 24 (1 entry × 24 bytes)
 *   sizeOfNameBlock[20..23] = nameBlock.length
 *   uncompSizeOfNameBlock[24..27] = nameBlock.length
 *   numberOfTreeFiles[28..31] = 1
 *   sizeOfTreeFileNameBlock[32..35] = treeNamesBlock.length
 *
 * Layout after header:
 *   tree-name block (NUL-terminated archive filenames)
 *   TOC blob (numberOfFiles × 24 bytes)
 *   name block (NUL-terminated virtual paths)
 *
 * @param archiveBasename  Filename of the container archive (e.g. "container.tre")
 * @param virtualPath      Virtual path of the entry (e.g. "toc/entry.dat")
 * @param payloadOffset    Byte offset of the payload within the archive file
 * @param payloadLength    Uncompressed byte count of the payload
 * @returns                Full .toc file bytes
 */
function buildSyntheticToc(
  archiveBasename: string,
  virtualPath:     string,
  payloadOffset:   number,
  payloadLength:   number,
): Buffer {
  const treeNamesBlock = Buffer.concat([
    Buffer.from(archiveBasename, 'ascii'), Buffer.from([0]),
  ]);
  const nameBlock = Buffer.concat([
    Buffer.from(virtualPath, 'ascii'), Buffer.from([0]),
  ]);
  const sizeOfTOC = 24;

  // Header (36 bytes): field values per parseTocHeader in tocReader.ts
  const header = Buffer.alloc(36, 0);
  header.writeUInt32LE(0x544F4320, 0);           // magic
  header.writeUInt32LE(0x30303031, 4);           // version "1000"
  header.writeUInt8(0, 8);                        // tocCompressor = 0
  header.writeUInt8(0, 9);                        // fileNameBlockComp = 0
  // [10..11] unused = 0
  header.writeUInt32LE(1, 12);                   // numberOfFiles = 1
  header.writeUInt32LE(sizeOfTOC, 16);           // sizeOfTOC = 24
  header.writeUInt32LE(nameBlock.length, 20);    // sizeOfNameBlock
  header.writeUInt32LE(nameBlock.length, 24);    // uncompSizeOfNameBlock
  header.writeUInt32LE(1, 28);                   // numberOfTreeFiles = 1
  header.writeUInt32LE(treeNamesBlock.length, 32); // sizeOfTreeFileNameBlock

  // TOC entry (24 bytes per SEARCH_TOC_ENTRY_FMT '<BBHIIIII'):
  //   compressor@0(1), unused@1(1), treeFileIndex@2(2 LE), crc@4(4 LE),
  //   fileNameLength@8(4 LE), offset@12(4 LE), length@16(4 LE), compressedLength@20(4 LE)
  const tocEntry = Buffer.alloc(24, 0);
  tocEntry.writeUInt8(0, 0);                     // compressor = 0 (stored)
  tocEntry.writeUInt8(0, 1);                     // unused
  tocEntry.writeUInt16LE(0, 2);                  // treeFileIndex = 0
  tocEntry.writeUInt32LE(0, 4);                  // crc = 0 (unused by resolveFull name-map)
  tocEntry.writeUInt32LE(virtualPath.length, 8); // fileNameLength (without NUL)
  tocEntry.writeUInt32LE(payloadOffset, 12);     // offset into the archive file
  tocEntry.writeUInt32LE(payloadLength, 16);     // length (uncompressed size)
  tocEntry.writeUInt32LE(payloadLength, 20);     // compressedLength = length (stored)

  return Buffer.concat([header, treeNamesBlock, tocEntry, nameBlock]);
}

// ─── Integration test suite ───────────────────────────────────────────────────

describe('tre-toc-extract integration (F-2, gate D-16)', () => {
  const TEST_DIR     = join(tmpdir(), 'swg-toc-integration-test');
  const ARCHIVE_DIR  = join(TEST_DIR, 'testdir');
  const ARCHIVE_PATH = join(ARCHIVE_DIR, 'container.tre');
  const TOC_PATH     = join(TEST_DIR, 'client.toc');
  const VIRTUAL_PATH = 'toc/entry.dat';
  const PAYLOAD      = Buffer.from('toc-data');        // 8 bytes, compressor=0 (stored)
  const PAYLOAD_OFF  = 36;                              // payload at byte 36 (right after header)
  let   handle: string | undefined;

  beforeAll(() => {
    mkdirSync(ARCHIVE_DIR, { recursive: true });

    // 1. Write v6000 TRE with empty internal TOC + payload at offset 36
    const treBuf = buildV6000EmptyTocTre(PAYLOAD);
    writeFileSync(ARCHIVE_PATH, treBuf);

    // 2. Write synthetic .toc pointing to the payload in container.tre
    const tocBuf = buildSyntheticToc('container.tre', VIRTUAL_PATH, PAYLOAD_OFF, PAYLOAD.length);
    writeFileSync(TOC_PATH, tocBuf);

    // 3. Mount via mountTreMountWithToc (wires parseTocIntoMount on native side)
    handle = nativeCore.mountTreMountWithToc(
      [ARCHIVE_PATH],
      [1],
      TOC_PATH,
      ARCHIVE_DIR,   // tocTreePath = directory containing the archives
    );
  });

  afterAll(() => {
    if (handle) {
      try { nativeCore.disposeTreMount(handle); } catch { /* ignore */ }
    }
    if (existsSync(TEST_DIR)) {
      try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('archive mounts successfully with a parseTocIntoMount-wired entry', () => {
    expect(handle).toBeTruthy();
  });

  it('readMountEntry via internal TOC returns nothing for TOC-sourced entry (winnerEntryIndex=-1 path)', () => {
    // Without the descriptor, readMountEntry uses the internal TOC. Since numberOfFiles=0,
    // the internal TOC is empty → winnerEntryIndex=-1 → should throw or return empty.
    // This proves that Case 2 (readMountEntry) alone cannot serve TOC-sourced entries.
    expect(() => nativeCore.readMountEntry(handle!, 0, 0)).toThrow();
  });

  it('readTocIndex.resolveFull returns a valid descriptor for the virtual path', () => {
    const tocIndex = readTocIndex(TOC_PATH);
    const desc = tocIndex.resolveFull(VIRTUAL_PATH);
    expect(desc).toBeDefined();
    expect(desc!.offset).toBe(PAYLOAD_OFF);
    expect(desc!.length).toBe(PAYLOAD.length);
    expect(desc!.compressedLength).toBe(PAYLOAD.length);
    expect(desc!.compressor).toBe(0);
    expect(desc!.treName).toBe('container.tre');
  });

  it('extractMountAt with descriptor extracts the correct payload bytes (F-2 end-to-end)', () => {
    const tocIndex = readTocIndex(TOC_PATH);
    const desc = tocIndex.resolveFull(VIRTUAL_PATH);
    expect(desc).toBeDefined();

    // Core F-2 assertion: extractMountAt with the TOC descriptor returns the stored payload.
    const result = nativeCore.extractMountAt(handle!, 0, {
      offset:           desc!.offset,
      length:           desc!.length,
      compressedLength: desc!.compressedLength,
      compressor:       desc!.compressor,
      crc:              desc!.crc,   // F-4: crc threaded through
    });

    expect(result).toBeDefined();
    expect(result.encrypted).toBeFalsy();
    expect(result.bytes).toBeDefined();
    const extracted = Buffer.from(result.bytes!);
    expect(extracted.toString('ascii')).toBe('toc-data');
  });

  it('extractMountAt with encrypted payload marks encrypted:true (F-4 length guard)', () => {
    // Use the v6000-encrypted.tre fixture (compressor=2, invalid zlib) to prove the
    // encrypted sentinel still works via extractMountAt.
    const encFixture = join(__dirname_es, '..', 'fixtures', 'tre', 'v6000-encrypted.tre');
    const encHandle = nativeCore.mountTreMountWithToc(
      [encFixture],
      [1],
      TOC_PATH,          // same .toc, treeFileIndex=0 points to "container.tre"
      ARCHIVE_DIR,       // same tocTreePath — will not match "container.tre" vs fixture name
    );
    try {
      // The .toc doesn't point to the encrypted fixture's payload location, but we can
      // test extractMountAt directly with a descriptor pointing to the invalid payload
      // at the known offset (offset=90, length=100, compressedLength=13, compressor=2).
      const result = nativeCore.extractMountAt(encHandle, 0, {
        offset:           90,    // payload offset in v6000-encrypted.tre
        length:           100,   // claimed uncompressed size
        compressedLength: 13,    // 13 bytes: "NOTVALIDZLIB\0"
        compressor:       2,     // zlib — invalid payload fails RFC1950 header gate
      });
      // Invalid zlib → inflate throws → extractAt sets encrypted:true (MOUNT-04)
      expect(result.encrypted).toBe(true);
      expect(result.bytes).toBeUndefined();
    } finally {
      try { nativeCore.disposeTreMount(encHandle); } catch { /* ignore */ }
    }
  });
});
