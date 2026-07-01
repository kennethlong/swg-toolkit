// @vitest-environment node
/**
 * packages/renderer/src/services/readVfsEntryBytes.test.ts
 * Tests for the shared VFS byte-reader service (plan 11 Task 3).
 *
 * readVfsEntryBytes is EXTRACTED from TreVfsBrowser.tsx (private :112) into a
 * shared service so that BOTH TreVfsBrowser and openInViewer.ts route reads
 * through one implementation (H1 read-path wiring).
 *
 * Three read branches:
 *   (1) Loose winner (winnerArchiveIndex < 0): read bytes from disk via fs.readFileSync
 *   (2) Native mount winner (winnerArchiveIndex >= 0, no descriptor): resolveChain + readMountEntry
 *   (3) Master-.toc sourced winner (winnerArchiveIndex >= 0, descriptor supplied):
 *       native extractMountAt(handle, archiveIndex, descriptor)
 *       → { bytes } on success; marks archive encrypted + returns null on { encrypted:true }
 *
 * Test inventory:
 *   (1a) loose winner → bytes from disk (ArrayBuffer)
 *   (1b) loose winner, fs.readFileSync throws → null
 *   (2a) native winner → resolveChain + readMountEntry bytes
 *   (2b) native winner, tombstone → null
 *   (3a) TOC-sourced descriptor → extractMountAt bytes
 *   (3b) TOC-sourced descriptor, extractMountAt returns encrypted:true → null + marks encrypted
 *
 * Sources: 04.3-11-PLAN.md Task 3; RESEARCH Fix 3 / H1 read-path wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VfsEntry } from '../state/treStore';

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

// Mock the nativeTre seam so the service module can be imported without a real .node addon.
vi.mock('./nativeTre', () => ({
  nativeCore: {
    resolveChain: vi.fn(),
    readMountEntry: vi.fn(),
    extractMountAt: vi.fn(),
  },
}));

// Mock fs for readFileSync (loose reads).
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

// Mock treStore for markArchiveEncrypted calls.
vi.mock('../state/treStore', () => ({
  useTreStore: {
    getState: vi.fn().mockReturnValue({
      markArchiveEncrypted: vi.fn(),
    }),
  },
}));

// ── Deferred imports (after mock registration) ────────────────────────────────

// RED: this module does not yet exist at services/readVfsEntryBytes.ts
import { readVfsEntryBytes } from './readVfsEntryBytes';
import { nativeCore } from './nativeTre';
import { useTreStore } from '../state/treStore';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Loose VFS entry (winner is a disk file, not inside any archive). */
function makeLooseEntry(overrides?: Partial<VfsEntry>): VfsEntry {
  return {
    path:                  'appearance/player.msh',
    name:                  'player.msh',
    segments:              ['appearance', 'player.msh'],
    winnerArchivePath:     '/install/loose/appearance/player.msh',
    winnerArchiveFilename: 'player.msh',
    isOverride:            false,
    isTombstone:           false,
    shadowCount:           0,
    winnerArchiveIndex:    -1,  // negative = loose (not from any archive)
    ...overrides,
  };
}

/** Native-mount VFS entry (winner is inside a mounted .tre archive). */
function makeNativeEntry(overrides?: Partial<VfsEntry>): VfsEntry {
  return {
    path:                  'appearance/player.msh',
    name:                  'player.msh',
    segments:              ['appearance', 'player.msh'],
    winnerArchivePath:     '/install/sku_0_client_00.tre',
    winnerArchiveFilename: 'sku_0_client_00.tre',
    isOverride:            false,
    isTombstone:           false,
    shadowCount:           0,
    winnerArchiveIndex:    2,  // valid archive index → archived entry
    ...overrides,
  };
}

