/**
 * packages/renderer/src/state/stagingStore.ts
 * Zustand store for the explicit staging list (DEPLOY-02/03).
 *
 * Manages:
 *   - Staged entries (add/modify/delete) keyed by virtualPath
 *   - Build status for the current pack operation
 *
 * Entries map 1:1 onto TreBuilderEntryNative for buildTre (D-04-03).
 *
 * Source: 04-01-PLAN.md Task 2; liveStore.ts pattern.
 */

import { create } from 'zustand';
import type { StagingEntry } from '@swg/contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Discriminated union for the current patch build status. */
export type StagingBuildStatus =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'done'; patchPath: string }
  | { kind: 'error'; reason: string };

// ─── Store interface ──────────────────────────────────────────────────────────

export interface StagingStore {
  /** Currently staged entries. Keyed by virtualPath — no duplicates. */
  entries: StagingEntry[];
  /** Status of the most recent (or current) build operation. */
  buildStatus: StagingBuildStatus;

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Upsert a staging entry by virtualPath. Replaces any existing entry for the same path. */
  addEntry: (e: StagingEntry) => void;
  /** Remove the staging entry with the given virtualPath. */
  removeEntry: (virtualPath: string) => void;
  /** Clear all staged entries (e.g. after sealing a changeset). */
  clearAll: () => void;
  /**
   * Replace entries wholesale (used by selectVersion to restore working set
   * from a prior changeset's flattened deltas).
   */
  restoreEntries: (entries: StagingEntry[]) => void;
  /** Begin building the deploy patch. */
  beginBuild: () => void;
  /** Build succeeded — record the output patch path. */
  buildDone: (patchPath: string) => void;
  /** Build failed — record the reason. */
  buildError: (reason: string) => void;
  /** Reset build status to idle. */
  resetBuild: () => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useStagingStore = create<StagingStore>((set) => ({
  entries:     [],
  buildStatus: { kind: 'idle' },

  addEntry: (e: StagingEntry) =>
    set((state) => ({
      entries: [
        ...state.entries.filter((x) => x.virtualPath !== e.virtualPath),
        e,
      ],
    })),

  removeEntry: (virtualPath: string) =>
    set((state) => ({
      entries: state.entries.filter((x) => x.virtualPath !== virtualPath),
    })),

  clearAll: () =>
    set({ entries: [] }),

  restoreEntries: (entries: StagingEntry[]) =>
    set({ entries }),

  beginBuild: () =>
    set({ buildStatus: { kind: 'building' } }),

  buildDone: (patchPath: string) =>
    set({ buildStatus: { kind: 'done', patchPath } }),

  buildError: (reason: string) =>
    set({ buildStatus: { kind: 'error', reason } }),

  resetBuild: () =>
    set({ buildStatus: { kind: 'idle' } }),
}));
