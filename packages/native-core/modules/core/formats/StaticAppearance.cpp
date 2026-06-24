/**
 * modules/core/formats/StaticAppearance.cpp — Engine-free C++20 FORM APT parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 AppearanceTemplateList.cpp :513-540
 *
 * STRUCTURE:
 *   FORM APT
 *     FORM 0000
 *       NAME (char[] redirectTarget, NUL-terminated)
 *
 * Security (T-02-08): reject redirectTarget ending with ".apt" (no circular indirection).
 *
 * Decision D-02: C++20, engine-free.
 */

#include "StaticAppearance.h"

#include <cstring>
#include <algorithm>

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
    if (leaf.isForm) throw FormatParseError("APT: chunkPayload called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize)
        throw FormatParseError("APT: chunk extends beyond source buffer");
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── Public entry point ───────────────────────────────────────────────────────

StaticAppearanceResult parseStaticAppearance(
    const swg_core::iff::IffNode& root,
    const uint8_t* srcData,
    uint32_t srcSize)
{
    // Validate root: FORM APT
    if (!root.isForm || strncmp(root.tag, "FORM", 4) != 0 || strncmp(root.subType, "APT ", 4) != 0) {
        throw FormatParseError("APT: root must be FORM APT");
    }

    // Enter FORM 0000
    const auto* form0000 = findChildForm(root, "0000");
    if (!form0000) throw FormatParseError("APT: missing FORM 0000");

    // NAME chunk: NUL-terminated redirect target path
    const auto* nameLeaf = findChildLeaf(*form0000, "NAME");
    if (!nameLeaf) throw FormatParseError("APT: missing NAME chunk");
    auto cv = chunkPayload(*nameLeaf, srcData, srcSize);
    std::string redirectTarget = cv.readString();

    // Security (T-02-08): no multi-level APT indirection
    // Source: AppearanceTemplateList.cpp:530 — FATAL if ends with ".apt"
    if (redirectTarget.size() >= 4) {
        auto suffix = redirectTarget.substr(redirectTarget.size() - 4);
        // case-insensitive check
        std::transform(suffix.begin(), suffix.end(), suffix.begin(),
            [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (suffix == ".apt") {
            throw FormatParseError("APT: redirectTarget ends with '.apt' — circular indirection forbidden");
        }
    }

    StaticAppearanceResult result;
    result.formatTag      = "APT";
    result.redirectTarget = redirectTarget;
    return result;
}

} // namespace formats
} // namespace swg_core
