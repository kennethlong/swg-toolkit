/**
 * packages/renderer/src/panels/deploy/DeployPanel.test.tsx
 * Component tests for DeployPanel — DEPLOY-05 + non-client gating + Baseline dedupe + selectVersion
 *                                  + DEPLOYUI-01..05/11..12 (plan 04.3-07 Task 1)
 *
 * Tests:
 *   1 — renders staging section + version-history section + Baseline node + Deploy CTA in ONE panel
 *   2 — clicking a version row ▸-expands to its deltas[] (ActionBadge + virtualPath) AND calls selectVersion
 *   3 — Save version calls sealVersion({ sealedBy: 'manual' })
 *   4 — mod-project (status.info.kind) → Deploy CTA disabled with hint copy
 *   5 — Baseline node renders EXACTLY ONCE when changeset with id BASELINE_ID is seeded
 *   6 — DEPLOYUI-03/D5: section headers "Working changes (uncommitted)" + "Version History" present
 *   7 — DEPLOYUI-01/D3: collapsing staging section hides its body; caret changes
 *   8 — DEPLOYUI-02/D4: splitter hidden when staging section is collapsed
 *   9 — DEPLOYUI-11/D13: footer instructional hint is present
 *  10 — DEPLOYUI-12/D14: Deploy CTA is full-width (width:100%)
 *
 * Source: 04.1-03-PLAN.md Task 1; 04.3-07-PLAN.md Task 1.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom does not implement ResizeObserver — stub it so StagingPanelBody's
// ResizeObserver-based viewHeight tracking doesn't throw.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// vi.mock is hoisted by Vitest — declare BEFORE the import it replaces.
vi.mock('../../services/changesetService', () => ({
  sealVersion:    vi.fn().mockResolvedValue(undefined),
  selectVersion:  vi.fn(),
  setLiveVersion: vi.fn(),
  flatten:        vi.fn().mockReturnValue([]),
  flatEqual:      vi.fn().mockReturnValue(true),
}));

vi.mock('../../services/pathSafety', () => ({
  isVirtualPathSafe: vi.fn().mockReturnValue(true),
}));

import DeployPanel from './DeployPanel';
import { useChangesetStore } from '../../state/changesetStore';
import { useWorkspaceStore }  from '../../state/workspaceStore';
import { useStagingStore }    from '../../state/stagingStore';
import { selectVersion, sealVersion } from '../../services/changesetService';
import { BASELINE_ID } from '@swg/contracts';
import type { SwgChangeset, WorkspaceChangesetManifest, WorkspaceInfo } from '@swg/contracts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildManifest(
  nodes: Partial<SwgChangeset>[],
  activeVersionId: string | null = null,
): WorkspaceChangesetManifest {
  const changesets: SwgChangeset[] = nodes.map((n, i) => ({
    id:        n.id        ?? `v${i}`,
    parentId:  n.parentId  ?? null,
    label:     n.label     ?? `Changeset ${i}`,
    timestamp: n.timestamp ?? new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(),
    sealedBy:  n.sealedBy  ?? 'manual',
    deltas:    n.deltas    ?? [],
  }));
  return { activeVersionId, deployedVersionId: null, changesets };
}

function readyInfo(override: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    folderPath:    '/fake/project',
    studioDir:     '/fake/project/.studio',
    workspaceName: 'FakeProject',
    clientPath:    '/fake/client',
    kind:          'client',
    ...override,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  useChangesetStore.setState({
    manifest: { activeVersionId: null, deployedVersionId: null, changesets: [] },
    sealStatus: { kind: 'idle' },
  });
  // Default: workspace ready with a bound client
  useWorkspaceStore.setState({
    status:        { kind: 'ready', info: readyInfo() },
    folderPath:    '/fake/project',
    studioDir:     '/fake/project/.studio',
    workspaceName: 'FakeProject',
    clientPath:    '/fake/client',
    deployModel:   null,
    hasStaleDeployment: false,
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DeployPanel', () => {

  it('Test 1: renders staging section + version-history section + Baseline node + Deploy CTA in ONE panel', () => {
    const manifest = buildManifest([
      { id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] },
      { id: 'v1', parentId: BASELINE_ID, label: 'Add armor', deltas: [] },
    ], BASELINE_ID);
    useChangesetStore.setState({ manifest });

    render(<DeployPanel />);

    // Must render staging controls (Add… button)
    expect(screen.getByText('Add…')).toBeDefined();
    // Must render Save version control
    expect(screen.getByText('Save version')).toBeDefined();
    // Must render version history: both changeset labels
    expect(screen.getByText('Add armor')).toBeDefined();
    // Must render Baseline node
    expect(screen.getByText(/Baseline \(pristine\)/i)).toBeDefined();
    // Must render the Deploy CTA. In THIS fixture the selected version (Baseline) is
    // already live (nothing deployed = stock), so the CTA renders its disabled
    // "Baseline is live ✓" no-op state rather than "Deploy Baseline…".
    expect(screen.getByText(/Baseline is live/i)).toBeDefined();
  });

  it('Test 1b: Deploy CTA disables when the SELECTED version is already live (no-op)', () => {
    // v1 is both selected AND deployed, staging clean → deploying it would be a no-op.
    const manifest = buildManifest([
      { id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] },
      { id: 'v1', parentId: BASELINE_ID, label: 'Add armor', deltas: [] },
    ], 'v1');
    manifest.deployedVersionId = 'v1';
    useChangesetStore.setState({ manifest });

    render(<DeployPanel />);

    const cta = screen.getByRole('button', { name: /already live/i });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
    expect(cta.textContent).toMatch(/is live ✓/);
  });

  it('Test 1c: Deploy CTA stays ENABLED on the live version when uncommitted changes exist', () => {
    // Same selected===deployed, but staging holds an entry not in the version →
    // Deploy seals + ships a NEW version, never a no-op.
    const manifest = buildManifest([
      { id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] },
      { id: 'v1', parentId: BASELINE_ID, label: 'Add armor', deltas: [] },
    ], 'v1');
    manifest.deployedVersionId = 'v1';
    useChangesetStore.setState({ manifest });
    // flatten is mocked to [] → any staged entry counts as uncommitted.
    useStagingStore.setState({ entries: [{ virtualPath: 'foo.iff', action: 'add' }] as never });

    render(<DeployPanel />);

    const cta = screen.getByRole('button', { name: /^Deploy Add armor$/i });
    expect((cta as HTMLButtonElement).disabled).toBe(false);
    expect(cta.textContent).toMatch(/Deploy Add armor…/);

    // Cleanup — the staging store is the REAL zustand store, shared across tests.
    useStagingStore.setState({ entries: [] });
  });

  it('Test 2: clicking a version row ▸-expands its deltas[] AND selects it (decoupled — no deploy)', () => {
    const manifest = buildManifest([
      { id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] },
      {
        id: 'v1',
        parentId: BASELINE_ID,
        label: 'Add armor',
        deltas: [
          { virtualPath: 'appearance/armor.mgn', action: 'add' },
        ],
      },
    ], BASELINE_ID);
    useChangesetStore.setState({ manifest });

    render(<DeployPanel />);

    // Click the version row to expand it
    const v1LabelEl = screen.getByText('Add armor');
    expect(v1LabelEl).not.toBeNull();
    fireEvent.click(v1LabelEl);

    // Decoupled model (supersedes D-04): row click SELECTS via selectVersion — pointer +
    // staging materialization only, NO client mutation. Deploy is the explicit CTA.
    expect(selectVersion).toHaveBeenCalledWith('v1');

    // Delta virtualPath should still appear (▸ expansion KEEP item preserved)
    expect(screen.getByText('appearance/armor.mgn')).toBeDefined();
  });

  it('Test 3: Save version button exists and is enabled when staging has entries', async () => {
    const manifest = buildManifest([
      { id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] },
    ], BASELINE_ID);
    useChangesetStore.setState({ manifest });

    // Add a staging entry so Save version is enabled
    const { useStagingStore } = await import('../../state/stagingStore');
    useStagingStore.setState({
      entries: [{ virtualPath: 'test/file.iff', action: 'add' }],
      buildStatus: { kind: 'idle' },
    });

    render(<DeployPanel />);

    // Find the Save version button (aria-label is specific)
    const saveBtn = screen.getByRole('button', { name: 'Save version' });
    expect(saveBtn).toBeDefined();

    // The button should not be disabled when entries exist
    const isDisabled =
      (saveBtn as HTMLButtonElement).disabled === true ||
      saveBtn.getAttribute('aria-disabled') === 'true';
    expect(isDisabled).toBe(false);
  });

  it('Test 4: mod-project (status.info.kind) → Deploy CTA disabled with no-client hint', () => {
    // Drive the store with mod-project kind (no client)
    useWorkspaceStore.setState({
      status: {
        kind: 'ready',
        info: readyInfo({ kind: 'mod-project', clientPath: null }),
      },
      clientPath: null,
    });

    const manifest = buildManifest([
      { id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] },
    ], BASELINE_ID);
    useChangesetStore.setState({ manifest });

    render(<DeployPanel />);

    // Deploy CTA should be disabled for mod-project
    const deployBtn = screen.getByRole('button', { name: /Deploy disabled/i });
    expect(deployBtn).toBeDefined();
    const isDisabled =
      (deployBtn as HTMLButtonElement).disabled === true ||
      deployBtn.getAttribute('aria-disabled') === 'true';
    expect(isDisabled).toBe(true);

    // Hint copy should appear
    expect(screen.getByText(/No bound client/i)).toBeDefined();
  });

  it('Test 5: Baseline node renders EXACTLY ONCE when changeset with id BASELINE_ID is seeded', () => {
    const manifest = buildManifest([
      { id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] },
      { id: 'v1', parentId: BASELINE_ID, label: 'First version', deltas: [] },
    ], BASELINE_ID);
    useChangesetStore.setState({ manifest });

    render(<DeployPanel />);

    const baselineEls = screen.queryAllByText(/Baseline \(pristine\)/i);
    expect(baselineEls.length).toBe(1);
  });

  // ── Plan 04.3-07 Task 1 — DEPLOYUI-01..05/11..12 ──────────────────────────

  it('Test 6: DEPLOYUI-03/D5: section headers "Working changes (uncommitted)" and "Version History" present', () => {
    useChangesetStore.setState({
      manifest: buildManifest(
        [{ id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] }],
        BASELINE_ID,
      ),
    });
    render(<DeployPanel />);

    expect(screen.getByText(/Working changes \(uncommitted\)/i)).toBeDefined();
    expect(screen.getByText(/Version History/i)).toBeDefined();
  });

  it('Test 7: DEPLOYUI-01/D3: clicking staging header collapses the staging body', async () => {
    const { useStagingStore } = await import('../../state/stagingStore');
    useStagingStore.setState({
      entries: [{ virtualPath: 'test/file.iff', action: 'add' }],
      buildStatus: { kind: 'idle' },
    });
    useChangesetStore.setState({
      manifest: buildManifest(
        [{ id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] }],
        BASELINE_ID,
      ),
    });
    render(<DeployPanel />);

    // Staging entry visible before collapse
    expect(screen.getByText('test/file.iff')).toBeDefined();

    // Click the FIRST section header (staging) to collapse it.
    // Both headers have role="button"; the first is the staging header.
    const allCollapseBtns = screen.getAllByRole('button', { name: /Collapse section/i });
    expect(allCollapseBtns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(allCollapseBtns[0]!);

    // After collapsing, the staging body (virtualized list) is gone
    expect(screen.queryByText('test/file.iff')).toBeNull();
  });

  it('Test 8: DEPLOYUI-02/D4: splitter is NOT rendered when staging section is collapsed', async () => {
    useChangesetStore.setState({
      manifest: buildManifest(
        [{ id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] }],
        BASELINE_ID,
      ),
    });
    const { container } = render(<DeployPanel />);

    // Splitter visible when both expanded
    expect(container.querySelector('[data-testid="section-splitter"]')).not.toBeNull();

    // Collapse staging (first section header) — splitter must disappear (D4)
    const allCollapseBtns = screen.getAllByRole('button', { name: /Collapse section/i });
    fireEvent.click(allCollapseBtns[0]!);

    expect(container.querySelector('[data-testid="section-splitter"]')).toBeNull();
  });

  it('Test 9: DEPLOYUI-11/D13: deploy footer instructional hint is rendered', () => {
    useChangesetStore.setState({
      manifest: buildManifest(
        [{ id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] }],
        BASELINE_ID,
      ),
    });
    render(<DeployPanel />);

    const hint = screen.getByTestId('deploy-hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toMatch(/collapse a section/i);
  });

  it('Test 10: DEPLOYUI-12/D14: Deploy CTA button has full-width style (width 100%)', () => {
    useChangesetStore.setState({
      manifest: buildManifest(
        [{ id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] }],
        BASELINE_ID,
      ),
    });
    render(<DeployPanel />);

    // Find the Deploy button by its aria-label
    const deployBtn = screen.getByRole('button', { name: /Deploy/i, hidden: false });
    // The button should have width:100% inline style
    expect((deployBtn as HTMLButtonElement).style.width).toBe('100%');
  });

});
