# Version-graph consult — LOCKED ground truth (do NOT contradict or re-derive)

Treat every numbered fact as measured truth from the real source. Do NOT propose a design that
contradicts these; if one seems wrong, say so explicitly and explain, but assume they are correct.

## The surface
The "Deploy" panel has a **Version History** graph: a branch-tree of changesets (versions) with an
SVG "lane gutter" (circles/lines) on the left and a row list on the right.

## Files (repo: D:\Code\SWG-Toolkit, package packages/renderer)
- `src/panels/deploy/VersionHistoryBody.tsx` — the graph component (rows + click handling).
- `src/panels/deploy/LaneGutter.tsx` — the SVG (circles = "nodes", lines = connectors).
- `src/panels/deploy/laneLayout.ts` — pure fn computing SVG positions.
- `src/panels/deploy/DeployPanel.tsx` — wraps staging + version history + a Deploy button.
- `src/services/syncLiveToVersion.ts` — "reconcile the live client to version X".
- `src/services/changesetService.ts` — flatten(), sealVersion(), selectVersion(), setLiveVersion().
- `src/state/workspaceStore.ts` — holds `clientPath` (the client INSTALL DIR), no cfg-file path.

## LOCKED facts
1. **Two pointers** in the manifest: `activeVersionId` (the SELECTED version — what the Deploy
   button targets and what materializes into the staging working-set) and `deployedVersionId`
   (what is actually live in the game client). Design intent D-08 = "selected ≡ live" (they move
   together via `setLiveVersion`, which sets BOTH).
2. **Row click handler** (`VersionHistoryBody.handleRowClick`) calls `doReconcile(targetId)` →
   `syncLiveToVersion(targetId, ctx)`. `syncLiveToVersion` DEPLOYS/REVERTS the real game client to
   that version, and only at the END (on success) calls `setLiveVersion(targetId)` to move the
   pointers. If it throws first, the pointers never move.
3. `buildCtx()` in VersionHistoryBody builds the reconcile ctx as:
   `{ manifest, studioDir, cfgPath: clientPath ?? studioDir, installRoot: clientPath ?? studioDir }`.
   `clientPath` is the client INSTALL DIRECTORY (e.g. `C:\EmpireInFlames`), NOT a `.cfg` file.
4. `syncLiveToVersion` (cfg-apply path) calls `scanSharedFile(cfgPath)` and `activatePatch(...)`.
   `scanSharedFile` does `fs.readFileSync(cfgPath)` on the path with NO try/catch around the read.
5. `laneLayout.ts`: rows are 52px tall. Node center y = `52*rowIndex + 26`. Node x = `22 + 46*lane`.
   SVG height = `numRows * 52`. The `'live'` node kind (accent-filled circle) is assigned to the
   node whose `id === liveVersionId` (the caller passes `deployedVersionId`).
6. `VersionHistoryBody` renders TWO side-by-side columns: `.lane-col` (the fixed-size `<LaneGutter>`
   SVG) and `.graph-rows-col` (the row list). Each row is 52px. **When a row is expanded** (user
   clicks ▸ to list that version's files), an extra file-list `<div>` is rendered AFTER that row in
   `.graph-rows-col`, increasing that row block's height. The SVG in `.lane-col` is unchanged.
7. `flatten(versionId, manifest, studioDir)` returns the full StagingEntry[] for a version by walking
   parentId→root. `sealVersion(entries)` treats `entries` as the FULL working set and diffs vs the
   parent (= current activeVersionId) to store only changed deltas.
8. Deploy (the explicit "Deploy vN" button in DeployPanel → DeployDialog) reads from the version
   graph via `flatten(activeVersionId)`, NOT from the staging store.

## Observed symptoms (treat as given facts, on a client-bound project "EmpireInFlames",
## baseline + Version 2 + Version 3 + Version 4, nothing deployed yet i.e. deployedVersionId at start):
- **S1**: Clicking any non-baseline version row does NOT change the selection. Baseline stays
  selected/highlighted. Selection appears stuck on baseline.
- **S2**: The selected row's SVG **node (circle)** is not visually distinguished — the highlight
  (border/fill) is only on the row content, not the circle.
- **S3**: Expanding Version 3's file list pushes Version 4's row down, but Version 4's SVG node
  (circle) does NOT move down with it → the circle is now vertically misaligned from its row.
