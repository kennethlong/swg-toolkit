/**
 * packages/renderer/src/state/treStore.ts — Zustand store for TRE VFS browser state.
 *
 * Manages:
 *   - Mounted archives list (priority order, version, entry count)
 *   - Mount status (idle / mounting / done / error)
 *   - Search query + results
 *   - Selected file + shadow chain detail
 *   - VFS tree (resolved entry list from the mount)
 *
 * State follows the D-06 requirement: read-focused TRE virtual-filesystem browser
 * wired into the Phase-0 dockview shell.
 *
 * Source: 01-UI-SPEC.md § "Surface 1 — TRE Virtual-Filesystem Browser";
 *         01-CONTEXT.md D-06 (TRE VFS browser).
 */

import { create } from 'zustand';
import type { TreVersion } from '@swg/contracts';

// ─── Types ───────────────────────────────────────────────────────────────────

/** One mounted archive in the priority list. */
export interface MountedArchive {
  /** Absolute filesystem path to the .tre file. */
  path: string;
  /** Short filename for display (basename). */
  filename: string;
  /** TRE version tag as displayed (e.g. 'v0005', 'v6000'). */
  version: TreVersion;
  /** Total number of TOC entries. */
  entryCount: number;
  /** Mount priority (higher = higher precedence). */
  priority: number;
  /** True only for v6000 (enumerate-only, encrypted payloads). */
  isEnumerateOnly: boolean;
  /** Index of this archive in the native mount's priority list. */
  archiveIndex: number;
}

/** One resolved VFS entry shown in the tree. */
export interface VfsEntry {
  /** Normalized path (e.g. "appearance/player.apt"). */
  path: string;
  /** Short name for display (basename). */
  name: string;
  /** Segments array for tree folding. */
  segments: string[];
  /** Winning archive path. */
  winnerArchivePath: string;
  /** Short name of the winning archive. */
  winnerArchiveFilename: string;
  /** True if this entry overrides a lower-priority archive. */
  isOverride: boolean;
  /** True if this entry is a tombstone (file deleted). */
  isTombstone: boolean;
  /** Number of lower-priority archives shadowed. */
  shadowCount: number;
  /** Archive index in the native mount list. */
  archiveIndex: number;
  /** Entry index in that archive. */
  entryIndex: number;
}

/** Shadow chain detail for a selected file. */
export interface ShadowChainDisplay {
  /** Winning archive path + short name. */
  winner: { path: string; filename: string };
  /** Is the winner a tombstone? */
  tombstone: boolean;
  /** Shadowed archives (lower priority). */
  shadows: Array<{ path: string; filename: string }>;
}

/** Mount operation status. */
export type MountStatus =
  | { kind: 'idle' }
  | { kind: 'mounting'; filename: string; pct: number }
  | { kind: 'done' }
  | { kind: 'error'; filename: string; reason: string };

/** Search query state. */
export interface SearchState {
  text: string;
  mode: 'substring' | 'glob';
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface TreStore {
  /** Opaque handle from mountTreMount() or mountSearchableAsync(). */
  mountHandle: string | null;

  /** Mounted archives in priority order (highest first). */
  archives: MountedArchive[];

  /** Resolved VFS entries from the mount. Populated after mount completes. */
  vfsEntries: VfsEntry[];

  /** Current mount operation status. */
  mountStatus: MountStatus;

  /** Current search query. */
  search: SearchState;

  /** Filtered VFS entries (subset of vfsEntries matching search). */
  searchResults: VfsEntry[];

  /** Currently selected VFS entry path (for shadow chain display). */
  selectedEntryPath: string | null;

  /** Shadow chain for the currently selected entry. */
  selectedChain: ShadowChainDisplay | null;

  // ─── Actions ─────────────────────────────────────────────────────────────

  /** Start mounting archives (called by TreVfsBrowser). */
  beginMount: (paths: string[], priorities: number[]) => void;

  /** Mount completed successfully. */
  mountComplete: (
    handle: string,
    archives: MountedArchive[],
    vfsEntries: VfsEntry[],
  ) => void;

  /** Mount failed. */
  mountError: (filename: string, reason: string) => void;

  /** Update search query and recompute filtered results. */
  setSearch: (query: Partial<SearchState>, results: VfsEntry[]) => void;

  /** Select a VFS entry and set its shadow chain. */
  selectEntry: (path: string | null, chain: ShadowChainDisplay | null) => void;

  /** Clear all mounts and reset to idle. */
  reset: () => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useTreStore = create<TreStore>((set) => ({
  mountHandle:      null,
  archives:         [],
  vfsEntries:       [],
  mountStatus:      { kind: 'idle' },
  search:           { text: '', mode: 'substring' },
  searchResults:    [],
  selectedEntryPath: null,
  selectedChain:    null,

  beginMount: (paths, _priorities) => {
    const filename = paths.length === 1
      ? basename(paths[0])
      : `${paths.length} archives`;
    set({
      mountStatus: { kind: 'mounting', filename, pct: 0 },
    });
  },

  mountComplete: (handle, archives, vfsEntries) => {
    set({
      mountHandle:   handle,
      archives,
      vfsEntries,
      searchResults: vfsEntries,
      mountStatus:   { kind: 'done' },
      search:        { text: '', mode: 'substring' },
      selectedEntryPath: null,
      selectedChain:     null,
    });
  },

  mountError: (filename, reason) => {
    set({ mountStatus: { kind: 'error', filename, reason } });
  },

  setSearch: (query, results) => {
    set((state) => ({
      search: { ...state.search, ...query },
      searchResults: results,
    }));
  },

  selectEntry: (path, chain) => {
    set({ selectedEntryPath: path, selectedChain: chain });
  },

  reset: () => {
    set({
      mountHandle:       null,
      archives:          [],
      vfsEntries:        [],
      mountStatus:       { kind: 'idle' },
      search:            { text: '', mode: 'substring' },
      searchResults:     [],
      selectedEntryPath: null,
      selectedChain:     null,
    });
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract basename from a filesystem path (cross-platform). */
export function basename(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path;
}
