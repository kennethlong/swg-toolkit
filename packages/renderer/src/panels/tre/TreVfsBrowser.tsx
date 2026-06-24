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
import { useIffStore } from '../../state/iffStore.ts';
import type { IffParseResult } from '../../state/iffStore.ts';
import { useViewportStore } from '../../state/viewportStore.ts';
import { resolveAppearance } from '../viewport/resolver/appearanceResolver.js';
import MountedArchivesList from './MountedArchivesList.tsx';
import VfsSearchField from './VfsSearchField.tsx';
import VfsTree from './VfsTree.tsx';
import AsyncProgress from '../../shared/AsyncProgress.tsx';

// Path B: require the addon directly (nodeIntegration:true in the renderer).
// Source: packages/renderer/src/shell/StatusBar.tsx:34-41.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  resolveChain: (handle: string, name: string) => {
    winner: string;
    shadows: string[];
    tombstone: boolean;
    winnerArchiveIndex: number;
    winnerEntryIndex: number;
  };
  readMountEntry: (handle: string, archiveIndex: number, entryIndex: number) => ArrayBuffer;
  disposeTreMount: (handle: string) => void;
  mountSearchableAsync: (paths: string[], priorities: number[]) => Promise<string>;
  getMountArchives: (handle: string) => Array<{
    path: string;
    version: string;
    enumerateOnly: boolean;
    entryCount: number;
    priority: number;
    archiveIndex: number;
  }>;
  /**
   * Returns the deduplicated VFS as a compact binary columnar ArrayBuffer.
   * Decoded by decodeMountEntriesColumnar() below — see TreMount.h for binary layout.
   * Replaces listMountEntries() to eliminate ~1.5M Napi::Set() calls on mount.
   * Source: perf fix, tre-mount-perf-marshalling.md issue #1 (2026-06-24).
   */
  getMountEntriesColumnar: (handle: string) => ArrayBuffer;
  parseIff: (bytes: ArrayBuffer | Uint8Array) => {
    roots: unknown[];
    trailingBytes: { offset: number; count: number } | null;
    roundTrip: { passed: boolean; failOffset?: number };
  };
};

// Version string helper: map the native version string onto the TreVersion union.
function parseVersion(versionStr: string): TreVersion {
  // The native layer returns version strings like "v0005", "v0006", "v6000".
  if (['v0004', 'v0005', 'v0006', 'v5000', 'v6000'].includes(versionStr as TreVersion)) {
    return versionStr as TreVersion;
  }
  return 'v0005'; // fallback (should not happen — native always returns a known string)
}

/** File extensions that trigger the appearance resolver + viewport. */
const MESH_EXTENSIONS = new Set(['msh', 'mgn', 'sat', 'apt']);

