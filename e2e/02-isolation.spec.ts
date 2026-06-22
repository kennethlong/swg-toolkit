/**
 * e2e/02-isolation.spec.ts
 * SC-3: crossOriginIsolated + SharedArrayBuffer allocatable in the renderer.
 *
 * KEPT UNCHANGED from the original plan (no path_b_adaptation needed here):
 *   COOP/COEP is independent of the nodeIntegration/sandbox posture. The
 *   setupCrossOriginIsolation() call in main.ts registers onHeadersReceived BEFORE
 *   win.loadURL(), so crossOriginIsolated is true regardless of the Path B posture.
 *
 * COVERED CRITERIA:
 *   SC-3: crossOriginIsolated === true in the renderer
 *         new SharedArrayBuffer(4) does not throw; byteLength === 4
 */

import { test, expect } from './fixtures/electron-helpers';

test.describe('SC-3: crossOriginIsolated + SharedArrayBuffer (COOP/COEP)', () => {
  test('crossOriginIsolated === true in the renderer', async ({ window }) => {
    const isolated = await window.evaluate(() => self.crossOriginIsolated);
    expect(isolated).toBe(true);
  });

  test('new SharedArrayBuffer(4) does not throw (COI active)', async ({ window }) => {
    const result = await window.evaluate(() => {
      const sab = new SharedArrayBuffer(4);
      return { ok: true, byteLength: sab.byteLength };
    });
    expect(result.ok).toBe(true);
    expect(result.byteLength).toBe(4);
  });

  test('SharedArrayBuffer byteLength === 4', async ({ window }) => {
    const byteLength = await window.evaluate(() => new SharedArrayBuffer(4).byteLength);
    expect(byteLength).toBe(4);
  });
});
