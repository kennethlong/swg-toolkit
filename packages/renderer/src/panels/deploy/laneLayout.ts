/**
 * packages/renderer/src/panels/deploy/laneLayout.ts
 * Lane-assignment + SVG layout for the branch-tree version graph (GRAPH-01..05).
 *
 * Key design contracts (verified by tests in laneLayout.test.ts):
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
 *     - Lane L is free for a new branch whose parent is at parentRow P iff
 *       laneEndRow[L] < P (the previous connector that occupied L ended before P).
 *
 *   LANE GEOMETRY (sketch 002-A:349-381):
 *     - lane x = 22 + 46 * lane.
 *     - Each CONCURRENTLY-ACTIVE lane MUST have a DISTINCT x — no 90px clamp overlap.
 *     - width = max(90, 22 + 46 * maxLane + 8); widens past 2 lanes.
 *
 *   CONNECTORS (one connector per non-root node to its parentId):
 *     - Same lane: trunk <line> (kind:'trunk', x1/y1/x2/y2).
 *     - Cross lane: cubic-bezier (kind:'branch', d = 'M px py C px+34 py bx midY bx by').
 *     - WIP stub: kind:'wip' (x1/y1/x2/y2) above live node when hasUncommittedWork.
 *
 *   NODE KINDS (D-13):
 *     - 'root'         — no parentId, gray hollow circle (r=6).
 *     - 'live'         — id === liveVersionId, accent-filled (r=9) + inner dot (r=4).
 *     - 'branch-point' — node with >1 child placed so far.
 *     - 'older'        — all others, gray hollow (r=6).
 *
 * Source: 04.3-02-PLAN.md Task 3; 04.3-05-PLAN.md Task 1;
 *         04.3-RESEARCH.md § PRIMARY lane-assignment algorithm steps 1–12;
 *         sketch 002-version-graph-timeline/index.html:341-381.
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
   *   'branch-point' — parent of more than one placed child; gray hollow.
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
   * SVG path data for 'branch' connectors:
   *   branch: 'M {px} {py} C {px+34} {py} {bx} {midY} {bx} {by}'
   */
  d?: string;
  /** Start x-coordinate for 'trunk' and 'wip' connectors. */
  x1?: number;
  /** Start y-coordinate for 'trunk' and 'wip' connectors. */
  y1?: number;
  /** End x-coordinate for 'trunk' and 'wip' connectors. */
  x2?: number;
  /** End y-coordinate for 'trunk' and 'wip' connectors. */
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
// Geometry helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

/** SVG x-coordinate for a lane: 22 + 46 * lane. */
export const laneXOf = (lane: number): number => 22 + 46 * lane;

/** SVG y-coordinate for a row: 52 * rowIndex + 26. */
export const rowYOf = (rowIndex: number): number => 52 * rowIndex + 26;

// ---------------------------------------------------------------------------
// laneLayout
// ---------------------------------------------------------------------------

/**
 * Compute the lane-assignment + SVG layout for the branch-tree version graph.
 *
 * Algorithm (RESEARCH.md § PRIMARY, steps 1–12):
 *   1. Sort changesets OLDEST-FIRST by timestamp → rows[].
 *   2. Build children-of map in row order.
 *   3. Compute lastDescendantRow for each node (DFS, memoized).
 *   4. Walk rows: assign lanes by TOPOLOGY (parentId), NOT branchSet():
 *        - root → lane 0.
 *        - first child of parent → inherit parent's lane (trunk continuation).
 *        - additional child → lowest FREE lane > 0 (recycled when parentRow > lastEndRow).
 *   5. Emit rows, nodes (with kind), connectors (trunk/branch/wip).
 *
 * @param changesets      All changesets in the workspace manifest (any order).
 * @param liveVersionId   ID of the currently-live version (drives 'live' node kind + WIP).
 * @param hasUncommittedWork  When true, a 'wip' connector is emitted above the live node.
 * @returns               GraphLayout with rows (oldest-first), nodes, connectors, width, height.
 */
