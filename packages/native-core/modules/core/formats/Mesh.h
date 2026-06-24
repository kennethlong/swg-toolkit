/**
 * modules/core/formats/Mesh.h — Engine-free C++20 FORM MESH static mesh parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 MeshAppearanceTemplate.cpp:248-405 (FORM MESH → version dispatch → ShaderPrimitiveSetTemplate)
 *   swg-client-v2 ShaderPrimitiveSetTemplate.cpp:1459-1483 (load_sps: FORM SPS → CNT + per-shader FORM)
 *   swg-client-v2 VertexBuffer.cpp:241-309 (VTXA interleave order and flag bits)
 *   swg-client-v2 StaticShaderTemplate.cpp:32 (ShaderTemplateList::fetch reads the shader name string)
 *
 * KEY GROUND-TRUTH FACTS (verified against source, do NOT re-derive):
 *   FORM MESH → FORM 000{2,3,4,5}
 *     v0005: FORM 0005 → [APPR appearance extent] → IFF delegate to ShaderPrimitiveSetTemplate
 *   ShaderPrimitiveSetTemplate: FORM SPS → FORM 0001 or FORM 0000
 *     FORM SPS → FORM 0001 has:
 *       CNT chunk (int32 shader count)
 *       Per shader: FORM (shader name embedded via ShaderTemplateList::fetch)
 *         INFO chunk (int32 primitive count)
 *         Per primitive: FORM LSPT (the actual geometry)
 *   FORM LSPT: INFO(type, indexed, sorted) + FORM VTXA + [INDX] + [SIDX]
 *   VTXA v0003: FORM 0003 → INFO(flags, vertCount) + DATA(interleaved bytes)
 *   INDX v0001: int32 count + uint16[] indices  (v0000: int32[] indices)
 *   Shader name: the SHT path string read by ShaderTemplateList::fetch via IFF
 *
 * Security caps: per-chunk <= 64 MB (from Iff.h:146-149); add count-bounds checks.
 * Decision D-02: C++20, engine-free.
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include "iff/Iff.h"
#include "../geometry/DeIndex.h"

namespace swg_core {
namespace formats {

// ─── Error ────────────────────────────────────────────────────────────────────

class FormatParseError : public std::runtime_error {
public:
    explicit FormatParseError(const std::string& msg) : std::runtime_error(msg) {}
};

// ─── Mesh result structs ──────────────────────────────────────────────────────

/**
 * Attribute slice descriptor into the single geometry ArrayBuffer.
 * Mirrors MeshAttributeSlice from contracts/src/mesh.ts.
 */
struct MeshAttributeSlice {
    uint32_t offset = 0;          // byte offset within geometry buffer
    uint32_t byteLength = 0;      // byte length of this attribute
    uint32_t componentCount = 0;  // scalar components per element
    uint32_t elementCount = 0;    // number of elements
};

/**
 * One PSDT shader group result from a parsed .msh mesh.
 * Each group maps to one Three.js BufferGeometry + Material.
 */
struct MeshShaderGroupResult {
    std::string       shaderName;          // .sht path
    uint32_t          vertexCount = 0;     // de-indexed vertex count
    uint32_t          indexCount  = 0;     // triangle index value count (triangles×3)
    MeshAttributeSlice positions;          // Float32 x,y,z
    MeshAttributeSlice normals;            // Float32 nx,ny,nz (byteLength=0 if absent)
    MeshAttributeSlice uvs;               // Float32 u,v (first UV set; byteLength=0 if absent)
    MeshAttributeSlice indices;           // Uint32 indices
    MeshAttributeSlice skinIndices;       // Int32 vec4 (absent for static .msh)
    MeshAttributeSlice skinWeights;       // Float32 vec4 (absent for static .msh)
    bool hasDot3 = false;
};

/**
 * Full result of parsing a .msh (FORM MESH) file.
 * geometry: packed binary buffer containing all attribute data for all groups.
 */
struct MeshResult {
    std::string                          formatTag;    // 'MESH'
    std::string                          version;      // e.g. '0005'
    std::vector<MeshShaderGroupResult>   shaderGroups;
    std::vector<uint8_t>                 geometry;     // single packed buffer
    uint32_t                             weightsTruncated = 0;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM MESH static mesh from an already-parsed IFF tree.
 *
 * root: the top-level FORM MESH IffNode (roots[0] from parseIff).
 * srcData/srcSize: original bytes, needed for reading the raw chunk payloads.
 *
 * Returns MeshResult with per-group MeshAttributeSlice byte offsets into geometry.
 * Throws FormatParseError on malformed input.
 *
 * Security: count-bounds check on shaderGroupCount (cap at 512).
 *
 * Source: MeshAppearanceTemplate.cpp + ShaderPrimitiveSetTemplate.cpp + VertexBuffer.cpp.
 */
MeshResult parseMesh(const swg_core::iff::IffNode& root,
                     const uint8_t* srcData, uint32_t srcSize);

} // namespace formats
} // namespace swg_core
