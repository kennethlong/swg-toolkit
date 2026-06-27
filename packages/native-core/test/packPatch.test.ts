/**
 * packPatch.test.ts — Deploy patch build gate (DEPLOY-01).
 *
 * Tests:
 *   Test 1 — v5000 magic: buildTre(entries, '5000') first 8 bytes are EERT5000.
 *   Test 2 — tombstone TOC: tombstone entry has uncompressedSize === 0 after mount.
 *   Test 3 — wrong version: buildTre(entries, '0005') has bytes[4..7] = '0','0','0','5'
 *             (NOT '5','0','0','0') — confirms the version param matters.
 *   Test 4 — determinism (D-04-08a): same entries in canonical sort order → byte-identical
 *             output on two successive buildTre calls. The canonical sort is the caller's
 *             responsibility (packPatch.ts does it before calling buildTre).
 *
 * Ground truth:
 *   v5000 magic bytes: 'E'=0x45,'E'=0x45,'R'=0x52,'T'=0x54,'5'=0x35,'0'=0x30,'0'=0x30,'0'=0x30.
 *   Version bytes 4-7 of the header carry the 4-char ASCII version string.
 *   Tombstone uncompressedSize === 0 per TreeFileBuilder.cpp:541 + TreeFile_SearchNode.cpp:397.
 *
 * Source:
 *   04-RESEARCH.md §Pitfall 1 (v5000 magic bytes); D-04-04 (correct version for Infinity).
 *   swg-client-v2 TreeFileBuilder.cpp:773-833 (block write order).
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname_es = dirname(fileURLToPath(import.meta.url));

// Load the native addon via CJS require (same as hello.test.ts)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../index.js') as {
  buildTre: (entries: Array<{ path: string; data?: Uint8Array; tombstone?: boolean }>, version?: string) => ArrayBuffer;
  mountArchive: (paths: string[]) => Array<{ archiveIndex: number; entryCount: number; path: string }>;
  listEntries: (idx: number) => Array<{ path: string; crc: number; uncompressedSize: number; compressor: number }>;
};

const TMP = join(tmpdir(), 'swg-packpatch-test');
mkdirSync(TMP, { recursive: true });

describe('packPatch DEPLOY-01', () => {
  it('Test 1: buildTre(entries, "5000") first 8 bytes are EERT5000 magic (matches live Infinity archives)', () => {
    // v5000 = 'E','E','R','T' + '5','0','0','0' in ASCII
    // Ground truth: 04-RESEARCH.md §Pitfall 1 (hexdump verified).
    const entries = [{ path: 'test/file.txt', data: new Uint8Array([1, 2, 3]) }];
    const bytes = new Uint8Array(nativeCore.buildTre(entries, '5000'));

    // Magic bytes 0-3: 'E','E','R','T'
    expect(bytes[0]).toBe(0x45); // 'E'
    expect(bytes[1]).toBe(0x45); // 'E'
    expect(bytes[2]).toBe(0x52); // 'R'
    expect(bytes[3]).toBe(0x54); // 'T'

    // Version bytes 4-7: '5','0','0','0' (v5000)
    expect(bytes[4]).toBe(0x35); // '5'
    expect(bytes[5]).toBe(0x30); // '0'
    expect(bytes[6]).toBe(0x30); // '0'
    expect(bytes[7]).toBe(0x30); // '0'
  });

  it('Test 2: tombstone entry produces uncompressedSize === 0 in TOC (shadows retail via first-match-wins)', () => {
    // Tombstone = length-0 TOC entry. The engine's !deleted guard in TreeFile_SearchNode.cpp:397
    // sees uncompressedSize === 0 and treats the file as deleted (not loadable from retail).
    // Source: TreeFileBuilder.cpp:541 (tombstone included in numberOfFiles, length=0).
    const entries = [{ path: 'deleted/file.txt', tombstone: true }];
    const tmpPath = join(TMP, 'tombstone-check.tre');
    writeFileSync(tmpPath, Buffer.from(nativeCore.buildTre(entries, '5000')));

    const results = nativeCore.mountArchive([tmpPath]);
    const listed = nativeCore.listEntries(results[0].archiveIndex);
    const tomb = listed.find(e => e.path === 'deleted/file.txt');
    expect(tomb).toBeDefined();
    expect(tomb!.uncompressedSize).toBe(0); // length-0 TOC = tombstone
  });

  it('Test 3: buildTre with version="0005" (wrong for Infinity) produces bytes[4..7] = "0005" not "5000"', () => {
    // Confirms the version parameter is respected — using '0005' creates a
    // v0005 archive which will NOT load in the live Infinity client (EERT0005 ≠ EERT5000).
    // This test validates that version='5000' in packPatch.ts is mandatory, not optional.
    const entries = [{ path: 'test/file.txt', data: new Uint8Array([4, 5, 6]) }];
    const bytes = new Uint8Array(nativeCore.buildTre(entries, '0005'));

    // Magic bytes 0-3: 'E','E','R','T' (same for all versions)
    expect(bytes[0]).toBe(0x45);
    expect(bytes[1]).toBe(0x45);
    expect(bytes[2]).toBe(0x52);
    expect(bytes[3]).toBe(0x54);

    // Version bytes 4-7: '0','0','0','5' (v0005 — WRONG for Infinity)
    expect(bytes[4]).toBe(0x30); // '0'
    expect(bytes[5]).toBe(0x30); // '0'
    expect(bytes[6]).toBe(0x30); // '0'
    expect(bytes[7]).toBe(0x35); // '5'

    // Confirm these are NOT the v5000 bytes
    const isV5000 = bytes[4] === 0x35 && bytes[5] === 0x30 && bytes[6] === 0x30 && bytes[7] === 0x30;
    expect(isV5000).toBe(false);
  });

  it('Test 4: determinism (D-04-08a) — sorted entries produce byte-identical archives on two calls', () => {
    // The canonical sort by virtualPath is the CALLER's responsibility (D-04-08a).
    // packPatch.ts sorts before calling buildTre so that re-deploying the same version
    // produces byte-identical output. This test verifies the invariant: same sorted
    // inputs → same bytes, using code-point sort order (not localeCompare).
    const rawEntries = [
      { path: 'z/last.txt',  data: new Uint8Array([0xAA]) },
      { path: 'a/first.txt', data: new Uint8Array([0xBB]) },
      { path: 'm/mid.txt',   data: new Uint8Array([0xCC]) },
    ];

    // Canonical sort: code-point comparison (< / > operators), same as packPatch.ts
    const sorted = [...rawEntries].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    );

    // Build twice from the same canonical-sorted entries
    const build1 = new Uint8Array(nativeCore.buildTre(sorted, '5000'));
    const build2 = new Uint8Array(nativeCore.buildTre(sorted, '5000'));

    // Lengths must match
    expect(build1.length).toBe(build2.length);
    expect(build1.length).toBeGreaterThan(36);

    // Every byte must match (byte-identical — determinism invariant)
    for (let i = 0; i < build1.length; i++) {
      if (build1[i] !== build2[i]) {
        throw new Error(
          `DETERMINISM FAIL @ offset 0x${i.toString(16)}: ` +
          `build1=0x${build1[i].toString(16)}, build2=0x${build2[i].toString(16)}`
        );
      }
    }
  });
});
