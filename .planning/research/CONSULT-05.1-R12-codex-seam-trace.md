# CONSULT — Phase 05.1 plan review, Round 12 — Codex angle: seam-propagation trace

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## LOCKED axioms (measured/proven ground truth — do NOT contradict or re-derive)

1. `channel_binding.cpp` `OpenChannel` (`:113-170`) unconditionally zero-fills the mapping on every
   open (memset `:153-154`). The "channel epoch survives a toolkit restart" premise is FALSIFIED.
2. `DeleteUndoToast.tsx` is exactly 218 lines. `useChannelReader.ts:172` is the `templateName`
   decode line; `:173` is blank.
3. zustand 5.0.14 vanilla `subscribe` is synchronous inside `setState`; the **reset-before-render
   contract (Plan 04) is PROVEN structurally closed** (round-10 Opus derivation). Do NOT re-open
   the false-"restored" race, BB2/BB3/BB22.
4. The **HOST_CMD ACK PROTOCOL state × event table (Plan 08) was CERTIFIED TOTAL** in round 10.
   Do NOT re-litigate table completeness or the reset contract; hunt only for propagation gaps in
   what round 11 (commit `f404d1e`) changed.

## Context (treat as given)

- Plans under review: `05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`.
- Round 11 work-list: `05.1-REVIEWS-round11.md` (items EE1–EE6). Commit `f404d1e` claims to resolve
  all of them; it edited plans 04, 08, 14, 15 + VALIDATION.md. It was a **completeness sweep, not a
  redesign** — the fixes were: (EE1) `setPlacementPending(false)` enumerated on every exit transition
  of the ack table (ack-match, ack-mismatch, timeout, detach, project-switch, unmount) with per-test
  trigger-re-enable assertions; (EE2) the detach transition (row 10) gained the same `slot.studioDir`
  local guard rows 7/9 already had, with a detach-after-switch test and a precedence-prose update;
  (EE3) canonical string 2 carried in full; (EE4) a wrong test-file example replaced; (EE5) local-refuse
  reference made consistent; (EE6) the timeout derivation restated as throttle-symmetry + ledger (n) widened.

## Your angle (do NOT do the other reviewers' angles: citation byte-verification, lateral new-seam hunting, locked-decision/spec math, or commit-diff fact-checking)

**Seam-propagation trace.** For each contract round 11 touched, find EVERY restatement across all 15
plans + VALIDATION.md and verify each was amended consistently — the recurring defect class is "the
fix landed at the cited site while a sibling restatement kept the old form," and round 11's own two
HIGHs (EE1/EE2) were exactly that (a per-transition rule stated once, not everywhere).

1. **`isPlacementPending` / `setPlacementPending` (EE1):** every exit transition of the ack table
   must clear it, at every restatement site — the state-table rows in Plan 08, and Plan 14's
   behavior/action/acceptance/tests/threat-rows/success_criteria. Any exit row (ack-mismatch,
   timeout, detach, project-switch, unmount) that names what it clears but omits the UI mirror? Any
   test asserting re-enable missing for a transition?
2. **Detach `studioDir` guard (EE2):** Plan 08 row 10 cell + the precedence paragraph + Plan 14's
   detach effect must all state detach is now locally guarded (mismatch → silent abort, no record).
   Any site still describing detach as unguarded or still asserting the old "enforcement is LOCAL"
   universal without naming row 10?
3. **Canonical strings (EE3/EE5):** string 2 full-quote and the local-refuse reference — consistent
   at every quoting site in Plans 14/15? Any surviving ellipsis fragment or variant?
4. **Timeout derivation + ledger (n) (EE6):** the throttle-symmetry restatement and the widened
   ledger (n) present at every restatement site (Plans 08/14/15)? Any site still calling the +1 s a
   "worst-case read-lag bound"?

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | claim | evidence (quote the residual wording).
If a contract propagated fully, say so explicitly with the list of sites you checked.
