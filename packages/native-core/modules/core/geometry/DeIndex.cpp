/**
 * modules/core/geometry/DeIndex.cpp — Engine-free C++20 de-index pass.
 *
 * PORT SOURCE:
 *   swg-client-v2 VertexBuffer.cpp:241-309 (load_0003 — VTXA interleave order)
 *   swg-client-v2 VertexBufferFormat.h:57-68 (flag bit positions)
 *   swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (POSN/NORM/PIDX/NIDX/TWDT/TWHD)
 *
 * KEY GROUND-TRUTH FACTS (do NOT re-derive):
 *   Flag bits (VertexBufferFormat.h):
 *     bit 0 = F_position, bit 1 = F_transformed, bit 2 = F_normal
 *     bit 3 = F_color0, bit 4 = F_color1, bit 5 = F_pointSize
 *     bits 8-11 = texture coordinate set count (0..8)
 *     bits 12-27 = texture coord set dimensions (2 bits each, dim = ((flags>>(12+2j))&3)+1)
 *   Interleave ORDER per vertex (VertexBuffer.cpp:270-303):
 *     position(3f) if hasPosition
 *     ooz(1f) if isTransformed
 *     normal(3f) if hasNormal
 *     pointSize(1f) if hasPointSize
 *     color0(u32) if hasColor0
 *     color1(u32) if hasColor1
 *     per texcoord set j: dim[j] float32 values
 *   Index output is always Uint32 (never Uint16).
 *
 * Decision D-02: C++20, engine-free.
 */

#include "DeIndex.h"

#include <algorithm>
#include <cstring>
#include <numeric>
#include <utility>
#include <cmath>
#include <unordered_map>

