/**
 * packages/renderer/src/testHooks.ts
 * SWG_TEST_MODE-gated `window.__testHooks` surface (04.4-09 Task 2, D-08).
 *
 * Design: ONE coherent, env-gated, MCP-shaped surface — Playwright specs (plans 13/14) and
 * the future MCP server drive the SAME hook points. Spec-driven (D-08): only the hooks these
 * specs actually need exist here; extend inline as new specs discover a real need. Never
 * shipped active — `installTestHooks()` is a no-op unless SWG_TEST_MODE was active for this
 * launch (mirrors the main-process gate in main.ts).
 *
 * Install site: called as a PLAIN STATEMENT at MODULE SCOPE (not inside a useEffect) from
 * WorkspaceShell.tsx — see that file's import-time call. WorkspaceShell.tsx is unconditionally,
 * statically imported by App.tsx on every boot (verified 2026-07-03 — the Welcome/recents
 * screen is itself one of WorkspaceShell's dockview panels), so `window.__testHooks` exists
 * before React's first render commits — closing the "hooks not ready yet" gap for
 * Welcome/New-Project-screen interactions.
 *
 * GATE MECHANISM (04.4-13 correction — supersedes the original `process.env['SWG_TEST_MODE']`
 * check): VERIFIED EMPIRICALLY (2026-07-04, via a diagnostic build exercised through this
 * plan's own e2e spec) that a bare `process.env['SWG_TEST_MODE']` read INSIDE THIS RENDERER
 * NEVER sees the value Playwright's `electron.launch({ env })` sets — this held true even in
 * the (Node-context, no-bundler-shim) preload script, ruling out a Vite/esbuild
 * process.env-stubbing artifact as the sole cause. Root cause: Chromium's renderer child
 * process does not inherit the full parent (Electron main-process) environment — only a
 * curated subset is forwarded to spawned renderer processes, by design (security/sandboxing),
 * regardless of `nodeIntegration`/`contextIsolation` webPreferences. The main process's OWN
 * `process.env['SWG_TEST_MODE']` read (in main.ts) is unaffected — that check runs in the
 * actual Electron main process, which DOES get the full env Playwright passes.
 *
 * FIX: main.ts forwards the flag to the renderer via `webPreferences.additionalArguments`
 * (`['--swg-test-mode=1']`), Electron's documented mechanism for passing custom data to a
 * renderer process independent of env inheritance — this becomes part of the renderer's own
 * `process.argv`, readable synchronously at module-evaluation time (no retry/async relay
 * needed, unlike the abandoned env-based approach this replaces).
 *
 * Do NOT add speculative hooks with no named consumer (e.g. a getDeployPhase stub) — D-08.
 */

import { useWorkspaceStore } from './state/workspaceStore';
import { useChangesetStore } from './state/changesetStore';
import { listProjects } from './services/projectList';

/** Shape of the test-only control + inspection surface exposed on `window.__testHooks`. */
export interface TestHooks {
  /** Live workspace open status (idle/opening/ready/error) — read without opening a panel. */
  getWorkspaceStatus: () => ReturnType<typeof useWorkspaceStore.getState>['status'];
  /** Live changeset manifest (version graph, active/deployed pointers). */
  getChangesetManifest: () => ReturnType<typeof useChangesetStore.getState>['manifest'];
  /**
   * Project list read — direct pass-through of the already-pure, already-existing
   * listProjects() (projectList.ts). Added (round 2) so 04.4-14's delete/undo spec can assert
   * a project's presence/absence without scraping the DOM.
   */
  listProjects: () => ReturnType<typeof listProjects>;
  /**
   * Stub a dialog IPC channel's canned response (Playwright cannot drive native OS dialogs).
   * Untyped invoke (not TypedIpcRenderer) — 'test:set-stub-paths' is a test-only channel that
   * does not fit IpcChannels' per-channel-return-type shape (see main.ts Task 2 comment) and is
   * gated identically by SWG_TEST_MODE on the main-process side.
   */
  setStubPaths: (channel: string, paths: string[]) => Promise<unknown>;
}

declare global {
  interface Window {
    __testHooks?: TestHooks;
  }
}

/**
 * True when this renderer was launched with the `--swg-test-mode=1` additionalArgument
 * (i.e. main.ts's own `process.env['SWG_TEST_MODE'] === '1'` check was true at BrowserWindow
 * creation time). See file header for why this is read from `process.argv`, not `process.env`.
 */
function isTestModeActive(): boolean {
  return process.argv.includes('--swg-test-mode=1');
}

/**
 * Install the `window.__testHooks` surface. No-op unless SWG_TEST_MODE was active for this
 * launch — both halves (this renderer-side assignment AND the main-process dialog-stub gate
 * in main.ts) independently gate on the SAME underlying flag, so the surface is provably
 * inert in a shipped build (T-04.4-17): main.ts never adds `--swg-test-mode=1` unless its own
 * `process.env['SWG_TEST_MODE'] === '1'` check passed.
 */
export function installTestHooks(): void {
  if (!isTestModeActive()) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ipcRenderer } = require('electron') as {
    ipcRenderer: { invoke(channel: string, ...args: unknown[]): Promise<unknown> };
  };

  window.__testHooks = {
    getWorkspaceStatus:   () => useWorkspaceStore.getState().status,
    getChangesetManifest: () => useChangesetStore.getState().manifest,
    listProjects:         () => listProjects(),
    setStubPaths:         (channel: string, paths: string[]) =>
      ipcRenderer.invoke('test:set-stub-paths', channel, paths),
  };
}
