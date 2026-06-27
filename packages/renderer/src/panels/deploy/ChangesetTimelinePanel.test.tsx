/**
 * packages/renderer/src/panels/deploy/ChangesetTimelinePanel.test.tsx
 * 5 unit tests for the ChangesetTimelinePanel graph-aware timeline UI.
 *
 * Tests:
 *   Test 1 — renders all node labels for a 3-node linear chain
 *   Test 2 — activeVersionId node has 'active-version-node' class
 *   Test 3 — deployedVersionId node has 'deployed-version-node' class; stale badge when active !== deployed
 *   Test 4 — clicking a node calls selectVersion(node.id)
 *   Test 5 — branch node (parentId skips the chronological predecessor) has 'branch-node' class
 *
 * TDD RED phase: tests compile but fail until Task 2 creates the real component.
 * TDD GREEN phase: all 5 tests pass once ChangesetTimelinePanel.tsx is implemented.
 *
 * R2-B4: imports from panels/deploy/ (NOT components/).
 * Source: 04-04b-PLAN.md Task 1; 04-CONTEXT.md §D-04-05..08.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import ChangesetTimelinePanel from './ChangesetTimelinePanel';
import { useChangesetStore } from '../../state/changesetStore';
import type { WorkspaceChangesetManifest, SwgChangeset } from '@swg/contracts';

// ─── Mock changesetService so selectVersion is a vi.fn() ─────────────────────
// vi.mock is hoisted by Vitest — the mock is active before any import resolves.
vi.mock('../../services/changesetService', () => ({
  selectVersion: vi.fn(),
}));

// Import AFTER mock declaration (hoisting ensures the mock is active).
import { selectVersion } from '../../services/changesetService';

// ─── Helper: build a manifest from partial changeset specs ───────────────────

function buildManifest(
  nodes: Partial<SwgChangeset>[],
  activeVersionId: string | null = null,
  deployedVersionId: string | null = null,
): WorkspaceChangesetManifest {
  const changesets: SwgChangeset[] = nodes.map((n, i) => ({
    id:           n.id        ?? `v${i}`,
    parentId:     n.parentId  ?? null,
    label:        n.label     ?? `Changeset ${i}`,
    timestamp:    n.timestamp ?? new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(),
    sealedBy:     n.sealedBy  ?? 'manual',
    deltas:       n.deltas    ?? [],
    deployRecord: n.deployRecord,
  }));
  return { activeVersionId, deployedVersionId, changesets };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Reset store to known empty state before each test.
  useChangesetStore.setState({
    manifest: { activeVersionId: null, deployedVersionId: null, changesets: [] },
    sealStatus: { kind: 'idle' },
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChangesetTimelinePanel', () => {

  it('Test 1: renders all 3 labels for a linear chain', () => {
    const manifest = buildManifest([
      { id: 'root', parentId: null,   label: 'Initial state' },
      { id: 'v1',   parentId: 'root', label: 'Add armor'     },
      { id: 'v2',   parentId: 'v1',   label: 'Fix texture'   },
    ]);
    useChangesetStore.setState({ manifest });

    render(<ChangesetTimelinePanel />);

    expect(screen.getByText('Initial state')).toBeDefined();
    expect(screen.getByText('Add armor')).toBeDefined();
    expect(screen.getByText('Fix texture')).toBeDefined();
  });

  it('Test 2: activeVersionId node has active-version-node class; others do not', () => {
    const manifest = buildManifest(
      [
        { id: 'root', parentId: null,   label: 'Root'   },
        { id: 'v1',   parentId: 'root', label: 'Active' },
        { id: 'v2',   parentId: 'v1',   label: 'Other'  },
      ],
      'v1', // activeVersionId
    );
    useChangesetStore.setState({ manifest });

    render(<ChangesetTimelinePanel />);

    const activeNodes = document.querySelectorAll('.active-version-node');
    expect(activeNodes.length).toBe(1);
    expect(activeNodes[0]?.textContent).toContain('Active');
  });

  it('Test 3: deployedVersionId node has deployed-version-node class; stale badge visible when active !== deployed', () => {
    const manifest = buildManifest(
      [
        { id: 'root', parentId: null,   label: 'Root'     },
        { id: 'v1',   parentId: 'root', label: 'Deployed' },
        { id: 'v2',   parentId: 'v1',   label: 'Current'  },
      ],
      'v2', // activeVersionId (different from deployed)
      'v1', // deployedVersionId
    );
    useChangesetStore.setState({ manifest });

    render(<ChangesetTimelinePanel />);

    // Deployed node carries the marker class
    const deployedNodes = document.querySelectorAll('.deployed-version-node');
    expect(deployedNodes.length).toBe(1);
    expect(deployedNodes[0]?.textContent).toContain('Deployed');

    // Stale-deployment warning is visible because active !== deployed
    const staleEl = document.querySelector('.stale-deploy-warning');
    expect(staleEl).not.toBeNull();
  });

  it('Test 4: clicking a node calls selectVersion with that node\'s id', () => {
    const manifest = buildManifest(
      [
        { id: 'root', parentId: null,   label: 'Root'      },
        { id: 'v1',   parentId: 'root', label: 'Version 1' },
      ],
      'root', // activeVersionId
    );
    useChangesetStore.setState({ manifest });

    render(<ChangesetTimelinePanel />);

    const v1node = screen.getByText('Version 1').closest('.changeset-node');
    expect(v1node).not.toBeNull();
    fireEvent.click(v1node!);

    expect(selectVersion).toHaveBeenCalledWith('v1');
  });

  it('Test 5: branch node (v3 off root, not off v2) has branch-node class; non-branch nodes do not', () => {
    // Linear main chain: root → v1 → v2 (chronologically earliest → latest)
    // Branch:           v3 → root  (branches off root, skipping v2 as predecessor)
    const manifest = buildManifest([
      { id: 'root', parentId: null,   label: 'Root',   timestamp: '2024-01-01T00:00:00.000Z' },
      { id: 'v1',   parentId: 'root', label: 'V1',     timestamp: '2024-01-01T00:00:01.000Z' },
      { id: 'v2',   parentId: 'v1',   label: 'V2',     timestamp: '2024-01-01T00:00:02.000Z' },
      { id: 'v3',   parentId: 'root', label: 'Branch', timestamp: '2024-01-01T00:00:03.000Z' },
    ]);
    useChangesetStore.setState({ manifest });

    render(<ChangesetTimelinePanel />);

    // At least one branch-node must exist
    const branchNodes = document.querySelectorAll('.branch-node');
    expect(branchNodes.length).toBeGreaterThan(0);

    // v3 is the branch node (parentId='root' while its chronological predecessor is v2)
    const v3El = screen.getByText('Branch').closest('.changeset-node');
    expect(v3El?.classList.contains('branch-node')).toBe(true);

    // root is NOT a branch node (it is the first chronological node)
    const rootEl = screen.getByText('Root').closest('.changeset-node');
    expect(rootEl?.classList.contains('branch-node')).toBe(false);
  });

});
