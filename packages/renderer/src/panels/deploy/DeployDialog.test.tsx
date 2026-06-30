/**
 * packages/renderer/src/panels/deploy/DeployDialog.test.tsx
 * Component tests for DeployDialog — 04.3-07 Task 3 changes.
 *
 * Tests:
 *   1 — DEPLOYUI-11/D13: dialog title shows "Deploy vN — label" when active version exists
 *   2 — DEPLOYUI-11/D13: dialog title shows "Deploy patch" when no active version
 *   3 — DEPLOYUI-12/D14: "detected" badge present on auto-detected client rows
 *   4 — DEPLOYUI-13/D15: "(recommended)" label present on Absolute path model option
 *   5 — VER-07: deploy model section hidden when isForwardDeploy=false
 *   6 — VER-07: deploy model section visible when isForwardDeploy=true (default)
 *   7 — DEPLOYUI-12/D14: "not found" row shown when bound client not in detected list
 *
 * Source: 04.3-07-PLAN.md Task 3.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────

vi.mock('../../services/changesetService', () => ({
  flatten:                    vi.fn().mockReturnValue([]),
  sealVersion:                vi.fn().mockResolvedValue(undefined),
  setDeployedVersion:         vi.fn(),
  setLiveVersion:             vi.fn(),
  readManifest:               vi.fn().mockReturnValue({
    activeVersionId:  null,
    deployedVersionId: null,
    changesets: [],
  }),
  flatEqual:                  vi.fn().mockReturnValue(true),
  updateChangesetDeployRecord: vi.fn(),
}));

vi.mock('../../services/packPatch', () => ({
  packPatch:      vi.fn(),
  buildPatchName: vi.fn().mockReturnValue('toolkit_patch_abc.tre'),
}));

vi.mock('../../services/clientLocator', () => ({
  detectClients:    vi.fn().mockReturnValue([]),
  scanSharedFile:   vi.fn().mockReturnValue({ occupiedSlots: [], maxSearchPriority: 500, skuSuffix: '_00_' }),
  chooseSlot:       vi.fn().mockReturnValue(501),
}));

vi.mock('../../services/cfgActivator', () => ({
  activatePatch:    vi.fn().mockReturnValue({ cfgPath: '/fake/swgtoolkit.cfg', keyName: 'searchTree_00_501', slot: 501, backupPath: null }),
  deactivatePatch:  vi.fn(),
  ensureInclude:    vi.fn(),
  snapshotCfg:      vi.fn().mockReturnValue('/fake/snapshot.bak'),
  restoreCfg:       vi.fn(),
  getToolkitCfgPath: vi.fn().mockReturnValue('/fake/swgtoolkit.cfg'),
}));

vi.mock('../../services/shadowBaseService', () => ({
  deployShadowBase: vi.fn().mockResolvedValue({}),
  resetShadow:      vi.fn(),
  estimateTreSize:  vi.fn().mockReturnValue(0),
}));

vi.mock('../../services/clientLayout', () => ({
  resolveLayout: vi.fn().mockReturnValue({ cfgFile: 'swgemu.cfg' }),
}));

vi.mock('../../services/looseOverrideDeploy', () => ({
  resolveOverrideDir: vi.fn().mockReturnValue(null),
  deployLoose:        vi.fn(),
  resetLoose:         vi.fn(),
}));

vi.mock('../../services/clientSearchOrder', () => ({
  resolveClientMountOrder: vi.fn().mockReturnValue(null),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    statSync:   vi.fn().mockReturnValue({ size: 0 }),
    mkdirSync:  vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync:     vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  statSync:   vi.fn().mockReturnValue({ size: 0 }),
  mkdirSync:  vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmSync:     vi.fn(),
}));

vi.mock('path', () => {
  const p = {
    isAbsolute: (s: string) => s.startsWith('/') || /^[A-Za-z]:/.test(s),
    basename:   (s: string) => s.split(/[/\\]/).pop() ?? s,
    join:       (...parts: string[]) => parts.join('/'),
    dirname:    (s: string) => s.split(/[/\\]/).slice(0, -1).join('/') || '.',
    resolve:    (...parts: string[]) => parts.join('/'),
  };
  return { default: p, ...p };
});

vi.mock('electron', () => ({
  ipcRenderer: { invoke: vi.fn().mockResolvedValue([]) },
}));

import { DeployDialog } from './DeployDialog';
import { useChangesetStore } from '../../state/changesetStore';
import { useWorkspaceStore }  from '../../state/workspaceStore';
import { readManifest }       from '../../services/changesetService';
import { detectClients }      from '../../services/clientLocator';

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  useChangesetStore.setState({
    manifest: { activeVersionId: null, deployedVersionId: null, changesets: [] },
    sealStatus: { kind: 'idle' },
  });
  useWorkspaceStore.setState({ studioDir: null, clientPath: null, workspaceName: null });

  // Default: readManifest returns no active version
  (readManifest as ReturnType<typeof vi.fn>).mockReturnValue({
    activeVersionId:   null,
    deployedVersionId: null,
    changesets:        [],
  });

  // Default: no clients detected
  (detectClients as ReturnType<typeof vi.fn>).mockReturnValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DeployDialog — 04.3-07 Task 3', () => {

  it('Test 1 (D13): title shows "Deploy vN — label" when active version exists', () => {
    useWorkspaceStore.setState({ studioDir: '/fake/studio', clientPath: null, workspaceName: 'proj' });
    (readManifest as ReturnType<typeof vi.fn>).mockReturnValue({
      activeVersionId:   'cs-1',
      deployedVersionId: null,
      changesets: [{ id: 'cs-1', label: 'heavier blaster', entries: [], parentId: null, timestamp: 0 }],
    });

    render(<DeployDialog open={true} onClose={() => {}} />);

    const title = screen.getByTestId('deploy-dialog-title');
    expect(title.textContent).toMatch(/Deploy v1/);
    expect(title.textContent).toMatch(/heavier blaster/);
  });

  it('Test 2 (D13): title shows "Deploy patch" when no active version', () => {
    useWorkspaceStore.setState({ studioDir: null, clientPath: null, workspaceName: null });

    render(<DeployDialog open={true} onClose={() => {}} />);

    const title = screen.getByTestId('deploy-dialog-title');
    expect(title.textContent).toBe('Deploy patch');
  });

  it('Test 3 (D14): "detected" badge on auto-detected client rows', () => {
    (detectClients as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: 'SWG Infinity', installPath: '/swg/infinity', cfgRootPath: '/swg/infinity/swgemu.cfg', treVersion: '0005' },
    ]);

    render(<DeployDialog open={true} onClose={() => {}} />);

    const badges = screen.getAllByTestId('client-detected-badge');
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].textContent).toBe('detected');
  });

  it('Test 4 (D15): "(recommended)" label on Absolute path model option', () => {
    render(<DeployDialog open={true} onClose={() => {}} />);

    const label = screen.getByTestId('model-recommended-label');
    expect(label.textContent).toMatch(/recommended/i);
  });

  it('Test 5 (VER-07): deploy model section hidden when isForwardDeploy=false', () => {
    render(<DeployDialog open={true} onClose={() => {}} isForwardDeploy={false} />);

    // Deploy model section contains "Absolute path" text — should be absent
    const absPath = screen.queryByText('Absolute path');
    expect(absPath).toBeNull();
  });

  it('Test 6 (VER-07): deploy model section visible when isForwardDeploy=true (default)', () => {
    render(<DeployDialog open={true} onClose={() => {}} />);

    // Deploy model section should be present
    const absPath = screen.queryByText('Absolute path');
    expect(absPath).not.toBeNull();
  });

  it('Test 7 (D14): "not found" row shown when bound client not in detected list', () => {
    useWorkspaceStore.setState({ studioDir: null, clientPath: '/bound/swg/client', workspaceName: null });
    // detectClients returns empty — bound client is not detected
    (detectClients as ReturnType<typeof vi.fn>).mockReturnValue([]);

    render(<DeployDialog open={true} onClose={() => {}} />);

    const notFoundRow = screen.getByTestId('client-row-not-found');
    expect(notFoundRow).toBeDefined();
    expect(notFoundRow.textContent).toMatch(/not found/i);
  });

});
