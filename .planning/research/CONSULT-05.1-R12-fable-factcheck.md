# CONSULT — Phase 05.1 plan review, Round 12 — angle: fact-check of NEW claims in commit f404d1e

You are one of five independent reviewers. Work only from files on disk and read-only git history.
Report facts with file:line evidence. Do not soften findings.

## LOCKED axioms (measured ground truth — do NOT contradict or re-derive)

1. `DeleteUndoToast.tsx` is exactly 218 lines. `useChannelReader.ts:172` is the `templateName`
   decode line; `:173` is blank.

## Context (treat as given)

- Commit `f404d1e` is the round-11 completeness sweep (parent `a65077c`, a docs-only review commit;
  the plan baseline is `a65077c..f404d1e`). It edited plans 04, 08, 14, 15 and `05.1-VALIDATION.md`,
  claiming to resolve round-11 items EE1–EE6 (see `05.1-REVIEWS-round11.md`). Notably EE4 REPLACED a
  wrong reviewer-supplied test-file example (`ProjectBindingBar.test.tsx`, which does not seed
  `studioDir`) with suites the planner claims to have opened and verified.
- Real sources: `packages/renderer/src/**`, `packages/renderer/package.json`.

## Your angle (do NOT do the other reviewers' angles: cross-plan seam tracing, plan-internal citation sweeps, lateral new-seam hunting, or locked-decision/spec math)

**Fact-check every NEW claim.** Diff `a65077c..f404d1e`. Extract every factual claim NEW or CHANGED
in this commit — counts, line numbers/ranges, file paths, function/store signatures, the studioDir-
seeding test-file claims (EE4), the "canonical string 2 carried in full / N full occurrences, 0
fragments" claims (EE3), `setPlacementPending` occurrence counts (EE1), the `slot.studioDir` guard
shape (EE2), the throttle-symmetry restatement and ledger-(n) wording (EE6), ledger letters (a)–(n),
round labels, and any numeric literal. For each:

1. Verify against the real source, git history, or the referenced sibling plan (open it).
2. Classify: VERIFIED (quote evidence) | FALSE (quote reality) | UNVERIFIABLE-AS-STATED (future/planned
   state or too vague — say which).
3. Watch specifically for: the EE4 replacement test-file citations — open EACH cited suite
   (`DeployDialog.test.tsx`, `changesetService.test.ts`, `StagingPanelBody.test.tsx`) and confirm it
   really seeds `studioDir` in `beforeEach`/per-test, AND confirm `ProjectBindingBar.test.tsx` really
   does NOT (so both the removal and the replacements are factually grounded); any `setPlacementPending`
   / occurrence-count claim (re-run the grep); the "218-line" count if restated; and whether any claim
   COPIED from a round-11 reviewer was independently re-verified vs. restated on the reviewer's word
   (the provenance rule the phase adopted — EE4 exists because a reviewer example was previously
   restated unverified).

Group claims logically; report totals (N groups, N verified, N false, N unverifiable).

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED` (NOT CONVERGED if any FALSE claim exists, or if
unverifiable claims are presented as verified fact).
Then a findings table: ID | class (VERIFIED/FALSE/UNVERIFIABLE) | plan file:line | the claim | evidence.
End with the totals line.
