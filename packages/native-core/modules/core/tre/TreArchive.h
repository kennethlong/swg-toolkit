/**
 * TreArchive.h — Engine-free TRE archive reader (header/TOC/name-block parse + resolve).
 *
 * Ported from:
 *   swg-client-v2 TreeFile_SearchNode.cpp:226-349 (SearchTree constructor: header+TOC+name parse)
 *   swg-client-v2 TreeFile_SearchNode.cpp:360-408 (localExists: binary-search resolve + tombstone)
 *   Utinni TreFile.cs:155-310 (version dispatch + field-order handling)
 *
 * Handles all TRE version variants: v0004, v0005, v0006, v5000, v6000.
 * For isEnumerateOnly() (v6000) archives: header/TOC/names are parsed but payload
 * extraction is refused (TreVersion::isEnumerateOnly guard).
 *
 * Security (see TreArchive.cpp for detail):
 *   T-01-01: division-form count cap before alloc
 *   T-01-02: subtraction-form offset bound before read
 *   T-01-03: zlib inflate bomb protection (via Zlib.cpp)
 */

#pragma once

#include "../io/IInputStream.h"
#include "TreVersion.h"
#include <cstdint>
#include <string>
#include <vector>

namespace swg {

/** One parsed TOC record (normalized to a canonical 6-field layout regardless of on-disk order). */
struct TreEntry {
    uint32_t crc;                ///< CRC of the normalized file name
    int32_t  length;             ///< Uncompressed size in bytes (0 = tombstone/deleted)
    int32_t  offset;             ///< Byte offset of the payload within the archive
    int32_t  compressor;         ///< Compressor code (0=none, 1=raw-deflate, 2=zlib-RFC1950)
    int32_t  compressedLength;   ///< Compressed size on disk (used when compressor != 0)
    int32_t  fileNameOffset;     ///< Byte offset into the name block
};

/**
 * TreArchive — immutable parsed TRE archive.
 *
 * parse() reads the 36-byte header, inflates the TOC block, inflates the name
 * block, and builds an entry vector sorted by (crc, name). resolve() does a
 * binary search and returns the entry index (or -1 if not found / tombstone).
 *
 * Usage:
 *   FileInputStream stream("path/to/archive.tre");
 *   TreArchive arc = TreArchive::parse(stream);
 *   int idx = arc.resolve("appearance/player_leia.apt");
 *   if (idx >= 0) {
 *     auto bytes = arc.extractEntry(idx, stream);
 *   }
 */
class TreArchive {
public:
    /**
     * Parse a TRE archive from the given stream.
     *
     * @param stream  Positioned at offset 0 (will read the entire header, TOC, and name block).
     * @returns       Populated TreArchive.
     * @throws        std::runtime_error on parse failure (bad magic, unknown version,
     *                security cap exceeded, inflate error, etc.).
     */
    static TreArchive parse(IInputStream& stream);

    /**
     * Resolve a normalized file path to a TOC entry index.
     *
     * The name is expected to be already normalized (lowercase, forward-slashes,
     * no leading ./ or ../). The lookup computes CRC = Crc::calculate(name) and
     * does a binary search keyed on CRC, tie-broken by case-insensitive name compare.
     *
     * @param normalizedName  Normalized file path (e.g. "appearance/player.apt").
     * @param deleted         Set to true if the entry exists but is a tombstone (length==0).
     * @returns               Entry index (0-based) on success; -1 if not found or deleted.
     */
    int resolve(const std::string& normalizedName, bool& deleted) const;

    /**
     * Extract the payload of an entry at the given index.
     *
     * Refuses to extract from isEnumerateOnly() archives (v6000).
     *
     * @param idx     Entry index from resolve().
     * @param stream  The same stream used during parse() (for positional payload reads).
     * @returns       Decompressed payload bytes.
     * @throws        std::runtime_error if enumerate-only, out-of-range, or inflate fails.
     */
    std::vector<uint8_t> extractEntry(int idx, IInputStream& stream) const;

    /**
     * Resolve a path including tombstone entries — returns the TOC entry index even
     * if length==0 (tombstone). Used by TreMount::resolveChain to identify the
     * tombstone archive entry index without a separate lookup.
     *
     * @param normalizedName  Already-normalized file name.
     * @returns               TOC entry index (including tombstones), or -1 if not found.
     */
    int resolveTombstoneIndex(const std::string& normalizedName) const;

    // Accessors
    TreVersion                 version()     const { return m_version; }
    int                        entryCount()  const { return static_cast<int>(m_entries.size()); }
    const std::vector<TreEntry>& entries()  const { return m_entries; }
    const std::string&         nameAt(int fileNameOffset) const;

private:
    TreArchive() = default;

    TreVersion              m_version = TreVersion::V0005;
    std::vector<TreEntry>   m_entries;
    std::string             m_nameBlock; ///< flat null-terminated name strings
};

} // namespace swg
