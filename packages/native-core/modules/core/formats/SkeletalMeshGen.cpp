/**
 * modules/core/formats/SkeletalMeshGen.cpp — Engine-free C++20 FORM SKMG skeletal mesh parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 clientSkeletalAnimation/appearance/SkeletalMeshGeneratorTemplate.cpp
 *     load_0002 at :2247-2360  (verified 2026-06-23)
 *     TWDT read at :2331-2343  — transformWeightDataCount pairs (NOT sum of TWHD, NOT 4×positionCount)
 *     PSDT groups at :2347+    — per-shader: NAME, PIDX, NIDX, TXCI+TCSF/TCSD, PRIM→INFO+ITL
 *
 * KEY GROUND-TRUTH FACTS (verified against oracle, do NOT re-derive):
 *   FORM SKMG → FORM 000{2,3,4}
 *   INFO chunk layout: 9×int32 THEN 4×int16
 *     [0] maxTransformsPerVertex   [1] maxTransformsPerShader
 *     [2] skeletonTemplateNameCount [3] transformNameCount (= XFNM entry count)
 *     [4] positionCount             [5] transformWeightDataCount (= TWDT entry count)
 *     [6] normalCount               [7] perShaderDataCount
 *     [8] blendTargetCount
 *     [int16-0] occlusionZoneCount  [int16-1] occlusionZoneCombinationCount
 *     [int16-2] zonesThisOccludesCount [int16-3] occlusionLayer
 *   SKTM inner CHUNK (not FORM SKTM!): flat NUL-terminated skeleton path strings
 *   XFNM: transformNameCount NUL-terminated bone name strings
 *   POSN: positionCount × 3 float32 (global position pool)
 *   TWHD: positionCount × int32 (per-vertex influence count)
 *   TWDT: transformWeightDataCount × (int32 xformIdx, float32 weight) pairs
 *   [NORM]: normalCount × 3 float32 (global normal pool, optional if normalCount==0)
 *   PSDT groups: v0002/v0003: NAME + PIDX + [NIDX] + [TXCI+TCSF/TCSD] + PRIM
 *                v0004: also has DOT3 tangent pool and per-PSDT DOT3 indices
 *   PRIM: subForms with INFO (int32 numTris, int32 numVerts) + ITL (int32 tri×3 per vertex)
 *
 * Security: positionCount cap 1M (T-02-06), PIDX OOB → FormatParseError (T-02-07).
 *
 * Decision D-02: C++20, engine-free.
 */

#include "SkeletalMeshGen.h"

#include <cstring>
#include <sstream>
#include <algorithm>
#include <cassert>

namespace swg_core {
namespace formats {

// ─── IFF node helpers (same pattern as Mesh.cpp) ─────────────────────────────

static const swg_core::iff::IffNode* findChild(
    const swg_core::iff::IffNode& parent, const char* tag)
{
    if (!parent.isForm) return nullptr;
    for (const auto& child : parent.children) {
        if (child.isForm  && strncmp(child.subType, tag, 4) == 0) return &child;
        if (!child.isForm && strncmp(child.tag,     tag, 4) == 0) return &child;
    }
    return nullptr;
}

static const swg_core::iff::IffNode* findChildLeaf(
    const swg_core::iff::IffNode& parent, const char* tag)
{
    if (!parent.isForm) return nullptr;
    for (const auto& child : parent.children) {
        if (!child.isForm && strncmp(child.tag, tag, 4) == 0) return &child;
    }
    return nullptr;
}

static const swg_core::iff::IffNode* findChildForm(
    const swg_core::iff::IffNode& parent, const char* subType)
{
    if (!parent.isForm) return nullptr;
    for (const auto& child : parent.children) {
        if (child.isForm && strncmp(child.subType, subType, 4) == 0) return &child;
    }
    return nullptr;
}

// ─── ChunkView (same as Mesh.cpp) ────────────────────────────────────────────

struct ChunkView {
    const uint8_t* data;
    uint32_t size;
    uint32_t pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }

