# CONSULT — Phase 05.1 plan review, Round 12 — angle: lateral new-seam hunt

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## LOCKED axioms (measured/proven ground truth — do NOT contradict or re-derive)

1. `channel_binding.cpp` zero-fills the mapping on every open (memset `:153-154`); the
   epoch-survives-restart premise is FALSIFIED.
2. `DeleteUndoToast.tsx` is 218 lines; `useChannelReader.ts:173` is blank (`:172` is the decode line).
3. zustand 5.0.14 subscribe is synchronous; the **reset-before-render contract is PROVEN closed**
   (round 10). The **ack state × event table was CERTIFIED TOTAL** (round 10). Do NOT re-open either —
   both are settled. Hunt only for what the round-11 completeness sweep (commit `f404d1e`) newly
   introduced or exposed.

## Context (treat as given)

- Plans: `05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`.
- Round-11 work-list: `05.1-REVIEWS-round11.md` (EE1–EE6). Commit `f404d1e` resolved them as a
  **completeness sweep** (no redesign): EE1 = `setPlacementPending(false)` enumerated on every ack-table
  exit transition (+ re-enable tests); EE2 = the detach transition gained the `slot.studioDir` local
  guard; EE3/EE5 = string canonicalization; EE4 = test-file example fix; EE6 = timeout-derivation honesty.
- History to assume: in rounds 7–9 fixes spawned new HIGH defects nobody was pointed at; round 10's
  two redesigns finally held; round 11's two HIGHs were themselves spawned by round-10 fixes (a
  per-transition rule stated once). Round 11's fixes are small and mechanical — but "small completeness
  sweep" is exactly when an over-broad clear or an added guard quietly breaks an adjacent path.
- Real sources: `packages/renderer/src/**`, `packages/live-inject/src/**`.

## Your angle (do NOT do the other reviewers' angles: EE-item seam tracing, citation byte-verification, locked-decision/spec math, or commit-diff fact-checking)

**Lateral new-seam hunt.** Find genuinely NEW defects the round-11 sweep introduced or newly exposed.
Hunting grounds (non-exhaustive; follow the evidence):

1. **The now-ubiquitous `setPlacementPending(false)` clears (EE1):** does clearing the UI mirror on
   EVERY exit — including the ack-MATCH success path and the unmount cleanup — ever fire too eagerly,
   e.g. re-enable the "+ Add decoration…" trigger while a placement is genuinely still in flight, or
   clear it in a remount/StrictMode double-invoke where the fresh `useState(false)` and the cleanup
   race? Does any exit clear the UI mirror but NOT the slot/timer, or vice versa, now that all six
   were edited together?
2. **The detach `studioDir` guard (EE2):** with detach now silently aborting on a studioDir mismatch,
   is there a sequence where a REAL client-exit during/after a project switch is silently swallowed
   (no durable "detached" record when there genuinely should be one for the CURRENT project's pending
   placement)? The guard closes cross-project misattribution — does it open a dropped-legitimate-detach?
3. **Interactions among the six now-identical exit transitions:** any two that can co-occur in one
   commit/tick where the added clears or the added guard change the ordering outcome the round-10
   precedence model assumed?
4. **The EE3/EE6 wording changes:** did widening ledger (n) or restating the timeout derivation
   contradict any success_criteria, threat row, or must_have elsewhere?
5. Untouched plans (01–03, 05–07, 09–13) — anything they assume about placement/pending/detach state
   that the round-11 edits changed semantics of without renaming.
6. Anything else no EE-item covers.

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | the new seam/defect | evidence.
State explicitly which hunting grounds you swept and found clean.
