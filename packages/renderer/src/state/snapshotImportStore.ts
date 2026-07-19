/**
 * packages/renderer/src/state/snapshotImportStore.ts
 * Pending in-game world-edit imports awaiting user confirmation.
 *
 * The snapshot watcher (services/snapshotWatcher.ts) adds a detected `.ws` here when the
 * in-game editor saves one into the client's loose SearchPath (== the toolkit override
 * dir). SnapshotImportToast surfaces the pending list with Import / Dismiss — "auto-detect
 * and confirm". Import routes through stageSnapshot into the normal stage→seal→deploy flow.
 */

import { create } from 'zustand';

export interface PendingSnapshotImport {
  /** Absolute path to the saved `.ws` under the override dir's snapshot/ folder. */
  wsFilePath: string;
  /** VFS virtual path (e.g. `snapshot/tatooine.ws`). */
  virtualPath: string;
  /** Scene id parsed from the filename (e.g. `tatooine`). */
  sceneId: string;
  /** SHA-256 of the saved bytes at detection — dedupes repeat fs.watch events. */
  sha256: string;
  detectedAt: string;
}

interface SnapshotImportState {
  pending: PendingSnapshotImport[];
  /** Add (or replace, keyed by wsFilePath) a detected snapshot. */
  add: (d: PendingSnapshotImport) => void;
  remove: (wsFilePath: string) => void;
  clear: () => void;
}

export const useSnapshotImportStore = create<SnapshotImportState>((set) => ({
  pending: [],
  add: (d) =>
    set((s) => ({
      // Replace any prior detection of the SAME file (a re-save supersedes it).
      pending: [...s.pending.filter((p) => p.wsFilePath !== d.wsFilePath), d],
    })),
  remove: (wsFilePath) =>
    set((s) => ({ pending: s.pending.filter((p) => p.wsFilePath !== wsFilePath) })),
  clear: () => set({ pending: [] }),
}));