    uint8_t readU8() {
        if (!canRead(1)) throw FormatParseError("SKMG ChunkView: unexpected end");
        return data[pos++];
    }
    int16_t readI16LE() {
        if (!canRead(2)) throw FormatParseError("SKMG ChunkView: unexpected end");
        int16_t v; std::memcpy(&v, data + pos, 2); pos += 2; return v;
    }
    int32_t readI32LE() {
        if (!canRead(4)) throw FormatParseError("SKMG ChunkView: unexpected end");
        int32_t v; std::memcpy(&v, data + pos, 4); pos += 4; return v;
    }
    uint32_t readU32LE() {
        if (!canRead(4)) throw FormatParseError("SKMG ChunkView: unexpected end");
        uint32_t v; std::memcpy(&v, data + pos, 4); pos += 4; return v;
    }
    float readF32() {
        if (!canRead(4)) throw FormatParseError("SKMG ChunkView: unexpected end");
        float v; std::memcpy(&v, data + pos, 4); pos += 4; return v;
    }
    std::string readString() {
        std::string s;
        while (pos < size) {
            char c = static_cast<char>(data[pos++]);
            if (c == '\0') break;
            s += c;
        }
        return s;
    }
    const uint8_t* ptr() const { return data + pos; }
    uint32_t remaining() const { return size - pos; }
    void skip(uint32_t n) {
        if (!canRead(n)) throw FormatParseError("SKMG ChunkView: skip past end");
        pos += n;
    }
};

static ChunkView chunkPayload(const swg_core::iff::IffNode& leaf,
                               const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("chunkPayload called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize) {
        throw FormatParseError("SKMG: chunk extends beyond source buffer");
    }
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── Collect all nodes with a given tag from a parent (for PSDT groups) ──────

static std::vector<const swg_core::iff::IffNode*> collectChildForms(
    const swg_core::iff::IffNode& parent, const char* subType)
{
    std::vector<const swg_core::iff::IffNode*> result;
    if (!parent.isForm) return result;
    for (const auto& child : parent.children) {
        if (child.isForm && strncmp(child.subType, subType, 4) == 0) {
            result.push_back(&child);
        }
    }
    return result;
}

// Collect all forms whose subType starts with "PSDT" (any version)
static std::vector<const swg_core::iff::IffNode*> collectPSDTForms(
    const swg_core::iff::IffNode& parent)
{
    std::vector<const swg_core::iff::IffNode*> result;
    if (!parent.isForm) return result;
    for (const auto& child : parent.children) {
        if (child.isForm && strncmp(child.subType, "PSDT", 4) == 0) {
            result.push_back(&child);
        }
    }
    return result;
}

// ─── Parse SKMG INFO chunk ────────────────────────────────────────────────────

struct SkmgInfo {
    int32_t maxTransformsPerVertex    = 0;
    int32_t maxTransformsPerShader    = 0;
    int32_t skeletonTemplateNameCount = 0;
    int32_t transformNameCount        = 0;  // XFNM count
    int32_t positionCount             = 0;
    int32_t transformWeightDataCount  = 0;  // TWDT entry count
    int32_t normalCount               = 0;
    int32_t perShaderDataCount        = 0;
    int32_t blendTargetCount          = 0;
    int16_t occlusionZoneCount           = 0;
    int16_t occlusionZoneCombinationCount= 0;
    int16_t zonesThisOccludesCount       = 0;
    int16_t occlusionLayer               = 0;
};

static SkmgInfo parseInfo(const swg_core::iff::IffNode& infoLeaf,
                           const uint8_t* srcData, uint32_t srcSize)
{
    auto cv = chunkPayload(infoLeaf, srcData, srcSize);
    SkmgInfo info;
    info.maxTransformsPerVertex    = cv.readI32LE();
    info.maxTransformsPerShader    = cv.readI32LE();
    info.skeletonTemplateNameCount = cv.readI32LE();
    info.transformNameCount        = cv.readI32LE();
    info.positionCount             = cv.readI32LE();
    info.transformWeightDataCount  = cv.readI32LE();
    info.normalCount               = cv.readI32LE();
    info.perShaderDataCount        = cv.readI32LE();
    info.blendTargetCount          = cv.readI32LE();
    // 4×int16
    info.occlusionZoneCount              = cv.readI16LE();
    info.occlusionZoneCombinationCount   = cv.readI16LE();
    info.zonesThisOccludesCount          = cv.readI16LE();
    info.occlusionLayer                  = cv.readI16LE();
    return info;
}

// ─── Parse ITL (indexed tri list) ────────────────────────────────────────────
// ITL chunk (v0002/v0003): int32 triangleCount + int32×3 per triangle (flat indices).
//   Source: SkeletalMeshGeneratorTemplate.cpp IndexedTriListPrimitive::load_0002 :1083-1120

static std::vector<int32_t> parseItl(const swg_core::iff::IffNode& itlLeaf,
                                      const uint8_t* srcData, uint32_t srcSize)
{
    auto cv = chunkPayload(itlLeaf, srcData, srcSize);
    if (!cv.canRead(4)) throw FormatParseError("SKMG: ITL chunk too small");
    int32_t numTris = cv.readI32LE();
    if (numTris < 0 || static_cast<uint32_t>(numTris) * 12 > cv.size)
        throw FormatParseError("SKMG: ITL numTris exceeds chunk size");
    std::vector<int32_t> tris(static_cast<size_t>(numTris) * 3);
    for (int32_t i = 0; i < numTris * 3; ++i) tris[i] = cv.readI32LE();
    return tris;
}

// ─── Parse OITL (occluded indexed tri list) ───────────────────────────────────
// OITL chunk (v0004): int32 triangleCount + per-triangle: int16 occZoneCombIdx + int32×3 vertex indices.
//   Source: SkeletalMeshGeneratorTemplate.cpp OccludedIndexedTriListPrimitive::load_0002 :1224-1278

static std::vector<int32_t> parseOitl(const swg_core::iff::IffNode& oitlLeaf,
                                       const uint8_t* srcData, uint32_t srcSize)
{
    auto cv = chunkPayload(oitlLeaf, srcData, srcSize);
    if (!cv.canRead(4)) throw FormatParseError("SKMG: OITL chunk too small");
    int32_t numTris = cv.readI32LE();
    if (numTris < 0) throw FormatParseError("SKMG: OITL negative triCount");
    std::vector<int32_t> tris;
    tris.reserve(static_cast<size_t>(numTris) * 3);
    for (int32_t i = 0; i < numTris; ++i) {
        if (!cv.canRead(2 + 12)) throw FormatParseError("SKMG: OITL truncated");
        cv.readI16LE(); // occlusionZoneCombinationIndex — consume but ignore
        tris.push_back(cv.readI32LE()); // index0
        tris.push_back(cv.readI32LE()); // index1
        tris.push_back(cv.readI32LE()); // index2
    }
    return tris;
}

// ─── Build de-indexed geometry for one PSDT group ────────────────────────────

static void processPSDT(
    const swg_core::iff::IffNode& psdtForm,
    const uint8_t* srcData, uint32_t srcSize,
    const std::vector<float>&   posPool,    // 3 floats per position
    const std::vector<float>&   normPool,   // 3 floats per normal (may be empty)
    const std::vector<int32_t>& twhd,       // per-vertex influence count
    const std::vector<int32_t>& twdt_xform,
    const std::vector<float>&   twdt_weight,
    const std::vector<std::string>& xfnm,
    const std::vector<std::string>& boneOrder,
    std::vector<uint8_t>&            geomBuf,
    std::vector<MeshShaderGroupResult>& groups,
    uint32_t& weightsTruncated,
    bool isV4)
{
    // NAME: shader path
    std::string shaderName;
    const auto* nameLeaf = findChildLeaf(psdtForm, "NAME");
    if (nameLeaf) {
        auto cv = chunkPayload(*nameLeaf, srcData, srcSize);
        shaderName = cv.readString();
    }

    // PIDX: int32 vertexCount + vertexCount × int32 global-position-pool-index
    //   Source: SkeletalMeshGeneratorTemplate.cpp load_0002 :1376-1384
    //   m_vertexCount is read first from PIDX, then m_vertexCount indices follow.
    const auto* pidxLeaf = findChildLeaf(psdtForm, "PIDX");
    if (!pidxLeaf) throw FormatParseError("SKMG PSDT: missing PIDX chunk");
    auto pidxCv = chunkPayload(*pidxLeaf, srcData, srcSize);
    if (!pidxCv.canRead(4)) throw FormatParseError("SKMG PSDT: PIDX chunk too small");
    int32_t pidxVertexCount = pidxCv.readI32LE(); // m_vertexCount
    if (pidxVertexCount < 0 || static_cast<uint32_t>(pidxVertexCount * 4) > pidxCv.size)
        throw FormatParseError("SKMG PSDT: PIDX vertexCount out of bounds");
    uint32_t pidxCount = static_cast<uint32_t>(pidxVertexCount);
    std::vector<int32_t> pidx(pidxCount);
    for (uint32_t i = 0; i < pidxCount; ++i) pidx[i] = pidxCv.readI32LE();

    // NIDX: vertexCount × int32 global-normal-pool-index (NO leading count, uses PIDX's vertexCount)
    //   Source: SkeletalMeshGeneratorTemplate.cpp load_0002 :1387-1393
    std::vector<int32_t> nidx;
    const auto* nidxLeaf = findChildLeaf(psdtForm, "NIDX");
    if (nidxLeaf && !normPool.empty()) {
        auto nidxCv = chunkPayload(*nidxLeaf, srcData, srcSize);
        // No leading count — uses same pidxVertexCount
        uint32_t nidxCount = pidxCount; // same as PIDX vertexCount
        if (static_cast<uint32_t>(nidxCount * 4) > nidxCv.size)
            nidxCount = nidxCv.size / 4; // fallback: fill from available bytes
        nidx.resize(nidxCount);
        for (uint32_t i = 0; i < nidxCount; ++i) nidx[i] = nidxCv.readI32LE();
    }

    // TXCI / TCSF / TCSD — per-vertex UV data
    // TXCI: int32 setCount + int32[] dimensionality per set
    // v0004 PSDT: FORM TCSF → CHUNK TCSD (double floats — one per setCount, not interleaved by vertex)
    //   Source: SkeletalMeshGeneratorTemplate.cpp load_0004 TCSF :1582-1614
    // v0002/v0003 PSDT: TCSF is a leaf (float UVs), TCSD is a leaf (double UVs)
    std::vector<float> uvData; // flat u,v pairs for shader-local verts
    const auto* txciLeaf = findChildLeaf(psdtForm, "TXCI");
    if (txciLeaf) {
        auto txciCv = chunkPayload(*txciLeaf, srcData, srcSize);
        int32_t setCount = txciCv.readI32LE();
        std::vector<int32_t> dims(static_cast<size_t>(std::max(setCount, 0)));
        for (int32_t s = 0; s < setCount; ++s) dims[s] = txciCv.readI32LE();

        // Try FORM TCSF (v0004): wraps CHUNK TCSD(s) with float32 UVs per-vertex per-set
        //   Source: SkeletalMeshGeneratorTemplate.cpp load_0004 TCSF :1427-1451
        //   Layout: one TCSD chunk per texture coordinate set (sequential, not interleaved)
        //   TCSD: vertexCount * dims[s] float32 values per set
        const auto* tcsfForm = findChildForm(psdtForm, "TCSF");
        if (tcsfForm && setCount > 0) {
            // Find the first TCSD chunk inside FORM TCSF
            const auto* tcsdLeaf = findChildLeaf(*tcsfForm, "TCSD");
            if (tcsdLeaf) {
                auto tcsdCv = chunkPayload(*tcsdLeaf, srcData, srcSize);
                int32_t dim0 = dims.empty() ? 0 : dims[0];
                if (dim0 >= 1 && pidxCount > 0) {
                    uvData.reserve(pidxCount * 2);
                    for (uint32_t v = 0; v < pidxCount; ++v) {
                        float u = 0.0f, fv = 0.0f;
                        if (tcsdCv.canRead(4)) u  = tcsdCv.readF32();
                        if (dim0 >= 2 && tcsdCv.canRead(4)) fv = tcsdCv.readF32();
                        uvData.push_back(u);
                        uvData.push_back(fv);
                        // skip remaining dims beyond 2
                        for (int32_t d = 2; d < dim0; ++d) {
                            if (tcsdCv.canRead(4)) tcsdCv.readF32();
                        }
                    }
                }
            }
        } else {
            // Older versions: try TCSF as leaf (float UVs)
            const auto* tcsfLeaf = findChildLeaf(psdtForm, "TCSF");
            if (tcsfLeaf && setCount > 0) {
                auto tcsfCv = chunkPayload(*tcsfLeaf, srcData, srcSize);
                int32_t dim0 = dims.empty() ? 0 : dims[0];
                if (dim0 >= 2 && pidxCount > 0) {
                    uvData.reserve(pidxCount * 2);
                    for (uint32_t v = 0; v < pidxCount; ++v) {
                        float u = tcsfCv.readF32();
                        float fv = tcsfCv.readF32();
                        uvData.push_back(u);
                        uvData.push_back(fv);
                        for (int32_t d = 2; d < dim0; ++d) {
                            if (tcsfCv.canRead(4)) tcsfCv.readF32();
                        }
                        for (int32_t s = 1; s < setCount; ++s) {
                            for (int32_t d = 0; d < dims[s]; ++d) {
                                if (tcsfCv.canRead(4)) tcsfCv.readF32();
                            }
                        }
                    }
                }
            } else {
                // Try TCSD as leaf (double UVs, v0002/v0003 fallback)
                const auto* tcsdLeaf = findChildLeaf(psdtForm, "TCSD");
                if (tcsdLeaf && setCount > 0) {
                    auto tcsdCv = chunkPayload(*tcsdLeaf, srcData, srcSize);
                    int32_t dim0 = dims.empty() ? 0 : dims[0];
                    if (dim0 >= 2 && pidxCount > 0) {
                        uvData.reserve(pidxCount * 2);
                        for (uint32_t v = 0; v < pidxCount; ++v) {
                            double u = 0.0, fv = 0.0;
                            if (tcsdCv.canRead(8)) { std::memcpy(&u,  tcsdCv.ptr(), 8); tcsdCv.skip(8); }
                            if (tcsdCv.canRead(8)) { std::memcpy(&fv, tcsdCv.ptr(), 8); tcsdCv.skip(8); }
                            uvData.push_back(static_cast<float>(u));
                            uvData.push_back(static_cast<float>(fv));
                            for (int32_t d = 2; d < dim0; ++d) {
                                if (tcsdCv.canRead(8)) tcsdCv.skip(8);
                            }
                            for (int32_t s = 1; s < setCount; ++s) {
                                for (int32_t d = 0; d < dims[s]; ++d) {
                                    if (tcsdCv.canRead(8)) tcsdCv.skip(8);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Collect triangle indices from FORM PRIM inside this PSDT
    // PRIM structure: FORM PRIM → CHUNK INFO (int32 primitiveCount) + (CHUNK ITL | CHUNK OITL) per primitive
    //   ITL:  int32 triCount + int32×3 per tri (simple indexed tri list)
    //   OITL: int32 triCount + per tri: (int16 occlusionZoneCombIdx + int32×3) (occluded ITL, v0004)
    //   Source: SkeletalMeshGeneratorTemplate.cpp load_0004 PRIM section :1616-1658
    std::vector<int32_t> allTriIndices;
    const auto* primForm = findChildForm(psdtForm, "PRIM");
    if (primForm) {
        // INFO: int32 primitiveCount
        // (We don't need primitiveCount — just iterate over ITL/OITL children)
        for (const auto& primChild : primForm->children) {
            if (primChild.isForm) continue; // skip nested forms
            if (strncmp(primChild.tag, "ITL ", 4) == 0 || strncmp(primChild.tag, "ITL\0", 4) == 0) {
                auto itl = parseItl(primChild, srcData, srcSize);
                allTriIndices.insert(allTriIndices.end(), itl.begin(), itl.end());
            } else if (strncmp(primChild.tag, "OITL", 4) == 0) {
                auto oitl = parseOitl(primChild, srcData, srcSize);
                allTriIndices.insert(allTriIndices.end(), oitl.begin(), oitl.end());
            }
        }
    }

    if (pidxCount == 0 || allTriIndices.empty()) {
        // Empty group — still add to preserve shader reference
        MeshShaderGroupResult g;
        g.shaderName = shaderName;
        g.vertexCount = 0;
        g.indexCount  = 0;
        groups.push_back(std::move(g));
        return;
    }

    // Security: bounds-check PIDX against posPool
    uint32_t posCount = static_cast<uint32_t>(posPool.size() / 3);
    for (uint32_t i = 0; i < pidxCount; ++i) {
        if (pidx[i] < 0 || static_cast<uint32_t>(pidx[i]) >= posCount) {
            throw FormatParseError("SKMG PSDT: PIDX out of bounds");
        }
    }
    if (!nidx.empty()) {
        uint32_t normCount = static_cast<uint32_t>(normPool.size() / 3);
        for (uint32_t i = 0; i < static_cast<uint32_t>(nidx.size()); ++i) {
            if (nidx[i] < 0 || static_cast<uint32_t>(nidx[i]) >= normCount) {
                throw FormatParseError("SKMG PSDT: NIDX out of bounds");
            }
        }
    }

    // Validate triangle indices (shader-local vertex range)
    for (int32_t idx : allTriIndices) {
        if (idx < 0 || static_cast<uint32_t>(idx) >= pidxCount) {
            throw FormatParseError("SKMG PSDT: triangle index out of range");
        }
    }

    // De-index: gather positions and normals from global pool
    uint32_t vtxCount = pidxCount;
    std::vector<float> positions(vtxCount * 3);
    std::vector<float> normals;
    for (uint32_t i = 0; i < vtxCount; ++i) {
        uint32_t pi = static_cast<uint32_t>(pidx[i]);
        positions[i*3+0] = posPool[pi*3+0];
        positions[i*3+1] = posPool[pi*3+1];
        positions[i*3+2] = posPool[pi*3+2];
    }
    if (!normPool.empty() && nidx.size() == pidxCount) {
        normals.resize(vtxCount * 3);
        for (uint32_t i = 0; i < vtxCount; ++i) {
            uint32_t ni = static_cast<uint32_t>(nidx[i]);
            normals[i*3+0] = normPool[ni*3+0];
            normals[i*3+1] = normPool[ni*3+1];
            normals[i*3+2] = normPool[ni*3+2];
        }
    }

    // Skin weight normalization per shader-local vertex
    // Each shader-local vertex i maps to global position pidx[i],
    // which indexes the twhd/twdt arrays.
    std::vector<int32_t> skinIndices;
    std::vector<float>   skinWeights;
    if (!twhd.empty() && !twdt_xform.empty()) {
        skinIndices.resize(vtxCount * 4, 0);
        skinWeights.resize(vtxCount * 4, 0.0f);

        // Build per-global-vertex offset into TWDT stream
        // twhd[i] = influence count for global vertex i
        // TWDT stream: sum(twhd[0..i-1]) * 2 floats per entry
        std::vector<uint32_t> twdtOffset(twhd.size(), 0);
        uint32_t runningOffset = 0;
        for (uint32_t i = 0; i < static_cast<uint32_t>(twhd.size()); ++i) {
            twdtOffset[i] = runningOffset;
            runningOffset += static_cast<uint32_t>(twhd[i]);
        }

        for (uint32_t i = 0; i < vtxCount; ++i) {
            uint32_t gi = static_cast<uint32_t>(pidx[i]); // global vertex index
            if (gi >= static_cast<uint32_t>(twhd.size())) continue;
            int32_t count = twhd[gi];
            uint32_t off  = twdtOffset[gi];
            if (count <= 0) {
                // All-zero influence → root bone (index 0), weight 1.0
                skinIndices[i*4+0] = 0;
                skinWeights[i*4+0] = 1.0f;
                continue;
            }
            // Clamp count to available TWDT data
            uint32_t available = static_cast<uint32_t>(twdt_xform.size()) - off;
            if (static_cast<uint32_t>(count) > available) count = static_cast<int32_t>(available);

            // Gather (transformIndex, weight) pairs
            struct Influence { int32_t xformIdx; float weight; };
            std::vector<Influence> infs(static_cast<size_t>(count));
            for (int32_t j = 0; j < count; ++j) {
                infs[j].xformIdx = twdt_xform[off + j];
                infs[j].weight   = twdt_weight[off + j];
            }

            // Sort by weight descending, take top 4
            std::sort(infs.begin(), infs.end(),
                [](const Influence& a, const Influence& b) { return a.weight > b.weight; });
            int32_t take = std::min(count, 4);
            if (take < count) weightsTruncated++;

            // Renormalize
            float sum = 0.0f;
            for (int32_t j = 0; j < take; ++j) sum += infs[j].weight;
            if (sum < 1e-6f) sum = 1.0f;

            for (int32_t j = 0; j < 4; ++j) {
                if (j < take) {
                    // Remap: TWDT transformIndex → boneOrder
                    int32_t xfIdx = infs[j].xformIdx;
                    int32_t boneIdx = xfIdx; // default: XFNM-local if boneOrder empty
                    if (!boneOrder.empty() && xfIdx >= 0 && xfIdx < static_cast<int32_t>(xfnm.size())) {
                        const std::string& boneName = xfnm[static_cast<size_t>(xfIdx)];
                        auto it = std::find(boneOrder.begin(), boneOrder.end(), boneName);
                        if (it != boneOrder.end()) {
                            boneIdx = static_cast<int32_t>(std::distance(boneOrder.begin(), it));
                        }
                    }
                    skinIndices[i*4+j] = boneIdx;
                    skinWeights[i*4+j] = infs[j].weight / sum;
                } else {
                    skinIndices[i*4+j] = 0;
                    skinWeights[i*4+j] = 0.0f;
                }
            }
        }
    }

    // Convert triangle indices to Uint32
    std::vector<uint32_t> indices(allTriIndices.size());
    for (size_t i = 0; i < allTriIndices.size(); ++i) {
        indices[i] = static_cast<uint32_t>(allTriIndices[i]);
    }

    // Pack into geometry buffer and record attribute slices
    MeshShaderGroupResult g;
    g.shaderName  = shaderName;
    g.vertexCount = vtxCount;
    g.indexCount  = static_cast<uint32_t>(indices.size());

    auto packSlice = [&](const void* ptr, uint32_t byteLen, uint32_t compCount, uint32_t elemCount) {
        uint32_t off = static_cast<uint32_t>(geomBuf.size());
        const uint8_t* src = static_cast<const uint8_t*>(ptr);
        geomBuf.insert(geomBuf.end(), src, src + byteLen);
        return MeshAttributeSlice{ off, byteLen, compCount, elemCount };
    };

    g.positions = packSlice(positions.data(), static_cast<uint32_t>(positions.size() * 4), 3, vtxCount);
    if (!normals.empty()) {
        g.normals = packSlice(normals.data(), static_cast<uint32_t>(normals.size() * 4), 3, vtxCount);
    }
    if (!uvData.empty()) {
        g.uvs = packSlice(uvData.data(), static_cast<uint32_t>(uvData.size() * 4), 2, vtxCount);
    }
    g.indices = packSlice(indices.data(), static_cast<uint32_t>(indices.size() * 4), 1, static_cast<uint32_t>(indices.size()));
    if (!skinIndices.empty()) {
        g.skinIndices = packSlice(skinIndices.data(), static_cast<uint32_t>(skinIndices.size() * 4), 4, vtxCount);
        g.skinWeights = packSlice(skinWeights.data(), static_cast<uint32_t>(skinWeights.size() * 4), 4, vtxCount);
    }

    groups.push_back(std::move(g));
}

// ─── Public entry point ───────────────────────────────────────────────────────

SkeletalMeshResult parseSkeletalMesh(
    const swg_core::iff::IffNode& root,
    const uint8_t* srcData,
    uint32_t srcSize,
    const std::vector<std::string>& boneOrder)
{
    // Validate top-level: FORM SKMG
    if (!root.isForm || strncmp(root.tag, "FORM", 4) != 0 || strncmp(root.subType, "SKMG", 4) != 0) {
        throw FormatParseError("SKMG: root must be FORM SKMG");
    }

    // Find version form: 0002, 0003, or 0004
    const swg_core::iff::IffNode* versionForm = nullptr;
    std::string version;
    for (const char* ver : {"0004", "0003", "0002"}) {
        versionForm = findChildForm(root, ver);
        if (versionForm) { version = ver; break; }
    }
    if (!versionForm) throw FormatParseError("SKMG: missing version FORM (0002/0003/0004)");

    bool isV4 = (version == "0004");

    // Parse INFO
    const auto* infoLeaf = findChildLeaf(*versionForm, "INFO");
    if (!infoLeaf) throw FormatParseError("SKMG: missing INFO chunk");
    auto info = parseInfo(*infoLeaf, srcData, srcSize);

    // Security bounds
    constexpr int32_t kMaxPos    = 1'000'000;
    constexpr int32_t kMaxXfnm   = 1024;
    constexpr int32_t kMaxShaders = 512;
    if (info.positionCount < 0 || info.positionCount > kMaxPos)
        throw FormatParseError("SKMG: positionCount out of bounds");
    if (info.transformNameCount < 0 || info.transformNameCount > kMaxXfnm)
        throw FormatParseError("SKMG: transformNameCount out of bounds");
    if (info.perShaderDataCount < 0 || info.perShaderDataCount > kMaxShaders)
        throw FormatParseError("SKMG: perShaderDataCount out of bounds");
    if (info.transformWeightDataCount < 0 || info.transformWeightDataCount > info.positionCount * 16)
        throw FormatParseError("SKMG: transformWeightDataCount out of bounds");

    // Inner SKTM chunk: flat NUL-terminated skeleton template path strings
    // This is NOT a FORM SKTM — it's a leaf chunk tag SKTM inside the version form.
    // (delta #7: inner SKTM is a leaf, not a parseSkeleton form)
    std::vector<std::string> sktmNames;
    const auto* sktmLeaf = findChildLeaf(*versionForm, "SKTM");
    if (sktmLeaf) {
        auto cv = chunkPayload(*sktmLeaf, srcData, srcSize);
        for (int32_t i = 0; i < info.skeletonTemplateNameCount; ++i) {
            sktmNames.push_back(cv.readString());
        }
    }

    // XFNM: NUL-terminated bone/transform name table
    std::vector<std::string> xfnm;
    const auto* xfnmLeaf = findChildLeaf(*versionForm, "XFNM");
    if (xfnmLeaf) {
        auto cv = chunkPayload(*xfnmLeaf, srcData, srcSize);
        for (int32_t i = 0; i < info.transformNameCount; ++i) {
            xfnm.push_back(cv.readString());
        }
    }

    // POSN: global position pool (positionCount × 3 float32)
    std::vector<float> posPool;
    const auto* posnLeaf = findChildLeaf(*versionForm, "POSN");
    if (posnLeaf) {
        auto cv = chunkPayload(*posnLeaf, srcData, srcSize);
        posPool.resize(static_cast<size_t>(info.positionCount) * 3);
        for (int32_t i = 0; i < info.positionCount * 3; ++i) posPool[i] = cv.readF32();
    }

    // TWHD: per-vertex influence count (positionCount × int32)
    std::vector<int32_t> twhd;
    const auto* twhdLeaf = findChildLeaf(*versionForm, "TWHD");
    if (twhdLeaf) {
        auto cv = chunkPayload(*twhdLeaf, srcData, srcSize);
        twhd.resize(static_cast<size_t>(info.positionCount));
        for (int32_t i = 0; i < info.positionCount; ++i) twhd[i] = cv.readI32LE();
    }

    // TWDT: flat (int32 xformIdx, float32 weight) × transformWeightDataCount
    std::vector<int32_t> twdt_xform;
    std::vector<float>   twdt_weight;
    const auto* twdtLeaf = findChildLeaf(*versionForm, "TWDT");
    if (twdtLeaf) {
        auto cv = chunkPayload(*twdtLeaf, srcData, srcSize);
        uint32_t count = static_cast<uint32_t>(info.transformWeightDataCount);
        twdt_xform.resize(count);
        twdt_weight.resize(count);
        for (uint32_t i = 0; i < count; ++i) {
            twdt_xform[i]  = cv.readI32LE();
            twdt_weight[i] = cv.readF32();
        }
    }

    // NORM: global normal pool (normalCount × 3 float32), optional
    std::vector<float> normPool;
    if (info.normalCount > 0) {
        const auto* normLeaf = findChildLeaf(*versionForm, "NORM");
        if (normLeaf) {
            auto cv = chunkPayload(*normLeaf, srcData, srcSize);
            normPool.resize(static_cast<size_t>(info.normalCount) * 3);
            for (int32_t i = 0; i < info.normalCount * 3; ++i) normPool[i] = cv.readF32();
        }
    }

    // DOT3: v0004 only — skip global tangent pool (not needed for basic rendering)
    // (We just skip it; tangent rendering is a Phase 3+ concern)

    // Collect PSDT per-shader groups
    // They appear as direct children of versionForm with subType "PSDT"
    auto psdtNodes = collectPSDTForms(*versionForm);

    SkeletalMeshResult result;
    result.formatTag     = "SKMG";
    result.version       = version;
    result.boneNames     = xfnm;
    result.sktmNames     = sktmNames;
    result.needsBoneRemap = boneOrder.empty();

    for (const auto* psdt : psdtNodes) {
        processPSDT(*psdt, srcData, srcSize,
                    posPool, normPool, twhd, twdt_xform, twdt_weight,
                    xfnm, boneOrder,
                    result.geometry, result.shaderGroups, result.weightsTruncated,
                    isV4);
    }

    return result;
}

} // namespace formats
} // namespace swg_core
