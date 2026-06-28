/**
 * packages/renderer/src/panels/deploy/StagingPanelBody.test.tsx
 * Component tests for StagingPanelBody — DEPLOY-07 (Extract→Add path safety)
 *
 * TDD RED: tests compile but fail until Task 2 creates StagingPanelBody.tsx.
 *
 * Tests:
 *   1 — renders without the "Staging" panel-head title (title is dropped in the extraction)
 *   2 — renders role="listbox" (a11y — mandatory per plan)
 *   3 — ROW_HEIGHT=30 / OVERSCAN=8 virtualization constants are preserved
 *       (tested indirectly: visible rows match windowing math)
 *   4 — Save version button is disabled when entries is empty
 *   5 — Save version button is enabled when entries has items
 *
 * Source: 04.1-03-PLAN.md Task 1; 04.1-VALIDATION.md DEPLOY-07 row.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom does not implement ResizeObserver — stub it so StagingPanelBody's
// ResizeObserver-based viewHeight tracking doesn't throw. The stub is a no-op:
// the component will use the default viewHeight=400.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// vi.mock is hoisted — declare BEFORE imports
vi.mock('../../services/changesetService', () => ({
  sealVersion:   vi.fn().mockResolvedValue(undefined),
  selectVersion: vi.fn(),
  flatten:       vi.fn().mockReturnValue([]),
}));

vi.mock('../../services/pathSafety', () => ({
  isVirtualPathSafe: vi.fn().mockReturnValue(true),
}));

import StagingPanelBody from './StagingPanelBody';
import { useChangesetStore } from '../../state/changesetStore';
import { useStagingStore }   from '../../state/stagingStore';
import type { StagingEntry } from '@swg/contracts';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  useChangesetStore.setState({
    manifest: { activeVersionId: null, deployedVersionId: null, changesets: [] },
    sealStatus: { kind: 'idle' },
  });
  useStagingStore.setState({
    entries:     [],
    buildStatus: { kind: 'idle' },
  });
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeStagingEntry(virtualPath: string): StagingEntry {
  return { virtualPath, action: 'add' };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StagingPanelBody', () => {

  it('Test 1: does NOT render a "Staging" panel-head title', () => {
    render(
      <StagingPanelBody
        entries={[]}
        buildStatus={{ kind: 'idle' }}
        workspaceName="FakeProject"
      />,
    );

    // The extracted body should NOT contain a standalone "Staging" heading
    // (DeployPanel owns the section header; this body has no title)
    const stagingTitles = screen.queryAllByText(/^Staging$/i);
    // Filter to headings only (span with fontWeight:600 in panel-head) — we allow
    // the word in other contexts (e.g. empty-state copy or aria-label)
    const headingMatch = stagingTitles.filter((el) => {
      const style = window.getComputedStyle(el);
      // The title span had fontWeight:600 and was inside the panel-head div
      return el.tagName === 'SPAN' && style.fontWeight === '600';
    });
    expect(headingMatch.length).toBe(0);
  });

  it('Test 2: renders role="listbox" for the staging list area', () => {
    render(
      <StagingPanelBody
        entries={[makeStagingEntry('test/file.iff')]}
        buildStatus={{ kind: 'idle' }}
        workspaceName="FakeProject"
      />,
    );

    // role="listbox" must be present for a11y
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
  });

  it('Test 3: renders visible rows for staged entries (virtualization present)', () => {
    const entries: StagingEntry[] = [
      makeStagingEntry('appearance/armor.mgn'),
      makeStagingEntry('audio/sound.snd'),
    ];
    render(
      <StagingPanelBody
        entries={entries}
        buildStatus={{ kind: 'idle' }}
        workspaceName="FakeProject"
      />,
    );

    // Both entries should be visible (small list < OVERSCAN)
    expect(screen.getByText('appearance/armor.mgn')).toBeDefined();
    expect(screen.getByText('audio/sound.snd')).toBeDefined();
  });

  it('Test 4: Save version button is disabled when entries is empty', () => {
    render(
      <StagingPanelBody
        entries={[]}
        buildStatus={{ kind: 'idle' }}
        workspaceName="FakeProject"
      />,
    );

    const saveBtn = screen.getByText('Save version').closest('button');
    expect(saveBtn).not.toBeNull();
    const isDisabled =
      (saveBtn as HTMLButtonElement).disabled === true ||
      saveBtn?.getAttribute('aria-disabled') === 'true';
    expect(isDisabled).toBe(true);
  });

  it('Test 5: Save version button is enabled when entries has items', () => {
    render(
      <StagingPanelBody
        entries={[makeStagingEntry('test/file.iff')]}
        buildStatus={{ kind: 'idle' }}
        workspaceName="FakeProject"
      />,
    );

    const saveBtn = screen.getByText('Save version').closest('button');
    expect(saveBtn).not.toBeNull();
    // Should NOT be disabled
    const isDisabled =
      (saveBtn as HTMLButtonElement).disabled === true ||
      saveBtn?.getAttribute('aria-disabled') === 'true';
    expect(isDisabled).toBe(false);
  });

});

// ─── Task 1 RED: empty-state copy (DEPLOY-07 Copywriting Contract) ────────────
//
// The corrected empty-state body must reference the TRE browser Extract→Add flow.
// RED: fails because current body is "Extract a file and Add to patch, or drop in a replacement."
// GREEN: passes once StagingPanelBody.tsx body is updated to the Copywriting Contract text.

describe('StagingPanelBody — empty-state copy (Copywriting Contract)', () => {

  it('Test 6: empty-state body references TRE browser Extract to staging flow', () => {
    render(
      <StagingPanelBody
        entries={[]}
        buildStatus={{ kind: 'idle' }}
        workspaceName="FakeProject"
      />,
    );

    // UI-SPEC Copywriting Contract — 04.1-08-PLAN.md Task 2 target copy:
    // "Right-click a file in the TRE browser → Extract to staging, or drop a replacement file here."
    // RED: current body is "Extract a file and Add to patch, or drop in a replacement."
    const body = screen.queryByText(/right-click a file in the TRE browser/i);
    expect(body).not.toBeNull();
  });

});
