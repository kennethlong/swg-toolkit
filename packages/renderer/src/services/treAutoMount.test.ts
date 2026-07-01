// @vitest-environment node
/**
 * packages/renderer/src/services/treAutoMount.test.ts
 * B1/B2/B4/MOUNT-01/MOUNT-06 tests for the unified single-mount strategy.
 *
 * All external dependencies are mocked so tests run in CI without a real client install.
 *
 * Test inventory:
 *   (a) B1: single mount call + mountComplete called exactly 1x (searchTOC client)
 *   (b) B2: searchTree@rawPriority=8 strictly outranks tocEntry@rawPriority=3
 *   (c) B4 isOverride=false: looseDirPriority=5 < maxTreRawPriority=8 → isOverride:false
 *   (d) B4 isOverride=true:  looseDirPriority=10 > maxTreRawPriority=8 → isOverride:true
 *   (e) MOUNT-01: searchTOC client uses mountTreMountWithTocPaths (not mountTrePaths)
 *   (f) MOUNT-06: searchTree-only client still uses mountTrePaths (regression guard)
 *
 * Sources: 04.2-03-PLAN.md Task 2; 04.3-11-PLAN.md MOUNT-01/06.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClientMountOrder } from './clientSearchOrder';

// ── Module mocks (hoisted before any imports) ──────────────────────────────
vi.mock('./treMount', () => ({
  mountTrePaths:                vi.fn().mockResolvedValue('mock-handle'),
  mountTreMountWithTocPaths:    vi.fn().mockResolvedValue('mock-toc-handle'),
  mountComplete:                vi.fn(),
  injectLooseDirOverlay:        vi.fn(),
  beginMountStatus:             vi.fn(),
  endMountStatusIfPending:      vi.fn(),
}));

vi.mock('./tocReader', () => ({
  readTocTreeNames: vi.fn(),
}));

vi.mock('./clientSearchOrder', () => ({
  resolveClientMountOrder: vi.fn(),
}));

vi.mock('fs', async () => {
  // Partial mock: only existsSync is needed (buildTreNodes uses it to probe TOC TRE paths).
  // All other fs methods fall through to vitest's automatic mock (returns undefined).
  return {
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

// ── Deferred imports (after mock registration) ──────────────────────────────
// Dynamic imports ensure the mocked module is loaded when the imports resolve.
import { autoMountClient } from './treAutoMount';
import { mountTrePaths, mountTreMountWithTocPaths, mountComplete, injectLooseDirOverlay } from './treMount';
import { readTocTreeNames }                                       from './tocReader';
import { resolveClientMountOrder }                                from './clientSearchOrder';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Base ClientMountOrder with all required fields. Override per test. */
function baseOrder(overrides: Partial<ClientMountOrder> = {}): ClientMountOrder {
  return {
    trePaths:               [],
    priorities:             [],
    searchTreeRawPriorities: [],
    looseDirs:              [],
    looseDirPriorities:     [],
    tocEntries:             [],
    tocTreePaths:           [],
    maxPriority:            20,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('autoMountClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: readTocTreeNames returns one TRE name (overridden per test as needed).
    (readTocTreeNames as ReturnType<typeof vi.fn>).mockReturnValue(['toc_file.tre']);
    // Default: resolveClientMountOrder returns a minimal order with one searchTree TRE.
    (resolveClientMountOrder as ReturnType<typeof vi.fn>).mockReturnValue(
      baseOrder({
        trePaths:               ['/install/searchTree.tre'],
        searchTreeRawPriorities: [8],
      }),
    );
  });

  // ── (a) B1: single mountTrePaths call + single mountComplete call ───────
  it('(a) B1: mountTrePaths called exactly once; mountComplete called exactly once', async () => {
    (resolveClientMountOrder as ReturnType<typeof vi.fn>).mockReturnValue(
      baseOrder({
        trePaths:               ['/install/searchTree.tre'],
        searchTreeRawPriorities: [8],
        tocEntries:             [{ tocFilePath: '/install/sku0.toc', priority: 3 }],
        tocTreePaths:           ['/install/data'],
      }),
    );
    // readTocTreeNames returns 1 name → tocEntry expands to 1 TRE path.
    (readTocTreeNames as ReturnType<typeof vi.fn>).mockReturnValue(['sku_toc.tre']);

    await autoMountClient('/install');

    expect(mountTrePaths).toHaveBeenCalledTimes(1);
    expect(mountComplete).toHaveBeenCalledTimes(1);
  });

  // ── (b) B2: searchTree@8 strictly outranks tocEntry@3 in compact sequence ─
  it('(b) B2: searchTree@rawPriority=8 gets higher compact priority than tocEntry@rawPriority=3 TREs', async () => {
    (resolveClientMountOrder as ReturnType<typeof vi.fn>).mockReturnValue(
      baseOrder({
        trePaths:               ['/install/searchTree.tre'],
        searchTreeRawPriorities: [8],
        tocEntries:             [{ tocFilePath: '/install/sku0.toc', priority: 3 }],
        tocTreePaths:           ['/install/data'],
      }),
    );
    // readTocTreeNames returns 2 names → tocEntry expands to 2 TRE paths.
    // Total: 3 nodes — searchTree@8, tocTre1@3, tocTre2@3.
    (readTocTreeNames as ReturnType<typeof vi.fn>).mockReturnValue(['sku_toc_a.tre', 'sku_toc_b.tre']);

    await autoMountClient('/install');

    expect(mountTrePaths).toHaveBeenCalledTimes(1);
    const [paths, priorities] = (mountTrePaths as ReturnType<typeof vi.fn>).mock.calls[0] as [string[], number[]];

    // searchTree path must be first in the call (highest rawPriority).
    expect(paths[0]).toBe('/install/searchTree.tre');

    // searchTree compact priority (priorities[0]) must exceed BOTH toc compact priorities.
    const searchTreePriority = priorities[0]!;
    const tocPriority1       = priorities[1]!;
    const tocPriority2       = priorities[2]!;
    expect(searchTreePriority).toBeGreaterThan(tocPriority1);
    expect(searchTreePriority).toBeGreaterThan(tocPriority2);
  });

  // ── (c) B4 isOverride=false: looseDirPriority=5 < maxTreRawPriority=8 ───
  it('(c) B4: searchPath@5 with maxTreRawPriority=8 → injectLooseDirOverlay({isOverride:false})', async () => {
    (resolveClientMountOrder as ReturnType<typeof vi.fn>).mockReturnValue(
      baseOrder({
        trePaths:               ['/install/searchTree.tre'],
        searchTreeRawPriorities: [8],
        looseDirs:              ['/install/loose'],
        looseDirPriorities:     [5],
      }),
    );

    await autoMountClient('/install');

    expect(injectLooseDirOverlay).toHaveBeenCalledTimes(1);
    expect(injectLooseDirOverlay).toHaveBeenCalledWith('/install/loose', { isOverride: false });
  });

  // ── (d) B4 isOverride=true: looseDirPriority=10 > maxTreRawPriority=8 ───
  it('(d) B4: searchPath@10 with maxTreRawPriority=8 → injectLooseDirOverlay({isOverride:true})', async () => {
    (resolveClientMountOrder as ReturnType<typeof vi.fn>).mockReturnValue(
      baseOrder({
        trePaths:               ['/install/searchTree.tre'],
        searchTreeRawPriorities: [8],
        looseDirs:              ['/install/override'],
        looseDirPriorities:     [10],
      }),
    );

    await autoMountClient('/install');

    expect(injectLooseDirOverlay).toHaveBeenCalledTimes(1);
    expect(injectLooseDirOverlay).toHaveBeenCalledWith('/install/override', { isOverride: true });
  });

  // ── (e) MOUNT-01: searchTOC client → mountTreMountWithTocPaths called ────
  // RED until plan 11 GREEN: autoMountClient currently uses mountTrePaths for ALL clients.
  // After GREEN: searchTOC clients (tocEntries.length > 0) route through
  // mountTreMountWithTocPaths so the native layer can source entries from the master .toc.
  it('(e) MOUNT-01: tocEntries present → mountTreMountWithTocPaths called, mountTrePaths not called', async () => {
    (resolveClientMountOrder as ReturnType<typeof vi.fn>).mockReturnValue(
      baseOrder({
        trePaths:               [],
        searchTreeRawPriorities: [],
        tocEntries:             [{ tocFilePath: '/install/sku3.toc', priority: 3 }],
        tocTreePaths:           ['/install/data/sku3'],
      }),
    );
    (readTocTreeNames as ReturnType<typeof vi.fn>).mockReturnValue(['patch_sku3_24.tre']);

    await autoMountClient('/install');

    // MOUNT-01: for searchTOC clients, the TOC-keyed native mount is used
    expect(mountTreMountWithTocPaths).toHaveBeenCalledTimes(1);
    // MOUNT-01 corollary: plain mountTrePaths must NOT be called for searchTOC clients
    expect(mountTrePaths).not.toHaveBeenCalled();
    // B1 still holds: mountComplete called exactly once
    expect(mountComplete).toHaveBeenCalledTimes(1);

    // Verify the tocPath + tocTreePath args are passed through correctly
    const [, , tocPath, tocTreePath] =
      (mountTreMountWithTocPaths as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string[], number[], string, string
      ];
    expect(tocPath).toBe('/install/sku3.toc');
    expect(tocTreePath).toBe('/install/data/sku3');
  });

  // ── (f) MOUNT-06: searchTree-only client → mountTrePaths still used (regression guard) ─
  // Confirms Infinity/SWGEmu clients (no tocEntries) are NOT affected by the searchTOC change.
  it('(f) MOUNT-06: searchTree-only client → mountTrePaths called, mountTreMountWithTocPaths not called', async () => {
    (resolveClientMountOrder as ReturnType<typeof vi.fn>).mockReturnValue(
      baseOrder({
        trePaths:               ['/install/sku_0_client_00.tre'],
        searchTreeRawPriorities: [5],
        tocEntries:             [],   // no searchTOC → classic searchTree client
        tocTreePaths:           [],
      }),
    );

    await autoMountClient('/install');

    expect(mountTrePaths).toHaveBeenCalledTimes(1);
    expect(mountTreMountWithTocPaths).not.toHaveBeenCalled();
    expect(mountComplete).toHaveBeenCalledTimes(1);
  });
});
