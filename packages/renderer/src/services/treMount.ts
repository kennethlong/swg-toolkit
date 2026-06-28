/**
 * packages/renderer/src/services/treMount.ts
 * Shared TRE mount routine + columnar VFS decoder.
 *
 * Extracted from TreVfsBrowser.tsx (manual Mount Archive… flow) so that both
 * the manual path AND projectBinding.ts auto-mount can share ONE implementation.
 *
 * Exports:
 *   mountTrePaths(filePaths, priorities)      — mount archives + populate treStore
 *   decodeMountEntriesColumnar(blob)           — decode native columnar blob → VfsEntry[]
 *
 * Path B addon access: via the ./nativeTre require() seam (nodeIntegration:true).
 * A top-level ESM import of @swg/native-core crashes the real renderer at startup
 * (Vite bundles the addon loader → `os.platform is not a function`); see nativeTre.ts.
 *
 * Source: 04.1-02-PLAN.md Task 2 (H3 fix — columnar decoder must be shared, not duplicated).
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
  // resolveChain hits). version + enumerateOnly come straight from the native layer.
  const archives: MountedArchive[] = nativeCore.getMountArchives(handle).map((a) => ({
    path:            a.path,
    filename:        basename(a.path),
    version:         parseVersion(a.version),
    entryCount:      a.entryCount,
    priority:        a.priority,
    isEnumerateOnly: a.enumerateOnly,
    archiveIndex:    a.archiveIndex,
  }));

  // Build the VFS entry list from the native columnar blob (perf fix).
  // ONE ArrayBuffer crosses the N-API bridge instead of ~250k Napi::Object instances.
  const columnarBlob = nativeCore.getMountEntriesColumnar(handle);
  const vfsEntries: VfsEntry[] = decodeMountEntriesColumnar(columnarBlob);

  useTreStore.getState().mountComplete(handle, archives, vfsEntries);
  return handle;
}
