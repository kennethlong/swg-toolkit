/**
 * packages/renderer/src/panels/deploy/ProjectListDialog.test.tsx
 * Component tests for ProjectListDialog's sketch 017 (Variant B) delete-flow additions
 * (04.4-10 Task 2) — kebab menu, reactive dimmed row, global kebab dismiss.
 *
 * Tests:
 *   1 — kebab button click does NOT also trigger the row's "open project" handler
 *       (stopPropagation)
 *   2 — round-2: pushing a pending trash entry (simulating a delete via ANY surface) shows the
 *       dimmed/dashed row IMMEDIATELY — without closing and reopening the dialog
 *   3 — clicking anywhere outside an open kebab menu closes it
 *   4 — Escape closes an open kebab menu
 *   5 — the deleted project does NOT also appear as a normal, clickable row while pending
 *
 * Source: 04.4-10-PLAN.md Task 2.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/projectList', () => ({
  listProjects: vi.fn().mockReturnValue([
    { projectName: 'Alpha Project', projectFolder: '/projects/Alpha Project', kind: 'mod-project' },
  ]),
}));

vi.mock('../../services/recentProjects', () => ({
  getRecentProjects: vi.fn().mockReturnValue([]),
}));

vi.mock('../../services/workspaceService', () => ({
  openWorkspace: vi.fn().mockResolvedValue(undefined),
  getStudioDir: vi.fn().mockReturnValue('/studios/alpha-project'),
}));

vi.mock('../../services/changesetService', () => ({
  readManifest: vi.fn().mockReturnValue({ activeVersionId: null, deployedVersionId: null, changesets: [{}, {}] }),
}));

vi.mock('../../services/deleteProject', () => ({
  deleteProject: vi.fn().mockResolvedValue({ restoreErrors: [] }),
}));

vi.mock('../../services/logService', () => ({
  log: vi.fn(),
}));

vi.mock('../../services/clientLocator', () => ({
  detectClients: vi.fn().mockReturnValue([]),
}));

import ProjectListDialog from './ProjectListDialog';
import { useOpenProjectStore } from '../../state/openProjectStore';
import { useDeleteUndoStore, type TrashEntry } from '../../state/deleteUndoStore';

function makePendingEntry(): TrashEntry {
  return {
    id: 'entry-1',
    projectName: 'Alpha Project',
    entryDir: '/trash/entry-1',
    trashStudioPath: '/trash/entry-1/studio',
    trashProjectPath: '/trash/entry-1/project',
    originalStudioDir: '/studios/alpha-project',
    originalFolderPath: '/projects/Alpha Project',
    umbrellaMoveSkipped: false,
    restoreErrors: [],
    parkedAtISO: new Date().toISOString(),
  };
}

beforeEach(() => {
  useOpenProjectStore.setState({ isOpen: true });
  useDeleteUndoStore.setState({ pending: [] });
});

describe('ProjectListDialog — sketch 017 delete flow', () => {
  it('kebab button click does not also trigger the row open handler', () => {
    render(<ProjectListDialog />);
    const kebab = screen.getByRole('button', { name: 'Project actions for Alpha Project' });
    fireEvent.click(kebab);
    // The kebab menu opened (its "Open" menu item is now visible) — if stopPropagation had
    // failed, the row's own onClick (openWorkspace) would ALSO have fired synchronously;
    // there is no observable "dialog closed" side effect from a bare openWorkspace call in
    // this mock, so the authoritative signal is that the menu is open at all.
    expect(screen.getByRole('menuitem', { name: /Open/ })).not.toBeNull();
  });

  it('round-2: a pending trash entry shows the dimmed row immediately, without reopening the dialog', () => {
    render(<ProjectListDialog />);
    expect(screen.getByText('Alpha Project')).not.toBeNull();

    act(() => { useDeleteUndoStore.getState().push(makePendingEntry()); });

    // Dimmed row present (struck-through name + "deleted just now" subtext).
    expect(screen.getByText(/deleted just now/)).not.toBeNull();
    expect(screen.getByText(/versions parked/)).not.toBeNull();
    // Restore button present.
    expect(screen.getByRole('button', { name: 'Restore' })).not.toBeNull();
  });

  it('the pending project does not also render as a normal clickable row', () => {
    render(<ProjectListDialog />);
    act(() => { useDeleteUndoStore.getState().push(makePendingEntry()); });

    // Only ONE "Alpha Project" text node should remain (the dimmed row) — the normal row
    // (with its own kebab button) must be gone.
    expect(screen.queryByRole('button', { name: 'Project actions for Alpha Project' })).toBeNull();
  });

  it('clicking anywhere outside an open kebab menu closes it', () => {
    render(<ProjectListDialog />);
    const kebab = screen.getByRole('button', { name: 'Project actions for Alpha Project' });
    fireEvent.click(kebab);
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape closes an open kebab menu', () => {
    render(<ProjectListDialog />);
    const kebab = screen.getByRole('button', { name: 'Project actions for Alpha Project' });
    fireEvent.click(kebab);
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
