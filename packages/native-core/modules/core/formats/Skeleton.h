/**
 * modules/core/formats/Skeleton.h — Engine-free C++20 FORM SKTM skeleton parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 clientSkeletalAnimation/appearance/BasicSkeletonTemplate.cpp
 *     load_0001 at :151-286  (has mandatory BPMJ chunk)
 *     load_0002 at :290-390  (no BPMJ chunk — this is the common modern version)
 *
 * KEY GROUND-TRUTH FACTS (verified against oracle, do NOT re-derive):
 *   FORM SKTM → FORM 0001 or FORM 0002
 *   v0001 inner: INFO + NAME + PRNT + RPRE + RPST + BPTR + BPRO + BPMJ (mandatory) + JROR
 *   v0002 inner: INFO + NAME + PRNT + RPRE + RPST + BPTR + BPRO + JROR  (no BPMJ)
 *   INFO: int32 jointCount
 *   NAME: jointCount × NUL-terminated bone name strings
 *   PRNT: jointCount × int32 parent index (-1 = root)
 *   RPRE: jointCount × 4 float32 pre-rotation quaternions (w,x,y,z)  → THREE.Quaternion(x,y,z,w)
 *   RPST: jointCount × 4 float32 post-rotation quaternions (w,x,y,z) → THREE.Quaternion(x,y,z,w)
 *   BPTR: jointCount × 3 float32 bone pre-translation vectors
 *   BPRO: jointCount × 3 float32 bone pre-rotation-offset vectors
 *   BPMJ: v0001 only: jointCount × 3 float32 major axis data (skip for rendering; consume not use)
 *   JROR: jointCount × (float32 rotation, int32 axis) joint rotation order records
 *
 *   WARNING on SLOD: some .skt files are FORM SLOD wrapping multiple FORM SKTM LODs.
 *   parseSkeleton only accepts FORM SKTM as root. Passing a FORM SLOD throws FormatParseError.
 *   Passing the inner SKTM leaf from SKMG also throws FormatParseError (delta #7).
 *
 * Decision D-02: C++20, engine-free (no N-API, no SOE engine headers).
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include "iff/Iff.h"
#include "formats/Mesh.h"  // for FormatParseError

namespace swg_core {
namespace formats {

// ─── Skeleton result struct ───────────────────────────────────────────────────

/**
 * One bone in the skeleton hierarchy.
 * Quaternion on-disk order: (w,x,y,z) → THREE.Quaternion(x,y,z,w).
 */
struct BoneInfo {
    std::string name;
    int32_t     parentIndex = -1;   // -1 = root
    float       preRot[4]     = {};  // RPRE preMultiply quaternion  (w,x,y,z)
    float       postRot[4]    = {};  // RPST postMultiply quaternion (w,x,y,z)
    float       bindPos[3]    = {};  // BPTR bind-pose translation   (x,y,z)
    float       bindPoseRot[4]= {};  // BPRO bind-pose ROTATION quaternion (w,x,y,z) — 4 floats, NOT 3
                                     // Ground truth: BasicSkeletonTemplate.cpp:271-276 (read_floatQuaternion).
};

/**
 * Full result of parsing a .skt (FORM SKTM) file.
 */
struct SkeletonResult {
    std::string           formatTag;  // 'SKTM'
    std::string           version;    // '0001' or '0002'
    std::vector<BoneInfo> bones;
    std::vector<std::string> boneNames; // same order as bones, for quick lookup
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM SKTM skeleton from an already-parsed IFF tree.
 *
 * root: the top-level FORM SKTM IffNode (roots[0] from parseIff).
 *       MUST be FORM SKTM (not FORM SLOD, not an inner SKTM leaf from SKMG).
 * srcData/srcSize: original bytes.
 *
 * Returns SkeletonResult with all bone info.
 * Throws FormatParseError on malformed input, wrong root tag, or FORM SLOD.
 *
 * Source: BasicSkeletonTemplate.cpp load_0001 :151-286, load_0002 :290-390
 */
SkeletonResult parseSkeleton(
    const swg_core::iff::IffNode& root,
    const uint8_t* srcData,
    uint32_t srcSize
);

} // namespace formats
} // namespace swg_core
