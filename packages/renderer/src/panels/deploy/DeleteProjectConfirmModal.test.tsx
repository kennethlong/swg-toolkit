/**
 * packages/renderer/src/panels/deploy/DeleteProjectConfirmModal.test.tsx
 * Component tests for DeleteProjectConfirmModal — sketch 017 elements #3-#13 (04.4-10 Task 1).
 *
 * Tests:
 *   1 — never-deployed project renders the "nothing to restore" plan line, does not throw
 *   2 — cfg-model deployRecord renders the cfg restore plan line naming the cfg file
 *   3 — loose-model deployRecord renders the loose-override revert plan line
 *   4 — isCurrentlyOpen renders the amber "currently open" warn-line; absent when false
 *   5 — round-2 in-flight guard: clicking Delete twice in rapid succession results in exactly
 *       ONE onConfirm() call, and the button becomes disabled + relabels to "Deleting…"
 *
 * Real workspaceService/changesetService (SWG_TOOLKIT_DATA_ROOT-isolated via
 * test/setup-data-root.ts) — only clientLocator (registry/fs probing) is mocked.
 *
 * Source: 04.4-10-PLAN.md Task 1.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/clientLocator', () => ({
  detectClients: vi.fn().mockReturnValue([]),
}));

import DeleteProjectConfirmModal from './DeleteProjectConfirmModal';
import { getStudioDir } from '../../services/workspaceService';
import { writeManifest } from '../../services/changesetService';
import type { CfgDeployRecord, LooseDeployRecord, SwgChangeset, WorkspaceChangesetManifest } from '@swg/contracts';

function seedManifest(projectFolder: string, changesets: SwgChangeset[], deployedVersionId: string | null = null): void {
  const studioDir = getStudioDir(projectFolder);
  const manifest: WorkspaceChangesetManifest = {
    activeVersionId: changesets.length > 0 ? changesets[changesets.length - 1].id : null,
    deployedVersionId,
    changesets,
  };
  writeManifest(studioDir, manifest);
}

function cs(id: string, deployRecord?: CfgDeployRecord | LooseDeployRecord): SwgChangeset {
  return { id, parentId: null, label: id, timestamp: new Date().toISOString(), sealedBy: 'manual', deltas: [], deployRecord };
}

describe('DeleteProjectConfirmModal', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn().mockResolvedValue(undefined);
    onCancel = vi.fn();
  });

  it('renders the never-deployed "nothing to restore" line without throwing on an empty manifest', () => {
    const folder = `/tmp/proj-never-${Date.now()}`;
    // No manifest written at all — readManifest must gracefully return an empty manifest.
    expect(() => render(
      <DeleteProjectConfirmModal
        projectFolder={folder}
        projectName="Never Deployed"
        isCurrentlyOpen={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )).not.toThrow();

    expect(screen.getByText(/nothing to restore/i)).not.toBeNull();
  });

  it('renders the cfg-model restore line naming the cfg file', () => {
    const folder = `/tmp/proj-cfg-${Date.now()}`;
    const rec: CfgDeployRecord = {
      cfgPath: '/fake/swgtoolkit.cfg',
      includeTargetPath: '/fake/client/swgemu.cfg',
      keyName: 'searchTree_00_55',
      slot: 55,
      backupPath: '/fake/.swgtoolkit.bak',
      patchPath: '/fake/patch.tre',
      patchVersion: '5000',
    };
    seedManifest(folder, [cs('v1', rec)], 'v1');

    render(
      <DeleteProjectConfirmModal
        projectFolder={folder}
        projectName="Cfg Project"
        isCurrentlyOpen={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getAllByText(/Restore/i).length).toBeGreaterThan(0);
    expect(screen.getByText('swgemu.cfg')).not.toBeNull();
  });

  it('renders the loose-model revert line', () => {
    const folder = `/tmp/proj-loose-${Date.now()}`;
    const rec: LooseDeployRecord = {
      overrideDir: '/fake/client/override',
      writtenFiles: [],
      skippedDeletes: [],
    };
    seedManifest(folder, [cs('v1', rec)], 'v1');

    render(
      <DeleteProjectConfirmModal
        projectFolder={folder}
        projectName="Loose Project"
        isCurrentlyOpen={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(/Revert loose overrides/i)).not.toBeNull();
  });

  it('renders the amber "currently open" warn-line only when isCurrentlyOpen is true', () => {
    const folder = `/tmp/proj-open-${Date.now()}`;

    const { rerender } = render(
      <DeleteProjectConfirmModal
        projectFolder={folder}
        projectName="Open Project"
        isCurrentlyOpen={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByText(/currently open/i)).toBeNull();

    rerender(
      <DeleteProjectConfirmModal
        projectFolder={folder}
        projectName="Open Project"
        isCurrentlyOpen={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/currently open/i)).not.toBeNull();
  });

  it('round-2: clicking Delete twice in rapid succession results in exactly ONE onConfirm() call', async () => {
    const folder = `/tmp/proj-guard-${Date.now()}`;
    let resolveConfirm: () => void = () => {};
    onConfirm = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveConfirm = resolve; }));

    render(
      <DeleteProjectConfirmModal
        projectFolder={folder}
        projectName="Guard Project"
        isCurrentlyOpen={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const deleteBtn = screen.getByRole('button', { name: 'Delete project' }) as HTMLButtonElement;
    fireEvent.click(deleteBtn);
    fireEvent.click(deleteBtn); // second click before the first call resolves

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(deleteBtn.disabled).toBe(true);
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);
    await waitFor(() => expect(screen.getByText('Deleting…')).not.toBeNull());

    resolveConfirm();
    await waitFor(() => expect(deleteBtn.disabled).toBe(false));
  });
});
