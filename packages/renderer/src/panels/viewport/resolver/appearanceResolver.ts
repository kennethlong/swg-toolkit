/**
 * packages/renderer/src/panels/viewport/resolver/appearanceResolver.ts
 *
 * Cross-TRE SMAT→MLOD→SKMG→SKTM→SSHT + APT→MESH dependency graph walker.
 *
 * D-03 smart-open modes:
 *   .sat  → 'composed'        (skinned: parseSkeletalAppearance → MSGN/SKTI)
 *   .apt  → 'composed-static' (static:  parseStaticAppearance  → redirect → parse by ext)
 *   .mgn  → 'leaf'            (skinned  leaf)
 *   .msh  → 'leaf'            (static   leaf)
 *
 * D-04 partial resolution: NEVER throw on missing entries — collect path in missing[] and
 * continue with null placeholders. The renderer shows a ⚠ warning, not a crash.
 *
 * T-02-09 security: all dependency paths go through nativeCore.resolveEntry(mountHandle, name).
 * Paths with drive letters, leading '/', or '..' segments are rejected before calling resolveEntry.
 *
 * Source analog: packages/renderer/src/state/treStore.ts
 */

import type {
  MeshParseResult,
  SkeletonParseResult,
  ShaderParseResult,
  ShaderSlotName,
  LodLevel,
} from '@swg/contracts';
import { mergeSkeletons, type SkeletonSegment } from './mergeSkeletons.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** One resolved mesh (de-indexed geometry + shader group metadata). */
export interface ResolvedMesh {
  /** Normalized VFS path to the .mgn or .msh source. */
  path: string;
  /** Parsed mesh result (shaderGroups + geometry ArrayBuffer). */
  parseResult: MeshParseResult;
  /** Geometry ArrayBuffer (binary — stays binary, not re-packed). */
  geometry: ArrayBuffer;
}

/** Resolved skeleton data. */
export interface ResolvedSkeleton {
  path: string;
  parseResult: SkeletonParseResult;
}

/**
 * One resolved material/shader for a shader-group index.
 * 02-03 reads slotBytes[slot] to build CompressedTexture without re-fetching.
 * Indexed by shader-group (NOT by mesh) for multi-PSDT meshes.
 *
 * Gap-closure (02-03): effectResult carries the parsed .eft sampler role map + blend state.
 * slotBytes[ENVM] is populated when the shader's ENVM slot has a texturePath (e.g. env_theed.dds).
 */
export interface ResolvedMaterial {
  shaderResult: ShaderParseResult;
  /** Per texture slot → raw bytes (null when that slot's entry was missing). */
  slotBytes: Partial<Record<ShaderSlotName, ArrayBuffer | null>>;
  /**
   * Parsed .eft effect result (null when effectPath is empty or the .eft could not be fetched).
   * Contains the sampler role map (impls[bestImplIndex].samplers) and blend state.
   * Gap-closure 02-03: this drives material transparent/alphaTest/depthWrite settings.
   */
  effectResult: EffectParseResult | null;
}

/** Minimal shape of the effect parse result needed by the renderer. */
export interface EffectParseResult {
  formatTag: string;
  version: string;
  bestImplIndex: number;
  impls: Array<{
    scapValues: number[];
    options: string[];
    blend: {
      alphaBlendEnable: boolean;
      blendOperation: number;
      blendSrc: number;
      blendDst: number;
      alphaTestEnable: boolean;
      alphaTestFunc: number;
      alphaTestRef: number;
      zWrite: boolean;
    };
    samplers: Array<{ index: number; role: string }>;
  }>;
}

/**
 * One renderable part of a composed skinned appearance.
 * A multi-part .sat (e.g. ackbar = head + arms + body) has one ResolvedAppearancePart
 * per mesh generator, each with its OWN per-LOD meshes + materials. All parts share the
 * single merged skeleton (AppearanceResolutionResult.skeleton).
 */
export interface ResolvedAppearancePart {
  /** Source meshPath (e.g. "appearance/mesh/ackbar_body.lmg") — diagnostics. */
  meshPath: string;
  /** Per-LOD meshes for THIS part (index = LOD level; null = placeholder). */
  meshesByLod: (ResolvedMesh | null)[];
  /** Materials for THIS part, indexed by shader group (from this part's LOD 0). */
  materials: ResolvedMaterial[];
}

