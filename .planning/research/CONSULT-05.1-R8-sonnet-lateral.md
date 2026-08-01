# CONSULT — Phase 05.1 plan review, Round 8 — Sonnet angle: lateral / new-seam hunt

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## Context (treat as given)

- Plans under review: `.planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md` … `05.1-15-PLAN.md` plus `05.1-VALIDATION.md`. Project context: `.planning/PROJECT.md`, phase section in `.planning/ROADMAP.md`, user decisions in `05.1-CONTEXT.md`.
- Seven prior review rounds exist (`05.1-REVIEWS-round2.md` … `-round7.md`). Round 7's work-list Z1–Z18 was addressed by commit `ba09958` (edited plans 06, 08, 10, 13, 14, 15 + VALIDATION.md; Plan 13 also has "ROUND 8"/"ROUND 9" revision blocks for a sticky-error-toast contract).
- Real renderer source: `packages/renderer/src/`. UI contract: sketches under `.planning/sketches/` (019 World panel, 020 status strip, 021 wizard modal).

## Your angle (do NOT redo the other reviewers' angles: seam-propagation restatement sweeps, byte-level citation verification, must_have-satisfiability math on the edited contracts, or fact-checking the replan commit's new claims)

**Lateral hunt for defect classes NOT already on the Z-list.** Prior rounds converged on known seams;
your job is to find what nobody has looked at. Suggested hunting grounds (not exhaustive — follow
your nose):
- Interactions BETWEEN this round's new mechanisms and other plans' consumers: `undoErrors` Map + sticky no-timer toast (Plan 13) vs Plan 14's `suppressNextDiffRef` queue-drain and two-surface ADD confirm; the deferred `prevRef` fold vs any other effect that reads `pending`.
- Cross-cutting state lifecycles: what happens to `undoErrors`, pending entries, queued suppress refs, or in-flight wizard state on live-session end / client exit / project switch / panel unmount+remount? Any plan that resets one store but not its siblings?
- The HUD (Plan(s) covering sketch 020) vs World panel (019) vs wizard (021) seams: focus/hotkey ownership, simultaneous arm + wizard-placement, error routing promises ("failures punt detail to the World panel") — is the routing actually specified end-to-end in some plan or just asserted?
- Checkpoint/verification plans (Plan 15): are its manual steps executable in order given the waves, or do any depend on states earlier steps destroy?
- Anything where two plans each assume the OTHER owns a responsibility (orphaned responsibility), or both claim it (double ownership).

Report only NEW findings — check the Z-list and rounds 5–7 first so you don't re-report known items.

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED` (on your angle).
Findings table: ID (L-prefix) | severity (HIGH/MED/LOW) | plan file:line(s) | defect | concrete failure scenario (numbered steps).
If you find nothing new after a genuine hunt, say so and list where you looked.
