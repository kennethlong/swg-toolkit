/**
 * packages/contracts/src/mesh.ts — Mesh format contract types.
 *
 * The mesh parse result crosses the N-API boundary as:
 *   - Structure (group count, bone names, shader slot map) → typed JSON (these types)
 *   - Geometry buffers (positions/normals/uvs/indices/skinIndex/skinWeight) → binary ArrayBuffer
 *
 * Binary ArrayBuffer path / no JSON for geometry (AGENTS.md binary-stays-binary rule):
 *   The N-API binding memcpys the de-indexed attribute arrays into a single JS-owned
 *   ArrayBuffer. Per-group MeshAttributeSlice fields locate each attribute inside it.
 *   "Zero-copy" is intentionally avoided as a label — the binding copies into the
 *   JS heap buffer; the key property is that geometry NEVER crosses as JSON.
 *
 * Index type is Uint32 (NOT Uint16). Source ITL indices in INDX are int32; meshes can
 * exceed 65535 vertices — Uint16 would silently corrupt large meshes.
 * (REVIEWS.md — Opus/Sonnet, 2026-06-23; VertexBuffer.cpp INDX int32 reading path.)
 *
 * Ground truth:
 *   swg-client-v2 MeshAppearanceTemplate.cpp (MESH/SPS/VTXA/INDX static mesh)
 *   swg-client-v2 VertexBuffer.cpp:247-307 (VTXA interleave layout)
 *   swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (SKMG chunk set, verified 2026-06-23)
 * Cross-check: ../swg-blender-plugin/swg_scene/mesh_skeletal.py
 *
 * Source (pattern): packages/contracts/src/iff.ts
 */

/**
 * Explicit per-attribute byte slice descriptor within the single geometry ArrayBuffer
 * returned by parseMesh() or parseMeshLod(). The consumer (renderer) slices the buffer
 * using (offset, byteLength) and interprets it according to componentCount.
 *
 * Example: For a Float32 position array with 100 vertices:
 *   { offset: 0, byteLength: 1200, componentCount: 3, elementCount: 100 }
 *   → new Float32Array(geometry, 0, 300)
 *
 * For the index buffer (Uint32):
 *   { offset: 1200, byteLength: 400, componentCount: 1, elementCount: 100 }
 *   → new Uint32Array(geometry, 1200, 100)
 *
 * Source: RESEARCH.md Pattern 2 (de-index pass) + PATTERNS.md § geometry/DeIndex.{h,cpp}
 */
export interface MeshAttributeSlice {
  /** Byte offset within the geometry ArrayBuffer. */
  offset: number;
  /** Total byte length of this attribute in the buffer. */
  byteLength: number;
  /**
   * Number of scalar components per element.
   * positions: 3 (x,y,z), normals: 3, uv set: 2, indices: 1 (Uint32 stride = 4 bytes).
   * For indices, componentCount documents the element stride — always 1 Uint32 per index.
   */
  componentCount: number;
  /** Number of elements (vertices for attrs, triangles×3 for indices). */
  elementCount: number;
}

/**
 * One PSDT shader group from a parsed .msh/.mgn mesh.
 *
 * A Three.js BufferGeometry + Material corresponds to one MeshShaderGroup.
 * All attribute data lives in the single geometry ArrayBuffer returned by parseMesh();
 * this struct carries the offsets and counts needed to slice it.
 *
 * Index type is Uint32, NOT Uint16. See file header for rationale.
 *
 * Source: swg-client-v2 ShaderPrimitiveSetTemplate.cpp (SPS/PSDT shader group framing)
 *         + VertexBuffer.cpp:247-307 (VTXA interleave) + RESEARCH.md Pattern 2.
 */
export interface MeshShaderGroup {
  /** Shader name from the shader NAME chunk (e.g. "shader/foo.sht"). */
  shaderName: string;
  /** Number of de-indexed (unique) vertices in this group after the de-index pass. */
  vertexCount: number;
  /**
   * Number of triangle index values (triangles × 3) in this group.
   * For Uint32 indices: indexCount Uint32 values = indexCount × 4 bytes.
   */
  indexCount: number;
  /** Float32 position attribute slice (3 components per vertex: x, y, z). */
  positions: MeshAttributeSlice;
  /** Float32 normal attribute slice (3 components per vertex: nx, ny, nz). Null if no normals. */
  normals: MeshAttributeSlice | null;
  /**
   * UV / texture-coordinate attribute slices.
   * One entry per texcoord set present in the VTXA DATA.
   * Typical: 1–2 sets; dim per set from flags ((flags>>(12+2j))&3)+1 — usually 2 (u,v).
   */
  uvs: MeshAttributeSlice[];
  /**
   * Uint32 index attribute slice.
   * indices.componentCount === 1 (one Uint32 per index).
   * Widened from on-disk int32 (INDX) or uint16 (LSPT 0001); always Uint32 in the bridge.
   */
  indices: MeshAttributeSlice;
  /**
   * Int32 skin-index attribute slice (4 bone indices per vertex).
   * Only present for SKMG (.mgn) skeletal meshes. Null for static .msh.
   * Derived from TWDT transformIndex fields; normalized to fixed vec4 pre-bridge.
   * Source: RESEARCH.md Pattern 3 (vec4 skin-weight normalization).
   */
  skinIndices: MeshAttributeSlice | null;
  /**
   * Float32 skin-weight attribute slice (4 normalized weights per vertex, sum = 1.0).
   * Only present for SKMG (.mgn) skeletal meshes. Null for static .msh.
   * Source: RESEARCH.md Pattern 3.
   */
  skinWeights: MeshAttributeSlice | null;
  /** True if DOT3 tangent data was present and included (VTXA v0004+). */
  hasDot3: boolean;
}

/**
 * Full result of parsing a .msh (FORM MESH) or .mgn (FORM SKMG) file via parseMesh().
 *
 * Geometry payload: returned separately as a single binary ArrayBuffer.
 * Use MeshShaderGroup.positions/normals/uvs/indices MeshAttributeSlice fields to locate
 * each attribute within the buffer.
 *
 * Source: swg-client-v2 MeshAppearanceTemplate.cpp (MESH) + SkeletalMeshGeneratorTemplate.cpp (SKMG)
 */
export interface MeshParseResult {
  /** Format discriminator from the root FORM tag. */
  formatTag: 'MESH' | 'SKMG';
  /**
   * Version string from the inner FORM (e.g. '0005' for MESH, '0004' for SKMG).
   * Source: FORM 000x subType in the IFF container.
   */
  version: string;
  /** One entry per PSDT shader group. One Three.js mesh per group. */
  shaderGroups: MeshShaderGroup[];
  /**
   * XFNM transform/bone name list (SKMG only).
   * Maps skinIndex slot (Int32 from TWDT) → bone name in the Skeleton.
   * Required for name-keyed bone binding (synthesis delta #6).
   * Source: swg-client-v2 SkeletalMeshGeneratorTemplate.cpp XFNM chunk.
   */
  boneNames?: string[];
  /**
   * Count of vertices where >4 skin influences were truncated to 4 (non-zero = warning).
   * Reported by the normalizeSkinWeightsInto() pass. Present for SKMG only.
   */
  weightsTruncated?: number;
  /** IFF-level round-trip status (from the generic-IFF parse layer). */
  roundTrip: { passed: boolean; failOffset?: number };
}
