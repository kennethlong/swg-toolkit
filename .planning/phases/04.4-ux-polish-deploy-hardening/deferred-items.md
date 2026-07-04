# Deferred Items — Phase 04.4

Out-of-scope discoveries logged during plan execution (Scope Boundary rule). Not fixed —
tracked here for follow-up.

## From 04.4-09 (E2E test infrastructure)

### e2e/04-workspace.spec.ts: two pre-existing failures, confirmed unrelated to 04.4-09

**Discovered during:** Task 1 verification (running the full lean-job E2E spec set locally
to confirm the new CI build step doesn't regress anything).

**Why this matters:** Before 04.4-09, the CI lean job never ran a build step, so
`e2e/04-workspace.spec.ts` (already in the lean job's spec list) could never have actually
run to completion in a clean CI checkout — `.vite/build/main.js` didn't exist. Once 04.4-09's
build step lands, this spec runs for real for the first time, and **CI will go red** on these
two pre-existing bugs. This is a side effect of closing the build gap, not a regression
introduced by 04.4-09 — confirmed via a controlled A/B test (see below).

**Failure 1 — "four panels are visible" (`.dv-default-tab-content` text 'Welcome' not found,
line 91):**
- `SidebarPanel.tsx` sets the initial dockview tab title to the hardcoded `'Assets'` in
  `workspace-config.ts`'s `buildInitialLayout`, then flips it to `'Welcome'` (when no
  workspace is open) via a `useEffect` calling `props.api.setTitle(panelTitle)`.
- The test looks for exact text `'Welcome'` within a 5000ms timeout; the tab title update
  either doesn't fire, fires too late, or the `try/catch` around `props.api.setTitle` is
  silently swallowing an error ("api unavailable in some test envs" — `SidebarPanel.tsx`'s own
  comment).
- Not investigated further (`SidebarPanel.tsx` / `workspace-config.ts` are not in 04.4-09's
  file scope).

**Failure 2 — "theme change persists" (`page.selectOption` times out at 30000ms waiting for
`select[aria-label="Select theme"]`, line 121):**
- The selector exists in current source (`Titlebar.tsx:129`), so this is not a stale
  locator — something prevents Playwright from finding/interacting with it within the shared
  Electron instance for this describe block.
- Possibly related to Failure 1 (same app instance, same describe block) — or an independent
  issue. Not investigated further (`Titlebar.tsx` is not in 04.4-09's file scope).

**Confirmation this is NOT caused by 04.4-09's changes:** Ran `e2e/04-workspace.spec.ts` twice
back-to-back — once with `WorkspaceShell.tsx`'s new `installTestHooks()` call active, once
with it commented out (A/B test, `SWG_TEST_MODE` unset both times so the call is a no-op
either way). Both runs failed identically on Failure 1. This isolates the failures to
pre-existing code, not the 04.4-09 diff.

**Recommendation:** File a follow-up todo (e.g. `e2e-04-workspace-welcome-theme-select-flake`)
to root-cause `SidebarPanel.tsx`'s title-update timing and the Titlebar theme-select
interaction before/alongside the next phase that touches the workspace shell. Until fixed,
the lean CI job will show 2 failing tests in `e2e/04-workspace.spec.ts` on every run.

### logService.test.ts: 7 pre-existing vitest failures (environment: 'node' vs jsdom globals)

**Discovered during:** Task 2 verification (`pnpm test` full suite run).

**Not touched by 04.4-09** (no `logService.ts`/`logService.test.ts` in this plan's files).
Failures are `ReferenceError: ErrorEvent is not defined` / `ReferenceError: window is not
defined` — `vitest.config.ts` sets `environment: 'node'` project-wide, but
`logService.test.ts` (from 04.4-02) exercises `window.addEventListener('error', ...)` and
`ErrorEvent`, which don't exist in a plain Node environment. Confirmed pre-existing by
checking `git status` before committing — these files were never modified in this session.

**Recommendation:** `logService.test.ts` likely needs a per-file `// @vitest-environment jsdom`
pragma, or the suite needs a jsdom project split. Follow-up for whichever plan next touches
`logService.ts`.
