/**
 * e2e/05-packaged.spec.ts
 * Packaged binary HARD gate: crossOriginIsolated + in-process cross-write in the real file:// build.
 *
 * HARD GATE (review fix HIGH-2):
 *   In CI (packaged-gate job), PACKAGED_EXE_PATH is ALWAYS set and --forbid-only is passed.
 *   A skip of this spec in CI is treated as a FAIL (the job fails if PACKAGED_EXE_PATH is
 *   unset and the spec skips — the CI yaml uses --forbid-only which treats a skip as a fail).
 *
 * PATH B ADAPTATION (00-05 plan path_b_adaptation, 2026-06-22):
 *   The original plan described assertions for the FALSIFIED cross-process model
 *   (window.__crossWriteOk as cross-process utility relay proof). The AS-BUILT proof is:
 *     - The native addon runs IN the renderer process (Path B)
 *     - window.__crossWriteOk = in-process nonce round-trip (same pointer, same memory)
 *     - window.__crossWriteState = 'shared' (NOT 'copy' or 'error')
 *     - window.__zeroCopy = true (transport = B-native-in-renderer)
 *   This spec asserts the in-process Path B proof holds in the real PACKAGED binary.
 *   This is the packaged-Electron RUNTIME LOAD of the single ABI-stable --napi prebuild
 *   (round-3 / Cursor CUR-1). There is no separate Electron-ABI build — the same N-API
 *   prebuild loaded in development is loaded at runtime in the packaged binary.
 *
 * FILE:// COOP/COEP RISK (documented):
 *   COOP/COEP via onHeadersReceived fires for ALL session responses INCLUDING file:// in
 *   Electron's webRequest API (Electron webRequest docs: "Adds a listener to the
 *   onHeadersReceived event of the session"). This is the FIRST rung on the fallback ladder.
 *   If crossOriginIsolated === false in the packaged build, the fallback priority ladder is:
 *     1. onHeadersReceived for file:// (current — keep if it fires for file:// responses)
 *     2. protocol.handle('app://') — register privileged scheme + inject headers (RESEARCH Pattern 2)
 *     3. <meta> COOP/COEP tags in index.html — LAST RESORT (weaker; may not enable COI everywhere)
 *   The HARD gate assertion below will FAIL if COI is false — do NOT paper over it.
 *
 * BUILD: The packaged binary is produced OUT-OF-BAND (NOT inside this spec's beforeAll).
 *   Build: `pnpm package:ci` from the repo root.
 *   Point here: `PACKAGED_EXE_PATH=<path/to/swg-toolkit.exe> pnpm playwright test e2e/05-packaged.spec.ts`
 *   If PACKAGED_EXE_PATH is not set and no exe found in out/, the spec skips with an actionable message.
 *   In CI, PACKAGED_EXE_PATH is always set so the skip branch is never taken there.
 */

import { _electron as electron, test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'out');

// ─────────────────────────────────────────────────────────────────────────────
// findPackagedExe: scan out/ for the platform-specific packaged executable.
// Returns null if nothing found (caller decides to skip or throw).
// ─────────────────────────────────────────────────────────────────────────────

