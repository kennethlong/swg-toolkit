# Cross-AI Plan Review — Phase 05.1 — Round 6 (convergence check after V1–V14 fixes)

## What you are reviewing (neutral evidence — treat as given, do NOT assume correct)

Phase 05.1 productizes the model-D live interior-decoration persistence pipeline. It has **15 plans**
(`05.1-01-PLAN.md` … `05.1-15-PLAN.md`) in `.planning/phases/05.1-live-world-editor-productization/`.

- **Round 5** (`05.1-REVIEWS.md`, 5 reviewers) was **NOT CONVERGED**: 4 HIGH + 5 MEDIUM/LOW, filed as
  work-list **V1–V14**. The headline: three reviewers on three non-overlapping angles independently found
  V1 (Undo's add-back path could not reach `resolveOverridePair()`). Round 5 called it "the third
  consecutive half-propagated seam round." Both ROUND-4 DESIGN PICKS (two-phase reconcile, Plan 06;
  content-identity "(NEW)", Plan 14) were **upheld in concept** but had mechanism defects (V2/V3/V4).
- **A replan (git commit `3d0a605`)** then edited **6 of 15 plans** (04, 06, 10, 13, 14, 15) claiming to
  resolve all of V1–V14. Plans 01–03, 05, 07–09, 11, 12 were untouched. The plan-diff to review is
  `git diff 7f5baca..3d0a605 -- .planning/phases/05.1-live-world-editor-productization/`.
- **The internal plan-checker PASSED** the replan with 2 non-blocking warnings (the long-disclosed D-02
  despawn scope reduction; Plan 01 task-count density). Rounds 2→5 all passed the checker and the crew
  then found new HIGHs — the checker passing is NOT evidence.

**Your job:** independently verify — from YOUR assigned angle only — whether the *current on-disk plans*
are actually correct now, and whether the V1–V14 fixes **opened any NEW seam**. Do NOT anchor on the
review's framing or the replan's self-report below.

## The V1–V14 fixes the replan CLAIMS it made (verify, don't trust)

- **V1 → Plan 13:** `RemoveUndoToast` made purely presentational — required `onUndo(entry)` prop
  (replacing the prior `onUndoComplete` design), modeled on the precedent at
  `packages/renderer/src/panels/deploy/DeleteUndoToast.tsx:96-101`. `WorldPanel.tsx` now owns the whole
  restore pipeline: `resolveOverridePair()` → `restore(id)` → add-back helper → `refreshTree()`. A null
  `resolveOverridePair()` result leaves the entry in `pending` untouched.
- **V2 → Plans 13+14:** Plan 14's "(NEW)" diff effect re-keyed on the `tree` state reference itself
  (`useEffect(..., [tree])`) instead of `history.length`. Undo's own refresh is silently re-baselined via
  a shared component-local `suppressNextDiffRef` — **set** by Plan 13 (before Undo's `refreshTree()`),
  **consumed+cleared** by Plan 14. Both live in the same file (`WorldPanel.tsx`), landing wave 4 → wave 5.
- **V3 → Plan 14:** `prevTreeRef` initialized to a null sentinel; the first diff pass seeds the baseline
  without marking anything "(NEW)"; the absent-building rule is reversed (a whole building observed for
  the first time ⇒ zero "(NEW)" rows).
- **V4 → Plan 06:** rollback-by-inverse now groups writes/deletes by the **resolved stock mirror path**
  (not `buildingId`) so a shared mirror is never double-acted; `preBytes` on the `'deleted'` branch is
  captured by reading the file BEFORE unlink (never re-derived from any building's `editedIlfBytes`).
- **V5 → Plan 13:** Remove's `mappingName` read uses the explicit narrowed pattern
  `st.kind === 'attached' ? st.mappingName : null`.
- **V6 → Plan 10:** `resolveOverridePair()` selects `studioDir` from `useWorkspaceStore`, guards
  `!studioDir` BEFORE calling `readWorkspaceJson`, and returns `studioDir` as part of the resolved pair.
  Plan 13's call sites consume `pair.studioDir` instead of re-deriving it (also closes V12).
- **V7 → Plans 06+10:** `reconcileMirrorMode` failure entries gain `diskState: 'unchanged' | 'uncertain'`
  (only a rollback double-fault is `'uncertain'`); Plan 10's history message hedges only when an
  `'uncertain'` entry is present.
- **V8 → Plans 06+15:** the Phase-1 validation error names the concrete unblock (delete the orphaned
  `edit_<id>.ilf`); Plan 15 gap-ledger item (f) covers it at sign-off.
- **V9 → Plan 14:** dropped the "reuses Plan 04's algorithm" framing; the count-map mechanism is defined
  entirely in Plan 14 (shares only the identity key + duplicate-ambiguity posture).
- **V10–V14 (LOW):** Plan 04 duplicate `</output>` tag removed; Plan 15 `<verification>` references all
  13 steps; Plan 13 names `pair.studioDir` at the Remove call site; Plan 15 gap-ledger item (g) records
  the panel-scoped toast-lost-on-tab-nav UX gap; Plan 15's round-4 attribution corrected to Fable's
  fact-check axis.

## Ground truth (LOCKED — do not re-derive or contradict; cite these, not the docs)

Byte-verified against the working tree on 2026-08-01 (this round's orchestrator re-checked each):
- `packages/renderer/src/services/decorationPersist.ts:199-203` — the stock-mirror write is
  **per-TEMPLATE** (`mirroredFilePath = path.join(deps.overrideDir, stockIlfVfs)`; log line says
  "per-TEMPLATE — every instance of this layout shows the edit"). Two buildings sharing a template share
  ONE mirror path.
- `packages/renderer/src/state/liveStore.ts:26-31` — `ConnectionStatus` is a discriminated union;
  `attached` arm is `{ kind: 'attached'; pid: number; mappingName: string }`.
- `packages/renderer/src/state/workspaceStore.ts:34` — `studioDir: string | null`.
- `packages/renderer/src/panels/deploy/DeleteUndoToast.tsx:96-101` — `handleUndo` calls
  `useDeleteUndoStore.getState().restore(entry.id)` and logs; the toast itself does no tree/refresh work
  (the presentational precedent V1 cites). NOTE the real path is `panels/deploy/`, not a world dir.
- `packages/renderer/src/services/looseOverrideDeploy.ts` — `resolveOverrideDir(cfgPath: string,
  installRoot?)` (cfgPath non-optional).
- Rounds 3–5 Fable fact-checks confirmed all pre-`3d0a605` citations; only claims NEWLY injected by
  `3d0a605` are in scope for fact-checking.

Success criteria SC1–SC5 are in `.planning/ROADMAP.md` (Phase 5.1 section). Locked decisions D-01–D-14
are in `05.1-CONTEXT.md`.

## Output contract

Return markdown. Lead with a one-line verdict: **CONVERGED** or **NOT CONVERGED (n HIGH)**. Then, per
finding: severity (HIGH/MEDIUM/LOW), the exact plan + line/section, the concrete defect, and the minimal
fix. A productive *split* across reviewers (each finds different real issues) is the success signal, not
agreement. If you find nothing real on your axis, say **CONVERGED on <axis>** — do not invent issues to
look busy.
