# CONSULT 05.1-R7 — Cursor — line-level citation & wiring verification (round-7 convergence check)

## LOCKED axioms — treat as given, do NOT contradict or re-derive
1. Repo root: `D:\Code\SWG-Toolkit`. Phase plan set: `.planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md` … `05.1-15-PLAN.md` (15 plans).
2. Round-6 cross-AI review is `.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS-round6.md` — its work-list is X1–X13.
3. A replan commit `7cd2b59` amended ONLY plans 06, 10, 13, 14, 15. Inspect it with: `git diff 7cd2b59^ 7cd2b59`.
4. Real application source (ground truth for any code claim):
   - `packages/renderer/src/panels/deploy/DeleteUndoToast.tsx`
   - `packages/renderer/src/panels/deploy/DeployDialog.tsx`
   - `packages/renderer/src/hooks/useChannelReader.ts`
   - `packages/renderer/src/state/workspaceStore.ts`
   - `packages/renderer/src/services/decorationPersist.ts`
5. READ-ONLY task. Do not modify any file.
6. Do not assume any claim inside a plan or review file is true — verify each against the real files yourself.

## Your angle (do NOT cover other angles: no cross-plan seam sweeps, no decision-fidelity checks)
You are the line-level code reader. Work ONLY on plans 06, 10, 13, 14, 15 (the round-6-edited set) against the real `.ts`/`.tsx` files.

1. **Citation audit.** Every `file:line` or `file:line-range` citation that appears in those five plans (both pre-existing and newly added by `7cd2b59`): open the real file at that location and verify the cited identifier/pattern is actually there. Report any citation that is off-by-N lines, names the wrong identifier, or describes behavior the code does not have.
2. **Wiring feasibility.** For each concrete code contract the five plans specify, verify it is implementable exactly as written against the real files:
   - the `useWorkspaceStore.getState().studioDir` access pattern (does the store expose `studioDir` at that shape? do the cited precedent call sites use `getState()` the way the plan claims?),
   - the `suppressNextDiffRef` identity-key object `{buildingId, cellName, objectTemplateName}` (do those three fields exist with those exact names on the tree-row/entry types the plans reference?),
   - the `RemoveUndoToast` error re-arm pattern claimed to mirror `DeleteUndoToast.tsx` (does the cited precedent actually catch, swap content, and re-arm its timer?),
   - the `useWorldEditorStore.getState().tree.find((b) => b.buildingId === …)` lookup (does that store/field/type exist as named, or is the store not yet built — and if not yet built, is it specified consistently across the five plans?).
3. Flag any TypeScript-level impossibility (type mismatch, nonexistent export, wrong import path) a plan asserts as fact.

## Output format
- Verdict line: `CONVERGED` (zero HIGH findings on your angle) or `NOT CONVERGED`.
- Findings table: `ID | severity (HIGH/MED/LOW) | plan file:line | cited claim | what the real file actually shows (quoted)`.
- Then a citation tally: N citations checked, M byte-accurate, K defective.
