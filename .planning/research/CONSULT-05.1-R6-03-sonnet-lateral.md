# YOUR ANGLE (Sonnet): lateral — NEW seams opened by the V-fixes' own interactions

Working directory: D:\Code\SWG-Toolkit. Read the preamble (below) first, then execute this task.

Rounds 3, 4, and 5 each found that the previous round's fixes themselves opened new interaction seams.
Your axis is exactly that: assume every V1–V14 fix is individually correct as written, and hunt for
defects that only appear when two or more of them INTERACT, or when they interact with the untouched
plans (01–03, 05, 07–09, 11, 12). Do not re-litigate the individual fixes.

Candidate interaction surfaces (start here, then go wherever the plans lead — these are prompts, not
answers; several may be fine):

1. **`suppressNextDiffRef` timing (V2) × React batching/async:** the ref is set before Undo's
   `refreshTree()` and cleared by the diff effect on the next `tree` change. What happens if a DIFFERENT
   tree update lands between set and consume (live-sync poll refresh, persist completion, a second rapid
   Undo, mirror toggle)? Whose diff gets wrongly suppressed, and can the restored row then be marked
   "(NEW)" on the following pass? Is the one-shot-ref pattern safe under two Undos in the same toast
   window?
2. **`useEffect(..., [tree])` re-keying (V2) × null-sentinel seeding (V3):** first pass seeds silently;
   suppression also skips a pass. Can a suppressed pass and the seeding pass compose to skip a REAL
   external change (e.g., another building's rows changed on disk during the Undo refresh) that should
   have been marked "(NEW)"— and is that acceptable per the plans' stated "(NEW)" semantics?
3. **Mirror-path-keyed rollback (V4) × per-TEMPLATE mirror ground truth:** two buildings share one
   mirror path. Reconcile Phase-1 validates per building, rollback groups per mirror path. Is there a
   partial-failure ordering where building A's inverse restores bytes that clobber building B's just-
   applied valid write? Does `diskState: 'uncertain'` (V7) cover that composite case or only the
   double-fault?
4. **Undo add-back (V1) × Remove (V5/V12) × ADD "(NEW)" marking (V2/V9):** the restored row re-enters
   via the add-back helper, refresh is suppressed once. What does the SECOND refresh (from any later
   mutation) diff the restored row against — is the count-map baseline updated by the suppressed pass or
   not, and do Plans 13/14 agree on that answer?
5. **Null-`resolveOverridePair()` → entry stays `pending` (V1) × toast timer expiry:** if resolve fails,
   the entry stays pending — what does the user see, does the timer still hard-delete after expiry, and
   does that contradict Plan 15's live-verify script or the gap ledger (g) tab-nav item?
6. **The untouched plans:** does any of 01–03, 05, 07–09, 11, 12 describe refresh/diff/undo/mirror
   behavior in a way the V-fixes just invalidated (stale assumptions rather than stale citations)?

Read the preamble's LOCKED ground truth; the per-TEMPLATE mirror fact is measured, not negotiable. Cite
plan file + section/line for every claim. If an interaction is actually handled, say so and move on — do
not pad.
