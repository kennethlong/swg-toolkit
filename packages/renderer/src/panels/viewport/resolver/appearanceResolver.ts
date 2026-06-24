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
 */
export interface ResolvedMaterial {
  shaderResult: ShaderParseResult;
  /** Per texture slot → raw bytes (null when that slot's entry was missing). */
  slotBytes: Partial<Record<ShaderSlotName, ArrayBuffer | null>>;
}

/** Full appearance resolution result. */
export interface AppearanceResolutionResult {
  /** Per-LOD mesh list (null entries = placeholder when mesh could not be resolved). */
  meshes: (ResolvedMesh | null)[];
  /** Resolved skeleton (null if static or skeleton not found). */
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
      preRot: number[];
      postRot: number[];
      bindPos: number[];
      preRotOff: number[];
    }>;
  };
  parseMeshLod: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => {
    formatTag: string;
    version: string;
    levelCount: number;
    levels: Array<{ path: string }>;
  };
  parseShader: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => ShaderParseResult;
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
        bindRotation: [b.preRot[0] ?? 1, b.preRot[1] ?? 0, b.preRot[2] ?? 0, b.preRot[3] ?? 0],
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

  // Fetch texture bytes for each slot (D-04: missing slot → null bytes, not a throw)
  const slotBytes: Partial<Record<ShaderSlotName, ArrayBuffer | null>> = {};
  for (const slot of shaderResult.slots) {
    if (!slot.texturePath) {
      slotBytes[slot.slot] = null;
      continue;
    }
    const texBytes = await fetchEntry(mountHandle, slot.texturePath, missing);
    slotBytes[slot.slot] = texBytes;
  }

  return { shaderResult, slotBytes };
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
    materials.push(mat ?? { shaderResult: createPlaceholderShader(group.shaderName), slotBytes: {} });
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

    // Resolve skeleton first (need boneOrder for XFNM→bone remap)
    let skeleton: ResolvedSkeleton | null = null;
    let boneOrder: string[] = [];
    if (satData.skeletonRefs.length > 0) {
      const sktRef = satData.skeletonRefs[0];
      if (sktRef) {
        const sktResolved = await resolveSkeleton(mountHandle, sktRef.skeletonPath, missing);
        if (sktResolved) {
          skeleton = sktResolved.result;
          boneOrder = sktResolved.boneOrder;
        }
      }
    }

    // Resolve meshes (single or via .lmg)
    const allMeshes: (ResolvedMesh | null)[] = [];
    const allMaterials: ResolvedMaterial[] = [];
    let lodLevels: LodLevel[] = [];

    for (const meshPath of satData.meshPaths) {
      if (isUnsafePath(meshPath)) {
        missing.push(`[unsafe-mesh-path] ${meshPath}`);
        allMeshes.push(null);
        continue;
      }
      const meshExt = meshPath.split('.').pop()?.toLowerCase() ?? '';
      if (meshExt === 'lmg') {
        // LOD mesh generator
        const lodResult = await resolveLodMesh(mountHandle, meshPath, boneOrder, true, missing);
        lodLevels = lodResult.lodLevels;
        allMeshes.push(...lodResult.meshes);
        // Materials from LOD level 0
        const lod0 = lodResult.meshes[0] ?? null;
        const mats = await resolveMeshMaterials(mountHandle, lod0, missing);
        allMaterials.push(...mats);
      } else {
        // Direct .mgn
        const mesh = await resolveMgnMesh(mountHandle, meshPath, boneOrder, missing);
        allMeshes.push(mesh);
        const mats = await resolveMeshMaterials(mountHandle, mesh, missing);
        allMaterials.push(...mats);
      }
    }

    return {
      meshes: allMeshes,
      skeleton,
      materials: allMaterials,
      missing,
      mode: 'composed',
      isSkinned: true,
      lodLevels,
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
