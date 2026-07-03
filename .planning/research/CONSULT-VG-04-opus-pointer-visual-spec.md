# Angle D (fresh Opus — spec / state-machine + layout math)

Read the LOCKED ground truth in `.planning/research/CONSULT-VG-00-GROUND-TRUTH.md` first.

Produce a precise SPEC (not prose musings) for two things:

## Part 1 — pointer→visual mapping (fixes S2)
Given two pointers `selectedVersionId` (= activeVersionId) and `deployedVersionId`, and a per-row
`expanded` set, specify the COMPLETE visual state for each version row + its SVG node:
- Row highlight (border/background): driven by which pointer?
- SVG node (circle) rendering: there are currently kinds root / older / live / branch-point. Define
  how "selected" and "deployed/live" should BOTH be representable simultaneously (they can differ if
  selection is decoupled from deploy). E.g. selected = accent ring/fill on the circle; deployed =
  a distinct "live" marker/pip. Give exact visual rules so a selected-but-not-deployed node, a
  deployed-but-not-selected node, and a selected-AND-deployed node are each unambiguous.
- Which of `laneLayout`'s node `kind` assignment must change, and what new input(s) `laneLayout`
  needs (e.g. a `selectedVersionId` param) — as a signature-level spec.

## Part 2 — layout math for variable-height (expandable) rows (informs S3)
`laneLayout` currently assumes fixed 52px rows: `nodeY = 52*rowIndex + 26`, connectors use those Ys,
SVG height = `52*numRows`. Specify the generalized math when any row may be taller (expanded file
list adds `extraHeight[rowIndex]`):
- Row top offset `rowTop(i) = sum(rowHeight[0..i-1])`; node center Y = `rowTop(i) + 26` (node sits in
  the fixed 52px header band of its row, above any expansion).
- Trunk line endpoints and branch-bezier control points restated in terms of `rowTop`/`nodeY`.
- Total SVG height = `sum(rowHeight)`.
- State the invariant that keeps the SVG node aligned with its row header regardless of expansion.

Keep it implementation-ready and exact. You may read the repo (laneLayout.ts, LaneGutter.tsx).