/** Full appearance resolution result. */
export interface AppearanceResolutionResult {
  /** Per-LOD mesh list (null entries = placeholder when mesh could not be resolved). */
  meshes: (ResolvedMesh | null)[];
  /** Resolved skeleton (null if static or skeleton not found). For multi-skeleton .sat this
   *  is the MERGED skeleton; `skeleton.path` stays the MAIN/first skeleton path (so the
   *  .ans picker heuristic keeps working). */
  skeleton: ResolvedSkeleton | null;
  /** Resolved shader groups + texture bytes, indexed by shader-group. */
  materials: ResolvedMaterial[];
  /** Names of every dependency that could NOT be resolved from the VFS. */
  missing: string[];
  /** Open mode (D-03 smart-open). */
  mode: 'composed' | 'composed-static' | 'leaf';
  /** True = SkinnedMeshView; false = StaticMeshView. */
  isSkinned: boolean;
  /** LOD levels from .lmg (empty for non-LOD assets). */
  lodLevels: LodLevel[];
  /**
   * Composed skinned parts (multi-part .sat). Present ONLY for the composed .sat path
   * (one entry even for a single-part .sat). When undefined, consumers use the legacy
   * single-mesh path (`meshes`). Each part renders at the shared selectedLod.
   */
  parts?: ResolvedAppearancePart[];
  /** Skeleton-ref metadata (path + attachment transform) for every segment of a .sat. */
  skeletonSegments?: Array<{ path: string; attachmentTransformName: string }>;
}

// ─── nativeCore binding ──────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-require-imports */
const nativeCore = require('@swg/native-core') as {
  resolveEntry: (handle: string, name: string) => { winner: string | null; tombstone: boolean; archiveIndex: number; entryIndex: number };
  readMountEntry: (handle: string, archiveIndex: number, entryIndex: number) => ArrayBuffer;
  parseIff: (bytes: ArrayBuffer | Uint8Array) => unknown;
  serializeIff: (parseResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => ArrayBuffer;
  parseSkeletalAppearance: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => {
    formatTag: string;
    version: string;
    filename: string;
    meshPaths: string[];
    skeletonRefs: Array<{ skeletonPath: string; attachmentTransformName: string }>;
  };
  parseStaticAppearance: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => {
    formatTag: string;
    redirectTarget: string;
  };
  parseMesh: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => {
    formatTag: string;
    version: string;
    shaderGroups: Array<{
      shaderName: string;
      vertexCount: number;
      indexCount: number;
      positions: { offset: number; byteLength: number; componentCount: number; elementCount: number };
      normals: { offset: number; byteLength: number; componentCount: number; elementCount: number } | null;
      uvs: Array<{ offset: number; byteLength: number; componentCount: number; elementCount: number }>;
      indices: { offset: number; byteLength: number; componentCount: number; elementCount: number };
      skinIndices: { offset: number; byteLength: number; componentCount: number; elementCount: number } | null;
      skinWeights: { offset: number; byteLength: number; componentCount: number; elementCount: number } | null;
      hasDot3: boolean;
    }>;
    boneNames?: string[];
    weightsTruncated?: number;
    roundTrip: { passed: boolean; failOffset?: number };
    geometry: ArrayBuffer;
  };
  parseSkeletalMesh: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array, boneOrder?: string[]) => {
    formatTag: string;
    version: string;
    shaderGroups: Array<{
      shaderName: string;
      vertexCount: number;
      indexCount: number;
      positions: { offset: number; byteLength: number; componentCount: number; elementCount: number };
      normals: { offset: number; byteLength: number; componentCount: number; elementCount: number } | null;
      uvs: Array<{ offset: number; byteLength: number; componentCount: number; elementCount: number }>;
      indices: { offset: number; byteLength: number; componentCount: number; elementCount: number };
      skinIndices: { offset: number; byteLength: number; componentCount: number; elementCount: number } | null;
      skinWeights: { offset: number; byteLength: number; componentCount: number; elementCount: number } | null;
      hasDot3: boolean;
    }>;
    boneNames: string[];
    sktmNames: string[];
    weightsTruncated: number;
    needsBoneRemap: boolean;
    roundTrip: { passed: boolean; failOffset?: number };
    geometry: ArrayBuffer;
  };
  parseSkeleton: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => {
    formatTag: string;
    version: string;
    boneNames: string[];
    bones: Array<{
      name: string;
      parentIndex: number;
      preRot: number[];      // RPRE preMultiply (w,x,y,z)
      postRot: number[];     // RPST postMultiply (w,x,y,z)
      bindPos: number[];     // BPTR bind translation (x,y,z)
      bindPoseRot: number[]; // BPRO bind-pose rotation (w,x,y,z) — 4 floats
    }>;
  };
  parseMeshLod: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => {
    formatTag: string;
    version: string;
    levelCount: number;
    levels: Array<{ path: string }>;
  };
  parseDetailAppearance: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => {
    formatTag: string;
    versionTag: string;
    lodFlags: number;
    levels: Array<{ id: number; near: number; far: number; childPath: string }>;
  };
  parseShader: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => ShaderParseResult;
  parseEffect: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => EffectParseResult;
};
/* eslint-enable @typescript-eslint/no-require-imports */

