'use strict';
/**
 * scripts/generate-tre-fixtures.js — Generate TRE harness fixtures from Utinni synth byte recipes.
 *
 * Regenerates committed .tre fixture files for packages/harness/fixtures/tre/.
 * These are synthesized (NOT copied from Utinni .expected.json goldens) per Decision D-09.
 * Each fixture's byte layout is documented with its source citation.
 *
 * Source citations (per standing gate D-03):
 *   - Utinni TreFile.cs:302-310 (size-first TOC for v0004/v0005/v0006/v5000)
 *   - Utinni TreFile.cs:284-298 (crc-first TOC for v6000, 32-byte stride)
 *   - Utinni TreVersion.cs:79-86 (IsEnumerateOnly => V6000 only)
 *   - swg-client-v2 TreeFile_SearchNode.cpp:397-401 (tombstone length==0)
 *   - swg-client-v2 TreeFile_SearchNode.cpp:382 (CRC collision tie-break)
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const FIXTURE_DIR = path.join(__dirname, '..', 'packages', 'harness', 'fixtures', 'tre');
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

// ── CRC-32 table (Crc::calculate equivalent) ─────────────────────────────────
// Source: swg-client-v2 TreeFile_SearchNode.cpp:364
const crcTable = [];
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c;
}
function crc32(str) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── LE uint32 write helpers ───────────────────────────────────────────────────
function writeLE32(buf, offset, val) {
  const v = (val >>> 0);
  buf[offset]   = (v & 0xFF);
  buf[offset+1] = (v >>> 8)  & 0xFF;
  buf[offset+2] = (v >>> 16) & 0xFF;
  buf[offset+3] = (v >>> 24) & 0xFF;
}

// ── Build 36-byte TRE header ──────────────────────────────────────────────────
function buildHeader(version, numberOfFiles, tocOffset, tocCompressor, sizeOfTOC, blockCompressor, sizeOfNameBlock, uncompSizeOfNameBlock) {
  const hdr = Buffer.alloc(36);
  hdr.write('EERT', 0, 'ascii');
  hdr.write(version, 4, 'ascii');
  writeLE32(hdr, 8,  numberOfFiles);
  writeLE32(hdr, 12, tocOffset);
  writeLE32(hdr, 16, tocCompressor);
  writeLE32(hdr, 20, sizeOfTOC);
  writeLE32(hdr, 24, blockCompressor);
  writeLE32(hdr, 28, sizeOfNameBlock);
  writeLE32(hdr, 32, uncompSizeOfNameBlock);
  return hdr;
}

// ── v0005-3record.tre ─────────────────────────────────────────────────────────
// 3 entries: hello.txt (stored), quick.txt (raw-deflate/code-1), empty.bin (tombstone)
// Size-first layout per Utinni TreFile.cs:302-310 and fixture analysis.
// Source: Utinni TreFile.cs:302-310; swg-client-v2 TreeFile_SearchNode.cpp:397-401 (tombstone)
function buildV0005() {
  const helloContent = Buffer.from('Hello, World!');
  const quickContent = Buffer.from('The quick brown fox jumps over the lazy dog');
  const quickDeflated = zlib.deflateRawSync(quickContent); // code=1, raw deflate

  const nameBlock = Buffer.from('hello.txt\0quick.txt\0empty.bin\0');

  const payload0_off = 36;
  const payload1_off = payload0_off + helloContent.length;
  const payload2_off = payload1_off + quickDeflated.length;

  const tocOff = payload2_off;
  const tocSize = 72; // 3 records * 24 bytes

  const entries = [
    { name: 'hello.txt', nameOff: 0,  crc: crc32('hello.txt'), length: helloContent.length, offset: payload0_off, compressor: 0, compressedLength: helloContent.length },
    { name: 'quick.txt', nameOff: 10, crc: crc32('quick.txt'), length: quickContent.length,  offset: payload1_off, compressor: 1, compressedLength: quickDeflated.length },
    { name: 'empty.bin', nameOff: 20, crc: crc32('empty.bin'), length: 0,                    offset: payload2_off, compressor: 0, compressedLength: 0 }, // tombstone
  ].sort((a, b) => (a.crc < b.crc ? -1 : a.crc > b.crc ? 1 : a.name.localeCompare(b.name, undefined, {sensitivity: 'base'})));

  // Write size-first TOC: (length, offset, compressor, compressedLength, crc, fileNameOffset)
  const tocBuf = Buffer.alloc(tocSize);
  entries.forEach((e, i) => {
    const o = i * 24;
    writeLE32(tocBuf, o+0,  e.length);
    writeLE32(tocBuf, o+4,  e.offset);
    writeLE32(tocBuf, o+8,  e.compressor);
    writeLE32(tocBuf, o+12, e.compressedLength);
    writeLE32(tocBuf, o+16, e.crc);
    writeLE32(tocBuf, o+20, e.nameOff);
  });

  const header = buildHeader('0005', 3, tocOff, 0, tocSize, 0, nameBlock.length, nameBlock.length);
  return Buffer.concat([header, helloContent, quickDeflated, tocBuf, nameBlock]);
}

// ── v0006-2record.tre ────────────────────────────────────────────────────────
// Readable v0006 archive (NOT enumerate-only, NOT encrypted).
// Size-first, 24-byte stride per Utinni TreVersion.cs:92-97 (IsCrcFirst => false for V0006).
// Source: Utinni TreFile.cs:302-310; TreVersion.cs:92-97.
function buildV0006() {
  const f1 = Buffer.from('file1.iff content here');
  const f2 = Buffer.from('second file content');
  const nameBlock = Buffer.from('file1.iff\0file2.iff\0');

  const payload0_off = 36;
  const payload1_off = payload0_off + f1.length;
  const tocOff = payload1_off + f2.length;
  const tocSize = 48;

  const entries = [
    { name: 'file1.iff', nameOff: 0,  crc: crc32('file1.iff'), length: f1.length, offset: payload0_off, compressor: 0, compressedLength: f1.length },
    { name: 'file2.iff', nameOff: 10, crc: crc32('file2.iff'), length: f2.length, offset: payload1_off, compressor: 0, compressedLength: f2.length },
  ].sort((a, b) => (a.crc < b.crc ? -1 : a.crc > b.crc ? 1 : 0));

  const tocBuf = Buffer.alloc(tocSize);
  entries.forEach((e, i) => {
    const o = i * 24;
    writeLE32(tocBuf, o+0,  e.length);
    writeLE32(tocBuf, o+4,  e.offset);
    writeLE32(tocBuf, o+8,  e.compressor);
    writeLE32(tocBuf, o+12, e.compressedLength);
    writeLE32(tocBuf, o+16, e.crc);
    writeLE32(tocBuf, o+20, e.nameOff);
  });

  const header = buildHeader('0006', 2, tocOff, 0, tocSize, 0, nameBlock.length, nameBlock.length);
  return Buffer.concat([header, f1, f2, tocBuf, nameBlock]);
}

// ── v6000-2record.tre ─────────────────────────────────────────────────────────
// Enumerate-only archive (payloads are 'encrypted' — never read).
// CRC-first, 32-byte stride per Utinni TreVersion.cs:92-105.
// Source: Utinni TreFile.cs:284-298; TreVersion.cs:79-86, 92-105.
function buildV6000() {
  const enc1 = Buffer.from('v6000-payload-alpha');
  const enc2 = Buffer.from('v6000-payload-beta');
  const nameBlock = Buffer.from('alpha.iff\0beta.iff\0');

  const payload0_off = 36;
  const payload1_off = payload0_off + enc1.length;

  // CRC-first TOC: (crc, length, offset, compressor, compressedLength, fileNameOffset, pad, pad)
  const rawToc = Buffer.alloc(64); // 2 * 32 bytes
  writeLE32(rawToc, 0,  0x11111111); // crc (fixed for enumerate-only)
  writeLE32(rawToc, 4,  enc1.length);
  writeLE32(rawToc, 8,  payload0_off);
  writeLE32(rawToc, 12, 0);
  writeLE32(rawToc, 16, enc1.length);
  writeLE32(rawToc, 20, 0); // nameOff for 'alpha.iff'
  writeLE32(rawToc, 24, 0); // pad
  writeLE32(rawToc, 28, 0); // pad

  writeLE32(rawToc, 32, 0x22222222);
  writeLE32(rawToc, 36, enc2.length);
  writeLE32(rawToc, 40, payload1_off);
  writeLE32(rawToc, 44, 0);
  writeLE32(rawToc, 48, enc2.length);
  writeLE32(rawToc, 52, 10); // nameOff for 'beta.iff' in 'alpha.iff\0beta.iff\0'
  writeLE32(rawToc, 56, 0);
  writeLE32(rawToc, 60, 0);

  // Compress TOC and name block with zlib
  const compToc   = zlib.deflateSync(rawToc);
  const compNames = zlib.deflateSync(nameBlock);

  const tocOff  = payload0_off + enc1.length + enc2.length;
  const nameOff = tocOff + compToc.length;

  const header = buildHeader('6000', 2, tocOff, 2, compToc.length, 2, compNames.length, nameBlock.length);
  return Buffer.concat([header, enc1, enc2, compToc, compNames]);
}

// ── malformed-magic.tre ───────────────────────────────────────────────────────
// Source: Utinni TreFile.cs:155-156 (magic check 'E','E','R','T')
function buildMalformedMagic() {
  const buf = Buffer.alloc(36);
  buf.write('TREE', 0, 'ascii'); // Wrong magic (forward, not reversed)
  buf.write('0005', 4, 'ascii');
  return buf;
}

// ── truncated.tre ─────────────────────────────────────────────────────────────
function buildTruncated() {
  return Buffer.from([0x45, 0x45, 0x52, 0x54, 0x30, 0x30, 0x30, 0x35, 0x02, 0x00]); // 10 bytes
}

// ── unsupported-version.tre ───────────────────────────────────────────────────
// Source: Utinni TreVersion.cs:60-73 (parseVersionString throws on unknown version)
function buildUnsupportedVersion() {
  const buf = Buffer.alloc(36);
  buf.write('EERT', 0, 'ascii');
  buf.write('9999', 4, 'ascii'); // Unknown version string
  return buf;
}

// ── malformed-bad-adler.tre ───────────────────────────────────────────────────
// A v0005 archive with a zlib-compressed TOC whose Adler32 is corrupted.
// Tests T-01-04: bad Adler triggers inflate failure, not process crash.
// Source: Utinni TreFile.cs:660-679 (inflate failure detection)
function buildBadAdler() {
  const payload = Buffer.from('hello');
  const nameBlock = Buffer.from('file.txt\0');

  const rawToc = Buffer.alloc(24);
  writeLE32(rawToc, 0,  5);
  writeLE32(rawToc, 4,  36 + payload.length);
  writeLE32(rawToc, 8,  2);
  writeLE32(rawToc, 12, 5);
  writeLE32(rawToc, 16, crc32('file.txt'));
  writeLE32(rawToc, 20, 0);

  // Wrap with zlib framing (code 2), then corrupt the Adler32 trailer
  const compressedToc = zlib.deflateSync(rawToc);
  // The Adler32 is NOT in deflate raw but in our Zlib.cpp we strip the 2-byte header
  // and 4-byte trailer for code 2. Here the TOC is code 2 (zlib-framed).
  // Actually for TOC compression, tocCompressor=2 means zlib framed; Zlib.cpp strips header/trailer.
  // To corrupt, flip last 2 bytes of the full block (these will be part of the Adler32 trailer
  // but we are giving inflate raw deflate so it'll fail because the block is malformed).
  const badToc = Buffer.from(compressedToc);
  // Actually compressedToc from deflateSync IS a full RFC1950 stream (with header+Adler).
  // Our Zlib.cpp code 2 strips the 2-byte CMF+FLG header and 4-byte Adler.
  // Let's corrupt the Adler bytes (last 4 bytes of the RFC1950 block).
  badToc[badToc.length-1] ^= 0xFF;
  badToc[badToc.length-2] ^= 0xFF;

  const tocOff = 36 + payload.length;
  const header = buildHeader('0005', 1, tocOff, 2, badToc.length, 0, nameBlock.length, nameBlock.length);
  return Buffer.concat([header, payload, badToc, nameBlock]);
}

// ── crc-collision.tre ─────────────────────────────────────────────────────────
// Two entries where we carefully place them to test the CRC-collision-safe scan.
// In practice true CRC collisions are rare; for testing we use two real entries
// where the CRC sort + name tie-break must work correctly.
// Source: swg-client-v2 TreeFile_SearchNode.cpp:382 (T-01-19)
function buildCrcCollision() {
  const f1 = Buffer.from('content-aaa');
  const f2 = Buffer.from('content-bbb');
  const nameBlock = Buffer.from('aaa.txt\0bbb.txt\0');

  const payload0_off = 36;
  const payload1_off = payload0_off + f1.length;
  const tocOff = payload1_off + f2.length;
  const tocSize = 48;

  const entries = [
    { name: 'aaa.txt', nameOff: 0, crc: crc32('aaa.txt'), length: f1.length, offset: payload0_off, compressor: 0, compressedLength: f1.length },
    { name: 'bbb.txt', nameOff: 8, crc: crc32('bbb.txt'), length: f2.length, offset: payload1_off, compressor: 0, compressedLength: f2.length },
  ].sort((a, b) => (a.crc < b.crc ? -1 : a.crc > b.crc ? 1 : a.name.localeCompare(b.name, undefined, {sensitivity: 'base'})));

  const tocBuf = Buffer.alloc(tocSize);
  entries.forEach((e, i) => {
    const o = i * 24;
    writeLE32(tocBuf, o+0,  e.length);
    writeLE32(tocBuf, o+4,  e.offset);
    writeLE32(tocBuf, o+8,  e.compressor);
    writeLE32(tocBuf, o+12, e.compressedLength);
    writeLE32(tocBuf, o+16, e.crc);
    writeLE32(tocBuf, o+20, e.nameOff);
  });

  const header = buildHeader('0005', 2, tocOff, 0, tocSize, 0, nameBlock.length, nameBlock.length);
  return Buffer.concat([header, f1, f2, tocBuf, nameBlock]);
}

// ── Write all fixtures ────────────────────────────────────────────────────────
const fixtures = {
  'v0005-3record.tre':        buildV0005(),
  'v0006-2record.tre':        buildV0006(),
  'v6000-2record.tre':        buildV6000(),
  'malformed-magic.tre':      buildMalformedMagic(),
  'truncated.tre':             buildTruncated(),
  'unsupported-version.tre':  buildUnsupportedVersion(),
  'malformed-bad-adler.tre':  buildBadAdler(),
  'crc-collision.tre':        buildCrcCollision(),
};

for (const [name, bytes] of Object.entries(fixtures)) {
  const outPath = path.join(FIXTURE_DIR, name);
  fs.writeFileSync(outPath, bytes);
  console.log('[OK]', name, '(' + bytes.length + ' bytes)');
}
console.log('\nAll', Object.keys(fixtures).length, 'fixtures written to', FIXTURE_DIR);
