/**
 * packages/renderer/src/panels/deploy/VcsPanel.test.tsx
 * Component tests for VcsPanel's Server Push section (04.4-12 Tasks 1-2).
 *
 * Tests:
 *   1 — Section absent when workspace.serverConfig is unset (the common case)
 *   2 — Section present with type/path when serverConfig is set (core3-wsl2)
 *   3 — Reopening the panel rehydrates the Reset button from disk (readCore3PushRecord),
 *       without requiring another push first
 *   4 — Push is disabled with a visible reason when manifest.activeVersionId is null
 *   5 — Core3 push dispatches pushCore3TreOverride with the frozen path contract + slug,
 *       and shows the Core3 restart-required guidance
 *   6 — swg-main push dispatches pushSwgMainOverride with the frozen path contract,
 *       and shows the reloadTable/reloadServerTemplate guidance
 *   7 — Reset calls reset*Override THEN clears the record file unconditionally, and
 *       clears local state
 *   8 — Push failure surfaces inline error text, never silent
 *
 * Source: 04.4-12-PLAN.md Tasks 1-2.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { WorkspaceInfo } from '@swg/contracts';

// ── Mocks (hoisted) ────────────────────────────────────────────────────────────

vi.mock('../../services/gitLfsService', () => ({
  gitCommit:      vi.fn(),
  gitPush:        vi.fn(),
  refreshLog:     vi.fn().mockResolvedValue(undefined),
  getGuardStatus: vi.fn(),
  probeLfsStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/changesetService', () => ({
  readManifest: vi.fn(),
}));

vi.mock('../../services/core3ServerPush', () => ({
  pushCore3TreOverride:   vi.fn(),
  resetCore3TreOverride:  vi.fn(),
  readCore3PushRecord:    vi.fn(),
  clearCore3PushRecordFile: vi.fn(),
}));

vi.mock('../../services/swgMainServerPush', () => ({
  pushSwgMainOverride:      vi.fn(),
  resetSwgMainOverride:     vi.fn(),
  readSwgMainPushRecord:    vi.fn(),
  clearSwgMainPushRecordFile: vi.fn(),
}));

vi.mock('path', () => {
  const p = {
    join:     (...parts: string[]) => parts.join('/'),
    basename: (s: string) => s.split(/[/\\]/).pop() ?? s,
  };
  return { default: p, ...p };
});

import VcsPanel from './VcsPanel';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useVcsStore } from '../../state/vcsStore';
import { readManifest } from '../../services/changesetService';
import {
  pushCore3TreOverride,
  resetCore3TreOverride,
  readCore3PushRecord,
  clearCore3PushRecordFile,
} from '../../services/core3ServerPush';
import {
  pushSwgMainOverride,
  resetSwgMainOverride,
  readSwgMainPushRecord,
  clearSwgMainPushRecordFile,
} from '../../services/swgMainServerPush';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeWorkspaceInfo(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    folderPath:    '/fake/project',
    studioDir:     '/fake/studio',
    workspaceName: 'myproject',
    clientPath:    null,
    kind:          'mod-project',
    ...overrides,
  };
}

const dockviewProps = {} as unknown as Parameters<typeof VcsPanel>[0];

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  useWorkspaceStore.setState({
    status:        { kind: 'idle' },
    folderPath:    null,
    studioDir:     null,
    workspaceName: null,
    clientPath:    null,
  });

  useVcsStore.setState({
    commitStatus: { kind: 'idle' },
    lfsStatus:    { kind: 'unknown' },
    guardResult:  null,
    log:          [],
  });

  (readManifest as ReturnType<typeof vi.fn>).mockReturnValue({
    activeVersionId:   null,
    deployedVersionId: null,
    changesets:        [],
  });
  (readCore3PushRecord as ReturnType<typeof vi.fn>).mockReturnValue(null);
  (readSwgMainPushRecord as ReturnType<typeof vi.fn>).mockReturnValue(null);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('VcsPanel — Server Push section (04.4-12)', () => {
  it('Test 1: section absent when workspace.serverConfig is unset', () => {
    const info = makeWorkspaceInfo(); // no serverConfig
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info },
      folderPath:    info.folderPath,
      studioDir:     info.studioDir,
      workspaceName: info.workspaceName,
      clientPath:    info.clientPath,
    });

    render(<VcsPanel {...dockviewProps} />);

    expect(screen.queryByText('Server Push')).toBeNull();
  });

  it('Test 2: section present with type/path when serverConfig is set (core3-wsl2)', () => {
    const info = makeWorkspaceInfo({
      serverConfig: { type: 'core3-wsl2', path: '\\\\wsl.localhost\\Debian\\home\\kenny\\workspace\\Core3\\MMOCoreORB\\bin', hostPort: '127.0.0.1:44463' },
    });
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info },
      folderPath:    info.folderPath,
      studioDir:     info.studioDir,
      workspaceName: info.workspaceName,
      clientPath:    info.clientPath,
    });

    render(<VcsPanel {...dockviewProps} />);

    expect(screen.getByText('Server Push')).not.toBeNull();
    expect(screen.getByText('core3-wsl2')).not.toBeNull();
    expect(screen.getByText(info.serverConfig!.path)).not.toBeNull();
  });

  it('Test 3: reopening the panel rehydrates the Reset button from disk (no re-push needed)', () => {
    const info = makeWorkspaceInfo({
      serverConfig: { type: 'core3-wsl2', path: '/fake/core3/MMOCoreORB/bin', hostPort: '127.0.0.1:44463' },
    });
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info },
      folderPath:    info.folderPath,
      studioDir:     info.studioDir,
      workspaceName: info.workspaceName,
      clientPath:    info.clientPath,
    });

    (readCore3PushRecord as ReturnType<typeof vi.fn>).mockReturnValue({
      confDir:                       '/fake/core3/MMOCoreORB/bin/conf',
      configLocalPath:               '/fake/core3/MMOCoreORB/bin/conf/config-local.lua',
      trePath:                       '/fake/tre',
      treFileName:                   'swgtoolkit_myproject_v1.tre',
      insertedLine:                  'table.insert(Core3.TreFiles, 1, "swgtoolkit_myproject_v1.tre")',
      wasConfigLocalCreatedByToolkit: true,
    });

    render(<VcsPanel {...dockviewProps} />);

    expect(readCore3PushRecord).toHaveBeenCalledWith(info.studioDir);
    expect(screen.getByRole('button', { name: 'Reset server push' })).not.toBeNull();
  });

  it('Test 4: Push disabled with a visible reason when manifest.activeVersionId is null', () => {
    const info = makeWorkspaceInfo({
      serverConfig: { type: 'core3-wsl2', path: '/fake/core3/MMOCoreORB/bin', hostPort: '127.0.0.1:44463' },
    });
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info },
      folderPath:    info.folderPath,
      studioDir:     info.studioDir,
      workspaceName: info.workspaceName,
      clientPath:    info.clientPath,
    });

    render(<VcsPanel {...dockviewProps} />);

    const pushBtn = screen.getByRole('button', { name: 'Push to Server' }) as HTMLButtonElement;
    expect(pushBtn.disabled).toBe(true);
    expect(screen.getByText('no saved version yet')).not.toBeNull();
  });

  it('Test 5: Core3 push dispatches pushCore3TreOverride with the frozen path contract + slug, shows restart guidance', async () => {
    const info = makeWorkspaceInfo({
      serverConfig: { type: 'core3-wsl2', path: '/fake/core3/MMOCoreORB/bin', hostPort: '127.0.0.1:44463' },
    });
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info },
      folderPath:    info.folderPath,
      studioDir:     info.studioDir,
      workspaceName: info.workspaceName,
      clientPath:    info.clientPath,
    });

    (readManifest as ReturnType<typeof vi.fn>).mockReturnValue({
      activeVersionId:   'v1',
      deployedVersionId: null,
      changesets:        [],
    });

    (pushCore3TreOverride as ReturnType<typeof vi.fn>).mockReturnValue({
      confDir:                       '/fake/core3/MMOCoreORB/bin/conf',
      configLocalPath:               '/fake/core3/MMOCoreORB/bin/conf/config-local.lua',
      trePath:                       '/fake/tre',
      treFileName:                   'swgtoolkit_myproject_v1.tre',
      insertedLine:                  'table.insert(Core3.TreFiles, 1, "swgtoolkit_myproject_v1.tre")',
      wasConfigLocalCreatedByToolkit: true,
    });

    render(<VcsPanel {...dockviewProps} />);

    const pushBtn = screen.getByRole('button', { name: 'Push to Server' }) as HTMLButtonElement;
    expect(pushBtn.disabled).toBe(false);
    fireEvent.click(pushBtn);

    await waitFor(() => expect(pushCore3TreOverride).toHaveBeenCalled());

    expect(pushCore3TreOverride).toHaveBeenCalledWith(
      '/fake/core3/MMOCoreORB/bin/conf',
      info.studioDir,
      'v1',
      expect.objectContaining({ activeVersionId: 'v1' }),
      'myproject',
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Restart Core3 to load it/),
      ).not.toBeNull(),
    );
  });

  it('Test 6: swg-main push dispatches pushSwgMainOverride with the frozen path contract, shows reload guidance', async () => {
    const info = makeWorkspaceInfo({
      serverConfig: { type: 'swgsource-docker', path: '/fake/swg-main', hostPort: '127.0.0.1:44462' },
    });
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info },
      folderPath:    info.folderPath,
      studioDir:     info.studioDir,
      workspaceName: info.workspaceName,
      clientPath:    info.clientPath,
    });

    (readManifest as ReturnType<typeof vi.fn>).mockReturnValue({
      activeVersionId:   'v1',
      deployedVersionId: null,
      changesets:        [],
    });

    (pushSwgMainOverride as ReturnType<typeof vi.fn>).mockReturnValue({
      overrideDir:   '/fake/swg-main/data/sku.0/sys.server/compiled/game',
      writtenFiles:  [],
    });

    render(<VcsPanel {...dockviewProps} />);

    const pushBtn = screen.getByRole('button', { name: 'Push to Server' }) as HTMLButtonElement;
    fireEvent.click(pushBtn);

    await waitFor(() => expect(pushSwgMainOverride).toHaveBeenCalled());

    expect(pushSwgMainOverride).toHaveBeenCalledWith(
      '/fake/swg-main/exe/shared/servercommon.cfg',
      info.studioDir,
      'v1',
      expect.objectContaining({ activeVersionId: 'v1' }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/reloadTable\/reloadServerTemplate/),
      ).not.toBeNull(),
    );
  });

  it('Test 7: Reset calls reset*Override THEN clears the record file unconditionally, clears local state', async () => {
    const info = makeWorkspaceInfo({
      serverConfig: { type: 'core3-wsl2', path: '/fake/core3/MMOCoreORB/bin', hostPort: '127.0.0.1:44463' },
    });
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info },
      folderPath:    info.folderPath,
      studioDir:     info.studioDir,
      workspaceName: info.workspaceName,
      clientPath:    info.clientPath,
    });

    const record = {
      confDir:                       '/fake/core3/MMOCoreORB/bin/conf',
      configLocalPath:               '/fake/core3/MMOCoreORB/bin/conf/config-local.lua',
      trePath:                       '/fake/tre',
      treFileName:                   'swgtoolkit_myproject_v1.tre',
      insertedLine:                  'table.insert(Core3.TreFiles, 1, "swgtoolkit_myproject_v1.tre")',
      wasConfigLocalCreatedByToolkit: true,
    };
    (readCore3PushRecord as ReturnType<typeof vi.fn>).mockReturnValue(record);

    render(<VcsPanel {...dockviewProps} />);

    const resetBtn = screen.getByRole('button', { name: 'Reset server push' });
    fireEvent.click(resetBtn);

    await waitFor(() => expect(resetCore3TreOverride).toHaveBeenCalledWith(record));

    const resetOrder = (resetCore3TreOverride as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const clearOrder = (clearCore3PushRecordFile as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(resetOrder).toBeLessThan(clearOrder);
    expect(clearCore3PushRecordFile).toHaveBeenCalledWith(info.studioDir);

    // Local state cleared — Reset button no longer rendered.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reset server push' })).toBeNull(),
    );
  });

  it('Test 8: Push failure surfaces inline error text, never silent', async () => {
    const info = makeWorkspaceInfo({
      serverConfig: { type: 'core3-wsl2', path: '/fake/core3/MMOCoreORB/bin', hostPort: '127.0.0.1:44463' },
    });
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info },
      folderPath:    info.folderPath,
      studioDir:     info.studioDir,
      workspaceName: info.workspaceName,
      clientPath:    info.clientPath,
    });

    (readManifest as ReturnType<typeof vi.fn>).mockReturnValue({
      activeVersionId:   'v1',
      deployedVersionId: null,
      changesets:        [],
    });

    (pushCore3TreOverride as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Core3 conf/config.lua not found at /fake/core3/MMOCoreORB/bin/conf/config.lua');
    });

    render(<VcsPanel {...dockviewProps} />);

    const pushBtn = screen.getByRole('button', { name: 'Push to Server' });
    fireEvent.click(pushBtn);

    await waitFor(() =>
      expect(screen.getByText(/push failed — Core3 conf\/config\.lua not found/)).not.toBeNull(),
    );
  });
});
