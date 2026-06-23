/**
 * index.d.ts — TypeScript type declarations for the @swg/native-core addon.
 *
 * These types match the exports registered in addon.cpp:
 *   exports.Set("hello",       ...) → hello(): string
 *   exports.Set("allocateSab", ...) → allocateSab(byteLength: number): SharedArrayBuffer
 *   exports.Set("writeSab",    ...) → writeSab(sab, int32Index, value): void  [00-03 Path B]
 *   exports.Set("readSab",     ...) → readSab(sab, int32Index): number        [00-03 Path B]
 *
 * Consumed by:
 *   - packages/backend/src/preload.ts (Path B: preload requires addon, exposes via contextBridge)
 *   - packages/renderer/src/ (Path B: renderer accesses writeSab/readSab through window.api)
 *   - Vitest unit tests in packages/native-core/test/hello.test.ts
 */

/**
 * Returns the string "pong". Proves the C++ → N-API → JS call chain works.
 */
export function hello(): string;

/**
 * Allocates a new SharedArrayBuffer of the given byte length in C++ and
 * returns it to JavaScript. The allocation is owned by the Node.js heap.
 *
 * @param byteLength - Number of bytes to allocate. Zero is allowed (edge case).
 * @returns A SharedArrayBuffer of exactly byteLength bytes.
 *
 * Note: Requires NAPI_EXPERIMENTAL compile def (Napi::SharedArrayBuffer is
 * experimental-gated in node-addon-api >= 8.6.0; see CMakeLists.txt).
 */
export function allocateSab(byteLength: number): SharedArrayBuffer;

/**
 * Writes a 32-bit signed integer value into a SharedArrayBuffer at the given Int32 index.
 * Used by the Path B bidirectional proof: C++ writes 0xDEAD into the SAB that the renderer
 * can read directly (same memory, no IPC, no copy).
 *
 * @param sab        - The SharedArrayBuffer to write into.
 * @param int32Index - Zero-based index of the Int32 slot (byte offset = int32Index * 4).
 * @param value      - The 32-bit integer value to write.
 * @throws RangeError if int32Index is out of bounds for the SAB's byteLength.
 *
 * Note: Requires NAPI_EXPERIMENTAL (uses Napi::SharedArrayBuffer).
 */
export function writeSab(sab: SharedArrayBuffer, int32Index: number, value: number): void;

/**
 * Reads and returns a 32-bit signed integer from a SharedArrayBuffer at the given Int32 index.
 * Used by the Path B bidirectional proof: renderer writes a per-run nonce; C++ reads it back
 * from the same memory (proves JS → C++ same-memory access, no IPC, no copy).
 *
 * @param sab        - The SharedArrayBuffer to read from.
 * @param int32Index - Zero-based index of the Int32 slot (byte offset = int32Index * 4).
 * @returns The 32-bit integer value at the given slot.
 * @throws RangeError if int32Index is out of bounds for the SAB's byteLength.
 *
 * Note: Requires NAPI_EXPERIMENTAL (uses Napi::SharedArrayBuffer).
 */
export function readSab(sab: SharedArrayBuffer, int32Index: number): number;

/**
 * Resolved path of the .node file that was loaded by node-gyp-build.
 * Set by index.js via require('node-gyp-build').resolve(__dirname).
 * Used by resolve-prebuild.test.ts to assert non-circular FND-02 proof.
 */
export const __resolvedPath: string;

// ─── Phase 1 TRE types (Plan 01-01) ──────────────────────────────────────────

/** Result of a successful archive mount for one file. */
export interface MountResult {
  archiveIndex: number;
  entryCount: number;
  path: string;
}

/** One TOC entry from a parsed TRE archive. */
export interface NativeTreEntry {
  path: string;
  crc: number;
  uncompressedSize: number;
  compressedSize: number;
  offset: number;
  compressor: 0 | 1 | 2;
  archiveIndex: number;
}

/**
 * Parse one or more TRE archives and add them to the global mount list.
 *
 * @param paths  Array of absolute filesystem paths to .tre archives.
 * @returns      Array of { archiveIndex, entryCount, path } for each archive.
 *
 * Note: synchronous in Plan 01; AsyncWorker wrapping added in Plan 02.
 * Source: swg-client-v2 TreeFile.cpp:285-308, TreArchive.cpp parse().
 */
export function mountArchive(paths: string[]): MountResult[];

/**
 * List all TOC entries for a mounted archive.
 *
 * @param archiveIdx  Index returned by mountArchive().
 * @returns           Array of NativeTreEntry objects (metadata only; no payload bytes).
 *
 * Source: TreArchive.cpp entries().
 */
