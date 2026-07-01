/**
 * packages/renderer/src/services/treMount.ts
 * Shared TRE mount routine + columnar VFS decoder.
 *
 * Extracted from TreVfsBrowser.tsx (manual Mount Archive… flow) so that both
 * the manual path AND projectBinding.ts auto-mount can share ONE implementation.
 *
 * Exports:
 *   mountTrePaths(filePaths, priorities)                    — mount archives (searchTree/standalone)
 *   mountTreMountWithTocPaths(paths, priorities, toc, tocTreePath) — mount archives for searchTOC clients (MOUNT-01)
 *   decodeMountEntriesColumnar(blob)                        — decode native columnar blob → VfsEntry[]
 *   mountComplete()                                         — pipeline-done signal (B1 structural gate)
 *   injectLooseDirOverlay(dir, opts)                        — inject loose-dir VfsEntries (B4 isOverride)
 *
 * Path B addon access: via the ./nativeTre require() seam (nodeIntegration:true).
 * A top-level ESM import of @swg/native-core crashes the real renderer at startup
 * (Vite bundles the addon loader → `os.platform is not a function`); see nativeTre.ts.
 *
 * Source: 04.1-02-PLAN.md Task 2 (H3 fix — columnar decoder must be shared, not duplicated).
 *         04.3-11-PLAN.md Task 2 (MOUNT-01: mountTreMountWithTocPaths; MOUNT-05: isEnumerateOnly=false).
 */

import { useTreStore, basename } from '../state/treStore';
import type { MountedArchive, VfsEntry } from '../state/treStore';
import type { TreVersion } from '@swg/contracts';
// Native addon access via the Path B require() seam (see nativeTre.ts for why a bare
// require — not a top-level ESM import — is required: a static import makes Vite bundle
// the addon's loader into the renderer and crashes startup with `os.platform is not a
// function`). Importing the seam (a local ESM module) keeps the native call mockable in
// vitest via vi.mock('./nativeTre', …) without loading the .node binary.
import { nativeCore } from './nativeTre';

// Node built-ins — Vite externalizes Node built-ins (fs/path/os/…) in all renderer builds;
// ESM import is safe here and enables vi.mock('fs') / vi.mock('path') to intercept in vitest.
// (Unlike @swg/native-core, which MUST use the nativeTre require() seam to avoid Vite bundling
// the addon loader into the browser module graph — see nativeTre.ts for the rationale.)
import * as nodeFs   from 'fs';
import * as nodePath from 'path';

// ─── Version helper (moved from TreVfsBrowser) ───────────────────────────────

/** Map the native version string onto the TreVersion union. */
function parseVersion(versionStr: string): TreVersion {
  // The native layer returns version strings like "v0005", "v0006", "v6000".
  if (['v0004', 'v0005', 'v0006', 'v5000', 'v6000'].includes(versionStr as TreVersion)) {
    return versionStr as TreVersion;
  }
  return 'v0005'; // fallback (should not happen — native always returns a known string)
}

// ─── decodeMountEntriesColumnar (moved from TreVfsBrowser; now exported) ─────

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
 * Moved from TreVfsBrowser.tsx (was private) to enable shared use by projectBinding.
 */
