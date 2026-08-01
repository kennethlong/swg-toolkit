# CONSULT — Phase 05.1 plan review, Round 11 — angle: lateral new-seam hunt

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## LOCKED axioms (measured ground truth — do NOT contradict or re-derive)

1. `channel_binding.cpp` `OpenChannel` zero-fills the mapping on every open (memset `:153-154`). The "channel epoch survives a toolkit restart" premise is FALSIFIED.
2. `DeleteUndoToast.tsx` is exactly 218 lines. `useChannelReader.ts:173` is blank (`:172` is the decode line).
3. The reset-before-render contract (Plan 04, zustand-5 synchronous subscribe) was FORMALLY PROVEN structurally closed in round 10. Do NOT re-open the false-"restored" race, BB3, or BB22 — those are settled. Hunt elsewhere.

## Context (treat as given)

- Plans: `05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`.
- Round-10 work-list: `05.1-REVIEWS-round10.md` (CC1–CC18). Commit `eafec8b` claims to resolve all; it edited plans 04, 08, 10, 11, 12, 13, 14, 15 + VALIDATION.md.
- The big round-10 change: Plan 08's HOST_CMD ACK PROTOCOL became a **13-row total state × event table** (states idle / pending(slot); events place-attempt, ack-match, ack-stale, ack-late, timeout-fire, detach, project-switch, unmount; abort-family-wins precedence; `studioDir`-carrying slot; 11 000 ms timeout = 10 s budget + 1 s throttled-read lag; poll() reordered read-before-liveness; new `isPlacementPending` UI state disabling the "+ Add decoration…" trigger; new durable-surface ledger items (m)/(n)).
- History to assume: in rounds 7, 8, 9 the fixes spawned new HIGH defects nobody was pointed at. Round 10 was the FIRST where a redesign (reset-before-render) survived — but the OTHER redesign (this ack table) is brand new and unreviewed. The CC-items' direct fix quality is other reviewers' job.
- Real sources: `packages/renderer/src/**`, `packages/live-inject/src/**`.

## Your angle (do NOT do the other reviewers' angles: CC-item seam tracing, citation byte-verification, locked-decision/spec math, or commit-diff fact-checking)

**Lateral new-seam hunt.** Find genuinely NEW defects the round-10 edits introduced or newly
exposed — especially interactions the new ack table creates with OLD mechanisms. Hunting grounds
(non-exhaustive; follow the evidence):

1. **`studioDir`-in-slot vs the reset-before-render contract:** the ack effect now re-checks `getState().studioDir`. On a project switch, the reset runs synchronously inside the workspace `set()`; the ack slot is component-local to WorldPanel. Trace the exact ordering of: slot capture, the module-scope reset, WorldPanel's `[studioDir]` effect (which also aborts the slot), and the ack effect's studioDir re-check — is there any interleaving where the re-check reads the NEW studioDir but the slot still holds the OLD request and mis-classifies, or where two abort paths (switch-effect + studioDir-re-check) double-record?
2. **The new 11 s timeout timer vs unmount vs detach vs the ~1 Hz poll throttle:** the timeout is a background `setTimeout` (throttled?); the unmount cleanup clears it; detach stops the poll. Any sequence where the timer, the cleanup, and a real late ack race such that a durable record is written twice, or the `isPlacementPending` UI state gets stuck true (trigger disabled forever)?
3. **`isPlacementPending` UI lock:** what unsticks it on every exit — including unmount-then-remount (does a remount come up with the trigger correctly enabled), detach, and project switch? Any exit that clears the slot but not the UI mirror, or vice versa?
4. **The read-before-liveness poll reorder (CC5):** reordering poll() to process the channel before the liveness check — does that change any OTHER consumer of the poll loop (decoration capture, rebind, existing tests) that assumed liveness-first? Check `useChannelReader.ts` consumers.
5. **Untouched plans (01–03, 05–07, 09):** did the ack-table rewrite change semantics of anything they reference without renaming?
6. Anything else no CC-item covers.

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | the new seam/defect | evidence (quote plan text and, where relevant, real source).
State explicitly which hunting grounds you swept and found clean.