export function listEntries(archiveIdx: number): NativeTreEntry[];

/**
 * Extract and return the decompressed payload for one TOC entry.
 *
 * Binary payload crosses as ArrayBuffer — NEVER JSON (AGENTS.md zero-copy rule).
 * Throws for v6000 enumerate-only archives (T-01-05).
 *
 * @param archiveIdx  Index returned by mountArchive().
 * @param entryIdx    Index into the archive's entry list.
 * @returns           Decompressed payload bytes.
 *
 * Source: TreArchive.cpp extractEntry(); Zlib.cpp treInflate().
 */
export function readEntry(archiveIdx: number, entryIdx: number): ArrayBuffer;

// ─── Phase 1 Plan 01-02: TreMount priority resolver + AsyncWorker ─────────────

/**
 * Result of resolving a path against the priority-ordered virtual mount.
 *
 * Source: swg-client-v2 TreeFile.cpp:437-461 (first-match-wins).
 */
export interface TreMountResolveResult {
  /** Path of the winning archive, or null if not found. */
  winner: string | null;
  /** True if the winning entry is a tombstone (file is deleted). */
  tombstone: boolean;
  /** Index of the winning archive in the priority list (-1 if not found). */
  archiveIndex: number;
  /** TOC entry index in the winning archive (-1 if not found). */
  entryIndex: number;
}

/**
 * Full shadow chain for a path across all mounted archives.
 *
 * Source: OUR algorithm — the client does not report shadow chains.
 * See TreMount.h resolveChain() for the invariant.
 */
export interface TreShadowChainNative {
  /** Path of the winning (highest-priority) archive. */
  winner: string;
  /** Paths of lower-priority archives containing the same file, highest-first. */
  shadows: string[];
  /** True if the winning entry is a tombstone. */
  tombstone: boolean;
  /** Index of the winning archive in the priority list. */
  winnerArchiveIndex: number;
  /** TOC entry index in the winning archive. */
  winnerEntryIndex: number;
}

/**
 * A search hit — entry index + archive index in the mount list.
 * Source: RESEARCH.md § "TRE Search Semantics"; T-01-06 disposition.
 */
export interface NativeTreSearchHit {
  /** Index into the archive's entry list. */
  entryIndex: number;
  /** Index of the archive in the priority list. */
  archiveIndex: number;
}

/**
 * Result of an async archive mount.
 */
export interface AsyncMountResult {
  archiveIndex: number;
  entryCount: number;
  path: string;
  version: string;
  handle: string;
}

/**
 * Create a priority-ordered virtual filesystem mount from the given archives.
 *
 * Archives are inserted using std::lower_bound with the strict priority > predicate
 * (mirroring swg-client-v2 TreeFile.cpp:304). For equal priorities, the most
 * recently added archive wins (inserts before existing same-priority archives).
 *
 * @param paths       Array of absolute filesystem paths to .tre archives.
 * @param priorities  Parallel array of integer priorities (higher = higher precedence).
 * @returns           Opaque mount handle string for subsequent calls.
 *
 * Source: swg-client-v2 TreeFile.cpp:285-308 (priority list management).
 */
export function mountTreMount(paths: string[], priorities: number[]): string;

/**
 * Resolve a path against the priority-ordered mount (first-match-wins).
 *
 * @param handle  Mount handle from mountTreMount().
 * @param name    File path to resolve (normalized internally).
 * @returns       TreMountResolveResult with winner/tombstone/indices.
 *
 * Source: swg-client-v2 TreeFile.cpp:437-461 (find()).
 */
export function resolveEntry(handle: string, name: string): TreMountResolveResult;

/**
 * Build the full shadow chain for a path.
 *
 * Invariant: for the non-tombstone case, chain.winner === resolveEntry(handle, name).winner.
 *
 * @param handle  Mount handle from mountTreMount().
 * @param name    File path to resolve.
 * @returns       TreShadowChainNative with winner + shadows + tombstone flag.
 *
 * Source: OUR algorithm — see TreMount.cpp resolveChain().
 */
export function resolveChain(handle: string, name: string): TreShadowChainNative;

/**
 * Search the mounted archives for entries matching the query.
 *
 * Returns matched INDICES only — never the full name list (T-01-06 mitigation).
 *
 * @param handle  Mount handle from mountTreMount().
 * @param query   { text: string; mode: 'substring' | 'glob' }
 * @returns       Array of { entryIndex, archiveIndex } hits.
 *
 * Source: RESEARCH.md § "TRE Search Semantics"; T-01-06 disposition.
 */
