/**
 * modules/core/formats/DetailAppearance.cpp — Engine-free C++20 FORM DTLA LOD appearance parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 DetailAppearanceTemplate.cpp:556-658 (load())
 *   swg-client-v2 DetailAppearanceTemplate.cpp:343-417 (loadEntries())
 *
 * STRUCTURE (verified 2026-06-24 against real wb_02_09e_00000000000000000000.lod, 362 bytes):
 *   FORM DTLA
 *     FORM <versionTag>          // '0001'..'0008'
 *       [ver>=4] FORM APPR ...   // AppearanceTemplate (extents/hardpoints/floor) — skip cleanly
 *       [ver>=6] PIVT uint8      // lodFlags: bit0=usePivotPoint, bit1(ver>=8)=disableLodCrossFade
 *       INFO { int32 id, float near, float far } × N   // N = chunkLen / 12
 *       FORM DATA
 *         CHLD { int32 id, char name[]\0 } × N         // one CHLD per child
 *       [ver>=7] FORM RADR  INFO(int32 hasShape) [+IndexedTriList]  // skip (collision)
 *       [ver>=2] FORM TEST  INFO(int32 hasShape) [+IndexedTriList]  // skip (collision)
 *       [ver>=2] FORM WRIT  INFO(int32 hasShape) [+IndexedTriList]  // skip (collision)
 *
 * Decision D-02: C++20, engine-free.
 */

#include "DetailAppearance.h"
#include <cstring>
#include <algorithm>

namespace swg_core {
namespace formats {

// ─── Chunk view helper ────────────────────────────────────────────────────────

struct DtlaChunkView {
    const uint8_t* data;
    uint32_t size;
    uint32_t pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }

    int32_t readI32LE() {
        if (!canRead(4)) throw FormatParseError("DtlaChunkView: unexpected end (i32)");
        int32_t v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }

    float readF32LE() {
        if (!canRead(4)) throw FormatParseError("DtlaChunkView: unexpected end (f32)");
        float v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }

