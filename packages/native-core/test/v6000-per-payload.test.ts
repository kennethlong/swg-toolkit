// @vitest-environment node
/**
 * packages/native-core/test/v6000-per-payload.test.ts
 *
 * RED scaffold — Task 1 (plan 04.3-10 MOUNT-04): blanket isEnumerateOnly refusal removed.
 *
 * After plan 04.3-10 removes the v6000 blanket throw from TreArchive::extractEntry,
 * the error on an empty-internal-TOC v6000 container must be "index out of range"
 * (zero entries in internal TOC), NOT the old "enumerate-only (v6000 encrypted payload)"
 * blanket refusal that fired before the bounds check.
 *
 * Ground truth:
 *   patch_sku3_24_client_00.tre — EERT6000, numberOfFiles=0 (empty internal TOC).
 *   Payload at offset 26174 is plain-zlib (swg-source v6000, NOT Restoration-encrypted).
 *   Extraction via internal TOC index is impossible (entryCount=0), but extraction via
 *   external descriptor (extractMountAt) is possible — that is Task 2.
 *
 * STATUS: RED on unmodified code (blanket throw fires for v6000 before OOB check).
 *         GREEN after plan 04.3-10 Task 1 removes lines 307-311 from TreArchive.cpp.
 *
 * skipIf: SWGSource Client v3.0 not present on this machine (CI skip).
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

const SKU3_TRE = 'D:/Code/SWGSource Client v3.0/patch_sku3_24_client_00.tre';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../index.js') as {
  mountTreMount:   (paths: string[], priorities: number[]) => string;
  disposeTreMount: (handle: string) => void;
  readMountEntry:  (handle: string, archiveIndex: number, entryIndex: number) => ArrayBuffer;
};

describe('v6000 per-payload classification (plan 04.3-10 Task 1)', () => {
  it.skipIf(!existsSync(SKU3_TRE))(
    'readMountEntry on empty-internal-TOC v6000: OOB error, NOT blanket enumerate-only',
    () => {
      // patch_sku3_24_client_00.tre is EERT6000, numberOfFiles=0.
      // readMountEntry(handle, 0, 0) tries extractEntry(0, stream) on an archive
      // with ZERO internal TOC entries.
      //
      // BEFORE Task 1: throws "enumerate-only (v6000 encrypted payload)"
      //   (blanket isEnumerateOnly guard fires at line 307-311 BEFORE the bounds check)
      // AFTER Task 1: throws "index out of range"
      //   (bounds check fires: entryCount=0, idx=0 → 0 >= 0 → out of range)
      const handle = nativeCore.mountTreMount([SKU3_TRE], [0]);
      let error: Error | null = null;
      try {
        nativeCore.readMountEntry(handle, 0, 0);
      } catch (e) {
        error = e as Error;
      } finally {
        nativeCore.disposeTreMount(handle);
      }

      // Must throw (there are no entries in the empty-TOC container)
      expect(error, 'readMountEntry on empty-TOC v6000 must throw').not.toBeNull();

      // REGRESSION GATE (T-01-05 REVISED): blanket "enumerate-only" refusal must be gone
      expect(
        error!.message,
        'blanket enumerate-only guard must no longer fire for v6000 (per-payload classify)',
      ).not.toContain('enumerate-only (v6000 encrypted payload)');

      // POSITIVE GATE: the bounds check must be what fires instead
      expect(
        error!.message,
        'OOB check must fire: internal TOC has 0 entries, entryIndex=0 is out of range',
      ).toContain('out of range');
    },
  );
});
