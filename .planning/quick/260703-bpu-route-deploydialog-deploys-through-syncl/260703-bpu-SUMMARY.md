---
phase: 260703-bpu-route-deploydialog-deploys-through-syncl
plan: 01
subsystem: deploy
tags: [deploy, syncLiveToVersion, undo, zustand, react, vitest]

# Dependency graph
requires:
  - phase: 04.3-versioning-and-searchtoc-mount
    provides: syncLiveToVersion engine (H4 record-shape dispatch, loose/cfg cross-model,
      Baseline restore, undo-snapshot push) and the decoupled select-vs-deploy model
provides:
  - DeployDialog.handleDeploy routes ALL three reconcile paths (Baseline-revert,
    loose-override apply, absolute-path apply) through syncLiveToVersion instead of
    duplicating apply/revert logic inline
  - VersionHistoryBody Undo performs a REAL reconcile (restores the prior deployed state
    on the client) via syncLiveToVersion when a client is bound, falling back to
    selection-only when no client is bound
  - syncLiveToVersion's cfg-apply branch correctly handles a brand-new (never-deployed)
    target version via ctx.freshPatchPath/freshSnapshotPath
affects: [deploy-dialog, version-history, undo-redo, cfg-activator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ReconcileCtx.freshPatchPath/freshSnapshotPath — caller-supplied absolute paths that
      take priority over any stored deployRecord field, covering the 'no prior
      deployRecord yet' case for a version deployed for the first time"
    - "Undo dispatch: bound client → real syncLiveToVersion reconcile; unbound client →
      honest degraded selection-only fallback (doSelect)"

key-files:
  created: []
  modified:
    - packages/renderer/src/services/syncLiveToVersion.ts
    - packages/renderer/src/services/syncLiveToVersion.test.ts
    - packages/renderer/src/panels/deploy/DeployDialog.tsx
    - packages/renderer/src/panels/deploy/DeployDialog.test.tsx
    - packages/renderer/src/panels/deploy/VersionHistoryBody.tsx
    - packages/renderer/src/panels/deploy/VersionHistoryBody.test.tsx

key-decisions:
  - "patchName precedence in syncLiveToVersion's cfg-apply branch: ctx.freshPatchPath >
    targetCfgRecord.patchPath (used VERBATIM, never path.basename()'d) > 'patch.tre'
    fallback — closes the silent-placeholder bug for first-time deploys of a version"
  - "newRecord.includeTargetPath now sourced from ctx.cfgPath, not
    insertionRecord.includeTargetPath (which activatePatch always returns as '')"
  - "DeployDialog keeps ALL pre-flight guards and dialog-owned steps (override-dir
    resolution, W1 priority check, packPatch, swgtoolkit.cfg truncation, snapshotCfg,
    ensureInclude) locally; only the reconcile itself (apply/revert/pointer-move) moves
    to syncLiveToVersion"
  - "hardlink-shadow deploy model left untouched — syncLiveToVersion has no shadow-model
    dispatch by design (H4 only covers loose|cfg); todo's acceptance criteria only ban
    inline deployLoose/activatePatch, not deployShadowBase"
  - "VersionHistoryBody.test.tsx's mocked useWorkspaceStore needed a .getState() static
    (it was a bare vi.fn()) since handleUndo reads clientPath via getState(), matching
    DeployDialog's existing boundClientPath pattern — fixed as part of this plan since
    the new production code depends on it"

requirements-completed: [DEPLOY-03, DEPLOY-08, VER-04]

# Metrics
duration: single session
completed: 2026-07-03
---

# Phase 260703-bpu: Route DeployDialog deploys through syncLiveToVersion Summary

**DeployDialog.handleDeploy and VersionHistoryBody's Undo now both call the syncLiveToVersion reconcile engine instead of duplicating apply/revert logic inline — Undo comes alive because the engine is the only place undo snapshots are pushed.**

## Performance

- **Duration:** single session
- **Tasks:** 3/3 completed
- **Files modified:** 6

## Accomplishments

- Fixed a silent bug in `syncLiveToVersion`'s cfg-apply branch: a first-time deploy of a
  version with no prior `deployRecord` would write the literal placeholder `'patch.tre'`
  (or a `path.basename()`-truncated path) as the searchTree value instead of the real
  patch path. Added `ReconcileCtx.freshPatchPath`/`freshSnapshotPath` so the caller can
  supply the real absolute paths it just built/snapshotted.
- `DeployDialog.handleDeploy`'s three reconcile branches (Baseline-revert, loose-override
  apply, absolute-path apply) now call `syncLiveToVersion` exclusively — zero direct
  `deployLoose`/`activatePatch` calls remain in `handleDeploy` (verified by grep; the only
  remaining `deactivatePatch` call is in the untouched `handleReset`).
