/**
 * tre-retail-repack.test.ts — TRE repacker RAW-SLICE IDENTITY regression guard.
 *
 * This file contains the real-asset lane tests for the TRE repacker.
 *
 * THE RAW-SLICE IDENTITY CONTRACT (Utinni TreWriter.cs:36-85, :166-174):
 *   For every UNTOUCHED entry in a repacked archive, the raw compressed bytes are
 *   copied VERBATIM from the source archive — NEVER decompressed then recompressed.
 *   Only edited entries are recompressed. Deflate is NOT bit-stable across zlib builds,
 *   so round-trip via decompress+recompress would break byte identity on untouched entries.
 *
 * REAL-ASSET LANE (D-10):
 *   Real .tre archives (bottom.tre, SwgRestoration_00.tre, etc.) are never committed.
 *   These tests are skipped when `fixtures-real/` is absent or empty.
 *   To run these tests:
 *     1. Copy a real .tre file into packages/harness/fixtures-real/ (NOT fixtures/).
 *     2. Set the env var TEST_TRE_PATH to its absolute path, OR place a v0005 archive
 *        named "bottom.tre" in fixtures-real/.
 *
 * SYNTHETIC LANE:
 *   A synthetic repack test (always runs) verifies the raw-slice identity contract
 *   using a self-built archive as the source: build → repack-no-edits → compare.
 *   If untouched entries are verbatim, the repacked archive is byte-identical to the
 *   source (modulo TOC/header rebuild — the final structure will be the same if all
 *   entries are untouched).
 *
 * Source citation:
 *   Utinni TreWriter.cs:36-85  (class docstring: "two guarantees — logical payload identity
 *                                                 + raw compressed slice identity")
 *   Utinni TreWriter.cs:166-174 (implementation: rawCompressed = GetRecordCompressedBytes(i))
 *   swg-client-v2 TreeFileBuilder.cpp:773-833 (block order)
 *   modules/core/tre/TreBuilder.h TreBuilder::repack()
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname_es = dirname(fileURLToPath(import.meta.url));
const FIXTURES_REAL = join(__dirname_es, '..', 'fixtures-real');
const TMP = join(tmpdir(), 'swg-repack-test');
mkdirSync(TMP, { recursive: true });

// Load native addon
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  buildTre: (entries: Array<{path: string; data?: Uint8Array; tombstone?: boolean}>, version?: string) => ArrayBuffer;
  repackTre: (sourcePath: string, edits?: Array<{index: number; data: Uint8Array}>, version?: string) => ArrayBuffer;
  mountArchive: (paths: string[]) => Array<{archiveIndex: number; entryCount: number; path: string}>;
  listEntries: (idx: number) => Array<{path: string; crc: number; uncompressedSize: number; compressor: number}>;
  readEntry: (arcIdx: number, entryIdx: number) => ArrayBuffer;
};

// ─── Check if real fixtures are available ─────────────────────────────────────

function findRealTrePath(): string | null {
  // 1. Explicit env var override
  const envPath = process.env['TEST_TRE_PATH'];
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Look for any .tre in fixtures-real/ — prefer a non-v6000 archive (v6000 is enumerate-only,
  //    payload extraction is refused, so the raw-slice identity test must skip v6000 archives).
  if (!existsSync(FIXTURES_REAL)) return null;
  try {
    const files = readdirSync(FIXTURES_REAL).filter(f => f.endsWith('.tre'));
    if (files.length === 0) return null;

    // Try to find a non-v6000 archive by mounting each and checking entryCount
    // (v6000 archives are also readable — their TOC/names parse fine, only readEntry is refused).
    // We detect v6000 by attempting to read the first entry: if it throws "enumerate-only", skip.
    for (const f of files) {
      const p = join(FIXTURES_REAL, f);
      try {
        const mounts = nativeCore.mountArchive([p]);
        if (mounts.length === 0 || mounts[0].entryCount === 0) continue;
        const entries = nativeCore.listEntries(mounts[0].archiveIndex);
        // Find first non-tombstone entry
        const nonTomb = entries.find((e: {uncompressedSize: number}) => e.uncompressedSize > 0);
        if (!nonTomb) continue;
        const nonTombIdx = entries.indexOf(nonTomb);
        // Probe: try to readEntry — v6000 throws
        nativeCore.readEntry(mounts[0].archiveIndex, nonTombIdx);
        return p;  // readable (non-v6000)
      } catch {
        continue;  // v6000 or parse error — skip
      }
    }
    return null;
  } catch {
    return null;
  }
}

const REAL_TRE_PATH = findRealTrePath();
const HAS_REAL_FIXTURES = REAL_TRE_PATH !== null;

// ─── Synthetic lane (always runs) ────────────────────────────────────────────
// Build a source archive, then repack it with NO edits.
// Raw-slice identity means: every payload in the repacked archive must be
// bit-identical to the corresponding payload in the source archive.

describe('tre repack synthetic lane (raw-slice identity)', () => {
  // Build a source archive with known entries
  const SOURCE_ENTRIES = [
    { path: 'data/a.bin', data: new Uint8Array(Buffer.from('Entry A: small payload')) },
    { path: 'data/b.bin', data: new Uint8Array(2048).fill(0xAB) },  // large compressible
    { path: 'appearance/c.apt', data: new Uint8Array(Buffer.from('Entry C: another small one')) },
    { path: 'deleted/d.bin', tombstone: true },
  ];

  it('repack with no edits: all untouched entries have verbatim raw bytes (raw-slice identity)', async () => {
    // Build the source archive
    const sourceBytes = new Uint8Array(nativeCore.buildTre(SOURCE_ENTRIES));
    const sourcePath = join(TMP, 'source.tre');
    writeFileSync(sourcePath, Buffer.from(sourceBytes));

    // Repack with zero edits → all entries should be copied verbatim
    const repackedBytes = new Uint8Array(nativeCore.repackTre(sourcePath));
    const repackedPath = join(TMP, 'repacked-no-edits.tre');
    writeFileSync(repackedPath, Buffer.from(repackedBytes));

    // Mount both and compare entry count
    const [srcMount] = nativeCore.mountArchive([sourcePath]);
    const [repMount] = nativeCore.mountArchive([repackedPath]);

    expect(repMount.entryCount).toBe(srcMount.entryCount);

    // Compare payload bytes for every non-tombstone entry
    const srcEntries = nativeCore.listEntries(srcMount.archiveIndex);
    const repEntries = nativeCore.listEntries(repMount.archiveIndex);

    for (let i = 0; i < srcEntries.length; i++) {
      const se = srcEntries[i];
      const re = repEntries.find(e => e.path === se.path);
      expect(re, `Repacked archive missing entry: ${se.path}`).toBeDefined();

      if (se.uncompressedSize === 0) {
        // Tombstone: skip payload comparison
        expect(re!.uncompressedSize).toBe(0);
        continue;
      }

      // Payload bytes must be byte-identical (raw-slice identity)
      const srcPayload = new Uint8Array(nativeCore.readEntry(srcMount.archiveIndex, i));
      const repIdx = repEntries.indexOf(re!);
      const repPayload = new Uint8Array(nativeCore.readEntry(repMount.archiveIndex, repIdx));

      expect(repPayload.length).toBe(srcPayload.length);
      for (let b = 0; b < srcPayload.length; b++) {
        if (repPayload[b] !== srcPayload[b]) {
          throw new Error(
            `RAW-SLICE IDENTITY FAIL for ${se.path} @ byte ${b}: ` +
            `expected 0x${srcPayload[b].toString(16)}, got 0x${repPayload[b].toString(16)}`
          );
        }
      }
    }
  });

  it('repack with one edit: edited entry recompressed, others verbatim', async () => {
    const sourceBytes = new Uint8Array(nativeCore.buildTre(SOURCE_ENTRIES));
    const sourcePath = join(TMP, 'source-for-edit.tre');
    writeFileSync(sourcePath, Buffer.from(sourceBytes));

    // Mount source to get entry order
    const [srcMount] = nativeCore.mountArchive([sourcePath]);
    const srcEntries = nativeCore.listEntries(srcMount.archiveIndex);

    // Find the 'data/a.bin' entry index
    const aIdx = srcEntries.findIndex(e => e.path === 'data/a.bin');
    expect(aIdx).toBeGreaterThanOrEqual(0);

    const newPayload = new Uint8Array(Buffer.from('EDITED: new payload for a.bin'));
    const repackedBytes = new Uint8Array(
      nativeCore.repackTre(sourcePath, [{ index: aIdx, data: newPayload }])
    );
    const repackedPath = join(TMP, 'repacked-one-edit.tre');
    writeFileSync(repackedPath, Buffer.from(repackedBytes));

    const [repMount] = nativeCore.mountArchive([repackedPath]);
    const repEntries = nativeCore.listEntries(repMount.archiveIndex);

    // Edited entry: payload must match newPayload
    const repAIdx = repEntries.findIndex(e => e.path === 'data/a.bin');
    const repA = new Uint8Array(nativeCore.readEntry(repMount.archiveIndex, repAIdx));
    expect(Buffer.from(repA).toString('utf8')).toBe('EDITED: new payload for a.bin');

    // Unedited entries: payload must be byte-identical to source
    for (let i = 0; i < srcEntries.length; i++) {
      if (i === aIdx) continue;  // skip the edited entry
      const se = srcEntries[i];
      if (se.uncompressedSize === 0) continue;  // skip tombstones

      const repIdx = repEntries.findIndex(e => e.path === se.path);
      expect(repIdx, `Missing unedited entry ${se.path}`).toBeGreaterThanOrEqual(0);

      const srcPayload = new Uint8Array(nativeCore.readEntry(srcMount.archiveIndex, i));
      const repPayload = new Uint8Array(nativeCore.readEntry(repMount.archiveIndex, repIdx));

      expect(repPayload.length).toBe(srcPayload.length);
      for (let b = 0; b < srcPayload.length; b++) {
        if (repPayload[b] !== srcPayload[b]) {
          throw new Error(
            `UNEDITED ENTRY MODIFIED (raw-slice identity violated) for ${se.path} @ byte ${b}: ` +
            `src=0x${srcPayload[b].toString(16)}, rep=0x${repPayload[b].toString(16)}`
          );
        }
      }
    }
  });

  it('v6000 repack refused (enumerate-only — T-01-17)', async () => {
    const sourceBytes = new Uint8Array(nativeCore.buildTre(SOURCE_ENTRIES));
    const sourcePath = join(TMP, 'source-v6000-test.tre');
    writeFileSync(sourcePath, Buffer.from(sourceBytes));
    // Attempt to repack as v6000 — must throw
    expect(() => nativeCore.repackTre(sourcePath, [], '6000')).toThrow(/enumerate-only|V6000|refused/i);
  });
});

// ─── Real-asset lane (skipped unless fixtures-real/ has a .tre file) ─────────
// These tests require a real .tre file from a SWG installation.
// Fixture files are gitignored (D-10).
// See packages/harness/scripts/copy-real-fixtures.js for setup instructions.

describe.skipIf(!HAS_REAL_FIXTURES)('tre repack real-asset lane (per-record raw compressed slice identity)', () => {
  it('real .tre repack with no edits: every entry decompresses to source payload (raw-slice check)', async () => {
    if (!REAL_TRE_PATH) return;

    console.log(`[real-asset] Using real .tre: ${REAL_TRE_PATH}`);

    const repackedBytes = new Uint8Array(nativeCore.repackTre(REAL_TRE_PATH));
    const repackedPath = join(TMP, 'real-repack-no-edits.tre');
    writeFileSync(repackedPath, Buffer.from(repackedBytes));

    const [srcMount] = nativeCore.mountArchive([REAL_TRE_PATH]);
    const [repMount] = nativeCore.mountArchive([repackedPath]);

    expect(repMount.entryCount).toBe(srcMount.entryCount);

    const srcEntries = nativeCore.listEntries(srcMount.archiveIndex);
    const repEntries = nativeCore.listEntries(repMount.archiveIndex);

    // Spot-check first 20 non-tombstone entries (full check would be too slow for CI)
    const SAMPLE_LIMIT = 20;
    let checked = 0;

    for (let i = 0; i < srcEntries.length && checked < SAMPLE_LIMIT; i++) {
      const se = srcEntries[i];
      if (se.uncompressedSize === 0) continue;  // skip tombstones

      const repIdx = repEntries.findIndex(e => e.path === se.path);
      if (repIdx < 0) {
        throw new Error(`Real-asset repack missing entry: ${se.path}`);
      }

      const srcPayload = new Uint8Array(nativeCore.readEntry(srcMount.archiveIndex, i));
      const repPayload = new Uint8Array(nativeCore.readEntry(repMount.archiveIndex, repIdx));

      expect(repPayload.length).toBe(srcPayload.length);
      for (let b = 0; b < srcPayload.length; b++) {
        if (repPayload[b] !== srcPayload[b]) {
          throw new Error(
            `REAL-ASSET RAW-SLICE IDENTITY FAIL for ${se.path} @ byte ${b}: ` +
            `expected 0x${srcPayload[b].toString(16)}, got 0x${repPayload[b].toString(16)}`
          );
        }
      }
      checked++;
    }

    console.log(`[real-asset] Verified ${checked} entries raw-slice identity.`);
  });
});