const MOCK_BYTES = new ArrayBuffer(64);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('readVfsEntryBytes shared service (plan 11 Task 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset markArchiveEncrypted mock
    (useTreStore.getState().markArchiveEncrypted as ReturnType<typeof vi.fn>).mockReset();
  });

  // ── (1a) Loose winner: read bytes from disk ───────────────────────────────
  it('(1a) loose winner (winnerArchiveIndex<0) → reads bytes from disk via readFileSync', () => {
    const fakeBuffer = Buffer.from([0x49, 0x46, 0x46, 0x20]); // "IFF "
    const { readFileSync } = require('fs') as typeof import('fs');
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(fakeBuffer);

    const result = readVfsEntryBytes(makeLooseEntry(), null);

    expect(readFileSync).toHaveBeenCalledWith('/install/loose/appearance/player.msh');
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result?.byteLength).toBe(4);
  });

  // ── (1b) Loose winner: readFileSync throws → null ─────────────────────────
  it('(1b) loose winner, readFileSync throws → returns null', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('ENOENT'); });

    const result = readVfsEntryBytes(makeLooseEntry(), null);
    expect(result).toBeNull();
  });

  // ── (2a) Native winner: resolveChain + readMountEntry ────────────────────
  it('(2a) native winner → calls resolveChain then readMountEntry, returns bytes', () => {
    (nativeCore.resolveChain as ReturnType<typeof vi.fn>).mockReturnValue({
      winner: '/install/sku_0_client_00.tre',
      tombstone: false,
      winnerArchiveIndex: 2,
      winnerEntryIndex: 5,
    });
    (nativeCore.readMountEntry as ReturnType<typeof vi.fn>).mockReturnValue(MOCK_BYTES);

    const result = readVfsEntryBytes(makeNativeEntry(), 'mount-handle');

    expect(nativeCore.resolveChain).toHaveBeenCalledWith('mount-handle', 'appearance/player.msh');
    expect(nativeCore.readMountEntry).toHaveBeenCalledWith('mount-handle', 2, 5);
    expect(result).toBe(MOCK_BYTES);
  });

  // ── (2b) Native winner, tombstone → null ─────────────────────────────────
  it('(2b) native winner, resolveChain returns tombstone → returns null', () => {
    (nativeCore.resolveChain as ReturnType<typeof vi.fn>).mockReturnValue({
      winner: '',
      tombstone: true,
      winnerArchiveIndex: -1,
      winnerEntryIndex: -1,
    });

    const result = readVfsEntryBytes(makeNativeEntry(), 'mount-handle');
    expect(nativeCore.readMountEntry).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // ── (3a) TOC-sourced descriptor → extractMountAt bytes ───────────────────
  // When caller supplies an extraction descriptor (from tocIndex.resolveFull), the
  // service routes through native extractMountAt instead of resolveChain.
  it('(3a) TOC-sourced entry + descriptor → calls extractMountAt, returns bytes', () => {
    const descriptor = { offset: 1024, length: 512, compressedLength: 256, compressor: 1 };
    (nativeCore.extractMountAt as ReturnType<typeof vi.fn>).mockReturnValue({ bytes: MOCK_BYTES });

    const result = readVfsEntryBytes(makeNativeEntry(), 'mount-handle', descriptor);

    expect(nativeCore.extractMountAt).toHaveBeenCalledWith('mount-handle', 2, descriptor);
    expect(nativeCore.resolveChain).not.toHaveBeenCalled(); // no resolveChain for TOC path
    expect(result).toBe(MOCK_BYTES);
  });

  // ── (3b) TOC-sourced descriptor, extractMountAt returns encrypted:true ────
  // The service must: return null AND call markArchiveEncrypted(archiveIndex) (MOUNT-05).
  it('(3b) extractMountAt returns encrypted:true → null + marks archive encrypted', () => {
    const descriptor = { offset: 512, length: 1024, compressedLength: 1024, compressor: 0 };
    (nativeCore.extractMountAt as ReturnType<typeof vi.fn>).mockReturnValue({ encrypted: true });

    const result = readVfsEntryBytes(makeNativeEntry({ winnerArchiveIndex: 3 }), 'mount-handle', descriptor);

    expect(result).toBeNull();
    expect(useTreStore.getState().markArchiveEncrypted).toHaveBeenCalledWith(3);
  });
});
