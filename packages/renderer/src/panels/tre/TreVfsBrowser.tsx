/**
 * packages/renderer/src/panels/tre/TreVfsBrowser.tsx — TRE Virtual Filesystem Browser.
 *
 * Surface 1 of the Phase-1 UI: mount .tre archives, browse the shadow-resolved VFS,
 * search by path/name, and see which archive each file resolves from.
 *
 * Layout (top → bottom flex column on --color-surface):
 *   1. Mount toolbar: "Mount Archive…" + archive count chip + overflow ⋮
 *   2. Mounted archives list (priority order, highest first)
 *   3. VFS search field (substring/glob, debounced)
 *   4. VFS path tree (shadow-resolved, per-file override indicators)
 *   5. AsyncProgress bar (during mount)
 *
 * Source: 01-UI-SPEC.md § "Surface 1 — TRE Virtual-Filesystem Browser";
 *         01-CONTEXT.md D-06 (read-focused TRE VFS browser in the dockview shell).
 *
 * Path B addon access: require('@swg/native-core') directly (nodeIntegration:true).
 * Source: packages/renderer/src/shell/StatusBar.tsx:34-41.
 *
 * Copy (exact strings per UI-SPEC Copywriting Contract):
 *   CTA: "Mount Archive…"
 *   Empty heading: "No archive mounted"
 *   Empty body: "Mount Archive… to browse a .tre virtual filesystem"
 *   Search empty: "No files match \"{query}\"" + "Clear search"
 *
 * Accessibility Rule 5: aria-label + title on every icon-only control.
 */

import React, { useCallback } from 'react';
import { useTreStore, basename } from '../../state/treStore.ts';
import type { MountedArchive, VfsEntry, ShadowChainDisplay } from '../../state/treStore.ts';
import type { TreVersion } from '@swg/contracts';
import MountedArchivesList from './MountedArchivesList.tsx';
import VfsSearchField from './VfsSearchField.tsx';
import VfsTree from './VfsTree.tsx';
import AsyncProgress from '../../shared/AsyncProgress.tsx';

// Path B: require the addon directly (nodeIntegration:true in the renderer).
// Source: packages/renderer/src/shell/StatusBar.tsx:34-41.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  mountTreMount: (paths: string[], priorities: number[]) => string;
  resolveEntry: (handle: string, name: string) => {
    winner: string | null;
    tombstone: boolean;
    archiveIndex: number;
    entryIndex: number;
  };
  resolveChain: (handle: string, name: string) => {
    winner: string;
    shadows: string[];
    tombstone: boolean;
    winnerArchiveIndex: number;
    winnerEntryIndex: number;
  };
  searchMount: (handle: string, query: { text: string; mode: 'substring' | 'glob' }) => Array<{
    entryIndex: number;
    archiveIndex: number;
  }>;
  readMountEntry: (handle: string, archiveIndex: number, entryIndex: number) => ArrayBuffer;
  disposeTreMount: (handle: string) => void;
  mountSearchableAsync: (paths: string[], priorities: number[]) => Promise<string>;
  listEntries: (archiveIdx: number) => Array<{
    path: string;
    crc: number;
    uncompressedSize: number;
    compressedSize: number;
    offset: number;
    compressor: number;
    archiveIndex: number;
  }>;
  mountArchive: (paths: string[]) => Array<{
    archiveIndex: number;
    entryCount: number;
    path: string;
  }>;
};

// Version string helpers
function parseVersion(versionStr: string): TreVersion {
  // The native layer returns version strings like "v0005", "v0006", "v6000"
  if (['v0004', 'v0005', 'v0006', 'v5000', 'v6000'].includes(versionStr as TreVersion)) {
    return versionStr as TreVersion;
  }
  return 'v0005'; // fallback
}

