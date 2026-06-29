// @vitest-environment node
/**
 * packages/renderer/src/services/tocReader.test.ts
 * Wave-0 RED gate for tocReader (Plan 03).
 *
 * All tests import from './tocReader' and './crc32' — neither module exists yet.
 * Every test fails with "Cannot find module" until Plan 03 implements them.
 *
 * Test inventory:
 *   (a) CI oracle — parse sku0_client_header.bin (2793-byte fixture, no skipIf)
 *   (b) Synthetic 36-byte header fixture
 *   (c) H1 — 3-entry duplicate fixture proves binary-search != KEEP FIRST (CI, no skipIf)
 *   (d) Optional real-file oracle (skipIf — needs D:/Code/SWGSource Client v3.0/sku0_client.toc)
 *   (e) Bounds-check: readTocTreeNames throws when name block would exceed file size
 *
 * Ground truth: 04.2-RESEARCH.md §GIVEN A8 + §DEEPENED A5; TreeFile_SearchNode.h:289-299.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// These imports FAIL until Plan 03 — this is the RED gate.
import { parseTocHeader, readTocTreeNames, readTocIndex } from './tocReader';
import { crc32 } from './crc32';

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

/**
 * CI oracle fixture: 2793-byte slice = 36-byte header + 2757-byte tree-name block.
 * Contains magic 0x544F4320 / 0x30303031, numberOfTreeFiles=131 at offset 28.
 * Does NOT require the full 13.8 MB real .toc.
 */
const FIXTURE_PATH = path.resolve(__dirname, '../../../harness/fixtures-real/toc/sku0_client_header.bin');

/**
 * Full real .toc file — present on the maintainer's machine; skipped in CI.
 */
const REAL_TOC = 'D:/Code/SWGSource Client v3.0/sku0_client.toc';
const hasRealToc = fs.existsSync(REAL_TOC);

// ---------------------------------------------------------------------------
// Temp-dir setup (for synthetic fixture + H1 binary TOC + bounds check)
// ---------------------------------------------------------------------------

