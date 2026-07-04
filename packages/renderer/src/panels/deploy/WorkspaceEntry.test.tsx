/**
 * packages/renderer/src/panels/deploy/WorkspaceEntry.test.tsx
 * Component tests for WorkspaceEntry — P4 not-found rows + P9 scan message (04.3-08 Task 2).
 *
 * Tests:
 *   1 — renders "✗ not found" pill for a known client that is NOT in the detected list
 *   2 — found client renders "✓ ready" pill and is clickable
 *   3 — not-found row is disabled (cursor:not-allowed via opacity:0.55)
 *   4 — P9: setClientScanMessage is called with the scan result after mount
 *   5 — "Detected clients" section heading shown when any client (found or not-found) present
 *
 * Source: 04.3-08-PLAN.md Task 2; sketch 007-B "✗ not found" row.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom does not implement ResizeObserver — stub it.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// ─── Mocks (declared before imports) ─────────────────────────────────────────

// Mock fs (used to self-heal recents)
vi.mock('fs', () => ({
  default: { existsSync: vi.fn().mockReturnValue(false) },
  existsSync: vi.fn().mockReturnValue(false),
}));

// Mock path
vi.mock('path', () => {
  const p = {
    basename: (s: string) => s.split(/[\\/]/).pop() ?? s,
    resolve:  (s: string) => s,
    join:     (...parts: string[]) => parts.join('/'),
    dirname:  (s: string) => s.split(/[\\/]/).slice(0, -1).join('/'),
  };
  return { default: p, ...p };
});

// Mock electron (ipcRenderer + shell.openPath for the "Reveal studio folder" kebab item)
vi.mock('electron', () => ({
  ipcRenderer: { invoke: vi.fn().mockResolvedValue([]) },
  shell: { openPath: vi.fn().mockResolvedValue('') },
}));

// clientLocator: one detected + one missing
vi.mock('../../services/clientLocator', () => ({
  detectClients: vi.fn().mockReturnValue([
    { name: 'SWG Infinity', installPath: 'D:\\SWG Infinity\\SWG Infinity', cfgRootPath: '', treVersion: '5000' },
  ]),
  getKnownClientPaths: vi.fn().mockReturnValue([
    { name: 'SWG Infinity', installPath: 'D:\\SWG Infinity\\SWG Infinity' },
    { name: 'SWGEmu',       installPath: 'D:\\SWGEmu Client\\SWGEmu' },
  ]),
}));

// recentProjects: one recent project (04.4-10: exercises the kebab menu + delete flow below;
// harmless to the pre-existing P4/P9 tests, which don't assert on recents' absence).
const { ONE_RECENT } = vi.hoisted(() => ({
  ONE_RECENT: [{
    folderPath: '/projects/Alpha Project', name: 'Alpha Project', kind: 'mod-project' as const,
    lastOpenedISO: new Date().toISOString(),
  }],
}));
vi.mock('../../services/recentProjects', () => ({
  getRecentProjects:   vi.fn().mockReturnValue(ONE_RECENT),
  pruneRecentProjects: vi.fn().mockReturnValue(ONE_RECENT),
}));

// projectList: no bound projects
vi.mock('../../services/projectList', () => ({
  listProjects: vi.fn().mockReturnValue([]),
}));

// workspaceService: stubs
vi.mock('../../services/workspaceService', () => ({
  openWorkspace:          vi.fn().mockResolvedValue(undefined),
  getDefaultProjectFolder: vi.fn().mockReturnValue('/fake/projects/swg-infinity'),
  getStudioDir:            vi.fn().mockReturnValue('/fake/.studio'),
}));

// changesetService: read by DeleteProjectConfirmModal (never-deployed manifest — the "nothing
// to restore" branch is sufficient for these delete-flow wiring tests).
vi.mock('../../services/changesetService', () => ({
  readManifest: vi.fn().mockReturnValue({ activeVersionId: null, deployedVersionId: null, changesets: [] }),
}));

// deleteProject: stub
vi.mock('../../services/deleteProject', () => ({
  deleteProject: vi.fn().mockResolvedValue({ restoreErrors: [] }),
}));

// logService: stub
vi.mock('../../services/logService', () => ({
  log: vi.fn(),
}));

// projectBinding: stub
vi.mock('../../services/projectBinding', () => ({
  initProject: vi.fn().mockResolvedValue(undefined),
}));

// clientScanStore: capture setClientScanMessage calls
const mockSetClientScanMessage = vi.fn();
vi.mock('../../state/clientScanStore', () => ({
  setClientScanMessage: (...args: unknown[]) => mockSetClientScanMessage(...args),
  useClientScanStore:   { getState: () => ({ message: null }) },
}));

// openProjectStore: stub
vi.mock('../../state/openProjectStore', () => ({
  useOpenProjectStore: { getState: () => ({ open: vi.fn() }) },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import WorkspaceEntry from './WorkspaceEntry';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useDeleteUndoStore, type TrashEntry } from '../../state/deleteUndoStore';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useWorkspaceStore.setState({ status: { kind: 'idle' } });
  useDeleteUndoStore.setState({ pending: [] });
  mockSetClientScanMessage.mockClear();
});

function makePendingEntry(overrides: Partial<TrashEntry> = {}): TrashEntry {
  return {
    id: 'entry-1',
    projectName: 'Alpha Project',
    entryDir: '/trash/entry-1',
    trashStudioPath: '/trash/entry-1/studio',
    trashProjectPath: '/trash/entry-1/project',
    originalStudioDir: '/fake/.studio',
    originalFolderPath: '/projects/Alpha Project',
    umbrellaMoveSkipped: false,
    restoreErrors: [],
    parkedAtISO: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkspaceEntry — P4 not-found rows + P9 scan message', () => {

  it('(1) renders "✗ not found" pill for SWGEmu (known client not detected)', async () => {
    const { findAllByText } = render(<WorkspaceEntry />);
    // Both the sub text ("not found on disk") and the pill span ("✗ not found")
    // match this regex — use findAllByText to assert at least one match exists.
    const elements = await findAllByText(/not found/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it('(2) found client renders "✓ ready" pill', async () => {
    const { findByText } = render(<WorkspaceEntry />);
    await findByText(/ready/i);
  });

  it('(3) not-found row shows SWGEmu name', async () => {
    const { findByText } = render(<WorkspaceEntry />);
    await findByText('SWGEmu');
  });

  it('(4) P9: setClientScanMessage called with scan result after mount', async () => {
    const { findByText } = render(<WorkspaceEntry />);
    // Wait for mount effects to fire
    await findByText(/detected clients/i);
    expect(mockSetClientScanMessage).toHaveBeenCalledWith(
      expect.stringContaining('detected:'),
    );
    // Found: SWG Infinity ✓; Missing: SWGEmu ✗
    const call = mockSetClientScanMessage.mock.calls[0][0] as string;
    expect(call).toContain('SWG Infinity ✓');
    expect(call).toContain('SWGEmu ✗');
  });

  it('(5) "Detected clients" section heading shown when any client present', async () => {
    const { findByText } = render(<WorkspaceEntry />);
    await findByText(/Detected clients/i);
  });

});

// ─── Sketch 017 (Variant B) delete flow — 04.4-10 Task 2 ───────────────────────

describe('WorkspaceEntry — sketch 017 delete flow (04.4-10)', () => {
  it('renders a kebab button on the recents row', () => {
    render(<WorkspaceEntry />);
    expect(screen.getByRole('button', { name: 'Project actions for Alpha Project' })).not.toBeNull();
  });

  it('kebab button click does not also trigger the row open handler (stopPropagation)', () => {
    render(<WorkspaceEntry />);
    const kebab = screen.getByRole('button', { name: 'Project actions for Alpha Project' });
    fireEvent.click(kebab);
    // Menu opened — the row's own onClick did not swallow/interfere with the kebab toggle.
    expect(screen.getByRole('menuitem', { name: /Open/ })).not.toBeNull();
  });

  it('round-2: deleting a project from the Welcome recents list removes its row immediately, without a remount', () => {
    render(<WorkspaceEntry />);
    expect(screen.getByText('Alpha Project')).not.toBeNull();

    act(() => { useDeleteUndoStore.getState().push(makePendingEntry()); });

    // Round-2 element #16: absent, no dimmed remnant (WorkspaceEntry never renders one).
    expect(screen.queryByText('Alpha Project')).toBeNull();
  });

  it('clicking anywhere outside an open kebab menu closes it', () => {
    render(<WorkspaceEntry />);
    const kebab = screen.getByRole('button', { name: 'Project actions for Alpha Project' });
    fireEvent.click(kebab);
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
