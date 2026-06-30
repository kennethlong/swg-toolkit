#!/usr/bin/env node
/**
 * extract-v6000-fixture.mjs
 *
 * Extracts one small payload from a swg-source v6000 plain-zlib container via
 * the master sku3_client.toc index. Emits committed fixture files into
 * packages/harness/fixtures-real/toc/ for the MOUNT-03 byte-exact test.
 *
 * Usage:
 *   node packages/harness/scripts/extract-v6000-fixture.mjs
 *
 * Requires the real SWGSource Client v3.0 data root at:
 *   D:/Code/SWGSource Client v3.0/
 *
 * De-anchoring note (LOCKED — do not re-derive):
 *   v6000 is a DUAL format.
 *     - SWG-Source / swg-client-v2 patch_sku3_* : PLAIN ZLIB (target of this script)
 *     - Restoration v6000 (SwgRestoration_*.tre)  : ENCRYPTED (not used here)
 *   The version tag is NOT the encryption discriminator. Per-payload inflate is the
 *   only correct test (mirrors tre_decrypt.py::try_read_tre_payload logic).
 *
 * Ground truth oracle (LOCKED):
 *   patch_sku3_24_shared_00.tre is EERT6000, numberOfFiles=0, all header uint32s zero,
 *   plain-zlib stream begins at offset 36.
 *   SearchTOC entries for this container live in sku3_client.toc (1,158 entries).
 *
 * Output: 3 files with a deterministic base name derived from the virtual path:
 *   {fixtureName}.v6000.zlib.bin        — raw compressed bytes as stored in the .tre
 *   {fixtureName}.v6000.expected.bin    — zlib-inflated bytes (ground-truth oracle)
 *   {fixtureName}.v6000.descriptor.json — offset/length/compressor/crc metadata
 *
 * Re-running this script yields byte-identical output (same entry chosen, same bytes).
 *
 * Security (T-04.3-03-01): script is read-only on CLIENT_ROOT; writes only into OUT_DIR.
 * Security (T-04.3-03-03): bounds-check offset/compressedLength against file size
 *   before reading (mirrors TreArchive T-01-02 subtraction form).
 *
 * Asset safety (D-09/D-10): this emits a SMALL deliberately-extracted payload only,
 * NOT a full archive dump. The fixture is a per-plan policy exception to the gitignored
 * .tre rule; .bin and .json files are NOT covered by the .gitignore.
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filedirname = dirname(fileURLToPath(import.meta.url));

const CLIENT_ROOT = 'D:/Code/SWGSource Client v3.0';
const SKU3_TOC   = join(CLIENT_ROOT, 'sku3_client.toc');
const OUT_DIR    = resolve(__filedirname, '../fixtures-real/toc');

// SearchTOC magic/version (VERIFIED: tocReader.ts + tre_reader.py)
const TOC_MAGIC   = 0x544F4320; // " COT" LE
const TOC_VERSION = 0x30303031; // "1000" LE

// ─── Parse SearchTOC header (36 bytes LE) ────────────────────────────────────
// Layout per TreeFile_SearchNode.h:270-284 + tocReader.ts:27-62
function parseSearchTocHeader(buf) {
  if (buf.length < 36) throw new Error('SearchTOC buffer too short for header');
  const magic   = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  if (magic !== TOC_MAGIC || version !== TOC_VERSION) {
    throw new Error(
      `Bad SearchTOC magic/version: 0x${magic.toString(16)} / 0x${version.toString(16)}`,
    );
  }
  return {
    tocCompressor:           buf.readUInt8(8),
    fileNameBlockCompressor: buf.readUInt8(9),
    numberOfFiles:           buf.readUInt32LE(12),
    sizeOfTOC:               buf.readUInt32LE(16),
    sizeOfNameBlock:         buf.readUInt32LE(20),
    uncompSizeOfNameBlock:   buf.readUInt32LE(24),
    numberOfTreeFiles:       buf.readUInt32LE(28),
    sizeOfTreeFileNameBlock: buf.readUInt32LE(32),
  };
}

// ─── Read sku3_client.toc ────────────────────────────────────────────────────
console.log(`Reading ${SKU3_TOC} ...`);
const tocBuf = readFileSync(SKU3_TOC);
const header = parseSearchTocHeader(tocBuf);

console.log(`  numberOfFiles:       ${header.numberOfFiles}`);
console.log(`  numberOfTreeFiles:   ${header.numberOfTreeFiles}`);
console.log(`  tocCompressor:       ${header.tocCompressor}`);
console.log(`  sizeOfTreeFileNameBlock: ${header.sizeOfTreeFileNameBlock}`);

// ─── Read tree-file names (NUL-terminated, immediately after 36-byte header) ─
const treeNameBlockStart = 36;
const treeNameBlock = tocBuf.subarray(
  treeNameBlockStart,
  treeNameBlockStart + header.sizeOfTreeFileNameBlock,
);
const treeNames = [];
let tnPos = 0;
while (treeNames.length < header.numberOfTreeFiles && tnPos < treeNameBlock.length) {
  let end = tnPos;
  while (end < treeNameBlock.length && treeNameBlock[end] !== 0) end++;
  treeNames.push(treeNameBlock.subarray(tnPos, end).toString('latin1'));
  tnPos = end + 1;
}
console.log(`  treeNames (first 5): ${treeNames.slice(0, 5).join(', ')}`);

// ─── Read TOC blob (after tree-name block) ────────────────────────────────────
const tocBlobStart = 36 + header.sizeOfTreeFileNameBlock;
if (tocBuf.length < tocBlobStart + header.sizeOfTOC) {
  throw new Error('Malformed .toc: TOC blob exceeds file size');
}
const rawTocBlob = tocBuf.subarray(tocBlobStart, tocBlobStart + header.sizeOfTOC);
const tocBlob = header.tocCompressor !== 0 ? inflateSync(rawTocBlob) : rawTocBlob;

// ─── Read name block (after TOC blob) ────────────────────────────────────────
const nameBlockStart = tocBlobStart + header.sizeOfTOC;
const rawNameBlock = tocBuf.subarray(nameBlockStart);
const nameBlock = header.fileNameBlockCompressor !== 0
  ? inflateSync(rawNameBlock)
  : rawNameBlock;

// ─── Parse TOC entries (24 bytes each) ───────────────────────────────────────
// Entry layout (VERIFIED: tocReader.ts:232-251, tre_reader.py SEARCH_TOC_ENTRY_FMT '<BBHIIIII'):
//   byte  0 (1B): compressor      uint8
//   byte  1 (1B): unused          uint8
//   byte  2 (2B): treeFileIndex   uint16 LE
//   byte  4 (4B): crc             uint32 LE
//   byte  8 (4B): fileNameLength  uint32 LE  — disk stores LENGTH; offset rebuilt cumulatively
//   byte 12 (4B): offset          uint32 LE  — byte offset into container .tre
//   byte 16 (4B): length          uint32 LE  — uncompressed length
//   byte 20 (4B): compressedLength uint32 LE
const n = header.numberOfFiles;
const entries = [];
let fnOffset = 0;

for (let i = 0; i < n; i++) {
  const base = i * 24;
  const compressor      = tocBlob.readUInt8(base + 0);
  // byte 1 = unused
  const treeFileIndex   = tocBlob.readUInt16LE(base + 2);
  const crc             = tocBlob.readUInt32LE(base + 4);
  const fileNameLength  = tocBlob.readUInt32LE(base + 8);  // LENGTH, not offset
  const offset          = tocBlob.readUInt32LE(base + 12);
  const length          = tocBlob.readUInt32LE(base + 16); // uncompressed
  const compressedLength = tocBlob.readUInt32LE(base + 20);

  // Read the virtual path from the cumulative offset
  const virtualPath = nameBlock.subarray(fnOffset, fnOffset + fileNameLength).toString('latin1');
  fnOffset += fileNameLength + 1; // +1 for NUL terminator

  entries.push({ compressor, treeFileIndex, crc, offset, length, compressedLength, virtualPath });
}

console.log(`  Parsed ${entries.length} TOC entries.`);

// ─── Find candidate entries ───────────────────────────────────────────────────
// Criteria: patch_sku3_* container + zlib (compressor=2) + non-tombstone + small
const MAX_UNCOMPRESSED = 65536; // 64 KiB — small enough to commit

const candidates = entries
  .filter(e => {
    const treName = treeNames[e.treeFileIndex] ?? '';
    return treName.startsWith('patch_sku3_')
      && e.compressor === 2          // zlib only (plain-zlib v6000 payload)
      && e.length > 0                // not a tombstone (length==0 is a deletion marker)
      && e.length <= MAX_UNCOMPRESSED;
  })
  .sort((a, b) => a.length - b.length); // smallest first

if (candidates.length === 0) {
  console.error('\nERROR: No suitable candidate entries found in sku3_client.toc.');
  console.error('  Expected: patch_sku3_* container, compressor=2, length>0, length<=65536.');
  process.exit(1);
}

const chosen = candidates[0];
const containerName = treeNames[chosen.treeFileIndex] ?? '';
const containerPath = join(CLIENT_ROOT, containerName);

console.log(`\nChosen entry (smallest zlib v6000 payload):`);
console.log(`  virtualPath:       ${chosen.virtualPath}`);
console.log(`  container:         ${containerName}`);
console.log(`  offset:            ${chosen.offset}`);
console.log(`  length:            ${chosen.length}  (uncompressed)`);
console.log(`  compressedLength:  ${chosen.compressedLength}`);
console.log(`  compressor:        ${chosen.compressor}  (2 = zlib)`);
console.log(`  crc:               0x${chosen.crc.toString(16).padStart(8, '0')}`);

// ─── Bounds-check: offset + compressedLength <= file size (T-04.3-03-03) ─────
// Mirrors TreArchive T-01-02 subtraction form (prevents attacker-controlled seek).
const containerStat = statSync(containerPath);
const payloadEnd = chosen.offset + chosen.compressedLength;
if (chosen.compressedLength === 0) {
  throw new Error(`Bounds: compressedLength is 0 for entry '${chosen.virtualPath}'`);
}
if (payloadEnd > containerStat.size) {
  throw new Error(
    `Bounds violation for '${chosen.virtualPath}': ` +
    `offset(${chosen.offset}) + compressedLength(${chosen.compressedLength}) = ${payloadEnd} ` +
    `> file size(${containerStat.size}) in ${containerName}`,
  );
}

// ─── Read compressed payload from container .tre ──────────────────────────────
// The v6000 container has numberOfFiles=0 internally; payloads are accessed directly
// using the master .toc's offset/compressedLength — NOT via the container's empty TOC.
const containerBuf = readFileSync(containerPath);
const compressedBytes = containerBuf.subarray(chosen.offset, chosen.offset + chosen.compressedLength);

// ─── Inflate with node zlib (mirrors tre_reader.py::read_tre_payload) ─────────
let inflatedBytes;
try {
  inflatedBytes = inflateSync(compressedBytes);
} catch (err) {
  throw new Error(
    `zlib inflate failed for '${chosen.virtualPath}' in ${containerName}: ${err.message}\n` +
    `  First 4 bytes: ${[...compressedBytes.subarray(0, 4)].map(b => b.toString(16).padStart(2, '0')).join(' ')}`,
  );
}

// Verify inflated size matches declared length
if (inflatedBytes.length !== chosen.length) {
  throw new Error(
    `Inflated size mismatch for '${chosen.virtualPath}': ` +
    `got ${inflatedBytes.length}, declared length = ${chosen.length}`,
  );
}

console.log(`\nInflation OK: ${compressedBytes.length} bytes compressed → ${inflatedBytes.length} bytes.`);

// ─── Derive a safe fixture base name from the virtual path ────────────────────
// Replace path separators and special chars with underscores; deduplicate.
const fixtureName = chosen.virtualPath
  .replace(/[/\\]/g, '_')
  .replace(/[^a-zA-Z0-9._-]/g, '_')
  .replace(/__+/g, '_')
  .replace(/^_|_$/g, '');

// ─── Write fixture files ──────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });

const zlibPath     = join(OUT_DIR, `${fixtureName}.v6000.zlib.bin`);
const expectedPath = join(OUT_DIR, `${fixtureName}.v6000.expected.bin`);
const descPath     = join(OUT_DIR, `${fixtureName}.v6000.descriptor.json`);

writeFileSync(zlibPath,     compressedBytes);
writeFileSync(expectedPath, inflatedBytes);
writeFileSync(descPath, JSON.stringify({
  fixtureName,
  virtualPath:      chosen.virtualPath,
  container:        containerName,
  offset:           chosen.offset,
  length:           chosen.length,
  compressedLength: chosen.compressedLength,
  compressor:       chosen.compressor,
  crc:              chosen.crc,
  sourceNote:       'SWG-Source v6000 plain-zlib — NOT Restoration-encrypted',
  groundTruthOracle: '../swg-blender-plugin/swg_pipeline/tre_reader.py::read_tre_payload',
}, null, 2));

console.log(`\nFixtures written to ${OUT_DIR}/`);
console.log(`  ${fixtureName}.v6000.zlib.bin      (${compressedBytes.length} bytes compressed)`);
console.log(`  ${fixtureName}.v6000.expected.bin   (${inflatedBytes.length} bytes inflated)`);
console.log(`  ${fixtureName}.v6000.descriptor.json`);
console.log(`\nRe-running this script on the same client produces byte-identical output.`);
