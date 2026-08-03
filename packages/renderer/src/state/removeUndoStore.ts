/**
 * packages/renderer/src/state/removeUndoStore.ts
 * Session-scoped Zustand store tracking pending decoration-row removals for Undo (05.1-13 Task 1).
 *
 * A "removed row entry" is pushed by WorldPanel.tsx's per-row Remove action, right after
 * `removeDecorationRow` (decorationPersistOrchestrator.ts) has ALREADY committed the `.ilf`
 * removal to disk (D-02: the data removal is the durable contract; this store only tracks the
 * 8-second undo-toast WINDOW around it — see RemoveUndoToast.tsx).
 *
 * Sibling to `deleteUndoStore.ts` (SAME `create<T>()`/pending-array shape, PATTERNS.md) but
 * scoped to decoration rows, not projects — this file does NOT import or extend
 * `deleteUndoStore.ts`.
 *
 * `undoErrors` (ROUND 6/X4, ROUND 7/Z1): a per-entry-keyed `Map<id, message>` — `setUndoError`/
 * `clearUndoError` touch ONLY the named id's slot, so one entry's failed Undo can never erase a
 * DIFFERENT entry's still-unresolved failure signal. `restore(id)` pops the entry and returns it
 * — callers (WorldPanel.tsx's `handleUndo`) invoke it only AFTER their own add-back write has
 * already succeeded (ROUND 7/Z1), never before, so a thrown add-back never leaves this store
 * showing a false "restored" transition.
 *
 * `reset()` (ROUND 10/AA5; R9 review BB2) restores both fields to their module-initial state.
 * It exists SOLELY for a project switch: this store is a module-scope singleton that outlives
 * any single project's session, so switching projects without clearing it would leak Project A's
 * stuck removal(s)/sticky-error toast into Project B's session. Per Plan 04's PROJECT-SWITCH
 * RESET ORDERING CONTRACT (worldEditorStore.ts — canonical statement, cited not paraphrased),
 * the CALLER is this store's OWN module-scope subscription below, never a React effect —
 * zustand v5's vanilla `subscribe()` runs synchronously inside the very `set()` call that
 * changes `studioDir`, strictly before React re-renders (reset-before-render).
 *
 * Source: 05.1-13-PLAN.md Task 1; deleteUndoStore.ts (structural precedent);
 * worldEditorStore.ts (PROJECT-SWITCH RESET ORDERING CONTRACT, canonical statement).
 */

/// <reference types="vite/client" />

import { create } from 'zustand';

import type { IlfNode } from '../services/ilf';
import { useWorkspaceStore } from './workspaceStore';

// ─── RemovedRowEntry ────────────────────────────────────────────────────────────

/** One removed decoration row, tracked for the lifetime of its undo-toast window. */
export interface RemovedRowEntry {
  /** worldEditorRowId(buildingId, cellName, rowIndex) at removal time. */
  id: string;
  buildingId: string;
  cellName: string;
  rowIndex: number;
  /** The exact `.ilf` node that was removed — so Undo can re-add it byte-identical. */
  removedNode: IlfNode;
}

// ─── Store interface ───────────────────────────────────────────────────────────

export interface RemoveUndoStore {
  /** Removed rows pending Undo for the current session. */
  pending: RemovedRowEntry[];
  /** Per-entry-keyed failed-Undo reason (ROUND 6/X4, ROUND 7/Z1 — never a global scalar). */
  undoErrors: Map<string, string>;

  /** Record a newly-removed row. */
  push: (entry: RemovedRowEntry) => void;

  /**
   * Pop `id` from `pending` and return the popped entry (or `undefined` if not found). Callers
   * invoke this ONLY after their own add-back write has already succeeded (ROUND 7/Z1) — this
   * action itself performs no write, it only mutates the store.
   */
  restore: (id: string) => RemovedRowEntry | undefined;

  /** Set (or overwrite) ONLY `id`'s slot in `undoErrors` — every other id's entry is untouched. */
  setUndoError: (id: string, message: string) => void;
  /** Remove ONLY `id`'s slot from `undoErrors` — every other id's entry is untouched. */
  clearUndoError: (id: string) => void;

  /** (ROUND 10/AA5; R9 review BB2) Restores `pending`/`undoErrors` to module-initial state.
   *  Invoked SOLELY by this store's own module-scope workspaceStore subscription below — never
   *  call this from a component. */
  reset: () => void;
}

function initialState(): Pick<RemoveUndoStore, 'pending' | 'undoErrors'> {
  return { pending: [], undoErrors: new Map() };
}

// ─── Store implementation ──────────────────────────────────────────────────────

export const useRemoveUndoStore = create<RemoveUndoStore>((set, get) => ({
  ...initialState(),

  push: (entry: RemovedRowEntry) => set((state) => ({ pending: [...state.pending, entry] })),

  restore: (id: string) => {
    const entry = get().pending.find((e) => e.id === id);
    if (!entry) return undefined;
    set((state) => ({ pending: state.pending.filter((e) => e.id !== id) }));
    return entry;
  },

  setUndoError: (id: string, message: string) =>
    set((state) => {
      const next = new Map(state.undoErrors);
      next.set(id, message);
      return { undoErrors: next };
    }),

  clearUndoError: (id: string) =>
    set((state) => {
      const next = new Map(state.undoErrors);
      next.delete(id);
      return { undoErrors: next };
    }),

  reset: () => set(initialState()),
}));

// ─── PROJECT-SWITCH RESET ORDERING CONTRACT (canonical statement lives in worldEditorStore.ts —
//     this registration mirrors it identically, cited not re-derived) ─────────────────────────
const unsubscribeProjectSwitchReset = useWorkspaceStore.subscribe((state, prevState) => {
  if (prevState.studioDir !== null && state.studioDir !== prevState.studioDir) {
    useRemoveUndoStore.getState().reset();
  }
});
if (import.meta.hot) {
  import.meta.hot.dispose(() => unsubscribeProjectSwitchReset());
}
