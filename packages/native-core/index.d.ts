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
  uvs: MeshAttributeSlice;         // Float32 uv (byteLength=0 if absent)
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
  slotTag: string;
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
