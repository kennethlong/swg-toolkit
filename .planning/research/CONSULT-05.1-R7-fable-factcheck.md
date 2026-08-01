# CONSULT 05.1-R7 — Fable — fact-check of NEW claims in commit 7cd2b59 (round-7 convergence check)

## LOCKED axioms — treat as given, do NOT contradict or re-derive
1. Repo root: `D:\Code\SWG-Toolkit`. The replan commit under audit is `7cd2b59` — it amended `.planning/phases/05.1-live-world-editor-productization/05.1-{06,10,13,14,15}-PLAN.md`. View it with: `git diff 7cd2b59^ 7cd2b59`.
2. Real application source (ground truth):
   - `packages/renderer/src/panels/deploy/DeleteUndoToast.tsx`
   - `packages/renderer/src/panels/deploy/DeployDialog.tsx`
   - `packages/renderer/src/hooks/useChannelReader.ts`
   - `packages/renderer/src/state/workspaceStore.ts`
   - `packages/renderer/src/services/decorationPersist.ts`
   Other real source is under `packages/` — locate with grep/glob as needed.
3. READ-ONLY task. Do not modify any file.
4. This project's #1 known failure mode is fabricated-but-plausible citations. Round 6's fact-check found 2 factual defects among 20 new claims. Your job is the same audit for round 6's replan.

## Your angle (fact-check ONLY — do not review design quality, seams, or decisions)
Audit ONLY the lines commit `7cd2b59` ADDED (the `+` side of `git diff 7cd2b59^ 7cd2b59`, excluding STATE.md).

1. Extract every checkable factual claim from the added lines: file paths, `file:line` / line-range citations, function/identifier names, prop shapes, store field names, described behavior of existing code (e.g. "DeleteUndoToast catches, swaps content, and re-arms its 8s timer", "DeployDialog.tsx:139 uses getState()", "decorationPersist.ts:199-203"), test-file names, threat-row cross-references to `05.1-VALIDATION.md`.
2. For each claim, open the real file at the cited location and grade it:
   - **byte-accurate** — the cited thing is exactly there,
   - **minor-drift** — right identifier, off by a few lines or slightly misdescribed (report the correction),
   - **fabricated/defective** — the cited identifier/behavior does not exist as described.
3. Claims about code that does NOT yet exist (planned future files) are only checkable for internal consistency — mark them `not-checkable (future)` and skip unless the plan asserts they already exist.

## Output format
- Verdict line: `CONVERGED` (zero fabricated/defective claims) or `NOT CONVERGED`.
- Claims ledger: `# | plan file:line (of the + line) | claim | grade | correction if any`.
- Tally line: `N claims checked: A byte-accurate, B minor-drift, C fabricated`.
