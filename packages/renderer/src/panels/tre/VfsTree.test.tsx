/**
 * packages/renderer/src/panels/tre/VfsTree.test.tsx
 * Component tests for VfsTree's double-click "open editor" affordance (05-08-PLAN.md Task 3).
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VfsTree from './VfsTree';
import type { VfsEntry, MountedArchive } from '../../state/treStore';

// jsdom has no ResizeObserver — same stub convention used across the codebase.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const entry: VfsEntry = {
  path: 'datatables/foo.iff',
  name: 'foo.iff',
  segments: ['datatables', 'foo.iff'],
  winnerArchivePath: '/fake/archive.tre',
  winnerArchiveFilename: 'archive.tre',
  isOverride: false,
  isTombstone: false,
  shadowCount: 0,
  winnerArchiveIndex: 0,
};

const archives: MountedArchive[] = [
  {
    path: '/fake/archive.tre',
    filename: 'archive.tre',
    version: 'v0005',
    entryCount: 1,
    priority: 1,
    isEnumerateOnly: false,
    archiveIndex: 0,
  },
];

function renderTree(onOpenEditor?: (e: VfsEntry) => void) {
  return render(
    <VfsTree
      entries={[entry]}
      archives={archives}
      selectedPath={null}
      selectedChain={null}
      onSelect={() => {}}
      onOpenEditor={onOpenEditor}
    />,
  );
}

describe('VfsTree — double-click opens editor (05-08)', () => {
  it('double-clicking a row calls onOpenEditor with that entry exactly once', () => {
    const onOpenEditor = vi.fn();
    const { getByTitle } = renderTree(onOpenEditor);
    const row = getByTitle(entry.path);
    fireEvent.doubleClick(row);
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
    expect(onOpenEditor).toHaveBeenCalledWith(entry);
  });

  it('double-clicking twice calls onOpenEditor twice — dedup is editorTabs.ts’s responsibility, not VfsTree’s', () => {
    const onOpenEditor = vi.fn();
    const { getByTitle } = renderTree(onOpenEditor);
    const row = getByTitle(entry.path);
    fireEvent.doubleClick(row);
    fireEvent.doubleClick(row);
    expect(onOpenEditor).toHaveBeenCalledTimes(2);
  });

  it('does not throw when onOpenEditor is not supplied', () => {
    const { getByTitle } = renderTree(undefined);
    const row = getByTitle(entry.path);
    expect(() => fireEvent.doubleClick(row)).not.toThrow();
  });

  it('a single click does NOT call onOpenEditor (only onSelect)', () => {
    const onOpenEditor = vi.fn();
    const onSelect = vi.fn();
    const { getByTitle } = render(
      <VfsTree
        entries={[entry]}
        archives={archives}
        selectedPath={null}
        selectedChain={null}
        onSelect={onSelect}
        onOpenEditor={onOpenEditor}
      />,
    );
    fireEvent.click(getByTitle(entry.path));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpenEditor).not.toHaveBeenCalled();
  });
});
