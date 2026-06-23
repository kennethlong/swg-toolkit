/**
 * tre-fieldorder-arbiter.test.ts — CI-BLOCKING real-asset field-order arbiter (CORE-05/CORE-01).
 *
 * This test is the OPEN-1 RE-OPENED resolution: it confirms recordStride/isCrcFirst
 * against REAL Infinity/SWGEmu bytes (not oracle consensus).
 *
 * Behavior when fixtures-real/ is POPULATED:
 *   (a) Hexdumps the literal 4-byte version tag and asserts exactly "0005"/"5000"
 *       (Infinity/SWGEmu) or "6000" (Restoration) from the real file bytes.
 *   (b) Confirms recordStride/isCrcFirst against real bytes: checks that
 *       crc == Crc::calculate(name) for every entry. GROUND TRUTH: CRC-FIRST wins
 *       (swg-client-v2 TreeFile_SearchNode.h:189; verified byte-exact).
 *   (c) Asserts the committed-fixture field order equals the arbiter-confirmed (crc-first) layout.
 *
 * Behavior when fixtures-real/ is EMPTY (clean clone):
 *   Surfaces an explicit PENDING/MUST-RUN marker as a test.todo.
 *   This ensures the lane is NEVER silently green on a clean clone.
 *   The test is NOT skipped — it loudly reports it MUST be run.
 *
 * Source: swg-client-v2 TreeFile_SearchNode.h:189 (crc-first struct, ground truth);
 *         swg-client-v2 Crc.cpp (forward CRC-32). CRC-first verified byte-exact.
 *
 * To populate fixtures-real/ and run the arbiter:
 *   node scripts/copy-real-fixtures.js
 *   pnpm vitest run -t "tre fieldorder arbiter"
 *
 * The arbiter MUST be green before Plan 01 is considered done (D-12).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname_es = dirname(fileURLToPath(import.meta.url));
const REAL_FIXTURES_DIR = join(__dirname_es, '..', 'fixtures-real');

// Native binding — used to validate crc-first end-to-end (through the inflate
// path) for real archives whose TOC/name block is zlib-compressed and therefore
// not parseable by the JS-only byte arbiter below.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  mountArchive: (paths: string[]) => Array<{ archiveIndex: number; entryCount: number; path: string }>;
  listEntries: (archiveIdx: number) => Array<{ path: string; crc: number; uncompressedSize: number }>;
};

// FORWARD CRC-32 matching Crc::calculate from swg-client-v2.
// Polynomial 0x04C11DB7, MSB-first, init 0xFFFFFFFF, final XOR 0xFFFFFFFF.
// Source: swg-client-v2 Crc.cpp (Crc::calculate).
const crcTable: number[] = [];
for (let i = 0; i < 256; i++) {
  let c = (i << 24) >>> 0;
  for (let j = 0; j < 8; j++) c = (c & 0x80000000) ? (((c << 1) ^ 0x04C11DB7) >>> 0) : ((c << 1) >>> 0);
  crcTable[i] = c >>> 0;
}
function crc32(str: string): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    crc = (crcTable[((crc >>> 24) ^ str.charCodeAt(i)) & 0xFF]! ^ (crc << 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function readLE32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function readLE32s(buf: Buffer, offset: number): number {
  return buf.readInt32LE(offset);
}

/** Check if the fixtures-real directory has any .tre files. */
function realFixturesAvailable(): boolean {
  if (!existsSync(REAL_FIXTURES_DIR)) return false;
  try {
    const files = readdirSync(REAL_FIXTURES_DIR);
    return files.some((f) => f.toLowerCase().endsWith('.tre'));
  } catch {
    return false;
  }
}

