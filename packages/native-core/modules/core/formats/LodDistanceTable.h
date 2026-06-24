/**
 * modules/core/formats/LodDistanceTable.h — Engine-free C++20 FORM LDTB parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 LodDistanceTable.cpp:140-175 (load_0000)
 *   swg-client-v2 LodDistanceTable.cpp:118-138 (write path — used to define serial format)
 *
 * KEY GROUND-TRUTH FACTS (verified against source):
 *   FORM LDTB
 *     FORM 0000
 *       INFO chunk:
 *         int16  levelCount                    (read_int16; may be negative → clamp to 0)
 *         per level:
 *           float32 minDistance               (on disk = actual distance, NOT squared)
 *           float32 maxDistance               (on disk = actual distance, NOT squared)
 *
 *   The engine squares these values at load time (level.m_minDistanceSquared = minDist*minDist).
 *   WE STORE AS-READ (NOT pre-squared) per the contracts/src/material.ts LodLevel spec.
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

// ─── LodDistanceTable result structs ──────────────────────────────────────────

struct LodLevel {
    float minDist;  // as-read from disk (NOT squared)
    float maxDist;  // as-read from disk (NOT squared)
};

struct LodDistanceTableResult {
    std::string            formatTag;    // 'LDTB'
    std::string            version;      // '0000'
    int16_t                levelCount;   // from INFO int16 (may be 0 if data issue)
    std::vector<LodLevel>  levels;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM LDTB LOD distance table from an already-parsed IFF tree.
 *
 * root: the top-level FORM LDTB IffNode.
 * srcData/srcSize: original bytes for reading raw chunk payloads.
 *
 * Returns LodDistanceTableResult with per-level distances (as-read, NOT squared).
 * Throws FormatParseError on malformed input.
 *
 * Source: LodDistanceTable.cpp:140-175.
 */
LodDistanceTableResult parseLodDistanceTable(const swg_core::iff::IffNode& root,
                                              const uint8_t* srcData, uint32_t srcSize);

} // namespace formats
} // namespace swg_core
