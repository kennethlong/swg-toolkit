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

// ─── Phase 1 Plan 01-03: IFF FORM/chunk parser + byte-exact serializer ────────

/**
 * One node in the parsed IFF FORM/chunk tree.
 * Crosses the N-API boundary as typed JSON (structure only — binary stays ArrayBuffer).
 *
 * Source: swg-client-v2 Iff.cpp:1132-1310 (enterForm/enterChunk walk).
 * Cross-check: Utinni IffReader.cs:140-210.
 */
export interface IffNodeNative {
  /** 4-character ASCII tag (e.g. 'FORM', 'DERV', 'CAT ', '0001'). */
  tag: string;
  /**
   * Declared payload length.
   * FORM/LIST/CAT: innerLen INCLUDING the 4-byte subType tag (Iff.cpp:643).
   * Leaf: payload byte count (excluding the 8-byte header).
   */
  length: number;
  /** Absolute byte offset of this block's 8-byte header in the source buffer. */
  byteOffset: number;
  /** 'form' for FORM/LIST/CAT containers; 'leaf' for all other chunks. */
  kind: 'form' | 'leaf';
  /** FORM sub-type tag (e.g. 'SLOD', 'DERV'); present only when kind === 'form'. */
  subType?: string;
  /** Child nodes; present only when kind === 'form'. */
  children?: IffNodeNative[];
}

/** Trailing bytes info (NEW TOOLKIT BEHAVIOR — client silently ignores trailing bytes). */
export interface IffTrailingBytesNative {
  /** Absolute offset of the first trailing byte. */
  offset: number;
  /** Number of trailing bytes. */
  count: number;
}

/** Byte-exact round-trip gate result (CORE-04). */
export interface IffRoundTripNative {
  /** True if serialize(parse(bytes)) === bytes byte-for-byte. */
  passed: boolean;
  /** If passed === false, the absolute offset of the first differing byte. */
  failOffset?: number;
}

/** Full result of parseIff(). */
export interface IffParseResultNative {
  roots: IffNodeNative[];
  trailingBytes: IffTrailingBytesNative | null;
  roundTrip: IffRoundTripNative;
}

/**
 * Parse an IFF buffer (FORM/chunk format) into a navigable tree.
 *
 * Returns structure as typed JSON; binary payloads are NOT included
 * (use getChunkBytes() to fetch a specific chunk's raw bytes zero-copy).
 *
 * Throws a JavaScript Error on malformed input (non-printable FourCC,
 * oversized chunk, child-end > parent-end, truncated) — never crashes
 * the renderer (security caps T-01-10/T-01-11/T-01-12).
 *
 * Also performs the CORE-04 byte-exact round-trip check inline; the
 * result is in IffParseResultNative.roundTrip.
 *
 * @param bytes  IFF file bytes as ArrayBuffer or Uint8Array.
 * @returns      IffParseResultNative with roots + trailingBytes + roundTrip.
 *
 * Source: modules/core/iff/Iff.h parseIff(); swg-client-v2 Iff.cpp:508-555,1076-1095,1132-1310.
 * Cross-check: Utinni IffReader.cs:140-327.
 */
export function parseIff(bytes: ArrayBuffer | Uint8Array): IffParseResultNative;

/**
 * Serialize a (possibly modified) IFF tree back to bytes, byte-exact.
 *
 * Hybrid-DOM verbatim re-emit: a clean node writes its captured source slice
 * verbatim (preserving interior gaps in the declared length); only a dirty node
 * reserializes. NO pad byte is emitted (SWG no-pad quirk, IffWriter.cs:141).
 *
 * @param parseResult  The parsed IFF result object from parseIff().
 * @param srcBytes     The original source bytes (needed to re-populate captured slices).
 * @returns            Serialized bytes as ArrayBuffer.
 *
 * Source: modules/core/iff/Iff.h serializeIff(); Utinni IffWriter.cs:98-187.
 */
export function serializeIff(
  parseResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): ArrayBuffer;

