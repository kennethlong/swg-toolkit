/**
 * packages/renderer/src/panels/deploy/LaneGutter.tsx
 * SVG lane gutter for the branch-tree version graph (GRAPH-01..05).
 *
 * Renders the lane-column SVG that sits beside `.graph-rows-col` per
 * sketch 002-A:339-382 (`.lane-col` / `<svg class="lane-svg">`).
 *
 * Primitives implemented from sketch 002-A:349-381:
 *   GRAPH-02 (A2-A3): trunk <line> parent→child in same lane
 *                      stroke=var(--color-border-soft), strokeWidth=2
 *   GRAPH-03 (A4):    branch <path d="M px py C ..."> cubic bezier from parent lane to branch lane
 *                      stroke=var(--color-accent-dim), fill=none
 *   GRAPH-04 (A5):    WIP <line stroke-dasharray="3 3"> above live node when hasUncommittedWork
 *   GRAPH-05 (A6+D-13): node circles:
 *                      - root/older/branch-point: r=6, fill=var(--color-surface),
 *                        stroke=var(--color-text-faint), strokeWidth=1.5
 *                      - live: r=9, fill=var(--color-accent); + inner r=4, fill=var(--color-accent-text)
 *
 * Colors: ALL via CSS vars (no hardcoded hex), matching the theme-aware design in A12.
 *
 * Source: 04.3-05-PLAN.md Task 2; sketch 002-version-graph-timeline/index.html:349-381.
 */

import React from 'react';
import type { GraphLayout, LaidNode, Connector } from './laneLayout';

// ---------------------------------------------------------------------------
// Sub-components (pure render helpers)
// ---------------------------------------------------------------------------

/** Trunk vertical line connector. */
function TrunkLine({ c }: { c: Connector }): React.JSX.Element {
  return (
    <line
      x1={c.x1}
      y1={c.y1}
      x2={c.x2}
      y2={c.y2}
      stroke="var(--color-border-soft)"
      strokeWidth={2}
    />
  );
}

/** Cross-lane cubic-bezier branch connector. */
function BranchPath({ c }: { c: Connector }): React.JSX.Element {
  return (
    <path
      d={c.d}
      stroke="var(--color-accent-dim)"
      strokeWidth={2}
      fill="none"
    />
  );
}

/** Dashed WIP stub above the live node. */
function WipLine({ c }: { c: Connector }): React.JSX.Element {
  return (
    <line
      x1={c.x1}
      y1={c.y1}
      x2={c.x2}
      y2={c.y2}
      stroke="var(--color-accent-dim)"
      strokeWidth={2}
      strokeDasharray="3 3"
    />
  );
}

/** Gray hollow circle for root / older / branch-point nodes. */
function GrayNode({ node }: { node: LaidNode }): React.JSX.Element {
  return (
    <circle
      cx={node.cx}
      cy={node.cy}
      r={6}
      fill="var(--color-surface)"
      stroke="var(--color-text-faint)"
      strokeWidth={1.5}
    />
  );
}

/** Accent-filled live node: outer r=9 circle + inner r=4 dot. */
function LiveNode({ node }: { node: LaidNode }): React.JSX.Element {
  return (
    <>
      <circle
        cx={node.cx}
        cy={node.cy}
        r={9}
        fill="var(--color-accent)"
        stroke="var(--color-accent)"
        strokeWidth={2}
      />
      <circle
        cx={node.cx}
        cy={node.cy}
        r={4}
        fill="var(--color-accent-text)"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// LaneGutter
// ---------------------------------------------------------------------------

/**
 * Renders the SVG lane gutter for the version graph (branch-tree visual).
 *
 * Pure function of `layout` — no internal state. Consumers pass a GraphLayout
 * computed by `laneLayout()`. Plan 06 (VersionHistoryBody) composes this beside
 * the row list.
 *
 * @param layout  GraphLayout from laneLayout(); drives width, height, connectors, nodes.
 */
export function LaneGutter({ layout }: { layout: GraphLayout }): React.JSX.Element {
  return (
    <svg
      className="lane-svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Connectors — drawn first (below nodes) */}
      {layout.connectors.map((c, i) => {
        if (c.kind === 'trunk') {
          return <TrunkLine key={`t${i}`} c={c} />;
        }
        if (c.kind === 'branch') {
          return <BranchPath key={`b${i}`} c={c} />;
        }
        if (c.kind === 'wip') {
          return <WipLine key={`w${i}`} c={c} />;
        }
        return null;
      })}

      {/* Nodes — drawn on top of connectors */}
      {layout.nodes.map((node) => {
        if (node.kind === 'live') {
          return <LiveNode key={node.id} node={node} />;
        }
        // root, older, branch-point all use the gray hollow circle
        return <GrayNode key={node.id} node={node} />;
      })}
    </svg>
  );
}

export default LaneGutter;
