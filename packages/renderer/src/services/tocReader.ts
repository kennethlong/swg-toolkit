// @vitest-environment node
/**
 * packages/renderer/src/services/tocReader.ts
 * SearchTOC reader: parse the sku0_client.toc header, tree-name block, and full entry
 * index; provide an engine-faithful CRC-keyed binary-search index (H1).
 *
 * Ground truth:
 *   TreeFile_SearchNode.h:270-284   — SearchTOC::Header layout (36 bytes LE)
 *   TreeFile_SearchNode.h:289-299   — TableOfContentsEntry layout (24 bytes LE)
 *   TreeFile_SearchNode.cpp:783-836 — SearchTOC::localExists (binary search algorithm)
 *   swg-blender-plugin/swg_pipeline/tre_reader.py:335-413 — Python reference reader
 *
 * Node.js only (readFileSync); no stream API; zlib built-in for decompression.
 */

import * as fs from 'fs';
import { crc32 } from './crc32';

// zlib is a Node.js built-in — no new package dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const zlib = require('zlib') as { inflateSync: (buf: Buffer) => Buffer };

// ─── TocHeader ───────────────────────────────────────────────────────────────

/**
 * Parsed SearchTOC file header.
 *
 * Layout (36 bytes LE) per TreeFile_SearchNode.h:270-284 and
 * tre_reader.py SEARCH_TOC_HEADER_FMT = '<4s4sBBBB6I':
 *   offset  0: uint32  magic            = 0x544F4320 (bytes " COT")
 *   offset  4: uint32  version          = 0x30303031 (bytes "1000")
 *   offset  8: uint8   tocCompressor    (0 = uncompressed)
 *   offset  9: uint8   fileNameBlockCompressor (0 = uncompressed; field per h:275)
 *   offset 10: uint8   unusedOne
 *   offset 11: uint8   unusedTwo
 *   offset 12: uint32  numberOfFiles          (193475 for sku0)
 *   offset 16: uint32  sizeOfTOC              (193475 × 24 = 4643400 for sku0)
 *   offset 20: uint32  sizeOfNameBlock
 *   offset 24: uint32  uncompSizeOfNameBlock
 *   offset 28: uint32  numberOfTreeFiles      (131 for sku0)
 *   offset 32: uint32  sizeOfTreeFileNameBlock (2757 for sku0)
 *
 * Validated by Cursor against real sku0_client.toc bytes.
 */
export interface TocHeader {
  /** magic word " COT" = 0x544F4320 */
  magic: number;
  /** version word "1000" = 0x30303031 */
  version: number;
  /** 0 = stored (uncompressed); non-zero = zlib-deflated */
  tocCompressor: number;
  /** 0 = stored (uncompressed); non-zero = zlib-deflated (TreeFile_SearchNode.h:275) */
  fileNameBlockCompressor: number;
  unusedOne: number;
  unusedTwo: number;
  numberOfFiles: number;
  sizeOfTOC: number;
  sizeOfNameBlock: number;
  uncompSizeOfNameBlock: number;
  numberOfTreeFiles: number;
  sizeOfTreeFileNameBlock: number;
}

// ─── TocIndex interfaces ──────────────────────────────────────────────────────

/** Result of resolving a virtual path through the TOC index. */
export interface TocIndexEntry {
  /** Index of the TRE file that contains this virtual path (per treeFiles array). */
  treeFileIndex: number;
  /** Short filename of the winning TRE (e.g. "patch_15_02.tre"). */
  treName: string;
}

/**
 * Engine-faithful CRC-keyed binary-search TOC index.
 * Replicates SearchTOC::localExists (TreeFile_SearchNode.cpp:783-836) — NOT a Map /
 * KEEP FIRST heuristic, which diverges from the engine on duplicate paths (H1).
 */
export interface TocIndex {
  /**
   * Resolve a virtual path to its winning TRE.
   *
   * Normalises virtualPath (toLowerCase + forward-slash), computes CRC, then
   * binary-searches the on-disk-sorted entry array. Returns the entry at the mid
   * where crc matches and name matches case-insensitively — which matches the
   * engine's treeFileIndex selection exactly.
   *
   * Returns undefined when the path is not found.
   */
  resolve(virtualPath: string): TocIndexEntry | undefined;
  /** Total number of TOC entries. */
  readonly size: number;
}

// ─── Internal entry type ──────────────────────────────────────────────────────

interface RawEntry {
  treeFileIndex: number;
  crc: number;
  /** Value stored on disk for the filename field: the LENGTH of the filename string. */
  fileNameLength: number;
  /** Rebuilt cumulative byte offset into the name block (NOT the on-disk value). */
  fileNameOffset: number;
}

