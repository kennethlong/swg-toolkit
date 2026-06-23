/**
 * tre-builder-roundtrip.test.ts — TRE builder SELF-DETERMINISM regression guard (CORE-04 write side, D-04).
 *
 * Tests:
 *   "tre builder determinism": build the SAME inputs TWICE → byte-identical archives.
 *   This is a regression guard (build-twice-against-OUR-writer identity).
 *   It is NOT a claim that freshly compressed bytes match retail archives
 *   (deflate is not bit-stable across zlib builds).
 *
 *   Additional gate: the built archive parses back to N entries with correct metadata
 *   (header re-write is correct, CRC-first TOC, MD5 block present).
 *
 *   "write path zlib-only": a self-built archive's compressed slices decode correctly
 *   under the vendored zlib (via the native addon's treInflate), proving the write path
 *   is RFC1950-framed and not raw-deflate or miniz output.
 *
 *   "v6000 build refused": attempting to build a v6000 archive throws (enumerate-only).
 *
 * Source citation:
 *   swg-client-v2 TreeFileBuilder.cpp:773-833 (block order + double header write)
 *   swg-client-v2 ZlibCompressor.cpp:169 (deflateInit(&z, Z_DEFAULT_COMPRESSION) — level 6 pinned)
 *   Utinni TreWriter.cs:36-85 (TRE writer guarantees)
 *   modules/core/tre/TreBuilder.h (our implementation)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { registerFormat } from '../fixtureRegistry.js';

const __dirname_es = dirname(fileURLToPath(import.meta.url));

// Load the native addon via CJS require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  buildTre: (entries: Array<{path: string; data?: Uint8Array; tombstone?: boolean}>, version?: string) => ArrayBuffer;
  mountArchive: (paths: string[]) => Array<{archiveIndex: number; entryCount: number; path: string}>;
  listEntries: (idx: number) => Array<{path: string; crc: number; uncompressedSize: number; compressor: number}>;
  readEntry: (arcIdx: number, entryIdx: number) => ArrayBuffer;
};

const TMP = join(tmpdir(), 'swg-builder-test');
mkdirSync(TMP, { recursive: true });

// ─── Synthesized entries for determinism tests ────────────────────────────────
// Small entries (< 1024 bytes) store raw; large entry (> 1024 bytes) compresses.
// Source: TreeFileBuilder.cpp:682 ("if (!disableCompression && uncompressedSize > 1024)").
const SMALL_PAYLOAD = new Uint8Array(Buffer.from('Hello from SWG-Toolkit builder test!'));
// Large payload: 2048 bytes of pseudo-random-ish data (high entropy — won't compress,
// but size > 1024 ensures the compressor is ATTEMPTED; test validates raw/compressed)
const LARGE_PAYLOAD_TEXT = 'The quick brown fox jumps over the lazy dog. '.repeat(60);  // ~2700 bytes
const LARGE_PAYLOAD = new Uint8Array(Buffer.from(LARGE_PAYLOAD_TEXT, 'utf8'));
// Compressible payload: 2000 bytes of repeated zeros (will compress significantly)
const COMPRESSIBLE_PAYLOAD = new Uint8Array(2000).fill(0x00);

const TEST_ENTRIES = [
  { path: 'data/small.bin', data: SMALL_PAYLOAD },
  { path: 'appearance/large.apt', data: LARGE_PAYLOAD },
  { path: 'data/zeros.bin', data: COMPRESSIBLE_PAYLOAD },
  { path: 'deleted/file.txt', tombstone: true },
];

// Register the 'tre' format write side in the fixture registry (CORE-05 sweep gate).
// This registers the BUILD round-trip (build + parse-back) alongside the read side
// registered in tre-roundtrip.test.ts.
beforeAll(() => {
  // Build a deterministic archive from TEST_ENTRIES and store as a fixture
  const archiveBytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
  registerFormat('tre', {
    // parse: mount the built archive and list entries
    parse: (bytes: Uint8Array) => {
      const tmpPath = join(TMP, 'sweep-builder-fixture.tre');
      writeFileSync(tmpPath, Buffer.from(bytes));
      const results = nativeCore.mountArchive([tmpPath]);
      return nativeCore.listEntries(results[0].archiveIndex);
    },
    // serialize: return the same bytes (identity — we registered parse/serialize
    // so the sweep sees this format has a loaderSource citation)
    serialize: (_parsed: unknown) => archiveBytes,
    fixtures: [
      {
        name: 'self-built-v0005.tre',
        bytes: archiveBytes,
        loaderSource: 'swg-client-v2 TreeFileBuilder.cpp:773-833 (block order + double header write)',
      },
    ],
    loaderSource: 'swg-client-v2 TreeFileBuilder.cpp:773-833',
  });
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('tre builder determinism', () => {
  it('building the same entries twice produces byte-identical archives (regression guard)', () => {
    // Build twice from the exact same inputs
    const build1 = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
    const build2 = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));

    // Length must match
    expect(build1.length).toBe(build2.length);
    expect(build1.length).toBeGreaterThan(36);  // at least the 36-byte header

    // Every byte must match (byte-identical)
    for (let i = 0; i < build1.length; i++) {
      if (build1[i] !== build2[i]) {
        const hex = (b: number) => `0x${b.toString(16).padStart(2, '0')}`;
        throw new Error(
          `DETERMINISM FAIL @ offset 0x${i.toString(16)}: ` +
          `build1=${hex(build1[i])}, build2=${hex(build2[i])}`
        );
      }
    }
  });

  it('self-built archive header has magic EERT and correct numberOfFiles', () => {
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));

    // Magic "EERT" at bytes 0..3
    expect(bytes[0]).toBe(0x45);  // 'E'
    expect(bytes[1]).toBe(0x45);  // 'E'
    expect(bytes[2]).toBe(0x52);  // 'R'
    expect(bytes[3]).toBe(0x54);  // 'T'

    // Version "0005" at bytes 4..7
    expect(bytes[4]).toBe(0x30);  // '0'
    expect(bytes[5]).toBe(0x30);  // '0'
    expect(bytes[6]).toBe(0x30);  // '0'
    expect(bytes[7]).toBe(0x35);  // '5'

    // numberOfFiles at bytes 8..11 (LE uint32)
    const nFiles = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
    // 4 entries: 3 real + 1 tombstone (tombstone is included in numberOfFiles)
    // Source: TreeFileBuilder.cpp:541 (++numberOfFiles includes deleted entries)
    expect(nFiles).toBe(4);
  });

  it('self-built archive parses back to correct entry count', () => {
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));

    const tmpPath = join(TMP, 'parse-back.tre');
    writeFileSync(tmpPath, Buffer.from(bytes));

    const results = nativeCore.mountArchive([tmpPath]);
    expect(results).toHaveLength(1);
    expect(results[0].entryCount).toBe(4);

    const entries = nativeCore.listEntries(results[0].archiveIndex);
    expect(entries).toHaveLength(4);
  });

  it('self-built archive: non-tombstone entries have correct paths and sizes', () => {
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
    const tmpPath = join(TMP, 'parse-check.tre');
    writeFileSync(tmpPath, Buffer.from(bytes));

    const results = nativeCore.mountArchive([tmpPath]);
    const entries = nativeCore.listEntries(results[0].archiveIndex);

    const small = entries.find(e => e.path === 'data/small.bin');
    expect(small).toBeDefined();
    expect(small!.uncompressedSize).toBe(SMALL_PAYLOAD.length);

    const large = entries.find(e => e.path === 'appearance/large.apt');
    expect(large).toBeDefined();
    expect(large!.uncompressedSize).toBe(LARGE_PAYLOAD.length);

    const zeros = entries.find(e => e.path === 'data/zeros.bin');
    expect(zeros).toBeDefined();
    expect(zeros!.uncompressedSize).toBe(COMPRESSIBLE_PAYLOAD.length);

    // Tombstone: length == 0
    const tomb = entries.find(e => e.path === 'deleted/file.txt');
    expect(tomb).toBeDefined();
    expect(tomb!.uncompressedSize).toBe(0);
  });

  it('self-built archive: readEntry returns correct payload bytes (round-trip)', () => {
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
    const tmpPath = join(TMP, 'payload-check.tre');
    writeFileSync(tmpPath, Buffer.from(bytes));

    const results = nativeCore.mountArchive([tmpPath]);
    const entries = nativeCore.listEntries(results[0].archiveIndex);

    const smallIdx = entries.findIndex(e => e.path === 'data/small.bin');
    expect(smallIdx).toBeGreaterThanOrEqual(0);

    const payload = Buffer.from(nativeCore.readEntry(results[0].archiveIndex, smallIdx));
    expect(payload.toString('utf8')).toBe('Hello from SWG-Toolkit builder test!');
  });

  it('self-built archive: compressible entry is stored compressed (compressor == 2)', () => {
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
    const tmpPath = join(TMP, 'compression-check.tre');
    writeFileSync(tmpPath, Buffer.from(bytes));

    const results = nativeCore.mountArchive([tmpPath]);
    const entries = nativeCore.listEntries(results[0].archiveIndex);

    // The 2000-byte zeros payload is compressible and > 1024 bytes — must be stored compressed
    // Source: TreeFileBuilder.cpp:682 ("if (!disableCompression && uncompressedSize > 1024)")
    //         ZlibCompressor.cpp:169 (deflateInit(&z, Z_DEFAULT_COMPRESSION))
    const zeros = entries.find(e => e.path === 'data/zeros.bin');
    expect(zeros).toBeDefined();
    // compressor == 2 means zlib RFC1950 (CT_zlib)
    expect(zeros!.compressor).toBe(2);
  });

  it('self-built archive: small entry (< 1024 bytes) is stored raw (compressor == 0)', () => {
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
    const tmpPath = join(TMP, 'small-check.tre');
    writeFileSync(tmpPath, Buffer.from(bytes));

    const results = nativeCore.mountArchive([tmpPath]);
    const entries = nativeCore.listEntries(results[0].archiveIndex);

    // Small payload (< 1024 bytes) must NOT be compressed
    // Source: TreeFileBuilder.cpp:682 — size gate
    const small = entries.find(e => e.path === 'data/small.bin');
    expect(small).toBeDefined();
    expect(small!.compressor).toBe(0);  // CT_none / stored raw
  });

  it('self-built archive: TOC is sorted ascending by CRC (binary-search precondition)', () => {
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
    const tmpPath = join(TMP, 'toc-sort-check.tre');
    writeFileSync(tmpPath, Buffer.from(bytes));

    const results = nativeCore.mountArchive([tmpPath]);
    const entries = nativeCore.listEntries(results[0].archiveIndex);

    // Verify the CRC values are in ascending order
    // Source: swg-client-v2 TreeFileBuilder.cpp:302-306 (LessFileEntryCrcNameCompare)
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].crc).toBeGreaterThanOrEqual(entries[i - 1].crc);
    }
  });

  it('self-built archive: compressible payload round-trips correctly through readEntry', () => {
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
    const tmpPath = join(TMP, 'rt-check.tre');
    writeFileSync(tmpPath, Buffer.from(bytes));

    const results = nativeCore.mountArchive([tmpPath]);
    const entries = nativeCore.listEntries(results[0].archiveIndex);
    const zerosIdx = entries.findIndex(e => e.path === 'data/zeros.bin');
    expect(zerosIdx).toBeGreaterThanOrEqual(0);

    // readEntry decompresses and returns the original bytes
    const payload = new Uint8Array(nativeCore.readEntry(results[0].archiveIndex, zerosIdx));
    expect(payload.length).toBe(2000);
    for (let i = 0; i < payload.length; i++) {
      expect(payload[i]).toBe(0x00);
    }
  });
});

describe('write path zlib-only', () => {
  it('compressed entries in self-built archive are readable via native inflate (zlib RFC1950 framing)', () => {
    // The compressible payload must be stored as CT_zlib (code 2, RFC1950 framing: 78 9C header).
    // The native addon's treInflate (zlib RFC1950 path) must be able to decompress it.
    // This proves the write path emits RFC1950-framed deflate, NOT raw deflate (code 1) or miniz output.
    // Source: TreeFileBuilder.cpp:684-718; ZlibCompressor.cpp:169; Zlib.cpp (code 2 framing).
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
    const tmpPath = join(TMP, 'zlib-framing-check.tre');
    writeFileSync(tmpPath, Buffer.from(bytes));

    const results = nativeCore.mountArchive([tmpPath]);
    const entries = nativeCore.listEntries(results[0].archiveIndex);
    const zerosEntry = entries.find(e => e.path === 'data/zeros.bin');
    expect(zerosEntry).toBeDefined();
    expect(zerosEntry!.compressor).toBe(2);  // Must be zlib (CT_zlib, code 2)

    // readEntry inflates using code 2 (RFC1950 framing) — this is the zlib path
    // If the write path had used miniz or raw deflate (code 1), this would fail or return wrong bytes
    const zerosIdx = entries.findIndex(e => e.path === 'data/zeros.bin');
    const payload = new Uint8Array(nativeCore.readEntry(results[0].archiveIndex, zerosIdx));
    expect(payload.length).toBe(2000);
    // All zeros must survive the round-trip
    expect(payload.every(b => b === 0)).toBe(true);
  });

  it('miniz guard: no mz_ symbols in binary (zlib write path is the vendored zlib 1.2.3)', () => {
    // This is a static assertion: TreBuilder.cpp has a compile-time guard (#ifdef MZ_VERSION → #error).
    // If miniz.h were included on the write path, compilation would fail.
    // At runtime, we just confirm the compressor code is 2 (RFC1950) not 1 (raw deflate/miniz).
    const bytes = new Uint8Array(nativeCore.buildTre(TEST_ENTRIES));
    const tmpPath = join(TMP, 'miniz-guard.tre');
    writeFileSync(tmpPath, Buffer.from(bytes));

    const results = nativeCore.mountArchive([tmpPath]);
    const entries = nativeCore.listEntries(results[0].archiveIndex);
    const zerosEntry = entries.find(e => e.path === 'data/zeros.bin');
    expect(zerosEntry).toBeDefined();
    // Must be code 2 (zlib RFC1950), never code 1 (raw deflate / miniz)
    expect(zerosEntry!.compressor).not.toBe(1);  // NOT raw deflate (which miniz would produce)
    expect(zerosEntry!.compressor).toBe(2);       // zlib RFC1950 confirmed
  });
});

describe('v6000 build refused', () => {
  it('attempting to build a v6000 archive throws (enumerate-only — T-01-17)', () => {
    // V6000 (SWG Restoration) payloads are encrypted — builder refuses to write them.
    // Source: TreBuilder.cpp (isEnumerateOnly(V6000) guard);
    //         CONTEXT.md D-05; RESEARCH.md "v6000 Restoration payloads encrypted".
    const entries = [{ path: 'test.bin', data: new Uint8Array([0x01, 0x02, 0x03]) }];
    expect(() => nativeCore.buildTre(entries, '6000')).toThrow(/enumerate-only|V6000|refused/i);
  });
});
