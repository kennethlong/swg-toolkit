'use strict';
/**
 * scripts/generate-tre-fixtures.js — Generate TRE harness fixtures.
 *
 * Regenerates committed .tre fixture files for packages/harness/fixtures/tre/.
 * These are synthesized per Decision D-09. Each fixture's byte layout is
 * documented with its source citation.
 *
 * GROUND TRUTH (verified byte-exact against real archives — bottom.tre "5000",
 * SwgRestoration_00.tre "6000"):
 *   - The on-disk TOC record is CRC-FIRST for ALL versions:
 *       crc@0, length@4, offset@8, compressor@12, compressedLength@16, fileNameOffset@20
 *       (V6000 adds 8 bytes of padding → stride 32; all others stride 24).
 *     Source: swg-client-v2 .../sharedFile/src/shared/TreeFile_SearchNode.h:189.
 *   - The CRC is the FORWARD (MSB-first) CRC-32: polynomial 0x04C11DB7,
 *     init 0xFFFFFFFF, final XOR 0xFFFFFFFF, over the lowercased name.
 *     Source: swg-client-v2 .../sharedFile/src/shared/Crc.cpp Crc::calculate.
 *   - swg-client-v2 TreeFile_SearchNode.cpp:397-401 (tombstone length==0).
 *   - Utinni TreVersion.cs:79-86 (IsEnumerateOnly => V6000 only).
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const FIXTURE_DIR = path.join(__dirname, '..', 'packages', 'harness', 'fixtures', 'tre');
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

// ── FORWARD CRC-32 (Crc::calculate equivalent) ───────────────────────────────
// Polynomial 0x04C11DB7, MSB-first. Source: swg-client-v2 Crc.cpp.
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = (i << 24) >>> 0;
  for (let j = 0; j < 8; j++) {
    c = (c & 0x80000000) ? (((c << 1) ^ 0x04C11DB7) >>> 0) : ((c << 1) >>> 0);
  }
  crcTable[i] = c >>> 0;
}
function crc32(str) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    crc = (crcTable[((crc >>> 24) ^ (str.charCodeAt(i) & 0xFF)) & 0xFF] ^ (crc << 8)) >>> 0;
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

// ── Write one CRC-FIRST TOC record at offset `o` ──────────────────────────────
// crc@0, length@4, offset@8, compressor@12, compressedLength@16, fileNameOffset@20.
// Source: swg-client-v2 TreeFile_SearchNode.h:189.
function writeCrcFirstRecord(buf, o, e) {
  writeLE32(buf, o+0,  e.crc);
  writeLE32(buf, o+4,  e.length);
  writeLE32(buf, o+8,  e.offset);
  writeLE32(buf, o+12, e.compressor);
  writeLE32(buf, o+16, e.compressedLength);
  writeLE32(buf, o+20, e.nameOff);
}

// Sort comparator: ascending by crc, name tie-break (binary-search precondition).
function byCrcThenName(a, b) {
  if (a.crc < b.crc) return -1;
  if (a.crc > b.crc) return 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
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
// CRC-first layout (24-byte stride). Source: TreeFile_SearchNode.h:189.
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
  ].sort(byCrcThenName);

  const tocBuf = Buffer.alloc(tocSize);
  entries.forEach((e, i) => writeCrcFirstRecord(tocBuf, i * 24, e));

  const header = buildHeader('0005', 3, tocOff, 0, tocSize, 0, nameBlock.length, nameBlock.length);
  return Buffer.concat([header, helloContent, quickDeflated, tocBuf, nameBlock]);
}

// ── v0006-2record.tre ────────────────────────────────────────────────────────
// Readable v0006 archive (NOT enumerate-only, NOT encrypted). CRC-first, 24-byte stride.
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
  ].sort(byCrcThenName);

  const tocBuf = Buffer.alloc(tocSize);
  entries.forEach((e, i) => writeCrcFirstRecord(tocBuf, i * 24, e));

  const header = buildHeader('0006', 2, tocOff, 0, tocSize, 0, nameBlock.length, nameBlock.length);
  return Buffer.concat([header, f1, f2, tocBuf, nameBlock]);
}

// ── v6000-2record.tre ─────────────────────────────────────────────────────────
// Enumerate-only archive (payloads are 'encrypted' — never read).
// CRC-first, 32-byte stride (+8 pad). Source: TreeFile_SearchNode.h:189; TreVersion.cs:79-86.
function buildV6000() {
  const enc1 = Buffer.from('v6000-payload-alpha');
  const enc2 = Buffer.from('v6000-payload-beta');
  const nameBlock = Buffer.from('alpha.iff\0beta.iff\0');

  const payload0_off = 36;
  const payload1_off = payload0_off + enc1.length;

  // CRC-first TOC, 32-byte stride. crc values fixed (enumerate-only — payload never read).
  const rawToc = Buffer.alloc(64); // 2 * 32 bytes
  writeLE32(rawToc, 0,  0x11111111); // crc
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
// Source: parseVersionString throws on unknown version
function buildUnsupportedVersion() {
  const buf = Buffer.alloc(36);
  buf.write('EERT', 0, 'ascii');
  buf.write('9999', 4, 'ascii'); // Unknown version string
  return buf;
}

// ── malformed-bad-adler.tre ───────────────────────────────────────────────────
// A v0005 archive with a zlib-compressed TOC whose Adler32 is corrupted.
// Tests T-01-04: bad Adler triggers inflate failure, not process crash.
function buildBadAdler() {
  const payload = Buffer.from('hello');
  const nameBlock = Buffer.from('file.txt\0');

  // CRC-first record (24 bytes).
  const rawToc = Buffer.alloc(24);
  writeCrcFirstRecord(rawToc, 0, {
    crc: crc32('file.txt'),
    length: payload.length,
    offset: 36 + payload.length,
    compressor: 2,
    compressedLength: payload.length,
    nameOff: 0,
  });

  // Wrap with zlib framing (code 2), then corrupt the Adler32 trailer.
  const compressedToc = zlib.deflateSync(rawToc);
  const badToc = Buffer.from(compressedToc);
  badToc[badToc.length-1] ^= 0xFF;
  badToc[badToc.length-2] ^= 0xFF;

  const tocOff = 36 + payload.length;
  const header = buildHeader('0005', 1, tocOff, 2, badToc.length, 0, nameBlock.length, nameBlock.length);
  return Buffer.concat([header, payload, badToc, nameBlock]);
}

// ── crc-collision.tre ─────────────────────────────────────────────────────────
// Two entries to test the CRC-sort + name tie-break scan. CRC-first layout.
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
  ].sort(byCrcThenName);

  const tocBuf = Buffer.alloc(tocSize);
  entries.forEach((e, i) => writeCrcFirstRecord(tocBuf, i * 24, e));

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
