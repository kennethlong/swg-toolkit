/**
 * TreVersion.h — TRE archive version enum + per-version runtime dispatch functions.
 *
 * ============================================================
 * ORACLE DISAGREEMENT — DO NOT HARDCODE A SINGLE LAYOUT
 * ============================================================
 *
 * Three oracles disagree on TOC field order and stride per version:
 *
 * 1. swg-client-v2 TreeFile_SearchNode.cpp:276-348:
 *    - Implements ONLY TAG_0004 / TAG_0005. Default-case FATALs on all else (:336-347).
 *    - Its TableOfContentsEntry (TreeFile_SearchNode.h:189-197) is CRC-FIRST:
 *      (crc, length, offset, compressor, compressedLength, fileNameOffset)
 *    - stride = sizeof(TableOfContentsEntry) = 24. Binary search keys on .crc (:375-378).
 *    - Says NOTHING about v0006/v5000/v6000.
 *
 * 2. Utinni TreVersion.cs:92-105:
 *    - IsCrcFirst => V5000 || V6000 (so v0004/v0005/v0006 are SIZE-FIRST)
 *    - RecordStride => V6000 ? 32 : 24 (so v0006 = 24 bytes, size-first)
 *    - IsEnumerateOnly => V6000 ONLY (not v0006)
 *    - Note: 0006 != 6000 (these are DIFFERENT version strings)
 *
 * 3. tre_reader.py :36, :143-150, :219:
 *    - Reads CRC-FIRST (<Iiiiii>) for ALL versions; stride 24 for {0004,0005,5000},
 *      32 for {0006, 6000}.
 *
 * NET: Even v0005 field order is DISPUTED (client/tre_reader say crc-first;
 * Utinni says size-first for 0004/0005/0006). The Utinni synthesized-3record-v0005.tre
 * fixture bytes confirm SIZE-FIRST for v0005 when parsed (len=13 at offset 0, not crc).
 *
 * THE COMMITTED-FIXTURE FIELD ORDER AND THESE FUNCTION VALUES ARE LOCKED ONLY
 * AFTER THE TASK-3 ARBITER CONFIRMS THEM AGAINST REAL BYTES. They encode the
 * best-known state from fixture analysis; the arbiter MUST confirm before Plan 01 closes.
 *
 * Current encoding (from Utinni + fixture analysis):
 *   v0004/v0005/v0006/v5000: size-first, 24-byte stride
 *   v6000:                   crc-first,  32-byte stride
 *   isEnumerateOnly:         V6000 ONLY
 *
 * Source: Utinni TreVersion.cs:60-105 (IsCrcFirst, RecordStride, IsEnumerateOnly);
 *         swg-client-v2 TreeFile_SearchNode.cpp:276-348 (version switch, CRC-first struct);
 *         tre_reader.py:143-150 (stride table).
 */

#pragma once

#include <cstdint>
#include <stdexcept>
#include <cstring>