/**
 * Return the raw bytes of a specific IFF node as an ArrayBuffer (zero-copy).
 *
 * The node is identified by its pre-order index in the tree (index 0 = first root).
 * Used by HexInspector to show the selected chunk's bytes.
 *
 * @param parseResult  The parsed IFF result object from parseIff().
 * @param srcBytes     The original source bytes.
 * @param nodeIndex    Pre-order index of the desired node (0-based).
 * @returns            The node's captured byte slice as ArrayBuffer.
 *
 * Source: modules/core/iff/Iff.h getNodeBytes().
 */
export function getChunkBytes(
  parseResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
  nodeIndex: number,
): ArrayBuffer;

// ─── Phase 1 Plan 01-04: TRE builder (D-04 builder primitive) ─────────────────

/**
 * One entry supplied to buildTre().
 *
 * Either `data` holds the raw (uncompressed) payload bytes, or `tombstone` marks
 * a deleted entry (length==0 in TOC). The path must be normalized (lowercase, forward-slash).
 *
 * Source: modules/core/tre/TreBuilder.h TreBuilderEntry;
 *         swg-client-v2 TreeFileBuilder.cpp:558-597 (writeFile).
 */
export interface TreBuilderEntryNative {
  /** Normalized file path within the archive (e.g. "appearance/player.apt"). */
  path: string;
  /** Raw (uncompressed) payload bytes. Required unless tombstone === true. */
  data?: ArrayBuffer | Uint8Array;
  /** True if this is a tombstone entry (file is deleted, length == 0 in TOC). */
  tombstone?: boolean;
}

/**
 * One edit entry for repackTre().
 */
export interface TreRepackEditNative {
  /** TOC entry index (0-based) to replace. */
  index: number;
  /** New raw (uncompressed) payload bytes. */
  data: ArrayBuffer | Uint8Array;
}

/**
 * Build a fresh TRE archive from an array of entries.
 *
 * Block write order (LOCKED — TreeFileBuilder.cpp:773-833):
 *   (1) 36-byte header stub → (2) payloads in entry order → (3) TOC → (4) names →
 *   (5) MD5 block → (6) seek-back header re-write.
 *
 * Compression: zlib RFC1950 (code 2), level Z_DEFAULT_COMPRESSION (6), only when
 * strictly smaller AND input > 1024 bytes (ZlibCompressor.cpp:169 + TreeFileBuilder.cpp:682).
 * FORBIDDEN on write path: miniz — cannot reproduce zlib's bitstream.
 *
 * Building the same entries twice produces BYTE-IDENTICAL output (regression guard).
 * This is self-determinism, NOT a claim of matching retail archives.
 *
 * Throws for v6000 (enumerate-only, T-01-17).
 *
 * @param entries  Array of entries (path + data + optional tombstone flag).
 * @param version  Version string to embed: '0005' | '5000' | '0004' | '0006' (default '0005').
 *                 '6000' (v6000) is refused — throws Error.
 * @returns        Complete .tre archive bytes as ArrayBuffer.
 *
 * Source: modules/core/tre/TreBuilder.h TreBuilder::build();
 *         swg-client-v2 TreeFileBuilder.cpp:773-833.
 */
export function buildTre(
  entries: TreBuilderEntryNative[],
  version?: string,
): ArrayBuffer;

/**
 * Repack an existing TRE archive: copy untouched entries verbatim, recompress only edits.
 *
 * RAW-SLICE IDENTITY CONTRACT (Utinni TreWriter.cs:166-174):
 *   For every untouched entry, the raw compressed bytes are copied verbatim from the source
 *   archive. NEVER decompressed + recompressed (deflate is NOT bit-stable across zlib builds).
 *   Only edited entries are recompressed (zlib level 6 only).
 *
 * This is the real retail-fidelity property — unedited entries in the rebuilt archive are
 * bit-for-bit identical to the original compressed slices.
 *
 * Throws for v6000 (enumerate-only, T-01-17).
 *
 * @param sourcePath  Absolute filesystem path to the source .tre archive.
 * @param edits       Optional array of { index, data } edits (entries to replace).
 *                    Entries NOT in edits are copied verbatim (raw-slice identity).
 * @param version     Version for the output archive (default: same as source / '0005').
 * @returns           Complete repacked .tre archive bytes as ArrayBuffer.
 *
 * Source: modules/core/tre/TreBuilder.h TreBuilder::repack();
 *         Utinni TreWriter.cs:166-174 (per-record raw-slice identity);
 *         swg-client-v2 TreeFileBuilder.cpp:773-833 (block order).
 */