// ─── Security helper (T-02-09) ───────────────────────────────────────────────

/**
 * Reject any path that looks like an absolute path or path-traversal attempt.
 * Only VFS-relative paths are safe to pass to resolveEntry.
 */
function isUnsafePath(p: string): boolean {
  if (!p || typeof p !== 'string') return true;
  // Drive letter (Windows): "C:", "D:", etc.
  if (/^[A-Za-z]:/.test(p)) return true;
  // Leading slash (Unix absolute)
  if (p.startsWith('/') || p.startsWith('\\')) return true;
  // Path traversal
  if (p.includes('..')) return true;
  return false;
}

// ─── VFS helpers ─────────────────────────────────────────────────────────────

/** Resolve and read a VFS entry. Returns null (and pushes to missing[]) if not found or unsafe. */
async function fetchEntry(
  mountHandle: string,
  name: string,
  missing: string[],
): Promise<ArrayBuffer | null> {
  if (isUnsafePath(name)) {
    missing.push(`[rejected-unsafe-path] ${name}`);
    return null;
  }
  const resolved = nativeCore.resolveEntry(mountHandle, name);
  // resolveEntry returns { winner, tombstone, archiveIndex, entryIndex } — there is NO `found`
  // field. A real hit has a non-null winner and is not a tombstone (negative override / deletion).
  if (resolved.winner === null || resolved.tombstone) {
    missing.push(name);
    return null;
  }
  return nativeCore.readMountEntry(mountHandle, resolved.archiveIndex, resolved.entryIndex);
}

/** Parse IFF bytes. Returns null on error (pushes to missing[]). */
function parseIffSafe(
  bytes: ArrayBuffer,
  path: string,
  missing: string[],
): unknown | null {
  try {
    return nativeCore.parseIff(new Uint8Array(bytes));
  } catch (_e) {
    missing.push(`[iff-parse-error] ${path}`);
    return null;
  }
}

// ─── Skeleton resolver ───────────────────────────────────────────────────────

async function resolveSkeleton(
  mountHandle: string,
  skeletonPath: string,
  missing: string[],
): Promise<{ result: ResolvedSkeleton; boneOrder: string[] } | null> {
  const bytes = await fetchEntry(mountHandle, skeletonPath, missing);
  if (!bytes) return null;
  const iff = parseIffSafe(bytes, skeletonPath, missing);
  if (!iff) return null;
  try {
    const parsed = nativeCore.parseSkeleton(iff, new Uint8Array(bytes));
    const skeletonResult: SkeletonParseResult = {
      version: parsed.version,
      bones: parsed.bones.map(b => ({
        name: b.name,
        parentIndex: b.parentIndex,
        bindTranslation: [b.bindPos[0] ?? 0, b.bindPos[1] ?? 0, b.bindPos[2] ?? 0],
        // All quaternions kept in on-disk (w,x,y,z) order; the renderer reorders to (x,y,z,w).
        preMultiplyRotation:  [b.preRot[0] ?? 1, b.preRot[1] ?? 0, b.preRot[2] ?? 0, b.preRot[3] ?? 0],
        postMultiplyRotation: [b.postRot[0] ?? 1, b.postRot[1] ?? 0, b.postRot[2] ?? 0, b.postRot[3] ?? 0],
        bindPoseRotation:     [b.bindPoseRot[0] ?? 1, b.bindPoseRot[1] ?? 0, b.bindPoseRot[2] ?? 0, b.bindPoseRot[3] ?? 0],
      })),
      roundTrip: { passed: true },
    };
    return {
      result: { path: skeletonPath, parseResult: skeletonResult },
      boneOrder: parsed.boneNames,
    };
  } catch (_e) {
    missing.push(`[skeleton-parse-error] ${skeletonPath}`);
    return null;
  }
}