export function searchMount(handle: string, query: { text: string; mode: 'substring' | 'glob' }): NativeTreSearchHit[];

/**
 * Per-archive metadata for a mount, in the priority-sorted index space
 * (archiveIndex matches resolveEntry/resolveChain/searchMount hits).
 *
 * Source: OUR design — exposes version/enumerateOnly to the UI in the mount handle
 * index space (01-02-PLAN.md index-space-mismatch fix).
 */
export interface NativeMountArchiveInfo {
  /** Absolute filesystem path to the .tre archive. */
  path: string;
  /** Version string: 'v0004' | 'v0005' | 'v0006' | 'v5000' | 'v6000'. */
  version: string;
  /** True only for v6000 (encrypted, payloads not extractable). */
  enumerateOnly: boolean;
  /** Total number of TOC entries. */
  entryCount: number;
  /** Mount priority (higher = higher precedence). */
  priority: number;
  /** Position in the priority-sorted node list. */
  archiveIndex: number;
}

/**
 * One deduplicated, shadow-resolved VFS entry for the whole mount.
 *
 * winnerArchiveIndex is in the SAME priority space as NativeMountArchiveInfo.archiveIndex.
 * isOverride === (shadowCount > 0).
 *
 * Source: OUR design — 01-02-PLAN.md override-detection fix.
 */
export interface NativeMountVfsEntry {
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

/**
 * Per-archive metadata for a mount, in priority-sorted index space.
 *
 * Use this (NOT mountArchive()'s file-ordered result) to populate the Mounted
 * Archives list — version and enumerateOnly are the native truth here.
 *
 * @param handle  Mount handle from mountTreMount()/mountSearchableAsync().
 * @returns       One NativeMountArchiveInfo per archive, highest-priority first.
 *
 * Source: OUR design — 01-02-PLAN.md index-space-mismatch fix.
 */
export function getMountArchives(handle: string): NativeMountArchiveInfo[];

/**
 * The deduplicated, shadow-resolved VFS for the whole mount.
 *
 * Computed once in C++ over every unique path (resolveChain logic). Returns the
 * correct winner / shadowCount / override / tombstone per path. REPLACES the
 * renderer's broken JS index-juggling.
 *
 * @param handle  Mount handle from mountTreMount()/mountSearchableAsync().
 * @returns       One NativeMountVfsEntry per unique path, sorted by path.
 *
 * Source: OUR design — 01-02-PLAN.md override-detection fix; T-01-06 intent.
 */
export function listMountEntries(handle: string): NativeMountVfsEntry[];

/**
 * Extract a payload from a specific archive in the mount.
 *
 * Binary stays binary — returns ArrayBuffer, never JSON (AGENTS.md).
 * Throws for v6000 enumerate-only archives (T-01-20).
 *
 * @param handle        Mount handle from mountTreMount().
 * @param archiveIndex  Archive index in the priority list.
 * @param entryIndex    TOC entry index in that archive.
 * @returns             Decompressed payload bytes as ArrayBuffer.
 *
 * Source: TreArchive.cpp extractEntry().
 */
export function readMountEntry(handle: string, archiveIndex: number, entryIndex: number): ArrayBuffer;

/**
 * Release a mounted TreMount and free all associated resources.
 *
 * @param handle  Mount handle from mountTreMount().
 */
export function disposeTreMount(handle: string): void;

/**
 * Parse a single TRE archive off-main-thread via Napi::AsyncWorker (CORE-06).
 *
 * The heavy TreArchive::parse() runs on the libuv threadpool. Returns a Promise
 * that resolves when parsing completes. The resolver event loop stays responsive
 * during the mount (instrumented wall-clock gate in tre-async-zerocopy.test.ts).
 *
 * @param path      Absolute filesystem path to the .tre archive.
 * @param priority  Mount priority for this archive.
 * @returns         Promise resolving to AsyncMountResult (includes handle for subsequent ops).
 *
 * Source: RESEARCH.md § "Async Worker Model"; T-01-08 mitigation.
 */
export function mountArchiveAsync(path: string, priority: number): Promise<AsyncMountResult>;

/**
 * Parse and mount multiple archives off-main-thread (CORE-06).
 *
 * @param paths       Array of absolute filesystem paths to .tre archives.
 * @param priorities  Parallel array of priorities.
 * @returns           Promise resolving to a mount handle string.
 */
export function mountSearchableAsync(paths: string[], priorities: number[]): Promise<string>;
