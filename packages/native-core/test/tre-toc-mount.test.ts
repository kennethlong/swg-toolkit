// @vitest-environment node
/**
 * packages/native-core/test/tre-toc-mount.test.ts
 *
 * RED scaffold — Task 2 (plan 04.3-10 MOUNT-01/02): mountTreMountWithToc.
 *
 * Verifies that mountTreMountWithToc() injects master-.toc entries into the columnar
 * VFS, making empty-internal-TOC (numberOfFiles=0) v6000 containers contribute
 * non-zero entries through getMountEntriesColumnar (the H1 columnar-bridge gap fix).
 *
 * For a v6000 container with numberOfFiles=0 (e.g. patch_sku3_24_client_00.tre):
 *   - mountTreMount([container], [0])                 → getMountEntriesColumnar → entryCount=0
 *   - mountTreMountWithToc([container], [0], toc, tp) → getMountEntriesColumnar → entryCount>0
 *
 * STATUS: RED on unmodified code (mountTreMountWithToc not yet exported by addon.cpp).
 *         GREEN after plan 04.3-10 Task 2 implements runtime + registers export.
 *
 * skipIf: SWGSource Client v3.0 not present on this machine (CI skip).
 *
 * Ground truth:
 *   sku3_client.toc — master SearchTOC (H1 single index for all sku3 containers)
 *   patch_sku3_24_client_00.tre — EERT6000, numberOfFiles=0, plain-zlib payloads
 *   tocTreePath = 'D:/Code/SWGSource Client v3.0' (where treeName gets appended)
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

const CLIENT_ROOT    = 'D:/Code/SWGSource Client v3.0';
const SKU3_TRE       = `${CLIENT_ROOT}/patch_sku3_24_client_00.tre`;
const SKU3_TOC       = `${CLIENT_ROOT}/sku3_client.toc`;
const HAS_SKU3       = existsSync(SKU3_TRE) && existsSync(SKU3_TOC);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../index.js') as {
  mountTreMount:        (paths: string[], priorities: number[]) => string;
  getMountEntriesColumnar: (handle: string) => ArrayBuffer;
  disposeTreMount:      (handle: string) => void;
  mountTreMountWithToc?: (
    paths: string[],
    priorities: number[],
    tocPath: string,
    tocTreePath: string,
  ) => string;
};

// Helper: read entryCount from columnar blob header (LE uint32 at offset 0)
function columnarEntryCount(buf: ArrayBuffer): number {
  const view = new DataView(buf);
  return view.getUint32(0, /* littleEndian= */ true);
}

describe('mountTreMountWithToc: empty-internal-TOC v6000 → non-zero columnar entries (plan 04.3-10 Task 2)', () => {

  // Gate: mountTreMountWithToc must be a function (RED until implementation registers export).
  it('mountTreMountWithToc is exported by the native binding', () => {
    expect(
      typeof nativeCore.mountTreMountWithToc,
      'mountTreMountWithToc binding not implemented — RED until plan 04.3-10 Task 2',
    ).toBe('function');
  });

  it.skipIf(!HAS_SKU3)(
    'mountTreMount (no TOC): getMountEntriesColumnar returns entryCount=0 for numberOfFiles=0 container',
    () => {
      // Baseline: plain mountTreMount gives 0 entries (no internal TOC)
      const handle = nativeCore.mountTreMount([SKU3_TRE], [0]);
      try {
        const buf   = nativeCore.getMountEntriesColumnar(handle);
        const count = columnarEntryCount(buf);
        expect(count, 'baseline: numberOfFiles=0 → 0 columnar entries without TOC').toBe(0);
      } finally {
        nativeCore.disposeTreMount(handle);
      }
    },
  );

  it.skipIf(!HAS_SKU3)(
    'mountTreMountWithToc: getMountEntriesColumnar returns entryCount>0 for numberOfFiles=0 container',
    () => {
      // RED GATE: fails because mountTreMountWithToc is not yet registered.
      expect(
        typeof nativeCore.mountTreMountWithToc,
        'mountTreMountWithToc not yet implemented',
      ).toBe('function');

      // After plan 04.3-10 Task 2 ships the runtime, the TOC-sourced entries appear:
      const handle = nativeCore.mountTreMountWithToc!([SKU3_TRE], [0], SKU3_TOC, CLIENT_ROOT);
      try {
        const buf   = nativeCore.getMountEntriesColumnar(handle);
        const count = columnarEntryCount(buf);
        // sku3_client.toc has 1158+ entries for patch_sku3_* containers — non-zero expected.
        expect(count, 'mountTreMountWithToc must inject TOC entries so columnar is non-zero')
          .toBeGreaterThan(0);
      } finally {
        nativeCore.disposeTreMount(handle);
      }
    },
  );

});
