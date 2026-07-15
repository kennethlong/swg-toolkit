/**
 * modules/core/formats/StringTable.h — Engine-free C++20 `.stf` localized-string-table parser
 * + serializer.
 *
 * PORT SOURCE:
 *   swg-client-v2 LocalizedStringTable.cpp:72,77,227-308,368-405 (magic/version constants,
 *     load_0001, openLoadFile — header + string-section read order)
 *   swg-client-v2 LocalizedString.cpp:20-95,178-329 (per-string id/sourceCrc/buflen/text load;
 *     crc_type/id_type sizes from LocalizedString.h:41-42; generateCrc table+algorithm)
 *   swg-client-v2 LocalizedStringTableReaderWriter.cpp:107-203 (str_write/write — the write-side
 *     serializer oracle, BOTH sections)
 *
 * KEY GROUND-TRUTH FACTS (verified against source — see 05-05-PLAN.md Interfaces, D-10/D-11):
 *   `.stf` is a PARSER-NATIVE format (not IFF, no FORM/CHUNK tree). Binary layout (little-endian):
 *     Offset 0:  4   magic            uint32 (long), value 0xABCD -- NOT ASCII "STF "
 *                                     (LocalizedStringTable.h:49-50, ms_MAGIC = 0xabcd;
 *                                      `magic_type` = `long`, 4 bytes)
 *     Offset 4:  1   version          uint8 (char), value 1 (FILE_VERSION,
 *                                     LocalizedStringTable.cpp:72)
 *     Offset 5:  4   next_unique_id   uint32 (id_type = unsigned long, 4 bytes)
 *     Offset 9:  4   num_entries      uint32 (id_type)
 *         -- STRING SECTION (num_entries times), in the ON-DISK order (ascending id for a
 *            client-written file, since m_map is a std::map<id_type, LocalizedString*> —
 *            LocalizedStringTable.h:45) --
 *         4   id          uint32 (id_type)
 *         4   sourceCrc   uint32 (crc_type = unsigned long) -- CRC of the SOURCE-language text,
 *                         NOT a self-hash of this entry's own text (LocalizedString.cpp:244,
 *                         LocalizedStringTableReaderWriter.cpp:112 — `crcSource`/`m_sourceCrc`)
 *         4   buflen      uint32 (id_type) -- length in UTF-16 CODE UNITS (char16_t), NOT bytes
 *                         (LocalizedString.cpp:205/259: `readlen = buflen * sizeof(unicode_char_t)`)
 *         buflen*2   text UTF-16LE (Unicode::unicode_char_t = char16_t, Unicode.h:26), no NUL
 *                    terminator on disk (buflen does not include one — LocalizedString.cpp:196/250)
 *         -- NAME-MAP SECTION (num_entries times), in the ON-DISK order (ascending name for a
 *            client-written file, since m_nameMap is a std::map<std::string, id_type> —
 *            LocalizedStringTable.h:46) --
 *         4   id          uint32 (id_type) -- which string this name refers to
 *         4   buflen      uint32 (id_type) -- length in ASCII BYTES (not code units — names are
 *                         plain std::string, LocalizedStringTableReaderWriter.cpp:174)
 *         buflen     name ASCII bytes, no NUL terminator on disk
 *
 *   This parser/serializer PRESERVES the on-disk order of both sections verbatim rather than
 *   re-sorting by id/name — a zero-edit round-trip is then trivially byte-identical even if a
 *   pathological input file were NOT already sorted (the client always writes std::map-ordered
 *   output, so a real `.stf` IS ascending in both sections, but this code does not assume that
 *   to parse correctly — order preservation, not a resort, is what makes round-trip identity
 *   hold). The editor / caller is responsible for keeping `byId` sorted ascending-by-id if it
 *   wants to keep matching a real client's own write convention after edits; serializeStf does
 *   NOT re-sort (mirrors the client's own map-ordered-container behavior — it never has to sort,
 *   because insertion into a std::map keeps it sorted for free).
 *
 * D-10 — sourceCrc is a translation-staleness marker (CRC of the SOURCE-language text a
 *   translation was generated from), never a self-hash of the row's own current text.
 *   serializeStf writes sourceCrc VERBATIM and never recomputes it. A separate, explicitly-named
 *   `recomputeSourceCrcFromText` helper exists for a future opt-in "mark re-synced to source" UI
 *   action (05-09) — it has exactly one intended call site, which is NOT inside serializeStf.
 *
 * CRC32 table/algorithm: LocalizedString.cpp's `generateCrc()` (LocalizedStringNamespace) uses
 *   the SAME forward CRC-32 table/polynomial (0x04C11DB7, init/final XOR 0xFFFFFFFF) already
 *   ported in packages/native-core/modules/core/tre/Crc.cpp (verified byte-identical crctable[]
 *   contents) — generalized here to run over an arbitrary byte buffer (the text's raw UTF-16LE
 *   bytes) rather than a NUL-terminated C string, since `generateCrc` takes an explicit
 *   `stringSize` rather than scanning for a terminator. Do not port a second CRC table.
 *
 * NOTE: This is a PARSER-NATIVE format (like Palette.h), not an IFF tree — it does NOT use the
 *   IffNode tree. Round-trip: parse raw bytes -> StfResult -> re-emit `.stf` bytes.
 *
 * Decision D-02: C++20, engine-free.
 */
