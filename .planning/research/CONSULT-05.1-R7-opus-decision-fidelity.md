# CONSULT 05.1-R7 — Opus — locked-decision fidelity & spec math (round-7 convergence check)

## LOCKED axioms — treat as given, do NOT contradict or re-derive
1. Repo root: `D:\Code\SWG-Toolkit`. Phase plan set: `.planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md` … `05.1-15-PLAN.md` (15 plans).
2. Round-6 cross-AI review is `.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS-round6.md` — work-list X1–X13, answered by replan commit `7cd2b59` (amended plans 06, 10, 13, 14, 15 only). Inspect with `git diff 7cd2b59^ 7cd2b59`.
3. Locked user decisions are `05.1-CONTEXT.md` (D-01…D-14) — these are the constitution; plans must conform to them, not vice versa.
4. Validation architecture: `05.1-VALIDATION.md`. Research: `05.1-RESEARCH.md`.
5. READ-ONLY task. Do not modify any file.
6. Do not assume any claim inside a plan or review file is true — verify against the files/diff yourself.

## Your angle (do NOT cover other angles: no code-level citation audits, no cross-plan grep sweeps)
You are the decision-fidelity and spec-math reviewer.

1. **Locked-decision conformance.** For each of D-01…D-14 in `05.1-CONTEXT.md`: does any of the five round-6-edited plans (06, 10, 13, 14, 15) now contradict, weaken, or silently reinterpret it? Pay attention to wording changes the diff introduced (qualifiers added to formerly absolute guarantees).
2. **Re-adjudicate the two "disclosed, not fixed" dispositions:**
   - X8 (mid-flow panel remount can swallow an ADD's "(NEW)" marking — disclosed as a must_have + threat row + gap-ledger item instead of fixed),
   - X13 (Undo records no history entry while Remove does — documented as accepted asymmetry).
   For each: is disclosure genuinely acceptable given the phase's success criteria and `05.1-VALIDATION.md`, or does either break a stated success criterion / locked decision, making "disclosed" an illegitimate resolution? Rule on each explicitly.
3. **Spec math.** Re-verify internal arithmetic and logic of the edited plans: Plan 15's checkpoint step numbering and coverage (steps referenced by other plans still exist and are numbered correctly after the round-6 insertions), threat-register row IDs unique and correctly cross-referenced (T-05.1-06a/b/d, T-05.1-13f, T-05.1-14h/i, T-05.1-15a), gap-ledger letters unique ((a)…(i), no collisions), wave numbering consistent with `depends_on`.
4. **Must-have consistency.** Within each edited plan, check the `must_haves` set is internally satisfiable — no pair of truths that cannot both hold, including hedged/absolute pairs about disk state.

## Output format
- Verdict line: `CONVERGED` (zero HIGH findings on your angle) or `NOT CONVERGED`.
- Findings table: `ID | severity (HIGH/MED/LOW) | plan file:line or D-xx | violated decision / broken math | evidence (quoted)`.
- Then explicit rulings: `X8 disposition: LEGITIMATE|ILLEGITIMATE — reason`, `X13 disposition: LEGITIMATE|ILLEGITIMATE — reason`.
