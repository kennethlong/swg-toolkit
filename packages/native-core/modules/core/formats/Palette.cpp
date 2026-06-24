/**
 * modules/core/formats/Palette.cpp — Engine-free C++20 RIFF PAL parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 PaletteArgb.cpp:450-523 (load_paletteData_prpal read path)
 *   swg-client-v2 PaletteArgb.cpp:528-607 (writeToBuffer write path)
 *
 * BINARY LAYOUT (verified byte-by-byte against source):
 *   Offset 0:  'RIFF' (4 bytes)
 *   Offset 4:  uint32 LE riffLength = 16 + 4 * entryCount  (size from offset 8 to end)
 *   Offset 8:  'PAL ' (4 bytes)
 *   Offset 12: 'data' (4 bytes)
 *   Offset 16: uint32 LE paletteChunkLength = 4 + 4 * entryCount
 *   Offset 20: uint8  unknownByte (should be 0)
 *   Offset 21: uint8  versionOrComponentCount (usually 3; if 4 → alpha from file; else alpha=255)
 *   Offset 22: uint16 LE entryCount (number of entries, usually 256)
 *   Offset 24: R(u8),G(u8),B(u8),A(u8) per entry
 *
 * ALPHA RULE: if versionOrComponentCount != 4, alpha is forced to 255 for all entries.
 *   This matches PaletteArgb.cpp:518-521 ("if != 4, setA(255)").
 *   NOTE: The "!= 3 → skip data" check in the source is a WARNING, not a fatal error;
 *   we tolerate non-3 values but still apply the alpha rule (== 4 → read alpha; else → 255).
 *
 * Decision D-02: C++20, engine-free.
 */

#include "Palette.h"
#include <cstring>

namespace swg_core {
namespace formats {

// ─── parsePalette ─────────────────────────────────────────────────────────────

PaletteResult parsePalette(const uint8_t* data, uint32_t size)
{
    if (size < 24) throw FormatParseError("parsePalette: file too short (< 24 bytes)");

    // Validate RIFF header
    if (data[0] != 'R' || data[1] != 'I' || data[2] != 'F' || data[3] != 'F') {
        throw FormatParseError("parsePalette: missing RIFF magic");
    }

    uint32_t riffLength;
    std::memcpy(&riffLength, data + 4, 4); // LE

    // 'PAL '
    if (data[8] != 'P' || data[9] != 'A' || data[10] != 'L' || data[11] != ' ') {
        throw FormatParseError("parsePalette: missing PAL  form type");
    }
    // 'data'
    if (data[12] != 'd' || data[13] != 'a' || data[14] != 't' || data[15] != 'a') {
        throw FormatParseError("parsePalette: missing 'data' chunk");
    }

    uint32_t paletteChunkLength;
    std::memcpy(&paletteChunkLength, data + 16, 4); // LE

    uint8_t unknownByte = data[20];
    (void)unknownByte; // tolerate any value; source warns but doesn't abort

    uint8_t versionOrComponentCount = data[21];

    uint16_t entryCount;
    std::memcpy(&entryCount, data + 22, 2); // LE

    // Safety bounds
    if (entryCount > 256) {
        throw FormatParseError("parsePalette: entryCount exceeds 256");
    }

    uint32_t expectedPaletteChunkLength = 4 + static_cast<uint32_t>(entryCount) * 4;
    if (paletteChunkLength < expectedPaletteChunkLength) {
        // Data too short for reported entries — cap entry count to what's available
        uint32_t availableEntries = (paletteChunkLength > 4) ? (paletteChunkLength - 4) / 4 : 0;
        if (availableEntries < entryCount) entryCount = static_cast<uint16_t>(availableEntries);
    }

    if (size < 24 + static_cast<uint32_t>(entryCount) * 4) {
        throw FormatParseError("parsePalette: file too short for declared entries");
    }

    PaletteResult result;
    result.entryCount              = static_cast<uint32_t>(entryCount);
    result.versionOrComponentCount = static_cast<uint16_t>(versionOrComponentCount);
    result.entries.reserve(entryCount);

    bool hasAlpha = (versionOrComponentCount == 4);

    uint32_t offset = 24;
    for (uint32_t i = 0; i < entryCount; ++i) {
        PaletteEntry entry;
        entry.r = data[offset + 0];
        entry.g = data[offset + 1];
        entry.b = data[offset + 2];
        entry.a = data[offset + 3];
        if (!hasAlpha) entry.a = 255;  // Source: PaletteArgb.cpp:518-521
        offset += 4;
        result.entries.push_back(entry);
    }

    return result;
}

// ─── serializePalette ─────────────────────────────────────────────────────────

std::vector<uint8_t> serializePalette(const PaletteResult& palette)
{
    // Source: PaletteArgb.cpp:528-607 (writeToBuffer)
    uint32_t entryCount = palette.entryCount;
    uint32_t paletteChunkLength = 4 + 4 * entryCount;
    uint32_t riffChunkLength    = 16 + 4 * entryCount;
    uint32_t totalSize          = 24 + 4 * entryCount;

    std::vector<uint8_t> out;
    out.resize(totalSize);
    uint8_t* buf = out.data();

    // RIFF
    buf[0] = 'R'; buf[1] = 'I'; buf[2] = 'F'; buf[3] = 'F';
    std::memcpy(buf + 4, &riffChunkLength, 4);  // LE
    buf[8] = 'P'; buf[9] = 'A'; buf[10] = 'L'; buf[11] = ' ';
    buf[12] = 'd'; buf[13] = 'a'; buf[14] = 't'; buf[15] = 'a';
    std::memcpy(buf + 16, &paletteChunkLength, 4);  // LE
    buf[20] = 0;  // unknown byte

    // versionOrComponentCount: use the original value from the parsed result.
    // On write the engine always writes 3 (see writeToBuffer:580), regardless of input.
    // We preserve the original value for round-trip fidelity.
    buf[21] = static_cast<uint8_t>(palette.versionOrComponentCount & 0xFF);

    uint16_t ec16 = static_cast<uint16_t>(entryCount);
    std::memcpy(buf + 22, &ec16, 2);  // LE

    uint32_t offset = 24;
    for (uint32_t i = 0; i < entryCount; ++i) {
        const auto& entry = palette.entries[i];
        out[offset + 0] = entry.r;
        out[offset + 1] = entry.g;
        out[offset + 2] = entry.b;
        out[offset + 3] = entry.a;
        offset += 4;
    }

    return out;
}

} // namespace formats
} // namespace swg_core
