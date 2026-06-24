/**
 * modules/core/formats/SkeletalAppearance.cpp — Engine-free C++20 FORM SMAT parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 SkeletalAppearanceTemplate.cpp
 *     load_0001 :786-883
 *     load_0002 :900-970
 *     load_0003 :980-1136
 *
 * STRUCTURE:
 *   FORM SMAT
 *     FORM 000{1,2,3}
 *       INFO  (int32 meshGeneratorCount + int32 skeletonTemplateCount + char[] filename/animGraphName)
 *       MSGN  (meshGeneratorCount × NUL-terminated mesh path strings)
 *       SKTI  (skeletonTemplateCount × (char[] skeletonPath, char[] attachmentTransformName) pairs)
 *       [LATX v0003 only — skip]
 *
 * Decision D-02: C++20, engine-free.
 */

#include "SkeletalAppearance.h"

#include <cstring>

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
        if (!canRead(4)) throw FormatParseError("SMAT ChunkView: unexpected end");
        int32_t v; std::memcpy(&v, data + pos, 4); pos += 4; return v;
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
};

static ChunkView chunkPayload(const swg_core::iff::IffNode& leaf,
                               const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("SMAT: chunkPayload called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize)
        throw FormatParseError("SMAT: chunk extends beyond source buffer");
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── Public entry point ───────────────────────────────────────────────────────

SkeletalAppearanceResult parseSkeletalAppearance(
    const swg_core::iff::IffNode& root,
    const uint8_t* srcData,
    uint32_t srcSize)
{
    // Validate root: FORM SMAT
    if (!root.isForm || strncmp(root.tag, "FORM", 4) != 0 || strncmp(root.subType, "SMAT", 4) != 0) {
        throw FormatParseError("SMAT: root must be FORM SMAT");
    }

    // Find version form: 0001, 0002, or 0003
    const swg_core::iff::IffNode* versionForm = nullptr;
    std::string version;
    for (const char* ver : {"0003", "0002", "0001"}) {
        versionForm = findChildForm(root, ver);
        if (versionForm) { version = ver; break; }
    }
    if (!versionForm) throw FormatParseError("SMAT: missing version FORM (0001/0002/0003)");

    // Security bounds
    constexpr int32_t kMaxCount = 256;

    // INFO chunk: int32 meshGeneratorCount + int32 skeletonTemplateCount + char[] filename
    const auto* infoLeaf = findChildLeaf(*versionForm, "INFO");
    if (!infoLeaf) throw FormatParseError("SMAT: missing INFO chunk");
    auto infoCv = chunkPayload(*infoLeaf, srcData, srcSize);
    int32_t meshGeneratorCount     = infoCv.readI32LE();
    int32_t skeletonTemplateCount  = infoCv.readI32LE();
    std::string filename           = infoCv.readString();

    if (meshGeneratorCount < 0 || meshGeneratorCount > kMaxCount)
        throw FormatParseError("SMAT: meshGeneratorCount out of bounds");
    if (skeletonTemplateCount < 0 || skeletonTemplateCount > kMaxCount)
        throw FormatParseError("SMAT: skeletonTemplateCount out of bounds");

    SkeletalAppearanceResult result;
    result.formatTag = "SMAT";
    result.version   = version;
    result.filename  = filename;

    // MSGN: meshGeneratorCount × NUL-terminated mesh generator path strings
    const auto* msgnLeaf = findChildLeaf(*versionForm, "MSGN");
    if (msgnLeaf) {
        auto cv = chunkPayload(*msgnLeaf, srcData, srcSize);
        for (int32_t i = 0; i < meshGeneratorCount; ++i) {
            result.meshPaths.push_back(cv.readString());
        }
    }

    // SKTI: skeletonTemplateCount × (char[] skeletonPath, char[] attachmentTransformName)
    const auto* sktiLeaf = findChildLeaf(*versionForm, "SKTI");
    if (sktiLeaf) {
        auto cv = chunkPayload(*sktiLeaf, srcData, srcSize);
        for (int32_t i = 0; i < skeletonTemplateCount; ++i) {
            SktReference ref;
            ref.skeletonPath             = cv.readString();
            ref.attachmentTransformName  = cv.readString();
            result.skeletonRefs.push_back(std::move(ref));
        }
    }

    // LATX: v0003 attachment transforms — skip for MVP (not needed for basic rendering)

    return result;
}

} // namespace formats
} // namespace swg_core