// ─── Shader + texture resolver ───────────────────────────────────────────────

async function resolveShader(
  mountHandle: string,
  shaderPath: string,
  missing: string[],
): Promise<ResolvedMaterial | null> {
  if (!shaderPath || isUnsafePath(shaderPath)) {
    missing.push(`[unsafe-shader-path] ${shaderPath}`);
    return null;
  }
  const bytes = await fetchEntry(mountHandle, shaderPath, missing);
  if (!bytes) return null;
  const iff = parseIffSafe(bytes, shaderPath, missing);
  if (!iff) return null;
  let shaderResult: ShaderParseResult;
  try {
    shaderResult = nativeCore.parseShader(iff, new Uint8Array(bytes));
  } catch (_e) {
    missing.push(`[shader-parse-error] ${shaderPath}`);
    return null;
  }

  // Fetch texture bytes for each slot (D-04: missing slot → null bytes, not a throw).
  // Gap-closure 02-03: ENVM slots now have a texturePath (env_theed.dds) — fetch it too.
  // Bug-1 fix: the native parser now preserves ENVM.texturePath so we can fetch it here.
  const slotBytes: Partial<Record<ShaderSlotName, ArrayBuffer | null>> = {};
  for (const slot of shaderResult.slots) {
    if (!slot.texturePath) {
      slotBytes[slot.slot] = null;
      continue;
    }
    const texBytes = await fetchEntry(mountHandle, slot.texturePath, missing);
    slotBytes[slot.slot] = texBytes;
  }

  // Gap-closure 02-03 Task 4: fetch + parse the .eft when effectPath is set.
  // Bug-2 fix: the native parser now populates effectPath from the NAME chunk in the .sht.
  // We parse it here and attach it to ResolvedMaterial so the renderer can use the
  // sampler role map (impls[bestImplIndex].samplers) and blend state.
  let effectResult: EffectParseResult | null = null;
  const effectPath = shaderResult.effectPath;
  if (effectPath && effectPath !== '' && !effectPath.includes('__inline')) {
    try {
      const eftBytes = await fetchEntry(mountHandle, effectPath, missing);
      if (eftBytes) {
        const eftIff = parseIffSafe(eftBytes, effectPath, missing);
        if (eftIff) {
          effectResult = nativeCore.parseEffect(eftIff, new Uint8Array(eftBytes));
        }
      }
    } catch (_e) {
      // Effect parse failure is non-fatal; renderer falls back to opaque defaults
    }
  }

  return { shaderResult, slotBytes, effectResult };
}

// ─── Mesh resolver ───────────────────────────────────────────────────────────

async function resolveMgnMesh(
  mountHandle: string,
  mgnPath: string,
  boneOrder: string[],
  missing: string[],
): Promise<ResolvedMesh | null> {
  const bytes = await fetchEntry(mountHandle, mgnPath, missing);
  if (!bytes) return null;
  const iff = parseIffSafe(bytes, mgnPath, missing);
  if (!iff) return null;
  try {
    const u8 = new Uint8Array(bytes);
    const parsed = nativeCore.parseSkeletalMesh(iff, u8, boneOrder.length > 0 ? boneOrder : undefined);
    return {
      path: mgnPath,
      parseResult: parsed as unknown as MeshParseResult,
      geometry: parsed.geometry,
    };
  } catch (_e) {
    missing.push(`[skmg-parse-error] ${mgnPath}`);
    return null;
  }
}