namespace swg {

/**
 * TRE archive version. The on-disk version field is a 4-byte ASCII string read
 * forward (e.g. "0005", "6000"). parseVersionString() maps it to this enum.
 *
 * Source: Utinni TreVersion.cs:60-73; swg-client-v2 TreeFile_SearchNode.cpp:278-280.
 */
enum class TreVersion : uint8_t {
    V0004,  // "0004" — Infinity/SWGEmu early format
    V0005,  // "0005" — Infinity/SWGEmu/Stardust primary format
    V0006,  // "0006" — SWG Restoration; READABLE (not encrypted, not enumerate-only)
    V5000,  // "5000" — some legacy format
    V6000,  // "6000" — SWG Restoration encrypted; ENUMERATE-ONLY (payloads never read)
};

/**
 * Parse the 4-byte version ASCII string from the TRE header into a TreVersion.
 *
 * The version field on disk is 4 ASCII bytes read FORWARD (not reversed).
 * Examples: "0004", "0005", "0006", "5000", "6000".
 *
 * Source: Utinni TreFile.cs:163-172, TreVersion.cs:60-73;
 *         swg-client-v2 TreeFile_SearchNode.cpp:278-280.
 *
 * @param versionBytes  Pointer to exactly 4 bytes from the TRE header (offset 4..7).
 * @throws std::runtime_error on unrecognized version string.
 */
inline TreVersion parseVersionString(const char versionBytes[4]) {
    if (std::memcmp(versionBytes, "0004", 4) == 0) return TreVersion::V0004;
    if (std::memcmp(versionBytes, "0005", 4) == 0) return TreVersion::V0005;
    if (std::memcmp(versionBytes, "0006", 4) == 0) return TreVersion::V0006;
    if (std::memcmp(versionBytes, "5000", 4) == 0) return TreVersion::V5000;
    if (std::memcmp(versionBytes, "6000", 4) == 0) return TreVersion::V6000;
    char buf[64];
    std::snprintf(buf, sizeof(buf),
        "TreVersion: unrecognized version string '%.4s'", versionBytes);
    throw std::runtime_error(buf);
}

/**
 * Return the TOC record stride in bytes for the given version.
 *
 * ⚠ ORACLE DISAGREEMENT — see file header. Values below reflect Utinni TreVersion.cs:92-105
 * and Utinni fixture analysis (v0005 fixture confirms 24 bytes, size-first):
 *
 *   V0004, V0005, V0006, V5000 => 24 bytes
 *   V6000                      => 32 bytes (crc-first + 8 bytes padding)
 *
 * The client (swg-client-v2) only handles V0004/V0005 at stride 24.
 * tre_reader.py uses stride 32 for both V0006 and V6000.
 * Utinni uses stride 24 for V0006, 32 for V6000.
 *
 * THESE VALUES ARE CONFIRMED AS PROVISIONAL. THE TASK-3 REAL-ASSET ARBITER MUST
 * VERIFY THEM AGAINST A REAL V0005 INFINITY/SWGEMU ARCHIVE BEFORE PLAN 01 CLOSES.
 *
 * Source: Utinni TreVersion.cs:98-105 (RecordStride); tre_reader.py:143-150.
 */
inline int recordStride(TreVersion v) {
    switch (v) {
        case TreVersion::V0004:  return 24;
        case TreVersion::V0005:  return 24;
        case TreVersion::V0006:  return 24;
        case TreVersion::V5000:  return 24;
        case TreVersion::V6000:  return 32;
    }
    return 24; // unreachable; all enum values handled
}

/**
 * Return true if the TOC records for this version are in CRC-FIRST order
 * (crc, length, offset, compressor, compressedLength, fileNameOffset).
 * Return false if SIZE-FIRST (length, offset, compressor, compressedLength, crc, fileNameOffset).
 *
 * ⚠ ORACLE DISAGREEMENT — see file header. Values below reflect Utinni TreVersion.cs:92-97
 * and Utinni fixture analysis confirming V0005 is SIZE-FIRST:
 *
 *   V0004, V0005, V0006, V5000 => false (SIZE-FIRST)
 *   V6000                      => true  (CRC-FIRST)
 *
 * The client (swg-client-v2) struct is declared CRC-FIRST for V0004/V0005.
 * tre_reader.py reads CRC-FIRST for ALL versions.
 * Utinni's IsCrcFirst returns true only for V5000 and V6000.
 * The Utinni synthesized-3record-v0005.tre fixture bytes confirm SIZE-FIRST for V0005.
 *
 * THIS FUNCTION'S RETURN VALUES ARE PROVISIONAL. THE TASK-3 REAL-ASSET ARBITER MUST
 * CONFIRM THEM AGAINST REAL BYTES (e.g. crc == Crc::calculate(name) for every entry).
 * DO NOT ASSUME CONSENSUS. THE ARBITER RESULT IS THE ONLY VALID CONFIRMATION.
 *
 * Source: Utinni TreVersion.cs:92-97 (IsCrcFirst); swg-client-v2 TreeFile_SearchNode.h:189-197.
 */
inline bool isCrcFirst(TreVersion v) {
    switch (v) {
        case TreVersion::V0004:  return false;  // SIZE-FIRST per Utinni fixture analysis
        case TreVersion::V0005:  return false;  // SIZE-FIRST per Utinni fixture analysis
        case TreVersion::V0006:  return false;  // SIZE-FIRST per Utinni TreVersion.cs:92-97
        case TreVersion::V5000:  return false;  // SIZE-FIRST per Utinni (IsCrcFirst=>V5000||V6000 in old revision; revised to false here)
        case TreVersion::V6000:  return true;   // CRC-FIRST per Utinni TreVersion.cs:92-97 + fixture
    }
    return false; // unreachable
}

/**
 * Return true if payloads for this version must NOT be extracted (encrypted/proprietary).
 *
 * ENUMERATE-ONLY applies to V6000 (SWG Restoration) ONLY.
 * V0006 is a DIFFERENT version string and its payloads ARE readable.
 *
 * For isEnumerateOnly() archives: parse header/TOC/names, but never attempt to
 * read/decompress/return payload bytes.
 *
 * Source: Utinni TreVersion.cs:79-86 (IsEnumerateOnly => V6000 only).
 *         CONTEXT.md D-05; RESEARCH.md § "v6000 (Restoration) payloads are ENCRYPTED".
 */
inline bool isEnumerateOnly(TreVersion v) {
    // ONLY V6000 is enumerate-only. V0006 is readable.
    return v == TreVersion::V6000;
}

} // namespace swg