export function laneLayout(
  changesets: SwgChangeset[],
  liveVersionId: string | null,
  hasUncommittedWork: boolean,
): GraphLayout {
  if (changesets.length === 0) {
    return { rows: [], connectors: [], nodes: [], width: 90, height: 0 };
  }

  // -----------------------------------------------------------------------
  // Step 1: Sort oldest-first by timestamp (ISO strings compare lexically).
  // -----------------------------------------------------------------------
  const sorted = [...changesets].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );

  const idSet = new Set(sorted.map((cs) => cs.id));
  const rowIndexOf = new Map<string, number>();
  sorted.forEach((cs, i) => rowIndexOf.set(cs.id, i));

  // -----------------------------------------------------------------------
  // Step 2: Build children-of map in oldest-first row order.
  // -----------------------------------------------------------------------
  const childrenOf = new Map<string, string[]>();
  for (const cs of sorted) {
    if (cs.parentId && idSet.has(cs.parentId)) {
      if (!childrenOf.has(cs.parentId)) childrenOf.set(cs.parentId, []);
      childrenOf.get(cs.parentId)!.push(cs.id);
    }
  }

  // -----------------------------------------------------------------------
  // Step 3: Compute lastDescendantRow (DFS, memoized).
  // "Last descendant row" = max rowIndex among self + all descendants.
  // Used to decide when a branch lane can be recycled.
  // -----------------------------------------------------------------------
  const lastDescRowOf = new Map<string, number>();

  function computeLastDescRow(id: string): number {
    const cached = lastDescRowOf.get(id);
    if (cached !== undefined) return cached;
    const ownRow = rowIndexOf.get(id)!;
    const kids = childrenOf.get(id) ?? [];
    const maxRow = kids.reduce((m, k) => Math.max(m, computeLastDescRow(k)), ownRow);
    lastDescRowOf.set(id, maxRow);
    return maxRow;
  }

  // Compute for all root nodes (null parentId or parent not in set).
  for (const cs of sorted) {
    if (!cs.parentId || !idSet.has(cs.parentId)) {
      computeLastDescRow(cs.id);
    }
  }

  // -----------------------------------------------------------------------
  // Step 4: Lane assignment walk (oldest-first).
  //
  // laneEndRow[L] = last row index that lane L's branch connector occupies.
  //   -1 (default) means "never used / free from the start".
  //
  // A branch lane L is free for a new branch whose parent is at parentRow P
  // iff laneEndRow[L] < P. This ensures:
  //   - No visual connector overlap between siblings of the same parent
  //     (both connectors start at parentRow, so lane L with end >= P would overlap).
  //   - Lanes ARE recycled for unrelated branches starting after the prior
  //     branch's subtree is fully emitted.
  //
  // childrenPlaced[parentId] counts children placed (for first-child detection
  // and later branch-point detection).
  // -----------------------------------------------------------------------
  const laneOf = new Map<string, number>();
  const laneEndRow: number[] = []; // index = lane, value = last occupied row (-1 = free)
  const childrenPlaced = new Map<string, number>(); // parentId → count placed

  let maxLane = 0;

  for (let i = 0; i < sorted.length; i++) {
    const cs = sorted[i];
    const parentId =
      cs.parentId && idSet.has(cs.parentId) ? cs.parentId : null;

    let lane: number;

    if (parentId === null) {
      // Root node: lane 0.
      lane = 0;
    } else {
      const parentRow = rowIndexOf.get(parentId)!;
      const placed = childrenPlaced.get(parentId) ?? 0;
      childrenPlaced.set(parentId, placed + 1);

      if (placed === 0) {
        // First child of parent: inherit parent's lane (trunk continuation).
        lane = laneOf.get(parentId)!;
      } else {
        // Additional child: find the lowest free branch lane > 0.
        // Lane L is free if laneEndRow[L] < parentRow.
        lane = 1;
        while ((laneEndRow[lane] ?? -1) >= parentRow) {
          lane++;
        }
        // Mark this lane occupied through the last descendant of this subtree.
        const lastDesc = lastDescRowOf.get(cs.id)!;
        laneEndRow[lane] = Math.max(laneEndRow[lane] ?? -1, lastDesc);
      }
    }

    laneOf.set(cs.id, lane);
    if (lane > maxLane) maxLane = lane;
  }

  // -----------------------------------------------------------------------
  // Step 5a: Build rows[] (oldest-first, definitive row order).
  // -----------------------------------------------------------------------
  const rows: LaidRow[] = sorted.map((cs, i) => ({
    id: cs.id,
    rowIndex: i,
    lane: laneOf.get(cs.id)!,
    y: rowYOf(i),
  }));

  // -----------------------------------------------------------------------
  // Step 5b: Build nodes[] (kind assignment priority: root > live > branch-point > older).
  // -----------------------------------------------------------------------
  const nodes: LaidNode[] = sorted.map((cs, i) => {
    const lane = laneOf.get(cs.id)!;
    const cx = laneXOf(lane);
    const cy = rowYOf(i);
    const hasParent = cs.parentId !== null && idSet.has(cs.parentId!);
    const placed = childrenPlaced.get(cs.id) ?? 0;

    let kind: LaidNode['kind'];
    if (!hasParent) {
      kind = 'root';
    } else if (cs.id === liveVersionId) {
      kind = 'live';
    } else if (placed > 1) {
      kind = 'branch-point';
    } else {
      kind = 'older';
    }

    return { id: cs.id, cx, cy, kind };
  });

  // -----------------------------------------------------------------------
  // Step 5c: Build connectors[] (one per non-root node to its parentId).
  // -----------------------------------------------------------------------
  const connectors: Connector[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cs = sorted[i];
    const parentId =
      cs.parentId && idSet.has(cs.parentId) ? cs.parentId : null;
    if (parentId === null) continue;

    const nodeLane = laneOf.get(cs.id)!;
    const parentLane = laneOf.get(parentId)!;
    const parentRowIdx = rowIndexOf.get(parentId)!;

    const px = laneXOf(parentLane);
    const py = rowYOf(parentRowIdx);
    const bx = laneXOf(nodeLane);
    const by = rowYOf(i);

    if (nodeLane === parentLane) {
      // Same lane: vertical trunk line.
      connectors.push({ kind: 'trunk', x1: px, y1: py, x2: bx, y2: by });
    } else {
      // Cross lane: cubic bezier. Formula from RESEARCH.md step 8 + sketch 002-A.
      const midY = (py + by) / 2;
      const d = `M ${px} ${py} C ${px + 34} ${py} ${bx} ${midY} ${bx} ${by}`;
      connectors.push({ kind: 'branch', d });
    }
  }

  // -----------------------------------------------------------------------
  // Step 5d: WIP connector (dashed stub above the live node).
  // -----------------------------------------------------------------------
  if (hasUncommittedWork && liveVersionId) {
    const liveRow = rows.find((r) => r.id === liveVersionId);
    if (liveRow) {
      const wipX = laneXOf(liveRow.lane);
      connectors.push({
        kind: 'wip',
        x1: wipX,
        y1: 0,
        x2: wipX,
        y2: liveRow.y - 9, // stop above live node outer circle (r=9)
      });
    }
  }

  // -----------------------------------------------------------------------
  // Step 6: Compute overall dimensions.
  // width = max(90, laneX(maxLane) + 8) — widens past 2 concurrent lanes.
  // height = numRows * 52.
  // -----------------------------------------------------------------------
  const width = Math.max(90, laneXOf(maxLane) + 8);
  const height = sorted.length * 52;

  return { rows, connectors, nodes, width, height };
}
