/**
 * modules/core/geometry/DeIndex.h — Engine-free C++20 de-index utility.
 *
 * PORT SOURCE:
 *   swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (POSN/NORM/PIDX/NIDX/TWDT/TWHD chunk set)
 *   swg-client-v2 VertexBuffer.cpp:247-307 (VTXA interleave layout for static .msh)
 *
 * KEY GROUND-TRUTH FACTS (verified against source, do NOT re-derive):
 *   - Static .msh VTXA DATA is per-vertex-interleaved — no global pool; de-index is a no-op
 *     for the pool indirection, but we still unpack the interleave and build flat arrays.
 *   - Skeletal .mgn uses a global POSN/NORM pool + per-shader PIDX/NIDX → gather pass needed.
 *   - Index output type is Uint32 (NOT Uint16): source ITL indices are int32, meshes exceed 65535 verts.
 *   - Skin weights: TWHD holds per-vertex count (int32); TWDT = flat (int32 xformIdx, float32 weight) stream.
 *     Variable per vertex; normalized to fixed vec4 (top 4 by weight, renormalized to sum 1.0).
 *
 * Decision D-02: C++20, engine-free (no N-API, no SOE engine headers).
 * Source (pattern): packages/native-core/modules/core/compress/Zlib.h (utility transform shape).
 */

#pragma once

#include <cstdint>
#include <vector>
#include <string>
#include <stdexcept>

namespace swg_core {
namespace geometry {

// ─── Error ────────────────────────────────────────────────────────────────────

class GeometryError : public std::runtime_error {
public:
    explicit GeometryError(const std::string& msg) : std::runtime_error(msg) {}
};

// ─── Result struct ────────────────────────────────────────────────────────────

/**
 * De-indexed, BufferGeometry-ready attribute arrays for one shader group.
 *
 * All arrays are flat and interleave-free — ready for GPU upload via Three.js BufferGeometry.
 * positions[i*3 .. i*3+2] = vertex i's (x,y,z).
 * normals[i*3 .. i*3+2]   = vertex i's (nx,ny,nz). May be empty if no normals.
 * uvs[i*2 .. i*2+1]       = vertex i's (u,v) for first UV set. May be empty.
 * indices: Uint32 triangle vertex indices (3 per triangle, shader-local).
 *
 * skinIndices/skinWeights: vec4 per vertex (4 values each), present for SKMG only.
 * skinIndices[i*4 .. i*4+3] = bone index 0..3 for vertex i (Int32).
 * skinWeights[i*4 .. i*4+3] = normalized weight 0..3 for vertex i (float32, sum = 1.0).
 *
 * Source: RESEARCH.md Pattern 2 (de-index) + Pattern 3 (vec4 skin normalize).
 */
struct DeIndexedBuffers {
    std::vector<float>    positions;    // flat x,y,z per de-indexed vertex
    std::vector<float>    normals;      // flat nx,ny,nz per de-indexed vertex (may be empty)
    std::vector<float>    uvs;          // flat u,v per de-indexed vertex (first UV set; may be empty)
    std::vector<uint32_t> indices;      // Uint32 triangle indices (shader-local, 3 per triangle)
    // skinning (optional — only for .mgn SKMG):
    std::vector<int32_t>  skinIndices;  // vec4 bone indices, 4 per vertex (Int32)
    std::vector<float>    skinWeights;  // vec4 bone weights (normalized to sum 1.0), 4 per vertex
    uint32_t              weightsTruncated = 0; // count of verts where >4 influences were truncated
};

// ─── De-index: static .msh (VTXA interleaved, no global pool) ────────────────

/**
 * De-index a VTXA group from a static .msh mesh.
 *
 * Static .msh VTXA DATA is already per-vertex-interleaved (no global pool indirection).
 * This function unpacks the interleaved data into flat Float32Array-ready attribute arrays.
 *
 * vtxaData:     raw VTXA DATA bytes (interleaved per the flags)
 * vertexCount:  number of vertices in vtxaData
 * flags:        VTXA INFO flags field
 * indices:      raw INDX data (int32[] or uint16[], already widened to int32 by caller)
 * indexCount:   number of index values
 *
 * Returns DeIndexedBuffers with positions, normals, uvs, and Uint32 indices.
 *
 * Source: VertexBuffer.cpp:247-307 (VTXA interleave layout).
 */
DeIndexedBuffers deIndexStatic(
    const uint8_t* vtxaData,
    uint32_t       vertexCount,
    uint32_t       flags,
    const int32_t* indicesData,
    uint32_t       indexCount
);

// ─── De-index: skeletal .mgn (global POSN/NORM pool + PIDX/NIDX) ─────────────

/**
 * De-index a PSDT group from a skeletal .mgn mesh.
 *
 * For each shader-local vertex index i in [0, pidxCount):
 *   position[i] = posPool[pidx[i] * 3 .. pidx[i]*3+2]
 *   normal[i]   = normPool[nidx[i] * 3 .. nidx[i]*3+2]  (if normPool non-null)
 *
 * PRIM indices are already shader-local (3×int32 per triangle).
 *
 * Source: RESEARCH.md Pattern 2 + SkeletalMeshGeneratorTemplate.cpp PSDT chunk set.
 */
DeIndexedBuffers deIndexSkeletal(
    const float*   posPool,    uint32_t posCount,     // POSN global pool
    const float*   normPool,   uint32_t normCount,    // NORM global pool (may be null)
    const int32_t* pidx,       uint32_t pidxCount,    // PIDX: shader-local-idx → global POSN idx
    const int32_t* nidx,       uint32_t nidxCount,    // NIDX: shader-local-idx → global NORM idx
    const float*   uvData,     uint32_t uvCount,      // per-vertex UV data for this group
    const int32_t* primData,   uint32_t primCount     // PRIM triangle indices (shader-local, int32)
);

// ─── Skin weight normalization ─────────────────────────────────────────────────

/**
 * Normalize variable-count TWDT/TWHD skin weights to fixed vec4 (top-4 per vertex).
 *
 * Per vertex i:
 *   - Read twhd[i] influences from the flat TWDT stream at position twdtOffset[i]
 *   - Sort by weight descending, take top 4, renormalize to sum 1.0, zero-pad
 *   - Map TWDT transformIndex → bone order via xfnm name table → resolved boneOrder
 *   - Append 4 int32 skinIndices + 4 float32 skinWeights to out
 *
 * The boneOrder vector is the resolved Skeleton's bone list (name-keyed binding, delta #6).
 * xfnm[] is the XFNM table from the .mgn (maps skinIndex slot → bone name).
 *
 * Source: RESEARCH.md Pattern 3 + SkeletalMeshGeneratorTemplate.cpp TWHD/TWDT semantics.
 */
void normalizeSkinWeightsInto(
    DeIndexedBuffers&                   out,
    const int32_t*                      twhd,        // per-vertex count (positionCount entries)
    uint32_t                            vertexCount, // = positionCount (INFO field)
    const int32_t*                      twdt_xform,  // TWDT transformIndex array
    const float*                        twdt_weight, // TWDT weight array
    uint32_t                            twdtCount,   // = transformWeightDataCount
    const std::string*                  xfnm,        // XFNM name table
    uint32_t                            xfnmCount,
    const std::vector<std::string>&     boneOrder    // from resolved Skeleton (may be empty → identity remap)
);

} // namespace geometry
} // namespace swg_core
