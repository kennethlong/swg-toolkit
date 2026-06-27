# CONSULT P4-R2-01 — Codex — Phase 4 REVISED-plan wiring audit (delta-focused)

The Phase 4 plans were REVISED (commit 34d0d56) to implement a version-graph deploy/revert model and
fix a prior cross-AI review (04-REVIEWS.md). Audit the REVISED plans for wiring/compile breaks against
the REAL existing code. Focus on what CHANGED; don't re-litigate confirmed-correct items.

## LOCKED axioms (given — do not re-derive)
- Native `buildTre(entries,'5000')` + `{path,data,tombstone}` is valid (already confirmed last round).
- `searchTree_<sku>_<NN>=` mechanics + LAST-wins maxSearchPriority are confirmed ground truth.

## Plans to audit (read these — they are the REVISED set)
- `.planning/phases/04-edit-deploy-loop/04-01-PLAN.md` (contracts: FileDelta, SwgChangeset+parentId, WorkspaceChangesetManifest+activeVersionId/deployedVersionId; stores; workspaceService; B5 renderer `test` script; W4/W5/W6/N1/N3)
- `04-03-PLAN.md` (B1 full `.include`-chain scanSharedFile + LAST-wins; B6/N2 buildPatchName; W9 line-surgery deactivatePatch)
- `04-04-PLAN.md` (REWRITE — version-graph engine: flatten() path-walk last-writer-wins, sealVersion()+parentId, selectVersion() materializes staging, N4 dup guard)
- `04-04b-PLAN.md` (NEW — ChangesetTimelinePanel)
- `04-06-PLAN.md` (DeployDialog — flatten→packPatch, deployingRef mutex W9, setDeployedVersion)
- `04-06b-PLAN.md` (shadow-base: patchPath at highest slot B4, async copy B7, W4 path.relative, W8 .tmp cleanup)
- refs: `04-CONTEXT.md` (D-04-05..08 refined), `04-UI-SPEC.md` (NEW "Layout" section: Deploy is a TAB in the inspector group, default ~380px), `04-PATTERNS.md`

## Your angle — verify the DELTAS against real code (cite file:line)
1. **B5:** does `packages/renderer/package.json` really lack a `test` script today, and is the plan's added `"test":"vitest run"` correct for how this monorepo runs vitest (hoisted vitest + per-package `vitest.config.ts`)? Will `pnpm --filter @swg/renderer test` then work?
2. **Contracts (04-01):** do the new types (`FileDelta`, `SwgChangeset` w/ `parentId`, `WorkspaceChangesetManifest` w/ `activeVersionId`+`deployedVersionId` as STRINGS) and the store shape (string IDs, `restoreEntries`, `hasStaleDeployment`) compile and resolve across the importers (packPatch/changesetService/DeployDialog/timeline)? Any dangling/contradictory type?
3. **04-04 engine wiring:** does `selectVersion()` actually call into the staging store (`restoreEntries(flatten(id))`) using real store APIs? Does `flatten()` read the per-version stored bytes from `.studio/changesets/<id>/` via a real path it constructs? Any place it references a field/function not defined in 04-01?
4. **04-04b timeline + 04-02 panel registration:** the UI-SPEC now says register Staging + Timeline as TABS in the **inspector group** (not standalone panels) via `addPanel` position, default width ~380px. Do the plans match that, or do they still register standalone panels? Check the REAL `workspace-config.ts` `buildInitialLayout` (referenced by W3) for how `addPanel` position/group works and whether the plan's instructions are valid against it.
5. **04-06 / 04-06b:** does `deployShadowBase` now actually receive + use `patchPath` (B4)? Is the deploy-record state (W2) actually held somewhere the Reset handler can read it? Does the `deployingRef` mutex (W9) reference real state?
6. Any NEW dangling import, wrong module path, or non-existent symbol introduced by the revision.

Report cited findings ranked BLOCKER > WARNING > NIT. Confirm briefly where the revision is correct. Be specific — file:line.
