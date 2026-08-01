# YOUR ANGLE (Codex): call-graph trace of the V1/V2/V4/V6/V7 fixes across ALL consumers

Working directory: D:\Code\SWG-Toolkit. Read the preamble context below first, then execute this task.

Trace every touched shared element of commit `3d0a605` through ALL 15 plans (not just the six plans the
work-list named). For each element, enumerate every plan/task that produces, consumes, or describes it,
and verify each site agrees with the new contract. Rounds 3, 4, and 5 each caught a seam fix that reached
some consumers but not all — that is the specific failure mode you are hunting.

1. **The new Undo restore pipeline (V1, Plan 13):** `WorldPanel.tsx` now owns
   `resolveOverridePair()` → `restore(id)` → add-back helper → `refreshTree()`. Enumerate every plan/task
   that describes Undo, restore, or the toast (Plans 13, 14, 15 step 8, anywhere else). Does any site
   still describe the old `onUndoComplete` contract as CURRENT (rather than explicitly historical)? Does
   the add-back helper's write path agree with how ADD (Plan 12?) and Remove (Plan 13) write rows — same
   file, same append/serialize mechanism? Does the null-`resolveOverridePair()` → entry-stays-`pending`
   rule contradict any other plan's description of `pending` lifecycle or the toast timer?
2. **`suppressNextDiffRef` (V2, Plans 13→14):** exactly one producer (Plan 13, set before Undo's
   `refreshTree()`) and one consumer (Plan 14, read+clear). Enumerate EVERY `refreshTree()` caller across
   all 15 plans (persist result, Remove, Undo, ADD confirm, mirror toggle, scene reload, initial mount).
   For each caller: should its refresh be diff-suppressed or not, and does the plan text say so? Is there
   any caller whose refresh will now be wrongly suppressed (ref set but a DIFFERENT refresh consumes it)
   or wrongly un-suppressed?
3. **Mirror-path-keyed rollback (V4, Plan 06):** the rollback now groups by resolved stock mirror path.
   Trace which other plans describe the reconcile/rollback behavior (Plan 10's history message, Plan 15
   step 11) — do they still agree with the new grouping? Does anything still key rollback or failure
   reporting by `buildingId` in a way that conflicts with shared-mirror grouping?
4. **`resolveOverridePair()` returning `studioDir` (V6, Plans 10→13):** enumerate every citation of the
   helper's signature/return shape across all 15 plans. Byte-consistent everywhere? Any call site that
   still derives `studioDir` independently of `pair.studioDir`?
5. **`diskState` on reconcile failures (V7, Plans 06→10):** every citation of `reconcileMirrorMode`'s
   return type across all plans. Does Plan 15 step 11's live-verify wording agree with the
   `'unchanged' | 'uncertain'` semantics?
6. **Dependency graph:** confirm wave/`depends_on` math still holds (acyclic; wave = max(dep waves)+1),
   and that the Plan 13→14 same-file `suppressNextDiffRef` seam is consistent with their declared waves
   and `files_modified` (two plans editing the same `WorldPanel.tsx` — is the ordering/ownership explicit
   enough that the wave-5 plan cannot land without the wave-4 declaration?).

Use `git diff 7f5baca..3d0a605 -- .planning/phases/05.1-live-world-editor-productization/` to scope what
changed; use grep across all 15 plans for the consumer enumeration. Cite plan file + line for every claim.