namespace swg_core {
namespace geometry {

// ─── VTXA flag bit constants (from VertexBufferFormat.h) ──────────────────────

static constexpr uint32_t VBF_POSITION   = (1u << 0);
static constexpr uint32_t VBF_TRANSFORMED= (1u << 1);
static constexpr uint32_t VBF_NORMAL     = (1u << 2);
static constexpr uint32_t VBF_COLOR0     = (1u << 3);
static constexpr uint32_t VBF_COLOR1     = (1u << 4);
static constexpr uint32_t VBF_POINTSIZE  = (1u << 5);

// Texture coordinate count: bits 8-11 (mask 0xF)
static constexpr uint32_t VBF_TC_COUNT_SHIFT = 8;
static constexpr uint32_t VBF_TC_COUNT_MASK  = 0xFu;
// Per-set dimension: bits 12+2j (2 bits each, value = bits + 1)
static constexpr uint32_t VBF_TC_DIM_BASE_SHIFT  = 12;
static constexpr uint32_t VBF_TC_DIM_PER_SHIFT   = 2;
static constexpr uint32_t VBF_TC_DIM_MASK         = 0x3u;

// Compute number of float32 values per vertex (stride in floats) from flags.
static uint32_t computeVertexStride(uint32_t flags, int* tcCountOut, int tcDimOut[8]) {
    uint32_t stride = 0;
    if (flags & VBF_POSITION)    stride += 3;
    if (flags & VBF_TRANSFORMED) stride += 1;
    if (flags & VBF_NORMAL)      stride += 3;
    if (flags & VBF_POINTSIZE)   stride += 1;
    if (flags & VBF_COLOR0)      stride += 1; // u32 counts as 1 float-slot
    if (flags & VBF_COLOR1)      stride += 1;
    int tcCount = static_cast<int>((flags >> VBF_TC_COUNT_SHIFT) & VBF_TC_COUNT_MASK);
    if (tcCountOut) *tcCountOut = tcCount;
    for (int j = 0; j < tcCount && j < 8; ++j) {
        int dim = static_cast<int>(((flags >> (VBF_TC_DIM_BASE_SHIFT + VBF_TC_DIM_PER_SHIFT * j)) & VBF_TC_DIM_MASK)) + 1;
        if (tcDimOut) tcDimOut[j] = dim;
        stride += static_cast<uint32_t>(dim);
    }
    return stride;
}

// ─── deIndexStatic ────────────────────────────────────────────────────────────

DeIndexedBuffers deIndexStatic(
    const uint8_t* vtxaData,
    uint32_t       vertexCount,
    uint32_t       flags,
    const int32_t* indicesData,
    uint32_t       indexCount)
{
    DeIndexedBuffers out;

    if (vertexCount == 0 || !vtxaData) {
        return out;
    }

    int tcCount = 0;
    int tcDim[8] = {};
    uint32_t strideFloats = computeVertexStride(flags, &tcCount, tcDim);
    if (strideFloats == 0) {
        throw GeometryError("deIndexStatic: zero vertex stride (flags=0?)");
    }

    // Bounds check the buffer
    uint64_t expectedBytes = static_cast<uint64_t>(vertexCount) * strideFloats * 4u;
    // We can't check vtxaData size here since it's a raw pointer; caller must ensure.

    bool hasPos    = (flags & VBF_POSITION) != 0;
    bool hasTrans  = (flags & VBF_TRANSFORMED) != 0;
    bool hasNorm   = (flags & VBF_NORMAL) != 0;
    bool hasPS     = (flags & VBF_POINTSIZE) != 0;
    bool hasC0     = (flags & VBF_COLOR0) != 0;
    bool hasC1     = (flags & VBF_COLOR1) != 0;

    out.positions.reserve(vertexCount * 3);
    if (hasNorm) out.normals.reserve(vertexCount * 3);
    if (tcCount > 0) out.uvs.reserve(vertexCount * static_cast<size_t>(tcDim[0]));

    const uint8_t* ptr = vtxaData;
    for (uint32_t vi = 0; vi < vertexCount; ++vi) {
        if (hasPos) {
            float x, y, z;
            std::memcpy(&x, ptr, 4); ptr += 4;
            std::memcpy(&y, ptr, 4); ptr += 4;
            std::memcpy(&z, ptr, 4); ptr += 4;
            out.positions.push_back(x);
            out.positions.push_back(y);
            out.positions.push_back(z);
        }
        if (hasTrans) { ptr += 4; } // skip ooz (transformed W)
        if (hasNorm) {
            float nx, ny, nz;
            std::memcpy(&nx, ptr, 4); ptr += 4;
            std::memcpy(&ny, ptr, 4); ptr += 4;
            std::memcpy(&nz, ptr, 4); ptr += 4;
            out.normals.push_back(nx);
            out.normals.push_back(ny);
            out.normals.push_back(nz);
        }
        if (hasPS)  { ptr += 4; } // skip pointSize
        if (hasC0)  { ptr += 4; } // skip color0 (uint32)
        if (hasC1)  { ptr += 4; } // skip color1 (uint32)
        for (int j = 0; j < tcCount && j < 8; ++j) {
            int dim = tcDim[j];
            for (int k = 0; k < dim; ++k) {
                float uv;
                std::memcpy(&uv, ptr, 4); ptr += 4;
                if (j == 0) out.uvs.push_back(uv); // only first UV set
                // other sets discarded for now (can be extended)
            }
        }
    }

    // Copy and widen indices to Uint32
    if (indicesData && indexCount > 0) {
        out.indices.reserve(indexCount);
        for (uint32_t i = 0; i < indexCount; ++i) {
            out.indices.push_back(static_cast<uint32_t>(indicesData[i]));
        }
    }

    return out;
}

// ─── deIndexSkeletal ──────────────────────────────────────────────────────────

DeIndexedBuffers deIndexSkeletal(
    const float*   posPool,    uint32_t posCount,
    const float*   normPool,   uint32_t normCount,
    const int32_t* pidx,       uint32_t pidxCount,
    const int32_t* nidx,       uint32_t nidxCount,
    const float*   uvData,     uint32_t uvCount,
    const int32_t* primData,   uint32_t primCount)
{
    DeIndexedBuffers out;

    if (!posPool || pidxCount == 0) {
        return out;
    }

    // Bounds check pool sizes
    static constexpr uint32_t kMaxPoolSize = 512 * 1024; // 512k verts max
    if (posCount > kMaxPoolSize) {
        throw GeometryError("deIndexSkeletal: posPool too large");
    }
    if (normPool && normCount > kMaxPoolSize) {
        throw GeometryError("deIndexSkeletal: normPool too large");
    }

    // Gather positions via PIDX
    out.positions.reserve(pidxCount * 3);
    for (uint32_t i = 0; i < pidxCount; ++i) {
        int32_t gi = pidx[i];
        if (gi < 0 || static_cast<uint32_t>(gi) >= posCount) {
            throw GeometryError("deIndexSkeletal: PIDX out of range");
        }
        out.positions.push_back(posPool[gi * 3 + 0]);
        out.positions.push_back(posPool[gi * 3 + 1]);
        out.positions.push_back(posPool[gi * 3 + 2]);
    }

    // Gather normals via NIDX (if present)
    if (normPool && nidx && nidxCount == pidxCount) {
        out.normals.reserve(pidxCount * 3);
        for (uint32_t i = 0; i < nidxCount; ++i) {
            int32_t gi = nidx[i];
            if (gi < 0 || static_cast<uint32_t>(gi) >= normCount) {
                throw GeometryError("deIndexSkeletal: NIDX out of range");
            }
            out.normals.push_back(normPool[gi * 3 + 0]);
            out.normals.push_back(normPool[gi * 3 + 1]);
            out.normals.push_back(normPool[gi * 3 + 2]);
        }
    }

    // UV data is already per-vertex (per-group TCSF/TCSD; 2 floats per vertex)
    if (uvData && uvCount > 0) {
        out.uvs.reserve(uvCount);
        for (uint32_t i = 0; i < uvCount; ++i) {
            out.uvs.push_back(uvData[i]);
        }
    }

    // Copy PRIM indices to Uint32 (PRIM stores int32; widen to Uint32)
    if (primData && primCount > 0) {
        out.indices.reserve(primCount);
        for (uint32_t i = 0; i < primCount; ++i) {
            out.indices.push_back(static_cast<uint32_t>(primData[i]));
        }
    }

    return out;
}

// ─── normalizeSkinWeightsInto ─────────────────────────────────────────────────

void normalizeSkinWeightsInto(
    DeIndexedBuffers&                   out,
    const int32_t*                      twhd,
    uint32_t                            vertexCount,
    const int32_t*                      twdt_xform,
    const float*                        twdt_weight,
    uint32_t                            twdtCount,
    const std::string*                  xfnm,
    uint32_t                            xfnmCount,
    const std::vector<std::string>&     boneOrder)
{
    if (!twhd || vertexCount == 0) {
        // Zero-fill 4 slots per vertex
        out.skinIndices.assign(vertexCount * 4, 0);
        out.skinWeights.assign(vertexCount * 4, 0.0f);
        return;
    }

    // Build name→boneIndex map from the resolved Skeleton bone order
    std::unordered_map<std::string, int32_t> boneIndexMap;
    for (size_t i = 0; i < boneOrder.size(); ++i) {
        boneIndexMap[boneOrder[i]] = static_cast<int32_t>(i);
    }

    out.skinIndices.reserve(vertexCount * 4);
    out.skinWeights.reserve(vertexCount * 4);

    uint32_t twdtOffset = 0;
    for (uint32_t vi = 0; vi < vertexCount; ++vi) {
        int32_t count = twhd[vi];
        if (count < 0) count = 0;
        if (count > 0 && (twdtOffset + static_cast<uint32_t>(count)) > twdtCount) {
            // Truncate to available data
            count = static_cast<int32_t>(twdtCount - twdtOffset);
        }

        // Collect all influences for this vertex
        struct Influence { int32_t boneIdx; float weight; };
        std::vector<Influence> influences;
        influences.reserve(static_cast<size_t>(count));
        for (int32_t k = 0; k < count; ++k) {
            uint32_t flat = twdtOffset + static_cast<uint32_t>(k);
            if (flat >= twdtCount) break;
            int32_t xformIdx = twdt_xform[flat];
            float   wt       = twdt_weight[flat];

            // Map xformIdx → bone name → skeleton bone index
            int32_t boneIdx = 0;
            if (xfnm && xformIdx >= 0 && static_cast<uint32_t>(xformIdx) < xfnmCount) {
                const std::string& boneName = xfnm[static_cast<size_t>(xformIdx)];
                auto it = boneIndexMap.find(boneName);
                if (it != boneIndexMap.end()) {
                    boneIdx = it->second;
                } else {
                    // Name not in Skeleton — use identity remap (xformIdx directly)
                    boneIdx = xformIdx;
                }
            }
            influences.push_back({ boneIdx, wt });
        }
        twdtOffset += static_cast<uint32_t>(count);

        // Sort by weight descending, take top 4
        std::sort(influences.begin(), influences.end(),
            [](const Influence& a, const Influence& b){ return a.weight > b.weight; });

        if (influences.size() > 4) {
            ++out.weightsTruncated;
            influences.resize(4);
        }

        // Renormalize top-4 weights to sum 1.0
        float wSum = 0.0f;
        for (auto& inf : influences) wSum += inf.weight;
        if (wSum > 0.0f) {
            for (auto& inf : influences) inf.weight /= wSum;
        } else if (!influences.empty()) {
            // Uniform fallback
            float w = 1.0f / static_cast<float>(influences.size());
            for (auto& inf : influences) inf.weight = w;
        }

        // Emit 4 slots (zero-pad if fewer than 4 influences)
        for (int slot = 0; slot < 4; ++slot) {
            if (slot < static_cast<int>(influences.size())) {
                out.skinIndices.push_back(influences[static_cast<size_t>(slot)].boneIdx);
                out.skinWeights.push_back(influences[static_cast<size_t>(slot)].weight);
            } else {
                out.skinIndices.push_back(0);
                out.skinWeights.push_back(0.0f);
            }
        }
    }
}

} // namespace geometry
} // namespace swg_core
