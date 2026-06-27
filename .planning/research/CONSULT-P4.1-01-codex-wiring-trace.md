# CONSULT P4.1-01 — Codex (repo tracer / call-graph): plan-vs-real-code wiring trace

You are reviewing an EXECUTION PLAN for an Electron+React+TS modding tool before it is built.
Your job: trace the plan's assumptions against the REAL current code and find where the plan
references a symbol / line / shape that does NOT exist or does not match. Do NOT redesign. Do NOT
opine on product/UX. Report concrete mismatches only (file:line + what the plan assumes vs what's there).

## Treat as GIVEN (LOCKED — do not re-derive or challenge)
1. Absolute `searchTree_<sku>_<NN>=<absolute path>` values are accepted verbatim by the client (verified vs swg-client-v2 TreeFile.cpp). A `searchTree` value truncates at the first whitespace.
2. v6000 TRE = encrypted, OUT of scope. Standard 0004/0005 zlib in scope. Patch built version='5000'.
3. The Phase-4 deploy ENGINE is reused as-is; this phase is UI composition + wiring + a few fs swaps.

## Read
- Plans: .planning/phases/04.1-deploy-project-ux/04.1-01-PLAN.md … 04.1-11-PLAN.md
- Grounding: .planning/phases/04.1-deploy-project-ux/{04.1-CONTEXT.md, 04.1-RESEARCH.md, 04.1-PATTERNS.md}
- REAL source (this is the ground truth to check the plans against):
  packages/renderer/src/panels/deploy/{StagingPanel,ChangesetTimelinePanel,VcsPanel,DeployDialog,WorkspaceEntry,ActionBadge}.tsx
  packages/renderer/src/services/{packPatch,clientLocator,cfgActivator,changesetService,shadowBaseService,gitLfsService,workspaceService}.ts
  packages/renderer/src/state/{workspaceStore,stagingStore,changesetStore,vcsStore}.ts (+ treStore)
  packages/renderer/src/workspace/workspace-config.ts; packages/renderer/src/shell/{WorkspaceShell,StatusBar}.tsx
  packages/contracts/src/*.ts; backend/src/main.ts; the Phase-1 TreVfsBrowser

## Your angle (ONLY this — others cover deploy-safety, UX, model-invariants)
Verify the plan's CITED wiring points are real and shaped as assumed. Specifically:
- The bug sites the plan targets: cfgActivator.ts duplicate `[SharedFile]` header writer(s); shadowBaseService.ts copy loop (the lines the plan swaps to fs.link); DeployDialog.tsx client-auto-select effect; workspaceService.ts `clientPath: null` hardcode sites.
- The component extraction the plan assumes (StagingPanel body line range → StagingPanelBody; ChangesetTimelinePanel body → VersionHistoryBody): do those line ranges/structure actually exist?
- The auto-mount wiring: does `mountSearchableAsync` / treStore expose the signature the plan's projectBinding.ts calls?
- The IPC centralization (Pattern 8): are the local `require('electron')` casts and the `string[]` handler in backend/src/main.ts where the plan says?
- `BASELINE_ID` now defined in @swg/contracts (plan 01) and imported by plans 03/06 — does the contracts barrel actually re-export it as the plan claims?
- dockview 6.6.1: does `api.clear()` exist (plan 05 layout-version guard relies on it)?

Report: for each, CONFIRMED (real, matches) or MISMATCH (file:line + plan assumption vs reality). Flag any plan task that would fail `tsc --noEmit` or reference a non-existent symbol.