// ─── parseTocHeader ───────────────────────────────────────────────────────────

/**
 * Parse the 36-byte SearchTOC file header from a Buffer.
 *
 * @throws Error if buf is shorter than 36 bytes or magic/version mismatch.
 */
export function parseTocHeader(buf: Buffer): TocHeader {
  if (buf.length < 36) {
    throw new Error('Invalid .toc: header too short');
  }

  const magic   = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);

  if (magic !== 0x544F4320 || version !== 0x30303031) {
    throw new Error(
      `Invalid .toc magic: expected " COT1000", got 0x${magic.toString(16)} / 0x${version.toString(16)}`,
    );
  }

  return {
    magic,
    version,
    tocCompressor:            buf.readUInt8(8),
    fileNameBlockCompressor:  buf.readUInt8(9),
    unusedOne:                buf.readUInt8(10),
    unusedTwo:                buf.readUInt8(11),
    numberOfFiles:            buf.readUInt32LE(12),
    sizeOfTOC:                buf.readUInt32LE(16),
    sizeOfNameBlock:          buf.readUInt32LE(20),
    uncompSizeOfNameBlock:    buf.readUInt32LE(24),
    numberOfTreeFiles:        buf.readUInt32LE(28),
    sizeOfTreeFileNameBlock:  buf.readUInt32LE(32),
  };
}

// ─── readTocTreeNames ─────────────────────────────────────────────────────────

/**
 * Read the tree-file name list from a .toc file (or a 2793-byte CI oracle fixture that
 * contains only the 36-byte header + tree-name block — no TOC blob required).
 *
 * Returns an array of `numberOfTreeFiles` NUL-terminated Latin-1 strings (e.g.
 * ["bottom.tre", "sku_0_client_00.tre", ...]).
 *
 * @throws Error if the header is invalid or the tree-name block would exceed file size.
 */
export function readTocTreeNames(filePath: string): string[] {
  const buf = fs.readFileSync(filePath);
  const header = parseTocHeader(buf.subarray(0, 36));

  if (buf.length < 36 + header.sizeOfTreeFileNameBlock) {
    throw new Error(
      `Malformed .toc: tree-name block exceeds file size ` +
      `(need ${36 + header.sizeOfTreeFileNameBlock} bytes, got ${buf.length})`,
    );
  }

  const nameBlock = buf.subarray(36, 36 + header.sizeOfTreeFileNameBlock);
  const names: string[] = [];
  let pos = 0;

  while (names.length < header.numberOfTreeFiles && pos < nameBlock.length) {
    // Find next NUL terminator
    let end = pos;
    while (end < nameBlock.length && nameBlock[end] !== 0) end++;
    names.push(nameBlock.subarray(pos, end).toString('latin1'));
    pos = end + 1; // skip past NUL
  }

  return names;
}

// ─── readTocIndex ─────────────────────────────────────────────────────────────

/**
 * Build an engine-faithful CRC-keyed binary-search index from a full .toc file.
 *
 * Replicates SearchTOC::localExists (TreeFile_SearchNode.cpp:783-836):
 *   normalise query → crc32(query) → binary-search on (crc ASC, name ASC) sorted
 *   entry array → name tiebreak via case-insensitive compare → return winning entry.
 *
 * H1 invariant: binary search may land on ANY of several entries sharing the same CRC
 * (e.g. space_faction.stf appears in both patch_24 and patch_15_02). The result is
 * determined by the initial mid, matching the engine's behaviour — NOT a KEEP FIRST
 * heuristic which would always return the lowest array index.
 *
 * @throws Error if the file is malformed (header invalid, bounds exceeded, size mismatch).
 */
