/**
 * packages/contracts/src/tre.ts — TRE archive contract types.
 *
 * Typed surface for the native TRE archive binding. All types here flow
 * end-to-end from the C++ native layer through the N-API binding to the
 * renderer/backend. Binary payload bytes are NOT included (those cross as
 * Napi::ArrayBuffer — binary stays binary per AGENTS.md).
 *
 * Field set mirrors the verified 6-field TOC record (CRC-FIRST for all versions;
 * normalized to this canonical shape after parse).
 *
 * Source: Utinni TreRecord.cs / TreHeader.cs (field names and semantics);
 *         swg-client-v2 TreeFile_SearchNode.h:189-197 (TableOfContentsEntry);
 *         RESEARCH.md § "TRE Archive Format".
 */

// ─── Core entry type ─────────────────────────────────────────────────────────

/**
 * One parsed TOC record from a TRE archive.
 *
 * The `path` field is the normalized file name from the name block.
 * The `crc` is Crc::calculate(normalizedName).
 * The `compressor` codes: 0=none, 1=raw-deflate, 2=zlib-RFC1950.
 *
 * Source: swg-client-v2 TreeFile_SearchNode.h:189-197 (TableOfContentsEntry);
 *         Utinni TreRecord.cs (field set).
 */
export interface TreEntry {
  /** Normalized file path within the archive (e.g. "appearance/player.apt"). */
  path: string;
  /** CRC-32 of the normalized path. Crc::calculate(normalizedName). */
  crc: number;
  /** Uncompressed size in bytes. 0 = tombstone (deleted entry). */
  uncompressedSize: number;
  /** Compressed size on disk (equals uncompressedSize when compressor==0). */
  compressedSize: number;
  /** Byte offset of the payload within the archive file. */
  offset: number;
  /** Compressor code: 0=none, 1=raw-deflate, 2=zlib-RFC1950. */
  compressor: 0 | 1 | 2;
  /** Index of the source archive in the mount list (for multi-archive mounts). */
  archiveIndex: number;
}

// ─── Version discriminant ─────────────────────────────────────────────────────

/**
 * TRE archive version string as it appears on disk (forward ASCII).
 *
 * v0006 = SWG Restoration READABLE archive (NOT encrypted, NOT enumerate-only).
 * v6000 = SWG Restoration ENCRYPTED archive (enumerate-only, payloads never read).
 *
 * Source: Utinni TreVersion.cs:60-73; RESEARCH.md "v6000 vs 0006 distinction".
 */
export type TreVersion = 'v0004' | 'v0005' | 'v0006' | 'v5000' | 'v6000';

// ─── Mount config ─────────────────────────────────────────────────────────────

/**
 * Configuration for mounting one or more TRE archives as a virtual filesystem.
 * Archives are listed in priority order: later entries override earlier ones.
 *
 * Source: swg-client-v2 TreeFile.cpp:285-308 (priority search-node list);
 *         RESEARCH.md § "TRE Override Resolution".
 */
export interface TreMountConfig {
  /** Ordered list of archives to mount (lower index = lower priority). */
  archives: Array<{
    /** Absolute filesystem path to the .tre archive. */
    path: string;
    /** Mount priority (higher number = higher priority / overrides lower). */
    priority: number;
  }>;
}

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * Query for searching the virtual filesystem.
 *
 * Default mode is 'substring' (case-insensitive over the flat name list).
 * 'glob' mode supports * and ? wildcards.
 *
 * Source: RESEARCH.md § "TRE Search Semantics" (OUR design — not a client format).
 */
export interface TreSearchQuery {
  /** Text to search for (case-insensitive). */
  text: string;
  /** Search mode: substring match or glob pattern (* / ?). */
  mode: 'substring' | 'glob';
}

/**
 * A search result — entry index + archive index of a matching entry.
 * The caller uses these indices to call readEntry(entryIndex) from the right archive.
 *
 * Source: RESEARCH.md § "TRE Search Semantics".
 */
export interface TreSearchHit {
  /** Index into the entries list of the matching archive. */
  entryIndex: number;
  /** Index of the archive in the mount list. */
  archiveIndex: number;
}

// ─── Mount handle accessors (priority-sorted index space) ──────────────────────

/**
 * Per-archive metadata for a mount, in the priority-sorted index space.
 *
 * `archiveIndex` matches the index space of resolveEntry/resolveChain/searchMount
 * hits (position in the priority-sorted node list; index 0 = highest priority).
 * `version` and `enumerateOnly` are the native truth (TreArchive::version() /
 * isEnumerateOnly()) — the UI must NOT hardcode them.
 *
 * Source: OUR design — 01-02-PLAN.md index-space-mismatch + version/enumerate fix.
 */
export interface MountArchiveInfo {
  /** Absolute filesystem path to the .tre archive. */
  path: string;
  /** TRE format version (e.g. 'v0005', 'v6000'). */
  version: TreVersion;
  /** True only for v6000 (encrypted, enumerate-only — payloads not extractable). */
  enumerateOnly: boolean;
  /** Total number of TOC entries. */
  entryCount: number;
  /** Mount priority (higher = higher precedence). */
  priority: number;
  /** Position in the priority-sorted node list (0 = highest priority). */
  archiveIndex: number;
}

/**
 * One deduplicated, shadow-resolved VFS entry for the whole mount.
 *
 * Computed once natively over every unique path. `winnerArchiveIndex` is in the
 * same priority space as MountArchiveInfo.archiveIndex, so the UI can join them.
 * `isOverride === shadowCount > 0`.
 *
 * Source: OUR design — 01-02-PLAN.md override-detection fix.
 */
export interface MountVfsEntry {
  /** Normalized path (lowercase, forward-slash). */
  path: string;
  /** Path of the winning (highest-priority) archive. */
  winnerArchivePath: string;
  /** Priority-list index of the winning archive. */
  winnerArchiveIndex: number;
  /** Number of lower-priority archives also containing this path. */
  shadowCount: number;
  /** True if this entry overrides one or more lower-priority archives. */
  isOverride: boolean;
  /** True if the winning entry is a tombstone (file deleted). */
  isTombstone: boolean;
}

// ─── Shadow chain ─────────────────────────────────────────────────────────────

/**
 * Shadow chain for a file path across mounted archives.
 *
 * When multiple mounted archives contain the same path, the highest-priority
 * archive wins (the 'winner'). Lower-priority archives appear in 'shadows'.
 * If the winning entry is a tombstone (length==0), 'tombstone' is true —
 * the file is considered deleted for the whole mount.
 *
 * Exposed to the TRE browser UI so users can see which archive wins and what
 * it shadows (D-06 requirement).
 *
 * Source: swg-client-v2 TreeFile.cpp:437-461 (first-match-wins traverse);
 *         TreeFile_SearchNode.cpp:397-401 (tombstone detection).
 */
export interface ShadowChain {
  /** Path of the archive whose entry wins the override resolution. */
  winner: string;
  /** Paths of lower-priority archives that contain the same file (shadowed). */
  shadows: string[];
  /** True if the winning entry is a tombstone (length==0 — file is deleted). */
  tombstone: boolean;
}
