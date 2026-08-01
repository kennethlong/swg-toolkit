# YOUR ANGLE (Fable): fact-check ONLY the claims newly injected by commit `3d0a605`

Working directory: D:\Code\SWG-Toolkit. Read the preamble (below) first, then execute this task.

Your axis is narrow and forensic: the replan edited plans 04, 06, 10, 13, 14, 15. Every FACTUAL claim
that is NEW in `git diff 7f5baca..3d0a605 -- .planning/phases/05.1-live-world-editor-productization/`
— file:line citations, API/type/signature claims about real existing files, claims about what a
reference repo does — must be verified against the actual bytes. Claims present before `3d0a605` were
fact-checked in rounds 3–5; do NOT re-litigate them. Claims about to-be-created files are design, not
fact — skip them unless they cite a real file as precedent.

Method:
1. Extract the added lines from the diff (`git diff 7f5baca..3d0a605 -- <phase dir>` — lines starting
   `+`). List every verifiable factual claim in them.
2. For each claim, open the cited real file at the cited line and compare byte-for-byte. Known targets
   to check (non-exhaustive — the diff is authoritative):
   - `packages/renderer/src/panels/deploy/DeleteUndoToast.tsx:96-101` as the presentational-undo
     precedent (verify the plan's characterization of what those lines do, and that any path the plan
     gives for this file is the real one).
   - `packages/renderer/src/state/liveStore.ts:26-31` — the `attached` union arm fields.
   - `packages/renderer/src/state/workspaceStore.ts:34` — `studioDir` type.
   - `packages/renderer/src/services/decorationPersist.ts:199-203` (some plans may cite 200/203) — the
     per-TEMPLATE mirror-write claim.
   - Any `readWorkspaceJson`, `resolveOverrideDir`, `useDeleteUndoStore`-analog, fs-API, or Zustand
     selector-pattern claim newly added.
3. Verdict per claim: ACCURATE / INACCURATE (with the real bytes) / UNVERIFIABLE (say why).

Output: the standard contract (verdict line first), then a table: claim → plan:line → real file:line →
verdict. Zero fabrications is a reportable result — rounds 3–5 each confirmed it; say so plainly if it
holds again. Do not drift into design review; other reviewers own that.
