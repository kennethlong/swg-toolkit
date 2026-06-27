---
id: e2e-deploy-flow-coverage
title: Add automated UI-level (Playwright/Electron) tests for the Phase-4 deploy flow
created: 2026-06-27
origin: Maintainer, during Phase-4 in-client UAT — "Can we not test some of this with Playwright? Let's have a new plan for adding automated UI-level testing."
severity: high (process/quality gap)
area: e2e (Playwright + real Electron) / Phase-4 deploy panels
status: pending
disposition: note now; turn into a real plan (likely its own small phase or a close-out hardening task)
related: staging-workflow-redesign, project-binds-and-automounts-client-tres
---

## Why (the blind spot this closes)

Phase-4 shipped "code-complete, 28/28 renderer tests green," yet the **first three actions in real
in-client UAT each hit a bug the test gate missed**:

1. `child_process` (and all node builtins) externalized by Vite → renderer crash at module load.
2. `openWorkspace` on a non-workspace folder failed **silently** (console-only, no UI feedback).
3. `window.prompt()` in the staging Add… flow → `Error: prompt() is not supported` (Electron drops prompt).

Root cause: the deploy panels have **only vitest/jsdom coverage**, and jsdom stubs exactly what
breaks in real Electron — `child_process` is real in Node, `prompt`/`confirm` are jsdom no-ops, and
Vite's browser-externalization never runs under vitest. These are only observable in a **real Electron
renderer**, which is precisely what Playwright drives and vitest does not.

## What already exists

- `playwright.config.ts` + `e2e/01-boot..05-packaged.spec.ts`, real `_electron.launch` harness,
  `e2e/fixtures/electron-helpers.ts`. Specs run against the built renderer bundle served via the
  `app://` protocol (NOT the Vite dev server) — so specs require a fresh renderer build to reflect
  source changes (e.g. the vite.renderer.config.ts builtins-externalization fix).
- `e2e/04-workspace.spec.ts` covers the **shell only** (4 panels, theme, persistence, real restart).
  **No spec touches the deploy flow.**

## Plan sketch (to expand into a real plan)

New spec `e2e/06-deploy-flow.spec.ts` (real Electron), exercising:

1. **Boot with deploy panels loaded → assert ZERO console errors.** Catches the builtin-externalization
   class immediately (any eager import of `workspaceService`/`packPatch` throws on a bad bundle).
2. **Open a non-workspace folder → assert UI feedback** (confirm-to-create dialog and/or inline error),
   not a silent console-only failure.
3. **New Project → assert the Staging panel replaces the empty state** (exercises real `fs`/`git` in
   the renderer; node builtins must actually work, not just not-crash).
4. **Add… → assert the VirtualPathModal appears** (NOT a `prompt() is not supported` throw) → enter a
   path → assert the staged row + footer counts.
5. **Save version / Deploy… modal opens**; assert Section C slot preview renders (slot >= 30) against a
   **fixture client tree** (don't touch a real install).

### Required test seams (the real work)
- **Stub the native dialogs.** `workspace:pick-dir` / `workspace:pick-file` / `tre:pick-archives` call
  `dialog.showOpenDialog` in `packages/backend/src/main.ts` (:246/:257/:234). Playwright cannot drive
  native dialogs, so stub `dialog.showOpenDialog` via `app.evaluate(...)` (or an env-gated test hook in
  main.ts) to return canned paths pointing at a tmp workspace / fixture file.
- **Fixture client tree** for deploy/cfg-scan assertions (a minimal `swgemu.cfg` + searchTree layout)
  so Section C / packPatch run without a multi-GB real install. Reuse the native-core test fixtures if
  suitable.
- **Build-before-E2E**: ensure the deploy-flow spec runs against a renderer bundle built from current
  source (the existing specs already assume a built `.vite/renderer/main_window/`).
- Mind the existing harness notes: Windows GPU cold-launch flakiness (90s timeouts, retries:2), and
  `05-packaged` reads `PACKAGED_EXE_PATH`.

## Drive surface: Playwright AND an MCP server (design hooks once, share them)

E2E will be driven both by Playwright (real `_electron.launch`) and by a planned **MCP server** that
can exercise the app and assert state. Both need the same thing: a stable, **test-only control +
inspection surface** built into the app.

- **Extend the existing `window.__*` proof-hook pattern** (single owner = `StatusBar.tsx`, already
  consumed by `e2e/` specs) into a deliberate, **env-gated** (`SWG_TEST_MODE`) test-control surface —
  inject dialog responses, trigger actions (open/create workspace, stage, deploy), and read store /
  VFS / deploy state back out. Never ship the hooks live.
- Add these **test hook points as features are built**, not retrofitted — any renderer code touching
  node builtins / `dialog` / `prompt` / `confirm` / IPC / `app://` gets a hook + a real-Electron
  assertion. (See memory `design-test-hook-points-for-harness`.)
- The MCP server's E2E tools call the **same** hook points the Playwright specs use.

## Bigger principle

Any renderer code that touches Electron-only behavior (node builtins via require, `dialog`, `prompt`/
`confirm`, IPC, `app://`) must have at least one **real-Electron E2E** assertion — jsdom green is not
sufficient evidence it runs. Consider a checklist/gate so future phases don't repeat this.

## Severity

High as a process gap (it let a code-complete phase ship three real blockers), even though each
individual fix is small. Worth a dedicated mini-plan rather than ad-hoc spec additions.
