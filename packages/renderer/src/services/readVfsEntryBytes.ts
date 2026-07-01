/**
 * packages/renderer/src/services/readVfsEntryBytes.ts
 * Shared VFS byte-reader service — extracted from TreVfsBrowser.tsx (private :112).
 *
 * Routes reads across three cases:
 *   (1) Loose winner (winnerArchiveIndex < 0):
 *       Read bytes from disk via fs.readFileSync (winnerArchivePath is the absolute path).
 *
 *   (2) Native mount winner (winnerArchiveIndex >= 0, no descriptor):
 *       resolveChain() → readMountEntry() (internal-TOC path used by searchTree clients).
 *
 *   (3) Master-.toc-sourced winner (winnerArchiveIndex >= 0, descriptor supplied):
 *       native extractMountAt(handle, archiveIndex, descriptor) (MOUNT-03/04 — plan 10).
 *       Used when the entry was indexed by the master .toc (empty-internal-TOC v6000
 *       containers whose own internal TOC has zero entries). The descriptor comes from
 *       tocIndex.resolveFull(entry.path) — see readTocIndex / resolveFull in tocReader.ts.
 *       On { encrypted: true } failure → mark the archive encrypted (MOUNT-05) + return null.
 *
 * Consumers:
 *   - TreVfsBrowser.tsx (Extract→Add + IFF Structure viewer) — extracted here
 *   - openInViewer.ts (viewer "Open" read path for loose + master-.toc winners)
 *
 * Path B addon access: via the ./nativeTre require() seam (nodeIntegration:true).
 * See nativeTre.ts for why a bare require() (not a top-level ESM import) is used.
 *
 * Source: 04.3-11-PLAN.md Task 3 (H1 read-path wiring / MOUNT-07).
 */

import type { VfsEntry } from '../state/treStore';
import { useTreStore } from '../state/treStore';
import { nativeCore } from './nativeTre';

// Node built-in — Vite externalizes `fs` in all renderer builds; ESM import is safe and
// enables vi.mock('fs') to intercept in vitest (CJS require() bypasses vi.mock).
import * as nodeFs from 'fs';

// ─── Extraction descriptor (from tocReader.resolveFull) ───────────────────────

/** Extraction descriptor returned by tocReader.resolveFull() for TOC-indexed entries. */
export interface ExtractionDescriptor {
  offset:           number;
  length:           number;
  compressedLength: number;
  compressor:       number;
  /** F-4 (gate D-16): Forward CRC-32 of the virtual path (0x04C11DB7). Optional — callers
   *  that lack the crc (e.g. synthetic tests) may omit it; native defaults to 0. */
  crc?:             number;
}

// ─── readVfsEntryBytes ────────────────────────────────────────────────────────

/**
 * Read the bytes for a VFS entry, transparently handling all three read paths.
 *
 * @param entry       The resolved VfsEntry (from treStore.vfsEntries or tocIndex lookup).
 * @param mountHandle The opaque mount handle (from treStore.mountHandle). May be null for
 *                    loose-only reads, but must be supplied for native/TOC reads.
 * @param descriptor  Optional extraction descriptor from tocReader.resolveFull(). When
 *                    supplied AND winnerArchiveIndex >= 0, routes through extractMountAt
 *                    (master-.toc path). Omit or pass null for searchTree clients.
 *
 * @returns ArrayBuffer on success, null on any failure or tombstone.
 */
export function readVfsEntryBytes(
  entry:       VfsEntry,
  mountHandle: string | null,
  descriptor?: ExtractionDescriptor | null,
): ArrayBuffer | null {
  // ── Case 1: Loose winner (on-disk file, not inside any archive) ───────────
  if (entry.winnerArchiveIndex < 0) {
    if (!entry.winnerArchivePath) return null;
    try {
      const buf = nodeFs.readFileSync(entry.winnerArchivePath);
      // Buffer.buffer may be a shared pool slice; use slice to get a standalone ArrayBuffer.
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch {
      return null;
    }
  }

  // ── Case 3: TOC-sourced entry (descriptor from tocIndex.resolveFull) ──────
  if (descriptor != null) {
    if (!mountHandle) return null;
    const result = nativeCore.extractMountAt(mountHandle, entry.winnerArchiveIndex, descriptor);
    if (result.encrypted) {
      // Inflate failed → this archive is encrypted (MOUNT-05). Mark it so the UI chip shows.
      useTreStore.getState().markArchiveEncrypted(entry.winnerArchiveIndex);
      return null;
    }
    return result.bytes ?? null;
  }

  // ── Case 2: Native mount winner (internal TOC — resolveChain + readMountEntry) ─
  if (!mountHandle) return null;
  try {
    const chain = nativeCore.resolveChain(mountHandle, entry.path);
    if (!chain.winner || chain.tombstone ||
        chain.winnerArchiveIndex < 0 || chain.winnerEntryIndex < 0) {
      return null;
    }
    return nativeCore.readMountEntry(mountHandle, chain.winnerArchiveIndex, chain.winnerEntryIndex);
  } catch {
    return null;
  }
}
