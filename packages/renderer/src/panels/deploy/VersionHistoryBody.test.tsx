/**
 * packages/renderer/src/panels/deploy/VersionHistoryBody.test.tsx
 * Component tests for the Phase 04.3-06 rework of VersionHistoryBody.
 *
 * Tests cover:
 *   Task 1 — layout (two-column graph, footer, meta line, is-active border)
 *   Task 2 — click behavior (silent reconcile, D-07 confirm, undo, in-flight guard,
 *             Branch-from-here, stale banner absence)
 *
 * Mocking strategy:
 *   - vi.mock for all Zustand stores (return controlled test values)
 *   - PARTIAL vi.mock for changesetService: selectVersion mocked (assert call/no-call —
 *     navigation is decoupled from deploy), flatten/flatEqual REAL (dirty-check tests
 *     exercise the true staging-vs-version comparison)
 *   - vi.mock for LaneGutter / laneLayout (provide stable controlled graph layout)
 *   - vi.mock for ActionBadge (trivial render helper)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

import { BASELINE_ID } from '@swg/contracts';
import type { SwgChangeset } from '@swg/contracts';
import type { GraphLayout } from './laneLayout';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../state/changesetStore', () => ({
  useChangesetStore: vi.fn(),
}));

vi.mock('../../state/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('../../state/stagingStore', () => ({
  useStagingStore: vi.fn(),
}));

const mockUndoFn = vi.fn();
vi.mock('../../state/undoStore', () => ({
  useUndoStore: vi.fn(),
}));

// Navigation is DECOUPLED from deploy: row clicks call selectVersion (pointer + staging
// materialization only). Partial mock — flatten/flatEqual stay REAL for the dirty-check tests.
const mockSelectVersion = vi.fn<[string | null], void>();
vi.mock('../../services/changesetService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/changesetService')>();
  return {
    ...actual,
    selectVersion: (id: string | null) => mockSelectVersion(id),
  };
});

vi.mock('./ActionBadge', () => ({
  default: ({ action }: { action: string }) => <span data-testid="action-badge">{action}</span>,
}));

vi.mock('./LaneGutter', () => ({
  LaneGutter: ({ layout }: { layout: GraphLayout }) => (
    <svg data-testid="lane-gutter" data-height={layout.height} />
  ),
}));

// Controlled laneLayout — returns rows matching the provided changeset list.
// Test can mutate this value before render.
let _mockLayoutRows: GraphLayout['rows'] = [];
vi.mock('./laneLayout', () => ({
  DELTA_ROW_H: 30,
  ROW_HEADER_H: 52,
  laneLayout: vi.fn((_cs: SwgChangeset[], _deployed: string | null) => {
    const rows = _mockLayoutRows;
    return {
      rows,
      connectors: [],
      nodes: [],
      width: 90,
      height: rows.length * 52,
    } satisfies GraphLayout;
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

import { useChangesetStore } from '../../state/changesetStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useStagingStore }   from '../../state/stagingStore';
import { useUndoStore }      from '../../state/undoStore';

// Build a minimal SwgChangeset
function makeCS(
  id: string,
  parentId: string | null,
  label: string,
  timestamp: string,
  deltas: SwgChangeset['deltas'] = [],
): SwgChangeset {
  return { id, parentId, label, timestamp, sealedBy: 'manual', deltas };
}

const BASELINE_CS = makeCS(BASELINE_ID, null, 'Baseline (pristine)', '2026-01-01T00:00:00.000Z', []);
const V1_CS = makeCS('v1', BASELINE_ID, 'First mod', '2026-01-02T12:00:00.000Z', [
  { virtualPath: 'appearance/blaster.sat', action: 'add', storedFileRef: 'blaster.sat', sha: 'abc123' },
]);
const V2_CS = makeCS('v2', 'v1', 'Second mod', '2026-01-03T09:30:00.000Z', [
  { virtualPath: 'appearance/armor.sat',   action: 'modify', storedFileRef: 'armor.sat',   sha: 'def456' },
  { virtualPath: 'appearance/helmet.sat',  action: 'modify', storedFileRef: 'helmet.sat',  sha: 'ghi789' },
]);
// Branch off v1 (parentId = v1, but chronologically after v2)
const V3_CS = makeCS('v3', 'v1', 'Branch: heavier blaster', '2026-01-04T14:00:00.000Z', [
  { virtualPath: 'appearance/blaster2.sat', action: 'add', storedFileRef: 'blaster2.sat', sha: 'jkl012' },
]);

const MOCK_CHANGESETS = [BASELINE_CS, V1_CS, V2_CS, V3_CS];
const MOCK_MANIFEST = {
  activeVersionId:   'v2',
  deployedVersionId: 'v2',
  changesets: MOCK_CHANGESETS,
};

// Layout rows for MOCK_CHANGESETS in oldest-first order
const MOCK_LAYOUT_ROWS: GraphLayout['rows'] = [
  { id: BASELINE_ID, rowIndex: 0, lane: 0, y: 26  },
  { id: 'v1',        rowIndex: 1, lane: 0, y: 78  },
  { id: 'v2',        rowIndex: 2, lane: 0, y: 130 },
  { id: 'v3',        rowIndex: 3, lane: 1, y: 182 },
];

function setupDefaultMocks(overrides: {
  deployedVersionId?: string | null;
  stagingEntries?: unknown[];
  canUndo?: boolean;
  undoFn?: () => unknown;
} = {}) {
  const {
    deployedVersionId = 'v2',
    stagingEntries = [],
    canUndo = false,
    undoFn = () => undefined,
  } = overrides;

  _mockLayoutRows = MOCK_LAYOUT_ROWS;

  (useChangesetStore as ReturnType<typeof vi.fn>).mockImplementation(
    (sel: (s: { manifest: typeof MOCK_MANIFEST }) => unknown) =>
      sel({ manifest: { ...MOCK_MANIFEST, deployedVersionId: deployedVersionId } }),
  );

  (useWorkspaceStore as ReturnType<typeof vi.fn>).mockImplementation(
    (sel: (s: { studioDir: string; clientPath: string }) => unknown) =>
      sel({ studioDir: '/fake/studio', clientPath: '/fake/client' }),
  );

  (useStagingStore as ReturnType<typeof vi.fn>).mockImplementation(
    (sel: (s: { entries: unknown[] }) => unknown) =>
      sel({ entries: stagingEntries }),
  );

  mockUndoFn.mockImplementation(undoFn);
  (useUndoStore as ReturnType<typeof vi.fn>).mockImplementation(
    (sel: (s: { canUndo: boolean; undo: () => unknown }) => unknown) =>
      sel({ canUndo, undo: mockUndoFn }),
  );

  mockSelectVersion.mockImplementation(() => undefined);
}

// ─── Task 1 — layout tests ────────────────────────────────────────────────────

describe('VersionHistoryBody — Task 1: Two-column layout', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a .graph-container with both .lane-col (LaneGutter SVG) and .graph-rows-col', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    const { container } = render(<VersionHistoryBody />);

    const gc = container.querySelector('.graph-container');
    expect(gc).not.toBeNull();

    // LaneGutter SVG is inside .lane-col
    const laneCol = gc!.querySelector('.lane-col');
    expect(laneCol).not.toBeNull();
    expect(within(laneCol as HTMLElement).getByTestId('lane-gutter')).toBeTruthy();

    // .graph-rows-col is beside the lane-col
    const rowsCol = gc!.querySelector('.graph-rows-col');
    expect(rowsCol).not.toBeNull();
  });

  it('renders exactly one row per changeset in layout.rows order (oldest-first)', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    // We have 4 changesets → 4 rows (Baseline + v1 + v2 + v3)
    const rows = screen.getAllByRole('button', { name: /Switch to/i });
    expect(rows).toHaveLength(4);
  });

  it('renders .ver-label with vN mono ordinal (v1=oldest, v4=newest) for each row', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    const labels = document.querySelectorAll('.ver-label');
    const texts = Array.from(labels).map((el) => el.textContent?.trim());

    // BASELINE_ID is rowIndex=0 → v1, v1 is rowIndex=1 → v2, etc.
    expect(texts).toContain('v1');
    expect(texts).toContain('v2');
    expect(texts).toContain('v3');
    expect(texts).toContain('v4');
  });

  it('status footer shows "N versions · N branches · live: vN — label"', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    const footer = document.querySelector('.graph-status-footer');
    expect(footer).not.toBeNull();
    const footerText = footer!.textContent ?? '';

    // 4 versions (Baseline + v1 + v2 + v3)
    expect(footerText).toMatch(/4 versions/);

    // v2 is live (rowIndex=2 → ordinal v3 in this setup).
    // "live: v3 — Second mod"
    expect(footerText).toMatch(/live:/);
    expect(footerText).toMatch(/Second mod/);
  });

  it('applies is-active class + accent border to the SELECTED (active) row only (A13)', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    const { container } = render(<VersionHistoryBody />);

    const activeNodes = container.querySelectorAll('.is-active');
    // Exactly one row is selected (mock activeVersionId = 'v2').
    expect(activeNodes.length).toBe(1);

    // It should have the accent left-border AND a lighter surface fill (inline style).
    const activeRow = activeNodes[0] as HTMLElement;
    expect(activeRow.style.borderLeft).toMatch(/var\(--color-accent\)/);
    expect(activeRow.style.background).toMatch(/var\(--color-surface-2\)/);
  });

  it('highlight follows the SELECTED version, not the deployed one (activeVersionId ≠ deployedVersionId)', async () => {
    // The Deploy button targets activeVersionId, so the row highlight must too — otherwise
    // selecting a version while nothing (or something else) is deployed leaves no visible selection.
    setupDefaultMocks({ deployedVersionId: 'v1' }); // live = v1, but selected (active) = 'v2'
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    const { container } = render(<VersionHistoryBody />);

    const activeNodes = container.querySelectorAll('.is-active');
    expect(activeNodes.length).toBe(1);
    // The selected row is 'v2' (activeVersionId), NOT the deployed 'v1'.
    expect((activeNodes[0] as HTMLElement).getAttribute('data-changeset-id')).toBe('v2');
  });

  it('does NOT apply is-active or accent border to branch rows', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    const { container } = render(<VersionHistoryBody />);

    // v3 (id='v3') is a branch node but is NOT the live row
    const v3Row = container.querySelector('[data-changeset-id="v3"]') as HTMLElement;
    expect(v3Row).not.toBeNull();
    expect(v3Row.classList.contains('is-active')).toBe(false);
    // Border should be transparent
    expect(v3Row.style.borderLeft).toMatch(/transparent/);
  });

  it('meta line shows "N files · branch from vN" for a branch node (A10)', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    // v3 (id='v3') is a branch from v1. v1 is rowIndex=1 → ordinal v2.
    // So the meta line should say "branch from v2"
    const metas = document.querySelectorAll('.ver-meta');
    const v3Meta = Array.from(metas).find((m) => m.textContent?.includes('branch from'));
    expect(v3Meta).toBeTruthy();
    expect(v3Meta!.textContent).toMatch(/branch from v2/);
    expect(v3Meta!.textContent).toMatch(/1 file/);
  });

  it('meta line does NOT say "branch from" for a non-branch node (A10)', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    // v2 (id='v2') is a trunk node (parent = v1, chronological predecessor)
    const v2Row = document.querySelector('[data-changeset-id="v2"]') as HTMLElement;
    expect(v2Row).not.toBeNull();
    const v2Meta = within(v2Row).queryAllByText(/branch from/).join('');
    expect(v2Meta).toBe('');
  });

  it('Baseline node is rendered with dashed-border styling and shows "Baseline (pristine)"', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    const { container } = render(<VersionHistoryBody />);

    const baselineNode = container.querySelector(`[data-changeset-id="${BASELINE_ID}"]`) as HTMLElement;
    expect(baselineNode).not.toBeNull();
    expect(baselineNode.classList.contains('baseline-node')).toBe(true);
    expect(baselineNode.textContent).toMatch(/Baseline \(pristine\)/);
  });

  it('does NOT render inline hardcoded node color (● removed from row header)', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    // Old code had: color: '#22c55e' and color: 'var(--color-success,#22c55e)'
    // The new code uses CSS vars only — no hardcoded green hex in the component tree.
    // Check that no element in the graph rows has a hardcoded hex color for node pips.
    const rowsCol = document.querySelector('.graph-rows-col') as HTMLElement;
    expect(rowsCol).not.toBeNull();
    // Serialized HTML should not contain the old inline hex color
    expect(rowsCol.innerHTML).not.toMatch(/#22c55e/);
    expect(rowsCol.innerHTML).not.toMatch(/#3b82f6/);
  });

  it('delta expansion (▸/▾) still works — clicking a row toggles sub-rows', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    const { container } = render(<VersionHistoryBody />);

    // v2 has 2 deltas
    const v2Row = container.querySelector('[data-changeset-id="v2"]') as HTMLElement;
    expect(v2Row).not.toBeNull();

    // Before expand: no action badges visible in v2's sub-rows
    expect(within(v2Row).queryAllByTestId('action-badge').length).toBe(0);

    // Click to expand
    await act(async () => { fireEvent.click(v2Row); });

    // After expand: action badges should appear (2 deltas)
    const badges = document.querySelectorAll('[data-testid="action-badge"]');
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT render a stale-deployment banner (D-08: stale concept removed)', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    expect(document.querySelector('.stale-deploy-warning')).toBeNull();
    expect(screen.queryByText(/Deployed version is not/i)).toBeNull();
  });

  it('does NOT render per-row "Deploy vN" or "Revert here" buttons (D-09)', async () => {
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    expect(screen.queryAllByTitle(/Revert here/i)).toHaveLength(0);
    expect(screen.queryAllByTitle(/Deploy v/i)).toHaveLength(0);
  });

  it('does NOT render a "Branch from here" affordance (removed — branching is implicit on save)', async () => {
    // Branching happens by SELECTING the changeset you want to branch from, then saving —
    // sealVersion parents the new version to the selected/active version. There is no explicit
    // "Branch from here" button (the old one set state nothing consumed; it was dead + confusing).
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    expect(screen.queryAllByTitle('Branch from here')).toHaveLength(0);
    expect(screen.queryByText(/Branch from here/i)).toBeNull();
  });
});

// ─── Task 2 — click / reconcile / undo tests ─────────────────────────────────

describe('VersionHistoryBody — Task 2: Row-click reconcile behavior', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clean-state row click calls selectVersion with NO confirm dialog (decoupled — no deploy)', async () => {
    setupDefaultMocks({ stagingEntries: [] }); // clean — no staged changes
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    // Click v1 row (id='v1')
    const v1Row = document.querySelector('[data-changeset-id="v1"]') as HTMLElement;
    await act(async () => { fireEvent.click(v1Row); });

    // selectVersion called with 'v1' — pointer + staging only, no client mutation
    expect(mockSelectVersion).toHaveBeenCalledWith('v1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dirty-state row click shows the D-07 confirm dialog', async () => {
    setupDefaultMocks({
      stagingEntries: [{ virtualPath: 'foo.sat', action: 'add' }], // dirty
    });
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    // Click v1 row
    const v1Row = document.querySelector('[data-changeset-id="v1"]') as HTMLElement;
    await act(async () => { fireEvent.click(v1Row); });

    // selectVersion NOT called yet (confirm pending)
    expect(mockSelectVersion).not.toHaveBeenCalled();

    // Confirm dialog appears
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('staging that EQUALS the active version (post-save) is NOT dirty — no confirm', async () => {
    // Regression: after Save/Deploy, sealVersion leaves the staging store holding the new
    // version's working set, so stagingEntries.length > 0 even though nothing is uncommitted.
    // hasUncommittedWork must compare staging vs flatten(activeVersion), not just length.
    // These entries are exactly flatten('v2') = v1+v2 deltas (armor, blaster, helmet).
    setupDefaultMocks({
      stagingEntries: [
        { virtualPath: 'appearance/armor.sat',   action: 'modify', sha256: 'def456' },
        { virtualPath: 'appearance/blaster.sat', action: 'add',    sha256: 'abc123' },
        { virtualPath: 'appearance/helmet.sat',  action: 'modify', sha256: 'ghi789' },
      ],
    });
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    // Switching to Baseline must reconcile silently — no "Discard unsaved changes?" dialog.
    const baselineRow = document.querySelector(`[data-changeset-id="${BASELINE_ID}"]`) as HTMLElement;
    await act(async () => { fireEvent.click(baselineRow); });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockSelectVersion).toHaveBeenCalledWith(BASELINE_ID);
  });

  it('accepting the D-07 confirm calls selectVersion', async () => {
    setupDefaultMocks({
      stagingEntries: [{ virtualPath: 'foo.sat', action: 'add' }], // dirty
    });
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    const v1Row = document.querySelector('[data-changeset-id="v1"]') as HTMLElement;
    await act(async () => { fireEvent.click(v1Row); });

    // Click "Discard and switch"
    const confirmBtn = screen.getByText(/Discard and switch/i);
    await act(async () => { fireEvent.click(confirmBtn); });

    expect(mockSelectVersion).toHaveBeenCalledWith('v1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancelling the D-07 confirm does NOT call selectVersion', async () => {
    setupDefaultMocks({
      stagingEntries: [{ virtualPath: 'foo.sat', action: 'add' }], // dirty
    });
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    const v1Row = document.querySelector('[data-changeset-id="v1"]') as HTMLElement;
    await act(async () => { fireEvent.click(v1Row); });

    // Click "Cancel"
    const cancelBtn = screen.getByText(/^Cancel$/i);
    await act(async () => { fireEvent.click(cancelBtn); });

    expect(mockSelectVersion).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Baseline node onClick calls selectVersion(BASELINE_ID)', async () => {
    setupDefaultMocks({ stagingEntries: [] });
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    const baselineRow = document.querySelector(`[data-changeset-id="${BASELINE_ID}"]`) as HTMLElement;
    await act(async () => { fireEvent.click(baselineRow); });

    expect(mockSelectVersion).toHaveBeenCalledWith(BASELINE_ID);
  });

  it('sequential clicks each select (selection is synchronous — no client mutation to serialize)', async () => {
    setupDefaultMocks({ stagingEntries: [] });
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    const v1Row = document.querySelector('[data-changeset-id="v1"]') as HTMLElement;
    const v2Row = document.querySelector('[data-changeset-id="v2"]') as HTMLElement;

    await act(async () => { fireEvent.click(v1Row); });
    expect(mockSelectVersion).toHaveBeenCalledWith('v1');

    // Selection completes synchronously; a subsequent click selects the next version.
    await act(async () => { fireEvent.click(v2Row); });
    expect(mockSelectVersion).toHaveBeenCalledWith('v2');
    expect(mockSelectVersion).toHaveBeenCalledTimes(2);
  });

  it('Undo button calls useUndoStore.undo() and re-selects the prior version (VER-04)', async () => {
    const priorVersionId = 'v1';
    setupDefaultMocks({
      canUndo: true,
      undoFn: () => ({
        priorLiveVersionId: priorVersionId,
        priorDeployRecord: undefined,
        takenAt: '2026-01-01T00:00:00Z',
      }),
    });

    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    const undoBtn = screen.getByTestId('undo-btn');
    await act(async () => { fireEvent.click(undoBtn); });

    expect(mockUndoFn).toHaveBeenCalledTimes(1);
    expect(mockSelectVersion).toHaveBeenCalledWith(priorVersionId);
  });

  it('Ctrl+Z triggers undo when canUndo is true', async () => {
    const priorVersionId = 'v1';
    setupDefaultMocks({
      canUndo: true,
      undoFn: () => ({
        priorLiveVersionId: priorVersionId,
        priorDeployRecord: undefined,
        takenAt: '2026-01-01T00:00:00Z',
      }),
    });

    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });

    expect(mockUndoFn).toHaveBeenCalledTimes(1);
    expect(mockSelectVersion).toHaveBeenCalledWith(priorVersionId);
  });

  it('nothing deployed (deployedVersionId=null) → Baseline row carries the "live" pip (stock is live)', async () => {
    // The live state must ALWAYS be readable: when the toolkit has nothing deployed, the
    // client is at stock, so Baseline is the live version — badge shows there, not nowhere.
    setupDefaultMocks({ deployedVersionId: null, stagingEntries: [] });
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    const baselineRow = document.querySelector(`[data-changeset-id="${BASELINE_ID}"]`) as HTMLElement;
    expect(baselineRow).not.toBeNull();
    expect(within(baselineRow).getByText('live')).toBeTruthy();
  });

  it('stale-deployment banner is absent from the DOM (D-08 removed stale concept)', async () => {
    // Even with activeVersionId !== deployedVersionId (pre-D-08 scenario)
    setupDefaultMocks({ deployedVersionId: 'v1' }); // live = v1, manifest active = v2
    const { default: VersionHistoryBody } = await import('./VersionHistoryBody');
    render(<VersionHistoryBody />);

    expect(document.querySelector('.stale-deploy-warning')).toBeNull();
    expect(screen.queryByText(/Deployed version is not/i)).toBeNull();
  });
});
