/**
 * packages/renderer/src/state/removeUndoStore.test.ts
 * 05.1-13 Task 1: push/restore round-trip, per-entry-keyed undoErrors (ROUND 6/X4, ROUND 7/Z1),
 * and the reset()/PROJECT-SWITCH RESET ORDERING CONTRACT (ROUND 10/AA5, R9 review BB2).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { useRemoveUndoStore, type RemovedRowEntry } from './removeUndoStore';
import { useWorkspaceStore } from './workspaceStore';

function makeEntry(overrides: Partial<RemovedRowEntry> = {}): RemovedRowEntry {
  return {
    id: '123:cell1:0',
    buildingId: '123',
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
  // TEST-ISOLATION RECIPE (worldEditorStore.ts's canonical CC9 note, applied identically here):
  // seed studioDir FIRST, then this store's own state — a non-null->different studioDir seed
  // fires a REAL synchronous reset, harmless only under that ordering.
  useWorkspaceStore.setState({ studioDir: '/fake/studio' });
  useRemoveUndoStore.setState({ pending: [], undoErrors: new Map() });
});

describe('removeUndoStore — push/restore round trip', () => {
  it('push appends an entry; restore pops it and returns the exact removed node', () => {
    const entry = makeEntry();
    useRemoveUndoStore.getState().push(entry);
    expect(useRemoveUndoStore.getState().pending).toEqual([entry]);

    const popped = useRemoveUndoStore.getState().restore(entry.id);
    expect(popped).toEqual(entry);
    expect(popped?.removedNode).toEqual(entry.removedNode);
    expect(useRemoveUndoStore.getState().pending).toEqual([]);
  });

  it('restore on an unknown id returns undefined and leaves pending untouched', () => {
    const entry = makeEntry();
    useRemoveUndoStore.getState().push(entry);
    const popped = useRemoveUndoStore.getState().restore('does-not-exist');
    expect(popped).toBeUndefined();
    expect(useRemoveUndoStore.getState().pending).toEqual([entry]);
  });

  it('push preserves insertion order across multiple entries', () => {
    const a = makeEntry({ id: 'a' });
    const b = makeEntry({ id: 'b' });
    useRemoveUndoStore.getState().push(a);
    useRemoveUndoStore.getState().push(b);
    expect(useRemoveUndoStore.getState().pending.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('removeUndoStore — undoErrors (ROUND 6/X4, ROUND 7/Z1 — per-entry keyed)', () => {
  it('setUndoError sets ONLY the named id, clearUndoError removes ONLY the named id — the cross-entry-erasure regression test', () => {
    useRemoveUndoStore.getState().setUndoError('a', 'reason A');
    useRemoveUndoStore.getState().setUndoError('b', 'reason B');
    expect(useRemoveUndoStore.getState().undoErrors.get('a')).toBe('reason A');
    expect(useRemoveUndoStore.getState().undoErrors.get('b')).toBe('reason B');

    useRemoveUndoStore.getState().clearUndoError('a');
    expect(useRemoveUndoStore.getState().undoErrors.has('a')).toBe(false);
    // 'b' is UNCHANGED — clearing 'a' never erases a different entry's failure signal.
    expect(useRemoveUndoStore.getState().undoErrors.get('b')).toBe('reason B');
  });

  it('a repeat setUndoError on the SAME id overwrites its message without a pre-clear (no-clear-at-top ordering)', () => {
    useRemoveUndoStore.getState().setUndoError('a', 'first failure');
    useRemoveUndoStore.getState().setUndoError('a', 'second failure');
    expect(useRemoveUndoStore.getState().undoErrors.get('a')).toBe('second failure');
    expect(useRemoveUndoStore.getState().undoErrors.size).toBe(1);
  });

  it('setUndoError/clearUndoError construct a NEW Map instance each call (never mutate in place)', () => {
    const before = useRemoveUndoStore.getState().undoErrors;
    useRemoveUndoStore.getState().setUndoError('a', 'x');
    const afterSet = useRemoveUndoStore.getState().undoErrors;
    expect(afterSet).not.toBe(before);

    useRemoveUndoStore.getState().clearUndoError('a');
    const afterClear = useRemoveUndoStore.getState().undoErrors;
    expect(afterClear).not.toBe(afterSet);
  });
});

describe('removeUndoStore — reset() (ROUND 10/AA5; R9 review BB2)', () => {
  it('reset() clears pending to [] and undoErrors to a new empty Map in one call', () => {
    useRemoveUndoStore.getState().push(makeEntry());
    useRemoveUndoStore.getState().setUndoError('a', 'x');
    expect(useRemoveUndoStore.getState().pending.length).toBe(1);
    expect(useRemoveUndoStore.getState().undoErrors.size).toBe(1);

    useRemoveUndoStore.getState().reset();

    expect(useRemoveUndoStore.getState().pending).toEqual([]);
    expect(useRemoveUndoStore.getState().undoErrors.size).toBe(0);
  });

  it('a non-null->different studioDir transition resets this store SYNCHRONOUSLY (no render/effect flush needed)', () => {
    useWorkspaceStore.setState({ studioDir: '/project-a' });
    useRemoveUndoStore.getState().push(makeEntry());
    useRemoveUndoStore.getState().setUndoError('a', 'x');
    expect(useRemoveUndoStore.getState().pending.length).toBe(1);

    useWorkspaceStore.setState({ studioDir: '/project-b' });

    // Synchronous — no await/act needed; the subscription fires inside setState() itself.
    expect(useRemoveUndoStore.getState().pending).toEqual([]);
    expect(useRemoveUndoStore.getState().undoErrors.size).toBe(0);
  });

  it('the INITIAL null->project-open transition does NOT reset (nothing to reset from — no prior project)', () => {
    useWorkspaceStore.setState({ studioDir: null });
    useRemoveUndoStore.getState().push(makeEntry());
    expect(useRemoveUndoStore.getState().pending.length).toBe(1);

    useWorkspaceStore.setState({ studioDir: '/project-a' });

    // The entry survives — a null->non-null transition is an OPEN, not a SWITCH.
    expect(useRemoveUndoStore.getState().pending.length).toBe(1);
  });
});
