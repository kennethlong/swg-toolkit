/**
 * packages/renderer/src/panels/deploy/DeleteUndoToast.test.tsx
 * Component tests for DeleteUndoToast — sketch 017 elements #14/#17b (04.4-10 Task 3).
 *
 * Tests:
 *   1 — pushing a TrashEntry onto useDeleteUndoStore shows the 🗑 delete toast with an Undo button
 *   2 — an entry whose restoreErrors is non-empty shows the ⚠ variant with the error text
 *   3 — clicking Undo restores the entry (removed from pending) and shows a SECOND "restored"
 *       toast whose copy never mentions a client re-deploy (locked undo contract)
 *   4 — a restore triggered from ELSEWHERE (not this toast's own Undo button — e.g. the dimmed
 *       row's Restore button) still fires the post-restore toast (round-2 element #17b)
 *   5 — an occupied-destination Undo failure keeps the ORIGINAL toast visible with an inline
 *       error, and does NOT show the "restored" toast
 *
 * Source: 04.4-10-PLAN.md Task 3.
 */

import React from 'react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/changesetService', () => ({
  readManifest: vi.fn().mockReturnValue({ activeVersionId: null, deployedVersionId: null, changesets: [{}, {}] }),
}));

vi.mock('../../services/logService', () => ({
  log: vi.fn(),
}));

import DeleteUndoToast from './DeleteUndoToast';
import { useDeleteUndoStore, type TrashEntry } from '../../state/deleteUndoStore';

/**
 * Builds a TrashEntry backed by REAL tmp-dir fixtures (mirrors deleteProject.test.ts's
 * isolation pattern) — restore() performs real fs.renameSync calls, so fake/non-existent
 * paths would throw ENOENT. `umbrellaMoveSkipped: true` by default so tests only need a
 * studio-dir fixture, not a parallel project-folder fixture.
 */
function makeEntry(overrides: Partial<TrashEntry> = {}): TrashEntry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-toolkit-toast-test-'));
  const entryDir = path.join(root, 'entry');
  const trashStudioPath = path.join(entryDir, 'studio');
  fs.mkdirSync(trashStudioPath, { recursive: true });
  const originalStudioDir = path.join(root, 'restored-studio');

  return {
    id: crypto.randomUUID(),
    projectName: 'Test Project',
    entryDir,
    trashStudioPath,
    trashProjectPath: path.join(entryDir, 'project'),
    originalStudioDir,
    originalFolderPath: path.join(root, 'restored-project'),
    umbrellaMoveSkipped: true,
    restoreErrors: [],
    parkedAtISO: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  useDeleteUndoStore.setState({ pending: [] });
});

describe('DeleteUndoToast', () => {
  it('renders nothing when pending is empty', () => {
    const { container } = render(<DeleteUndoToast />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the 🗑 delete toast with an Undo button when a TrashEntry is pushed', async () => {
    render(<DeleteUndoToast />);
    useDeleteUndoStore.getState().push(makeEntry());

    await screen.findByTestId('delete-undo-toast');
    expect(screen.getByText(/Test Project/)).not.toBeNull();
    expect(screen.getByText(/deleted/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Undo delete' })).not.toBeNull();
  });

  it('shows the ⚠ variant with the restoreErrors message when non-empty', async () => {
    render(<DeleteUndoToast />);
    useDeleteUndoStore.getState().push(makeEntry({ restoreErrors: ['cfg restore failed'] }));

    await screen.findByTestId('delete-undo-toast');
    expect(screen.getByText('cfg restore failed')).not.toBeNull();
  });

  it('Undo restores the entry and shows a post-restore toast with no re-deploy language', async () => {
    render(<DeleteUndoToast />);
    useDeleteUndoStore.getState().push(makeEntry());
    await screen.findByTestId('delete-undo-toast');

    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }));

    await waitFor(() => expect(screen.getByText(/restored/)).not.toBeNull());
    expect(useDeleteUndoStore.getState().pending.length).toBe(0);
    // Locked undo contract: never mention a re-deploy.
    expect(screen.queryByText(/re-applied|re-deploy/i)).toBeNull();
    // Best-effort version count read via the mocked readManifest (2 changesets).
    expect(screen.getByText(/all 2 versions back, byte-for-byte/)).not.toBeNull();
  });

  it('shows the post-restore toast when the entry is removed by ANOTHER surface (not this toast\'s Undo)', async () => {
    render(<DeleteUndoToast />);
    useDeleteUndoStore.getState().push(makeEntry({ id: 'entry-2', projectName: 'Elsewhere Project' }));
    await screen.findByTestId('delete-undo-toast');

    // Simulate ProjectListDialog's dimmed-row Restore button calling restore() directly.
    useDeleteUndoStore.getState().restore('entry-2');

    await waitFor(() => expect(screen.getByText(/Elsewhere Project/)).not.toBeNull());
    expect(screen.getByText(/restored/)).not.toBeNull();
  });

  it('keeps the original toast visible with an inline error when Undo hits an occupied destination', async () => {
    // Force restore() to throw (occupied-destination guard) without touching real fs.
    const restoreSpy = vi.spyOn(useDeleteUndoStore.getState(), 'restore').mockImplementation(() => {
      throw new Error('already exists; move or remove it, then retry Undo');
    });

    render(<DeleteUndoToast />);
    useDeleteUndoStore.getState().push(makeEntry());
    await screen.findByTestId('delete-undo-toast');

    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }));

    await waitFor(() => expect(screen.getByText(/already exists/)).not.toBeNull());
    // Still the delete toast (Undo button still present), not the restored toast.
    expect(screen.getByRole('button', { name: 'Undo delete' })).not.toBeNull();
    expect(screen.queryByText(/restored/)).toBeNull();

    restoreSpy.mockRestore();
  });

  it('auto-dismisses 8s after appearing', async () => {
    vi.useFakeTimers();
    try {
      render(<DeleteUndoToast />);
      act(() => { useDeleteUndoStore.getState().push(makeEntry()); });

      expect(screen.getByTestId('delete-undo-toast')).not.toBeNull();

      act(() => { vi.advanceTimersByTime(7999); });
      expect(screen.getByTestId('delete-undo-toast')).not.toBeNull();

      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.queryByTestId('delete-undo-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