export default function TreVfsBrowser(): React.ReactElement {
  const store = useTreStore();
  const iffStore = useIffStore();
  const viewportStore = useViewportStore();

  // ── Mount handler ───────────────────────────────────────────────────────────

  const handleMountClick = useCallback(async () => {
    // Open the native OS file picker for .tre files via the main process.
    // Path B (nodeIntegration:true) lets the renderer require('electron') directly,
    // but `dialog` is main-process-only — we invoke an ipcMain handler instead of
    // pulling in @electron/remote (forbidden new dependency this phase, T-01-SC).
    // The hidden-<input> fallback can only return real paths via File.path, which
    // Electron 32+ removed, so the native dialog is the only reliable path source.
    let filePaths: string[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ipcRenderer } = require('electron') as {
        ipcRenderer: { invoke: (channel: string) => Promise<string[]> }
      };
      filePaths = await ipcRenderer.invoke('tre:pick-archives');
    } catch {
      // Last-resort fallback (e.g. plain web context with no Electron): hidden input.
      filePaths = await pickFilesViaInput();
    }

    if (filePaths.length === 0) return;

    // Assign priorities: first file = lowest priority (1), last = highest (N)
    const priorities = filePaths.map((_, i) => i + 1);

    store.beginMount(filePaths, priorities);

    try {
      // Mount the archives asynchronously (off-main-thread via AsyncWorker).
      const handle = await nativeCore.mountSearchableAsync(filePaths, priorities);

      // Build the MountedArchive list from native truth, in the mount's priority-sorted
      // index space (getMountArchives returns highest-priority first — same space as
      // resolveChain hits). version + enumerateOnly come straight from the native layer.
      const archives: MountedArchive[] = nativeCore.getMountArchives(handle).map((a) => ({
        path: a.path,
        filename: basename(a.path),
        version: parseVersion(a.version),
        entryCount: a.entryCount,
        priority: a.priority,
        isEnumerateOnly: a.enumerateOnly,
        archiveIndex: a.archiveIndex,
      }));

      // Build the VFS entry list from the native columnar blob (perf fix).
      // ONE ArrayBuffer crosses the N-API bridge instead of ~250k Napi::Object instances.
      // The blob was built inside the async worker (off main thread) during mountSearchableAsync.
      // Source: perf fix, tre-mount-perf-marshalling.md issue #1 (2026-06-24).
      const columnarBlob = nativeCore.getMountEntriesColumnar(handle);
      const vfsEntries: VfsEntry[] = decodeMountEntriesColumnar(columnarBlob);

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

      // Filter the already-loaded VFS entries in JS (case-insensitive over the path).
      // We no longer call searchMount: its archive/entry index space does not match the
      // shadow-resolved VFS, and the full path list is already in memory after mount.
      const lower = text.toLowerCase();
      const matcher = mode === 'glob' ? makeGlobMatcher(lower) : null;
      const filtered = vfsEntries.filter((entry) => {
        const p = entry.path.toLowerCase();
        return matcher ? matcher(p) : p.includes(lower);
      });

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

      // Attempt to extract and parse the selected file as IFF.
      // If extraction succeeds and the file has an IFF FORM header, parse it.
      // (D-08: read-only; the write path is proven by the harness, not the UI.)
      // Note: mountHandle is already destructured above and verified non-null.
      if (mountHandle) {
        const winnerResult = nativeCore.resolveChain(mountHandle, entry.path);
        if (winnerResult.winner && !winnerResult.tombstone &&
            winnerResult.winnerArchiveIndex >= 0 && winnerResult.winnerEntryIndex >= 0) {
          const filename = entry.name;

          // ── IFF parse (always, for the IFF Structure panel) ────────────────
          iffStore.beginParse(filename);
          try {
            const bytes = nativeCore.readMountEntry(
              mountHandle,
              winnerResult.winnerArchiveIndex,
              winnerResult.winnerEntryIndex,
            );
            // Try to parse as IFF — if it fails, show a clean parse error.
            try {
              const raw = nativeCore.parseIff(bytes);
              // Convert from native types to contract types.
              const result: IffParseResult = {
                roots: raw.roots as IffParseResult['roots'],
                trailingBytes: raw.trailingBytes,
                roundTrip: raw.roundTrip,
              };
              iffStore.parseComplete(filename, result, bytes);
            } catch (iffErr) {
              const reason = iffErr instanceof Error ? iffErr.message : String(iffErr);
              // Extract offset from "@ 0x..." in the error message if present.
              const m = /0x([0-9A-Fa-f]+)/.exec(reason);
              const offset = m ? parseInt(m[1], 16) : undefined;
              iffStore.parseError(filename, reason, offset);
            }
          } catch (readErr) {
            const reason = readErr instanceof Error ? readErr.message : String(readErr);
            iffStore.parseError(filename, `could not read file — ${reason}`);
          }

          // ── Viewport resolver (mesh-like extensions only) ──────────────────
          // .msh / .mgn / .sat / .apt: drive idle→loading→done pipeline so
          // the R3F viewport renders the mesh (PRIMARY gap-closure fix).
          const ext = filename.split('.').pop()?.toLowerCase() ?? '';
          if (MESH_EXTENSIONS.has(ext)) {
            viewportStore.beginLoad(
              filename,
              mountHandle,
              winnerResult.winnerArchiveIndex,
              winnerResult.winnerEntryIndex,
              entry.path,
            );
            // Resolve async; never throw (D-04 partial resolution).
            void resolveAppearance(mountHandle, entry.path).then((resolution) => {
              // Pull the first non-null parsed mesh + skeleton from the resolution result.
              const firstMesh = resolution.meshes.find((m) => m !== null) ?? null;
              const parsedMesh = firstMesh?.parseResult ?? null;
              const parsedSkeleton = resolution.skeleton?.parseResult ?? null;
              viewportStore.loadComplete(
                filename,
                resolution.mode,
                resolution,
                resolution.isSkinned,
                parsedMesh,
                parsedSkeleton,
              );
            }).catch((err) => {
              const reason = err instanceof Error ? err.message : String(err);
              viewportStore.loadError(filename, reason);
            });
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, iffStore, viewportStore],
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
 * Decode the compact binary columnar blob returned by getMountEntriesColumnar().
 *
 * Binary layout (all LE) — mirrors TreMountColumnar in TreMount.h:
 *   Header (32 bytes):
 *     [0]   uint32 entryCount
 *     [4]   uint32 nameDataOffset
 *     [8]   uint32 nameDataSize
 *     [12]  uint32 archPathDataOffset
 *     [16]  uint32 archPathDataSize
 *     [20]  uint32 arrayOffset          (= 32)
 *     [24]  uint32[2] reserved
 *
 *   Per-entry arrays at arrayOffset (each entryCount elements):
 *     uint32 nameOffsets[n]
 *     uint32 archPathOffsets[n]
 *     int32  winnerArchiveIndices[n]
 *     int32  shadowCounts[n]
 *     uint8  flags[n]  (bit0=isOverride, bit1=isTombstone)
 *
 *   nameData:     packed null-terminated UTF-8 entry names
 *   archPathData: packed null-terminated UTF-8 archive paths
 *
 * Decoder never builds intermediate objects for out-of-viewport rows — strings are
 * decoded only for the rows we construct here (one pass, then JS owns them).
 *
 * Source: perf fix, tre-mount-perf-marshalling.md issue #1 (2026-06-24).
 */
function decodeMountEntriesColumnar(blob: ArrayBuffer): VfsEntry[] {
  const buf = new DataView(blob);
  const u8  = new Uint8Array(blob);

  // ── Read header ────────────────────────────────────────────────────────────
  const entryCount        = buf.getUint32(0,  true);
  const nameDataOffset    = buf.getUint32(4,  true);
  const archPathDataOffset= buf.getUint32(12, true);
  const arrayOffset       = buf.getUint32(20, true);

  if (entryCount === 0) return [];

  // ── Locate per-entry typed arrays ──────────────────────────────────────────
  const nameOffBase   = arrayOffset;
  const archOffBase   = nameOffBase    + entryCount * 4;
  const winnerBase    = archOffBase    + entryCount * 4;
  const shadowBase    = winnerBase     + entryCount * 4;
  const flagsBase     = shadowBase     + entryCount * 4;

  // ── TextDecoder for null-terminated strings ────────────────────────────────
  const decoder = new TextDecoder('utf-8');

  function readCStr(dataOffset: number, relativeOffset: number): string {
    // Find the null terminator
    let end = dataOffset + relativeOffset;
    while (end < u8.length && u8[end] !== 0) end++;
    return decoder.decode(u8.subarray(dataOffset + relativeOffset, end));
  }

  // ── Decode all entries ─────────────────────────────────────────────────────
  const result: VfsEntry[] = new Array(entryCount);
  for (let i = 0; i < entryCount; i++) {
    const nameRelOff        = buf.getUint32(nameOffBase + i * 4,  true);
    const archRelOff        = buf.getUint32(archOffBase + i * 4,  true);
    const winnerArchiveIndex= buf.getInt32( winnerBase  + i * 4,  true);
    const shadowCount       = buf.getInt32( shadowBase  + i * 4,  true);
    const flags             = u8[flagsBase + i];
    const isOverride        = (flags & 0x01) !== 0;
    const isTombstone       = (flags & 0x02) !== 0;

    const path              = readCStr(nameDataOffset,     nameRelOff);
    const winnerArchivePath = readCStr(archPathDataOffset, archRelOff);

    const segments = path.split('/');
    result[i] = {
      path,
      name: segments[segments.length - 1] ?? path,
      segments,
      winnerArchivePath,
      winnerArchiveFilename: basename(winnerArchivePath),
      isOverride,
      isTombstone,
      shadowCount,
      winnerArchiveIndex,
    };
  }
  return result;
}

/**
 * Build a glob matcher for the VFS search (* = any sequence, ? = single char).
 * Operates on the lowercased path; the pattern is already lowercased by the caller.
 * Mirrors the native globMatch semantics (TreMount.cpp) for parity.
 */
function makeGlobMatcher(pattern: string): (text: string) => boolean {
  // Escape regex metachars except * and ?, then translate the glob wildcards.
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  const compiled = new RegExp(`^${re}$`);
  return (text: string) => compiled.test(text);
}

/**
 * Fallback file picker using a hidden input element.
 * Last-resort fallback for a non-Electron (plain web) context where the
 * 'tre:pick-archives' IPC channel and a real OS dialog are unavailable.
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
