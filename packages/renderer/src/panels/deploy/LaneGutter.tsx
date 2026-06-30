/**
 * packages/renderer/src/panels/deploy/LaneGutter.tsx
 * SVG lane gutter for the branch-tree version graph (GRAPH-01..05).
 *
 * Renders the 90px-wide SVG column that sits beside `.graph-rows-col` per
 * sketch 002-A:339-382 (`.lane-col` / `<svg class="lane-svg">`).
 *
 * Wave-0 stub: renders an empty SVG with the correct dimensions.
 * Wave-1 plan 05 implements the real trunk lines, branch beziers, node circles,
 * WIP dashed stub, and branch-point markers from the GraphLayout.
 *
 * Geometry contract (from laneLayout.ts and sketch 002-A):
 *   - SVG width = layout.width (90 by default; widens with >2 concurrent lanes).
 *   - SVG height = layout.height (numRows * 52).
 *   - Node centers: cx = 22 + 46 * lane; cy = 52 * rowIndex + 26.
 *   - Trunk: <line> in lane column.
 *   - Branch: cubic bezier path from parent lane to branch lane.
 *   - WIP stub: dashed <line> above live node.
 *
 * Source: 04.3-02-PLAN.md Task 3; sketch 002-version-graph-timeline/index.html:339-382.
 */

import React from 'react';
import type { GraphLayout } from './laneLayout';

// ---------------------------------------------------------------------------
// LaneGutter (Wave-0 stub)
// ---------------------------------------------------------------------------

/**
 * Renders the SVG lane gutter for the version graph.
 *
 * @param layout  GraphLayout from laneLayout(); drives width, height, connectors, nodes.
 *
 * STUB: renders an empty `<svg>` with correct dimensions.
 * Wave-1 plan 05 fills in nodes, trunk lines, branch beziers, and the WIP dashed stub.
 */
export function LaneGutter({ layout }: { layout: GraphLayout }): React.JSX.Element {
  return (
    <svg
      className="lane-svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      xmlns="http://www.w3.org/2000/svg"
    />
  );
}

export default LaneGutter;
