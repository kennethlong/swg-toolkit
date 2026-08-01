# CONSULT — Phase 05.1 plan review, Round 11 — angle: locked-decision fidelity & spec math

Authorization context: this is the maintainer's own open-source Star Wars Galaxies modding toolkit.
The "live" features under review connect to a game client process the maintainer runs and owns on
their own machine (SWGEmu/private-server modding, explicitly permitted). You are reviewing PLANNING
DOCUMENTS for internal consistency — no code is written or executed in this task.

You are one of five independent reviewers. Work only from files on disk. Report facts with
file:line evidence. Do not soften findings.

## LOCKED axioms (measured ground truth — do NOT contradict or re-derive)

1. `channel_binding.cpp` `OpenChannel` (`:113-170`) zero-fills the mapping on every open (memset `:153-154`). The BB4 "stale epoch persists across a toolkit restart via the channel" premise is FALSIFIED.
2. `DeleteUndoToast.tsx` is exactly 218 lines. `useChannelReader.ts:172` is the decode line; `:173` is blank.
3. zustand 5.0.14 vanilla `subscribe` is synchronous inside `setState`. The reset-before-render contract (Plan 04) was FORMALLY PROVEN structurally closed in round 10 (your own prior derivation, if you are the same model: CLEAN-2). Do NOT re-open BB2/BB3/BB22 — they are settled. Your prior CLEAN-3/4/5 findings also stand unless this round's edits touched them.

## Context (treat as given)

- Plans: `05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`; locked decisions in `05.1-CONTEXT.md` (disclosure remedy established for D-02/D-03/D-06/D-09; round 10 added D-12 badge narrowing as ledger item (m) and a timeout-false-failure narrowing as item (n)).
- Round-10 work-list: `05.1-REVIEWS-round10.md` (CC1–CC18). Commit `eafec8b` claims to resolve all.
- The central round-10 change: Plan 08's HOST_CMD ACK PROTOCOL was rewritten as a **13-row total state × event table** — states {idle, pending(slot)}; events {place-attempt, ack-match, ack-stale, ack-late, timeout-fire, detach, project-switch, unmount, second-place-attempt}. Features: explicit precedence order (abort family wins); `studioDir` carried in the pending slot and re-checked in BOTH the ack effect and the timeout callback; `PLACEMENT_ACK_TIMEOUT_MS = 11_000` (10 s publish budget + 1 s throttled-read lag); poll() reordered read-before-liveness; the late-ack rule stated in the spec; a 4-entry canonical strings list; new `isPlacementPending` UI state disabling the "+ Add decoration…" trigger while pending; durable-surface narrowing disclosed as ledger (m)/(n).

## Your angle (do NOT do the other reviewers' angles: cross-plan seam tracing, citation byte-verification, lateral new-seam hunting, or commit-diff fact-checking)

**Locked-decision fidelity & spec math — focused on the new ack table.**

1. **Table totality & partition.** Is the state × event product genuinely TOTAL — every (state, event) cell either specified or proven-unreachable with a real argument? Is the event set exhaustive over what can actually happen (did they miss an event — e.g. a SECOND ack for the same epoch, an ack whose code is neither success nor a known refusal, detach during the timeout callback, a project-switch DURING the unmount cleanup)? Are the cells mutually consistent (no two cells prescribing conflicting writes for reachable co-occurring events)?
2. **Precedence soundness.** The precedence order plus the local enforcement mechanisms (studioDir-in-slot re-check, timer-clear-on-every-exit, timeout-callback re-check, read-before-liveness) — do they actually IMPLEMENT the stated precedence for every pair, or is there a pair where the stated rank and the local mechanism disagree? (Round-10 checker flagged one such contradiction in the precedence one-liner; verify the committed text is now self-consistent AND matches the row table.) Give any surviving disagreement as a concrete event sequence.
3. **Timeout arithmetic.** 11_000 = 10 s + 1 s. Verify against the plan's own cited latencies: is 1 s the correct worst-case read lag given `LIVENESS_CHECK_MS=1000`/`POLL_INTERVAL_MS=33` and the ~1 Hz background throttle, or can the read lag exceed 1 s (e.g. the timeout timer ITSELF is a throttled background timer — does it fire late by the same ~1 Hz, and if so does that help or hurt)? Is the "publish budget" of 10 s justified anywhere, or arbitrary? Does the zoning case (silence ≫ 11 s) still produce the disclosed false-failure (n), and is (n) scoped correctly?
4. **Locked-decision audit.** Ledger (m) [D-12 badge] and (n) [timeout false failure] — faithfully scoped? Does the badge-clears-on-switch narrowing now cover the same-project round-trip case Sonnet raised? Re-verify D-02/D-03/D-06/D-09 disclosures survive this round. Any NEW narrowing this round without a ledger item (e.g. `isPlacementPending` disabling the add trigger — does that narrow any promised "always available" affordance)?
5. **must_have satisfiability** across the 9 edited files, especially any pair straddling the two proven/unproven halves (reset-before-render vs the ack table).

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | claim | the contradiction/hole as a concrete event sequence.
If a dimension is clean, say so explicitly with what you checked (and note if a prior-round CLEAN finding still holds).
