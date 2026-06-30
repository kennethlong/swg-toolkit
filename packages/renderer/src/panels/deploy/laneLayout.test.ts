// @vitest-environment node
/**
 * packages/renderer/src/panels/deploy/laneLayout.test.ts
 * Wave-0 RED gate for laneLayout (Plan 04.3-02 Task 3).
 *
 * All topology cases (1–5) FAIL in RED because the stub returns an empty layout.
 * Case 6 (WIP connector) also fails. Wave-1 plan 05 implements the real algorithm;
 * tests go GREEN.
 *
 * Test inventory (GRAPH-01..05):
 *   (1) no-branch linear chain → all nodes lane 0, trunk connectors, height = 52*n
 *   (2) one branch → second child of root gets lane 1, cross-lane bezier connector
 *   (3) branch off non-tip → kind:'branch' connector with cubic-bezier d string
 *   (4) continue-on-branch → v5 inherits v4's lane; no false trunk to v3 (topology fix)
 *   (5) deep/wide: 3+ concurrent lanes → DISTINCT x per lane, width > 90
 *   (6) hasUncommittedWork=true → 'wip' connector exists in live node's lane
 *
 * Acceptance criteria from plan:
 *   - Case 3: explicitly asserts kind:'branch' connector with cubic-bezier d
 *   - Case 4: v5's connector targets v4 in SAME lane (not false trunk to v3)
 *   - Case 5: DISTINCT x per concurrently-active lane; width > 90 for >2 lanes
 *
 * Source: 04.3-02-PLAN.md Task 3; 04.3-RESEARCH.md § PRIMARY algorithm steps 1–12;
 *         sketch 002-version-graph-timeline/index.html:341-381.
 */

import { describe, it, expect } from 'vitest';
import { laneLayout } from './laneLayout';
import type { SwgChangeset } from '@swg/contracts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** ISO timestamp helper — day N of 2024-01. */
const T = (n: number): string =>
  `2024-01-${String(n).padStart(2, '0')}T00:00:00Z`;

/** Minimal SwgChangeset factory. */
function cs(id: string, parentId: string | null, day: number): SwgChangeset {
  return {
    id,
    parentId,
    label: id,
    timestamp: T(day),
    sealedBy: 'manual',
    deltas: [],
  };
}

/**
 * Lane x from lane index: 22 + 46 * lane.
 * From sketch 002-A and RESEARCH.md § lane geometry.
 */
const laneX = (lane: number): number => 22 + 46 * lane;

/**
 * Node y from row index: 52 * rowIndex + 26.
 * From sketch 002-A and RESEARCH.md § rowY.
 */
const rowY = (rowIndex: number): number => 52 * rowIndex + 26;

// ---------------------------------------------------------------------------
// Case 1: No-branch linear chain
// ---------------------------------------------------------------------------

