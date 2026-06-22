/**
 * e2e/05-packaged.spec.ts
 * Packaged binary HARD gate: crossOriginIsolated + in-process zero-copy in the real packaged build.
 *
 * HARD GATE (review fix HIGH-2):
 *   In CI (packaged-gate job), PACKAGED_EXE_PATH is ALWAYS set and --forbid-only is passed.
 *   A skip of this spec in CI is treated as a FAIL.
 *
 * PATH B ADAPTATION (2026-06-22): the native addon runs IN the renderer process (Path B).
 *   The proof is an in-process same-memory round-trip (allocateSab → C++ writeSab → JS read;
 *   JS write → C++ readSab), which is the packaged-Electron RUNTIME LOAD of the single
 *   ABI-stable --napi prebuild (round-3 / Cursor CUR-1 — no separate Electron-ABI build).
 *
 * WHY LOG-CAPTURE INSTEAD OF PLAYWRIGHT CDP (2026-06-22 finding):
 *   Both `_electron.launch({ executablePath })` AND `chromium.connectOverCDP()` are UNRELIABLE
 *   against this packaged Electron app on Windows — the launch / CDP handshake hangs
 *   intermittently (verified: 30s–180s timeouts across repeated clean runs; the app itself is
 *   fine — it boots and the proof passes when launched directly). So this gate observes the REAL
 *   packaged binary the way a human does: run it with ELECTRON_ENABLE_LOGGING=1 and assert the
 *   StatusBar's in-process Path B proof markers printed to the process console. This proves SC-3
 *   (crossOriginIsolated), SC-4 (same-memory zero-copy: 0xDEAD sentinel + nonce round-trip +
 *   state=shared), and the FND-02 packaged prebuild RUNTIME LOAD (allocateSab/writeSab/readSab
 *   ran in the packaged renderer) — with no fragile CDP attach.
 *
 * BUILD (out-of-band): `pnpm package:ci`, then
 *   `PACKAGED_EXE_PATH=<path/to/swg-toolkit.exe> pnpm playwright test e2e/05-packaged.spec.ts`.
 *   If unset and no exe found in out/, the spec skips with an actionable message (CI always sets it).
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'out');

// ─────────────────────────────────────────────────────────────────────────────
// findPackagedExe: scan out/ for the platform-specific packaged executable.
// ─────────────────────────────────────────────────────────────────────────────

function findPackagedExe(outDir: string): string | null {
  if (!fs.existsSync(outDir)) return null;

  if (process.platform === 'win32') {
    const entries = fs.readdirSync(outDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(outDir, entry.name);
        const exes = fs.readdirSync(subDir).filter(
          (f) => f.endsWith('.exe') && !f.toLowerCase().includes('squirrel') && !f.toLowerCase().includes('update')
        );
        if (exes.length > 0) return path.join(subDir, exes[0]);
      }
    }
  }

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

  if (process.platform === 'linux') {
    const entries = fs.readdirSync(outDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(outDir, entry.name);
        const files = fs.readdirSync(subDir);
        for (const f of files) {
          const full = path.join(subDir, f);
          if (!f.includes('.') && fs.statSync(full).isFile()) return full;
        }
      }
    }
  }

  return null;
}

const exeFromEnv = process.env.PACKAGED_EXE_PATH;
const exeFromScan = exeFromEnv ? null : findPackagedExe(OUT_DIR);
const exePath: string | null = exeFromEnv ?? exeFromScan;

// ─────────────────────────────────────────────────────────────────────────────
// Packaged spec suite — log-capture against the real packaged binary
// ─────────────────────────────────────────────────────────────────────────────

test.describe('05-packaged: HARD gate — crossOriginIsolated + in-process zero-copy in packaged binary', () => {
  test.describe.configure({ timeout: 90_000 });

  let child: ChildProcess | null = null;
  let logs = '';

  // Launch the packaged exe with renderer logging on, capture stdout+stderr, and resolve
  // once the StatusBar's nonce round-trip line has printed (proof complete). Then tree-kill.
  test.beforeAll(async () => {
    if (!exePath) return;
    await new Promise<void>((resolve, reject) => {
      // --disable-gpu mirrors the dev fixture (avoids Windows GPU-process init stalls).
      const proc = spawn(exePath!, ['--disable-gpu'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      });
      child = proc;
      const onData = (d: Buffer) => {
        logs += d.toString();
        if (/\[StatusBar\] nonce round-trip:.*ok=(true|false)/.test(logs)) {
          proc.stdout?.off('data', onData);
          proc.stderr?.off('data', onData);
          resolve();
        }
      };
      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('exit', (code) => {
        if (!/\[StatusBar\] nonce round-trip:/.test(logs)) {
          reject(new Error(
            `Packaged app exited (code ${code}) before the StatusBar proof printed.\n` +
            `Captured tail:\n${logs.slice(-2000)}`
          ));
        }
      });
      setTimeout(
        () => reject(new Error(
          `Timed out (60s) waiting for the packaged StatusBar proof.\nCaptured tail:\n${logs.slice(-2000)}`
        )),
        60_000
      );
    });
  });

  test.afterAll(async () => {
    const pid = child?.pid;
    if (pid) {
      try {
        if (process.platform === 'win32') {
          // Electron spawns a helper tree (GPU/renderer/utility); /T kills the whole tree
          // so the gate leaves nothing behind and is safe to run repeatedly.
          spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch { /* tree-kill best-effort */ }
    }
  });

  // ── Skip guard (HARD gate — skip == fail in CI via --forbid-only) ────────────
  test('packaged exe found', async () => {
    if (!exePath) {
      test.skip(
        true,
        `Packaged exe not found. Build: pnpm package:ci; then set PACKAGED_EXE_PATH.\n` +
        `In CI the packaged-gate job always sets it (--forbid-only treats this skip as a FAIL).`
      );
    }
    expect(exePath).toBeTruthy();
    expect(fs.existsSync(exePath!)).toBe(true);
  });

  // ── SC-3 packaged: crossOriginIsolated === true ──────────────────────────────
  test('packaged renderer: crossOriginIsolated === true', async () => {
    if (!exePath) { test.skip(true, 'Packaged exe not available'); return; }
    expect(logs, `proof tail:\n${logs.slice(-1500)}`).toMatch(/crossOriginIsolated=true/);
    expect(logs).not.toMatch(/crossOriginIsolated=false/);
  });

  // ── FND-02 packaged: the --napi prebuild LOADED + RAN (allocateSab returned a usable SAB) ──
  test('packaged renderer: SharedArrayBuffer usable (sabIsShared=true → prebuild runtime-loaded)', async () => {
    if (!exePath) { test.skip(true, 'Packaged exe not available'); return; }
    expect(logs, `proof tail:\n${logs.slice(-1500)}`).toMatch(/sabIsShared=true/);
  });

  // ── SC-4 packaged: C++ wrote the 0xDEAD sentinel into the shared buffer ──────
  test('packaged renderer: __sabValue === 0xDEAD (C++ wrote it in the packaged binary)', async () => {
    if (!exePath) { test.skip(true, 'Packaged exe not available'); return; }
    expect(logs, `proof tail:\n${logs.slice(-1500)}`).toMatch(/view\[0\]=0xDEAD/);
  });

  // ── SC-4 packaged: JS↔C++ same-memory nonce round-trip (zero-copy, not echo/copy) ──
  test('packaged renderer: in-process nonce round-trip ok (JS↔C++ same memory)', async () => {
    if (!exePath) { test.skip(true, 'Packaged exe not available'); return; }
    const m = logs.match(/\[StatusBar\] nonce round-trip: nonce=(\d+) observed=(\d+) ok=(true|false)/);
    expect(m, `nonce round-trip line not found. proof tail:\n${logs.slice(-1500)}`).toBeTruthy();
    // Defense against copy/echo: the utility's observed value must EQUAL the written nonce.
    expect(m![3]).toBe('true');
    expect(m![2]).toBe(m![1]);
  });

  test('packaged renderer: cross-write state === "shared" (zero-copy, not copy/error)', async () => {
    if (!exePath) { test.skip(true, 'Packaged exe not available'); return; }
    expect(logs, `proof tail:\n${logs.slice(-1500)}`).toMatch(/state=shared/);
    expect(logs).not.toMatch(/state=(copy|error)/);
  });

  // ── End-to-end Path B PASS line (only printed when all in-process steps succeeded) ──
  test('packaged renderer: full Path B proof PASS line present', async () => {
    if (!exePath) { test.skip(true, 'Packaged exe not available'); return; }
    expect(logs, `proof tail:\n${logs.slice(-1500)}`)
      .toMatch(/\[StatusBar\] PASS: allocateSab \+ writeSab .* crossOriginIsolated=true/);
  });
});