export function repackTre(
  sourcePath: string,
  edits?: TreRepackEditNative[],
  version?: string,
): ArrayBuffer;

// ─── Phase 2 Plan 02-01: mesh + support format parsers ────────────────────────

/** Byte-range slice descriptor for one attribute in the geometry ArrayBuffer. */
export interface MeshAttributeSlice {
  offset: number;       // byte offset within geometry buffer
  byteLength: number;   // byte length of this attribute's data
  componentCount: number; // scalar components per element (e.g. 3 for xyz)
  elementCount: number;   // number of elements (usually vertexCount or indexCount)
}

/** One shader group (draw call) in a parsed mesh. */
export interface MeshShaderGroup {
  shaderName: string;
  vertexCount: number;
  indexCount: number;
  positions: MeshAttributeSlice;   // Float32 xyz
  normals: MeshAttributeSlice;     // Float32 xyz (byteLength=0 if absent)
  uvs: MeshAttributeSlice[];        // Float32 uv sets; uvs[0] = primary UV (byteLength=0 if absent)
  indices: MeshAttributeSlice;     // Uint32 triangle indices
  skinIndices: MeshAttributeSlice; // Int32 vec4 (byteLength=0 for static .msh)
  skinWeights: MeshAttributeSlice; // Float32 vec4 (byteLength=0 for static .msh)
  hasDot3: boolean;
}

/** Result of parseMesh() — static .msh mesh. */
export interface MeshParseResult {
  formatTag: string;          // 'MESH'
  version: string;            // e.g. '0005'
  shaderGroups: MeshShaderGroup[];
  geometry: ArrayBuffer;      // packed binary attribute data (binary stays binary)
  weightsTruncated: number;
}

/**
 * Parse a FORM MESH static mesh.
 * Source: swg-client-v2 MeshAppearanceTemplate.cpp + ShaderPrimitiveSetTemplate.cpp + VertexBuffer.cpp
 */
export function parseMesh(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): MeshParseResult;

/** Result of parseMeshLod() — LOD mesh generator .lmg. */
export interface MeshLodParseResult {
  formatTag: string;   // 'MLOD'
  version: string;
  levelCount: number;
  levels: Array<{ path: string }>;
}

export function parseMeshLod(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): MeshLodParseResult;

/** Result of parseLodDistanceTable() — .ldt distance table. */
export interface LodDistanceTableParseResult {
  formatTag: string;   // 'LDTB'
  version: string;
  levelCount: number;
  levels: Array<{ minDist: number; maxDist: number }>;
}

export function parseLodDistanceTable(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): LodDistanceTableParseResult;

/** One texture slot from a parsed .sht shader. */
export interface ShaderSlot {
  slot: string;
  texturePath: string;
  uvSet: number;
  isPlaceholder: boolean;
}

/** Result of parseShader() — static shader template .sht. */
export interface ShaderParseResult {
  variant: string;      // 'SSHT', 'DPAT', etc.
  version: string;
  effectPath: string;
  slots: ShaderSlot[];
  customizationVars: unknown[];
}

export function parseShader(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): ShaderParseResult;

/** Result of parsePalette() — RIFF PAL palette. */
export interface PaletteParseResult {
  entryCount: number;
  versionOrComponentCount: number;
  entries: Array<{ r: number; g: number; b: number; a: number }>;
  roundTripBytes: ArrayBuffer;
}

export function parsePalette(bytes: ArrayBuffer | Uint8Array): PaletteParseResult;