describe('laneLayout — Wave-0 RED (stub returns empty layout)', () => {

  it('(1) no-branch linear chain: all nodes lane 0, trunk connectors only, height=52*n', () => {
    // v1 → v2 → v3 (simple trunk, no branches)
    const changesets = [
      cs('v1', null, 1),    // root
      cs('v2', 'v1', 2),
      cs('v3', 'v2', 3),
    ];

    const layout = laneLayout(changesets, null, false);

    // RED: stub returns [] → FAIL at first assertion
    expect(layout.rows).toHaveLength(3);

    // Oldest-first order
    expect(layout.rows[0]).toMatchObject({ id: 'v1', lane: 0, rowIndex: 0 });
    expect(layout.rows[1]).toMatchObject({ id: 'v2', lane: 0, rowIndex: 1 });
    expect(layout.rows[2]).toMatchObject({ id: 'v3', lane: 0, rowIndex: 2 });

    // Geometry
    expect(layout.height).toBe(52 * 3);

    // All connectors must be trunk (no cross-lane branch in a linear chain)
    expect(layout.connectors.length).toBeGreaterThan(0);
    expect(layout.connectors.every((c) => c.kind === 'trunk')).toBe(true);

    // Nodes: v1=root, v3=older, all lane 0
    const rootNode = layout.nodes.find((n) => n.id === 'v1');
    expect(rootNode?.kind).toBe('root');
    expect(rootNode?.cx).toBe(laneX(0)); // 22
    expect(rootNode?.cy).toBe(rowY(0));   // 26
  });

  // ---------------------------------------------------------------------------
  // Case 2: One branch off root (two children of root)
  // ---------------------------------------------------------------------------

  it('(2) one branch: second child of root → lane 1, cross-lane bezier connector', () => {
    // v1 (root)
    // v2 (parent v1, day 2) — first child of v1 → inherits lane 0
    // v3 (parent v1, day 3) — second child of v1 → gets lane 1 (branch)
    const changesets = [
      cs('v1', null, 1),
      cs('v2', 'v1', 2),
      cs('v3', 'v1', 3),
    ];

    const layout = laneLayout(changesets, null, false);

    // RED: stub returns [] → FAIL here
    expect(layout.rows).toHaveLength(3);

    // v3 must be in lane 1 (branch)
    const v3Row = layout.rows.find((r) => r.id === 'v3');
    expect(v3Row?.lane).toBe(1);
    expect(v3Row?.rowIndex).toBe(2); // oldest-first: v1(0) v2(1) v3(2)

    // v2 must be in lane 0 (inherits root's lane)
    const v2Row = layout.rows.find((r) => r.id === 'v2');
    expect(v2Row?.lane).toBe(0);

    // There must be a cross-lane connector from v1 (lane 0) to v3 (lane 1)
    const branchConn = layout.connectors.find((c) => c.kind === 'branch');
    expect(branchConn).toBeDefined();

    // Node: v3 must be at lane 1 x-coordinate
    const v3Node = layout.nodes.find((n) => n.id === 'v3');
    expect(v3Node?.cx).toBe(laneX(1)); // 68
  });

  // ---------------------------------------------------------------------------
  // Case 3: Branch off non-tip (defining 002-A visual) with cubic-bezier d
  // ---------------------------------------------------------------------------

  it('(3) branch off non-tip: kind:"branch" connector with cubic-bezier d string', () => {
    // v1 → v2 → v3 (trunk) + v2 → v4 (branch off v2, a non-tip node)
    // Row order (oldest-first): v1(0) v2(1) v3(2) v4(3)
    // v3 = first child of v2 → lane 0; v4 = second child of v2 → lane 1
    const changesets = [
      cs('v1', null, 1),
      cs('v2', 'v1', 2),
      cs('v3', 'v2', 3),   // first child of v2 → trunk lane 0
      cs('v4', 'v2', 4),   // second child of v2 → branch lane 1
    ];

    const layout = laneLayout(changesets, null, false);

    // RED: stub returns [] → FAIL here
    expect(layout.rows).toHaveLength(4);

    const v4Row = layout.rows.find((r) => r.id === 'v4');
    const v2Row = layout.rows.find((r) => r.id === 'v2');

    // v4 must be in lane 1 (branch from v2 which has v3 as first-placed child)
    expect(v4Row?.lane).toBe(1);
    expect(v4Row?.rowIndex).toBe(3);

    // The branch connector from v2 → v4 must be kind:'branch' with a cubic-bezier d
    // v2: lane 0, rowIndex 1 → cx=22, cy=78
    // v4: lane 1, rowIndex 3 → cx=68, cy=182
    // midY = (78 + 182) / 2 = 130
    // Bezier: M 22 78 C 56 78 68 130 68 182
    const branchConn = layout.connectors.find((c) => c.kind === 'branch');
    expect(branchConn).toBeDefined();
    // Must have a cubic-bezier path (starts with 'M', contains 'C')
    expect(branchConn?.d).toBeDefined();
    expect(branchConn?.d).toMatch(/^M\s+\d/);     // starts with M {x}
    expect(branchConn?.d).toContain('C');           // has cubic bezier control points
    // Exact geometry: parent is v2 (lane 0, row 1), branch to v4 (lane 1, row 3)
    expect(branchConn?.d).toBe(
      `M ${laneX(0)} ${rowY(v2Row!.rowIndex)} C ${laneX(0) + 34} ${rowY(v2Row!.rowIndex)} ${laneX(1)} ${(rowY(v2Row!.rowIndex) + rowY(v4Row!.rowIndex)) / 2} ${laneX(1)} ${rowY(v4Row!.rowIndex)}`
    );

    // v2 should be a branch-point (has >1 placed child)
    const v2Node = layout.nodes.find((n) => n.id === 'v2');
    expect(v2Node?.kind).toBe('branch-point');
  });

  // ---------------------------------------------------------------------------
  // Case 4: Continue-on-branch (topology fix — v5 inherits v4's lane)
  // ---------------------------------------------------------------------------

  it('(4) continue-on-branch: v5 inherits v4 lane; no false trunk to v3', () => {
    // Topology: v1←v2←v3 (trunk lane 0) + v4 parent v2 (branch lane 1) + v5 parent v4 (same lane 1)
    // Row order (oldest-first): v1(0) v2(1) v3(2) v4(3) v5(4)
    // v3 = first child of v2 → inherits lane 0
    // v4 = second child of v2 → new lane 1
    // v5 = first child of v4 → inherits lane 1 (the topology fix: NOT trunk to v3)
    const changesets = [
      cs('v1', null,  1),
      cs('v2', 'v1',  2),
      cs('v3', 'v2',  3),   // first child of v2 → lane 0
      cs('v4', 'v2',  4),   // second child of v2 → lane 1 (branch)
      cs('v5', 'v4',  5),   // first child of v4 → inherits lane 1
    ];

    const layout = laneLayout(changesets, null, false);

    // RED: stub returns [] → FAIL here
    expect(layout.rows).not.toHaveLength(0);

    const v5Row = layout.rows.find((r) => r.id === 'v5');
    const v4Row = layout.rows.find((r) => r.id === 'v4');
    const v3Row = layout.rows.find((r) => r.id === 'v3');

    // v5 must be in the SAME lane as v4 (continue-on-branch)
    expect(v5Row?.lane).toBe(v4Row?.lane);  // both lane 1
    expect(v5Row?.lane).toBe(1);

    // v5's connector to v4 must be a TRUNK (same lane), not a cross-lane branch
    // Trunk connector for v5→v4: x1=x2=laneX(1)=68, y1=rowY(v4Row), y2=rowY(v5Row)
    const v5TrunkConn = layout.connectors.find(
      (c) =>
        c.kind === 'trunk' &&
        c.x1 === laneX(1) &&
        c.x2 === laneX(1) &&
        c.y2 === rowY(v5Row!.rowIndex),
    );
    expect(v5TrunkConn).toBeDefined();

    // v5 must NOT have a cross-lane branch connector to v3's row
    const falseTrunkToV3 = layout.connectors.find(
      (c) =>
        c.kind === 'branch' &&
        c.d !== undefined &&
        v3Row !== undefined &&
        c.d.includes(String(rowY(v3Row.rowIndex))),
    );
    expect(falseTrunkToV3).toBeUndefined();

    // v4 must have a cross-lane bezier connector to v2 (its actual parent)
    const v4BranchConn = layout.connectors.find(
      (c) => c.kind === 'branch' && c.d !== undefined &&
             c.d.startsWith(`M ${laneX(0)}`),
    );
    expect(v4BranchConn).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Case 5: Deep/wide tree with 3+ concurrent lanes
  // ---------------------------------------------------------------------------

  it('(5) deep/wide: 3 concurrent lanes → DISTINCT x per lane; width > 90', () => {
    // v1 (root, lane 0)
    // v2 (parent v1, day 2) — first child → inherits lane 0
    // v3 (parent v1, day 3) — second child → new lane 1
    // v4 (parent v1, day 4) — third child → new lane 2
    // All three branch children of v1 are concurrent (active simultaneously from row 1-3)
    const changesets = [
      cs('v1', null, 1),
      cs('v2', 'v1', 2),  // lane 0
      cs('v3', 'v1', 3),  // lane 1
      cs('v4', 'v1', 4),  // lane 2
    ];

    const layout = laneLayout(changesets, null, false);

    // RED: stub returns [] → FAIL here
    expect(layout.rows).not.toHaveLength(0);

    const v2Row = layout.rows.find((r) => r.id === 'v2');
    const v3Row = layout.rows.find((r) => r.id === 'v3');
    const v4Row = layout.rows.find((r) => r.id === 'v4');

    // Lane assignments: v2=0, v3=1, v4=2
    expect(v2Row?.lane).toBe(0);
    expect(v3Row?.lane).toBe(1);
    expect(v4Row?.lane).toBe(2);

    // Node x-coordinates must be DISTINCT per lane
    const v2Node = layout.nodes.find((n) => n.id === 'v2');
    const v3Node = layout.nodes.find((n) => n.id === 'v3');
    const v4Node = layout.nodes.find((n) => n.id === 'v4');

    expect(v2Node?.cx).toBe(laneX(0)); // 22
    expect(v3Node?.cx).toBe(laneX(1)); // 68
    expect(v4Node?.cx).toBe(laneX(2)); // 114

    // Must not collapse/overlap: all three x values are DISTINCT
    expect(v2Node?.cx).not.toBe(v3Node?.cx);
    expect(v3Node?.cx).not.toBe(v4Node?.cx);
    expect(v2Node?.cx).not.toBe(v4Node?.cx);

    // Width must be > 90 to accommodate 3 concurrent lanes
    // width = max(90, 22 + 46*2 + 8) = max(90, 122) = 122
    expect(layout.width).toBeGreaterThan(90);
    expect(layout.width).toBeGreaterThanOrEqual(22 + 46 * 2 + 8); // 122
  });

  // ---------------------------------------------------------------------------
  // Case 6: hasUncommittedWork=true → 'wip' connector above live node
  // ---------------------------------------------------------------------------

  it('(6) hasUncommittedWork=true → a "wip" connector exists in the live node\'s lane', () => {
    const changesets = [
      cs('v1', null, 1),
      cs('v2', 'v1', 2),
    ];

    const layout = laneLayout(changesets, 'v2', /* hasUncommittedWork = */ true);

    // RED: stub returns [] connectors → FAIL here
    const wipConn = layout.connectors.find((c) => c.kind === 'wip');
    expect(wipConn).toBeDefined();

    // WIP connector must be in the live node's lane (v2 is trunk → lane 0, x=22)
    const liveNode = layout.nodes.find((n) => n.id === 'v2');
    expect(liveNode?.kind).toBe('live');

    // 'live' node must be rendered as accent-filled (kind:'live')
    expect(layout.nodes.find((n) => n.kind === 'live')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Additional contract: layout.rows is the single row-order source
  // ---------------------------------------------------------------------------

  it('layout.rows is oldest-first and is the authoritative row-order source', () => {
    // Even if changesets are passed newest-first, layout.rows must be oldest-first
    const changesets = [
      cs('v3', 'v2', 3),  // newest first
      cs('v2', 'v1', 2),
      cs('v1', null,  1),
    ];

    const layout = laneLayout(changesets, null, false);

    // RED: stub returns [] → FAIL here
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows[0]?.id).toBe('v1');  // oldest first
    expect(layout.rows[1]?.id).toBe('v2');
    expect(layout.rows[2]?.id).toBe('v3');
  });

  // ---------------------------------------------------------------------------
  // Node kind: root and live markers
  // ---------------------------------------------------------------------------

  it('root node (no parentId) has kind:"root"; live node (id===liveVersionId) has kind:"live"', () => {
    const changesets = [
      cs('v1', null, 1),
      cs('v2', 'v1', 2),
    ];

    const layout = laneLayout(changesets, 'v2', false);

    // RED: stub returns [] → FAIL here
    const rootNode = layout.nodes.find((n) => n.id === 'v1');
    const liveNode = layout.nodes.find((n) => n.id === 'v2');

    expect(rootNode?.kind).toBe('root');
    expect(liveNode?.kind).toBe('live');
  });

});
