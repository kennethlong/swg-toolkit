/**
 * packages/renderer/src/shell/editorTabs.test.ts
 * Unit tests for openEditorTab's dedup contract (05-08-PLAN.md Task 3 acceptance criteria).
 */

import { describe, it, expect, vi } from 'vitest';
import type { DockviewApi } from 'dockview';
import { openEditorTab } from './editorTabs';

function buildMockDockApi() {
  let panel: { api: { setActive: ReturnType<typeof vi.fn> } } | undefined;
  const setActive = vi.fn();
  const getPanel = vi.fn(() => panel);
  const addPanel = vi.fn(() => {
    panel = { api: { setActive } };
    return panel;
  });
  return { dockApi: { getPanel, addPanel } as unknown as DockviewApi, getPanel, addPanel, setActive };
}

describe('editorTabs — openEditorTab', () => {
  it('adds a new panel within the viewport group when no existing panel with this id', () => {
    const { dockApi, addPanel } = buildMockDockApi();

    openEditorTab(dockApi, {
      id: 'dtii:appearance/foo.iff',
      title: 'foo.iff — Datatable',
      component: 'datatable-grid-editor',
      params: { virtualPath: 'appearance/foo.iff' },
    });

    expect(addPanel).toHaveBeenCalledTimes(1);
    const call = addPanel.mock.calls[0]![0] as {
      id: string;
      component: string;
      title: string;
      position?: { direction: string; referencePanel: string };
      params?: unknown;
    };
    expect(call.id).toBe('dtii:appearance/foo.iff');
    expect(call.component).toBe('datatable-grid-editor');
    expect(call.title).toBe('foo.iff — Datatable');
    expect(call.position).toEqual({ direction: 'within', referencePanel: 'viewport' });
    expect(call.params).toEqual({ virtualPath: 'appearance/foo.iff' });
  });

  it('activates the existing panel instead of adding a duplicate when the id already exists', () => {
    const setActive = vi.fn();
    const existingPanel = { api: { setActive } };
    const getPanel = vi.fn().mockReturnValue(existingPanel);
    const addPanel = vi.fn();
    const dockApi = { getPanel, addPanel } as unknown as DockviewApi;

    openEditorTab(dockApi, {
      id: 'dtii:appearance/foo.iff',
      title: 'foo.iff — Datatable',
      component: 'datatable-grid-editor',
      params: {},
    });

    expect(setActive).toHaveBeenCalledTimes(1);
    expect(addPanel).not.toHaveBeenCalled();
  });

  it('two calls with the same id (simulating two double-clicks on the same file) call addPanel exactly once', () => {
    const { dockApi, addPanel, setActive } = buildMockDockApi();
    const opts = {
      id: 'dtii:appearance/foo.iff',
      title: 'foo.iff — Datatable',
      component: 'datatable-grid-editor',
      params: {},
    };

    openEditorTab(dockApi, opts); // first "double-click" — opens the tab
    openEditorTab(dockApi, opts); // second "double-click" on the SAME path — activates it

    expect(addPanel).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenCalledTimes(1);
  });
});
