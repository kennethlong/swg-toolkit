/**
 * e2e/01-boot.spec.ts
 * SC-1 + SC-2: Electron security posture + native hello round-trip.
 *
 * PATH B ADAPTATION (00-05 plan path_b_adaptation, 2026-06-22):
 *   The original 00-05-PLAN.md described the FALSIFIED cross-process model:
 *     - contextIsolation: true, nodeIntegration: false, sandbox: true
 *     - window.api via contextBridge (allowlist: ['hello','onSabPort','crossWriteSab'])
 *     - window.require === undefined, window.process === undefined
 *
 *   The AS-BUILT posture (Path B fallback — see 00-03-SUMMARY.md § DECISION):
 *     - contextIsolation: false, nodeIntegration: true, sandbox: false
 *     - NO contextBridge API (preload.ts is log-only; window.api does NOT exist)
 *     - window.require IS a function (Node.js is available in the renderer — the
 *       deliberate Path B tradeoff for in-process C++ SharedArrayBuffer zero-copy)
 *
 *   The old assertions (contextIsolation: true, nodeIntegration: false, sandbox: true,
 *   window.require === undefined, Object.keys(window.api) === ['crossWriteSab','hello',
 *   'onSabPort']) are INVERTED and replaced below to assert the AS-BUILT reality.
 *
 *   This is the correct security posture for SWG-Toolkit: a trusted local desktop tool.
 *   Residual risk documented in 00-03-SUMMARY.md § Revised FND-01.
 *
 * COVERED CRITERIA:
 *   SC-1: Electron security posture asserted via getWebPreferences() (Path B reality)
 *   SC-2: nativeCore.hello() returns 'pong' (addon loaded in renderer — no relay)
 *
 * PERFORMANCE NOTE: Electron launch is expensive. SC-1 + SC-2 each share a SINGLE
 * Electron instance via beforeAll/afterAll to avoid 8 separate launches (which causes
 * cumulative resource pressure when running alongside other specs).
 */

import { _electron as electron, test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_BINARY = require('electron') as string;
const REPO_ROOT = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// SC-1: Path B security posture assertions
// AS-BUILT: sandbox:false + nodeIntegration:true + contextIsolation:false
// ─────────────────────────────────────────────────────────────────────────────

test.describe('SC-1: Path B security posture (AS-BUILT — 00-03 REPLAN DECISION)', () => {
  // Note: test.describe.configure({ timeout }) sets the per-TEST timeout but does NOT
  // apply to beforeAll/afterAll hooks. Those need the explicit second-argument form:
  // test.beforeAll(fn, timeoutMs). See Playwright docs on hook timeouts.
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

  test('webPreferences: contextIsolation === false (Path B fallback)', async () => {
    const prefs = await electronApp.evaluate(({ BrowserWindow }) =>
      // getWebPreferences() was renamed to getLastWebPreferences() in Electron 29+
      (BrowserWindow.getAllWindows()[0].webContents as any).getLastWebPreferences()
    );
    // PATH B: contextIsolation is FALSE (not true). The preferred posture
    // (contextIsolation:true + contextBridge) was attempted and FAILED empirically:
    // a C++ SharedArrayBuffer cannot be cloned across the isolated-world boundary.
    // The fallback posture was chosen deliberately — see 00-03-SUMMARY.md § Revised FND-01.
    expect(prefs.contextIsolation).toBe(false);
  });

  test('webPreferences: nodeIntegration === true (renderer has Node.js access)', async () => {
    const prefs = await electronApp.evaluate(({ BrowserWindow }) =>
      // getWebPreferences() was renamed to getLastWebPreferences() in Electron 29+
      (BrowserWindow.getAllWindows()[0].webContents as any).getLastWebPreferences()
    );
    // PATH B: nodeIntegration is TRUE — the renderer main world requires('@swg/native-core')
    // directly, with no IPC relay. This is the deliberate Path B tradeoff.
    expect(prefs.nodeIntegration).toBe(true);
  });

  test('webPreferences: sandbox === false (required for Node.js in renderer)', async () => {
    const prefs = await electronApp.evaluate(({ BrowserWindow }) =>
      // getWebPreferences() was renamed to getLastWebPreferences() in Electron 29+
      (BrowserWindow.getAllWindows()[0].webContents as any).getLastWebPreferences()
    );
    // PATH B: sandbox:false allows require() in the renderer. Required for the
    // in-process native addon model.
    expect(prefs.sandbox).toBe(false);
  });

  test('window.require IS a function (Node available in renderer — Path B)', async () => {
    // PATH B: window.require IS a function. The renderer has full Node.js access.
    // NOTE: This INVERTS the old plan's assertion (window.require === undefined).
    // The old assertion was written for the FALSIFIED contextBridge model which
    // was never implemented (contextBridge.exposeInMainWorld throws for C++ SABs).
    const requireType = await window.evaluate(() => typeof (window as any).require);
    expect(requireType).toBe('function');
  });

  test('window.api does NOT exist (no contextBridge in Path B)', async () => {
    // PATH B: window.api is undefined. There is NO contextBridge API surface.
    // The preload.ts is log-only — it does not call contextBridge.exposeInMainWorld().
    // NOTE: This INVERTS the old plan's Object.keys(window.api) allowlist assertion.
    // The old assertion (Object.keys === ['crossWriteSab','hello','onSabPort']) was
    // written for the FALSIFIED cross-process model. Path B has no window.api at all.
    const apiType = await window.evaluate(() => typeof (window as any).api);
    expect(apiType).toBe('undefined');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-2: nativeCore.hello() returns 'pong' (in-process, no relay)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('SC-2: native hello round-trip (in-process, no relay)', () => {
  // 5s wait for StatusBar async proof + Electron launch: needs 90s.
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
    // Wait for StatusBar to mount and run async proof
    await window.waitForTimeout(5000);
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test('nativeCore.hello() returns "pong" in the renderer', async () => {
    // PATH B: the addon is required directly in the renderer. hello() runs in-process.
    // No IPC relay, no correlation-id demux, no cross-process copy.
    const result = await window.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nativeCore = (window as any).require('@swg/native-core');
      return nativeCore.hello();
    });
    expect(result).toBe('pong');
  });

  test('window.__transport === "B-native-in-renderer" (StatusBar hook)', async () => {
    // Wait for StatusBar's async proof to complete (already waited in beforeAll, but be safe)
    await window.waitForFunction(
      () => typeof (window as any).__transport === 'string',
      { timeout: 15000 }
    );
    const transport = await window.evaluate(() => (window as any).__transport);
    expect(transport).toBe('B-native-in-renderer');
  });

  test('window.__zeroCopy === true (in-process, no copy)', async () => {
    await window.waitForFunction(
      () => typeof (window as any).__zeroCopy === 'boolean',
      { timeout: 15000 }
    );
    const zeroCopy = await window.evaluate(() => (window as any).__zeroCopy);
    expect(zeroCopy).toBe(true);
  });
});