async function resolveMshMesh(
  mountHandle: string,
  mshPath: string,
  missing: string[],
): Promise<ResolvedMesh | null> {
  const bytes = await fetchEntry(mountHandle, mshPath, missing);
  if (!bytes) return null;
  const iff = parseIffSafe(bytes, mshPath, missing);
  if (!iff) return null;
  try {
    const u8 = new Uint8Array(bytes);
    const parsed = nativeCore.parseMesh(iff, u8);
    return {
      path: mshPath,
      parseResult: parsed as unknown as MeshParseResult,
      geometry: parsed.geometry,
    };
  } catch (_e) {
    missing.push(`[mesh-parse-error] ${mshPath}`);
    return null;
  }
}

/** Collect shader groups across all resolved meshes for material resolution. */
async function resolveMeshMaterials(
  mountHandle: string,
  resolvedMesh: ResolvedMesh | null,
  missing: string[],
): Promise<ResolvedMaterial[]> {
  if (!resolvedMesh) return [];
  const materials: ResolvedMaterial[] = [];
  for (const group of resolvedMesh.parseResult.shaderGroups) {
    const mat = await resolveShader(mountHandle, group.shaderName, missing);
    materials.push(mat ?? { shaderResult: createPlaceholderShader(group.shaderName), slotBytes: {}, effectResult: null });
  }
  return materials;
}

function createPlaceholderShader(effectPath: string): ShaderParseResult {
  return {
    variant: 'SSHT',
    effectPath,
    slots: [],
    customizationVars: [],
    roundTrip: { passed: false },
  };
}

// ─── Detail LOD appearance resolver (.lod / FORM DTLA) ───────────────────────
//
// Called for both APT → .lod redirects AND direct leaf .lod opens.
// Source: DetailAppearanceTemplate.cpp:556-658 (load()) + :343-417 (loadEntries())
// Child path rule: name from CHLD is relative to appearance/; prepend "appearance/".
// Source: DetailAppearanceTemplate.cpp:378 (FileName(P_appearance, name)).
//
// Returns { meshes, lodLevels } — same shape as resolveLodMesh for API consistency.

async function resolveDetailAppearanceLod(
  mountHandle: string,
  lodPath: string,
  missing: string[],
): Promise<{ meshes: (ResolvedMesh | null)[]; lodLevels: LodLevel[] }> {
  const bytes = await fetchEntry(mountHandle, lodPath, missing);
  if (!bytes) return { meshes: [null], lodLevels: [] };
  const iff = parseIffSafe(bytes, lodPath, missing);
  if (!iff) return { meshes: [null], lodLevels: [] };

  let dtlaData: { levels: Array<{ id: number; near: number; far: number; childPath: string }> };
  try {
    dtlaData = nativeCore.parseDetailAppearance(iff, new Uint8Array(bytes));
  } catch (_e) {
    missing.push(`[dtla-parse-error] ${lodPath}`);
    return { meshes: [null], lodLevels: [] };
  }

  if (dtlaData.levels.length === 0) {
    missing.push(`[dtla-no-levels] ${lodPath}`);
    return { meshes: [null], lodLevels: [] };
  }

  // Order LODs highest-detail-first so meshes[0] / selectedLod=0 is the FULL-detail mesh
  // (l0, near=0), not the distant imposter LOD. DTLA stores levels far-descending
  // (meshes[0] would otherwise be the crudest l3, near=20/far=1000), so opening an object
  // would show its lowest-detail LOD up close. Sort by `near` ascending = best detail first;
  // the LodPicker then lists LOD0=best…LODn=worst (the universal convention).
  const sortedLevels = [...dtlaData.levels].sort((a, b) => a.near - b.near || a.far - b.far);

  // Build lodLevels with real near/far from DTLA INFO.
  // Source: DetailAppearanceTemplate.cpp:349-361 (near/far from INFO chunk).
  const lodLevels: LodLevel[] = sortedLevels.map(lv => ({
    // generatorPath = full VFS path (prepend "appearance/" to raw CHLD name)
    // Source: DetailAppearanceTemplate.cpp:378 (FileName(P_appearance, name))
    generatorPath: `appearance/${lv.childPath}`,
    minDist: lv.near,
    maxDist: lv.far,
  }));

  // Resolve all LOD-level meshes. Each child can be .msh, .mgn, or nested .apt/.lod.
  // We dispatch by extension — feed back through existing resolvers.
  const meshes: (ResolvedMesh | null)[] = await Promise.all(
    sortedLevels.map(async (lv) => {
      const childVfsPath = `appearance/${lv.childPath}`;
      if (isUnsafePath(childVfsPath)) {
        missing.push(`[unsafe-dtla-child] ${childVfsPath}`);
        return null;
      }
      const childExt = lv.childPath.split('.').pop()?.toLowerCase() ?? '';
      if (childExt === 'msh') {
        return resolveMshMesh(mountHandle, childVfsPath, missing);
      } else if (childExt === 'mgn') {
        return resolveMgnMesh(mountHandle, childVfsPath, [], missing);
      } else {
        // Nested .apt, .lod, or unknown — record in missing[] gracefully (D-04).
        missing.push(`[dtla-child-unresolved-ext:${childExt}] ${childVfsPath}`);
        return null;
      }
    }),
  );

  return { meshes, lodLevels };
}

