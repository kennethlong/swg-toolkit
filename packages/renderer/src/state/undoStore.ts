/**
 * packages/renderer/src/state/undoStore.ts
 * Session-scoped undo stack for live-reconcile operations (D-06/VER-04).
 *
 * Wave-0 stub: all mutators (push, undo, clear) are no-ops.
 * Wave-1 plan 04 implements the real push/pop/clear logic.
 *
 * Design:
 *   - Session-scoped ONLY — NOT persisted. No persist middleware; no localStorage write.
 *   - Each entry captures enough to reverse a syncLiveToVersion call:
 *       priorLiveVersionId: the version that was live BEFORE the reconcile.
 *       priorDeployRecord:  the deploy record that was active (for the undo apply path).
 *       takenAt:            ISO timestamp of when the snapshot was taken (audit trail).
 *   - LIFO stack: undo() returns and pops the most recently pushed snapshot.
 *   - canUndo: derived from stack.length > 0; updated by push/undo/clear.
 *
 * Source: 04.3-02-PLAN.md Task 2; 04.3-RESEARCH.md D-06/VER-04 session undo stack.
 */

import { create } from 'zustand';
import type { CfgDeployRecord, LooseDeployRecord } from '@swg/contracts';

// ---------------------------------------------------------------------------
// ReconcileSnapshot
// ---------------------------------------------------------------------------

/**
 * A snapshot of the pre-reconcile deployment state.
 * Pushed onto the undo stack BEFORE syncLiveToVersion mutates the live pointer.
 * Enough to reverse the reconcile: restore priorLiveVersionId and re-apply the
 * prior deploy record via the appropriate undo path.
 */
export interface ReconcileSnapshot {
  /** Version that was live immediately before the reconcile. */
  priorLiveVersionId: string | null;
  /**
   * Deploy record that was active before the reconcile.
   * Absent when priorLiveVersionId was null (nothing was deployed yet)
   * or when the prior version had no recorded deploy (Baseline).
   */
  priorDeployRecord?: CfgDeployRecord | LooseDeployRecord;
  /** ISO 8601 timestamp when this snapshot was taken (audit trail). */
  takenAt: string;
}

// ---------------------------------------------------------------------------
// UndoStore interface
// ---------------------------------------------------------------------------

export interface UndoStore {
  /** LIFO stack of pre-reconcile snapshots. Empty at session start. */
  stack: ReconcileSnapshot[];
  /**
   * True when the stack has at least one entry.
   * Drives the Undo button's enabled state.
   */
  canUndo: boolean;
  /**
   * Push a pre-reconcile snapshot onto the top of the stack.
   * STUB: no-op until Wave-1 plan 04.
   */
  push: (snapshot: ReconcileSnapshot) => void;
  /**
   * Pop and return the top snapshot (LIFO) for undo.
   * Returns undefined when the stack is empty.
   * STUB: always returns undefined.
   */
  undo: () => ReconcileSnapshot | undefined;
  /**
   * Clear the entire undo stack (e.g. on workspace close or new project open).
   * STUB: no-op until Wave-1 plan 04.
   */
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Store implementation (Wave-0 stub — no-ops)
// ---------------------------------------------------------------------------

export const useUndoStore = create<UndoStore>(() => ({
  stack: [],
  canUndo: false,

  // Stub: no-op — push does NOT update stack or canUndo
  push: (_snapshot: ReconcileSnapshot) => {},

  // Stub: always returns undefined — stack is never popped
  undo: () => undefined,

  // Stub: no-op — stack is not cleared
  clear: () => {},
}));
