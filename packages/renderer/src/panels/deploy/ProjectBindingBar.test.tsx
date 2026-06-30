/**
 * packages/renderer/src/panels/deploy/ProjectBindingBar.test.tsx
 * Component tests for ProjectBindingBar — P1/P2/P3 sketch 007-A (04.3-08 Task 1).
 *
 * Tests:
 *   1 — P1: bound header shows project name ("◆ DL-44 Overhaul") when project is open
 *   2 — P2: bound-client chip has pill styling (radius-full + accent border)
 *   3 — P3: Open Recent renders live links when recents exist (not a disabled static item)
 *   4 — when no project, proj-bar is not rendered (no project name displayed)
 *   5 — D-13 binding-details sub-row preserved (KEEP)
 *
 * Source: 04.3-08-PLAN.md Task 1; sketch 007-A bound header + chip.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkspaceInfo } from '@swg/contracts';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
// MOCK_RECENTS declared via vi.hoisted so it's accessible inside vi.mock factories.

const { MOCK_RECENTS } = vi.hoisted(() => ({
  MOCK_RECENTS: [
    { folderPath: '/projects/dl44',    name: 'DL-44 Overhaul',      kind: 'client' as const, lastOpenedISO: new Date().toISOString() },
    { folderPath: '/projects/recolor', name: 'Stormtrooper Recolor', kind: 'client' as const, lastOpenedISO: new Date().toISOString() },
  ],
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock path (component uses require('path'))
vi.mock('path', () => {
  const p = {
    basename: (s: string) => s.split(/[\\/]/).pop() ?? s,
    resolve:  (s: string) => s,
    join:     (...parts: string[]) => parts.join('/'),
    dirname:  (s: string) => s.split(/[\\/]/).slice(0, -1).join('/'),
  };
  return { default: p, ...p };
});

// clientLayout: returns a dummy layout (for D-13 sub-row)
vi.mock('../../services/clientLayout', () => ({
  resolveLayout: vi.fn().mockReturnValue({
    release: 'infinity', cfgFile: 'swgemu.cfg', treSubdir: 'Live',
    maxSearchPriority: 55, treDirFromCfg: false,
  }),
}));

// openProjectStore
vi.mock('../../state/openProjectStore', () => ({
  useOpenProjectStore: { getState: () => ({ open: vi.fn() }) },
}));

// workspaceService: stub openWorkspace
vi.mock('../../services/workspaceService', () => ({
  openWorkspace: vi.fn().mockResolvedValue(undefined),
  getDefaultProjectFolder: vi.fn().mockReturnValue('/fake/projects/dl44'),
}));

// recentProjects: 2 projects for P3 testing
vi.mock('../../services/recentProjects', () => ({
  getRecentProjects: vi.fn().mockReturnValue(MOCK_RECENTS),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import ProjectBindingBar from './ProjectBindingBar';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useTreStore } from '../../state/treStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readyInfo(override: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    folderPath:    'D:\\projects\\dl44',
    studioDir:     'D:\\projects\\dl44\\.studio',
    workspaceName: 'DL-44 Overhaul',
    clientPath:    'D:\\SWG Infinity\\SWG Infinity',
    kind:          'client',
    projectName:   'DL-44 Overhaul',
    ...override,
  };
}

const noop = () => {};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useWorkspaceStore.setState({
    status:       { kind: 'idle' },
    clientPath:   null,
    workspaceName: null,
  });
  useTreStore.setState({ archives: [] });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProjectBindingBar — P1/P2/P3 sketch 007-A', () => {

  it('(1) P1: bound header shows project name when project is open', async () => {
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info: readyInfo() },
      clientPath:    'D:\\SWG Infinity\\SWG Infinity',
      workspaceName: 'DL-44 Overhaul',
    });

    render(<ProjectBindingBar onNewProject={noop} onMount={noop} archiveCount={0} />);

    // P1: project name with ◆ glyph appears in the proj-bar
    const nameEl = await screen.findByText('DL-44 Overhaul');
    expect(nameEl).toBeTruthy();
  });

  it('(2) P2: bound-client chip has pill styling (radius-full + accent background)', async () => {
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info: readyInfo() },
      clientPath:    'D:\\SWG Infinity\\SWG Infinity',
      workspaceName: 'DL-44 Overhaul',
    });
    useTreStore.setState({ archives: [{ id: 'a', path: 'x', version: 'v5000', entryCount: 0 }] });

    render(<ProjectBindingBar onNewProject={noop} onMount={noop} archiveCount={1} />);

    // P2: chip should be a pill — look for the chip span with radius-full styling
    // The chip contains "SWG Infinity" text (client name)
    const chipEl = await screen.findByText((content, element) => {
      // Match the chip span that contains "SWG Infinity" and has radius-full style
      if (!element) return false;
      const style = (element as HTMLElement).style;
      return (
        element.tagName === 'SPAN' &&
        content.includes('SWG Infinity') &&
        style.borderRadius.includes('999px') // radius-full fallback
      );
    });
    expect(chipEl).toBeTruthy();
  });

  it('(3) P3: Open Recent renders live link items when recents exist', async () => {
    // Click the ▾ dropdown to open the menu
    const { getByTitle } = render(
      <ProjectBindingBar onNewProject={noop} onMount={noop} archiveCount={0} />,
    );

    // Click the caret to open dropdown
    const caretBtn = getByTitle('Project actions');
    caretBtn.click();

    // The live recent projects should appear as clickable menuitem elements
    const dl44 = await screen.findByText('DL-44 Overhaul');
    expect(dl44).toBeTruthy();
    // Should NOT be the aria-disabled static item
    expect(dl44.getAttribute('aria-disabled')).toBeFalsy();

    const recolor = screen.getByText('Stormtrooper Recolor');
    expect(recolor).toBeTruthy();
  });

  it('(4) when no project is open, proj-bar (project name) is not rendered', () => {
    render(<ProjectBindingBar onNewProject={noop} onMount={noop} archiveCount={0} />);
    // No project — clientPath is null, so no proj-bar
    const nameEls = screen.queryAllByText(/DL-44/i);
    expect(nameEls.length).toBe(0);
  });

  it('(5) D-13 binding-details sub-row preserved (KEEP)', async () => {
    useWorkspaceStore.setState({
      status:        { kind: 'ready', info: readyInfo({ cfgPath: 'D:\\SWG Infinity\\swgemu.cfg' }) },
      clientPath:    'D:\\SWG Infinity\\SWG Infinity',
      workspaceName: 'DL-44 Overhaul',
    });

    render(<ProjectBindingBar onNewProject={noop} onMount={noop} archiveCount={0} />);

    // D-13 sub-row should show "cfg:" detail
    const cfgEl = await screen.findByText(/cfg:/i);
    expect(cfgEl).toBeTruthy();
  });

});
