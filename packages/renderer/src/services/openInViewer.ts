/**
 * packages/renderer/src/services/openInViewer.ts
 * Type-aware "open in viewer/editor" dispatcher for a staged item.
 *
 * Routes by file type to the right surface:
 *   - mesh (.msh/.mgn/.sat/.apt) → 3D viewport
 *   - everything else            → IFF Structure (Data panel)
 *
 * EXTENSION POINT: as type-specific editors land (client effects, sounds, datatables, …)
 * add a branch here keyed on the extension, so right-click → Open routes a staged item to
 * its editor the same way meshes route to the viewport today.
 *
 * Mesh note: the viewport pipeline reads geometry + resolves dependencies from the MOUNTED
 * base TRE set (by virtualPath), so a staged mesh renders in 3D when its path exists in the
 * mount (Extract→Add, and overrides of base files — the common case). Rendering the exact
 * bytes of an externally-edited replacement would require feeding staged bytes into the
 * viewport pipeline; that's a future editor-pipeline capability. Non-mesh types open from
 * the STAGED bytes directly.
 *
 * Read path (plan 11): routes through the shared readVfsEntryBytes service so loose-override
 * winners and master-.toc-sourced entries open correctly in the viewer (MOUNT-07 / H1 wiring).
 */

import { useTreStore, basename } from '../state/treStore';
import { useViewportStore } from '../state/viewportStore';
import { useIffStore, type IffParseResult } from '../state/iffStore';
import { resolveAppearance } from '../panels/viewport/resolver/appearanceResolver';
import { readVfsEntryBytes, type ExtractionDescriptor } from './readVfsEntryBytes';
import type { VfsEntry } from '../state/treStore';

// Path B fs + native addon (nodeIntegration:true) — never bundled by Vite.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  resolveChain: (handle: string, name: string) => {
    winner: string; tombstone: boolean; winnerArchiveIndex: number; winnerEntryIndex: number;
  };
  parseIff: (bytes: ArrayBuffer | Uint8Array) => {
    roots: unknown[];
    trailingBytes: { offset: number; count: number } | null;
    roundTrip: { passed: boolean; failOffset?: number };
  };
};

const MESH_EXTENSIONS = new Set(['msh', 'mgn', 'sat', 'apt']);

function activatePanel(id: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as { __activatePanel?: (id: string) => void }).__activatePanel?.(id);
}

/**
 * Open a VFS entry directly from the mount (loose winner, native winner, or TOC-sourced winner)
 * in the appropriate viewer/editor.
 *
 * Uses the shared readVfsEntryBytes service to transparently handle all three read paths:
 *   - Loose override: reads from disk (highest priority, resolveLooseOverride wins)
 *   - TOC-sourced: extractMountAt via descriptor (master-.toc entries, e.g. v6000 containers)
 *   - Native mount: resolveChain + readMountEntry (searchTree clients, internal TOC entries)
 *
 * Called by the TRE browser "Open in viewer" action and any future surface that needs to open
 * a VFS entry without going through the staging pipeline first.
 *
 * Non-mesh types open in the IFF Structure panel. Mesh types (.msh/.mgn/.sat/.apt) drive
 * the 3D viewport (when the mount index is available for dependency resolution).
 *
 * @param entry       VfsEntry from treStore.vfsEntries (or a synthesized entry).
 * @param mountHandle Opaque mount handle from treStore.mountHandle. May be null for loose-only.
 * @param descriptor  Optional extraction descriptor from tocReader.resolveFull() — supplies the
 *                    TOC-sourced read path for master-.toc-indexed containers (plan 10/11).
 */