export default function TreVfsBrowser(): React.ReactElement {
  const store = useTreStore();

  // ── Mount handler ───────────────────────────────────────────────────────────

  const handleMountClick = useCallback(async () => {
    // Open OS file picker for .tre files (Electron's dialog API)
    // In Electron with nodeIntegration=true, we can use the dialog module
    let filePaths: string[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dialog } = require('@electron/remote') as {
        dialog: { showOpenDialogSync: (opts: unknown) => string[] | undefined }
      };
      const result = dialog.showOpenDialogSync({
        title: 'Mount Archive…',
        filters: [{ name: 'TRE Archives', extensions: ['tre'] }],
        properties: ['openFile', 'multiSelections'],
      });
      filePaths = result ?? [];
    } catch {
      // Fallback: use a hidden file input (works in web context / without @electron/remote)
      filePaths = await pickFilesViaInput();
    }

    if (filePaths.length === 0) return;

    // Assign priorities: first file = lowest priority (1), last = highest (N)
    const priorities = filePaths.map((_, i) => i + 1);

    store.beginMount(filePaths, priorities);

    try {
      // Mount the archives asynchronously (off-main-thread via AsyncWorker)
      const handle = await nativeCore.mountSearchableAsync(filePaths, priorities);

      // Build the MountedArchive display list using the synchronous mountArchive for metadata
      // (mountSearchableAsync returns the handle; we use mountArchive for per-archive metadata)
      const mountResults = nativeCore.mountArchive(filePaths);
      const archives: MountedArchive[] = filePaths.map((path, i) => {
        const mountRes = mountResults.find((r) => r.path === path);
        const version = 'v0005' as TreVersion; // Default; will be updated from native version field
        return {
          path,
          filename: basename(path),
          version,
          entryCount: mountRes?.entryCount ?? 0,
          priority: priorities[i],
          isEnumerateOnly: false, // Will be set properly below
          archiveIndex: priorities[i] - 1, // In the native priority list
        };
      }).reverse(); // Highest priority first (last in array = highest priority)

      // Collect all VFS entries via search (empty query = all entries)
      const allHits = nativeCore.searchMount(handle, { text: '', mode: 'substring' });

      // Build VfsEntry list
      const vfsEntries: VfsEntry[] = buildVfsEntries(handle, allHits, archives);

      store.mountComplete(handle, archives, vfsEntries);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const filename = filePaths.length === 1 ? basename(filePaths[0]) : `${filePaths.length} archives`;
      store.mountError(filename, reason);
    }
  }, [store]);

  // ── Search handler ──────────────────────────────────────────────────────────

  const handleSearch = useCallback(
    (text: string, mode: 'substring' | 'glob') => {
      const { mountHandle, vfsEntries } = store;
      if (!mountHandle) return;

      if (!text) {
        store.setSearch({ text, mode }, vfsEntries);
        return;
      }

      const hits = nativeCore.searchMount(mountHandle, { text, mode });
      const hitSet = new Set(hits.map((h) => `${h.archiveIndex}:${h.entryIndex}`));

      const filtered = vfsEntries.filter((entry) =>
        hitSet.has(`${entry.archiveIndex}:${entry.entryIndex}`)
      );

      store.setSearch({ text, mode }, filtered);
    },
    [store],
  );

  // ── Entry select handler ────────────────────────────────────────────────────

  const handleSelectEntry = useCallback(
    (entry: VfsEntry, _chain: ShadowChainDisplay | null) => {
      const { mountHandle, archives } = store;
      if (!mountHandle) return;

      // Build shadow chain from native resolveChain
      let chain: ShadowChainDisplay | null = null;
      try {
        const native = nativeCore.resolveChain(mountHandle, entry.path);
        if (native.winner || native.tombstone) {
          const winnerArc = archives.find((a) => a.path === native.winner);
          chain = {
            winner: {
              path: native.winner,
              filename: basename(native.winner),
            },
            tombstone: native.tombstone,
            shadows: native.shadows.map((s: string) => ({
              path: s,
              filename: basename(s),
            })),
          };
          // Suppress chain detail if no shadows (single archive)
          if (chain.shadows.length === 0 && !chain.tombstone) chain = null;
          void winnerArc; // suppress unused var warning
        }
      } catch {
        chain = null;
      }

      store.selectEntry(entry.path, chain);
    },
    [store],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const { archives, mountStatus, searchResults, vfsEntries, selectedEntryPath, selectedChain, search } = store;
  const isMounting = mountStatus.kind === 'mounting';
  const hasArchives = archives.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
      }}
    >
      {/* Mount toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-header)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        {/* Mount Archive… button */}
        <button
          aria-label="Mount archive"
          title="Mount archive"
          onClick={() => void handleMountClick()}
          disabled={isMounting}
          style={{
            background: 'var(--color-accent-dim)',
            border: '1px solid var(--color-accent-line)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-accent)',
            cursor: isMounting ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            padding: 'var(--space-1) var(--space-3)',
            opacity: isMounting ? 0.5 : 1,
          }}
        >
          Mount Archive…
        </button>

        {/* Archive count chip */}
        {hasArchives && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-faint)',
            }}
          >
            {archives.length} archive{archives.length !== 1 ? 's' : ''}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Mount options overflow */}
        {/* Accessibility Rule 5: aria-label + title */}
        <button
          aria-label="Mount options"
          title="Mount options"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-faint)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-sm)',
            padding: 0,
          }}
          onClick={() => { /* Future: unmount / reorder menu */ }}
        >
          ⋮
        </button>
      </div>

      {/* Mounting progress (replaces tree area) */}
      {isMounting && mountStatus.kind === 'mounting' && (
        <AsyncProgress
          caption={`Mounting ${mountStatus.filename} · ${mountStatus.pct}%`}
          pct={mountStatus.pct}
          cancelLabel="Cancel mount"
          onCancel={() => store.reset()}
        />
      )}

      {/* Empty state */}
      {!isMounting && !hasArchives && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-4)',
            textAlign: 'center',
          }}
        >
          {/* Copy: exact strings from UI-SPEC Copywriting Contract */}
          <span
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            No archive mounted
          </span>
          <span
            style={{
              color: 'var(--color-text-faint)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Mount Archive… to browse a .tre virtual filesystem
          </span>
        </div>
      )}

      {/* Mount error state */}
      {mountStatus.kind === 'error' && (
        <div
          style={{
            padding: 'var(--space-4)',
            background: 'rgba(224, 88, 79, 0.08)',
            borderLeft: '3px solid var(--color-danger)',
            margin: 'var(--space-2)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <div
            style={{
              color: 'var(--color-danger)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
            }}
          >
            Could not mount {mountStatus.filename}
          </div>
          <div
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-sans)',
              marginTop: 'var(--space-1)',
            }}
          >
            {mountStatus.reason}
          </div>
          <button
            onClick={() => store.reset()}
            style={{
              marginTop: 'var(--space-2)',
              background: 'transparent',
              border: '1px solid var(--color-border-soft)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-xs)',
              padding: 'var(--space-1) var(--space-2)',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Archives + search + tree (shown when mounted) */}
      {hasArchives && !isMounting && (
        <>
          {/* Mounted archives list */}
          <MountedArchivesList archives={archives} />

          {/* Search field */}
          <VfsSearchField
            onSearch={handleSearch}
            matchCount={search.text ? searchResults.length : vfsEntries.length}
          />

          {/* Search empty state */}
          {search.text && searchResults.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-4)',
                textAlign: 'center',
              }}
            >
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                {`No files match "${search.text}"`}
              </span>
              <button
                onClick={() => handleSearch('', search.mode)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-accent)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-sans)',
                  textDecoration: 'underline',
                }}
              >
                Clear search
              </button>
            </div>
          ) : (
            /* VFS tree */
            <VfsTree
              entries={search.text ? searchResults : vfsEntries}
              archives={archives}
              selectedPath={selectedEntryPath}
              selectedChain={selectedChain}
              onSelect={handleSelectEntry}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build VfsEntry list from native search hits.
 * Each hit has {entryIndex, archiveIndex}; we look up paths from the mount.
 */
function buildVfsEntries(
  handle: string,
  hits: Array<{ entryIndex: number; archiveIndex: number }>,
  archives: MountedArchive[],
): VfsEntry[] {
  const entries: VfsEntry[] = [];
  const pathToShadowCount = new Map<string, number>();

  // First pass: count shadows per path
  const pathToArchives = new Map<string, string[]>();
  for (const hit of hits) {
    try {
      const resolved = nativeCore.resolveEntry(handle, getPathFromHit(handle, hit));
      if (resolved.winner) {
        const path = getPathFromHit(handle, hit);
        if (!pathToArchives.has(path)) pathToArchives.set(path, []);
        pathToArchives.get(path)!.push(resolved.winner);
      }
    } catch {
      // skip
    }
  }

  // Second pass: build entries (de-duplicated by path, taking the winner)
  const seenPaths = new Set<string>();

  for (const hit of hits) {
    const entryPath = getPathFromHit(handle, hit);
    if (!entryPath || seenPaths.has(entryPath)) continue;
    seenPaths.add(entryPath);

    let resolved: { winner: string | null; tombstone: boolean; archiveIndex: number; entryIndex: number };
    try {
      resolved = nativeCore.resolveEntry(handle, entryPath);
    } catch {
      continue;
    }

    if (!resolved.winner && !resolved.tombstone) continue;

    const winnerArc = archives.find((a) => a.path === resolved.winner);
    const arcList = pathToArchives.get(entryPath) ?? [];
    const shadowCount = Math.max(0, arcList.length - 1);
    pathToShadowCount.set(entryPath, shadowCount);

    const segments = entryPath.split('/');
    const name = segments[segments.length - 1] ?? entryPath;

    entries.push({
      path: entryPath,
      name,
      segments,
      winnerArchivePath: resolved.winner ?? '',
      winnerArchiveFilename: resolved.winner ? basename(resolved.winner) : '',
      isOverride: shadowCount > 0,
      isTombstone: resolved.tombstone,
      shadowCount,
      archiveIndex: resolved.archiveIndex,
      entryIndex: resolved.entryIndex,
    });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Get the file path for a search hit.
 * We need to list entries for the archive to get the path.
 * This is a helper that uses listEntries from the synchronous Plan-01-01 binding.
 */
const _pathCache = new Map<string, string>();

function getPathFromHit(
  _handle: string,
  hit: { entryIndex: number; archiveIndex: number },
): string {
  const cacheKey = `${hit.archiveIndex}:${hit.entryIndex}`;
  if (_pathCache.has(cacheKey)) return _pathCache.get(cacheKey)!;

  try {
    const entries = nativeCore.listEntries(hit.archiveIndex);
    if (entries[hit.entryIndex]) {
      const path = entries[hit.entryIndex].path;
      _pathCache.set(cacheKey, path);
      return path;
    }
  } catch {
    // fallback
  }
  return '';
}

/**
 * Fallback file picker using a hidden input element.
 * Used when @electron/remote is not available.
 */
function pickFilesViaInput(): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tre';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      document.body.removeChild(input);
      // Note: File.path is Electron-specific (provides the filesystem path)
      resolve(files.map((f) => (f as unknown as { path: string }).path ?? f.name));
    };

    input.oncancel = () => {
      document.body.removeChild(input);
      resolve([]);
    };

    input.click();
  });
}
