/**
 * modules/core/formats/Palette.h — Engine-free C++20 RIFF PAL parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 PaletteArgb.cpp:500-540 (load_paletteData_prpal)
 *
 * KEY GROUND-TRUTH FACTS (verified against source):
 *   RIFF PAL binary layout (little-endian):
 *     Bytes 0-3:  'RIFF' (0x52494646)
 *     Bytes 4-7:  uint32 fileSize (LE; size of rest of file)
 *     Bytes 8-11: 'PAL ' (0x50414C20)
 *     Bytes 12-15: 'data' (0x64617461)
 *     Bytes 16-19: uint32 dataChunkSize
 *     Bytes 20-21: uint16 version (always 0x0300 on disk? or 0x0003?)
 *     Bytes 22-23: uint16 entryCount (number of palette entries; typically 256)
 *     Bytes 24...: per-entry: R(uint8), G(uint8), B(uint8), A(uint8)
 *       If versionOrComponentCount != 4: alpha is forced to 255
 *       (The field name is ambiguous; the engine checks != 4)
 *   Total header size: 24 bytes
 *
 * NOTE: This is a PARSER-NATIVE format (not IFF). It does NOT use the IffNode tree.
 * Round-trip: parse raw bytes → PaletteResult → re-emit RIFF PAL bytes.
 *
 * Decision D-02: C++20, engine-free.
 */

#pragma once

#include <cstdint>
#include <vector>
#include <string>
#include <stdexcept>
#include "Mesh.h"  // FormatParseError

namespace swg_core {
namespace formats {

// ─── Palette result structs ───────────────────────────────────────────────────

struct PaletteEntry {
    uint8_t r = 0;
    uint8_t g = 0;
    uint8_t b = 0;
    uint8_t a = 255;  // forced to 255 when versionOrComponentCount != 4
};

struct PaletteResult {
    uint32_t                  entryCount;              // number of parsed entries
    uint16_t                  versionOrComponentCount; // raw field from header (usually 4 or 3)
    std::vector<PaletteEntry> entries;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a RIFF PAL palette file from raw bytes.
 *
 * Does NOT require an IFF tree — operates directly on the raw bytes.
 * Throws FormatParseError on malformed input.
 *
 * Source: PaletteArgb.cpp:500-540 (load_paletteData_prpal).
 */
PaletteResult parsePalette(const uint8_t* data, uint32_t size);

/**
 * Serialize a PaletteResult back to canonical RIFF PAL bytes.
 * Used for round-trip testing.
 */
std::vector<uint8_t> serializePalette(const PaletteResult& palette);

} // namespace formats
} // namespace swg_core
