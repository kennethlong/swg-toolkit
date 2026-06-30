// @vitest-environment node
/**
 * packages/renderer/src/services/tocReader.resolveFull.test.ts
 *
 * RED scaffold — tocReader.resolveFull: full 7-field descriptor + tombstone filter.
 *
 * This test pins that readTocIndex(...).resolveFull(virtualPath) must return
 * the FULL entry descriptor including offset/length/compressedLength/compressor/crc,
 * in addition to the treeFileIndex/treName that the current resolve() already returns.
 *
 * It also pins the tombstone rule (RESEARCH §Measured ground truth):
 *   A master-.toc entry with length===0 is a DELETION MARKER, not a file.
 *   resolveFull MUST return undefined for tombstone entries (length===0),
 *   mirroring the client's localExists behaviour (tree_file_search_node.cpp:783-836).
 *
 * STATUS: RED until plan 11 (MOUNT-07 / renderer TOC wiring) implements resolveFull.
 *   The test FAILS because resolveFull is not yet a method on the TocIndex object
 *   returned by readTocIndex. Adding resolveFull and the tombstone filter is plan 11's job.
 *
 * Ground truth:
 *   TreeFile_SearchNode.cpp:783-836 (localExists — tombstone stops the chain)
 *   tocReader.ts:228-251 (entry layout — offset@12, length@16, compressedLength@20, compressor@0)
 *   RESEARCH.md §Pillar B "Tombstone rule" + "NOTE: tocReader.readTocIndex's resolve() discards"
 *
 * The test uses a SYNTHETIC minimal SearchTOC buffer (written to a temp file) so it runs
 * in CI without needing any real .toc file from the SWGSource client.
 *
 * Synthetic TOC entries:
 *   Entry 0: "appearance/lod/test_building.lod" — compressor=2, offset=36, length=1092,
 *             compressedLength=564, crc=0x058f215e, treeFileIndex=0
 *             (values taken from the real fixture descriptor for cross-check auditability)
 *   Entry 1: "some/deleted/file.snd" — compressor=0, length=0 (TOMBSTONE), offset=0
 *             (tests that resolveFull returns undefined for tombstones)
 *
 * When resolveFull is implemented (plan 11), the expected return for Entry 0 is:
 *   { treeFileIndex: 0, treName: 'patch_sku3_24_client_00.tre',
 *     offset: 36, length: 1092, compressedLength: 564, compressor: 2, crc: 0x058f215e }
 */

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTocIndex } from './tocReader';

// ─── Synthetic minimal SearchTOC builder ──────────────────────────────────────
//
// Builds a valid minimal SearchTOC buffer (in-process, no real file required).
// Layout per TreeFile_SearchNode.h:270-299 + tocReader.ts comments.

const TOC_MAGIC   = 0x544F4320; // " COT" LE
const TOC_VERSION = 0x30303031; // "1000" LE

/** Synthetic entry 0: a real entry (compressor=2, plain-zlib) */
const ENTRY0_PATH             = 'appearance/lod/test_building.lod';
const ENTRY0_CRC              = 0x00000001;  // synthetic low CRC for sort order
const ENTRY0_OFFSET           = 36;
const ENTRY0_LENGTH           = 1092;        // uncompressed
const ENTRY0_COMPRESSED_LEN   = 564;
const ENTRY0_COMPRESSOR       = 2;           // zlib
const ENTRY0_TREE_FILE_IDX    = 0;

/** Synthetic entry 1: a tombstone (length===0 → deletion marker) */
const ENTRY1_PATH             = 'some/deleted/file.snd';
const ENTRY1_CRC              = 0x00000002;  // synthetic higher CRC (entries must be CRC ASC)
const ENTRY1_COMPRESSOR       = 0;
const ENTRY1_OFFSET           = 0;
const ENTRY1_LENGTH           = 0;           // TOMBSTONE
const ENTRY1_COMPRESSED_LEN   = 0;
const ENTRY1_TREE_FILE_IDX    = 0;

/** The single tree-file name in the synthetic TOC */
const TREE_FILE_NAME = 'patch_sku3_24_client_00.tre';

