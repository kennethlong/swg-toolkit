# CONSULT — Phase 05.1 plan review, Round 8 — Opus angle: locked-decision fidelity & spec math

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## Context (treat as given)

- Plans under review: `.planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md` … `05.1-15-PLAN.md` plus `05.1-VALIDATION.md`. Locked user decisions: `05.1-CONTEXT.md` (D-series). Phase goal + success criteria: Phase 5.1 section of `.planning/ROADMAP.md`.
- Round 7 work-list Z1–Z18 (`05.1-REVIEWS-round7.md`) was addressed by commit `ba09958`; Plan 13 additionally carries "ROUND 8" and "ROUND 9" revision blocks respecifying its sticky-error undo-toast contract (per-entry `undoErrors` map, deferred `prevRef` fold, no dismiss timer while a sticky error is displayed, disclosed multi-removal narrowing).
- Ground-truth precedent component: `packages/renderer/src/panels/deploy/DeleteUndoToast.tsx`.

## Your angle (do NOT redo the other reviewers' angles: restatement sweeps, byte-level citation checks, lateral new-seam hunting, or fact-checking the commit's new claims)

**Must_have satisfiability and locked-decision fidelity — the Y1/Y2 defect class.**
1. For every guarantee ADDED or RESPECIFIED in this round's edits (plans 06, 08, 10, 13, 14, 15 — the ROUND 7/8/9-tagged text), derive from the specified mechanism whether the guarantee is actually producible. Model the state machines precisely: effect dependency arrays, ref lifecycles, store-write ordering, React batching. A must_have that the mechanism structurally cannot deliver on some branch is a HIGH.
2. Check pairs of must_haves within each edited plan for mutual satisfiability (two guarantees that cannot both hold on some input sequence).
3. Locked-decision fidelity: re-read every D-series decision in 05.1-CONTEXT.md and verify no edit this round weakened, contradicted, or silently narrowed one. Disclosed narrowings ("EXCEPT the disclosed …") are acceptable ONLY if the narrowing is consistent with the D-series text; flag any that quietly override a locked decision.
4. Spec math: any counting/ordering/timing arithmetic in the edited text (timer durations, wave ordering vs depends_on, queue drain grouping, diff baselines) — verify the arithmetic and orderings are internally consistent.

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED` (on your angle).
Findings table: ID (Y-prefix) | severity (HIGH/MED/LOW) | plan file:line(s) | the two (or more) colliding must_haves / the unsatisfiable branch | derivation (stepwise trace).
If everything on your angle holds, state that and list the guarantees you traced.
