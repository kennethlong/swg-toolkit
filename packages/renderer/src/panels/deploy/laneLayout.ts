/**
 * packages/renderer/src/panels/deploy/laneLayout.ts
 * Lane-assignment + SVG layout for the branch-tree version graph (GRAPH-01..05).
 *
 * Wave-0 stub: returns an empty GraphLayout.
 * Wave-1 plan 05 implements the real lane-assignment algorithm from RESEARCH.md § PRIMARY.
 *
 * Key design contracts (pinned by RED tests, verified in GREEN by plan 05):
 *
 *   ROW LAYOUT (layout.rows is the SINGLE row-order source):
 *     - Rows are OLDEST-FIRST by timestamp.
 *     - rowY(r) = 52 * r + 26.
 *     - Consumers MUST render from layout.rows in order — do NOT re-sort.
 *
 *   LANE ASSIGNMENT (by topology/parentId, NOT branchSet()):
 *     - root (no parentId): lane 0.
 *     - First-placed child (earliest in row order) INHERITS parent's lane (trunk).
 *     - Every additional child is a branch: lowest FREE lane > 0.
 *     - Lane freed after last descendant's row — classic git-graph recycling.
 *     - Continue-on-branch: v5 (parent v4) must inherit v4's lane, NOT trunk to v3.
 *
 *   LANE GEOMETRY (sketch 002-A:349-381):
 *     - lane x = 22 + 46 * lane.
 *     - Each CONCURRENTLY-ACTIVE lane MUST have a DISTINCT x — no 90px clamp overlap.
 *     - width = max(90, 22 + 46 * maxConcurrentLane + 8); widens past 2 lanes.
 *
 *   CONNECTORS (one connector per non-root node to its parentId):
 *     - Same lane: trunk <line> (kind:'trunk', x1/y1/x2/y2).
 *     - Cross lane: cubic-bezier (kind:'branch', d = 'M px py C px+34 py bx my bx by').
 *     - WIP stub: kind:'wip' dashed line above live node when hasUncommittedWork.
 *
 *   NODE KINDS (D-13):
 *     - 'root'         — no parentId, gray hollow circle (r=6).
 *     - 'live'         — id === liveVersionId, accent-filled (r=9) + inner dot (r=4).
 *     - 'branch-point' — node with >1 child placed so far.
 *     - 'older'        — all others, gray hollow (r=6).
 *
 * Source: 04.3-02-PLAN.md Task 3; 04.3-RESEARCH.md § PRIMARY lane-assignment algorithm.
 */

import type { SwgChangeset } from '@swg/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row in the version graph, in oldest-first order (layout.rows is the single source). */
export interface LaidRow {
  /** Changeset id for this row. */
  id: string;
  /** 0-based row index (oldest = 0). */
  rowIndex: number;
  /** Lane index (0 = trunk, 1+ = branches). */
  lane: number;
  /** SVG y-coordinate of the node center: 52 * rowIndex + 26. */
  y: number;
}

/** A rendered node (circle) in the lane gutter SVG. */
export interface LaidNode {
  /** Changeset id this node represents. */
  id: string;
  /** SVG x-coordinate: 22 + 46 * lane. */
  cx: number;
  /** SVG y-coordinate: 52 * rowIndex + 26. */
  cy: number;
  /**
   * Visual kind for theming (D-13):
   *   'root'         — oldest node, no parent; gray hollow.
   *   'live'         — currently-live version; accent-filled + inner dot.
   *   'branch-point' — parent of more than one placed child; can stack with above.
   *   'older'        — all other nodes; gray hollow.
   */
  kind: 'root' | 'older' | 'live' | 'branch-point';
}

/** One SVG connector (line or bezier) between a node and its parent. */
export interface Connector {
  /**
   * 'trunk'  — vertical line (same lane, parent→child).
   * 'branch' — cubic bezier (cross-lane, from parent lane to branch lane).
   * 'wip'    — dashed stub above the live node (hasUncommittedWork).
   */
  kind: 'trunk' | 'branch' | 'wip';
  /**
   * SVG path data for 'branch' and 'wip' connectors:
   *   branch: 'M {px} {py} C {px+34} {py} {bx} {midY} {bx} {by}'
   *   wip:    dashed line from y=0 to live node top.
   */
  d?: string;
  /** Start x-coordinate for 'trunk' line connectors. */
  x1?: number;
  /** Start y-coordinate for 'trunk' line connectors. */
  y1?: number;
  /** End x-coordinate for 'trunk' line connectors. */
  x2?: number;
  /** End y-coordinate for 'trunk' line connectors. */
  y2?: number;
}

/**
 * Complete layout for a version graph render pass.
 * layout.rows is the SINGLE authoritative row order — consumers render FROM THIS ORDER.
 */
export interface GraphLayout {
  /** Rows in oldest-first order. The ONLY authoritative row sequence. */
  rows: LaidRow[];
  /** SVG connectors (trunk lines, branch beziers, WIP stub). */
  connectors: Connector[];
  /** Positioned nodes (circles) with theming kind. */
  nodes: LaidNode[];
  /** SVG gutter width in px. Widens past 90 when >2 concurrent lanes are active. */
  width: number;
  /** SVG gutter height in px: numRows * 52. */
  height: number;
}

// ---------------------------------------------------------------------------
// laneLayout (Wave-0 stub)
// ---------------------------------------------------------------------------

/**
 * Compute the lane-assignment + SVG layout for the branch-tree version graph.
 *
 * @param changesets      All changesets in the workspace manifest (any order).
 * @param liveVersionId   ID of the currently-live version (drives 'live' node kind + WIP).
 * @param hasUncommittedWork  When true, a 'wip' dashed connector is emitted above the live node.
 * @returns               GraphLayout with rows (oldest-first), nodes, connectors, width, height.
 *
 * STUB: returns an empty layout until Wave-1 plan 05 implements the real algorithm.
 * RED tests pin the topology contract so plan 05 is constrained by passing tests.
 */
export function laneLayout(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  changesets: SwgChangeset[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  liveVersionId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  hasUncommittedWork: boolean,
): GraphLayout {
  return { rows: [], connectors: [], nodes: [], width: 90, height: 0 };
}
