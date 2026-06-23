/**
 * TreVersion.h — TRE archive version enum + per-version runtime dispatch functions.
 *
 * ============================================================
 * TOC LAYOUT — CRC-FIRST FOR ALL VERSIONS (VERIFIED BYTE-EXACT)
 * ============================================================
 *
 * The on-disk TOC record is CRC-FIRST for every version:
 *   crc@0, length@4, offset@8, compressor@12, compressedLength@16, fileNameOffset@20
 *   (V6000 adds 8 bytes of padding → stride 32; all others stride 24).
 *
 * GROUND TRUTH:
 *   - swg-client-v2 .../sharedFile/src/shared/TreeFile_SearchNode.h:189
 *     (TableOfContentsEntry struct — crc-first, 24 bytes, binary search keys on .crc).
 *   - Proven byte-exact against real archives: bottom.tre (ver "5000", 808 records,
 *     stride 24) and SwgRestoration_00.tre (ver "6000", 334 records, stride 32).
 *
 * The previously-documented "size-first" layout (length@0 … crc@16) for
 * v0004/v0005/v0006/v5000 (sourced from Utinni / AI-distilled docs) is FALSIFIED:
 * it matches no real archive. Do NOT reinstate it.
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
 *   V0004, V0005, V0006, V5000 => 24 bytes (crc-first)
 *   V6000                      => 32 bytes (crc-first + 8 bytes padding)
 *
 * VERIFIED byte-exact: bottom.tre ("5000") stride 24; SwgRestoration_00.tre
 * ("6000") stride 32.
 *
 * Source: swg-client-v2 TreeFile_SearchNode.h:189 (sizeof(TableOfContentsEntry) = 24).
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
 *
 * ALL versions are CRC-FIRST. VERIFIED byte-exact against real archives:
 * crc@offset0 of bottom.tre ("5000") entry 0 == forward-CRC32 of its (lowercased,
 * slash-normalized) filename; SwgRestoration_00.tre ("6000") is likewise crc-first.
 * This matches the client's on-disk struct.
 *
 * The "size-first" layout (length@0 … crc@16) from Utinni / AI-distilled docs is
 * FALSIFIED — it matches no real archive. Do NOT reinstate it.
 *
 * Source: swg-client-v2 TreeFile_SearchNode.h:189 (TableOfContentsEntry, crc-first);
 *         Crc.cpp (forward CRC-32 over the lowercased name).
 */
inline bool isCrcFirst(TreVersion v) {
    (void)v;
    return true; // CRC-FIRST for ALL versions — verified byte-exact vs real archives
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