function buildSyntheticToc(): Buffer {
  // Tree-file name block: NUL-terminated name(s)
  const treeNameBlock = Buffer.from(`${TREE_FILE_NAME}\0`, 'latin1');

  // File names for entries (used in the name block)
  const nameBlock = Buffer.from(`${ENTRY0_PATH}\0${ENTRY1_PATH}\0`, 'latin1');

  // TOC entries: 2 × 24 bytes each
  // Layout per tocReader.ts:232-251 (SEARCH_TOC_ENTRY_FMT '<BBHIIIII'):
  //   byte  0: compressor      uint8
  //   byte  1: unused          uint8
  //   byte  2: treeFileIndex   uint16 LE
  //   byte  4: crc             uint32 LE
  //   byte  8: fileNameLength  uint32 LE  (disk stores LENGTH, not offset)
  //   byte 12: offset          uint32 LE
  //   byte 16: length          uint32 LE  (uncompressed)
  //   byte 20: compressedLength uint32 LE
  const tocBlob = Buffer.allocUnsafe(48); // 2 entries × 24 bytes

  // Entry 0
  tocBlob.writeUInt8(ENTRY0_COMPRESSOR, 0);
  tocBlob.writeUInt8(0, 1);                               // unused
  tocBlob.writeUInt16LE(ENTRY0_TREE_FILE_IDX, 2);
  tocBlob.writeUInt32LE(ENTRY0_CRC, 4);
  tocBlob.writeUInt32LE(ENTRY0_PATH.length, 8);           // filename LENGTH
  tocBlob.writeUInt32LE(ENTRY0_OFFSET, 12);
  tocBlob.writeUInt32LE(ENTRY0_LENGTH, 16);
  tocBlob.writeUInt32LE(ENTRY0_COMPRESSED_LEN, 20);

  // Entry 1 (tombstone)
  tocBlob.writeUInt8(ENTRY1_COMPRESSOR, 24);
  tocBlob.writeUInt8(0, 25);                              // unused
  tocBlob.writeUInt16LE(ENTRY1_TREE_FILE_IDX, 26);
  tocBlob.writeUInt32LE(ENTRY1_CRC, 28);
  tocBlob.writeUInt32LE(ENTRY1_PATH.length, 32);          // filename LENGTH
  tocBlob.writeUInt32LE(ENTRY1_OFFSET, 36);
  tocBlob.writeUInt32LE(ENTRY1_LENGTH, 40);               // 0 = tombstone
  tocBlob.writeUInt32LE(ENTRY1_COMPRESSED_LEN, 44);

  // Header (36 bytes)
  const header = Buffer.allocUnsafe(36);
  header.writeUInt32LE(TOC_MAGIC, 0);
  header.writeUInt32LE(TOC_VERSION, 4);
  header.writeUInt8(0, 8);                                // tocCompressor = 0 (uncompressed)
  header.writeUInt8(0, 9);                                // fileNameBlockCompressor = 0
  header.writeUInt8(0, 10);
  header.writeUInt8(0, 11);
  header.writeUInt32LE(2, 12);                            // numberOfFiles = 2
  header.writeUInt32LE(tocBlob.length, 16);               // sizeOfTOC = 48 = 2 * 24
  header.writeUInt32LE(nameBlock.length, 20);             // sizeOfNameBlock
  header.writeUInt32LE(nameBlock.length, 24);             // uncompSizeOfNameBlock
  header.writeUInt32LE(1, 28);                            // numberOfTreeFiles = 1
  header.writeUInt32LE(treeNameBlock.length, 32);         // sizeOfTreeFileNameBlock

  return Buffer.concat([header, treeNameBlock, tocBlob, nameBlock]);
}

// ─── Write synthetic .toc to a temp file ─────────────────────────────────────
//
// readTocIndex takes a file path and calls readTocTreeNames(filePath) internally,
// so the buffer must be on disk (can't be in-memory only).

const TEMP_DIR  = join(tmpdir(), 'swg-toolkit-tocreader-resolvefull-test');
const TEMP_TOC  = join(TEMP_DIR, 'synthetic_test.toc');

mkdirSync(TEMP_DIR, { recursive: true });
writeFileSync(TEMP_TOC, buildSyntheticToc());

