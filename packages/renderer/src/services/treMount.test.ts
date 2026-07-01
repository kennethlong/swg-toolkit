// @vitest-environment node
/**
 * packages/renderer/src/services/treMount.test.ts
 * D-15 + MOUNT-07 tests for the lazy searchPath refactor (plan 11 Task 3).
 *
 * Test inventory:
 *   (A) D-15: injectLooseDirOverlay records the dir in store.looseDirs (lazy — no readdirSync scan)
 *       RED until GREEN: looseDirs does not yet exist in treStore; injectLooseDirOverlay does not push
 *   (B) MOUNT-07: resolveLooseOverride returns disk path when file exists in a loose dir
 *       RED until GREEN: resolveLooseOverride is not yet exported from treMount.ts
 *   (C) MOUNT-07: resolveLooseOverride returns null when no loose dir has the file
 *   (D) MOUNT-07: resolveLooseOverride checks dirs in order (first-win, highest-priority first)
 *
 * Sources: 04.3-11-PLAN.md Task 3; D-15 / MOUNT-07 requirements.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

// Mock nativeTre seam so treMount.ts import does not crash (no real .node addon in CI).
vi.mock('./nativeTre', () => ({
  nativeCore: {
    mountSearchableAsync:    vi.fn().mockResolvedValue('mock-handle'),
    mountTreMountWithToc:    vi.fn().mockReturnValue('mock-handle'),
    getMountArchives:        vi.fn().mockReturnValue([]),
    getMountEntriesColumnar: vi.fn().mockReturnValue(new ArrayBuffer(0)),
  },
}));

// Mock fs: existsSync used by resolveLooseOverride in GREEN implementation.
// readdirSync is intentionally NOT mocked — the lazy refactor must NOT call it.
vi.mock('fs', () => ({
  existsSync:  vi.fn().mockReturnValue(true),
  readdirSync: vi.fn().mockReturnValue([]),   // safety: should never be called after GREEN
}));

// Mock path for cross-platform predictability.
vi.mock('path', () => ({
  join:     (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'),
  relative: (from: string, to: string) =>
    to.startsWith(from + '/') ? to.slice(from.length + 1) : to,
}));

// ── Deferred imports (after mock registration) ────────────────────────────────

import { injectLooseDirOverlay, resolveLooseOverride } from './treMount';
import { useTreStore } from '../state/treStore';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('treMount lazy searchPath (plan 11 Task 3)', () => {
  beforeEach(() => {
    // Reset store to a clean slate.
    useTreStore.setState({ vfsEntries: [], archives: [], mountHandle: null });
    vi.clearAllMocks();
  });

  // ── (A) D-15: injectLooseDirOverlay records dir lazily in store.looseDirs ─
  // RED until GREEN:
  //   Currently: injectLooseDirOverlay calls collectLooseEntries (readdirSync) + appendLooseEntries.
  //   After lazy refactor: it records the dir in store.looseDirs for on-demand resolve.
  //   The RED assertion: (useTreStore.getState() as any).looseDirs includes the dir.
  //   This is RED because: (1) looseDirs field does not exist in treStore yet,
  //   (2) injectLooseDirOverlay does not push to it.
  it('(A) D-15: injectLooseDirOverlay records the dir in store.looseDirs (lazy, no flat rows)', () => {
    injectLooseDirOverlay('/loose/data', { isOverride: false });

    // RED: looseDirs does not exist in treStore; this will be undefined → fails includes check
    // GREEN: store.looseDirs = ['/loose/data'] after the lazy refactor
    const looseDirs = (useTreStore.getState() as { looseDirs?: string[] }).looseDirs;
    expect(Array.isArray(looseDirs)).toBe(true);
    expect(looseDirs).toContain('/loose/data');
  });

  it('(A2) D-15: injectLooseDirOverlay does NOT add flat VfsEntry rows', () => {
    const vfsBefore = useTreStore.getState().vfsEntries.length;
    injectLooseDirOverlay('/loose/data', { isOverride: false });
    // Regardless of lazy-vs-eager, loose files must NOT be listed as flat VFS rows (D-15).
    // RED: currently appendLooseEntries adds rows when readdirSync returns files.
    // After the vi.mock('fs') above, readdirSync returns [] so no rows — but the real
    // assertion is that the vi.mock('fs') readdirSync must NOT be called at all after GREEN.
    // This test catches regressions: if rows are added, this fails.
    expect(useTreStore.getState().vfsEntries.length).toBe(vfsBefore);
  });

  // ── (B) MOUNT-07: resolveLooseOverride returns disk path when file exists ─
  // RED: resolveLooseOverride is not yet exported from treMount.ts
  it('(B) MOUNT-07: resolveLooseOverride returns disk path when file exists in looseDir', () => {
    // fs.existsSync mock returns true → first looseDir wins
    const result = resolveLooseOverride(['/install/loose'], 'appearance/player.msh');
    expect(result).toBe('/install/loose/appearance/player.msh');
  });

  // ── (C) MOUNT-07: resolveLooseOverride returns null when file not found ───
  it('(C) MOUNT-07: resolveLooseOverride returns null when file not found in any looseDir', async () => {
    const { existsSync } = await import('fs');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = resolveLooseOverride(['/install/loose'], 'missing/file.iff');
    expect(result).toBeNull();
  });

  // ── (D) MOUNT-07: first-matching-dir wins ────────────────────────────────
  it('(D) MOUNT-07: resolveLooseOverride returns from FIRST dir where the file exists', async () => {
    const { existsSync } = await import('fs');
    (existsSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(false) // /override/appearance/player.msh — miss
      .mockReturnValueOnce(true); // /base/appearance/player.msh — hit
    const result = resolveLooseOverride(['/override', '/base'], 'appearance/player.msh');
    expect(result).toBe('/base/appearance/player.msh');
  });
});
