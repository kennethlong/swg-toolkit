# Cross-AI Plan Review — Phase 05.1 — Round 5 (convergence check after W1–W5 fixes)

## What you are reviewing (neutral evidence — treat as given, do NOT assume correct)

Phase 05.1 productizes the model-D live interior-decoration persistence pipeline. It has **15 plans**
(`05.1-01-PLAN.md` … `05.1-15-PLAN.md`) in `.planning/phases/05.1-live-world-editor-productization/`.

- **Round 4** (`05.1-REVIEWS.md`, 5 reviewers) was **NOT CONVERGED**: 2 HIGH + 1 MEDIUM + prose/cite LOWs,
  filed as work-list **W1–W5**. Both HIGHs were NEW interaction seams opened by the round-3 fixes themselves
  (W1: `reconcileMirrorMode` atomic on the flag but not on disk; W2: Undo never calls `refreshTree()` AND
  Plan 14's positional "(NEW)" diff mislabels a restored reindexed row). W3: the R8/M3 `overrideDir === null`
  guard reached `refreshTree()` but not the mirror-toggle (Plan 10) or Remove (Plan 13) call sites.
- **A replan (git commit `667225f`)** then edited **7 of 15 plans** (04, 05, 06, 10, 13, 14, 15) claiming to
  resolve all of W1–W5. Plans 01–03, 07–09, 11, 12 were left untouched. The plan-diff to review is
  `git diff 07958ef..667225f -- .planning/phases/05.1-live-world-editor-productization/`.
- **The internal plan-checker PASSED** the replan with 4 non-blocking warnings (scope density on Plan 01,
  VALIDATION.md staleness since corrected, disclosed-narrowing notes, revision-annotation readability).

**Your job:** independently verify — from YOUR assigned angle only — whether the *current on-disk plans* are
actually correct now, and whether the W1–W5 fixes **opened any NEW seam**. The checker passing is NOT evidence
(rounds 2→3 and 3→4 both passed the checker and the crew then found new HIGHs). Do NOT anchor on the review's
framing or the replan's self-report below.

## The W1–W5 fixes the replan CLAIMS it made (verify, don't trust)

- **W1 → Plan 06:** `reconcileMirrorMode` redesigned as two-phase: validate ALL buildings first, then write;
  rollback-by-inverse-operation on any mid-apply throw. Marked in-plan as a **ROUND-4 DESIGN PICK** (vetoable
  this round). Propagated to Plan 10 (mirror-toggle history-entry wording states an atomic, never-partial
  outcome) and Plan 15 (new live-verify step 11: mixed known/unknown-building toggle-flip).
- **W2 → Plan 13:** `RemoveUndoToast` gained a required `onUndoComplete` prop wired to WorldPanel's shared
  `refreshTree()`. **Plan 14:** the "(NEW)" diff now keyed on content identity
  (`buildingId+cellName+objectTemplateName` count-diff, reusing Plan 04's `refresh()` reconciliation
  algorithm) instead of raw positional row-id. **Plan 15** step 8 extended with a live
  Remove→Undo→refresh→no-"(NEW)" regression check.
- **W3 → Plan 10:** one shared `resolveOverridePair()` helper extracted (used by `refreshTree()` and the
  mirror toggle); **Plan 13:** Remove's click handler consumes the SAME helper instead of an unguarded inline
  resolution.
- **W4 → Plans 04/06/10:** stale prose fixed (one-arg `scanWorldEditorState` line, R9-guard-omission line,
  log()-vs-return-value "PRIMARY" wording).
- **W5 → Plan 10:** `clientLabel` citations corrected to `useChannelReader.ts:272` +
  `LiveSyncClientCard.tsx:159`; **Plan 05:** `channelWriteCapture` call site corrected to `overlay.cpp:443`.

## Ground truth (LOCKED — do not re-derive or contradict; cite these, not the docs)

The real source files these plans wire against (all readable in this repo):
- `packages/renderer/src/services/decorationPersist.ts` — persist path, `sanitizeId` (module-private today), `readInteriorLayoutFileName`
- `packages/contracts/src/workspace.ts` — `WorkspaceBindingMeta` (ends at `liveClientExe` today; the three new fields are what Plan 02 ADDS)
- `packages/renderer/src/state/liveStore.ts` — `clientLabel` is a top-level store field; the `attached` union is `{ kind:'attached'; pid; mappingName }`
- `packages/renderer/src/services/looseOverrideDeploy.ts` — `resolveOverrideDir(cfgPath: string, installRoot?)` (cfgPath non-optional)
- `packages/renderer/src/hooks/useChannelReader.ts`, `packages/renderer/src/components/live/LiveSyncClientCard.tsx`, `packages/agent/src/overlay.cpp` — the W5 citation targets
- Round-3 and round-4 Fable fact-checked all pre-`667225f` citations — do not re-litigate those; only claims NEWLY injected by `667225f` are in scope for fact-checking.

Success criteria SC1–SC5 are in `.planning/ROADMAP.md` (Phase 5.1 section). Locked decisions D-01–D-14 are in `05.1-CONTEXT.md`.

## Output contract

Return markdown. Lead with a one-line verdict: **CONVERGED** or **NOT CONVERGED (n HIGH)**. Then, per finding:
severity (HIGH/MEDIUM/LOW), the exact plan + line/section, the concrete defect, and the minimal fix.
A productive *split* across reviewers (each finds different real issues) is the success signal, not agreement.
If you find nothing real on your axis, say **CONVERGED on <axis>** — do not invent issues to look busy.
