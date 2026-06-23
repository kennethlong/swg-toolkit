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
