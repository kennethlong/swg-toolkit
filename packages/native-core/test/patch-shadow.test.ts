/**
 * patch-shadow.test.ts — Patch override resolution via mountTreMount (DEPLOY-01).
 *
 * Tests:
 *   Test 5 — modify shadow: build a base .tre + a patch .tre with a MODIFIED version
 *             of the same file. Mount both (base=priority 1, patch=priority 55).
 *             resolveEntry for the shared path returns the patch archive as winner.
 *   Test 6 — tombstone shadow: build a base .tre + a patch .tre with a tombstone for
 *             the same path. resolveEntry returns tombstone:true (file deleted by patch).
 *
 * These tests validate the patch-prepend deploy model (D-04-04, D-04-10):
 * the patch .tre mounts at a higher searchTree priority slot than retail archives,
 * so its entries win over retail via first-match-wins resolution.
 *
 * Ground truth:
 *   swg-client-v2 TreeFile.cpp:437-461 (first-match-wins traverse).
 *   swg-client-v2 TreeFile_SearchNode.cpp:360-408 (binary search + tombstone).
 *
 * Source:
 *   packages/harness/test/tre-override.test.ts (mountTreMount + resolveEntry pattern).
 *   D-04-04/10 (patch-prepend deploy model).
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname_es = dirname(fileURLToPath(import.meta.url));

// Load the native addon via CJS require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../index.js') as {
  buildTre: (entries: Array<{ path: string; data?: Uint8Array; tombstone?: boolean }>, version?: string) => ArrayBuffer;
  mountTreMount: (paths: string[], priorities: number[]) => string;
  resolveEntry: (mountHandle: string, name: string) => {
    winner: string | null;
    tombstone: boolean;
    archiveIndex: number;
    entryIndex: number;
  };
  disposeTreMount: (mountHandle: string) => void;
};

const TMP = join(tmpdir(), 'swg-patchshadow-test');
mkdirSync(TMP, { recursive: true });

describe('patch-shadow DEPLOY-01', () => {
  it('Test 5: patch .tre with modify entry shadows base .tre — resolveEntry returns patch winner', () => {
    // Simulate patch-prepend: base at priority 1, patch at priority 55 (above retail slots 30-54)
    const sharedPath = 'original/content.txt';

    // Build base .tre with original content
    const basePath = join(TMP, 'shadow-base.tre');
    writeFileSync(basePath, Buffer.from(
      nativeCore.buildTre([{ path: sharedPath, data: new Uint8Array(Buffer.from('ORIGINAL')) }], '5000')
    ));

    // Build patch .tre with modified content (same virtual path = modify/override)
    const patchPath = join(TMP, 'shadow-patch.tre');
    writeFileSync(patchPath, Buffer.from(
      nativeCore.buildTre([{ path: sharedPath, data: new Uint8Array(Buffer.from('PATCHED')) }], '5000')
    ));

    // Mount: base=priority 1 (low), patch=priority 55 (high)
    const handle = nativeCore.mountTreMount([basePath, patchPath], [1, 55]);
    try {
      const result = nativeCore.resolveEntry(handle, sharedPath);
      // Patch wins (higher priority) — winner should be the patch archive path
      expect(result.winner).toBeTruthy();
      expect(result.winner).toBe(patchPath);
      expect(result.tombstone).toBe(false);
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });

  it('Test 6: tombstone patch shadows base .tre — resolveEntry returns tombstone:true (file deleted)', () => {
    // Tombstone in patch: the patch "deletes" the retail file by providing a
    // length-0 TOC entry. The engine's !deleted guard sees tombstone=true and
    // treats the file as not present (it cannot be extracted/loaded).
    // Source: TreeFile_SearchNode.cpp:397 (!deleted check).
    const deletedPath = 'deleted/asset.iff';

    // Build base .tre with the file present
    const basePath = join(TMP, 'tombstone-base.tre');
    writeFileSync(basePath, Buffer.from(
      nativeCore.buildTre([{ path: deletedPath, data: new Uint8Array(Buffer.from('REAL_ASSET')) }], '5000')
    ));

    // Build patch .tre with a tombstone for the same path
    const patchPath = join(TMP, 'tombstone-patch.tre');
    writeFileSync(patchPath, Buffer.from(
      nativeCore.buildTre([{ path: deletedPath, tombstone: true }], '5000')
    ));

    // Mount: base=priority 1, tombstone patch=priority 55
    const handle = nativeCore.mountTreMount([basePath, patchPath], [1, 55]);
    try {
      const result = nativeCore.resolveEntry(handle, deletedPath);
      // Tombstone wins — file is "deleted" by the patch
      expect(result.tombstone).toBe(true);
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });
});