- `VersionHistoryBody`'s Undo affordance (button + Ctrl+Z) now performs a real reconcile
  via `syncLiveToVersion` when a client is bound — restoring the prior deployed state on
  the client, not merely re-selecting the prior version. Falls back to the previous
  selection-only behavior when no client is bound (genuinely no live state to restore).
- Added a new `syncLiveToVersion` test case (g) and a new `DeployDialog` test (Test 8)
  proving the engine is called with the correct `ReconcileCtx` and that
  `activatePatch`/`deployLoose` are never called directly.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix syncLiveToVersion's cfg-apply path for a brand-new (never-deployed) target version** - `2b2de32` (fix)
2. **Task 2: Route DeployDialog.handleDeploy through syncLiveToVersion** - `58d9c91` (feat)
3. **Task 3: Rewire VersionHistoryBody's Undo; add DeployDialog engine-call test** - `faf2acd` (feat)

_Note: tdd="true" on Task 3 — RED/GREEN not applicable in the strict sense (behavior was
added to existing files alongside its test in the same commit, per the task's own
"write test + implementation together" structure); test coverage was verified passing
before commit._

## Files Created/Modified

- `packages/renderer/src/services/syncLiveToVersion.ts` - Added `ReconcileCtx.freshPatchPath`/`freshSnapshotPath`; fixed cfg-apply patchName precedence and `newRecord.includeTargetPath` source
- `packages/renderer/src/services/syncLiveToVersion.test.ts` - Added test case (g) for the fresh-deploy-no-prior-record scenario
- `packages/renderer/src/panels/deploy/DeployDialog.tsx` - `handleDeploy`'s three reconcile branches now call `syncLiveToVersion`; removed direct `deployLoose`/`activatePatch` imports and calls
- `packages/renderer/src/panels/deploy/DeployDialog.test.tsx` - Added Test 8 (mocks `syncLiveToVersion`, asserts it's called with the correct ctx and that `activatePatch`/`deployLoose` are not)
- `packages/renderer/src/panels/deploy/VersionHistoryBody.tsx` - `handleUndo` now dispatches to `syncLiveToVersion` (bound client) or `doSelect` (no client bound)
- `packages/renderer/src/panels/deploy/VersionHistoryBody.test.tsx` - Fixed mocked `useWorkspaceStore` to expose `.getState()`; updated the two pre-existing Undo tests for the new bound-client engine-call behavior; added a third test for the unbound-client fallback

## Decisions Made

See `key-decisions` in frontmatter. Most notable: the patchName/includeTargetPath fix in
`syncLiveToVersion` (Task 1) was a prerequisite bug-fix the todo explicitly flagged as a
"Watch out" — without it, routing DeployDialog's absolute-path model through the engine
would have silently broken the D-05 absolute-path deploy model for any version's first
deploy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] VersionHistoryBody.test.tsx's mocked `useWorkspaceStore` lacked `.getState()`**
- **Found during:** Task 3 full-suite verification run
- **Issue:** The pre-existing test file fully mocks `useWorkspaceStore` as a bare `vi.fn()`
  (selector-hook shape only). The new `handleUndo` reads `clientPath` via
  `useWorkspaceStore.getState().clientPath` (matching `DeployDialog`'s existing
  `boundClientPath` pattern) — this threw `TypeError: useWorkspaceStore.getState is not a
  function` and caused 2 unhandled promise rejections plus 2 failing tests.
- **Fix:** Attached a `.getState()` implementation to the mocked `useWorkspaceStore` in
  `setupDefaultMocks`, added a `clientPath` override parameter, and updated the two
  affected tests to assert the new bound-client `syncLiveToVersion` call (adding a third
  test for the unbound-client `doSelect` fallback path for full behavior coverage).
- **Files modified:** `packages/renderer/src/panels/deploy/VersionHistoryBody.test.tsx`
- **Verification:** Full renderer suite green (272 passing, 0 unhandled errors)
- **Committed in:** `faf2acd` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix in a pre-existing test mock)
**Impact on plan:** Necessary to satisfy the plan's own "full renderer suite stays green"
done-criteria for Task 3; no scope creep — the fix is scoped to the test mock and the two
tests whose behavior the plan explicitly changed.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `syncLiveToVersion` is now the single reconcile entry point exercised by both DeployDialog
  (forward deploy paths) and VersionHistoryBody (Undo) — the todo
  `.planning/todos/pending/deploy-dialog-synclive-undo-wiring.md` is resolved and can be
  moved to done/resolved.
- Full renderer suite: 272 passing (up from 269), typecheck clean.
- No blockers identified for subsequent phases.

---
*Phase: 260703-bpu-route-deploydialog-deploys-through-syncl*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 6 key-files verified present on disk; all 3 task commits (`2b2de32`, `58d9c91`,
`faf2acd`) verified present in `git log --oneline --all`.
