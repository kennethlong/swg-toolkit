# CONSULT — Phase 05.1 plan review, Round 10 — angle: lateral new-seam hunt

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## LOCKED axioms (measured ground truth — do NOT contradict or re-derive)

1. `channel_binding.cpp` `OpenChannel` zero-fills the mapping on every open (memset at `:153-154`).
   The "channel epoch persists across toolkit restart" premise is FALSIFIED — do not resurrect it.
2. `DeleteUndoToast.tsx` is exactly 218 lines.

## Context (treat as given)

- Plans: `.planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`.
- Round-9 work-list: `05.1-REVIEWS-round9.md` (BB1–BB23). Commit `751464a` claims to resolve all; it edited 10 plans + VALIDATION.md and introduced two canonical specs: Plan 08's HOST_CMD ACK PROTOCOL (state machine, six exits: local-refuse / resolved-success / resolved-refused / timed-out / aborted-detach / aborted-switch; 10 s timer; durable failure records) and Plan 04's PROJECT-SWITCH RESET ORDERING CONTRACT (module-scope zustand vanilla subscribe on `useWorkspaceStore`, resetting project-scoped stores synchronously inside the studioDir-changing `set()`, before React re-renders).
- History to assume: in rounds 7, 8, AND 9 the fixes themselves spawned new HIGH defects nobody was pointed at. The BB-items' direct fix quality is other reviewers' job — yours is everything they are NOT looking at.
- Real sources: `packages/renderer/src/**`, `packages/live-inject/src/**`.

## Your angle (do NOT do the other reviewers' angles: BB-item seam tracing, citation byte-verification, locked-decision/spec math, or commit-diff fact-checking)

**Lateral new-seam hunt.** Find genuinely NEW defects the round-10 edits introduced or newly
exposed. Hunting grounds (non-exhaustive; follow the evidence):

1. **The module-scope subscribe lifecycle:** when is it registered (import time? store creation?), what happens under Vite HMR / test isolation (double-subscribe, leaked subscriptions), does it fire on the FIRST project open (null→A) and is that reset harmless, and does anything else subscribe to `studioDir` whose relative order with this reset now matters?
2. **New timer interactions:** the 10 s ack timeout vs the documented ~1 Hz background-timer throttling while the game holds the foreground — can a legitimately slow ack chain get falsely timed-out, and what does a LATE ack arriving after timeout do (stale-slot match? double record?)? The timeout timer itself is a background timer — does throttling delay it too?
3. **refuse-while-pending UX:** with a 10 s pending window and no visible pending indicator specified, what does the user see when their second Place click is refused locally? Any deadlock-ish path where the slot never clears (all six exits genuinely reachable)?
4. **Durable failure records:** the new `outcome:'error'` history entries for refused/timed-out/detached — interactions with D-06 history clearing on project switch, badge lifecycle, and the existing recordArmFailure precedent's consumers.
5. **Cross-plan interactions with untouched plans (01–03, 05, 06):** did the two canonical specs change semantics of anything those plans reference without renaming it?
6. Anything else your read surfaces that no BB-item covers.

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | the new seam/defect | evidence (quote plan text and, where relevant, real source).
State explicitly which hunting grounds you swept and found clean.