#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <utility>
#include "Mesh.h"  // FormatParseError

namespace swg_core {
namespace formats {

// ─── StringTable result structs ────────────────────────────────────────────────

/** One localized string entry (string-section row). */
struct StfEntry {
    uint32_t      id = 0;
    uint32_t      sourceCrc = 0;   // CRC of the SOURCE-language text (D-10) — preserved verbatim
    std::u16string text;          // UTF-16 code units, no NUL terminator
};

/**
 * Full parsed `.stf` table. `byId` and `nameToId` are two INDEPENDENTLY-ordered sections
 * (D-11) — do not assume they visit entries in the same sequence. Both are populated in the
 * exact on-disk order (parse does not re-sort); a real client-written file has `byId` ascending
 * by id and `nameToId` ascending by name (std::map iteration order), but this struct does not
 * enforce that itself.
 */
struct StfResult {
    uint32_t nextUniqueId = 0;
    std::vector<StfEntry> byId;                                  // string section, on-disk order
    std::vector<std::pair<std::string, uint32_t>> nameToId;      // name-map section, on-disk order
};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a `.stf` localized-string-table file from raw bytes.
 *
 * Throws FormatParseError:
 *   - if the first 4 bytes are not exactly 0xABCD little-endian (not an ASCII "STF " check —
 *     the real magic is a 4-byte integer, D-11),
 *   - if the version byte is not 1,
 *   - if any length-prefixed field (num_entries, per-string buflen, per-name buflen) would read
 *     past the end of the buffer — bounds-checked BEFORE allocating/decoding, never trusted.
 *
 * Source: LocalizedStringTable.cpp:227-308 (load_0001), LocalizedString.cpp:233-279 (load_0001),
 *         LocalizedStringTable.cpp:368-405 (openLoadFile — magic/version read).
 */
StfResult parseStf(const uint8_t* data, uint32_t size);

/**
 * Serialize an StfResult back to canonical `.stf` bytes.
 *
 * Re-emits the string section in `byId`'s CURRENT order and the name-map section in
 * `nameToId`'s CURRENT order (does not re-sort either — the caller/editor keeps them ordered).
 * sourceCrc is written VERBATIM from each StfEntry — this function never computes a CRC.
 *
 * Source: LocalizedStringTableReaderWriter.cpp:107-141 (str_write), :145-203 (write),
 *         :309-322 (writeRW — magic/version header write).
 */
std::vector<uint8_t> serializeStf(const StfResult& table);

/**
 * Compute the source CRC-32 of a UTF-16 text buffer, using the SAME forward CRC-32
 * table/polynomial (0x04C11DB7) as packages/native-core/modules/core/tre/Crc.cpp — generalized
 * to run over the text's raw UTF-16LE bytes (2 * text.size() bytes) rather than a NUL-terminated
 * C string, matching LocalizedString.cpp's `generateCrc(unicodeString, stringSize)` call shape
 * (LocalizedString.cpp:323-329, buildCrc).
 *
 * D-10: this is NOT called by serializeStf's default save path — it exists solely for a future
 * explicit, opt-in "mark re-synced to source" UI action (05-09). An empty text returns nullCrc
 * (0xFFFFFFFF), matching LocalizedString.cpp:73 (`return LocalizedString::nullCrc;` when
 * stringSize == 0).
 */
uint32_t recomputeSourceCrcFromText(const std::u16string& text);

} // namespace formats
} // namespace swg_core
