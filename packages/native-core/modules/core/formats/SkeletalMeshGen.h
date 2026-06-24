/**
 * modules/core/formats/SkeletalMeshGen.h — Engine-free C++20 FORM SKMG skeletal mesh parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 clientSkeletalAnimation/.../appearance/SkeletalMeshGeneratorTemplate.cpp
 *     load_0002 at :2247-2360 — INFO 9×int32+4×int16 (LOCKED, verified 2026-06-23)
 *     TWDT read at :2331-2343 — transformWeightDataCount pairs
 *   swg-client-v2 clientSkeletalAnimation/.../appearance/SkeletalMeshGeneratorTemplate.cpp
 *     load_0003 at :2540-2620 — same INFO layout (all versions share it)
 *
 * CROSS-CHECK:
 *   ../swg-blender-plugin/swg_scene/mesh_skeletal.py — SKMG chunk order cross-check
 *
 * KEY GROUND-TRUTH FACTS (verified against source, do NOT re-derive):
 *   FORM SKMG → FORM 000{2,3,4}
 *   INFO chunk: 9×int32 THEN 4×int16
 *     int32 order: maxTransformsPerVertex, maxTransformsPerShader, skeletonTemplateNameCount,
 *                  transformNameCount, positionCount, transformWeightDataCount, normalCount,
 *                  perShaderDataCount, blendTargetCount
 *     int16 order: occlusionZoneCount, occlusionZoneCombinationCount, zonesThisOccludesCount, occlusionLayer
 *   SKTM inner chunk (NOT parseSkeleton! — see delta #7): NUL-terminated skeleton template name strings
 *   XFNM: NUL-terminated transform/bone name table
 *   POSN: positionCount × 3 float32 (global pool)
 *   TWHD: positionCount × int32 (per-vertex influence count)
 *   TWDT: transformWeightDataCount × (int32 transformIndex, float32 weight) pairs
 *   [NORM]: normalCount × 3 float32 (if normalCount > 0)
 *   [DOT3]: v0004 only — global tangent pool
 *   PSDT* per-shader groups: NAME + PIDX + [NIDX] + [DOT3 idx v0004] + [TXCI+TCSF/TCSD] + PRIM→INFO+ITL
 *
 * Security: positionCount cap 1M, perShaderDataCount cap 512, transformWeightDataCount cap positionCount×16,
 *           xfnm name count cap 1024, path strings cap 512.
 *
 * Decision D-02: C++20, engine-free (no N-API, no SOE engine headers).
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include <optional>
#include "iff/Iff.h"
#include "formats/Mesh.h"  // for FormatParseError, MeshAttributeSlice, MeshShaderGroupResult, MeshResult
#include "geometry/DeIndex.h"

namespace swg_core {
namespace formats {

// ─── SkeletalMesh result struct ───────────────────────────────────────────────

/**
 * Full result of parsing a .mgn (FORM SKMG) file.
 * Extends MeshResult with skinning metadata.
 */
struct SkeletalMeshResult {
    std::string                        formatTag;      // 'SKMG'
    std::string                        version;        // '0002', '0003', '0004'
    std::vector<MeshShaderGroupResult> shaderGroups;   // all PSDT groups
    std::vector<uint8_t>               geometry;       // packed binary: pos+norm+uv+idx+skinIdx+skinWgt per group
    std::vector<std::string>           boneNames;      // XFNM transform/bone name table
    std::vector<std::string>           sktmNames;      // inner SKTM skeleton-template names
    uint32_t                           weightsTruncated = 0;
    bool                               needsBoneRemap = false; // true when boneOrder was empty (no skeleton provided)
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM SKMG skeletal mesh from an already-parsed IFF tree.
 *
 * root: the top-level FORM SKMG IffNode (roots[0] from parseIff).
 * srcData/srcSize: original bytes, needed for reading raw chunk payloads.
 * boneOrder: optional resolved skeleton bone names in skeleton order (for XFNM→bone remap).
 *            When empty/null, emits XFNM-local skin indices and sets needsBoneRemap=true.
 *
 * Returns SkeletalMeshResult with per-group geometry and skinning data.
 * Throws FormatParseError on malformed input.
 *
 * Security: count bounds (T-02-06); PIDX/NIDX OOB checks (T-02-07).
 *
 * Source: SkeletalMeshGeneratorTemplate.cpp load_0002 :2247-2360, load_0003 :2540+
 */
SkeletalMeshResult parseSkeletalMesh(
    const swg_core::iff::IffNode& root,
    const uint8_t* srcData,
    uint32_t srcSize,
    const std::vector<std::string>& boneOrder = {}
);

} // namespace formats
} // namespace swg_core
