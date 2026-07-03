/**
 * packages/renderer/src/panels/deploy/LaneGutter.test.tsx
 * Component tests for <LaneGutter> SVG gutter (GRAPH-01..05).
 *
 * TDD RED (Wave-1): these tests fail against the Wave-0 stub (empty <svg>).
 * Plan 04.3-05 Task 2 implements LaneGutter.tsx to make them GREEN.
 *
 * Test inventory:
 *   (A) renders <svg class="lane-svg"> with layout dimensions
 *   (B) renders a branch <path> containing 'C' (cubic bezier) for a branched layout
 *   (C) live node renders TWO concentric circles: r=9 outer + r=4 inner
 *   (D) WIP dashed line appears only when layout has a 'wip' connector
 *
 * Acceptance criteria (from plan must_haves.sketch_diff):
 *   - GRAPH-02: trunk <line> with stroke="var(--color-border-soft)"
 *   - GRAPH-03: branch <path d="M ... C ..."> for cross-lane bezier
 *   - GRAPH-04: WIP <line stroke-dasharray="3 3"> only when hasUncommittedWork
 *   - GRAPH-05: live node = r=9 circle + r=4 inner dot; root/older = r=6 gray hollow
 *   - No hardcoded hex colors (CSS vars only)
 *
 * Source: 04.3-05-PLAN.md Task 2; sketch 002-version-graph-timeline/index.html:349-381.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LaneGutter } from './LaneGutter';
import type { GraphLayout } from './laneLayout';

// ---------------------------------------------------------------------------
// Fixture layouts (hand-crafted to avoid importing laneLayout in this test)
// ---------------------------------------------------------------------------

/** A 3-node layout with one trunk and one branch bezier connector. */
const branchedLayout: GraphLayout = {
  rows: [
    { id: 'v1', rowIndex: 0, lane: 0, y: 26 },
    { id: 'v2', rowIndex: 1, lane: 0, y: 78 },
    { id: 'v3', rowIndex: 2, lane: 1, y: 130 },
  ],
  connectors: [
    { kind: 'trunk', x1: 22, y1: 26, x2: 22, y2: 78 },
    { kind: 'branch', d: 'M 22 26 C 56 26 68 78 68 130' },
  ],
  nodes: [
    { id: 'v1', cx: 22, cy: 26, kind: 'root', deployed: false, selected: false },
    { id: 'v2', cx: 22, cy: 78, kind: 'branch-point', deployed: false, selected: false },
    { id: 'v3', cx: 68, cy: 130, kind: 'older', deployed: false, selected: false },
  ],
  width: 90,
  height: 156,
};

/** A 2-node layout with v2 as the deployed/live node (no WIP, nothing selected). */
const liveLayout: GraphLayout = {
  rows: [
    { id: 'v1', rowIndex: 0, lane: 0, y: 26 },
    { id: 'v2', rowIndex: 1, lane: 0, y: 78 },
  ],
  connectors: [{ kind: 'trunk', x1: 22, y1: 26, x2: 22, y2: 78 }],
  nodes: [
    { id: 'v1', cx: 22, cy: 26, kind: 'root', deployed: false, selected: false },
    { id: 'v2', cx: 22, cy: 78, kind: 'older', deployed: true, selected: false },
  ],
  width: 90,
  height: 104,
};

/** v1 selected (ring) while v2 is deployed (disc) — the decoupled steady state. */
const selectedLayout: GraphLayout = {
  rows: liveLayout.rows,
  connectors: liveLayout.connectors,
  nodes: [
    { id: 'v1', cx: 22, cy: 26, kind: 'root', deployed: false, selected: true },
    { id: 'v2', cx: 22, cy: 78, kind: 'older', deployed: true, selected: false },
  ],
  width: 90,
  height: 104,
};

