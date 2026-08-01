# CONSULT 05.1-R7 — Sonnet — lateral / new-seam hunt (round-7 convergence check)

## LOCKED axioms — treat as given, do NOT contradict or re-derive
1. Repo root: `D:\Code\SWG-Toolkit`. Phase plan set: `.planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md` … `05.1-15-PLAN.md` (15 plans).
2. Round-6 cross-AI review is `.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS-round6.md` — its work-list X1–X13 was answered by replan commit `7cd2b59` (amended plans 06, 10, 13, 14, 15 only). Inspect with `git diff 7cd2b59^ 7cd2b59`.
3. Real application source lives under `packages/renderer/src/` (e.g. `panels/deploy/DeleteUndoToast.tsx`, `state/workspaceStore.ts`, `services/decorationPersist.ts`).
4. Locked user decisions: `05.1-CONTEXT.md` (D-01…D-14).
5. READ-ONLY task. Do not modify any file.
6. Do NOT re-litigate X1–X13 themselves — whether each was applied is another reviewer's angle. Your job is what the fixes CREATED.

## Your angle: interactions the round-6 fixes newly opened
Each round of this convergence loop has found that fixes interact. Hunt for NEW failure modes introduced by the round-6 changes in combination, e.g. (starting points, not an exhaustive list — find your own):
- The suppress mechanism is now an identity-key tuple `{buildingId, cellName, objectTemplateName}` that pre-credits +1 in the diff. What happens when TWO rows with the identical tuple exist (same template placed twice in the same cell), or when an Undo restore and a genuinely-new identical row land in the same refresh window?
- The new `lastUndoError` re-arm path vs. the suppress ref: if Undo fails AFTER the suppress ref was set (or is it set only on success?), does a stale suppress key swallow the NEXT legitimate "(NEW)" marker?
- The disclosed X8 remount hazard (component-local `prevTreeRef` reset swallowing an ADD's "(NEW)") vs. the new X9 checkpoint steps — can the checkpoint pass while the hazard fires?
- `diskState: 'uncertain'` propagation: any UI/history-message path that now has three states (unchanged/changed/uncertain) but a consumer that still branches two ways?
- Ordering/timing: refs set in event handlers vs. store-driven refresh effects — any sequence where the round-6 wiring reads stale state?

Also do one lateral sweep of your own choosing over the 10 untouched plans (01–05, 07–09, 11, 12) for interactions with the five edited ones.

## Output format
- Verdict line: `CONVERGED` (zero HIGH findings on your angle) or `NOT CONVERGED`.
- Findings table: `ID | severity (HIGH/MED/LOW) | plan file:line | new failure mode | concrete trigger sequence`.
- Only report findings you can ground in specific plan text (quote it) — no generic speculation.