export async function openVfsEntry(
  entry:       VfsEntry,
  mountHandle: string | null,
  descriptor?: ExtractionDescriptor | null,
): Promise<void> {
  const filename = basename(entry.path);
  const ext      = filename.split('.').pop()?.toLowerCase() ?? '';

  // Read bytes via the shared service (loose → TOC-sourced → native, in descriptor order).
  const bytes = readVfsEntryBytes(entry, mountHandle, descriptor);
  if (!bytes) {
    // Unreadable entry — tombstone, encrypted, or missing file.
    useIffStore.getState().parseError(filename, 'entry not readable (tombstone / encrypted / missing)');
    activatePanel('data');
    return;
  }

  // ── Mesh → 3D viewport ───────────────────────────────────────────────────
  if (MESH_EXTENSIONS.has(ext) && mountHandle && entry.winnerArchiveIndex >= 0) {
    const chain = nativeCore.resolveChain(mountHandle, entry.path);
    if (chain.winner && !chain.tombstone &&
        chain.winnerArchiveIndex >= 0 && chain.winnerEntryIndex >= 0) {
      const vp = useViewportStore.getState();
      vp.beginLoad(filename, mountHandle, chain.winnerArchiveIndex, chain.winnerEntryIndex, entry.path);
      try {
        const resolution = await resolveAppearance(mountHandle, entry.path);
        const firstMesh = resolution.meshes.find((m) => m !== null) ?? null;
        vp.loadComplete(
          filename,
          resolution.mode,
          resolution,
          resolution.isSkinned,
          firstMesh?.parseResult ?? null,
          resolution.skeleton?.parseResult ?? null,
        );
      } catch (err) {
        vp.loadError(filename, err instanceof Error ? err.message : String(err));
      }
      activatePanel('viewport');
      return;
    }
  }

  // ── Default → IFF Structure panel ────────────────────────────────────────
  useIffStore.getState().beginParse(filename);
  try {
    const raw = nativeCore.parseIff(new Uint8Array(bytes));
    const result: IffParseResult = {
      roots:         raw.roots as IffParseResult['roots'],
      trailingBytes: raw.trailingBytes,
      roundTrip:     raw.roundTrip,
    };
    useIffStore.getState().parseComplete(filename, result, bytes);
  } catch (iffErr) {
    const reason = iffErr instanceof Error ? iffErr.message : String(iffErr);
    const m = /0x([0-9A-Fa-f]+)/.exec(reason);
    useIffStore.getState().parseError(filename, reason, m ? parseInt(m[1], 16) : undefined);
  }
  activatePanel('data');
}

/**
 * Open a staged item in the appropriate viewer/editor.
 * @param virtualPath   the staged entry's virtual path (drives type routing + mount lookup)
 * @param stagedFilePath  the on-disk file holding the staged bytes (for non-mount viewers)
 */
export async function openStagedEntry(virtualPath: string, stagedFilePath: string): Promise<void> {
  const ext = virtualPath.split('.').pop()?.toLowerCase() ?? '';
  const filename = basename(virtualPath);

  // ── Mesh → 3D viewport (resolved from the mounted base at this virtualPath) ──
  if (MESH_EXTENSIONS.has(ext)) {
    const mountHandle = useTreStore.getState().mountHandle;
    if (mountHandle) {
      const chain = nativeCore.resolveChain(mountHandle, virtualPath);
      if (chain.winner && !chain.tombstone &&
          chain.winnerArchiveIndex >= 0 && chain.winnerEntryIndex >= 0) {
        const vp = useViewportStore.getState();
        vp.beginLoad(filename, mountHandle, chain.winnerArchiveIndex, chain.winnerEntryIndex, virtualPath);
        try {
          const resolution = await resolveAppearance(mountHandle, virtualPath);
          const firstMesh = resolution.meshes.find((m) => m !== null) ?? null;
          vp.loadComplete(
            filename,
            resolution.mode,
            resolution,
            resolution.isSkinned,
            firstMesh?.parseResult ?? null,
            resolution.skeleton?.parseResult ?? null,
          );
        } catch (err) {
          vp.loadError(filename, err instanceof Error ? err.message : String(err));
        }
        activatePanel('viewport');
        return;
      }
      // Mesh path not in the mounted base — fall through to the IFF structure view.
    }
  }

  // ── EXTENSION POINT: effect / sound / datatable editors route here in future ──

  // ── Default → IFF Structure (Data panel) from the STAGED bytes ──
  useIffStore.getState().beginParse(filename);
  try {
    const bytes = new Uint8Array(fs.readFileSync(stagedFilePath));
    try {
      const raw = nativeCore.parseIff(bytes);
      const result: IffParseResult = {
        roots:         raw.roots as IffParseResult['roots'],
        trailingBytes: raw.trailingBytes,
        roundTrip:     raw.roundTrip,
      };
      useIffStore.getState().parseComplete(filename, result, bytes.buffer);
    } catch (iffErr) {
      const reason = iffErr instanceof Error ? iffErr.message : String(iffErr);
      const m = /0x([0-9A-Fa-f]+)/.exec(reason);
      useIffStore.getState().parseError(filename, reason, m ? parseInt(m[1], 16) : undefined);
    }
  } catch (readErr) {
    const reason = readErr instanceof Error ? readErr.message : String(readErr);
    useIffStore.getState().parseError(filename, `could not read staged file — ${reason}`);
  }
  activatePanel('data');
}
