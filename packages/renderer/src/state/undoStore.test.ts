/**
 * packages/renderer/src/state/undoStore.test.ts
 * Wave-0 RED gate for undoStore (Plan 04.3-02 Task 2).
 *
 * Tests FAIL in RED because all mutators (push/undo/clear) are no-ops.
 * Wave-1 plan 04 implements the real LIFO stack; tests go GREEN.
 *
 * Test inventory:
 *   (1) push then canUndo true      — RED: no-op push → canUndo still false
 *   (2) undo returns last-pushed (LIFO) and pops it  — RED: undo returns undefined
 *   (3) clear empties the stack     — RED: no-op clear → seeded stack remains
 *   (4) session-only (in-memory): no localStorage write after push (always GREEN)
 *
 * Source: 04.3-02-PLAN.md Task 2; 04.3-RESEARCH.md D-06 session undo stack.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useUndoStore } from './undoStore';
import type { ReconcileSnapshot } from './undoStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function snap(priorLiveVersionId: string, takenAt: string): ReconcileSnapshot {
  return { priorLiveVersionId, takenAt };
}

const s1 = snap('v1', '2024-01-01T00:00:00Z');
const s2 = snap('v2', '2024-01-02T00:00:00Z');

// ---------------------------------------------------------------------------
// Reset store state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  useUndoStore.setState({ stack: [], canUndo: false });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('undoStore — Wave-0 RED (stub: all mutators are no-ops)', () => {

  it('(1) push makes canUndo true (RED: no-op push → canUndo stays false)', () => {
    useUndoStore.getState().push(s1);
    // RED: push is a no-op → canUndo remains false → FAIL
    expect(useUndoStore.getState().canUndo).toBe(true);
  });

  it('(2) undo returns last-pushed snapshot LIFO and pops it (RED: undo returns undefined)', () => {
    useUndoStore.getState().push(s1);
    useUndoStore.getState().push(s2);

    const result = useUndoStore.getState().undo();
    // RED: push is no-op → stack empty → undo returns undefined → FAIL
    expect(result).toEqual(s2);
    // Also: stack should have s1 remaining after popping s2
    expect(useUndoStore.getState().stack).toHaveLength(1);
    expect(useUndoStore.getState().stack[0]).toEqual(s1);
  });

  it('(3) clear() empties the stack (RED: no-op clear → seeded stack remains)', () => {
    // Seed the stack directly (bypassing the no-op push)
    useUndoStore.setState({ stack: [s1, s2], canUndo: true });
    useUndoStore.getState().clear();
    // RED: clear is a no-op → stack still has 2 entries → FAIL
    expect(useUndoStore.getState().stack).toHaveLength(0);
    expect(useUndoStore.getState().canUndo).toBe(false);
  });

  it('(4) session-only: no localStorage write after push (always GREEN — no persist middleware)', () => {
    // The store MUST be plain in-memory (no zustand/middleware persist).
    // Verify by pushing a snapshot and checking localStorage is untouched.
    localStorage.clear();
    useUndoStore.getState().push(s1);
    // Zustand without persist middleware = zero localStorage entries.
    expect(localStorage.length).toBe(0);
  });

});