/** One mip level from a parsed .dds texture. */
export interface DdsMip {
  offset: number;
  byteLength: number;
  width: number;
  height: number;
}

/** Result of parseDds() — Microsoft DDS texture. */
export interface DdsParseResult {
  width: number;
  height: number;
  mipCount: number;
  format: string;      // 'DXT1', 'DXT3', 'DXT5', 'RGBA8', etc.
  /**
   * True when the DDS file is a cube map (dwCaps2 / dwComplexFlags has DDSCAPS2_CUBEMAP = 0x200).
   * When true, mips[] contains 6*mipCount entries in face-major order:
   *   face[i] base mip = mips[i * mipCount + 0]  (i in 0..5: +X, -X, +Y, -Y, +Z, -Z)
   * Source: Microsoft DDS spec + DDSCAPS2_CUBEMAP flag.
   */
  isCubemap: boolean;
  mips: DdsMip[];
  roundTripBytes: ArrayBuffer;
}

export function parseDds(bytes: ArrayBuffer | Uint8Array): DdsParseResult;

// ─── Phase 2 Plan 02-02: skeletal mesh + appearance parsers ──────────────────

/**
 * Result of parseSkeletalMesh() — skeletal mesh .mgn (FORM SKMG).
 * Same shaderGroups shape as MeshParseResult but with skinIndices/skinWeights populated.
 * Source: swg-client-v2 SkeletalMeshGeneratorTemplate.cpp:2247-2360
 */
export interface SkeletalMeshParseResult {
  formatTag: string;          // 'SKMG'
  version: string;            // '0002', '0003', or '0004'
  shaderGroups: MeshShaderGroup[];
  geometry: ArrayBuffer;      // packed binary (binary stays binary)
  boneNames: string[];        // XFNM transform/bone name table
  sktmNames: string[];        // inner SKTM skeleton-template path strings
  weightsTruncated: number;   // count of vertices where >4 influences were truncated
  needsBoneRemap: boolean;    // true when no boneOrder was supplied
}

/**
 * Parse a FORM SKMG skeletal mesh.
 * @param boneOrder  Optional resolved skeleton bone names for XFNM→bone index remap.
 *                   When empty/omitted, skinIndices use XFNM-local indices (needsBoneRemap=true).
 */
export function parseSkeletalMesh(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
  boneOrder?: string[],
): SkeletalMeshParseResult;

/** One bone in a parsed skeleton. */
export interface BoneInfo {
  name: string;
  parentIndex: number;    // -1 for root
  preRot: number[];       // [w,x,y,z] on-disk quaternion from RPRE chunk
  postRot: number[];      // [w,x,y,z] on-disk quaternion from RPST chunk
  bindPos: number[];      // [x,y,z] pre-translation from BPTR
  preRotOff: number[];    // [x,y,z] pre-rotation-offset from BPRO
}

/**
 * Result of parseSkeleton() — skeleton template .skt (FORM SKTM).
 * Source: swg-client-v2 BasicSkeletonTemplate.cpp:151-390
 */
export interface SkeletonParseResult {
  formatTag: string;     // 'SKTM'
  version: string;       // '0001' or '0002'
  boneNames: string[];   // ordered bone name list (same order as bones[])
  bones: BoneInfo[];
}

/**
 * Parse a FORM SKTM skeleton.
 * Throws if root is FORM SLOD (not FORM SKTM) — delta #7.
 */
export function parseSkeleton(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): SkeletonParseResult;

/** One skeleton reference in a skeletal appearance. */
export interface SkeletonRef {
  skeletonPath: string;
  attachmentTransformName: string;
}

/**
 * Result of parseSkeletalAppearance() — skeletal appearance .sat (FORM SMAT).
 * Source: swg-client-v2 SkeletalAppearanceTemplate.cpp:786-1136
 */
export interface SkeletalAppearanceParseResult {
  formatTag: string;            // 'SMAT'
  version: string;              // '0001', '0002', or '0003'
  filename: string;             // INFO string (animGraphTemplateName or filename)
  meshPaths: string[];          // MSGN mesh generator paths
  skeletonRefs: SkeletonRef[];  // SKTI (skeletonPath, attachmentTransformName) pairs
}

