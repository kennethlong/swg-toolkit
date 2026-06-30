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

import React, { useCallback, useRef, useState } from 'react';
import { useTreStore, basename } from '../../state/treStore.ts';
import type { MountedArchive, VfsEntry, ShadowChainDisplay } from '../../state/treStore.ts';
import { mountTrePaths } from '../../services/treMount';
import type { TypedIpcRenderer } from '@swg/contracts';
import { useIffStore } from '../../state/iffStore.ts';
import type { IffParseResult } from '../../state/iffStore.ts';
import { useViewportStore } from '../../state/viewportStore.ts';
import type { ViewportStore } from '../../state/viewportStore.ts';
import { resolveAppearance } from '../viewport/resolver/appearanceResolver.js';
import MountedArchivesList from './MountedArchivesList.tsx';
import VfsSearchField from './VfsSearchField.tsx';
import VfsTree from './VfsTree.tsx';
import AsyncProgress from '../../shared/AsyncProgress.tsx';
import ProjectBindingBar from '../deploy/ProjectBindingBar.tsx';
import NewProjectWizard from '../deploy/NewProjectWizard.tsx';
import WorkspaceEntry from '../deploy/WorkspaceEntry.tsx';
import { useStagingStore } from '../../state/stagingStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { isVirtualPathSafe } from '../../services/pathSafety';

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
   * Decoded by decodeMountEntriesColumnar() in treMount.ts — see TreMount.h for binary layout.
   * Replaces listMountEntries() to eliminate ~1.5M Napi::Set() calls on mount.
   * Source: perf fix, tre-mount-perf-marshalling.md issue #1 (2026-06-24).
   */
  getMountEntriesColumnar: (handle: string) => ArrayBuffer;
  parseIff: (bytes: ArrayBuffer | Uint8Array) => {
    roots: unknown[];
    trailingBytes: { offset: number; count: number } | null;
    roundTrip: { passed: boolean; failOffset?: number };
  };
  /** Parse a .ans animation (CKAT/KFAT). Returns null/KFAT-0002-unsupported for legacy. */
  parseAnimation: (iff: unknown, bytes: ArrayBuffer | Uint8Array) => ViewportStore['parsedAnimation'];
  /** Substring/glob search across all VFS entries. Returns {entryIndex, archiveIndex} objects. */
  searchMount: (handle: string, query: { text: string; mode: 'substring' | 'glob' }) => Array<{ entryIndex: number; archiveIndex: number }>;
  /** List all entries in a single archive. */
  listMountEntries: (handle: string, archiveIndex: number) => Array<{ path: string }>;
};

// Path B Node access (nodeIntegration:true) — used by Extract→Add to materialize the
// selected TRE entry's bytes to a temp file so the seal/pack pipeline (which reads from
// replacementFilePath on disk) has a byte source. Lazy require(), never bundled by Vite.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs   = require('fs')   as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeOs   = require('os')   as typeof import('os');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require('path') as typeof import('path');

/** File extensions that trigger the appearance resolver + viewport. */
const MESH_EXTENSIONS = new Set(['msh', 'mgn', 'sat', 'apt']);

