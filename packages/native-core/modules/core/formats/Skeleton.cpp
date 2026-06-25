/**
 * modules/core/formats/Skeleton.cpp — Engine-free C++20 FORM SKTM skeleton parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 clientSkeletalAnimation/appearance/BasicSkeletonTemplate.cpp
 *     load_0001 :151-286 — INFO→NAME→PRNT→RPRE→RPST→BPTR→BPRO→BPMJ(mandatory)→JROR
 *     load_0002 :290-390 — INFO→NAME→PRNT→RPRE→RPST→BPTR→BPRO→JROR (NO BPMJ)
 *
 * STRUCTURE:
 *   FORM SKTM
 *     FORM 0001 (or 0002)
 *       INFO  (int32 jointCount)
 *       NAME  (jointCount × NUL-terminated strings)
 *       PRNT  (jointCount × int32 parent indices)
 *       RPRE  (jointCount × 4×float32 quaternions w,x,y,z)
 *       RPST  (jointCount × 4×float32 quaternions w,x,y,z)
 *       BPTR  (jointCount × 3×float32 translation vectors)
 *       BPRO  (jointCount × 3×float32 offset vectors)
 *       [BPMJ v0001 only] (jointCount × 3×float32 — consume, not used for rendering)
 *       JROR  (jointCount × (float32, int32) rotation records — skip)
 *
 * Decision D-02: C++20, engine-free.
 */

#include "Skeleton.h"

#include <cstring>
#include <sstream>

