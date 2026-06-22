# CONSULT R3-03 — fresh Sonnet — Lateral: over-fitting + fail-fast on a likely-negative experiment

Third review round. Two rounds of cross-AI feedback have been layered into these plans. You did
NOT see rounds 1-2. Judge the CURRENT plans fresh, and specifically hunt for two failure modes that
appear AFTER heavy revision.

## LOCKED AXIOMS (given — don't review)
- NAPI gating settled. The utility→renderer SAB share is a deliberate, primary-source-likely-NEGATIVE
  experiment: the phase EXPECTS it may fail and is built to surface that. Don't try to answer whether
  it works; assume it may not.

## YOUR ANGLE (two specific hunts)
1. **Over-fitting / layered-edit damage.** Plans revised three times can accumulate dead complexity,
   internal contradictions, or ceremony that no longer serves the goal. Look for: machinery added to
   satisfy a past reviewer that doesn't earn its keep; two mechanisms doing the same job; acceptance
   criteria that contradict each other across plans; a "fix" that complicated the thing it touched
   more than the risk warranted. Is the plan now HEAVIER than the de-risk goal justifies?
2. **Fail-fast economics of the likely-negative experiment.** Given utility→renderer SAB sharing is
   EXPECTED to possibly fail: is the phase structured to learn that as CHEAPLY and EARLY as possible?
   - There's now an "early canary" + a blocking architecture gate at the end of 00-03 (wave 2), before
     00-04's 17 renderer files (wave 3). Is that early ENOUGH, or is meaningful work still sunk before
     the truth is known (e.g., is 00-02's full prebuildify/CI apparatus built before we know the
     hot-path architecture even survives)?
   - When the gate fails, is the **pivot contingency actually actionable** (main-owned SAB / OS shm /
     drop utility from hot path), or is it hand-wavy prose that leaves the executor stuck?
   - Would a tiny standalone SAB-sharing probe (allocate in utility, post to a bare renderer, cross-
     write) as the FIRST thing in the phase — before ANY of the scaffold/CI/UI — be a strictly better
     shape? Argue for or against restructuring.

## Deliverable
markdown, severity-tagged. Two verdicts: (a) over-fitted? (right-sized / trim these specific things),
(b) fail-fast? (optimal / restructure thus). Be willing to say "right-sized, ship it." A productive
disagreement with the other reviewers is the success signal; do not echo.

## Files
- All five 00-0{1,2,3,4,5}-PLAN.md + CONTEXT + RESEARCH + UI-SPEC in
  D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/