// ─── LOD resolver ────────────────────────────────────────────────────────────

async function resolveLodMesh(
  mountHandle: string,
  lmgPath: string,
  boneOrder: string[],
  isSkinned: boolean,
  missing: string[],
): Promise<{ meshes: (ResolvedMesh | null)[]; lodLevels: LodLevel[] }> {
  const bytes = await fetchEntry(mountHandle, lmgPath, missing);
  if (!bytes) return { meshes: [null], lodLevels: [] };
  const iff = parseIffSafe(bytes, lmgPath, missing);
  if (!iff) return { meshes: [null], lodLevels: [] };

  let lodData: { levelCount: number; levels: Array<{ path: string }> };
  try {
    lodData = nativeCore.parseMeshLod(iff, new Uint8Array(bytes));
  } catch (_e) {
    missing.push(`[lmg-parse-error] ${lmgPath}`);
    return { meshes: [null], lodLevels: [] };
  }

  const lodLevels: LodLevel[] = lodData.levels.map(l => ({
    generatorPath: l.path,
    minDist: 0,
    maxDist: 0,
  }));

  const meshes: (ResolvedMesh | null)[] = await Promise.all(
    lodData.levels.map(l =>
      isSkinned
        ? resolveMgnMesh(mountHandle, l.path, boneOrder, missing)
        : resolveMshMesh(mountHandle, l.path, missing),
    ),
  );

  return { meshes, lodLevels };
}

// ─── Public resolveAppearance ─────────────────────────────────────────────────

/**
 * Resolve an appearance template from the TRE VFS.
 *
 * @param mountHandle  Native TRE mount handle (from treStore).
 * @param entryPath    Normalized VFS-relative path (e.g. "appearance/4lom.sat").
 * @returns            AppearanceResolutionResult — never throws (D-04).
 */
