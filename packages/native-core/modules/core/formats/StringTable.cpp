/**
 * modules/core/formats/StringTable.cpp — Engine-free C++20 `.stf` localized-string-table parser
 * + serializer.
 *
 * PORT SOURCE: see StringTable.h's header doc for full swg-client-v2 file:line citations.
 *
 * Decision D-02: C++20, engine-free (no N-API, no SOE engine headers).
 */

#include "StringTable.h"
#include <cstring>

namespace swg_core {
namespace formats {

// ─── Little-endian 32-bit helpers (raw memcpy on LE Windows — same convention as every other
//     native-core PARSER-NATIVE format's on-disk fields, e.g. Palette.cpp) ─────────────────────

static uint32_t readLE32(const uint8_t* data, uint32_t offset)
{
    uint32_t v;
    std::memcpy(&v, data + offset, 4);
    return v;
}

static void appendLE32(std::vector<uint8_t>& out, uint32_t v)
{
    out.push_back(static_cast<uint8_t>(v & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 24) & 0xFF));
}

// ─── parseStf ───────────────────────────────────────────────────────────────────

StfResult parseStf(const uint8_t* data, uint32_t size)
{
    // Header part 1: magic(4) + version(1) + next_unique_id(4) = 9 bytes, bounds-checked before
    // reading ANY of it (T-05-12).
    if (size < 9)
        throw FormatParseError("parseStf: file too short (< 9 bytes for magic+version+next_unique_id)");

    const uint32_t magic = readLE32(data, 0);
    if (magic != 0xABCDu)
        throw FormatParseError(
            "parseStf: bad magic (expected the 4-byte little-endian integer 0xABCD -- "
            "this is NOT an ASCII \"STF \" tag, D-11)");

    const uint8_t version = data[4];
    if (version != 1)
        throw FormatParseError("parseStf: unsupported version (expected 1, FILE_VERSION)");

    const uint32_t nextUniqueId = readLE32(data, 5);

    // Header part 2: num_entries (4 more bytes at offset 9) — separately bounds-checked.
    if (size < 13)
        throw FormatParseError("parseStf: file too short (< 13 bytes for num_entries)");
    const uint32_t numEntries = readLE32(data, 9);

    StfResult result;
    result.nextUniqueId = nextUniqueId;
    result.byId.reserve(numEntries);
    result.nameToId.reserve(numEntries);

    uint32_t offset = 13;

    // ── STRING SECTION: num_entries * (id, sourceCrc, buflen, buflen*2 bytes UTF-16LE text) ──
    // Ascending-id order for a real client-written file (m_map is a std::map<id_type, *>,
    // LocalizedStringTable.h:45) — this loop preserves whatever order is actually on disk rather
    // than assuming/enforcing it.
    for (uint32_t i = 0; i < numEntries; ++i) {
        if (static_cast<uint64_t>(offset) + 12ull > size)
            throw FormatParseError("parseStf: string-section entry header truncated (id/sourceCrc/buflen)");

        const uint32_t id = readLE32(data, offset);         offset += 4;
        const uint32_t sourceCrc = readLE32(data, offset);  offset += 4;
        const uint32_t buflen = readLE32(data, offset);     offset += 4;

        // Bounds-check buflen*2 (UTF-16 code units -> bytes) against the remaining buffer BEFORE
        // allocating/decoding the text (T-05-12 — never trust a length field to be in-bounds).
        const uint64_t textBytes = static_cast<uint64_t>(buflen) * 2ull;
        if (static_cast<uint64_t>(offset) + textBytes > size)
            throw FormatParseError(
                "parseStf: string-section text out of bounds (buflen*2 exceeds remaining buffer)");

        StfEntry entry;
        entry.id = id;
        entry.sourceCrc = sourceCrc;
        entry.text.resize(buflen);
        if (buflen != 0) {
            // Direct memcpy: on-disk is UTF-16LE, host is little-endian (Windows) — no byte-swap
            // needed, same assumption every other native-core format's LE fields already make.
            std::memcpy(entry.text.data(), data + offset, textBytes);
        }
        offset += static_cast<uint32_t>(textBytes);

        result.byId.push_back(std::move(entry));
    }

    // ── NAME-MAP SECTION: num_entries * (id, buflen, buflen ASCII bytes) ──
    // Ascending-name order for a real client-written file (m_nameMap is a
    // std::map<std::string, id_type>, LocalizedStringTable.h:46) — again, order-preserving, not
    // order-enforcing.
    for (uint32_t i = 0; i < numEntries; ++i) {
        if (static_cast<uint64_t>(offset) + 8ull > size)
            throw FormatParseError("parseStf: name-map entry header truncated (id/buflen)");

        const uint32_t id = readLE32(data, offset);      offset += 4;
        const uint32_t buflen = readLE32(data, offset);  offset += 4;

        // Bounds-check the ASCII name buflen BEFORE allocating/reading (T-05-12).
        if (static_cast<uint64_t>(offset) + buflen > size)
            throw FormatParseError(
                "parseStf: name-map text out of bounds (buflen exceeds remaining buffer)");

        std::string name(reinterpret_cast<const char*>(data + offset), buflen);
        offset += buflen;

        result.nameToId.emplace_back(std::move(name), id);
    }

    return result;
}

// ─── serializeStf ───────────────────────────────────────────────────────────────

std::vector<uint8_t> serializeStf(const StfResult& table)
{
    std::vector<uint8_t> out;
    const uint32_t numEntries = static_cast<uint32_t>(table.byId.size());

    // Header: magic(4, 0xABCD -> bytes CD AB 00 00) + version(1) + next_unique_id(4) + num_entries(4)
    appendLE32(out, 0xABCDu);
    out.push_back(1); // version (FILE_VERSION)
    appendLE32(out, table.nextUniqueId);
    appendLE32(out, numEntries);

    // String section: re-emitted in byId's CURRENT order (caller/editor is responsible for
    // keeping this ascending-by-id after edits — this function does not re-sort, mirroring the
    // client's own std::map-ordered-container behavior, StringTable.h header doc).
    for (const auto& entry : table.byId) {
        appendLE32(out, entry.id);
        appendLE32(out, entry.sourceCrc); // VERBATIM — never recomputed from text (D-10)
        appendLE32(out, static_cast<uint32_t>(entry.text.size()));
        if (!entry.text.empty()) {
            const uint8_t* textBytes = reinterpret_cast<const uint8_t*>(entry.text.data());
            out.insert(out.end(), textBytes, textBytes + entry.text.size() * 2);
        }
    }

    // Name-map section: re-emitted in nameToId's CURRENT order.
    for (const auto& nameIdPair : table.nameToId) {
        const std::string& name = nameIdPair.first;
        const uint32_t id = nameIdPair.second;
        appendLE32(out, id);
        appendLE32(out, static_cast<uint32_t>(name.size()));
        out.insert(out.end(), name.begin(), name.end());
    }

    return out;
}

// ─── recomputeSourceCrcFromText ─────────────────────────────────────────────────

namespace {

// Forward CRC-32 (polynomial 0x04C11DB7, init/final XOR 0xFFFFFFFF) — the SAME table/algorithm
// already verified in packages/native-core/modules/core/tre/Crc.cpp (byte-identical crctable[]
// contents to LocalizedString.cpp's own generateCrc() table). A fresh static table instance in
// THIS translation unit mirrors Crc.cpp's own documented "each TU gets its own crcTable
// instance; that is acceptable and avoids an ODR issue" convention — this is not a second,
// independently-derived CRC implementation, it is the identical generation formula.
uint32_t s_crcTable[256];
bool     s_crcTableInitialized = false;

void initCrcTable()
{
    if (s_crcTableInitialized) return;
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t c = i << 24;
        for (int j = 0; j < 8; ++j)
            c = (c & 0x80000000u) ? ((c << 1) ^ 0x04C11DB7u) : (c << 1);
        s_crcTable[i] = c;
    }
    s_crcTableInitialized = true;
}

} // namespace

uint32_t recomputeSourceCrcFromText(const std::u16string& text)
{
    // Empty string -> nullCrc, matching LocalizedString.cpp:73
    // ("if (stringSize) {...} return LocalizedString::nullCrc;" where nullCrc == s_initsCrc ==
    // 0xFFFFFFFF, LocalizedString.cpp:81).
    if (text.empty()) return 0xFFFFFFFFu;

    initCrcTable();

    const uint8_t* data = reinterpret_cast<const uint8_t*>(text.data());
    const size_t byteLen = text.size() * 2; // UTF-16 code units -> bytes

    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < byteLen; ++i)
        crc = s_crcTable[((crc >> 24) ^ data[i]) & 0xFF] ^ (crc << 8);
    return crc ^ 0xFFFFFFFFu;
}

} // namespace formats
} // namespace swg_core
