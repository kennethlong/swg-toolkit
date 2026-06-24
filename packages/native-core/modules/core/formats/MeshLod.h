/**
 * modules/core/formats/MeshLod.h — Engine-free C++20 FORM MLOD LOD-mesh parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 LodMeshGeneratorTemplate.cpp:210-254 (load_0000)
 *     FORM MLOD → FORM 0000
 *       INFO chunk: int16 levelCount
 *       per level: NAME chunk (char[] pathName, NUL-terminated)
 *
 * KEY GROUND-TRUTH FACTS (verified against source):
 *   - levelCount is int16 (NOT uint16 or int32 — the source reads read_int16())
 *   - Each level's path is the .msh asset path (e.g. "appearance/mesh/foo_l0.msh")
 *   - Distance thresholds are NOT stored in MLOD; they come from an LDTB (.lmg) file
 *   - MLOD does NOT pair distances with levels; LDTB does
 *
 * Decision D-02: C++20, engine-free.
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include "iff/Iff.h"
#include "Mesh.h"  // FormatParseError

namespace swg_core {
namespace formats {

// ─── MeshLod result struct ────────────────────────────────────────────────────

struct MeshLodLevel {
    std::string path;  // .msh path for this LOD level (e.g. "appearance/mesh/foo_l0.msh")
};

struct MeshLodResult {
    std::string               formatTag;   // 'MLOD'
    std::string               version;     // e.g. '0000'
    int16_t                   levelCount;  // number of LOD levels (from INFO int16)
    std::vector<MeshLodLevel> levels;      // one entry per LOD level
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM MLOD LOD-mesh descriptor from an already-parsed IFF tree.
 *
 * root: the top-level FORM MLOD IffNode.
 * srcData/srcSize: original bytes for reading raw chunk payloads.
 *
 * Returns MeshLodResult with the list of .msh paths for each LOD level.
 * Throws FormatParseError on malformed input.
 *
 * Source: LodMeshGeneratorTemplate.cpp:210-254.
 */
MeshLodResult parseMeshLod(const swg_core::iff::IffNode& root,
                            const uint8_t* srcData, uint32_t srcSize);

} // namespace formats
} // namespace swg_core
