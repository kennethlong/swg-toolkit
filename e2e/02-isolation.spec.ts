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
 *
 * PERFORMANCE NOTE: A single shared Electron instance (beforeAll/afterAll) is used
 * across all 3 tests to avoid per-test Electron launches that cause Windows resource
 * exhaustion when running the full suite.
 */

import { _electron as electron, test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_BINARY = require('electron') as string;
const REPO_ROOT = path.resolve(__dirname, '..');

test.describe('SC-3: crossOriginIsolated + SharedArrayBuffer (COOP/COEP)', () => {
  // Allow 90s for Electron launch + GPU process startup (cumulative resource effects).
  test.describe.configure({ timeout: 90_000 });

  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      executablePath: ELECTRON_BINARY,
      args: [REPO_ROOT, '--disable-gpu'],
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test('crossOriginIsolated === true in the renderer', async () => {
    const isolated = await window.evaluate(() => self.crossOriginIsolated);
    expect(isolated).toBe(true);
  });

  test('new SharedArrayBuffer(4) does not throw (COI active)', async () => {
    const result = await window.evaluate(() => {
      const sab = new SharedArrayBuffer(4);
      return { ok: true, byteLength: sab.byteLength };
    });
    expect(result.ok).toBe(true);
    expect(result.byteLength).toBe(4);
  });

  test('SharedArrayBuffer byteLength === 4', async () => {
    const byteLength = await window.evaluate(() => new SharedArrayBuffer(4).byteLength);
    expect(byteLength).toBe(4);
  });
});
