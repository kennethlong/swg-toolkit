// @vitest-environment node
/**
 * packages/renderer/src/state/deleteUndoStore.test.ts
 * Unit test for purgeStaleTrash() at the App.tsx-wiring level (04.4-01 Task 3).
 *
 * Extends 04.4-01-01's Test L (deleteProject.test.ts) — acceptable overlap for an acceptance
 * check per the plan's Task 3 acceptance criteria, exercised here in isolation from
 * deleteProject.ts's native-core mocking chain (this store has no native dependency).
 *
 * Source: 04.4-01-PLAN.md Task 3.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// getStudiosRoot() is imported from workspaceService.ts, which transitively pulls in
// treAutoMount.ts → treMount.ts → nativeTre.ts (the native addon require() seam). Mock it
// so importing workspaceService here never attempts to load the real .node binary
// (mirrors projectBinding.test.ts's mocking pattern).
const nativeMocks = vi.hoisted(() => ({
  mountSearchableAsync:    vi.fn().mockResolvedValue('mock-handle-01'),
  mountTreMountWithToc:    vi.fn().mockReturnValue('mock-handle-01'),
  getMountArchives:        vi.fn().mockReturnValue([]),
  getMountEntriesColumnar: vi.fn().mockReturnValue(new ArrayBuffer(8)),
  extractMountAt:          vi.fn(),
  resolveChain:            vi.fn(),
  readMountEntry:          vi.fn(),
}));
vi.mock('@swg/native-core', () => nativeMocks);
vi.mock('../services/nativeTre', () => ({ nativeCore: nativeMocks }));

import { useDeleteUndoStore } from './deleteUndoStore';
import { getStudiosRoot } from '../services/workspaceService';

beforeEach(() => {
  useDeleteUndoStore.setState({ pending: [] });
});

describe('purgeStaleTrash (App.tsx startup wiring)', () => {
  it('removes ONLY the marked entry; the unmarked entry (and its files) survive on disk, named in warnings', () => {
    const trashRoot = path.join(getStudiosRoot(), '.trash');
    fs.mkdirSync(trashRoot, { recursive: true });

    // Marked entry — simulates a normal completed park from a prior session.
    const markedDir = path.join(trashRoot, `marked-${crypto.randomUUID()}`);
    fs.mkdirSync(path.join(markedDir, 'studio'), { recursive: true });
    fs.mkdirSync(path.join(markedDir, 'project'), { recursive: true });
    fs.writeFileSync(
      path.join(markedDir, '.complete.json'),
      JSON.stringify({
        deletedAt: new Date().toISOString(),
        projectName: 'marked-project',
        paths: { studio: path.join(markedDir, 'studio'), project: path.join(markedDir, 'project') },
      }),
    );

    // Unmarked entry — simulates a crash interrupting the park mid-way (no marker written).
    const unmarkedDir = path.join(trashRoot, `unmarked-${crypto.randomUUID()}`);
    fs.mkdirSync(path.join(unmarkedDir, 'studio'), { recursive: true });
    fs.writeFileSync(path.join(unmarkedDir, 'studio', 'still-here.txt'), 'SURVIVED_CRASH');

    const { warnings } = useDeleteUndoStore.getState().purgeStaleTrash();

    expect(fs.existsSync(markedDir)).toBe(false);
    expect(fs.existsSync(unmarkedDir)).toBe(true);
    expect(fs.existsSync(path.join(unmarkedDir, 'studio', 'still-here.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(unmarkedDir, 'studio', 'still-here.txt'), 'utf8')).toBe(
      'SURVIVED_CRASH',
    );
    expect(warnings.some((w) => w.includes(unmarkedDir))).toBe(true);
  });

  it('returns empty warnings and is a no-op when .trash/ does not exist', () => {
    const trashRoot = path.join(getStudiosRoot(), '.trash');
    fs.rmSync(trashRoot, { recursive: true, force: true });

    const { warnings } = useDeleteUndoStore.getState().purgeStaleTrash();
    expect(warnings).toEqual([]);
  });
});
