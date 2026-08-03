/**
 * packages/renderer/src/panels/world/RemoveUndoToast.test.tsx
 * Component tests for RemoveUndoToast — 05.1-13 Task 2.
 *
 * Mirrors DeleteUndoToast.test.tsx's shape (push -> shows toast; Undo -> restored; error ->
 * sticky), plus this component's own deviations: purely presentational (onUndo prop only, never
 * calls restore()/a write helper itself), the sticky-error guard-and-swap (ROUND 7/Z1, ROUND 8,
 * ROUND 9), and the mount-time reconstruction (ROUND 10/AA1-AA3, BB3, BB22).
 */

import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import RemoveUndoToast from './RemoveUndoToast';
import { useRemoveUndoStore, type RemovedRowEntry } from '../../state/removeUndoStore';

function makeEntry(overrides: Partial<RemovedRowEntry> = {}): RemovedRowEntry {
  return {
    id: 'bldg1:cell1:0',
    buildingId: 'bldg1',
    cellName: 'cell1',
    rowIndex: 0,
    removedNode: {
      objectTemplateName: 'object/tangible/furniture/shared_frn_table.iff',
      cellName: 'cell1',
      transform: [1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7],
    },
    ...overrides,
  };
}

beforeEach(() => {
  useRemoveUndoStore.setState({ pending: [], undoErrors: new Map() });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RemoveUndoToast — basic lifecycle', () => {
  it('renders nothing when pending is empty', () => {
    const { container } = render(<RemoveUndoToast onUndo={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a "removed" toast with an Undo button when an entry is pushed', async () => {
    render(<RemoveUndoToast onUndo={vi.fn()} />);
    act(() => { useRemoveUndoStore.getState().push(makeEntry()); });

    await screen.findByTestId('remove-undo-toast');
    expect(screen.getByText(/removed/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Undo remove' })).not.toBeNull();
  });

  it('clicking Undo calls the onUndo prop exactly once with the correct entry, and does NOT call restore() itself', async () => {
    const onUndo = vi.fn();
    const restoreSpy = vi.spyOn(useRemoveUndoStore.getState(), 'restore');
    render(<RemoveUndoToast onUndo={onUndo} />);
    const entry = makeEntry();
    act(() => { useRemoveUndoStore.getState().push(entry); });
    await screen.findByTestId('remove-undo-toast');

    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith(entry);
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('shows a "restored" toast (no re-deploy language, no Undo button) when the entry leaves pending — e.g. WorldPanel\'s handleUndo calling restore()', async () => {
    render(<RemoveUndoToast onUndo={vi.fn()} />);
    const entry = makeEntry();
    act(() => { useRemoveUndoStore.getState().push(entry); });
    await screen.findByTestId('remove-undo-toast');

    act(() => { useRemoveUndoStore.getState().restore(entry.id); });

    await screen.findByText(/restored/);
    expect(screen.queryByRole('button', { name: 'Undo remove' })).toBeNull();
  });

  it('auto-dismisses 8s after a plain "removed" toast appears', () => {
    vi.useFakeTimers();
    render(<RemoveUndoToast onUndo={vi.fn()} />);
    act(() => { useRemoveUndoStore.getState().push(makeEntry()); });

    expect(screen.getByTestId('remove-undo-toast')).not.toBeNull();

    act(() => { vi.advanceTimersByTime(7999); });
    expect(screen.getByTestId('remove-undo-toast')).not.toBeNull();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId('remove-undo-toast')).toBeNull();
  });
});

describe('RemoveUndoToast — sticky-error guard (ROUND 6/X4, ROUND 7/Z1, ROUND 8, ROUND 9)', () => {
  it('an undoErrors entry for the CURRENTLY-DISPLAYED entry swaps the toast to the error text WITHOUT arming a dismiss timer', () => {
    vi.useFakeTimers();
    render(<RemoveUndoToast onUndo={vi.fn()} />);
    const entry = makeEntry();
    act(() => { useRemoveUndoStore.getState().push(entry); });
    expect(screen.getByTestId('remove-undo-toast')).not.toBeNull();

    act(() => { useRemoveUndoStore.getState().setUndoError(entry.id, 'some words-only reason'); });
    expect(screen.getByText('some words-only reason')).not.toBeNull();

    // ROUND 9: the sticky display's own timer is NEVER armed — advancing well past TOAST_MS
    // leaves the toast, pending, and undoErrors all unchanged.
    act(() => { vi.advanceTimersByTime(8000 + 1); });
    expect(screen.getByTestId('remove-undo-toast')).not.toBeNull();
    expect(screen.getByText('some words-only reason')).not.toBeNull();
    expect(useRemoveUndoStore.getState().pending).toHaveLength(1);
    expect(useRemoveUndoStore.getState().undoErrors.get(entry.id)).toBe('some words-only reason');
  });

  it('an undoErrors entry for a DIFFERENT id does NOT change the currently-displayed toast content', () => {
    render(<RemoveUndoToast onUndo={vi.fn()} />);
    const entry = makeEntry();
    act(() => { useRemoveUndoStore.getState().push(entry); });
    expect(screen.getByTestId('remove-undo-toast')).not.toBeNull();

    act(() => { useRemoveUndoStore.getState().setUndoError('some-other-id', 'unrelated reason'); });

    expect(screen.queryByText('unrelated reason')).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo remove' })).not.toBeNull();
  });

  it('a SECOND, unrelated removal arriving while the sticky error is displayed does NOT switch the toast — dismissing it THEN advances to the queued removal', () => {
    render(<RemoveUndoToast onUndo={vi.fn()} />);
    const a = makeEntry({ id: 'a' });
    const c = makeEntry({ id: 'c', removedNode: { ...makeEntry().removedNode, objectTemplateName: 'object/tangible/furniture/shared_frn_c.iff' } });

    act(() => { useRemoveUndoStore.getState().push(a); });
    expect(screen.getByTestId('remove-undo-toast')).not.toBeNull();
    act(() => { useRemoveUndoStore.getState().setUndoError(a.id, 'a failed'); });
    expect(screen.getByText('a failed')).not.toBeNull();

    // A second removal (c) arrives DURING a's sticky freeze.
    act(() => { useRemoveUndoStore.getState().push(c); });
    expect(screen.getByText('a failed')).not.toBeNull(); // still a's sticky error, not c's toast

    // Dismiss a's toast — clears ONLY a's undoErrors slot, then advances to c.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(useRemoveUndoStore.getState().undoErrors.has(a.id)).toBe(false);
    expect(screen.getByText(/shared_frn_c\.iff/)).not.toBeNull();
    expect(useRemoveUndoStore.getState().pending.map((e) => e.id)).toContain('a'); // a's own removal stays durable — dismiss only hides the toast
  });

  it('resolving the sticky entry via a SUCCESSFUL RETRY (not dismiss) also advances to the queued removal, never a bare "restored"', () => {
    render(<RemoveUndoToast onUndo={vi.fn()} />);
    const a = makeEntry({ id: 'a' });
    const c = makeEntry({ id: 'c', removedNode: { ...makeEntry().removedNode, objectTemplateName: 'object/tangible/furniture/shared_frn_c.iff' } });
    act(() => { useRemoveUndoStore.getState().push(a); });
    act(() => { useRemoveUndoStore.getState().setUndoError(a.id, 'a failed'); });
    act(() => { useRemoveUndoStore.getState().push(c); });
    expect(screen.getByText('a failed')).not.toBeNull();

    // Mirrors WorldPanel's real handleUndo success ordering: restore() THEN clearUndoError().
    act(() => {
      useRemoveUndoStore.getState().restore(a.id);
      useRemoveUndoStore.getState().clearUndoError(a.id);
    });

    expect(screen.getByText(/shared_frn_c\.iff/)).not.toBeNull();
    expect(screen.queryByText(/restored/)).toBeNull();
  });
});

describe('RemoveUndoToast — mount-time reconstruction (ROUND 10/AA2/AA3/BB3/BB22)', () => {
  it('a plain remount (no sticky entry) never re-shows a stale toast', () => {
    const { unmount } = render(<RemoveUndoToast onUndo={vi.fn()} />);
    act(() => { useRemoveUndoStore.getState().push(makeEntry()); });
    expect(screen.getByTestId('remove-undo-toast')).not.toBeNull();

    unmount();
    render(<RemoveUndoToast onUndo={vi.fn()} />);

    expect(screen.queryByTestId('remove-undo-toast')).toBeNull();
  });

  it('a remount DURING a sticky freeze restores the sticky display and never arms a dismiss timer', () => {
    vi.useFakeTimers();
    const entry = makeEntry();
    useRemoveUndoStore.setState({
      pending: [entry],
      undoErrors: new Map([[entry.id, 'still failing']]),
    });

    render(<RemoveUndoToast onUndo={vi.fn()} />);

    expect(screen.getByTestId('remove-undo-toast')).not.toBeNull();
    expect(screen.getByText('still failing')).not.toBeNull();

    act(() => { vi.advanceTimersByTime(8000 + 1); });
    expect(screen.getByTestId('remove-undo-toast')).not.toBeNull();
    expect(screen.getByText('still failing')).not.toBeNull();
  });

  it('BB3: a remount during a freeze reconstructs the frozen baseline — dismissing the sticky entry after remount still advances to the unshown queued entry', () => {
    const a = makeEntry({ id: 'a' });
    const c = makeEntry({ id: 'c', removedNode: { ...makeEntry().removedNode, objectTemplateName: 'object/tangible/furniture/shared_frn_c.iff' } });
    useRemoveUndoStore.setState({
      pending: [a, c],
      undoErrors: new Map([[a.id, 'a failed']]),
    });

    render(<RemoveUndoToast onUndo={vi.fn()} />);
    expect(screen.getByText('a failed')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.getByText(/shared_frn_c\.iff/)).not.toBeNull();
  });

  it('BB22: when the (broken-invariant) state has undoErrors naming BOTH pending entries, the mount pick is the LAST one and a console.warn fires', () => {
    const a = makeEntry({ id: 'a' });
    const b = makeEntry({ id: 'b', removedNode: { ...makeEntry().removedNode, objectTemplateName: 'object/tangible/furniture/shared_frn_b.iff' } });
    useRemoveUndoStore.setState({
      pending: [a, b],
      undoErrors: new Map([[a.id, 'a failed'], [b.id, 'b failed']]),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<RemoveUndoToast onUndo={vi.fn()} />);

    expect(screen.getByText('b failed')).not.toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