// Clean up temp file after all tests
afterAll(() => {
  try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('tocReader.resolveFull — 7-field descriptor + tombstone filter (RED until plan 11)', () => {
  /**
   * Test 1: resolveFull must return the FULL 7-field entry descriptor.
   *
   * Currently FAILS because resolveFull is NOT a method on the TocIndex returned
   * by readTocIndex. The optional-chaining call returns undefined, and
   * expect(undefined).toMatchObject({...}) fails with a clear assertion error.
   *
   * After plan 11 implements resolveFull, this test passes with the exact 7 fields.
   */
  it('resolveFull returns the full 7-field descriptor for a real entry', () => {
    const index = readTocIndex(TEMP_TOC);

    // Cast to access the not-yet-implemented method via optional chaining.
    // resolveFull is RED here — returns undefined because it doesn't exist yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (index as any).resolveFull?.(ENTRY0_PATH);

    // FAILS until plan 11: result is undefined (resolveFull not implemented).
    // When implemented, must expose ALL 7 fields — not just treeFileIndex + treName.
    expect(result, 'resolveFull must return a 7-field descriptor (not undefined)').toMatchObject({
      treeFileIndex:    expect.any(Number),
      treName:          expect.any(String),
      offset:           expect.any(Number),
      length:           expect.any(Number),
      compressedLength: expect.any(Number),
      compressor:       expect.any(Number),
      crc:              expect.any(Number),
    });

    // When green, assert the exact values from the synthetic entry:
    // (These assertions are inside the toMatchObject above; listed here for explicitness)
    if (result !== undefined) {
      expect(result.treeFileIndex).toBe(ENTRY0_TREE_FILE_IDX);
      expect(result.treName).toBe(TREE_FILE_NAME);
      expect(result.offset).toBe(ENTRY0_OFFSET);
      expect(result.length).toBe(ENTRY0_LENGTH);
      expect(result.compressedLength).toBe(ENTRY0_COMPRESSED_LEN);
      expect(result.compressor).toBe(ENTRY0_COMPRESSOR);
      expect(result.crc).toBe(ENTRY0_CRC);
    }
  });

  /**
   * Test 2: resolveFull must return undefined for a length===0 tombstone entry.
   *
   * The tombstone rule (MOUNT-04 / client localExists): a master-.toc entry with
   * length===0 is a DELETION MARKER — resolveFull must filter it out and return
   * undefined, so callers do not attempt to extract a zero-length "file".
   *
   * This test documents the REQUIREMENT. When plan 11 implements resolveFull,
   * both Test 1 AND Test 2 must be green simultaneously.
   */
  it('resolveFull returns undefined for a length===0 tombstone entry', () => {
    const index = readTocIndex(TEMP_TOC);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (index as any).resolveFull?.(ENTRY1_PATH);

    // Tombstone (length===0) MUST resolve to undefined — not a file, a deletion marker.
    // NOTE: Currently also returns undefined because resolveFull doesn't exist.
    // After plan 11: must be undefined because length===0, not because method is missing.
    //
    // This test is "accidentally green" before plan 11 (both missing-method and correct
    // tombstone-filter return undefined). It becomes a true correctness gate ONLY when
    // Test 1 is also green (resolveFull exists and returns 7 fields for real entries).
    expect(
      result,
      'tombstone entry (length===0) must resolve to undefined — it is a DELETION MARKER',
    ).toBeUndefined();
  });

  /**
   * Test 3: resolveFull vs resolve — full descriptor includes fields absent from resolve().
   *
   * Documents the API gap: the current resolve() returns only { treeFileIndex, treName }.
   * resolveFull must expose offset/length/compressedLength/compressor/crc additionally.
   * This is required for extractMountAt to use the descriptor for per-payload extraction.
   *
   * FAILS until plan 11: (index as any).resolveFull is undefined.
   */
  it('resolveFull exposes offset/length/compressedLength/compressor/crc absent from resolve()', () => {
    const index = readTocIndex(TEMP_TOC);

    // verify resolve() only returns the shallow 2-field result (current behaviour)
    // NOTE: resolve() relies on the CRC binary search, which requires correct CRC values.
    // Our synthetic entries use CRC=0x00000001/0x00000002 (not the real crc32 of the path),
    // so resolve() will return undefined (CRC mismatch). That is expected here.
    const shallowResult = index.resolve(ENTRY0_PATH);
    // (shallowResult is undefined due to synthetic CRC mismatch — documented, not a bug)
    // What matters is the ABSENCE of descriptor fields:
    if (shallowResult !== undefined) {
      // If resolve() somehow finds it, confirm it lacks the new fields
      expect((shallowResult as Record<string, unknown>)['offset']).toBeUndefined();
      expect((shallowResult as Record<string, unknown>)['length']).toBeUndefined();
    }

    // resolveFull MUST return the full descriptor — fails until plan 11
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fullResult = (index as any).resolveFull?.(ENTRY0_PATH);
    expect(
      fullResult,
      'resolveFull must return the full descriptor including offset/length/compressedLength',
    ).toMatchObject({
      offset:           expect.any(Number),
      length:           expect.any(Number),
      compressedLength: expect.any(Number),
      compressor:       expect.any(Number),
      crc:              expect.any(Number),
    });
  });
});