let tempDir: string;
beforeEach(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-tocreader-test-')); });
afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tocReader', () => {
  /**
   * (a) CI oracle — parse the checked-in 2793-byte header fixture.
   * No skipIf: runs on every machine in CI.
   * Verifies the exact values from the real sku0_client.toc header.
   */
  it('(a) CI oracle: parseTocHeader + readTocTreeNames from sku0_client_header.bin', () => {
    const buf = fs.readFileSync(FIXTURE_PATH);
    const header = parseTocHeader(buf.slice(0, 36));

    expect(header.numberOfFiles).toBe(193475);
    expect(header.numberOfTreeFiles).toBe(131);
    expect(header.sizeOfTOC).toBe(4643400);
    // Magic: ' COT' = 0x544F4320, version: '1000' = 0x30303031
    expect(header.magic).toBe(0x544F4320);
    expect(header.version).toBe(0x30303031);

    // readTocTreeNames reads tree names from the header fixture path (36-byte header only).
    // Returns 131 names; first = 'bottom.tre' (verified from real sku0_client.toc).
    const names = readTocTreeNames(FIXTURE_PATH);
    expect(names.length).toBe(131);
    expect(names[0]).toBe('bottom.tre');
  });

  /**
   * (b) Synthetic 36-byte header — pure in-memory fixture, always CI-runnable.
   * Tests all fields at their exact byte offsets per TreeFile_SearchNode.h:270-299
   * and the Python SEARCH_TOC_HEADER_FMT = "<4s4sBBBB6I".
   *
   * Header layout (36 bytes, little-endian):
   *   Offset 0:  token         (uint32) = 0x544F4320 (' COT')
   *   Offset 4:  version       (uint32) = 0x30303031 ('1000')
   *   Offset 8:  tocCompressor (uint8)  = 0 (uncompressed)
   *   Offset 9:  nameComp      (uint8)  = 0
   *   Offset 10: _u1           (uint8)  = 0
   *   Offset 11: _u2           (uint8)  = 0
   *   Offset 12: numberOfFiles (uint32) = 193475
   *   Offset 16: sizeOfTOC     (uint32) = 4643400
   *   Offset 20: sizeOfNameBlock       (uint32) = 0 (not checked in this test)
   *   Offset 24: uncompSizeOfNameBlock (uint32) = 0
   *   Offset 28: numberOfTreeFiles     (uint32) = 131
   *   Offset 32: sizeOfTreeFileNameBlock (uint32) = 2757
   */
  it('(b) synthetic 36-byte header fixture parses all fields correctly', () => {
    const buf = Buffer.alloc(36, 0);
    buf.writeUInt32LE(0x544F4320, 0);   // token ' COT'
    buf.writeUInt32LE(0x30303031, 4);   // version '1000'
    buf.writeUInt8(0, 8);               // tocCompressor = 0 (uncompressed)
    buf.writeUInt8(0, 9);               // fileNameBlockCompressor = 0
    // Offset 10-11: _u1, _u2 = 0
    buf.writeUInt32LE(193475, 12);      // numberOfFiles
    buf.writeUInt32LE(4643400, 16);     // sizeOfTOC
    // Offset 20-27: sizeOfNameBlock, uncompSizeOfNameBlock = 0
    buf.writeUInt32LE(131, 28);         // numberOfTreeFiles
    buf.writeUInt32LE(2757, 32);        // sizeOfTreeFileNameBlock

    const header = parseTocHeader(buf);
    expect(header.magic).toBe(0x544F4320);
    expect(header.version).toBe(0x30303031);
    expect(header.tocCompressor).toBe(0);
    expect(header.numberOfFiles).toBe(193475);
    expect(header.sizeOfTOC).toBe(4643400);
    expect(header.numberOfTreeFiles).toBe(131);
    expect(header.sizeOfTreeFileNameBlock).toBe(2757);
  });

  /**
   * (c) H1 — 3-entry duplicate fixture: binary-search vs KEEP FIRST divergence.
   * No skipIf: runs in CI without any real .toc file.
   *
   * Fixture: 3-entry TOC with a TRUE DUPLICATE crc path.
   *   entry[0]: treeFileIndex=1, crc=sfCrc — what KEEP FIRST / lowest-array-index returns → WRONG
   *   entry[1]: treeFileIndex=0, crc=sfCrc — binary search mid=(0+2)/2=1 lands here → CORRECT
   *   entry[2]: treeFileIndex=2, crc=padCrc
   *
   * EXPECTED VALUE DERIVATION:
   *   binary search lo=0 hi=2 mid=1 → entry[1].crc==sfCrc, entry[1].path matches
   *   → found at mid=1 → treeFileIndex=0 (patch_15_02.tre).
   *   KEEP FIRST returns entry[0].treeFileIndex=1 (patch_24_client_00 analogue) → WRONG.
   *   This assertion catches any KEEP FIRST implementation.
   *
   * Ground truth: RESEARCH.md §GIVEN A8 counterexample (space_faction.stf in both
   * patch_24_client_00.tre and patch_15_02.tre; binary search serves patch_15_02).
   */
  it('(c) H1 3-entry duplicate: binary search returns treeFileIndex=0, not KEEP FIRST treeFileIndex=1', () => {
    const sfCrc  = crc32('string/ja/space/space_faction.stf');
    const padCrc = crc32('zzz_padding.txt');

    // Sort-order precondition: sfCrc < padCrc (both entries with sfCrc come before padCrc entry).
    // If this fails, the fixture is malformed and must be corrected.
    expect(sfCrc).toBeLessThan(padCrc);

    // Tree name block (57 bytes):
    //   index 0 → "patch_15_02.tre"         (16 bytes incl null)
    //   index 1 → "patch_24_client_00.tre"  (23 bytes incl null)
    //   index 2 → "extra_padding.tre"        (18 bytes incl null)
    const treeNames = Buffer.from('patch_15_02.tre\0patch_24_client_00.tre\0extra_padding.tre\0');
    const sizeOfTreeFileNameBlock = treeNames.length; // 57

    // TOC entries (3 × 24 bytes each, SORTED BY CRC ASCENDING).
    // Entry format per TreeFile_SearchNode.h:289-299 + Python SEARCH_TOC_ENTRY_FMT='<BBHIIIII':
    //   offset 0:  compressor      (uint8)
    //   offset 1:  unused          (uint8)
    //   offset 2:  treeFileIndex   (uint16 LE)
    //   offset 4:  crc             (uint32 LE)
    //   offset 8:  fileNameOffset  (uint32 LE) — stores filename LENGTH on disk;
    //                                            rewritten to cumulative offset after load
    //   offset 12: dataOffset      (uint32 LE)
    //   offset 16: uncompLength    (uint32 LE)
    //   offset 20: compLength      (uint32 LE)
    const makeEntry = (treeFileIndex: number, crc: number, pathLength: number) => {
      const e = Buffer.alloc(24, 0);
      e.writeUInt8(0, 0);                  // compressor = 0 (stored)
      e.writeUInt8(0, 1);                  // unused
      e.writeUInt16LE(treeFileIndex, 2);   // treeFileIndex
      e.writeUInt32LE(crc, 4);             // crc
      e.writeUInt32LE(pathLength, 8);      // fileNameOffset = length of path
      // dataOffset, uncompLength, compLength = 0 (fixture — not used by readTocIndex lookup)
      return e;
    };

    const sfPathLen  = 'string/ja/space/space_faction.stf'.length; // 33
    const padPathLen = 'zzz_padding.txt'.length;                    // 15

    // entry[0]: treeFileIndex=1, crc=sfCrc (KEEP FIRST would return this → WRONG)
    const entry0 = makeEntry(1, sfCrc, sfPathLen);
    // entry[1]: treeFileIndex=0, crc=sfCrc (binary search mid=1 → CORRECT)
    const entry1 = makeEntry(0, sfCrc, sfPathLen);
    // entry[2]: treeFileIndex=2, crc=padCrc
    const entry2 = makeEntry(2, padCrc, padPathLen);

    const tocEntries = Buffer.concat([entry0, entry1, entry2]);
    const sizeOfTOC = tocEntries.length; // 72

    // Name block: both paths (duplicate included) + padding path, NUL-terminated.
    const nameBlock = Buffer.from(
      'string/ja/space/space_faction.stf\0string/ja/space/space_faction.stf\0zzz_padding.txt\0',
    );
    const sizeOfNameBlock = nameBlock.length; // 84

    // 36-byte header
    const header = Buffer.alloc(36, 0);
    header.writeUInt32LE(0x544F4320, 0);          // token ' COT'
    header.writeUInt32LE(0x30303031, 4);          // version '1000'
    header.writeUInt8(0, 8);                      // tocCompressor = 0
    header.writeUInt8(0, 9);                      // fileNameBlockCompressor = 0
    header.writeUInt32LE(3, 12);                  // numberOfFiles = 3
    header.writeUInt32LE(sizeOfTOC, 16);          // sizeOfTOC = 72
    header.writeUInt32LE(sizeOfNameBlock, 20);    // sizeOfNameBlock = 84
    header.writeUInt32LE(sizeOfNameBlock, 24);    // uncompressedSizeOfNameBlock = 84
    header.writeUInt32LE(3, 28);                  // numberOfTreeFiles = 3
    header.writeUInt32LE(sizeOfTreeFileNameBlock, 32); // sizeOfTreeFileNameBlock = 57

    const tocFile = path.join(tempDir, 'h1-fixture.toc');
    fs.writeFileSync(tocFile, Buffer.concat([header, treeNames, tocEntries, nameBlock]));

    const index = readTocIndex(tocFile);
    const resolved = index.resolve('string/ja/space/space_faction.stf');

    // Binary search at mid=1 → entry[1].treeFileIndex=0 (patch_15_02.tre analogue).
    // KEEP FIRST / lowest-array-index would return entry[0].treeFileIndex=1 (patch_24 analogue).
    expect(resolved?.treeFileIndex).toBe(0);
    expect(resolved?.treName).toBe('patch_15_02.tre');
  });

  /**
   * (d) Optional real-file oracle — validates CRC port + binary-search correctness.
   * skipIf(!hasRealToc): only runs on the maintainer's machine where the full .toc is present.
   *
   * Uses the REAL 13.8 MB sku0_client.toc; asserts the H1 counterexample from RESEARCH.md:
   * space_faction.stf → treeFileIndex=42 (patch_15_02.tre), NOT patch_24_client_00.tre (index 54).
   */
  it.skipIf(!hasRealToc)(
    '(d) real sku0_client.toc: space_faction.stf → treeFileIndex=42 (patch_15_02.tre)',
    () => {
      const index = readTocIndex(REAL_TOC);
      const resolved = index.resolve('string/ja/space/space_faction.stf');
      expect(resolved?.treeFileIndex).toBe(42);
      expect(resolved?.treName).toBe('patch_15_02.tre');
    },
  );

  /**
   * (e) Bounds check: readTocTreeNames throws when name block would exceed file size.
   * Defends against malformed headers that declare sizeOfTreeFileNameBlock > actual bytes.
   * T-04.2-04: guards against DoS via crafted .toc header.
   */
  it('(e) readTocTreeNames throws when sizeOfTreeFileNameBlock exceeds file size', () => {
    // Build a 36-byte header claiming sizeOfTreeFileNameBlock = 9999 (exceeds file)
    const buf = Buffer.alloc(36, 0);
    buf.writeUInt32LE(0x544F4320, 0);
    buf.writeUInt32LE(0x30303031, 4);
    buf.writeUInt32LE(1, 12);      // numberOfFiles = 1
    buf.writeUInt32LE(24, 16);     // sizeOfTOC = 24
    buf.writeUInt32LE(1, 28);      // numberOfTreeFiles = 1
    buf.writeUInt32LE(9999, 32);   // sizeOfTreeFileNameBlock = 9999 (will exceed file)
    // Write only the header — no tree-name bytes follow, so 9999 would run past EOF
    const badTocFile = path.join(tempDir, 'bounds-check.toc');
    fs.writeFileSync(badTocFile, buf);

    expect(() => readTocTreeNames(badTocFile)).toThrow();
  });
});
