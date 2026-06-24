/**
 * modules/core/formats/MeshLod.cpp — Engine-free C++20 FORM MLOD LOD-mesh parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 LodMeshGeneratorTemplate.cpp:210-254 (load_0000)
 *
 * STRUCTURE:
 *   FORM MLOD
 *     FORM 0000
 *       INFO  (int16 levelCount)
 *       NAME  (char[] level0Path\0)
 *       NAME  (char[] level1Path\0)
 *       ...
 *
 * Decision D-02: C++20, engine-free.
 */

#include "MeshLod.h"
#include <cstring>

namespace swg_core {
namespace formats {

// ─── Chunk view helper (duplicated here for independence) ─────────────────────

struct MlodChunkView {
    const uint8_t* data;
    uint32_t size;
    uint32_t pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }

    int16_t readI16LE() {
        if (!canRead(2)) throw FormatParseError("MlodChunkView: unexpected end");
        int16_t v;
        std::memcpy(&v, data + pos, 2);
        pos += 2;
        return v;
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

static MlodChunkView mlodChunkPayload(const swg_core::iff::IffNode& leaf,
                                       const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("mlodChunkPayload: called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize) {
        throw FormatParseError("mlodChunkPayload: chunk extends beyond source buffer");
    }
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── parseMeshLod (public) ────────────────────────────────────────────────────

MeshLodResult parseMeshLod(const swg_core::iff::IffNode& root,
                            const uint8_t* srcData, uint32_t srcSize)
{
    MeshLodResult result;

    // root must be FORM MLOD
    if (!root.isForm || strncmp(root.subType, "MLOD", 4) != 0) {
        throw FormatParseError("parseMeshLod: root is not FORM MLOD");
    }
    result.formatTag = "MLOD";

    // Find FORM 0000 inside FORM MLOD
    const swg_core::iff::IffNode* ver0000 = nullptr;
    for (const auto& child : root.children) {
        if (child.isForm && strncmp(child.subType, "0000", 4) == 0) {
            ver0000 = &child;
            break;
        }
    }
    if (!ver0000) throw FormatParseError("FORM MLOD: missing FORM 0000");
    result.version = "0000";

    // INFO chunk: int16 levelCount
    const swg_core::iff::IffNode* infoNode = nullptr;
    for (const auto& child : ver0000->children) {
        if (!child.isForm && strncmp(child.tag, "INFO", 4) == 0) {
            infoNode = &child;
            break;
        }
    }
    if (!infoNode) throw FormatParseError("FORM MLOD 0000: missing INFO chunk");
    auto infoCv = mlodChunkPayload(*infoNode, srcData, srcSize);
    result.levelCount = infoCv.readI16LE();

    if (result.levelCount < 0 || result.levelCount > 64) {
        throw FormatParseError("FORM MLOD: levelCount out of range");
    }

    // NAME chunks: one per LOD level
    // Source: LodMeshGeneratorTemplate.cpp:238-243
    //   for (int i = 0; i < m_lodCount; ++i) {
    //     iff.enterChunk(TAG_NAME);
    //     m_lodMeshFilename[i] = DuplicateString(iff.read_string());
    //     iff.exitChunk(TAG_NAME);
    //   }
    result.levels.reserve(static_cast<size_t>(result.levelCount));
    for (const auto& child : ver0000->children) {
        if (!child.isForm && strncmp(child.tag, "NAME", 4) == 0) {
            auto nameCv = mlodChunkPayload(child, srcData, srcSize);
            MeshLodLevel level;
            level.path = nameCv.readString();
            result.levels.push_back(std::move(level));
            if (static_cast<int16_t>(result.levels.size()) >= result.levelCount) break;
        }
    }

    return result;
}

} // namespace formats
} // namespace swg_core
