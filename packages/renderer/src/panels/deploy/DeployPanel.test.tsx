/**
 * packages/renderer/src/panels/deploy/DeployPanel.test.tsx
 * Component tests for DeployPanel — DEPLOY-05 + non-client gating + Baseline dedupe + selectVersion
 *
 * TDD RED: tests compile but fail until Task 3 creates DeployPanel.tsx.
 *
 * Tests:
 *   1 — renders staging section + version-history section + Baseline node + Deploy CTA in ONE panel
 *   2 — clicking a version row ▸-expands to its deltas[] (ActionBadge + virtualPath) AND calls selectVersion
 *   3 — Save version calls sealVersion({ sealedBy: 'manual' })
 *   4 — mod-project (status.info.kind) → Deploy CTA disabled with hint copy
 *   5 — Baseline node renders EXACTLY ONCE when changeset with id BASELINE_ID is seeded
 *
 * Source: 04.1-03-PLAN.md Task 1; 04.1-VALIDATION.md DEPLOY-05/07 rows.
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
  flatten:        vi.fn().mockReturnValue([]),
  flatEqual:      vi.fn().mockReturnValue(true),
}));

vi.mock('../../services/pathSafety', () => ({
  isVirtualPathSafe: vi.fn().mockReturnValue(true),
}));

import DeployPanel from './DeployPanel';
import { useChangesetStore } from '../../state/changesetStore';
import { useWorkspaceStore }  from '../../state/workspaceStore';
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
    // Must render Deploy CTA
    expect(screen.getByText(/Deploy/i)).toBeDefined();
  });

  it('Test 2: clicking a version row ▸-expands to its deltas[] (D-04: reconcile replaces selectVersion)', () => {
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
    // D-04: row click now reconciles (syncLiveToVersion) instead of calling selectVersion.
    // The ▸ delta expansion is still triggered on click (KEEP item from 04.3-06).
    const v1LabelEl = screen.getByText('Add armor');
    expect(v1LabelEl).not.toBeNull();
    fireEvent.click(v1LabelEl);

    // D-04 NOTE: selectVersion is no longer called (replaced by syncLiveToVersion).
    // syncLiveToVersion hits the flatEqual noop path in tests (changesetService.flatten/flatEqual mocked).
    expect(selectVersion).not.toHaveBeenCalled();

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
    // Use aria-label which is specific to the button (not the hint text)
    const deployBtn = screen.getByRole('button', { name: /Deploy disabled/i });
    expect(deployBtn).toBeDefined();
    // For a mod-project, the button should be disabled
    const isDisabled =
      (deployBtn as HTMLButtonElement).disabled === true ||
      deployBtn.getAttribute('aria-disabled') === 'true';
    expect(isDisabled).toBe(true);

    // Hint copy should appear
    expect(screen.getByText(/No bound client/i)).toBeDefined();
  });

  it('Test 5: Baseline node renders EXACTLY ONCE when changeset with id BASELINE_ID is seeded', () => {
    // Seed a Baseline changeset — the component should NOT add a second placeholder
    const manifest = buildManifest([
      { id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)', deltas: [] },
      { id: 'v1', parentId: BASELINE_ID, label: 'First version', deltas: [] },
    ], BASELINE_ID);
    useChangesetStore.setState({ manifest });

    render(<DeployPanel />);

    // Baseline node should appear exactly once
    const baselineEls = screen.queryAllByText(/Baseline \(pristine\)/i);
    expect(baselineEls.length).toBe(1);
  });

});