namespace swg_core {
namespace formats {

// ─── IFF node helpers ─────────────────────────────────────────────────────────

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

// ─── ChunkView ────────────────────────────────────────────────────────────────

struct ChunkView {
    const uint8_t* data;
    uint32_t size;
    uint32_t pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }
    int32_t readI32LE() {
        if (!canRead(4)) throw FormatParseError("SKTM ChunkView: unexpected end");
        int32_t v; std::memcpy(&v, data + pos, 4); pos += 4; return v;
    }
    float readF32() {
        if (!canRead(4)) throw FormatParseError("SKTM ChunkView: unexpected end");
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
    void skip(uint32_t n) {
        if (!canRead(n)) throw FormatParseError("SKTM ChunkView: skip past end");
        pos += n;
    }
};

static ChunkView chunkPayload(const swg_core::iff::IffNode& leaf,
                               const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("SKTM: chunkPayload called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize)
        throw FormatParseError("SKTM: chunk extends beyond source buffer");
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── Public entry point ───────────────────────────────────────────────────────

SkeletonResult parseSkeleton(
    const swg_core::iff::IffNode& root,
    const uint8_t* srcData,
    uint32_t srcSize)
{
    if (!root.isForm || strncmp(root.tag, "FORM", 4) != 0) {
        throw FormatParseError("SKTM: root must be FORM SKTM (got leaf or non-FORM)");
    }

    // Real character skeletons (all_b, protocol_droid, ...) are wrapped FORM SLOD (multi-LOD):
    //   FORM SLOD -> FORM 0000 -> INFO(lodCount) + FORM SKTM (one per LOD).
    // Unwrap to LOD 0 (the first / highest-detail SKTM) so animation has the full bone set.
    // Direct FORM SKTM (e.g. face skeletons like mon_m_face) is used as-is.
    const swg_core::iff::IffNode* sktm = &root;
    if (strncmp(root.subType, "SLOD", 4) == 0) {
        const auto* lodVer = findChildForm(root, "0000");
        if (!lodVer) throw FormatParseError("SLOD: missing version FORM 0000");
        const auto* firstSktm = findChildForm(*lodVer, "SKTM");
        if (!firstSktm) throw FormatParseError("SLOD: no SKTM LOD found inside FORM 0000");
        sktm = firstSktm;
    }
    if (strncmp(sktm->subType, "SKTM", 4) != 0) {
        throw FormatParseError("SKTM: root subType must be SKTM (or FORM SLOD wrapping one)");
    }

    // Find version form (0001 or 0002)
    const swg_core::iff::IffNode* versionForm = nullptr;
    std::string version;
    for (const char* ver : {"0002", "0001"}) {
        versionForm = findChildForm(*sktm, ver);
        if (versionForm) { version = ver; break; }
    }
    if (!versionForm) throw FormatParseError("SKTM: missing version FORM (0001 or 0002)");

    bool isV1 = (version == "0001");

    // INFO: int32 jointCount
    const auto* infoLeaf = findChildLeaf(*versionForm, "INFO");
    if (!infoLeaf) throw FormatParseError("SKTM: missing INFO chunk");
    auto infoCv = chunkPayload(*infoLeaf, srcData, srcSize);
    int32_t jointCount = infoCv.readI32LE();
    if (jointCount < 0 || jointCount > 10000)
        throw FormatParseError("SKTM: jointCount out of bounds");

    SkeletonResult result;
    result.formatTag = "SKTM";
    result.version   = version;
    result.bones.resize(static_cast<size_t>(jointCount));

    // NAME: jointCount × NUL-terminated bone name strings
    const auto* nameLeaf = findChildLeaf(*versionForm, "NAME");
    if (nameLeaf) {
        auto cv = chunkPayload(*nameLeaf, srcData, srcSize);
        for (int32_t i = 0; i < jointCount; ++i) {
            result.bones[i].name = cv.readString();
            result.boneNames.push_back(result.bones[i].name);
        }
    }

    // PRNT: jointCount × int32 parent index (-1 = root)
    const auto* prntLeaf = findChildLeaf(*versionForm, "PRNT");
    if (prntLeaf) {
        auto cv = chunkPayload(*prntLeaf, srcData, srcSize);
        for (int32_t i = 0; i < jointCount; ++i) result.bones[i].parentIndex = cv.readI32LE();
    }

    // RPRE: jointCount × 4 float32 pre-rotation quaternion (w,x,y,z)
    const auto* rpreLeaf = findChildLeaf(*versionForm, "RPRE");
    if (rpreLeaf) {
        auto cv = chunkPayload(*rpreLeaf, srcData, srcSize);
        for (int32_t i = 0; i < jointCount; ++i) {
            for (int k = 0; k < 4; ++k) result.bones[i].preRot[k] = cv.readF32();
        }
    }

    // RPST: jointCount × 4 float32 post-rotation quaternion (w,x,y,z)
    const auto* rpstLeaf = findChildLeaf(*versionForm, "RPST");
    if (rpstLeaf) {
        auto cv = chunkPayload(*rpstLeaf, srcData, srcSize);
        for (int32_t i = 0; i < jointCount; ++i) {
            for (int k = 0; k < 4; ++k) result.bones[i].postRot[k] = cv.readF32();
        }
    }

    // BPTR: jointCount × 3 float32 pre-translation
    const auto* bptrLeaf = findChildLeaf(*versionForm, "BPTR");
    if (bptrLeaf) {
        auto cv = chunkPayload(*bptrLeaf, srcData, srcSize);
        for (int32_t i = 0; i < jointCount; ++i) {
            for (int k = 0; k < 3; ++k) result.bones[i].bindPos[k] = cv.readF32();
        }
    }

    // BPRO: jointCount × 3 float32 pre-rotation-offset
    const auto* bproLeaf = findChildLeaf(*versionForm, "BPRO");
    if (bproLeaf) {
        auto cv = chunkPayload(*bproLeaf, srcData, srcSize);
        for (int32_t i = 0; i < jointCount; ++i) {
            for (int k = 0; k < 3; ++k) result.bones[i].preRotOff[k] = cv.readF32();
        }
    }

    // BPMJ: v0001 only — mandatory (consume but don't use for rendering)
    // Source: BasicSkeletonTemplate.cpp:280-286 — enterChunk(TAG_BPMJ) / exitChunk(TAG_BPMJ)
    if (isV1) {
        const auto* bpmjLeaf = findChildLeaf(*versionForm, "BPMJ");
        if (!bpmjLeaf) throw FormatParseError("SKTM v0001: mandatory BPMJ chunk missing");
        // consume — jointCount × 3 float32 major axis data, not needed for rendering
        (void)bpmjLeaf;
    }

    // JROR: jointCount × (float32 rotation, int32 axis) — skip for rendering
    // (Not needed for bind-pose skeleton construction)

    return result;
}

} // namespace formats
} // namespace swg_core
