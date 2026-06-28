/**
 * packages/renderer/src/state/stagingStore.test.ts
 * Unit tests for stagingStore.addEntry path-safety M1 (DEPLOY-07).
 *
 * Tests:
 *   1 — addEntry rejects Windows drive-letter virtualPath (C:\...)
 *   2 — addEntry rejects path-traversal virtualPath (..)
 *   3 — addEntry accepts a safe relative virtualPath
 *
 * RED phase (Task 1): tests 1 and 2 fail because addEntry does NOT yet call
 *   isVirtualPathSafe — unsafe paths are stored without validation.
 * GREEN phase (Task 2): all tests pass once addEntry calls isVirtualPathSafe.
 *
 * NOTE: pathSafety is NOT mocked here — we test against the real isVirtualPathSafe
 * so the guard covers the actual validation logic, not a mock.
 *
 * Source: 04.1-08-PLAN.md Task 1; T-04.1-19 (Tampering — derived virtual path).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStagingStore } from './stagingStore';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useStagingStore.setState({
    entries:     [],
    buildStatus: { kind: 'idle' },
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('stagingStore.addEntry — path-safety M1 (DEPLOY-07)', () => {

  it('Test 1: addEntry rejects Windows drive-letter virtualPath (C:\\...)', () => {
    // RED: addEntry currently stores the entry without validation → entries.length = 1
    // GREEN: addEntry calls isVirtualPathSafe → rejects C:\ → entries.length = 0
    useStagingStore.getState().addEntry({ virtualPath: 'C:\\system32\\ntdll.dll', action: 'add' });
    expect(useStagingStore.getState().entries).toHaveLength(0);
  });

  it('Test 2: addEntry rejects path-traversal virtualPath (..)', () => {
    // RED: addEntry currently stores → entries.length = 1
    // GREEN: isVirtualPathSafe rejects '..' → entries.length = 0
    useStagingStore.getState().addEntry({ virtualPath: '../escape/file.iff', action: 'add' });
    expect(useStagingStore.getState().entries).toHaveLength(0);
  });

  it('Test 3: addEntry accepts a safe relative virtualPath (should always pass)', () => {
    // This test passes in both RED and GREEN — safe path is valid in all states.
    useStagingStore.getState().addEntry({ virtualPath: 'appearance/armor.mgn', action: 'add' });
    expect(useStagingStore.getState().entries).toHaveLength(1);
    expect(useStagingStore.getState().entries[0]?.virtualPath).toBe('appearance/armor.mgn');
  });

});