export async function resolveAppearance(
  mountHandle: string,
  entryPath: string,
): Promise<AppearanceResolutionResult> {
  const missing: string[] = [];

  if (isUnsafePath(entryPath)) {
    missing.push(`[rejected-unsafe-path] ${entryPath}`);
    return {
      meshes: [],
      skeleton: null,
      materials: [],
      missing,
      mode: 'leaf',
      isSkinned: false,
      lodLevels: [],
    };
  }

  const ext = entryPath.split('.').pop()?.toLowerCase() ?? '';

  // ─── composed (.sat) — SMAT → MSGN + SKTI ────────────────────────────────
  if (ext === 'sat') {
    const satBytes = await fetchEntry(mountHandle, entryPath, missing);
    if (!satBytes) {
      return { meshes: [], skeleton: null, materials: [], missing, mode: 'composed', isSkinned: true, lodLevels: [] };
    }
    const satIff = parseIffSafe(satBytes, entryPath, missing);
    if (!satIff) {
      return { meshes: [], skeleton: null, materials: [], missing, mode: 'composed', isSkinned: true, lodLevels: [] };
    }

    let satData: { meshPaths: string[]; skeletonRefs: Array<{ skeletonPath: string; attachmentTransformName: string }> };
    try {
      satData = nativeCore.parseSkeletalAppearance(satIff, new Uint8Array(satBytes));
    } catch (_e) {
      missing.push(`[smat-parse-error] ${entryPath}`);
      return { meshes: [], skeleton: null, materials: [], missing, mode: 'composed', isSkinned: true, lodLevels: [] };
    }

    // Resolve ALL skeleton refs (main + attached) and MERGE into one skeleton.
    // The merged boneOrder is required before parsing any mesh: each part's skinIndices
    // are name-remapped (case-insensitive) into the merged skeleton index space, so a
    // mesh can reference bones from any segment (e.g. ackbar's head mesh binds `jaw`
    // from mon_m_face alongside body bones from all_b). Ground truth: CONSULT-MP-AXIOMS.
    let skeleton: ResolvedSkeleton | null = null;
    let boneOrder: string[] = [];
    const skeletonSegments: Array<{ path: string; attachmentTransformName: string }> = [];
    if (satData.skeletonRefs.length > 0) {
      const segments: SkeletonSegment[] = [];
      for (const ref of satData.skeletonRefs) {
        skeletonSegments.push({ path: ref.skeletonPath, attachmentTransformName: ref.attachmentTransformName });
        const r = await resolveSkeleton(mountHandle, ref.skeletonPath, missing);
        if (r) segments.push({ parseResult: r.result.parseResult, attachmentTransformName: ref.attachmentTransformName });
      }
      if (segments.length > 0) {
        const merged = mergeSkeletons(segments);
        for (const w of merged.warnings) missing.push(`[skeleton-merge] ${w}`);
        // Keep skeleton.path = MAIN (first) skeleton path so the .ans picker heuristic
        // (which derives the base name from skeleton.path) keeps finding animations.
        skeleton = { path: satData.skeletonRefs[0]!.skeletonPath, parseResult: merged.parseResult };
        boneOrder = merged.boneOrder;
      }
    }

    // Resolve each mesh generator as its OWN part (per-LOD meshes + per-part materials).
    // ALL parts share the merged skeleton + merged boneOrder. selectedLod is applied
    // per-part at render time (shared LOD index across parts).
    const parts: ResolvedAppearancePart[] = [];
    let lodLevels: LodLevel[] = [];

    for (const meshPath of satData.meshPaths) {
      if (isUnsafePath(meshPath)) {
        missing.push(`[unsafe-mesh-path] ${meshPath}`);
        continue;
      }
      const meshExt = meshPath.split('.').pop()?.toLowerCase() ?? '';
      let meshesByLod: (ResolvedMesh | null)[];
      if (meshExt === 'lmg') {
        const lodResult = await resolveLodMesh(mountHandle, meshPath, boneOrder, true, missing);
        meshesByLod = lodResult.meshes;
        if (lodResult.lodLevels.length > lodLevels.length) lodLevels = lodResult.lodLevels;
      } else {
        meshesByLod = [await resolveMgnMesh(mountHandle, meshPath, boneOrder, missing)];
      }
      const materials = await resolveMeshMaterials(mountHandle, meshesByLod[0] ?? null, missing);
      parts.push({ meshPath, meshesByLod, materials });
    }

    // Legacy/compat fields: meshes = first part's LODs (LOD picker), materials = all parts'
    // LOD0 materials flattened (MaterialInspector / CustomizationPanel inspect the full set).
    const compatMeshes = parts[0]?.meshesByLod ?? [];
    const compatMaterials = parts.flatMap(p => p.materials);

    return {
      meshes: compatMeshes,
      skeleton,
      materials: compatMaterials,
      missing,
      mode: 'composed',
      isSkinned: true,
      lodLevels,
      parts,
      skeletonSegments,
    };
  }

  // ─── composed-static (.apt) — APT → redirect → parse by extension ────────
  if (ext === 'apt') {
    const aptBytes = await fetchEntry(mountHandle, entryPath, missing);
    if (!aptBytes) {
      return { meshes: [], skeleton: null, materials: [], missing, mode: 'composed-static', isSkinned: false, lodLevels: [] };
    }
    const aptIff = parseIffSafe(aptBytes, entryPath, missing);
    if (!aptIff) {
      return { meshes: [], skeleton: null, materials: [], missing, mode: 'composed-static', isSkinned: false, lodLevels: [] };
    }

    let redirectTarget: string;
    try {
      const aptData = nativeCore.parseStaticAppearance(aptIff, new Uint8Array(aptBytes));
      redirectTarget = aptData.redirectTarget;
    } catch (_e) {
      missing.push(`[apt-parse-error] ${entryPath}`);
      return { meshes: [], skeleton: null, materials: [], missing, mode: 'composed-static', isSkinned: false, lodLevels: [] };
    }

    if (isUnsafePath(redirectTarget)) {
      missing.push(`[unsafe-redirect] ${redirectTarget}`);
      return { meshes: [], skeleton: null, materials: [], missing, mode: 'composed-static', isSkinned: false, lodLevels: [] };
    }

    const redirectExt = redirectTarget.split('.').pop()?.toLowerCase() ?? '';
    let mesh: ResolvedMesh | null = null;
    let isSkinned = false;
    let lodLevels: LodLevel[] = [];

    if (redirectExt === 'msh') {
      mesh = await resolveMshMesh(mountHandle, redirectTarget, missing);
      isSkinned = false;
    } else if (redirectExt === 'lmg') {
      const lodResult = await resolveLodMesh(mountHandle, redirectTarget, [], false, missing);
      lodLevels = lodResult.lodLevels;
      mesh = lodResult.meshes[0] ?? null;
      isSkinned = false;
    } else if (redirectExt === 'mgn') {
      mesh = await resolveMgnMesh(mountHandle, redirectTarget, [], missing);
      isSkinned = true;
    } else if (redirectExt === 'lod') {
      // APT → .lod redirect: parse DTLA, follow children (dominant static-object path).
      // Source: DetailAppearanceTemplate.cpp:556-658 (load()) + :343-417 (loadEntries()).
      // Child path prepend rule: DetailAppearanceTemplate.cpp:378 (FileName(P_appearance, name)).
      const lodResult = await resolveDetailAppearanceLod(mountHandle, redirectTarget, missing);
      lodLevels = lodResult.lodLevels;
      mesh = lodResult.meshes[0] ?? null;
      isSkinned = false;
    } else {
      missing.push(`[unknown-apt-redirect-ext] ${redirectTarget}`);
    }

    const materials = await resolveMeshMaterials(mountHandle, mesh, missing);
    return {
      meshes: [mesh],
      skeleton: null,
      materials,
      missing,
      mode: 'composed-static',
      isSkinned,
      lodLevels,
    };
  }

  // ─── leaf .lod (FORM DTLA detail LOD appearance) ─────────────────────────
  // Direct open of a .lod file (not via .apt redirect).
  // Source: DetailAppearanceTemplate.cpp:556-658 (load()) + :343-417 (loadEntries()).
  if (ext === 'lod') {
    const lodResult = await resolveDetailAppearanceLod(mountHandle, entryPath, missing);
    const mesh = lodResult.meshes[0] ?? null;
    const materials = await resolveMeshMaterials(mountHandle, mesh, missing);
    return {
      meshes: lodResult.meshes,
      skeleton: null,
      materials,
      missing,
      mode: 'composed-static',
      isSkinned: false,
      lodLevels: lodResult.lodLevels,
    };
  }

  // ─── leaf skinned (.mgn) ──────────────────────────────────────────────────
  if (ext === 'mgn') {
    const mesh = await resolveMgnMesh(mountHandle, entryPath, [], missing);
    const materials = await resolveMeshMaterials(mountHandle, mesh, missing);
    return {
      meshes: [mesh],
      skeleton: null,  // leaf .mgn: no skeleton resolved; needsBoneRemap flag in result
      materials,
      missing,
      mode: 'leaf',
      isSkinned: true,
      lodLevels: [],
    };
  }

  // ─── leaf static (.msh) ───────────────────────────────────────────────────
  if (ext === 'msh') {
    const mesh = await resolveMshMesh(mountHandle, entryPath, missing);
    const materials = await resolveMeshMaterials(mountHandle, mesh, missing);
    return {
      meshes: [mesh],
      skeleton: null,
      materials,
      missing,
      mode: 'leaf',
      isSkinned: false,
      lodLevels: [],
    };
  }

  // Unknown extension
  missing.push(`[unknown-extension] ${entryPath}`);
  return {
    meshes: [],
    skeleton: null,
    materials: [],
    missing,
    mode: 'leaf',
    isSkinned: false,
    lodLevels: [],
  };
}
