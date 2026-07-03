# Angle B (Cursor — detailed layout reader): SVG-node vs expandable-row misalignment (symptom S3)

Read the LOCKED ground truth in `.planning/research/CONSULT-VG-00-GROUND-TRUTH.md` first.

You are the most detailed code reader. Focus ONLY on the visual/layout alignment between the SVG lane
gutter and the row list. Do NOT discuss selection state or deploy logic.

Read `packages/renderer/src/panels/deploy/VersionHistoryBody.tsx` (the two-column render around
`.graph-container` / `.lane-col` / `.graph-rows-col`), `LaneGutter.tsx`, and `laneLayout.ts`.

Answer with file:line precision:
1. Explain EXACTLY why expanding a row (rendering the per-version file list) moves the row but not its
   SVG node (facts #5, #6). Where does the height divergence originate?
2. Enumerate the candidate fixes and trade-offs. Consider at least:
   (a) recompute `laneLayout` node/connector Y from ACTUAL cumulative row heights (variable-height
       rows) rather than a fixed 52px, feeding expanded-state into the layout;
   (b) render the SVG connector+node PER ROW, inline inside each row block (co-located, so they move
       together), instead of one monolithic side SVG;
   (c) keep the monolithic SVG but absolutely-position it and drive Y from measured row offsets
       (ResizeObserver / getBoundingClientRect);
   (d) render file-list expansions in an OVERLAY that does not displace rows.
   For each: how invasive, does it preserve the existing `laneLayout` tests, and does it keep
   branch beziers correct across variable-height rows?
3. Recommend ONE approach as the minimal robust fix and sketch the concrete change points (file:line),
   including how branch bezier `d` and trunk line endpoints would be recomputed for variable heights.

Output: prose + file:line. Read-only. Do NOT write code to disk.
