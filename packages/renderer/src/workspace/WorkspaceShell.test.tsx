/**
 * packages/renderer/src/workspace/WorkspaceShell.test.tsx
 * Component tests for WorkspaceShell — version-guard (D-03 / DEPLOY-07) + auto-widen (M3).
 *
 * Tests:
 *   1 — saved layout with matching version key → fromJSON called, no rebuild
 *   2 — no saved layout → addPanel called (buildInitialLayout) + LAYOUT_VERSION_KEY written
 *   3 — stale/missing version key → fromJSON NOT called; addPanel called; version key updated
 *   4 — activating "deploy" panel fires setSize({ width: ~440 }) on its group (M3)
 *   5 — activating "inspector" panel fires setSize({ width: ~290 }) on its group (M3)
 *
 * RED phase (Task 1): tests 2–5 fail because the version guard and auto-widen handler
 * are not yet implemented in WorkspaceShell.tsx.
 * GREEN phase (Task 3): all 5 tests pass once WorkspaceShell.tsx is updated.
 *
 * Mock strategy: vi.hoisted captures the DockviewReact `onReady` prop;
 * each test builds a fresh mockApi and manually fires the captured callback.
 *
 * Source: 04.1-05-PLAN.md Task 1; 04.1-RESEARCH.md §Pattern 6; 04.1-UI-SPEC.md Surface 6.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── vi.hoisted: create a container that is accessible inside vi.mock factories ─

const dockviewCapture = vi.hoisted(() => ({
  onReady: null as ((event: { api: unknown }) => void) | null,
}));

// ─── Mock dockview — capture the onReady prop from DockviewReact ─────────────
// vi.mock is hoisted to the top of the file by Vitest. The factory has access to
// dockviewCapture because it was created with vi.hoisted (also hoisted before mocks).

vi.mock('dockview', () => ({
  DockviewReact: (props: { onReady?: (event: { api: unknown }) => void }) => {
    dockviewCapture.onReady = props.onReady ?? null;
    return null;
  },
}));

// ─── Imports (after mock declaration) ────────────────────────────────────────

import WorkspaceShell from './WorkspaceShell';
import { LAYOUT_VERSION, LAYOUT_VERSION_KEY, LAYOUT_STORAGE_KEY } from './workspace-config';

// ─── Helper: build a self-consistent mock DockviewApi ────────────────────────
//
// activePanelHandlers: list of callbacks registered via api.onDidActivePanelChange
// mockGroupApi.setSize: spy for the right-dock group resize assertions
// triggerPanelActivation: sets api.activePanel + fires all handlers (simulates user switch)

function buildMockApi() {
  const activePanelHandlers: Array<() => void> = [];
  const mockGroupApi = { setSize: vi.fn() };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockApi: any = {
    fromJSON:    vi.fn(),
    clear:       vi.fn(),
    toJSON:      vi.fn().mockReturnValue({ panels: [] }),
    addPanel:    vi.fn().mockReturnValue({}),

    onDidLayoutChange: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),

    onDidActivePanelChange: vi.fn((cb: () => void) => {
      activePanelHandlers.push(cb);
      return { dispose: vi.fn() };
    }),

    activePanel: null as { id: string; group: { api: typeof mockGroupApi } | null } | null,
  };

  function triggerPanelActivation(panelId: string, withGroup = true): void {
    mockApi.activePanel = {
      id: panelId,
      group: withGroup ? { api: mockGroupApi } : null,
    };
    activePanelHandlers.forEach((h) => h());
  }

  return { mockApi, mockGroupApi, triggerPanelActivation };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  dockviewCapture.onReady = null;
});

afterEach(() => {
  localStorage.clear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkspaceShell — layout version guard', () => {

  it('Test 1: saved layout with matching version key → fromJSON called, no rebuild', () => {
    const savedLayout = JSON.stringify({ panels: ['p1'] });
    localStorage.setItem(LAYOUT_STORAGE_KEY, savedLayout);
    // Write the version key with the CURRENT LAYOUT_VERSION value
    // (may be undefined/NaN in RED — that is OK, it just means this test passes in RED too)
    localStorage.setItem(LAYOUT_VERSION_KEY as string, String(LAYOUT_VERSION));

    render(<WorkspaceShell />);
    expect(dockviewCapture.onReady).not.toBeNull();

    const { mockApi } = buildMockApi();
    dockviewCapture.onReady!({ api: mockApi });

    expect(mockApi.fromJSON).toHaveBeenCalledTimes(1);
    expect(mockApi.fromJSON).toHaveBeenCalledWith(JSON.parse(savedLayout));
  });

  it('Test 2: no saved layout → addPanel called (buildInitialLayout) + LAYOUT_VERSION_KEY written', () => {
    // Nothing in localStorage

    render(<WorkspaceShell />);
    const { mockApi } = buildMockApi();
    dockviewCapture.onReady!({ api: mockApi });

    // buildInitialLayout must be triggered (addPanel for viewport/sidebar etc.)
    expect(mockApi.addPanel).toHaveBeenCalled();
    expect(mockApi.fromJSON).not.toHaveBeenCalled();

    // LAYOUT_VERSION_KEY must be written to localStorage
    // RED: current WorkspaceShell does NOT write LAYOUT_VERSION_KEY → getItem returns null
    const writtenVersion = localStorage.getItem(LAYOUT_VERSION_KEY as string);
    expect(writtenVersion).toBe(String(LAYOUT_VERSION));
  });

  it('Test 3: stale/missing version key → fromJSON NOT called; addPanel + version key updated', () => {
    const savedLayout = JSON.stringify({ panels: ['old-staging-panel'] });
    localStorage.setItem(LAYOUT_STORAGE_KEY, savedLayout);
    localStorage.setItem(LAYOUT_VERSION_KEY as string, '1'); // old version (< LAYOUT_VERSION=2)

    render(<WorkspaceShell />);
    const { mockApi } = buildMockApi();
    dockviewCapture.onReady!({ api: mockApi });

    // RED: current WorkspaceShell calls fromJSON regardless of version key
    expect(mockApi.fromJSON).not.toHaveBeenCalled();

    // Rebuild must happen (addPanel for viewport/sidebar/deploy/etc.)
    expect(mockApi.addPanel).toHaveBeenCalled();

    // Version key must be updated to current LAYOUT_VERSION
    const newVersion = localStorage.getItem(LAYOUT_VERSION_KEY as string);
    expect(newVersion).toBe(String(LAYOUT_VERSION));
  });

});

describe('WorkspaceShell — active-panel auto-widen (M3)', () => {

  it('Test 4: activating "deploy" panel calls setSize({ width: ~440 }) on its group', () => {
    render(<WorkspaceShell />);
    const { mockApi, mockGroupApi, triggerPanelActivation } = buildMockApi();
    dockviewCapture.onReady!({ api: mockApi });

    // RED: WorkspaceShell does not register onDidActivePanelChange → setSize never called
    triggerPanelActivation('deploy');

    expect(mockGroupApi.setSize).toHaveBeenCalled();
    const callArg = mockGroupApi.setSize.mock.calls[0]?.[0] as { width: number } | undefined;
    expect(callArg?.width).toBeGreaterThanOrEqual(400);
  });

  it('Test 5: activating "inspector" panel calls setSize({ width: ~290 }) on its group', () => {
    render(<WorkspaceShell />);
    const { mockApi, mockGroupApi, triggerPanelActivation } = buildMockApi();
    dockviewCapture.onReady!({ api: mockApi });

    // RED: WorkspaceShell does not register onDidActivePanelChange → setSize never called
    triggerPanelActivation('inspector');

    expect(mockGroupApi.setSize).toHaveBeenCalled();
    const callArg = mockGroupApi.setSize.mock.calls[0]?.[0] as { width: number } | undefined;
    expect(callArg?.width).toBeGreaterThanOrEqual(250);
    expect(callArg?.width).toBeLessThan(400);
  });

});
