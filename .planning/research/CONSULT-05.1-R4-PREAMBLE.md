# Cross-AI Plan Review — Phase 05.1 — Round 4 (convergence check after R1–R13 fixes)

## What you are reviewing (neutral evidence — treat as given, do NOT assume correct)

Phase 05.1 productizes the model-D live interior-decoration persistence pipeline. It has **15 plans**
(`05.1-01-PLAN.md` … `05.1-15-PLAN.md`) in `.planning/phases/05.1-live-world-editor-productization/`.

- **Round 3** (`05.1-REVIEWS.md`, 5 reviewers) was **NOT CONVERGED**: 6 HIGH + several MED/LOW, filed as a
  work-list **R1–R13**. The dominant signal (3 reviewers, 3 angles) was one seam: the
  `worldEditorBuildingTemplates` map → `reconcileMirrorMode` / `refresh` / D-09 mirror-state path was
  *half-propagated*.
- **A replan (git commit `07958ef`)** then edited 13 of 15 plans claiming to resolve **all of R1–R13**.
  Plans 09 and 11 were left untouched.
- **The internal plan-checker PASSED** the replan with only 2 non-blocking scope-density warnings.

**Your job:** independently verify — from YOUR assigned angle only — whether the *current on-disk plans*
are actually correct now, and whether the R1–R13 fixes **opened any NEW seam**. The checker passing is NOT
evidence of correctness (round 2→3, the checker passed and the crew then found 6 new HIGHs on the same
seam). Do NOT anchor on the review's framing or the replan's self-report.

## Ground truth (LOCKED — do not re-derive or contradict; cite these, not the docs)

The real source files these plans wire against (all readable in this repo):
- `packages/renderer/src/services/decorationPersist.ts` — persist path, `sanitizeId` (module-private today), `readInteriorLayoutFileName`
- `packages/contracts/src/workspace.ts` — `WorkspaceBindingMeta` (ends at `liveClientExe` today; the three new fields are what Plan 02 ADDS)
- `packages/renderer/src/state/liveStore.ts` — `clientLabel` is a top-level store field (~:237, set ~:394); the `attached` union is `{ kind:'attached'; pid; mappingName }`
- `packages/renderer/src/services/looseOverrideDeploy.ts` — `resolveOverrideDir(cfgPath: string, installRoot?)` (cfgPath non-optional)
- Round-3 Fable already fact-checked the round-2 citations and found them TRUE — do not re-litigate those; focus on the NEW claims commit `07958ef` injected.

## The R1–R13 fixes the replan CLAIMS it made (verify, don't trust)

- R1 → Plan 06: `reconcileMirrorMode` reads `worldEditorBuildingTemplates ?? {}`, calls two-arg `scanWorldEditorState(overrideDir, map)`, fail-closed on empty `buildingTemplateVfsPath`.
- R2 → Plans 10/13/14: one shared `refreshTree()` re-reads `readWorkspaceJson(studioDir).worldEditorBuildingTemplates` at call time; no site reuses mount-cached `meta`.
- R3 → Plan 04: `refresh()` reconciles `sessionOverlay`/`selectedRowId` by CONTENT identity (`buildingId+cellName+objectTemplateName`) instead of positional `rowIndex`, so a positional `removeNode` can't misattribute badges / emit false "(NEW)".
- R4 → Plan 10: detail card renders the FULL 12-element before/after transform (not translation-only) + a rotate-only regression test (SC5).
- R5 → Plan 04: dropped the `sanitizeId` import; keys the map off the `edit_<id>.ilf` filename suffix; Plan 04 stays wave 0 / `depends_on: []`.
- R6 → Plans 06/10: persist `mirrorToStockIlf` only when `failures.length === 0`; durable failure surfacing.
- R7 → Plans 01/13/15: undo re-add reorders the cell — disclosed, not code-fixed.
- R8 → Plan 10: `useLiveStore((s)=>s.clientLabel)` selector; words-only disabled state when `resolveScanRoot()===null`.
- R9 → Plan 04: guard `cfgPath===undefined` before `resolveOverrideDir`.
- R10 → Plans 13/15: Remove message via `formatPersistMessage`; Plan 15 step-8 reworded; ledger item (e).
- R11 → Plan 02: field moved out of "current" quote; count corrected to "three".
- R12 → Plan 10: `depends_on` includes `05.1-02`.
- R13 → citation nits across 01/03/05/06/07/08/12/15.

Success criteria SC1–SC5 are in `.planning/ROADMAP.md` (Phase 5.1 section). Locked decisions D-01–D-14 are in `05.1-CONTEXT.md`.

## Output contract

Return markdown. Lead with a one-line verdict: **CONVERGED** or **NOT CONVERGED (n HIGH)**. Then, per finding:
severity (HIGH/MEDIUM/LOW), the exact plan + line/section, the concrete defect, and the minimal fix.
A productive *split* across reviewers (each finds different real issues) is the success signal, not agreement.
If you find nothing real on your axis, say **CONVERGED on <axis>** — do not invent issues to look busy.
