/**
 * modules/core/formats/StaticAppearance.h — Engine-free C++20 FORM APT static appearance parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 clientGame/appearance/AppearanceTemplateList.cpp
 *     :513-540 — APT load: enterForm(APT) → enterForm(0000) → enterChunk(NAME) → read_string(redirectedFileName)
 *     :530     — FATAL if redirectedFileName ends with ".apt" (no multi-level indirection)
 *
 * KEY GROUND-TRUTH FACTS (verified against oracle, do NOT re-derive):
 *   FORM APT → FORM 0000 → CHUNK NAME → NUL-terminated redirect target path
 *   The redirect target MUST NOT end with ".apt" (FormatParseError if it does).
 *   There is exactly ONE redirect target (not a list).
 *
 * Decision D-02: C++20, engine-free (no N-API, no SOE engine headers).
 */

#pragma once

#include <cstdint>
#include <string>
#include <stdexcept>
#include "iff/Iff.h"
#include "formats/Mesh.h"  // for FormatParseError

namespace swg_core {
namespace formats {

// ─── StaticAppearance result struct ──────────────────────────────────────────

/**
 * Full result of parsing a .apt (FORM APT) file.
 */
struct StaticAppearanceResult {
    std::string formatTag;       // 'APT'
    std::string redirectTarget;  // the single redirected appearance path (e.g. foo.msh or foo.sat)
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM APT static appearance redirector from an already-parsed IFF tree.
 *
 * root: the top-level FORM APT IffNode (roots[0] from parseIff).
 * srcData/srcSize: original bytes.
 *
 * Returns StaticAppearanceResult with the single redirect target.
 * Throws FormatParseError if redirectTarget ends with ".apt" (no multi-level indirection)
 * or on malformed input.
 *
 * Source: AppearanceTemplateList.cpp :513-540
 */
StaticAppearanceResult parseStaticAppearance(
    const swg_core::iff::IffNode& root,
    const uint8_t* srcData,
    uint32_t srcSize
);

} // namespace formats
} // namespace swg_core
