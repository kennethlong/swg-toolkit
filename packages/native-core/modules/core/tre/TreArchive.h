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

/**
 * Externally-supplied entry descriptor for TreArchive::extractAt() (plan 04.3-10 Task 2).
 *
 * Used when a master .toc provides the offset/lengths for a payload that lives inside a
 * container whose internal TOC is empty (numberOfFiles=0, e.g. swg-source v6000 patch_sku3_*).
 *
 * F-5 (gate D-16): offset/length/compressedLength widened to uint32_t (engine uses uint32,
 *   TreeFile_SearchNode.h:294-298; signed narrowing mishandled high-bit >2 GB values).
 * F-4 (gate D-16): crc field added; threaded from the master-.toc entry; used in extractAt
 *   as an exact-length integrity guard after inflate (producedLength == desc.length check).
 *
 * Source: index.d.ts ExtractAtResult descriptor shape (frozen by plan 04.3-03).
 *         Plan 04.3-12 F-4/F-5 loop-back fix.
 */
struct TreExtractDescriptor {
    uint32_t offset;           ///< Byte offset of payload in the archive file (u32 — F-5)
    uint32_t length;           ///< Declared uncompressed size (u32 — F-5)
    uint32_t compressedLength; ///< Compressed byte count to read (u32 — F-5)
    uint32_t compressor;       ///< 0=none, 2=zlib RFC1950
    uint32_t crc;              ///< Forward CRC-32 of the virtual path (F-4 — post-inflate length gate)
};

/**
 * Per-payload extraction result for extractAt() (plan 04.3-10 Task 2, MOUNT-03/04).
 *
 * Mirrors the JS-facing ExtractAtResult in index.d.ts:
 *   { bytes?: ArrayBuffer } on success
 *   { encrypted?: true }   when inflate fails (Restoration v6000 encrypted payload)
 */
struct TreExtractResult {
    std::vector<uint8_t> bytes;              ///< Decompressed payload (empty when encrypted=true)
    bool                 encrypted = false;  ///< True when inflate failed (classify as encrypted)
};

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
     * T-01-05 REVISED (plan 04.3-10): v6000 is no longer blanket-refused.
     * Callers receive a real zlib error if the payload is encrypted (Restoration v6000).
     * For empty-internal-TOC (numberOfFiles=0) containers, use extractAt() instead.
     *
     * @param idx     Entry index from resolve().
     * @param stream  The same stream used during parse() (for positional payload reads).
     * @returns       Decompressed payload bytes.
     * @throws        std::runtime_error if out-of-range or inflate fails (incl. encrypted).
     */
    std::vector<uint8_t> extractEntry(int idx, IInputStream& stream) const;

    /**
     * Extract a payload using an EXTERNALLY-SUPPLIED descriptor (plan 04.3-10 Task 2).
     *
     * Static: does NOT need a parsed TreArchive — the caller supplies all field values.
     * Designed for master-.toc-sourced payloads in empty-internal-TOC (numberOfFiles=0)
     * v6000 containers where the internal m_entries vector is empty.
     *
     * Per-payload classify (MOUNT-04):
     *   - Attempt inflate with desc.compressor
     *   - On success → result.bytes populated, result.encrypted=false
     *   - On inflate failure → result.encrypted=true (Restoration-encrypted or unknown)
     *   Never crashes or fatals — encrypted payloads degrade gracefully.
     *
     * Security:
     *   T-01-02: bounds-check offset+compressedLength against stream length (subtraction form)
     *   T-01-03: zlib bomb cap (ZLIB_MAX_BLOCK = 256 MB) preserved via treInflate()
     *
     * @param desc    Externally-supplied descriptor (offset, length, compressedLength, compressor).
     * @param stream  Positional input stream open on the container archive file.
     * @returns       TreExtractResult: { bytes } on success, { encrypted=true } on inflate failure.
     * @throws        std::runtime_error on bounds violation or stream read error (not on inflate fail).
     *
     * Source: TreArchive::extractEntry (same bounds + bomb cap pattern, adapted for external desc);
     *         tre_decrypt.py::try_read_tre_payload (try-inflate-classify oracle).
     */
    static TreExtractResult extractAt(const TreExtractDescriptor& desc, IInputStream& stream);

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

    /**
     * Zero-copy name accessor — returns a raw pointer directly into the name block.
     * Caller must NOT hold this pointer beyond the lifetime of this TreArchive.
     * Prefer this over nameAt() in hot loops (no heap allocation).
     *
     * Source: perf fix — avoids the thread_local copy inside nameAt().
     */
    const char* namePtr(int fileNameOffset) const {
        return m_nameBlock.c_str() + fileNameOffset;
    }

    /**
     * Access the raw name block for bulk serialization.
     * Returned reference is valid for the lifetime of this TreArchive.
     */
    const std::string& nameBlock() const { return m_nameBlock; }

private:
    TreArchive() = default;

    TreVersion              m_version = TreVersion::V0005;
    std::vector<TreEntry>   m_entries;
    std::string             m_nameBlock; ///< flat null-terminated name strings
};

} // namespace swg
