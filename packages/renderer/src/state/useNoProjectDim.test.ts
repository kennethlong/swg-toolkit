/**
 * packages/renderer/src/state/useNoProjectDim.test.ts
 * Tests for the P5 group-based dim hook (04.3-08 Task 2).
 *
 * Tests:
 *   1 — useNoProjectDimStyle returns dim style (opacity:0.32) when no project open (idle)
 *   2 — useNoProjectDimStyle returns no dim when project is ready
 *   3 — DIM_GROUP_VIEWPORT constant is defined and NOT the literal string "Data"
 *   4 — DIM_GROUP_INSPECTOR constant is defined and NOT the literal string "Data"
 *   5 — DIM_GROUP_BOTTOM_PANE constant is defined and NOT the literal string "Data"
 *   6 — useNoProjectDimForGroup('bottom-pane-group') returns dimmed:true when no project
 *   7 — useNoProjectDimForGroup('viewport-group') returns dimmed:true when no project
 *   8 — useNoProjectDimForGroup('inspector-group') returns dimmed:false when project ready
 *   9 — DIM_GROUP_BOTTOM_PANE survives plan-09 Data→trio split (not equal to "data" or "Data")
 *
 * Source: 04.3-08-PLAN.md Task 2 P5; sketch 007-B dimmed panels.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useNoProjectDimStyle,
  useNoProjectDimForGroup,
  DIM_GROUP_VIEWPORT,
  DIM_GROUP_INSPECTOR,
  DIM_GROUP_BOTTOM_PANE,
} from './useNoProjectDim';
import { useWorkspaceStore } from './workspaceStore';
import type { WorkspaceInfo } from '@swg/contracts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readyInfo(): WorkspaceInfo {
  return {
    folderPath:    '/fake/project',
    studioDir:     '/fake/project/.studio',
    workspaceName: 'FakeProject',
    clientPath:    '/fake/client',
    kind:          'client',
  };
}

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  useWorkspaceStore.setState({ status: { kind: 'idle' } });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useNoProjectDimStyle', () => {

  it('(1) returns opacity:0.32 + pointerEvents:none when no project (idle)', () => {
    const { result } = renderHook(() => useNoProjectDimStyle());
    expect(result.current.opacity).toBe(0.32);
    expect(result.current.pointerEvents).toBe('none');
  });

  it('(2) returns no opacity dim when project is ready', () => {
    useWorkspaceStore.setState({ status: { kind: 'ready', info: readyInfo() } });
    const { result } = renderHook(() => useNoProjectDimStyle());
    expect(result.current.opacity).toBeUndefined();
    expect(result.current.pointerEvents).toBeUndefined();
  });

});

describe('DIM_GROUP_* constants — stable dock-group IDs (NOT panel label strings)', () => {

  it('(3) DIM_GROUP_VIEWPORT is defined and not the literal "Data"', () => {
    expect(DIM_GROUP_VIEWPORT).toBeDefined();
    expect(DIM_GROUP_VIEWPORT).not.toBe('Data');
    expect(DIM_GROUP_VIEWPORT).not.toBe('data');
  });

  it('(4) DIM_GROUP_INSPECTOR is defined and not the literal "Data"', () => {
    expect(DIM_GROUP_INSPECTOR).toBeDefined();
    expect(DIM_GROUP_INSPECTOR).not.toBe('Data');
    expect(DIM_GROUP_INSPECTOR).not.toBe('data');
  });

  it('(5) DIM_GROUP_BOTTOM_PANE is defined and not the literal "Data" (survives plan-09 split)', () => {
    expect(DIM_GROUP_BOTTOM_PANE).toBeDefined();
    // Key assertion: the bottom-pane group id is NOT tied to the panel label "Data"
    // which plan 09 splits into Datatable / Console / Log. If this were "Data", the
    // dim logic would break after the split. Using a stable dock-group id is correct.
    expect(DIM_GROUP_BOTTOM_PANE).not.toBe('Data');
    expect(DIM_GROUP_BOTTOM_PANE).not.toBe('data');
    expect(DIM_GROUP_BOTTOM_PANE).not.toBe('Datatable');
    expect(DIM_GROUP_BOTTOM_PANE).not.toBe('Console');
    expect(DIM_GROUP_BOTTOM_PANE).not.toBe('Log');
  });

});

describe('useNoProjectDimForGroup', () => {

  it('(6) DIM_GROUP_BOTTOM_PANE → dimmed:true when no project (idle)', () => {
    const { result } = renderHook(() => useNoProjectDimForGroup(DIM_GROUP_BOTTOM_PANE));
    expect(result.current.dimmed).toBe(true);
    expect(result.current.style.opacity).toBe(0.32);
  });

  it('(7) DIM_GROUP_VIEWPORT → dimmed:true when no project (idle)', () => {
    const { result } = renderHook(() => useNoProjectDimForGroup(DIM_GROUP_VIEWPORT));
    expect(result.current.dimmed).toBe(true);
  });

  it('(8) DIM_GROUP_INSPECTOR → dimmed:false when project is ready', () => {
    useWorkspaceStore.setState({ status: { kind: 'ready', info: readyInfo() } });
    const { result } = renderHook(() => useNoProjectDimForGroup(DIM_GROUP_INSPECTOR));
    expect(result.current.dimmed).toBe(false);
    expect(result.current.style.opacity).toBeUndefined();
  });

  it('(9) DIM_GROUP_BOTTOM_PANE → stable key that survives plan-09 Data→trio split', () => {
    // The group ID must be stable regardless of what panels live inside it.
    // After plan 09 adds Datatable/Console/Log to the same dock group,
    // calling useNoProjectDimForGroup(DIM_GROUP_BOTTOM_PANE) still works.
    expect(DIM_GROUP_BOTTOM_PANE).toBe('bottom-pane-group');
    const { result } = renderHook(() => useNoProjectDimForGroup(DIM_GROUP_BOTTOM_PANE));
    expect(result.current.dimmed).toBe(true); // still no project = still dim
  });

});