export function readTocIndex(filePath: string): TocIndex {
  const buf = fs.readFileSync(filePath);
  const header = parseTocHeader(buf.subarray(0, 36));

  // TOC blob starts after the 36-byte header + tree-name block.
  const tocBlobStart = 36 + header.sizeOfTreeFileNameBlock;

  if (buf.length < tocBlobStart + header.sizeOfTOC) {
    throw new Error('Malformed .toc: TOC blob exceeds file size');
  }

  // Sanity check: sizeOfTOC must equal numberOfFiles × 24 bytes per entry.
  if (header.sizeOfTOC !== header.numberOfFiles * 24) {
    throw new Error(
      `Malformed .toc: sizeOfTOC (${header.sizeOfTOC}) !== numberOfFiles (${header.numberOfFiles}) × 24`,
    );
  }

  // Decompress TOC blob if needed.
  const rawTocBlob = buf.subarray(tocBlobStart, tocBlobStart + header.sizeOfTOC);
  const tocBlob = header.tocCompressor !== 0 ? zlib.inflateSync(rawTocBlob) : rawTocBlob;

  // Name block starts immediately after the TOC blob.
  const nameBlockStart = tocBlobStart + header.sizeOfTOC;
  const rawNameBlock = buf.subarray(nameBlockStart);
  const nameBlock = header.fileNameBlockCompressor !== 0
    ? zlib.inflateSync(rawNameBlock)
    : rawNameBlock;

  // Get tree-file names for treeFileIndex → treName lookup.
  const treeNames = readTocTreeNames(filePath);

  // Parse raw TOC entries (24 bytes each) in ON-DISK ORDER (already sorted by (crc, name) ASC).
  // DO NOT re-sort — the binary search depends on this ordering.
  //
  // TableOfContentsEntry per TreeFile_SearchNode.h:289-299 + tre_reader.py:381
  //   SEARCH_TOC_ENTRY_FMT = '<BBHIIIII'  (struct, 24 bytes total):
  //   byte  0 (1B): compressor      uint8
  //   byte  1 (1B): unused          uint8
  //   byte  2 (2B): treeFileIndex   uint16 LE
  //   byte  4 (4B): crc             uint32 LE
  //   byte  8 (4B): fileNameOffset  uint32 LE — disk stores filename LENGTH; rebuilt below
  //   byte 12 (4B): offset          uint32 LE
  //   byte 16 (4B): length          uint32 LE
  //   byte 20 (4B): compressedLength uint32 LE
  const n = header.numberOfFiles;
  const entries: RawEntry[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const base = i * 24;
    entries[i] = {
      treeFileIndex: tocBlob.readUInt16LE(base + 2),
      crc:           tocBlob.readUInt32LE(base + 4),
      fileNameLength: tocBlob.readUInt32LE(base + 8),  // disk value = filename LENGTH
      fileNameOffset: 0,                                // to be rebuilt below
    };
  }

  // Rebuild fileNameOffset as cumulative byte position in name block.
  // Source: tre_reader.py:385-389
  //   fn_offset = 0
  //   for each entry i:
  //     entry[i].fileNameOffset = fn_offset
  //     fn_offset += fn_field + 1  // +1 for NUL terminator
  let fnOffset = 0;
  for (let i = 0; i < n; i++) {
    entries[i]!.fileNameOffset = fnOffset;
    fnOffset += entries[i]!.fileNameLength + 1;
  }

  // ─── ENGINE-FAITHFUL BINARY SEARCH ─────────────────────────────────────────
  // Replicates SearchTOC::localExists (TreeFile_SearchNode.cpp:783-836).
  // The entry array is ALREADY sorted by (crc ASC, name ASC) on disk — do NOT re-sort.
  //
  // On crc collision, name compare uses _stricmp equivalent (case-insensitive ASCII).
  // The binary search may land at ANY matching entry — this is the engine's behaviour.
  // A Map/KEEP FIRST approach would diverge on real sku0 duplicates (H1 invariant).

  function resolve(virtualPath: string): TocIndexEntry | undefined {
    // Normalise: lowercase + forward-slash (matching engine's input normalisation).
    const q    = virtualPath.toLowerCase().replace(/\\/g, '/');
    const qCrc = crc32(q);

    let lo = 0;
    let hi = n - 1;
    let mid = 0;
    let found = false;

    while (!found && lo <= hi) {
      mid = (lo + hi) >>> 1;
      const entry = entries[mid]!;

      if (entry.crc < qCrc) {
        lo = mid + 1;
      } else if (entry.crc > qCrc) {
        hi = mid - 1;
      } else {
        // CRC equal — tiebreak by case-insensitive name compare (mirrors _stricmp).
        const storedName = nameBlock
          .subarray(entry.fileNameOffset, entry.fileNameOffset + entry.fileNameLength)
          .toString('latin1');
        const cmp = storedName.localeCompare(q, undefined, { sensitivity: 'base' });

        if (cmp < 0) {
          lo = mid + 1;
        } else if (cmp > 0) {
          hi = mid - 1;
        } else {
          found = true;
        }
      }
    }

    if (!found) return undefined;

    const winner = entries[mid]!;
    return {
      treeFileIndex: winner.treeFileIndex,
      treName:       treeNames[winner.treeFileIndex] ?? '',
    };
  }

  return {
    resolve,
    get size() { return n; },
  };
}

