/**
 * e2e/03-sab-roundtrip.spec.ts
 * SC-4: C++ SAB byte-pattern round-trip + instanceof + SAME-MEMORY nonce cross-write + contracts compile.
 *
 * PATH B ADAPTATION (00-05 plan path_b_adaptation, 2026-06-22):
 *   The original plan described the FALSIFIED cross-process model:
 *     - "utility re-read the renderer's PER-RUN NONCE" (cross-process window.__crossWriteOk)
 *     - "cross-process-nonce language" from the old utility-process relay model
 *     - instanceof-from-utility cross-process SAB delivery
 *
 *   The AS-BUILT Path B proof (see 00-04-SUMMARY.md § Runtime Proof Evidence):
 *     - The native addon runs IN the renderer process (not a utility process)
 *     - StatusBar allocates the SAB in-process, writes 0xDEAD via C++, reads a JS nonce via C++
 *     - "Cross-write" = the renderer writes nonce to view[1], then readSab(sab,1) reads it back
 *       in-process — same-memory confirmed by SAME ADDRESS, not cross-process messaging
 *     - window.__crossWriteOk = (nativeCore.readSab(sab, 1) === nonce) — pure in-process proof
 *     - window.__crossWriteState = 'shared' | 'copy' | 'error' (error = addon threw)
 *
 *   "Cross-process nonce" language is REMOVED and REPLACED with "in-process same-memory" language.
 *   The proof is STRICTLY in-process — same allocator, same pointer, same memory.
 *
 * SINGLE OWNER NOTE:
 *   This spec READS window.__* hooks. It does NOT set them. StatusBar.tsx is the SINGLE OWNER
 *   of all window.__* hooks (per 00-04 single-owner rule). If a hook is missing, that is a
 *   Plan 04 defect to fix in Plan 04 — not patched here.
 *
 * COVERED CRITERIA:
 *   SC-4: __sabValue === 57005 (0xDEAD) — C++ wrote it, renderer read it
 *         __sabIsShared === true — instanceof SharedArrayBuffer confirmed (intra-cluster share)
 *         __crossWriteOk === true — same-memory nonce round-trip holds
 *         __crossWriteState === 'shared' — confirmed same-memory, NOT a copy or error
 *         contracts/ tsc --noEmit passes (FND-04)
 *         SAB_LAYOUT offsets: HELLO_SENTINEL.offset === 0, RENDERER_SENTINEL.offset === 4
 *
 * PERFORMANCE NOTE: A single shared Electron instance (beforeAll/afterAll) is used
 * across all 5 window-based tests to avoid per-test Electron launches that cause
 * Windows resource exhaustion when running the full suite.
 */

