# CONSULT — Phase 05.1 plan review, Round 10 — angle: locked-decision fidelity & spec math

Authorization context: this is the maintainer's own open-source Star Wars Galaxies modding toolkit.
The "live" features under review connect to a game client process the maintainer runs and owns on
their own machine (SWGEmu/private-server modding, explicitly permitted). You are reviewing PLANNING
DOCUMENTS for internal consistency — no code is written or executed in this task.

You are one of five independent reviewers. Work only from files on disk. Report facts with
file:line evidence. Do not soften findings.

## LOCKED axioms (measured ground truth — do NOT contradict or re-derive)

1. `channel_binding.cpp` `OpenChannel` (`:113-170`) zero-fills the mapping on every open (memset
   `:153-154`). The round-9 BB4 "stale epoch persists in the channel across toolkit restart"
   premise is FALSIFIED. The agent-LOCAL last-applied tracker residual is the only real piece.
2. `DeleteUndoToast.tsx` is exactly 218 lines.
3. zustand 5.0.14 is the installed version (`packages/renderer/package.json`).

## Context (treat as given)

- Plans: `.planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`; locked decisions in `05.1-CONTEXT.md` (disclosure remedy established for D-02/D-09/D-03, now also D-06 item (l)).
- Round-9 work-list: `05.1-REVIEWS-round9.md` (BB1–BB23). Commit `751464a` claims to resolve all. Two canonical specs were introduced: Plan 08's HOST_CMD ACK PROTOCOL (idle→pending(E), six exits: local-refuse, resolved-success, resolved-refused, timed-out (10 s), aborted-detach, aborted-switch; durable failure records for refused/timed-out/detached; toast only on resolution) and Plan 04's PROJECT-SWITCH RESET ORDERING CONTRACT (module-scope zustand vanilla subscribe resets project-scoped stores synchronously inside the studioDir-changing `set()`, before React re-renders — claimed to make BB2's false-"restored" race structurally impossible and restore D-03's absolutes).

## Your angle (do NOT do the other reviewers' angles: cross-plan seam tracing, citation byte-verification, lateral new-seam hunting, or commit-diff fact-checking)

**Locked-decision fidelity & spec math.**

1. **Ack state machine soundness.** Enumerate the state space: is every exit reachable, is the slot guaranteed to clear on every path (no wedge), and are there races the six exits don't partition — ack arriving in the same tick as the timeout, ack arriving AFTER timed-out fired (late-ack: does it match an empty slot, a NEW pending slot from a subsequent request, or get dropped — and is each outcome specified?), detach and timeout racing, switch-abort racing an in-flight resolved transition. State each hole as a concrete event sequence against the spec text.
2. **Reset-before-render soundness.** The claim: a synchronous store reset inside `set()` means no render can observe new-studioDir + old-store state. Analyze against React 18/19 + zustand 5 semantics: `useSyncExternalStore` subscribers are ALSO notified synchronously — does subscriber ordering (module-scope vanilla subscribe vs component hook subscriptions) matter for what a re-render reads? Concurrent rendering / transitions: can a render begun BEFORE the set() commit interleave? Is the "structurally impossible" claim for BB2 justified, or does it need a weaker-but-honest statement plus the suppress-first-diff belt? Also: the BB3 fix seeds `prevRef = pending.slice(0, idx(sticky)+1)` — verify this reconstruction is correct for all orderings (sticky not at index 0, multiple entries after sticky, sticky mid-list).
3. **Locked-decision audit.** D-03 absolutes restored (BB2/BB3) — confirm no plan text still hedges them as possible, and that the restored absolutes are actually entailed by the new mechanisms. D-06 item (l) — is the switch-clear narrowing faithfully scoped? Re-verify D-02/D-09/(k)/(g)/(e)/(j)/(h) disclosures survive the edits. Any NEW narrowing introduced this round without a ledger item?
4. **must_have satisfiability** across the 11 edited files: any pair of truths contradictory under a reachable state, especially between the two new canonical specs (e.g. switch-abort silent-clear vs durable-record-on-every-failure; refuse-while-pending vs any "user can always retry" text).

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | claim | the contradiction/hole as a concrete event sequence.
If a dimension is clean, say so explicitly with what you checked.
