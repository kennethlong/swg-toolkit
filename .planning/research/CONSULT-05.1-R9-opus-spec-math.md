# CONSULT — Phase 05.1 plan review, Round 9 — angle: locked-decision fidelity & spec math

Authorization context: this is the maintainer's own open-source Star Wars Galaxies modding toolkit.
The "live" features under review connect to a game client process the maintainer runs and owns on
their own machine (SWGEmu/private-server modding, explicitly permitted). You are reviewing PLANNING
DOCUMENTS for internal consistency — no code is being written or executed in this task.

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## Context (treat as given)

- Plans under review: `.planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md` … `05.1-15-PLAN.md` (15 files) plus `05.1-VALIDATION.md`.
- Locked user decisions: `.planning/phases/05.1-live-world-editor-productization/05.1-CONTEXT.md` (decisions D-01…; LOCKED means plans may not contradict them; the phase has an established disclosure+maintainer-annotation remedy already applied to D-02, D-09, and now D-03).
- Round 8 review work-list: `.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS-round8.md` (items AA1–AA17). Commit `2445b88` claims to resolve all of them; it edited plans 04, 08, 10, 13, 14, 15 and `05.1-RESEARCH.md`.
- Real renderer source lives under `packages/renderer/src/`.

## Your angle (do NOT do the other reviewers' angles: cross-plan seam tracing, citation byte-verification, lateral new-seam hunting, or commit-diff fact-checking)

**Locked-decision fidelity & spec math.** Rigorous logical/temporal analysis:

1. **Locked-decision audit.** For each LOCKED decision in CONTEXT.md, check the current plan set either honors it verbatim or carries the explicit disclosure remedy. Pay particular attention to the AA3/D-03 narrowing ("guarded by an undo toast"): is the disclosed narrowing actually a *narrowing* (a strict subset of the promised behavior) or does any plan text now permit behavior D-03 forbids outright? Also re-verify D-02 and D-09 disclosures still hold after this round's edits.
2. **must_have satisfiability.** For the six edited plans (04, 08, 10, 13, 14, 15): can every `must_haves.truths` entry be simultaneously true? Look for pairs that contradict under some reachable state (e.g. a truth asserting a toast always shows vs the new epoch-correlation deferral; a truth about state surviving vs the new project-switch reset()).
3. **Temporal/protocol math on the new ack mechanism.** The design: `sendStartPlacement` returns an epoch; the agent acks HOST_CMD results with (epoch, code); Plan 14 correlates `lastHostCommandResult` against a pending epoch and only then shows success/refusal. Analyze: epoch uniqueness/monotonicity assumptions, what happens on a lost ack (no timeout specified?), an ack arriving after project switch reset(), two placements racing, stale ack from a previous client session, and whether the store-as-latest-value (single slot, not a queue) can drop an ack the consumer needed. State each hole as a concrete event sequence.
4. **Undo-window math (Plan 13).** With the sticky-error freeze, deferred fold, and 8-second window: verify the plan's stated guarantees are achievable — no sequence of queued removals/undos where the plan's own rules force a contradiction (e.g. an entry that must both stay sticky and be folded).

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | claim | the contradiction/hole as a concrete event sequence.
If a dimension is clean, say so explicitly with what you checked.