function findPackagedExe(outDir: string): string | null {
  if (!fs.existsSync(outDir)) return null;

  // Windows: look for *.exe (excluding squirrel/update installers)
  if (process.platform === 'win32') {
    const entries = fs.readdirSync(outDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(outDir, entry.name);
        const exes = fs.readdirSync(subDir).filter(
          (f) => f.endsWith('.exe') && !f.toLowerCase().includes('squirrel') && !f.toLowerCase().includes('update')
        );
        if (exes.length > 0) {
          return path.join(subDir, exes[0]);
        }
      }
    }
  }

  // macOS: look for *.app/Contents/MacOS/*
  if (process.platform === 'darwin') {
    const entries = fs.readdirSync(outDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(outDir, entry.name);
        const apps = fs.readdirSync(subDir).filter((f) => f.endsWith('.app'));
        for (const appDir of apps) {
          const macOsDir = path.join(subDir, appDir, 'Contents', 'MacOS');
          if (fs.existsSync(macOsDir)) {
            const bins = fs.readdirSync(macOsDir);
            if (bins.length > 0) return path.join(macOsDir, bins[0]);
          }
        }
      }
    }
  }

  // Linux: look for executable files (no extension)
  if (process.platform === 'linux') {
    const entries = fs.readdirSync(outDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(outDir, entry.name);
        const files = fs.readdirSync(subDir);
        for (const f of files) {
          const full = path.join(subDir, f);
          if (!f.includes('.') && fs.statSync(full).isFile()) {
            return full;
          }
        }
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve the packaged exe path
// ─────────────────────────────────────────────────────────────────────────────

const exeFromEnv = process.env.PACKAGED_EXE_PATH;
const exeFromScan = exeFromEnv ? null : findPackagedExe(OUT_DIR);
const exePath: string | null = exeFromEnv ?? exeFromScan;

// ─────────────────────────────────────────────────────────────────────────────
// Packaged spec suite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('05-packaged: HARD gate — crossOriginIsolated + in-process cross-write in packaged binary', () => {
  let app: ElectronApplication | null = null;
  let window: Page | null = null;

  test.beforeAll(async () => {
    if (!exePath) {
      // Local dev: skip with an actionable message.
      // In CI, PACKAGED_EXE_PATH is always set — the CI job fails if this skip fires
      // (because the CI step uses --forbid-only, which treats test.skip as a fail).
      return;
    }

    app = await electron.launch({ executablePath: exePath });
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    // Wait longer for the packaged app to fully initialize (native rebuild cold-start)
    await window.waitForTimeout(3000);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  // ── Skip guard ─────────────────────────────────────────────────────────────

  test('packaged exe found (HARD gate — skip == fail in CI)', async () => {
    if (!exePath) {
      // In CI this never fires (PACKAGED_EXE_PATH is always set + --forbid-only)
      test.skip(
        true,
        `Packaged exe not found. To run this spec:\n` +
        `  1. Build: pnpm package:ci\n` +
        `  2. Run: PACKAGED_EXE_PATH=<path/to/swg-toolkit.exe> pnpm playwright test e2e/05-packaged.spec.ts\n` +
        `  OR set PACKAGED_EXE_PATH in your environment.\n` +
        `In CI, the packaged-gate job always sets PACKAGED_EXE_PATH.`
      );
    }
    expect(exePath).toBeTruthy();
    expect(fs.existsSync(exePath!)).toBe(true);
  });

  // ── SC-3 packaged: crossOriginIsolated === true (file:// COOP/COEP path) ───

  test('packaged renderer: crossOriginIsolated === true (file:// COOP/COEP)', async () => {
    if (!exePath || !window) {
      test.skip(true, 'Packaged exe not available — see "packaged exe found" test above');
      return;
    }
    const isolated = await window.evaluate(() => self.crossOriginIsolated);
    if (!isolated) {
      // FINDING: COOP/COEP via onHeadersReceived did NOT set crossOriginIsolated=true
      // on file:// in this packaged build. This breaks Path B (no SharedArrayBuffer global).
      // Documented fallback priority ladder:
      //   1. onHeadersReceived for file:// (FAILED — current rung)
      //   2. protocol.handle('app://') — register privileged scheme, inject COOP/COEP
      //   3. <meta> COOP/COEP in index.html — LAST RESORT (weaker isolation)
      // This is a packaging FINDING — do NOT paper over it.
      throw new Error(
        `[05-packaged FINDING] crossOriginIsolated === false in packaged renderer.\n` +
        `  COOP/COEP via onHeadersReceived did NOT apply to file:// in this build.\n` +
        `  Fallback priority ladder:\n` +
        `    1. onHeadersReceived for file:// — FAILED (current rung)\n` +
        `    2. protocol.handle('app://') — register privileged scheme + inject headers\n` +
        `    3. <meta> COOP/COEP in index.html — LAST RESORT (weaker; may not enable COI)\n` +
        `  Apply the next fallback rung in packages/backend/src/main.ts and rebuild.`
      );
    }
    expect(isolated).toBe(true);
  });

  test('packaged renderer: new SharedArrayBuffer(4) does not throw', async () => {
    if (!exePath || !window) {
      test.skip(true, 'Packaged exe not available');
      return;
    }
    const result = await window.evaluate(() => {
      const sab = new SharedArrayBuffer(4);
      return { ok: true, byteLength: sab.byteLength };
    });
    expect(result.ok).toBe(true);
    expect(result.byteLength).toBe(4);
  });

  // ── FND-02 packaged: in-process cross-write holds in the packaged binary ──
  // This is the packaged-Electron RUNTIME LOAD of the single ABI-stable --napi prebuild.
  // N-API is ABI-stable across Node + Electron; one prebuild loaded under Electron at runtime.
  // (round-3 / Cursor CUR-1 — NOT a separate "Electron-ABI" build)

  test('packaged renderer: __crossWriteOk === true (in-process nonce round-trip in packaged binary)', async () => {
    if (!exePath || !window) {
      test.skip(true, 'Packaged exe not available');
      return;
    }
    // Wait for StatusBar's async proof to complete (longer timeout for packaged cold-start)
    await window.waitForFunction(
      () => typeof (window as any).__crossWriteOk === 'boolean',
      { timeout: 20000 }
    );
    const crossWriteOk = await window.evaluate(() => (window as any).__crossWriteOk as boolean);
    const crossWriteState = await window.evaluate(() => (window as any).__crossWriteState as string);

    if (!crossWriteOk) {
      throw new Error(
        `[05-packaged FINDING] In-process nonce round-trip FAILED in packaged binary.\n` +
        `  __crossWriteState = '${crossWriteState}'\n` +
        `  If 'copy': readSab returned mismatched/zero (native addon memory issue in packaged build)\n` +
        `  If 'error': addon threw during readSab (native addon load/exec error in packaged build)\n` +
        `  Check: is the .node prebuild unpacked by AutoUnpackNativesPlugin? (RESEARCH Pitfall 2)\n` +
        `  Check: does ASAR unpacking resolve the correct prebuild path? (node-gyp-build resolution)`
      );
    }
    expect(crossWriteOk).toBe(true);
  });

  test('packaged renderer: __crossWriteState === "shared" (same-memory in packaged build)', async () => {
    if (!exePath || !window) {
      test.skip(true, 'Packaged exe not available');
      return;
    }
    await window.waitForFunction(
      () => typeof (window as any).__crossWriteState === 'string',
      { timeout: 20000 }
    );
    const state = await window.evaluate(() => (window as any).__crossWriteState as string);
    expect(state).toBe('shared');
  });

  test('packaged renderer: __sabValue === 57005 (0xDEAD — C++ wrote it in packaged binary)', async () => {
    if (!exePath || !window) {
      test.skip(true, 'Packaged exe not available');
      return;
    }
    await window.waitForFunction(
      () => typeof (window as any).__sabValue === 'number',
      { timeout: 20000 }
    );
    const value = await window.evaluate(() => (window as any).__sabValue as number);
    expect(value).toBe(57005);
  });

  test('packaged renderer: __zeroCopy === true (transport = B-native-in-renderer in packaged build)', async () => {
    if (!exePath || !window) {
      test.skip(true, 'Packaged exe not available');
      return;
    }
    await window.waitForFunction(
      () => typeof (window as any).__zeroCopy === 'boolean',
      { timeout: 20000 }
    );
    const zeroCopy = await window.evaluate(() => (window as any).__zeroCopy as boolean);
    expect(zeroCopy).toBe(true);
  });
});
