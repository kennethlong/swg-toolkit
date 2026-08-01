# CONSULT — Phase 05.1 plan review, Round 12 — angle: locked-decision fidelity & spec math

Authorization context: this is the maintainer's own open-source Star Wars Galaxies modding toolkit.
The "live" features connect to a game client process the maintainer runs and owns on their own
machine (SWGEmu/private-server modding, explicitly permitted). You are reviewing PLANNING DOCUMENTS
for internal consistency — no code is written or executed in this task.

You are one of five independent reviewers. Work only from files on disk. Report facts with file:line
evidence. Do not soften findings.

## LOCKED axioms (measured/proven ground truth — do NOT contradict or re-derive)

1. `channel_binding.cpp` `OpenChannel` (`:113-170`) zero-fills at `:153-154`; BB4 (epoch-survives-
   restart) is FALSIFIED. `DeleteUndoToast.tsx` is 218 lines; `useChannelReader.ts:172` decode / `:173` blank.
2. zustand 5.0.14 subscribe is synchronous; **reset-before-render is PROVEN closed** (your own round-10
   CLEAN-2). The **ack state × event table is TOTAL** (your own round-10 finding). Prior CLEAN-3/4/5
   stand unless round 11 touched them. Do NOT re-open settled items — assess only the round-11 deltas.

## Context (treat as given)

- Plans: `05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`; locked decisions in
  `05.1-CONTEXT.md` (disclosure remedy for D-02/D-03/D-06/D-09/D-12; ledger items through (n)).
- Round-11 work-list: `05.1-REVIEWS-round11.md` (EE1–EE6). Commit `f404d1e` resolved them as a
  completeness sweep. Round-11's two HIGHs were EE1 (`isPlacementPending` cleared "on every exit row"
  in prose but not operationalized per-transition) and EE2 (the detach transition — a store-writing
  exit — missing the `slot.studioDir` local guard that rows 7/9 had, falsifying the precedence
  paragraph's "enforcement is LOCAL" universal for the detach-vs-switch pair). Both were fixed in
  `f404d1e`; EE6 restated the 11 s timeout margin as throttle-symmetry and widened ledger (n).

## Your angle (do NOT do the other reviewers' angles: cross-plan seam tracing, citation byte-verification, lateral new-seam hunting, or commit-diff fact-checking)

**Locked-decision fidelity & spec math — focused on the round-11 deltas.**

1. **EE2 detach-guard soundness — does adding the guard make the precedence model actually TOTAL now?**
   With rows 7 (ack), 9 (timeout), and now 10 (detach) all re-checking `slot.studioDir`, is the
   precedence paragraph's universal ("enforcement is LOCAL, never declaration-order dependent") finally
   true for EVERY store-writing exit pair? Enumerate the exit transitions that WRITE (record a durable
   entry / set badge) vs. those that silently abort, and confirm each writing exit is locally guarded.
   Is there any remaining exit pair whose ordering still depends on hook declaration order? Does the
   detach guard's "silent abort on mismatch" correctly preserve a LEGITIMATE detach for the current
   project (i.e., it aborts only the cross-project case, not a real same-project client-exit)?
2. **EE1 completeness — is the `isPlacementPending` lifecycle now a total function over the table?**
   Every entry sets it true (place-attempt); every exit clears it. Confirm no reachable state leaves
   it stuck true OR clears it while a placement is still genuinely pending. Check the ack-MATCH path
   (does success clear it at the right moment vs. the toast), and the unmount path (fresh mount's
   `useState(false)` vs. the cleanup).
3. **EE6 disclosure math:** the timeout derivation is now "throttle symmetry, not a +1 s bound," and
   ledger (n) names renderer-side read starvation. Verify: does the throttle-symmetry argument actually
   hold (the timeout `setTimeout` and the poll are throttled by the same clock, so a late read and a
   late timeout move together)? Is ledger (n)'s widened scope consistent with every restatement site
   and with D-12? Any NEW narrowing introduced by the rewording without a ledger item?
4. **must_have satisfiability across the 4 edited plans** after the sweep — any pair now contradictory
   under a reachable state (e.g. an "always re-enabled after any exit" mirror truth vs. a "trigger
   disabled while pending" truth)?

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | claim | the contradiction/hole as a concrete event sequence.
If a dimension is clean, say so explicitly with what you checked (and note whether a prior-round CLEAN finding still holds).