export function decodeMountEntriesColumnar(blob: ArrayBuffer): VfsEntry[] {
  const buf = new DataView(blob);
  const u8  = new Uint8Array(blob);

  // ── Read header ────────────────────────────────────────────────────────────
  const entryCount = buf.getUint32(0, true);
  // Early exit before reading remaining header fields — avoids DataView RangeError
  // when the buffer is a minimal stub (e.g. unit-test mock returning new ArrayBuffer(8)).
  if (entryCount === 0) return [];

  const nameDataOffset     = buf.getUint32(4,  true);
  const archPathDataOffset = buf.getUint32(12, true);
  const arrayOffset        = buf.getUint32(20, true);

  // ── Locate per-entry typed arrays ──────────────────────────────────────────
  const nameOffBase = arrayOffset;
  const archOffBase = nameOffBase + entryCount * 4;
  const winnerBase  = archOffBase + entryCount * 4;
  const shadowBase  = winnerBase  + entryCount * 4;
  const flagsBase   = shadowBase  + entryCount * 4;

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
    const nameRelOff         = buf.getUint32(nameOffBase + i * 4, true);
    const archRelOff         = buf.getUint32(archOffBase + i * 4, true);
    const winnerArchiveIndex = buf.getInt32( winnerBase  + i * 4, true);
    const shadowCount        = buf.getInt32( shadowBase  + i * 4, true);
    const flags              = u8[flagsBase + i];
    const isOverride         = (flags & 0x01) !== 0;
    const isTombstone        = (flags & 0x02) !== 0;

    const entryPath      = readCStr(nameDataOffset,     nameRelOff);
    const winnerArchivePath = readCStr(archPathDataOffset, archRelOff);

    const segments = entryPath.split('/');
    result[i] = {
      path:                  entryPath,
      name:                  segments[segments.length - 1] ?? entryPath,
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

// ─── mountTrePaths ───────────────────────────────────────────────────────────

/**
 * Mount .tre archives and populate treStore.
 *
 * Shared by:
 *   - TreVfsBrowser (manual "Mount Archive…" button) — extracted from handleMountClick
 *   - projectBinding.initProject (auto-mount of bound client base TREs)
 *
 * Note: callers that want to show progress UI should call treStore.beginMount()
 * BEFORE calling this function (as TreVfsBrowser does). Error handling also stays
 * with the caller (call treStore.mountError() on catch).
 *
 * @returns The opaque mount handle returned by mountSearchableAsync.
 */
export async function mountTrePaths(filePaths: string[], priorities: number[]): Promise<string> {
  // Mount the archives asynchronously (off-main-thread via AsyncWorker).
  const handle = await nativeCore.mountSearchableAsync(filePaths, priorities);

  // Build the MountedArchive list from native truth, in the mount's priority-sorted
  // index space (getMountArchives returns highest-priority first — same space as
  // resolveChain hits). version comes from the native layer; isEnumerateOnly starts
  // false (MOUNT-05: driven by per-entry extractMountAt failure, not version tag —
  // treStore.markArchiveEncrypted() sets it when extractMountAt returns encrypted:true).
  const archives: MountedArchive[] = nativeCore.getMountArchives(handle).map((a) => ({
    path:            a.path,
    filename:        basename(a.path),
    version:         parseVersion(a.version),
    entryCount:      a.entryCount,
    priority:        a.priority,
    isEnumerateOnly: false,   // MOUNT-05: NOT version-tag-based; updated on extract failure
    archiveIndex:    a.archiveIndex,
  }));

  // Build the VFS entry list from the native columnar blob (perf fix).
  // ONE ArrayBuffer crosses the N-API bridge instead of ~250k Napi::Object instances.
  const columnarBlob = nativeCore.getMountEntriesColumnar(handle);
  const vfsEntries: VfsEntry[] = decodeMountEntriesColumnar(columnarBlob);

  useTreStore.getState().mountComplete(handle, archives, vfsEntries);
  return handle;
}

// ─── mountTreMountWithTocPaths ────────────────────────────────────────────────

/**
 * Mount .tre archives for a searchTOC client, sourcing the VFS entry set from the
 * master .toc index via the synchronous native `mountTreMountWithToc` (plan 10).
 *
 * WHY a separate function (MOUNT-01/02):
 *   searchTOC clients have containers (incl. empty-internal-TOC v6000 archives like
 *   patch_sku3_*) whose entries are catalogued only in the master .toc, NOT in the
 *   containers' own internal TOCs. `mountSearchableAsync` (used by mountTrePaths) reads
 *   internal TOCs and would see zero entries for these containers. The native
 *   `mountTreMountWithToc` instead sources the VFS from the master .toc, so every
 *   TOC-indexed container contributes its entries through getMountEntriesColumnar.
 *
 *   The columnar bridge is RETAINED — ONE ArrayBuffer crosses the N-API boundary
 *   (CLAUDE.md binary-stays-binary; ~193k entries must NOT cross as JSON).
 *
 *   isEnumerateOnly starts false (MOUNT-05): the chip is driven by per-entry
 *   extractMountAt failure (encrypted:true), not the version tag.
 *
 * @param filePaths    Container .tre paths, sorted by compact priority (highest first).
 * @param priorities   Compact priorities (same order as filePaths).
 * @param tocPath      Absolute path to the master .toc file.
 * @param tocTreePath  TOCTreePath prefix from the client cfg searchTOC_00_* entry.
 * @returns            Opaque mount handle.
 */
export async function mountTreMountWithTocPaths(
  filePaths:   string[],
  priorities:  number[],
  tocPath:     string,
  tocTreePath: string,
): Promise<string> {
  // Sync call — native mountTreMountWithToc builds the columnar entry set from the
  // master .toc (not from each container's internal TOC).
  const handle = nativeCore.mountTreMountWithToc(filePaths, priorities, tocPath, tocTreePath);

  // Build the MountedArchive list; isEnumerateOnly=false by default (MOUNT-05: NOT
  // version-tag-based — markArchiveEncrypted updates it on per-entry extract failure).
  const archives: MountedArchive[] = nativeCore.getMountArchives(handle).map((a) => ({
    path:            a.path,
    filename:        basename(a.path),
    version:         parseVersion(a.version),
    entryCount:      a.entryCount,
    priority:        a.priority,
    isEnumerateOnly: false,   // MOUNT-05: updated when extractMountAt returns encrypted:true
    archiveIndex:    a.archiveIndex,
  }));

  // Columnar bridge retained: ONE ArrayBuffer instead of ~250k Napi::Object instances.
  const columnarBlob = nativeCore.getMountEntriesColumnar(handle);
  const vfsEntries: VfsEntry[] = decodeMountEntriesColumnar(columnarBlob);

  useTreStore.getState().mountComplete(handle, archives, vfsEntries);
  return handle;
}

// ─── mountComplete (pipeline-done signal) ────────────────────────────────────

/**
 * Signal that the full mount pipeline (TRE archives + loose-dir overlays) is complete.
 *
 * Called ONCE per autoMountClient invocation, AFTER injectLooseDirOverlay for all
 * loose dirs. B1 structural gate: treAutoMount.test.ts asserts toHaveBeenCalledTimes(1).
 *
 * mountTrePaths already invokes the store's mountComplete action (sets status='done').
 * This exported function re-affirms completion without replacing archives or vfsEntries
 * (those are managed by mountTrePaths and appendLooseEntries respectively).
 */
export function mountComplete(): void {
  const state = useTreStore.getState();
  // Idempotent: only update status if the pipeline somehow ended in a non-done state
  // (e.g. if a future refactor decouples mountTrePaths from the store action).
  // Does NOT replace archives, vfsEntries, or mountHandle.
  if (state.mountStatus.kind !== 'done') {
    useTreStore.setState({ mountStatus: { kind: 'done' } });
  }
}

// ─── beginMountStatus / endMountStatusIfPending ──────────────────────────────

/**
 * Show the TRE-browser mount spinner BEFORE a long auto-mount (project open). The status is
 * indeterminate (no pct) — the native mountSearchableAsync is a single async call with no progress
 * events, so an animated sweep is the honest affordance. mountTrePaths → store.mountComplete clears
 * it to 'done' on success; mount paths that produce no archives must call endMountStatusIfPending().
 */
export function beginMountStatus(label: string): void {
  useTreStore.setState({ mountStatus: { kind: 'mounting', filename: label } });
}

/**
 * Clear a still-pending 'mounting' status back to 'idle'. Called on auto-mount exit paths that did
 * NOT mount anything (no cfg order + no treDir files, or a thrown error) so the spinner never hangs.
 * No-op when the status already advanced to 'done'/'error'.
 */
export function endMountStatusIfPending(): void {
  if (useTreStore.getState().mountStatus.kind === 'mounting') {
    useTreStore.setState({ mountStatus: { kind: 'idle' } });
  }
}

// ─── injectLooseDirOverlay ────────────────────────────────────────────────────

/**
 * Record a loose-override directory for lazy on-demand resolution (D-15 / MOUNT-07).
 *
 * LAZY REFACTOR (plan 11 Task 3 GREEN):
 *   The old implementation recursively enumerated the dir with readdirSync and injected
 *   every file as a flat VfsEntry row — which surfaced thousands of junk rows when a
 *   searchPath pointed at a large data root (over-enumeration bug, Pitfall 5 / T-04.3-11-02).
 *
 *   The new implementation mirrors the real client's searchPath semantics:
 *     "search the directories sequentially; if the file exists in a searchPath dir, use it"
 *   i.e. lazy per-request lookup, NOT upfront enumeration.
 *
 *   The dir is pushed into treStore.looseDirs; resolveLooseOverride() checks these dirs
 *   at read-time (highest-priority-first). Loose files are NOT listed as flat VFS rows
 *   (D-15 constraint honored) but still WIN over the native mount at resolve-time.
 *
 * @param dir  Absolute path to the loose directory.
 * @param opts isOverride: true when dir priority exceeds maxTreRawPriority (B4); used
 *             by autoMountClient to build the ordered priority list — stored for future
 *             multi-dir resolveLooseOverride ordering. Currently all isOverride dirs
 *             are prepended (highest priority) and non-override dirs are appended.
 */
export function injectLooseDirOverlay(dir: string, opts: { isOverride: boolean }): void {
  // Push the dir into the store (prepend=true for override dirs so they check first).
  // No readdirSync — files are resolved lazily by resolveLooseOverride.
  useTreStore.getState().addLooseDir(dir, opts.isOverride);
}

// ─── resolveLooseOverride ─────────────────────────────────────────────────────

/**
 * Lazily resolve a virtual path against an ordered list of loose-override directories.
 *
 * Checks each dir in order (highest-priority first) for a file matching `virtualPath`.
 * Returns the absolute disk path of the first match, or null if the path is not found
 * in any loose dir. Used by readVfsEntryBytes and openInViewer for loose-winner reads.
 *
 * @param looseDirs   Ordered list of loose dir paths (highest-priority first).
 *                    Use treStore.getState().looseDirs as the live list.
 * @param virtualPath Normalized virtual path (e.g. "appearance/player.msh").
 */
export function resolveLooseOverride(looseDirs: string[], virtualPath: string): string | null {
  for (const dir of looseDirs) {
    const candidate = nodePath.join(dir, virtualPath);
    if (nodeFs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