/**
 * Parse a FORM SMAT skeletal appearance.
 */
export function parseSkeletalAppearance(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): SkeletalAppearanceParseResult;

/**
 * Result of parseStaticAppearance() — static appearance redirector .apt (FORM APT).
 * Source: swg-client-v2 AppearanceTemplateList.cpp:513-540
 */
export interface StaticAppearanceParseResult {
  formatTag: string;      // 'APT'
  redirectTarget: string; // the single redirect target path (never ends with .apt)
}

/**
 * Parse a FORM APT static appearance redirector.
 * Throws if redirectTarget ends with '.apt' (T-02-08: no multi-level indirection).
 */
export function parseStaticAppearance(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): StaticAppearanceParseResult;

// ─── Phase 2 Plan 02-02 gap-closure: DetailAppearance (.lod / FORM DTLA) ─────

/**
 * One LOD level in a parsed DTLA detail appearance.
 *
 * childPath is the raw name from the CHLD chunk, relative to the appearance/ tree.
 * Caller MUST prepend "appearance/" to get the full VFS path.
 * Source: DetailAppearanceTemplate.cpp:378 (FileName(P_appearance, name)).
 */
export interface DetailAppearanceLevel {
  /** Int32 child id (shared key between INFO and CHLD entries). */
  id: number;
  /** Raw float32 near display distance (NOT pre-squared). */
  near: number;
  /** Raw float32 far display distance (NOT pre-squared). */
  far: number;
  /**
   * Raw child appearance name from CHLD chunk (e.g. "mesh/wb_02_09e_..._.msh").
   * MUST prepend "appearance/" to resolve in the VFS.
   * Source: DetailAppearanceTemplate.cpp:378 (FileName(P_appearance, name)).
   */
  childPath: string;
}

/**
 * Result of parseDetailAppearance() — detail LOD appearance .lod (FORM DTLA).
 *
 * levels are sorted by farDistance descending (matching the client's std::sort childSorter).
 * Source: swg-client-v2 DetailAppearanceTemplate.cpp:556-658 (load()) + :343-417 (loadEntries()).
 * Verified 2026-06-24 against wb_02_09e_00000000000000000000.lod (362 bytes, version 0007).
 */
export interface DetailAppearanceParseResult {
  formatTag: string;               // 'DTLA'
  versionTag: string;              // '0001'..'0008' (e.g. '0007')
  lodFlags: number;                // uint8 from PIVT chunk (0 if version < 6)
  levels: DetailAppearanceLevel[]; // LOD levels sorted by far desc
}

/**
 * Parse a FORM DTLA detail LOD appearance descriptor.
 *
 * Source: swg-client-v2 DetailAppearanceTemplate.cpp:556-658 (load()) + :343-417 (loadEntries()).
 * Ground-truth verified against real wb_02_09e_00000000000000000000.lod (362 bytes, 2026-06-24).
 */
export function parseDetailAppearance(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): DetailAppearanceParseResult;

// ─── Phase 2 Plan 02-03 gap-closure: Effect (.eft FORM EFCT) ─────────────────

/**
 * Blend state extracted from a PASS DATA chunk in an EFCT IMPL.
 * Source: swg-client-v2 ShaderImplementation.cpp:1692-1738 (load_0009 DATA layout).
 */
export interface EffectBlend {
  alphaBlendEnable: boolean;
  blendOperation:   number;  // BlendOperation enum (1 = ADD)
  blendSrc:         number;  // Blend enum (5 = SRC_ALPHA)
  blendDst:         number;  // Blend enum (6 = INV_SRC_ALPHA)
  alphaTestEnable:  boolean;
  alphaTestFunc:    number;  // Compare enum (7 = GREATER)
  alphaTestRef:     number;  // 0-255 reference value
  zWrite:           boolean;
}

/**
 * One texture sampler from a PTXM entry in a PPSH.
 * Source: swg-client-v2 ShaderImplementation.cpp:3175-3181 (load_0002).
 */
