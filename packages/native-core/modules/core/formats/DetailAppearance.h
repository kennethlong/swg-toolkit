/**
 * modules/core/formats/DetailAppearance.h — Engine-free C++20 FORM DTLA LOD appearance parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 DetailAppearanceTemplate.cpp:556-658 (load())
 *   swg-client-v2 DetailAppearanceTemplate.cpp:343-417 (loadEntries())
 *
 * KEY GROUND-TRUTH FACTS (verified 2026-06-24 against swg-client-v2 + real wb_02_09e_*.lod hexdump):
 *   - Root FORM tag is DTLA (NOT DTAL)
 *   - Version tag = ConvertTagToInt(versionTag): '0001'..'0008' → int 1..8
 *   - FORM APPR present when version >= 4 — skip it cleanly (AppearanceTemplate extents/hardpoints)
 *   - PIVT chunk present when version >= 6 — uint8 lodFlags (bit0=usePivotPoint, bit1(v8)=disableCrossFade)
 *   - INFO chunk: { int32 id, float32 near, float32 far } × N  (N = chunkLen / 12)
 *   - FORM DATA: contains one CHLD chunk per child: { int32 id, char* name NUL-terminated }
 *   - FORM RADR present when version >= 7 — skip (collision)
 *   - FORM TEST present when version >= 2 — skip (collision)
 *   - FORM WRIT present when version >= 2 — skip (collision)
 *   - Child path: name from CHLD is RELATIVE to appearance/; caller must prepend "appearance/"
 *     (client uses FileName(P_appearance, name), which prepends the appearance search path)
 *
 * Real file verified (wb_02_09e_00000000000000000000.lod, 362 bytes):
 *   version=7, 1 level: id=0, near=0, far=1000, childPath="mesh/wb_02_09e_00000000000000000000.msh"
 *   Full round-trip: parseIff → serializeIff produces byte-exact 362 bytes (CORE-05 gate).
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

// ─── DetailAppearance result structs ─────────────────────────────────────────

/**
 * One LOD level in a DTLA appearance.
 * Combines the INFO (id, near, far) with the DATA/CHLD (id, childPath).
 *
 * childPath is the raw name from the CHLD chunk (relative to the appearance/ tree).
 * Caller MUST prepend "appearance/" to get the full VFS path.
 *
 * Source: DetailAppearanceTemplate.cpp:343-417 (loadEntries → FileName(P_appearance, name)).
 */
struct DetailAppearanceLevel {
    int32_t     id;         // child id (shared between INFO and CHLD entries)
    float       near;       // nearDistance (raw float, NOT pre-squared)
    float       far;        // farDistance  (raw float, NOT pre-squared)
    std::string childPath;  // raw name from CHLD (e.g. "mesh/wb_02_09e_..._.msh")
                            // prepend "appearance/" for full VFS path
};

/**
 * Full result of parseDetailAppearance().
 * versionTag is the string version form (e.g. "0007").
 * lodFlags byte from PIVT (0 if version < 6).
 * levels is the joined INFO × CHLD list, sorted by farDistance descending (as the client sorts).
 */
struct DetailAppearanceResult {
    std::string                        formatTag;   // "DTLA"
    std::string                        versionTag;  // "0001".."0008"
    uint8_t                            lodFlags;    // 0 if version < 6
    std::vector<DetailAppearanceLevel> levels;      // joined INFO × CHLD, one per LOD level
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM DTLA LOD appearance descriptor from an already-parsed IFF tree.
 *
 * root: the top-level FORM DTLA IffNode.
 * srcData/srcSize: original bytes for reading raw chunk payloads.
 *
 * Returns DetailAppearanceResult with lodFlags and joined levels.
 * Throws FormatParseError on malformed input.
 *
 * Source: DetailAppearanceTemplate.cpp:556-658 (load()) and :343-417 (loadEntries()).
 */
DetailAppearanceResult parseDetailAppearance(const swg_core::iff::IffNode& root,
                                              const uint8_t* srcData, uint32_t srcSize);

} // namespace formats
} // namespace swg_core