    uint8_t readU8() {
        if (!canRead(1)) throw FormatParseError("DtlaChunkView: unexpected end (u8)");
        return data[pos++];
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

static DtlaChunkView dtlaChunkPayload(const swg_core::iff::IffNode& leaf,
                                       const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("dtlaChunkPayload: called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize) {
        throw FormatParseError("dtlaChunkPayload: chunk extends beyond source buffer");
    }
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── ConvertTagToInt: '0001'..'0008' → 1..8 ──────────────────────────────────
// Client uses ConvertTagToInt which reads the 4-char tag as a decimal integer.
// e.g. tag "0007" → digits '0','0','0','7' → 7
// Source: DetailAppearanceTemplate.cpp:565 (ConvertTagToInt(versionTag))
static int convertTagToInt(const char tag[4]) {
    // Tags are ASCII decimal digits padded with '0' (e.g. "0007", "0001")
    // Simple parse: treat as 4-digit decimal
    int result = 0;
    for (int i = 0; i < 4; ++i) {
        if (tag[i] >= '0' && tag[i] <= '9') {
            result = result * 10 + (tag[i] - '0');
        }
    }
    return result;
}

// ─── parseDetailAppearance (public) ──────────────────────────────────────────

DetailAppearanceResult parseDetailAppearance(const swg_core::iff::IffNode& root,
                                              const uint8_t* srcData, uint32_t srcSize)
{
    DetailAppearanceResult result;

    // root must be FORM DTLA
    // Source: DetailAppearanceTemplate.cpp:558 (iff.enterForm(TAG_DTLA))
    if (!root.isForm || strncmp(root.subType, "DTLA", 4) != 0) {
        throw FormatParseError("parseDetailAppearance: root is not FORM DTLA");
    }
    result.formatTag = "DTLA";

    // Find the version FORM inside FORM DTLA
    // Source: DetailAppearanceTemplate.cpp:564-572 (getCurrentName() → versionTag, enterForm(versionTag))
    const swg_core::iff::IffNode* verForm = nullptr;
    for (const auto& child : root.children) {
        if (child.isForm) {
            verForm = &child;
            break;
        }
    }
    if (!verForm) {
        throw FormatParseError("FORM DTLA: missing version FORM");
    }

    char verTag[5] = {};
    std::strncpy(verTag, verForm->subType, 4);
    verTag[4] = '\0';
    result.versionTag = std::string(verTag);

    int version = convertTagToInt(verTag);
    if (version < 1 || version > 8) {
        throw FormatParseError(std::string("parseDetailAppearance: unsupported version: ") + verTag);
    }

    // Walk children of the version FORM in order
    // Source: DetailAppearanceTemplate.cpp:573-624 (version-gated sections in order)
    result.lodFlags = 0;

    // Collect INFO entries and CHLD entries by tag
    // We process children in order, skipping APPR/RADR/TEST/WRIT sub-forms cleanly.

    // Intermediate storage for join
    struct InfoEntry {
        int32_t id;
        float   near;
        float   far;
    };
    struct ChldEntry {
        int32_t    id;
        std::string name;
    };
    std::vector<InfoEntry> infoEntries;
    std::vector<ChldEntry> chldEntries;

    bool foundInfo = false;
    bool foundData = false;

    for (const auto& child : verForm->children) {
        if (child.isForm) {
            // Skip APPR (ver>=4), RADR (ver>=7), TEST (ver>=2), WRIT (ver>=2) cleanly
            // Source: DetailAppearanceTemplate.cpp:575-621
            // FORM DATA: contains CHLD chunks
            if (strncmp(child.subType, "DATA", 4) == 0) {
                foundData = true;
                // Process CHLD chunks inside FORM DATA
                // Source: DetailAppearanceTemplate.cpp:366-383
                for (const auto& dataChild : child.children) {
                    if (!dataChild.isForm && strncmp(dataChild.tag, "CHLD", 4) == 0) {
                        auto cv = dtlaChunkPayload(dataChild, srcData, srcSize);
                        ChldEntry entry;
                        entry.id   = cv.readI32LE();
                        entry.name = cv.readString();
                        chldEntries.push_back(std::move(entry));
                    }
                }
            }
            // All other sub-forms (APPR, RADR, TEST, WRIT) are skipped cleanly by
            // not entering them — their contents are irrelevant for viewport LOD resolution.
        } else {
            // Leaf chunks
            if (strncmp(child.tag, "PIVT", 4) == 0 && version >= 6) {
                // Source: DetailAppearanceTemplate.cpp:583-593
                auto cv = dtlaChunkPayload(child, srcData, srcSize);
                result.lodFlags = cv.readU8();
            } else if (strncmp(child.tag, "INFO", 4) == 0 && !foundInfo) {
                // Source: DetailAppearanceTemplate.cpp:345-364 (loadEntries: enterChunk(INFO))
                // N = chunkLen / 12
                foundInfo = true;
                auto cv = dtlaChunkPayload(child, srcData, srcSize);
                while (cv.canRead(12)) {
                    InfoEntry entry;
                    entry.id   = cv.readI32LE();
                    entry.near = cv.readF32LE();
                    entry.far  = cv.readF32LE();
                    infoEntries.push_back(entry);
                }
            }
        }
    }

    if (!foundInfo) {
        throw FormatParseError("FORM DTLA: missing INFO chunk in version form");
    }
    if (!foundData) {
        throw FormatParseError("FORM DTLA: missing FORM DATA in version form");
    }

    // Join INFO entries with CHLD entries by id
    // Source: DetailAppearanceTemplate.cpp:374-382 (findChild(id) for each CHLD → set name)
    // Then sort by farDistance descending (client sorts after loading)
    // Source: DetailAppearanceTemplate.cpp:636 (std::sort childSorter — farDistance descending)
    result.levels.reserve(infoEntries.size());

    for (const auto& info : infoEntries) {
        DetailAppearanceLevel level;
        level.id   = info.id;
        level.near = info.near;
        level.far  = info.far;

        // Find matching CHLD by id
        // Source: DetailAppearanceTemplate.cpp:374-378 (findChild(id) → child->appearanceTemplateName = ...)
        bool found = false;
        for (const auto& chld : chldEntries) {
            if (chld.id == info.id) {
                level.childPath = chld.name;
                found = true;
                break;
            }
        }
        if (!found) {
            // Graceful: include the level with empty childPath rather than throwing
            level.childPath = "";
        }

        result.levels.push_back(std::move(level));
    }

    // Sort by farDistance descending — mirrors the client's std::sort(childSorter)
    // Source: DetailAppearanceTemplate.cpp:636
    std::sort(result.levels.begin(), result.levels.end(),
              [](const DetailAppearanceLevel& a, const DetailAppearanceLevel& b) {
                  return a.far > b.far;
              });

    return result;
}

} // namespace formats
} // namespace swg_core