export default function TreVfsBrowser(): React.ReactElement {
  const store = useTreStore();
  const iffStore = useIffStore();
  const viewportStore = useViewportStore();

  // ── New-project wizard state ─────────────────────────────────────────────────
  const [wizardOpen, setWizardOpen] = useState(false);

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
      // TypedIpcRenderer from @swg/contracts enforces channel type at compile time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ipcRenderer } = require('electron') as { ipcRenderer: TypedIpcRenderer };
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
      // Delegate to the shared mount routine (extracts archives + decodes columnar VFS
      // blob + calls store.mountComplete). Extracted into treMount.ts so that
      // projectBinding.initProject can reuse it for auto-mount without duplication.
      // Source: 04.1-02-PLAN.md Task 2 (H3 fix).
      await mountTrePaths(filePaths, priorities);
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

              // ── Populate ansPickerOptions from VFS heuristic (D-08 animation picker) ──
              // When a skeleton resolves, search the TRE VFS for .ans files whose name prefix
              // matches the skeleton (heuristic fallback — a full .lat parser is out of scope).
              // The LATX → .lat → .ans chain would be authoritative; this is a documented
              // heuristic that covers the common naming convention (e.g. 4lom.skt → 4lom_*.ans).
              if (resolution.skeleton) {
                const sktPath = resolution.skeleton.path;
                // Extract the base name without extension (e.g. "4lom" from ".../4lom.skt")
                const sktBase = sktPath.split('/').pop()?.replace(/\.skt$/i, '') ?? '';
                if (sktBase) {
                  // Filter the already-decoded VFS entry list IN JS — the same approach as
                  // handleSearch (above). Do NOT use searchMount + listMountEntries here:
                  // listMountEntries materializes an ENTIRE archive's entries as N-API objects,
                  // and it was being called once PER search hit. On a broad substring match over
                  // ~245k entries that is a synchronous, main-thread O(hits × archiveSize) blowup
                  // — the hard UI freeze on skinned loads (this block only runs when a skeleton
                  // resolves, i.e. skinned only; static loads skip it, which is why they worked).
                  // searchMount's index space also doesn't match the VFS (see handleSearch note).
                  const base = sktBase.toLowerCase();
                  const ansPaths: string[] = [];
                  const seen = new Set<string>();
                  for (const e of store.vfsEntries) {
                    const lower = e.path.toLowerCase();
                    if (lower.endsWith('.ans') && lower.includes(base) && !seen.has(e.path)) {
                      seen.add(e.path);
                      ansPaths.push(e.path);
                    }
                  }
                  if (ansPaths.length > 0) {
                    viewportStore.setAnsPickerOptions(ansPaths);
                  }
                }
              }
            }).catch((err) => {
              const reason = err instanceof Error ? err.message : String(err);
              viewportStore.loadError(filename, reason);
            });
          } else if (ext === 'ans') {
            // Click-to-play: a .ans has no mesh of its own — it animates whatever skinned
            // model is already loaded. If a skeleton is loaded, parse the animation and apply
            // it (mirrors the AnimationTransport dropdown). Otherwise no-op (nothing to drive).
            // Read live store state (getState) to avoid a stale-closure parsedSkeleton.
            const vp = useViewportStore.getState();
            if (vp.parsedSkeleton) {
              try {
                const ansBytes = nativeCore.readMountEntry(
                  mountHandle,
                  winnerResult.winnerArchiveIndex,
                  winnerResult.winnerEntryIndex,
                );
                const u8 = new Uint8Array(ansBytes);
                const iff = nativeCore.parseIff(u8);
                const anim = nativeCore.parseAnimation(iff, u8);
                // KFAT-0002 is unsupported legacy Euler — keep bind pose, don't apply.
                if (anim && anim.variant !== 'KFAT-0002-unsupported') {
                  vp.setParsedAnimation(anim);
                }
              } catch {
                // Non-fatal: malformed/unsupported .ans leaves the current animation as-is.
              }
            }
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, iffStore, viewportStore],
  );

  // ── Extract→Add handler (plan 08 — DEPLOY-07) ────────────────────────────────
  //
  // Derives the virtual path DIRECTLY from the VFS entry's path — NO VirtualPathModal prompt.
  // Validates through the shared isVirtualPathSafe (M1) before calling stagingStore.addEntry.
  // The store's addEntry also validates (belt-and-suspenders), so the check here provides
  // an inline error message in the browser rather than silently rejecting.

  const handleExtract = useCallback((entry: VfsEntry) => {
    const vpath = entry.path;

    // M1: validate derived virtual path before adding to staging (T-04.1-19)
    if (!isVirtualPathSafe(vpath)) {
      console.warn('[TreVfsBrowser] Extract→Add rejected unsafe derived path:', vpath);
      return; // invalid path — show inline invalid-path message in the row (defensive)
    }

    // The seal/pack pipeline reads entry bytes from replacementFilePath on disk, so an
    // Extract→Add (sourced from the mounted TRE, not a loose file) MUST be materialized to
    // a temp file here. Without it the entry flattens back with replacementFilePath:undefined
    // and packPatch throws "path argument must be of type string … Received undefined".
    try {
      let bytes: Buffer;

      // Loose-overlay entries (injected from a client searchPath override dir by
      // injectLooseDirOverlay) live on disk and are NOT in the native TRE mount index
      // (winnerArchiveIndex === -1). Read the winner file directly — resolveChain/readMountEntry
      // only know TRE-archived entries and return "not resolvable" for loose files.
      if (entry.winnerArchiveIndex < 0) {
        if (!entry.winnerArchivePath) {
          console.warn('[TreVfsBrowser] Extract→Add: loose entry has no winnerArchivePath:', vpath);
          return;
        }
        bytes = nodeFs.readFileSync(entry.winnerArchivePath);
      } else {
        const mountHandle = store.mountHandle;
        if (!mountHandle) {
          console.warn('[TreVfsBrowser] Extract→Add: no mount handle');
          return;
        }
        const chain = nativeCore.resolveChain(mountHandle, vpath);
        if (!chain.winner || chain.tombstone ||
            chain.winnerArchiveIndex < 0 || chain.winnerEntryIndex < 0) {
          console.warn('[TreVfsBrowser] Extract→Add: entry not resolvable in mount:', vpath);
          return;
        }
        bytes = Buffer.from(nativeCore.readMountEntry(mountHandle, chain.winnerArchiveIndex, chain.winnerEntryIndex));
      }

      const tmpDir   = nodePath.join(nodeOs.tmpdir(), 'swg-toolkit-extract');
      nodeFs.mkdirSync(tmpDir, { recursive: true });
      const safeName = vpath.replace(/[\\/:*?"<>|]/g, '_');
      const tmpPath  = nodePath.join(tmpDir, `${Date.now()}-${safeName}`);
      nodeFs.writeFileSync(tmpPath, bytes);

      // Add to staging store directly — no VirtualPathModal prompt (DEPLOY-07).
      // Action is 'add': an Extract→Add is a copy of the base bytes (unchanged). It only
      // becomes 'changed' (modify) once an editor actually edits the staged file.
      useStagingStore.getState().addEntry({
        virtualPath:         vpath,
        action:              'add',
        replacementFilePath: tmpPath,
      });

      // Visible feedback: bring the Deploy panel to the front and flash the new row so
      // Extract→Add doesn't look like a no-op.
      useStagingStore.getState().flashEntry(vpath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__activatePanel?.('deploy');
    } catch (err) {
      console.error('[TreVfsBrowser] Extract→Add failed:', err);
    }
  }, [store]);

  // ── Splitter (archives region ↔ file list region) ──────────────────────────

  /**
   * Height of the mounted-archives region in pixels.
   * Default 180px (~6 rows at ~30px/row); clamped to [64px, 60% of panel].
   * Persists for the lifetime of the component (session state — no localStorage needed).
   */
  const [archivesHeight, setArchivesHeight] = useState(180);

  /**
   * Ref for the outer panel div — used to compute the 60% max clamp during drag.
   * Must be on the flex-column container so clientHeight gives the full panel height.
   */
  const panelRef = useRef<HTMLDivElement>(null);

  const handleSplitterMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();

      const startY = e.clientY;
      const startHeight = archivesHeight;
      const panel = panelRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        const panelH = panel ? panel.clientHeight : 800;
        const maxH = Math.floor(panelH * 0.6);
        const clamped = Math.max(64, Math.min(maxH, startHeight + delta));
        setArchivesHeight(clamped);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [archivesHeight],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const { archives, mountStatus, searchResults, vfsEntries, selectedEntryPath, selectedChain, search } = store;
  const isMounting = mountStatus.kind === 'mounting';
  const hasArchives = archives.length > 0;
  // First-run / empty state (sketch 007-B): when no project is open the Assets-panel
  // body becomes the welcome takeover (WorkspaceEntry) — recent projects + detected
  // clients + New/Open/Mount — instead of the bare "No archive mounted" hint. The
  // panel-head (ProjectBindingBar) stays. Once a project is open we fall back to the
  // normal mounted/empty TRE-browser body.
  const workspaceReady = useWorkspaceStore((s) => s.status.kind === 'ready');
  // Welcome takeover is active when no project is open and nothing is mounted/mounting.
  // In that state the ProjectBindingBar (＋ Project ▾ / Mount) is suppressed so the panel
  // shows ONE header (the dockview "Welcome" tab) — the welcome body carries the actions.
  const welcomeMode = !isMounting && !hasArchives && !workspaceReady;

  return (
    <div
      ref={panelRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
      }}
    >
      {/* ── Assets panel-head: ＋ Project ▾ + Mount Archive… + bound-client chip ── */}
      {/* ProjectBindingBar replaces the previous mount toolbar, incorporating     */}
      {/* Mount Archive… so no functionality is lost (04.1-04-PLAN.md Task 1).    */}
      {/* Suppressed in welcome mode so the welcome takeover owns the single head. */}
      {!welcomeMode && (
        <ProjectBindingBar
          onNewProject={() => setWizardOpen(true)}
          onMount={() => void handleMountClick()}
          archiveCount={archives.length}
        />
      )}

      {/* New-project wizard (modal overlay) */}
      {wizardOpen && (
        <NewProjectWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {/* Mounting progress (replaces tree area) */}
      {isMounting && mountStatus.kind === 'mounting' && (
        <AsyncProgress
          caption={`Mounting ${mountStatus.filename} · ${mountStatus.pct}%`}
          pct={mountStatus.pct}
          cancelLabel="Cancel mount"
          onCancel={() => store.reset()}
        />
      )}

      {/* First-run welcome takeover — no project open (sketch 007-B) */}
      {welcomeMode && (
        <WorkspaceEntry
          onNewProject={() => setWizardOpen(true)}
          onMount={() => void handleMountClick()}
        />
      )}

      {/* Empty state — project open but nothing mounted */}
      {!isMounting && !hasArchives && workspaceReady && (
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
          {/* ── Mounted archives region: bounded + scrollable ─────────────── */}
          {/*
           * Height is controlled by the draggable splitter below.
           * flexShrink:0 prevents the flex column from shrinking this region
           * when the panel is too short — scrolling handles overflow instead.
           */}
          <div
            style={{
              height: archivesHeight,
              flexShrink: 0,
              overflowY: 'auto',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <MountedArchivesList archives={archives} />
          </div>

          {/* ── Draggable splitter ────────────────────────────────────────── */}
          {/*
           * A 5px grab handle between the archives and the file-list regions.
           * Pointer events track the drag; clamped to [64px, 60% of panel].
           * cursor:row-resize signals the resize intent per UI convention.
           */}
          <div
            role="separator"
            aria-label="Resize archives / file list"
            title="Drag to resize"
            onMouseDown={handleSplitterMouseDown}
            style={{
              height: 5,
              flexShrink: 0,
              cursor: 'row-resize',
              background: 'var(--color-border)',
              borderTop: '1px solid var(--color-border-soft)',
              borderBottom: '1px solid var(--color-border-soft)',
              transition: 'background 0.1s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--color-accent-line)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--color-border)';
            }}
          />

          {/* ── File list region: search + tree, takes remaining space ───── */}
          {/*
           * flex:1 + minHeight:0 is the critical pair that makes a flex child
           * scroll instead of expanding the parent container beyond its bounds.
           * VfsSearchField is flexShrink:0 (already set in VfsSearchField.tsx)
           * so it is always visible above the tree.
           */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Search field — always visible, never scrolls away */}
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
              /* VFS tree — flex:1 + minHeight:0 makes it scroll independently */
              <VfsTree
                entries={search.text ? searchResults : vfsEntries}
                archives={archives}
                selectedPath={selectedEntryPath}
                selectedChain={selectedChain}
                onSelect={handleSelectEntry}
                onExtract={handleExtract}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
