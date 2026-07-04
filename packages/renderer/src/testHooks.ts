/**
 * packages/renderer/src/testHooks.ts
 * SWG_TEST_MODE-gated `window.__testHooks` surface (04.4-09 Task 2, D-08).
 *
 * Design: ONE coherent, env-gated, MCP-shaped surface — Playwright specs (plans 13/14) and
 * the future MCP server drive the SAME hook points. Spec-driven (D-08): only the hooks these
 * specs actually need exist here; extend inline as new specs discover a real need. Never
 * shipped active — `installTestHooks()` is a no-op unless `SWG_TEST_MODE=1` is set in the
 * renderer process's environment (mirrors the main-process gate in main.ts Task 1).
 *
 * Install site: called as a PLAIN STATEMENT at MODULE SCOPE (not inside a useEffect) from
 * WorkspaceShell.tsx — see that file's import-time call. WorkspaceShell.tsx is unconditionally,
 * statically imported by App.tsx on every boot (verified 2026-07-03 — the Welcome/recents
 * screen is itself one of WorkspaceShell's dockview panels), so `window.__testHooks` exists
 * before React's first render commits — closing the "hooks not ready yet" gap for
 * Welcome/New-Project-screen interactions.
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
 * Install the `window.__testHooks` surface. No-op unless `SWG_TEST_MODE=1` — both halves
 * (this renderer-side assignment AND the main-process dialog-stub gate in main.ts) check the
 * same env var independently, so the surface is provably inert in a shipped build (T-04.4-17).
 */
export function installTestHooks(): void {
  if (process.env['SWG_TEST_MODE'] !== '1') return;

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