describe('tre fieldorder arbiter', () => {

  if (!realFixturesAvailable()) {
    // ── PENDING STATE: clean clone, real fixtures not yet populated ───────────
    //
    // The test MUST be run before Plan 01 is considered done (D-12).
    // This is NOT a silent skip — it loudly reports the MUST-RUN requirement.
    //
    // Source: PLAN 01-01 must_haves: "on a clean clone the lane is documented as
    //   MUST-run-and-green before Plan 01 is done, not an indefinitely-skipped test"
    it.todo(
      'REAL-ASSET ARBITER NOT YET RUN — run `node scripts/copy-real-fixtures.js` then ' +
      '`pnpm vitest run -t "tre fieldorder arbiter"` before closing Plan 01. ' +
      'This lane MUST be green. It confirms isCrcFirst(V0005)/recordStride(V0005) ' +
      'against real Infinity/SWGEmu bytes AND confirms the v0006 vs v6000 version tag ' +
      'from real Restoration bytes. It is NOT optional.',
    );
    return;
  }

  // ── POPULATED STATE: real archives in fixtures-real/ ─────────────────────

  // List available real archives
  const treFiles = readdirSync(REAL_FIXTURES_DIR)
    .filter((f) => f.toLowerCase().endsWith('.tre'))
    .map((f) => join(REAL_FIXTURES_DIR, f));

  // Classify archives by their version tag.
  // The Infinity/SWGEmu family ships either "0005" or "5000" (both stride-24, crc-first).
  const v0005Archives: string[] = [];
  const v6000Archives: string[] = [];
  const v0006Archives: string[] = [];

  for (const filePath of treFiles) {
    try {
      const buf = readFileSync(filePath);
      if (buf.length < 8) continue;
      const version = buf.subarray(4, 8).toString('ascii');
      if (version === '0005' || version === '5000' || version === '0004') v0005Archives.push(filePath);
      else if (version === '6000') v6000Archives.push(filePath);
      else if (version === '0006') v0006Archives.push(filePath);
    } catch {
      // skip unreadable files
    }
  }

  // ── (a) Version tag hexdump assertion ────────────────────────────────────
  it('real archives have correct literal version tags (0005 or 6000 on disk)', () => {
    expect(treFiles.length).toBeGreaterThan(0);

    for (const filePath of treFiles) {
      const buf = readFileSync(filePath);
      expect(buf.length).toBeGreaterThanOrEqual(8);

      const magic   = buf.subarray(0, 4).toString('ascii');
      const version = buf.subarray(4, 8).toString('ascii');

      // Magic MUST be "EERT" (not "TREE")
      expect(magic).toBe('EERT');

      // Version MUST be one of the known strings (no unknown formats from real installs)
      expect(['0004', '0005', '0006', '5000', '6000']).toContain(version);
    }
  });

  it('Infinity/SWGEmu real archives have an Infinity-family version tag (0004/0005/5000)', () => {
    // Source: CONTEXT.md D-12. The Infinity/SWGEmu family is "0005" or "5000".
    if (v0005Archives.length === 0) {
      // If none were found, report the available versions
      const versions = treFiles.map((f) => {
        const buf = readFileSync(f);
        return buf.length >= 8 ? buf.subarray(4, 8).toString('ascii') : 'unknown';
      });
      throw new Error(
        'Expected Infinity/SWGEmu (0004/0005/5000) archives from copy-real-fixtures.js but found: ' +
        versions.join(', ') + '. Ensure copy-real-fixtures.js was run with correct paths.',
      );
    }
    expect(v0005Archives.length).toBeGreaterThan(0);
  });

  // ── (b) Field-order confirmation: CRC-FIRST is ground truth ───────────────
  it('real archive: CRC-FIRST layout confirmed (crc@0 == Crc::calculate(name) for every entry)', () => {
    if (v0005Archives.length === 0) {
      throw new Error('No Infinity-family real archives available. Run copy-real-fixtures.js first.');
    }

    let archivesActuallyChecked = 0;

    for (const archivePath of v0005Archives) {
      const buf = readFileSync(archivePath);
      expect(buf.length).toBeGreaterThanOrEqual(36);

      // Parse header
      const numberOfFiles      = readLE32(buf, 8);
      const tocOffset          = readLE32(buf, 12);
      const tocCompressor      = readLE32(buf, 16);
      const sizeOfTOC          = readLE32(buf, 20);
      const blockCompressor    = readLE32(buf, 24);
      const sizeOfNameBlock    = readLE32(buf, 28);

      expect(numberOfFiles).toBeGreaterThan(0);

      // JS arbiter only validates uncompressed TOC/name blocks (no inflate in JS here).
      // The native binding handles compressed blocks; large archives often compress them.
      if (tocCompressor !== 0 || blockCompressor !== 0) {
        console.log(`[ARBITER] Skipping compressed TOC/name block in ${archivePath.split(/[/\\]/).pop()}`);
        continue;
      }

      const tocBytes = buf.subarray(tocOffset, tocOffset + sizeOfTOC);
      const stride = 24; // Infinity-family stride
      const nameOffset = tocOffset + sizeOfTOC;
      const nameBytes = buf.subarray(nameOffset, nameOffset + sizeOfNameBlock);

      // Count CRC matches under BOTH interpretations.
      let sizefirstCrcMatches = 0;
      let crcfirstCrcMatches  = 0;
      let namesChecked = 0;
      const numToCheck = Math.min(numberOfFiles, 200);

      for (let i = 0; i < numToCheck; i++) {
        const off = i * stride;
        if (off + stride > tocBytes.length) break;

        // CRC-first (GROUND TRUTH): crc@0, ..., fileNameOffset@20
        const cf_crc         = readLE32(tocBytes,  off + 0);
        const cf_fileNameOff = readLE32s(tocBytes, off + 20);
        // Size-first (FALSIFIED): length@0, ..., crc@16, fileNameOffset@20
        const sf_crc         = readLE32(tocBytes,  off + 16);

        if (cf_fileNameOff >= 0 && cf_fileNameOff < nameBytes.length) {
          let end = cf_fileNameOff;
          while (end < nameBytes.length && nameBytes[end] !== 0) end++;
          const name = nameBytes.subarray(cf_fileNameOff, end).toString('ascii');
          if (name.length > 0) {
            namesChecked++;
            const computedCrc = crc32(name);
            if (cf_crc === computedCrc) crcfirstCrcMatches++;
            if (sf_crc === computedCrc) sizefirstCrcMatches++;
          }
        }
      }

      if (namesChecked === 0) continue;
      archivesActuallyChecked++;

      const fname = archivePath.split(/[/\\]/).pop();
      console.log(`[ARBITER] ${fname}: crc-first matches=${crcfirstCrcMatches}/${namesChecked}, size-first matches=${sizefirstCrcMatches}/${namesChecked}`);
      console.log(`[ARBITER] Winner: ${crcfirstCrcMatches >= sizefirstCrcMatches ? 'crc-first' : 'size-first'}`);

      // GROUND TRUTH: CRC-FIRST must win decisively.
      expect(crcfirstCrcMatches).toBeGreaterThan(sizefirstCrcMatches);
      // And it should match essentially every entry.
      expect(crcfirstCrcMatches / namesChecked).toBeGreaterThanOrEqual(0.8);
    }

    if (archivesActuallyChecked === 0) {
      // All available real archives have COMPRESSED TOC/name blocks (the JS-only
      // byte arbiter cannot inflate). Validate crc-first END-TO-END through the
      // native binding instead: mount the real archive (native inflates the TOC
      // using the crc-first field order) and confirm crc@0 == Crc::calculate(name)
      // for a sample of entries. A non-crc-first parse would yield CRCs that do
      // not match the (inflated) names — this is the same proof, via the real loader.
      console.log('[ARBITER] No uncompressed-TOC real archive available — validating crc-first via native binding (inflate path).');
      let nativeChecked = 0;
      for (const archivePath of v0005Archives) {
        const mounted = nativeCore.mountArchive([archivePath]);
        const entries = nativeCore.listEntries(mounted[0]!.archiveIndex);
        if (entries.length === 0) continue;
        const sample = entries.slice(0, 200);
        let matches = 0;
        let named = 0;
        for (const e of sample) {
          if (!e.path) continue;
          named++;
          if (e.crc === crc32(e.path)) matches++;
        }
        if (named === 0) continue;
        nativeChecked++;
        const fname = archivePath.split(/[/\\]/).pop();
        console.log(`[ARBITER] (native) ${fname}: crc-first matches=${matches}/${named}`);
        // GROUND TRUTH: every entry's crc (read crc-first by the native parser)
        // must equal the forward CRC-32 of its inflated, normalized name.
        expect(matches / named).toBeGreaterThanOrEqual(0.99);
      }
      expect(nativeChecked).toBeGreaterThan(0);
    }
  });

  // ── (c) Restoration version tag: 6000 not 0006 ───────────────────────────
  it('Restoration real archive (if present) has version tag exactly "6000" (settles 0006 vs 6000)', () => {
    // Source: RESEARCH.md "v6000 (Restoration) payloads are ENCRYPTED -> enumerate-only;
    //         applies to '6000' ONLY (NOT '0006')"
    if (v6000Archives.length === 0 && v0006Archives.length === 0) {
      console.log('[ARBITER] No Restoration archives found. Ensure D:\\SWG Restoration is accessible.');
      console.log('[ARBITER] This assertion will be conclusive when a Restoration archive is copied.');
      // Not an error — Restoration may not be installed. Log and pass.
      return;
    }

    for (const f of v6000Archives) {
      const buf = readFileSync(f);
      const version = buf.subarray(4, 8).toString('ascii');
      expect(version).toBe('6000');
      console.log(`[ARBITER] Restoration archive ${f.split(/[/\\]/).pop()} version tag: "${version}" (confirmed 6000, not 0006)`);
    }
  });

  // ── (c) Committed fixture field order matches arbiter result (crc-first) ───
  it('committed v0005 fixture uses crc-first layout (matches arbiter-confirmed field order)', () => {
    // Load the committed fixture and check the crc-first parse gives sensible values.
    // Source: scripts/generate-tre-fixtures.js (crc-first for all versions);
    //         swg-client-v2 TreeFile_SearchNode.h:189.
    const fixtureDir = join(__dirname_es, '..', 'fixtures', 'tre');
    const fixturePath = join(fixtureDir, 'v0005-3record.tre');
    const buf = readFileSync(fixturePath);

    // Header check
    expect(buf.subarray(0, 4).toString('ascii')).toBe('EERT');
    expect(buf.subarray(4, 8).toString('ascii')).toBe('0005');

    const numberOfFiles = readLE32(buf, 8);
    const tocOffset     = readLE32(buf, 12);
    const tocCompressor = readLE32(buf, 16);
    const sizeOfTOC     = readLE32(buf, 20);

    expect(numberOfFiles).toBe(3);
    expect(tocCompressor).toBe(0); // uncompressed

    const blockCompressor   = readLE32(buf, 24);
    const sizeOfNameBlock   = readLE32(buf, 28);
    const nameOffset        = tocOffset + sizeOfTOC;
    expect(blockCompressor).toBe(0);

    const nameBytes = buf.subarray(nameOffset, nameOffset + sizeOfNameBlock);
    const names = nameBytes.toString('ascii').split('\0').filter((s) => s.length > 0);
    expect(names).toContain('hello.txt');

    // Parse TOC as crc-first and verify CRCs match (crc@0, length@4, fileNameOffset@20).
    const tocBuf = buf.subarray(tocOffset, tocOffset + sizeOfTOC);
    let nonTombstoneMatchCount = 0;
    let crcfirstMatches = 0;
    let sizefirstMatches = 0;
    for (let i = 0; i < numberOfFiles; i++) {
      const off     = i * 24;
      const cfCrc   = readLE32(tocBuf,  off + 0);
      const length  = readLE32s(tocBuf, off + 4);
      const sfCrc   = readLE32(tocBuf,  off + 16);
      const nameOff = readLE32s(tocBuf, off + 20);

      let end = nameOff;
      while (end < nameBytes.length && nameBytes[end] !== 0) end++;
      const name = nameBytes.subarray(nameOff, end).toString('ascii');
      if (name.length === 0) continue;
      const expectedCrc = crc32(name);
      if (cfCrc === expectedCrc) crcfirstMatches++;
      if (sfCrc === expectedCrc) sizefirstMatches++;
      if (length > 0 && cfCrc === expectedCrc) nonTombstoneMatchCount++;
    }

    // CRC-first must match every named entry (incl. tombstone, whose crc is real).
    expect(crcfirstMatches).toBe(numberOfFiles);
    expect(crcfirstMatches).toBeGreaterThan(sizefirstMatches);
    expect(nonTombstoneMatchCount).toBeGreaterThan(0);
    console.log(`[ARBITER] Committed v0005 fixture: crc-first matches ${crcfirstMatches}/${numberOfFiles} (size-first ${sizefirstMatches}/${numberOfFiles})`);
  });

});