export interface EffectSampler {
  /** Hardware sampler slot index (0-based). */
  index: number;
  /**
   * Semantic role decoded from the PTXM textureTag.
   * Examples: "MAIN", "SPEC", "ENVM", "CNRM", "NRML", "EMIS", "MASK".
   * PTXM tag is stored as LE uint32 DATA payload (bytes 4E 49 41 4D = "MAIN" LE).
   */
  role: string;
}

/**
 * One capability-tier IMPL from an EFCT.
 * Source: swg-client-v2 ShaderImplementation.cpp:180-236 (load + version dispatch).
 */
export interface EffectImpl {
  /** Raw SCAP int32 values from the SCAP chunk (used for capability selection). */
  scapValues: number[];
  /** Optional tags from the OPTN chunk (e.g. "DOT3", "HIQL"). */
  options: string[];
  /** Blend state from the first PASS DATA chunk. */
  blend: EffectBlend;
  /** Sampler role map from all PTXM entries in the PPSH. */
  samplers: EffectSampler[];
}

/**
 * Full result of parseEffect() — shader effect .eft (FORM EFCT).
 *
 * Contains all IMPL capability tiers. bestImplIndex is the selected IMPL:
 * the one with the highest max SCAP value that has sampler entries.
 * Use impls[bestImplIndex] to get the sampler role map for the renderer.
 *
 * Source: swg-client-v2 ShaderEffect.cpp:86-179 (EFCT load_0000/0001).
 */
export interface EffectParseResult {
  formatTag:     string;       // 'EFCT'
  version:       string;       // '0000' or '0001'
  bestImplIndex: number;       // index into impls[] (-1 if no suitable IMPL)
  impls:         EffectImpl[]; // all IMPLs in file order
}

/**
 * Parse a FORM EFCT shader effect from an already-parsed IFF tree.
 *
 * Walks all IMPL tiers, extracting SCAP levels, OPTN tags, blend state (PASS DATA),
 * and sampler role map (PTXM entries in PPSH).
 *
 * The .eft is a NEW binary format — callers must not hard-code any sampler roles.
 * Use impls[bestImplIndex].samplers to discover the actual role→index mapping.
 *
 * Source: swg-client-v2 ShaderEffect.cpp:86-179
 *         + ShaderImplementation.cpp:1692-1738, 2600-2651, 3113-3181.
 */
export function parseEffect(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): EffectParseResult;

// ─── Animation (.ans) ─────────────────────────────────────────────────────────

/**
 * Identifies the animation format variant.
 *
 * - 'CKAT-0001': compressed keyframe animation (FORM CKAT, version 0001).
 *   Rotation keys use CompressedQuaternion (verbatim port of swg-client-v2).
 * - 'KFAT-0003': uncompressed keyframe animation (FORM KFAT, version 0003).
 *   Rotation keys use raw float quaternions (w, x, y, z).
 * - 'KFAT-0002-unsupported': legacy Euler animation (version 0002). Detected and
 *   immediately declined — variant is returned, fps/frameCount are 0, no keys.
 */
export type AnimationVariant = 'CKAT-0001' | 'KFAT-0003' | 'KFAT-0002-unsupported';

/**
 * Per-joint metadata for a skeletal animation.
 *
 * Source: swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:553-594 (CKAT XFRM),
 *         KeyframeSkeletalAnimationTemplate.cpp:521-553 (KFAT XFRM).
 */
export interface AnimationJoint {
  /** Bone name string from XFRM NAME chunk. */
  name: string;
  /** True if the rotation channel is animated (not static). */
  hasAnimatedRotation: boolean;
  /**
   * Index into channelTable.rotationChannels[] for this joint's rotation data.
   * -1 if hasAnimatedRotation is false (use staticRotations instead).
   */
  rotationChannelIndex: number;
  /**
   * Bitmask indicating which translation axes are animated.
   * Bit 0 = X, bit 1 = Y, bit 2 = Z. 0 = no translation animation.
   */
  translationMask: number;
  /**
   * Indices into channelTable.translationChannels[] for [X, Y, Z].
   * -1 for axes not animated (translationMask bit = 0).
   */
  translationChannelIndex: [number, number, number];
}

