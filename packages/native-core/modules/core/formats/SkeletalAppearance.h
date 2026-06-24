/**
 * modules/core/formats/SkeletalAppearance.h — Engine-free C++20 FORM SMAT skeletal appearance parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 clientSkeletalAnimation/appearance/SkeletalAppearanceTemplate.cpp
 *     load_0001 at :786-883 — INFO(counts + filename) + MSGN + SKTI
 *     load_0002 at :900-970 — same INFO structure (reads animationStateGraphTemplateName instead)
 *     load_0003 at :980-1136 — LATX (attachment transforms) chunk additional
 *
 * KEY GROUND-TRUTH FACTS (verified against oracle, do NOT re-derive):
 *   FORM SMAT → FORM 000{1,2,3}
 *   v0001 inner: INFO + MSGN + SKTI
 *     INFO: int32 meshGeneratorCount + int32 skeletonTemplateCount + char[] filename string
 *     MSGN: meshGeneratorCount × NUL-terminated path strings
 *     SKTI: skeletonTemplateCount × (char[] skeletonPath, char[] attachmentTransformName) pairs
 *   v0002: same as v0001 but INFO reads animationStateGraphTemplateName
 *   v0003: same as v0002 but with LATX chunk (attachment transforms, skip for MVP)
 *
 * Security: count cap 256 for meshGeneratorCount/skeletonTemplateCount.
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

// ─── SkeletalAppearance result struct ─────────────────────────────────────────

/**
 * One skeleton template reference in the SMAT.
 */
struct SktReference {
    std::string skeletonPath;
    std::string attachmentTransformName;
};

/**
 * Full result of parsing a .sat (FORM SMAT) file.
 */
struct SkeletalAppearanceResult {
    std::string                formatTag;        // 'SMAT'
    std::string                version;          // '0001', '0002', or '0003'
    std::vector<std::string>   meshPaths;        // from MSGN (mesh generator paths)
    std::vector<SktReference>  skeletonRefs;     // from SKTI (skeleton paths + attachment names)
    std::string                filename;         // from INFO (v0001: filename; v0002/v0003: animationStateGraphTemplateName)
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM SMAT skeletal appearance from an already-parsed IFF tree.
 *
 * root: the top-level FORM SMAT IffNode (roots[0] from parseIff).
 * srcData/srcSize: original bytes.
 *
 * Returns SkeletalAppearanceResult with mesh paths and skeleton references.
 * Throws FormatParseError on malformed input.
 *
 * Source: SkeletalAppearanceTemplate.cpp load_0001 :786-883, load_0002 :900-970, load_0003 :980+
 */
SkeletalAppearanceResult parseSkeletalAppearance(
    const swg_core::iff::IffNode& root,
    const uint8_t* srcData,
    uint32_t srcSize
);

} // namespace formats
} // namespace swg_core
