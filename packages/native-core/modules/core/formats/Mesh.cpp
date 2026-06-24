/**
 * modules/core/formats/Mesh.cpp — Engine-free C++20 FORM MESH static mesh parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 MeshAppearanceTemplate.cpp:248-405 (FORM MESH dispatch + load_0005)
 *   swg-client-v2 ShaderPrimitiveSetTemplate.cpp:1459-1581 (SPS load)
 *   swg-client-v2 VertexBuffer.cpp:241-309 (load_0003: VTXA interleave)
 *   swg-client-v2 ShaderTemplateList.cpp:493-506 (NAME chunk → shader path)
 *
 * STRUCTURE (v0005 — the primary version):
 *   FORM MESH
 *     FORM 0005
 *       [APPR extent — skip; not needed for geometry]
 *       FORM SPS
 *         FORM 0001
 *           CNT  (int32 shaderCount)
 *           per shader: FORM (any subtype)
 *             NAME  (char[] shader path, NUL-terminated)
 *             INFO  (int32 primitiveCount)
 *             per primitive: FORM 0001 (LSPT 0001) or FORM 0000 (LSPT 0000)
 *               INFO  (int32 primitiveType + bool8 hasIndices + bool8 hasSortedIndices)
 *               FORM VTXA → FORM 0003 → INFO(uint32 flags, int32 vertCount) + DATA(interleaved)
 *               [INDX  int32 count + uint16[] (LSPT 0001) or int32[] (LSPT 0000)]
 *               [SIDX  sorted indices — skip]
 *
 * Decision D-02: C++20, engine-free.
 */

#include "Mesh.h"

#include <cstring>
#include <sstream>
#include <algorithm>
#include <stdexcept>

namespace swg_core {
namespace formats {

// ─── IFF node helpers ─────────────────────────────────────────────────────────

// Find a direct child node by tag (form: check subType; leaf: check tag)
static const swg_core::iff::IffNode* findChild(
    const swg_core::iff::IffNode& parent, const char* tag)
{
    if (!parent.isForm) return nullptr;
    for (const auto& child : parent.children) {
        if (child.isForm && strncmp(child.subType, tag, 4) == 0) return &child;
        if (!child.isForm && strncmp(child.tag, tag, 4) == 0) return &child;
    }
    return nullptr;
}

// Find a direct child FORM by subtype (e.g. "0005")
static const swg_core::iff::IffNode* findChildForm(
    const swg_core::iff::IffNode& parent, const char* subType)
{
    if (!parent.isForm) return nullptr;
    for (const auto& child : parent.children) {
        if (child.isForm && strncmp(child.subType, subType, 4) == 0) return &child;
    }
    return nullptr;
}

// Find a direct child leaf by tag
static const swg_core::iff::IffNode* findChildLeaf(
    const swg_core::iff::IffNode& parent, const char* tag)
{
    if (!parent.isForm) return nullptr;
    for (const auto& child : parent.children) {
        if (!child.isForm && strncmp(child.tag, tag, 4) == 0) return &child;
    }
    return nullptr;
}

// ─── Raw chunk payload access ─────────────────────────────────────────────────

struct ChunkView {
    const uint8_t* data;
    uint32_t size;
    uint32_t pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }

    uint8_t readU8() {
        if (!canRead(1)) throw FormatParseError("ChunkView: unexpected end of data");
        return data[pos++];
    }
    uint16_t readU16LE() {
        if (!canRead(2)) throw FormatParseError("ChunkView: unexpected end of data");
        uint16_t v;
        std::memcpy(&v, data + pos, 2);
        pos += 2;
        return v;
    }
    int32_t readI32LE() {
        if (!canRead(4)) throw FormatParseError("ChunkView: unexpected end of data");
        int32_t v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
    uint32_t readU32LE() {
        if (!canRead(4)) throw FormatParseError("ChunkView: unexpected end of data");
        uint32_t v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
    float readF32() {
        if (!canRead(4)) throw FormatParseError("ChunkView: unexpected end of data");
        float v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
    std::string readString() {
        // Read NUL-terminated string
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
    void skip(uint32_t n) { if (!canRead(n)) throw FormatParseError("ChunkView: skip past end"); pos += n; }
};

// Get raw payload of a leaf chunk from the source buffer.
// The IFF chunk header is 8 bytes: tag(4) + length(4).
// Leaf payload starts at byteOffset + 8.
static ChunkView chunkPayload(const swg_core::iff::IffNode& leaf,
                               const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("chunkPayload called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize) {
        throw FormatParseError("chunkPayload: chunk extends beyond source buffer");
    }
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── VTXA interleave flags ────────────────────────────────────────────────────

static constexpr uint32_t VBF_POSITION   = (1u << 0);
static constexpr uint32_t VBF_TRANSFORMED= (1u << 1);
static constexpr uint32_t VBF_NORMAL     = (1u << 2);
static constexpr uint32_t VBF_COLOR0     = (1u << 3);
static constexpr uint32_t VBF_COLOR1     = (1u << 4);
static constexpr uint32_t VBF_POINTSIZE  = (1u << 5);
static constexpr uint32_t VBF_TC_COUNT_SHIFT = 8;
static constexpr uint32_t VBF_TC_COUNT_MASK  = 0xFu;
static constexpr uint32_t VBF_TC_DIM_BASE_SHIFT  = 12;
static constexpr uint32_t VBF_TC_DIM_PER_SHIFT   = 2;
static constexpr uint32_t VBF_TC_DIM_MASK         = 0x3u;

// ─── Parse one LSPT primitive and add its geometry to geomBuf ─────────────────

static void parseLspt(
    const swg_core::iff::IffNode& lsptForm, // the FORM 0000 or FORM 0001 node
    const uint8_t* srcData, uint32_t srcSize,
    const std::string& shaderName,
    std::vector<uint8_t>& geomBuf,
    std::vector<MeshShaderGroupResult>& groups)
{
    // INFO chunk: int32 primitiveType + bool8 hasIndices + bool8 hasSortedIndices
    const auto* infoNode = findChildLeaf(lsptForm, "INFO");
    if (!infoNode) throw FormatParseError("LSPT: missing INFO chunk");
    auto infoCv = chunkPayload(*infoNode, srcData, srcSize);
    int32_t primType = infoCv.readI32LE();
    bool hasIndices    = (infoCv.readU8() != 0);
    bool hasSortedIdx  = (infoCv.readU8() != 0);
    (void)primType;
    (void)hasSortedIdx;

    // Determine LSPT version from the subType of lsptForm
    bool isLspt0001 = (strncmp(lsptForm.subType, "0001", 4) == 0);

    // Find FORM VTXA inside this primitive form
    const swg_core::iff::IffNode* vtxaFormNode = nullptr;
    for (const auto& child : lsptForm.children) {
        if (child.isForm && strncmp(child.subType, "VTXA", 4) == 0) {
            vtxaFormNode = &child;
            break;
        }
    }
    if (!vtxaFormNode) {
        // Tolerate LSPT with no VTXA (old format might not have it)
        return;
    }

    // VTXA: FORM VTXA → FORM 0003 → INFO + DATA
    const auto* vtxa0003 = findChildForm(*vtxaFormNode, "0003");
    if (!vtxa0003) throw FormatParseError("VTXA: missing FORM 0003");

    const auto* vtxaInfo = findChildLeaf(*vtxa0003, "INFO");
    if (!vtxaInfo) throw FormatParseError("VTXA 0003: missing INFO chunk");
    auto vtxaInfoCv = chunkPayload(*vtxaInfo, srcData, srcSize);
    uint32_t flags = vtxaInfoCv.readU32LE();
    int32_t vertCount = vtxaInfoCv.readI32LE();
    if (vertCount <= 0 || vertCount > 512 * 1024) {
        throw FormatParseError("VTXA: vertex count out of range");
    }

    const auto* vtxaData = findChildLeaf(*vtxa0003, "DATA");
    if (!vtxaData) throw FormatParseError("VTXA 0003: missing DATA chunk");
    auto vtxaDataCv = chunkPayload(*vtxaData, srcData, srcSize);
    const uint8_t* rawVtxaBytes = vtxaDataCv.ptr();
    uint32_t rawVtxaLen = vtxaDataCv.remaining();

    // Parse indices from INDX chunk
    std::vector<int32_t> indices;
    if (hasIndices) {
        const auto* indxNode = findChildLeaf(lsptForm, "INDX");
        if (indxNode) {
            auto indxCv = chunkPayload(*indxNode, srcData, srcSize);
            int32_t indexCount = indxCv.readI32LE();
            if (indexCount < 0 || indexCount > 4 * 1024 * 1024) {
                throw FormatParseError("INDX: index count out of range");
            }
            indices.reserve(static_cast<size_t>(indexCount));
            for (int32_t i = 0; i < indexCount; ++i) {
                if (isLspt0001) {
                    // uint16 indices
                    indices.push_back(static_cast<int32_t>(indxCv.readU16LE()));
                } else {
                    // int32 indices (LSPT 0000 and old format)
                    indices.push_back(indxCv.readI32LE());
                }
            }
        }
    }

    // De-index via deIndexStatic
    swg_core::geometry::DeIndexedBuffers deindexed = swg_core::geometry::deIndexStatic(
        rawVtxaBytes,
        static_cast<uint32_t>(vertCount),
        flags,
        indices.empty() ? nullptr : indices.data(),
        static_cast<uint32_t>(indices.size()));

    // Pack into geometry buffer and build MeshShaderGroupResult
    MeshShaderGroupResult grp;
    grp.shaderName  = shaderName;
    grp.vertexCount = static_cast<uint32_t>(deindexed.positions.size() / 3);
    grp.indexCount  = static_cast<uint32_t>(deindexed.indices.size());
    grp.hasDot3     = false;

    // Helper lambda: append float vector and record slice
    auto appendFloats = [&](const std::vector<float>& floats, uint32_t compCount, uint32_t elemCount) -> MeshAttributeSlice {
        MeshAttributeSlice slice;
        slice.offset         = static_cast<uint32_t>(geomBuf.size());
        slice.byteLength     = static_cast<uint32_t>(floats.size() * 4);
        slice.componentCount = compCount;
        slice.elementCount   = elemCount;
        if (!floats.empty()) {
            const uint8_t* asBytes = reinterpret_cast<const uint8_t*>(floats.data());
            geomBuf.insert(geomBuf.end(), asBytes, asBytes + floats.size() * 4);
        }
        return slice;
    };
    auto appendUint32 = [&](const std::vector<uint32_t>& data, uint32_t compCount, uint32_t elemCount) -> MeshAttributeSlice {
        MeshAttributeSlice slice;
        slice.offset         = static_cast<uint32_t>(geomBuf.size());
        slice.byteLength     = static_cast<uint32_t>(data.size() * 4);
        slice.componentCount = compCount;
        slice.elementCount   = elemCount;
        if (!data.empty()) {
            const uint8_t* asBytes = reinterpret_cast<const uint8_t*>(data.data());
            geomBuf.insert(geomBuf.end(), asBytes, asBytes + data.size() * 4);
        }
        return slice;
    };

    grp.positions = appendFloats(deindexed.positions, 3, grp.vertexCount);
    grp.normals   = appendFloats(deindexed.normals, 3, grp.vertexCount);
    if (!deindexed.uvs.empty()) {
        int tcCount = static_cast<int>((flags >> VBF_TC_COUNT_SHIFT) & VBF_TC_COUNT_MASK);
        int tcDim0 = 2;
        if (tcCount > 0) {
            tcDim0 = static_cast<int>(((flags >> (VBF_TC_DIM_BASE_SHIFT + 0)) & VBF_TC_DIM_MASK)) + 1;
        }
        MeshAttributeSlice uvSlice;
        uvSlice.offset         = static_cast<uint32_t>(geomBuf.size());
        uvSlice.byteLength     = static_cast<uint32_t>(deindexed.uvs.size() * 4);
        uvSlice.componentCount = static_cast<uint32_t>(tcDim0);
        uvSlice.elementCount   = grp.vertexCount;
        const uint8_t* asBytes = reinterpret_cast<const uint8_t*>(deindexed.uvs.data());
        geomBuf.insert(geomBuf.end(), asBytes, asBytes + deindexed.uvs.size() * 4);
        grp.uvs = uvSlice;
    }
    grp.indices   = appendUint32(deindexed.indices, 1, grp.indexCount);

    // skinIndices/skinWeights are absent for static .msh
    grp.skinIndices = {};
    grp.skinWeights = {};

    groups.push_back(std::move(grp));
}

// ─── Parse per-shader group within SPS ────────────────────────────────────────

static void parseShaderGroup(
    const swg_core::iff::IffNode& shaderForm, // FORM (any subtype) per shader
    const uint8_t* srcData, uint32_t srcSize,
    std::vector<uint8_t>& geomBuf,
    std::vector<MeshShaderGroupResult>& groups)
{
    // Read shader name from NAME chunk
    const auto* nameNode = findChildLeaf(shaderForm, "NAME");
    if (!nameNode) throw FormatParseError("Shader group: missing NAME chunk");
    auto nameCv = chunkPayload(*nameNode, srcData, srcSize);
    std::string shaderName = nameCv.readString();

    // Read primitive count from INFO chunk
    const auto* infoNode = findChildLeaf(shaderForm, "INFO");
    if (!infoNode) throw FormatParseError("Shader group: missing INFO chunk");
    auto infoCv = chunkPayload(*infoNode, srcData, srcSize);
    int32_t primitiveCount = infoCv.readI32LE();
    if (primitiveCount < 0 || primitiveCount > 1024) {
        throw FormatParseError("Shader group: primitive count out of range");
    }

    // Collect FORM children that are LSPT primitives (FORM 0000 or FORM 0001)
    int primIdx = 0;
    for (const auto& child : shaderForm.children) {
        if (!child.isForm) continue;
        if (strncmp(child.subType, "NAME", 4) == 0) continue; // skip shader sub-forms
        if (strncmp(child.subType, "INFO", 4) == 0) continue;
        // LSPT forms are FORM 0000 or FORM 0001
        if (strncmp(child.subType, "0000", 4) == 0 || strncmp(child.subType, "0001", 4) == 0) {
            if (primIdx < primitiveCount) {
                parseLspt(child, srcData, srcSize, shaderName, geomBuf, groups);
            }
            ++primIdx;
        }
    }
}

// ─── Parse SPS form ───────────────────────────────────────────────────────────

static void parseSps(const swg_core::iff::IffNode& spsForm,
                     const uint8_t* srcData, uint32_t srcSize,
                     std::vector<uint8_t>& geomBuf,
                     std::vector<MeshShaderGroupResult>& groups)
{
    // SPS → FORM 0000 or FORM 0001
    const swg_core::iff::IffNode* inner = nullptr;
    for (const auto& child : spsForm.children) {
        if (child.isForm &&
            (strncmp(child.subType, "0000", 4) == 0 ||
             strncmp(child.subType, "0001", 4) == 0)) {
            inner = &child;
            break;
        }
    }
    if (!inner) throw FormatParseError("SPS: missing inner FORM 0000 or 0001");

    // CNT chunk: int32 shader count
    const auto* cntNode = findChildLeaf(*inner, "CNT ");
    if (!cntNode) {
        // Some files use "CNT" (3 chars, right-padded)
        cntNode = findChildLeaf(*inner, "CNT\x00");
    }
    // Also try "CNT " padded
    if (!cntNode) {
        for (const auto& child : inner->children) {
            if (!child.isForm && strncmp(child.tag, "CNT", 3) == 0) {
                cntNode = &child;
                break;
            }
        }
    }
    if (!cntNode) throw FormatParseError("SPS 000x: missing CNT chunk");

    auto cntCv = chunkPayload(*cntNode, srcData, srcSize);
    int32_t shaderCount = cntCv.readI32LE();
    if (shaderCount < 0 || shaderCount > 512) {
        throw FormatParseError("SPS: shader count exceeds safety cap (512)");
    }

    // Collect shader FORMs (any subtype that isn't CNT or version)
    int shaderIdx = 0;
    for (const auto& child : inner->children) {
        if (!child.isForm) continue; // CNT is a leaf
        // This is a shader group form (any subtype — the shader form's subType is arbitrary)
        if (shaderIdx < shaderCount) {
            parseShaderGroup(child, srcData, srcSize, geomBuf, groups);
        }
        ++shaderIdx;
    }
}

// ─── parseMesh (public) ───────────────────────────────────────────────────────

MeshResult parseMesh(const swg_core::iff::IffNode& root,
                     const uint8_t* srcData, uint32_t srcSize)
{
    MeshResult result;

    // root must be FORM MESH
    if (!root.isForm || strncmp(root.subType, "MESH", 4) != 0) {
        throw FormatParseError("parseMesh: root is not FORM MESH");
    }
    result.formatTag = "MESH";

    // Find inner version FORM (0002..0005)
    const swg_core::iff::IffNode* versionForm = nullptr;
    for (const auto& child : root.children) {
        if (child.isForm) { versionForm = &child; break; }
    }
    if (!versionForm) throw FormatParseError("FORM MESH: no version FORM child");

    std::string ver(versionForm->subType, 4);
    result.version = ver;

    // Supported versions: 0002..0005. v0005 has APPR then SPS; older jump straight to SPS.
    // Find FORM SPS anywhere under versionForm
    const swg_core::iff::IffNode* spsForm = nullptr;
    for (const auto& child : versionForm->children) {
        if (child.isForm && strncmp(child.subType, "SPS", 3) == 0 &&
            (child.subType[3] == ' ' || child.subType[3] == '\0')) {
            spsForm = &child;
            break;
        }
        // SPS tag is exactly "SPS " (3 + space)
        if (child.isForm && strncmp(child.subType, "SPS ", 4) == 0) {
            spsForm = &child;
            break;
        }
    }
    // Also check if versionForm itself is indirected through APPR
    if (!spsForm) {
        // Try skipping APPR (appearance extent)
        for (const auto& child : versionForm->children) {
            if (child.isForm) {
                // Check if SPS is inside this child
                for (const auto& grandchild : child.children) {
                    if (grandchild.isForm && strncmp(grandchild.subType, "SPS ", 4) == 0) {
                        spsForm = &grandchild;
                        break;
                    }
                }
                if (spsForm) break;
            }
        }
    }

    if (!spsForm) throw FormatParseError("FORM MESH: cannot find FORM SPS");

    parseSps(*spsForm, srcData, srcSize, result.geometry, result.shaderGroups);

    return result;
}

} // namespace formats
} // namespace swg_core