import { _electron as electron, test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
// Import SAB_LAYOUT directly in the test runner (not via require in the renderer).
// The contracts package is built to dist/ so the test runner can require it directly.
// The renderer uses the Vite alias (resolved at Vite build time), so window.require
// would need the package.json resolution which differs from Vite's alias path.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SAB_LAYOUT } = require('../packages/contracts/dist/sab-layout.js') as { SAB_LAYOUT: { HELLO_SENTINEL: { offset: number }; RENDERER_SENTINEL: { offset: number } } };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_BINARY = require('electron') as string;
const REPO_ROOT = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// Wait helper: StatusBar sets all hooks once the async proof completes (~1-2s)
// ─────────────────────────────────────────────────────────────────────────────

async function waitForProofComplete(window: Page): Promise<void> {
  // Wait for __crossWriteOk to be set (the LAST hook set in StatusBar's useEffect)
  await window.waitForFunction(
    () => typeof (window as any).__crossWriteOk === 'boolean',
    { timeout: 15000 }
  );
}

test.describe('SC-4: In-process same-memory SAB proof (Path B)', () => {
  // Allow 90s for Electron launch + StatusBar async proof (15s waitForFunction included).
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
    // Wait for StatusBar's async proof to complete
    await waitForProofComplete(window);
  });

  test.afterAll(async () => {
    await electronApp?.close();
  });

  // ── C++ wrote 0xDEAD; renderer read it ────────────────────────────────────

  test('__sabValue === 57005 (0xDEAD — C++ wrote it, renderer read it)', async () => {
    const value = await window.evaluate(() => (window as any).__sabValue as number);
    // 0xDEAD = 57005. C++ called writeSab(sab, 0, 0xDEAD); renderer read Int32Array(sab)[0].
    // This proves the C++→JS direction of in-process same-memory access.
    expect(value).toBe(57005);
  });

  // ── Arrived object is a real SharedArrayBuffer (instanceof check) ──────────

  test('__sabIsShared === true (instanceof SharedArrayBuffer — in-process allocation)', async () => {
    const isShared = await window.evaluate(() => (window as any).__sabIsShared as boolean);
    // StatusBar sets __sabIsShared = (sab instanceof SharedArrayBuffer) AND then
    // overwrites it after the Worker reads the SAB (intra-cluster share confirmation).
    // A structured-clone copy of a non-SAB ArrayBuffer would fail this check.
    expect(isShared).toBe(true);
  });

  // ── Same-memory nonce cross-write (Path B in-process proof) ───────────────

  test('__crossWriteOk === true (same-memory nonce round-trip — NOT a copy or echo)', async () => {
    const crossWriteOk = await window.evaluate(() => (window as any).__crossWriteOk as boolean);
    const crossWriteState = await window.evaluate(() => (window as any).__crossWriteState as string);

    // IMPORTANT: do NOT silently pass if __crossWriteOk is false.
    // A false value means the in-process nonce round-trip failed, which is a
    // significant finding. Surface the triage state:
    //   'copy'  — readSab returned 0 or a mismatched value (memory not shared)
    //   'error' — addon threw during readSab (distinct from copy — different pivot)
    if (!crossWriteOk) {
      throw new Error(
        `[SC-4 FAIL] In-process nonce round-trip failed.\n` +
        `  __crossWriteState = '${crossWriteState}'\n` +
        `  If 'copy': the addon returned a mismatched/zero value (memory not shared in-process)\n` +
        `  If 'error': the addon threw during readSab (addon defect — check native-core logs)\n` +
        `  Either state is a FINDING that must be investigated before closing Phase 0.`
      );
    }

    expect(crossWriteOk).toBe(true);
    expect(crossWriteState).toBe('shared');
  });

  test('__crossWriteState === "shared" (same-memory confirmed, NOT "copy" or "error")', async () => {
    const state = await window.evaluate(() => (window as any).__crossWriteState as string);
    // 'shared' = nonce matched (same memory pointer)
    // 'copy'   = nonce mismatched (data was copied, not shared)
    // 'error'  = addon threw (distinct from copy)
    expect(state).toBe('shared');
  });

  // ── contracts/ tsc --noEmit (FND-04) ──────────────────────────────────────

  test('contracts/ tsc --noEmit passes (FND-04)', () => {
    // shell:true is required on Windows to invoke pnpm (a .cmd shim).
    // The args array uses safe literal strings (no user input), so DEP0190 is not a risk.
    const result = spawnSync('pnpm', ['--filter', '@swg/contracts', 'exec', 'tsc', '--noEmit'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      shell: true,
    });
    if (result.status !== 0) {
      throw new Error(
        `contracts/ tsc --noEmit failed (status ${result.status}):\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`
      );
    }
    expect(result.status).toBe(0);
  });

  // ── SAB_LAYOUT offsets (contracts import check) ───────────────────────────

  test('SAB_LAYOUT.HELLO_SENTINEL.offset === 0 and RENDERER_SENTINEL.offset === 4', () => {
    // SAB_LAYOUT is imported in the test runner (Node.js context) from the built
    // contracts/dist/. The renderer uses the same values via Vite's alias.
    // This test verifies the contracts package exports the expected offsets.
    expect(SAB_LAYOUT.HELLO_SENTINEL.offset).toBe(0);
    expect(SAB_LAYOUT.RENDERER_SENTINEL.offset).toBe(4);
  });
});