/** Same as liveLayout plus a WIP connector. */
const wipLayout: GraphLayout = {
  rows: liveLayout.rows,
  connectors: [
    ...liveLayout.connectors,
    { kind: 'wip', x1: 22, y1: 0, x2: 22, y2: 69 },
  ],
  nodes: liveLayout.nodes,
  width: 90,
  height: 104,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LaneGutter', () => {
  // (A) SVG dimensions
  it('(A) renders <svg class="lane-svg"> with the layout width and height', () => {
    const { container } = render(<LaneGutter layout={branchedLayout} />);
    const svg = container.querySelector('svg.lane-svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe(String(branchedLayout.width));
    expect(svg?.getAttribute('height')).toBe(String(branchedLayout.height));
  });

  // (B) Branch cubic bezier — sketch element GRAPH-03 / A4
  it('(B) renders a branch <path> containing "C" for a branched layout', () => {
    const { container } = render(<LaneGutter layout={branchedLayout} />);
    const paths = Array.from(container.querySelectorAll('path'));
    const bezierPath = paths.find((p) => p.getAttribute('d')?.includes('C'));
    expect(bezierPath).toBeTruthy();
  });

  // (C) Deployed/live node — sketch element GRAPH-05 / A6+D-13
  it('(C) deployed node renders r=9 outer circle AND r=4 inner dot', () => {
    const { container } = render(<LaneGutter layout={liveLayout} />);
    const circles = Array.from(container.querySelectorAll('circle'));
    const outer = circles.find((c) => c.getAttribute('r') === '9');
    const inner = circles.find((c) => c.getAttribute('r') === '4');
    expect(outer).toBeTruthy();
    expect(inner).toBeTruthy();
  });

  // (C2) Selection ring — SELECTED node gets an r=12 accent ring, independent of deployed.
  it('(C2) selected node renders an r=12 accent ring; deployed node keeps its disc', () => {
    const { container } = render(<LaneGutter layout={selectedLayout} />);
    const circles = Array.from(container.querySelectorAll('circle'));

    // v1 selected → r=12 ring (fill none, accent stroke) around its r=6 hollow body
    const ring = circles.find((c) => c.getAttribute('r') === '12');
    expect(ring).toBeTruthy();
    expect(ring?.getAttribute('fill')).toBe('none');
    expect(ring?.getAttribute('stroke')).toBe('var(--color-accent)');

    // v2 deployed → still has the r=9 disc + r=4 inner dot (states are orthogonal)
    expect(circles.find((c) => c.getAttribute('r') === '9')).toBeTruthy();
    expect(circles.find((c) => c.getAttribute('r') === '4')).toBeTruthy();

    // liveLayout (nothing selected) renders NO ring
    const { container: noSel } = render(<LaneGutter layout={liveLayout} />);
    const noSelRing = Array.from(noSel.querySelectorAll('circle')).find(
      (c) => c.getAttribute('r') === '12',
    );
    expect(noSelRing).toBeFalsy();
  });

  // (D) WIP dashed line — sketch element GRAPH-04 / A5
  it('(D) WIP <line stroke-dasharray> appears only when layout has a wip connector', () => {
    const { container: withWip } = render(<LaneGutter layout={wipLayout} />);
    const { container: withoutWip } = render(<LaneGutter layout={liveLayout} />);

    // With WIP: at least one <line> with stroke-dasharray
    const wipLines = Array.from(withWip.querySelectorAll('line')).filter(
      (l) => l.hasAttribute('stroke-dasharray'),
    );
    expect(wipLines.length).toBeGreaterThan(0);

    // Without WIP: no <line> with stroke-dasharray
    const noDashLines = Array.from(withoutWip.querySelectorAll('line')).filter(
      (l) => l.hasAttribute('stroke-dasharray'),
    );
    expect(noDashLines.length).toBe(0);
  });

  // (E) Node/connector counts match layout
  it('(E) renders correct count of trunk lines and node circles', () => {
    const { container } = render(<LaneGutter layout={branchedLayout} />);
    // trunk connector count: 1 in branchedLayout
    const trunkLines = Array.from(container.querySelectorAll('line')).filter(
      (l) => !l.hasAttribute('stroke-dasharray'),
    );
    expect(trunkLines).toHaveLength(1);
    // node circles: 3 nodes (root r=6, branch-point r=6, older r=6) = 3 circles
    // (live nodes add an extra inner dot, not present here)
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(3);
  });
});