/**
 * Header descriptor for a sparse keyframe channel in the keyframeBuffer.
 * Use byteOffset to seek into AnimationParseResult.keyframes.
 *
 * Rotation channel layout at byteOffset:
 *   int32  keyCount
 *   int32  frame[keyCount]
 *   float  (w, x, y, z)[keyCount * 4]   // on-disk quaternion order
 *
 * Translation channel layout at byteOffset:
 *   int32  keyCount
 *   int32  frame[keyCount]
 *   float  value[keyCount]
 */
export interface AnimationChannelHeader {
  byteOffset: number;
  keyCount: number;
}

/**
 * Channel lookup table for an animation result.
 * All byte offsets are relative to the start of AnimationParseResult.keyframes.
 */
export interface AnimationChannelTable {
  /** One entry per animated rotation channel (in XFRM order). */
  rotationChannels: AnimationChannelHeader[];
  /**
   * Byte offset of the static rotation block in keyframes.
   * Each static rotation is 4 floats: (w, x, y, z). Stride = 16 bytes.
   */
  staticRotByteOffset: number;
  /** Number of static rotations (one per non-animated joint with a static rotation). */
  staticRotationCount: number;
  /** One entry per animated translation channel (in XFRM/CHNL order). */
  translationChannels: AnimationChannelHeader[];
  /**
   * Byte offset of the static translation block in keyframes.
   * Each static translation is 1 float. Stride = 4 bytes.
   */
  staticTransByteOffset: number;
  /** Number of static translations. */
  staticTranslationCount: number;
}

/**
 * Result of parseAnimation().
 *
 * Binary data (keyframes ArrayBuffer) is zero-copy across the N-API bridge
 * (AGENTS.md: binary-stays-binary). All counts are on-disk values — no decimation.
 */
export interface AnimationParseResult {
  /** Format variant. */
  variant: AnimationVariant;
  /** Playback rate in frames per second (0 for unsupported variants). */
  fps: number;
  /** Total frame count (0 for unsupported variants). */
  frameCount: number;
  /** Per-joint metadata in XFRM order. Empty for unsupported variants. */
  joints: AnimationJoint[];
  /**
   * Sparse keyframe binary buffer.
   *
   * Contains packed rotation channels, static rotations, translation channels,
   * and static translations in order. Use channelTable to navigate offsets.
   * Quaternion order is on-disk (w, x, y, z); THREE.Quaternion.set(x,y,z,w) at render time.
   *
   * Zero allocation per-frame: callers should read directly from this buffer
   * using DataView with module-scope scratch objects (Decision D-09).
   */
  keyframes: ArrayBuffer;
  /** Byte-offset and key-count lookup table for the keyframes buffer. */
  channelTable: AnimationChannelTable;
  /** CORE-05 round-trip gate result. */
  roundTrip: { passed: boolean; failOffset?: number };
}

/**
 * Parse a FORM CKAT or FORM KFAT skeletal animation from an already-parsed IFF tree.
 *
 * Supported variants:
 *   - CKAT-0001: compressed quaternion keyframes (uses CompressedQuaternion verbatim port)
 *   - KFAT-0003: uncompressed float quaternion keyframes
 *   - KFAT-0002: detected and immediately declined (no exception, variant='KFAT-0002-unsupported')
 *
 * Security caps (T-02-16): transformInfoCount ≤ 2048, keyCount ≤ 100000, name length ≤ 256 bytes.
 *
 * Source:
 *   swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313 (CKAT)
 *   swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1518-1620 (KFAT)
 *   swg-client-v2 CompressedQuaternion.cpp:82-419 (verbatim port)
 */
export function parseAnimation(
  iffResult: IffParseResultNative,
  srcBytes: ArrayBuffer | Uint8Array,
): AnimationParseResult;
