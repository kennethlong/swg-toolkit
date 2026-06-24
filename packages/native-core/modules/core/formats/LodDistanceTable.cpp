/**
 * modules/core/formats/LodDistanceTable.cpp — Engine-free C++20 FORM LDTB parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 LodDistanceTable.cpp:140-175 (load_0000)
 *
 * STRUCTURE:
 *   FORM LDTB
 *     FORM 0000
 *       INFO  (int16 levelCount + per-level float32 minDist + float32 maxDist)
 *
 * Decision D-02: C++20, engine-free.
 */

#include "LodDistanceTable.h"
#include <cstring>

namespace swg_core {
namespace formats {

// ─── Chunk view ───────────────────────────────────────────────────────────────

struct LdtbChunkView {
    const uint8_t* data;
    uint32_t size;
    uint32_t pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }

    int16_t readI16LE() {
        if (!canRead(2)) throw FormatParseError("LdtbChunkView: unexpected end");
        int16_t v;
        std::memcpy(&v, data + pos, 2);
        pos += 2;
        return v;
    }
    float readF32LE() {
        if (!canRead(4)) throw FormatParseError("LdtbChunkView: unexpected end");
        float v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
};

static LdtbChunkView ldtbChunkPayload(const swg_core::iff::IffNode& leaf,
                                       const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("ldtbChunkPayload: called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize) {
        throw FormatParseError("ldtbChunkPayload: chunk extends beyond source buffer");
    }
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── parseLodDistanceTable (public) ──────────────────────────────────────────

LodDistanceTableResult parseLodDistanceTable(const swg_core::iff::IffNode& root,
                                              const uint8_t* srcData, uint32_t srcSize)
{
    LodDistanceTableResult result;

    if (!root.isForm || strncmp(root.subType, "LDTB", 4) != 0) {
        throw FormatParseError("parseLodDistanceTable: root is not FORM LDTB");
    }
    result.formatTag = "LDTB";

    // Find FORM 0000
    const swg_core::iff::IffNode* ver0000 = nullptr;
    for (const auto& child : root.children) {
        if (child.isForm && strncmp(child.subType, "0000", 4) == 0) {
            ver0000 = &child; break;
        }
    }
    if (!ver0000) throw FormatParseError("FORM LDTB: missing FORM 0000");
    result.version = "0000";

    // INFO chunk: int16 levelCount + per-level float32 minDist + float32 maxDist
    const swg_core::iff::IffNode* infoNode = nullptr;
    for (const auto& child : ver0000->children) {
        if (!child.isForm && strncmp(child.tag, "INFO", 4) == 0) {
            infoNode = &child; break;
        }
    }
    if (!infoNode) throw FormatParseError("FORM LDTB 0000: missing INFO chunk");

    auto infoCv = ldtbChunkPayload(*infoNode, srcData, srcSize);

    // Source: LodDistanceTable.cpp:152-155
    int16_t levelCount = infoCv.readI16LE();
    if (levelCount < 0) levelCount = 0;  // Clamp per source: "if (m_levelCount < 0) m_levelCount = 0"
    result.levelCount = levelCount;

    // Source: LodDistanceTable.cpp:160-171
    result.levels.reserve(static_cast<size_t>(levelCount));
    for (int16_t i = 0; i < levelCount; ++i) {
        LodLevel level;
        level.minDist = infoCv.readF32LE();  // as-read, NOT squared
        level.maxDist = infoCv.readF32LE();  // as-read, NOT squared
        result.levels.push_back(level);
    }

    return result;
}

} // namespace formats
} // namespace swg_core
