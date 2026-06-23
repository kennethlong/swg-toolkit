/**
 * TreArchive.cpp — Engine-free TRE archive reader implementation.
 *
 * Ported from:
 *   swg-client-v2 TreeFile_SearchNode.cpp:226-349  (SearchTree constructor — header+TOC+name parse)
 *   swg-client-v2 TreeFile_SearchNode.cpp:360-408  (localExists — binary-search + tombstone)
 *   swg-client-v2 TreeFile_SearchNode.h:174-185    (Header struct, 36 bytes)
 *   swg-client-v2 TreeFile_SearchNode.h:189-197    (TableOfContentsEntry, crc-first 24 bytes)
 *   Utinni TreFile.cs:155-310                      (version dispatch, size-first vs crc-first)
 *   Utinni TreFile.cs:223-265                      (security caps — division/subtraction form)
 *   Utinni TreFile.cs:328                          (subtraction-form offset OOB guard)
 *
 * Magic (LOCKED):
 *   On-disk bytes 0..3 = 0x45 0x45 0x52 0x54 = "EERT" (little-endian dump of Tag 'TREE').
 *   Verified: swg-client-v2 TreeFile_SearchNode.cpp:237 (header.token != TAG_TREE),
 *             Utinni TreFile.cs:155-156 (magic[0..3] == 'E','E','R','T').
 *   We check: memcmp(token, "EERT", 4) == 0.
 *   NOT "TREE" forward — that is the in-memory representation, not the on-disk bytes.
 *
 * Version string (LOCKED):
 *   Bytes 4..7 read FORWARD as ASCII "0004", "0005", "0006", "5000", or "6000".
 *   Verified: Utinni TreFile.cs:163-172, TreVersion.cs:60-73.
 *
 * Header (36 bytes, all uint32 LE):
 *   [0]  token (4 bytes = "EERT")
 *   [4]  version (4 bytes = ASCII "0005" etc.)
 *   [8]  numberOfFiles
 *   [12] tocOffset
 *   [16] tocCompressor
 *   [20] sizeOfTOC
 *   [24] blockCompressor
 *   [28] sizeOfNameBlock
 *   [32] uncompSizeOfNameBlock
 *   Verified: swg-client-v2 TreeFile_SearchNode.h:174-185, tre_reader.py:33-34.
 *
 * TOC field order (CRC-FIRST for ALL versions — VERIFIED byte-exact):
 *   crc@0, length@4, offset@8, compressor@12, compressedLength@16, fileNameOffset@20.
 *   GROUND TRUTH: swg-client-v2 TreeFile_SearchNode.h:189 (TableOfContentsEntry).
 *   Proven against real archives (bottom.tre "5000" stride 24; SwgRestoration_00.tre
 *   "6000" stride 32). The TOC is sorted ascending by crc (binary-search precondition).
 *     v0004/v0005/v0006/v5000 = crc-first, 24 bytes
 *     v6000                   = crc-first, 32 bytes (+8 pad)
 *
 * Security:
 *   T-01-01: count cap BEFORE alloc — division form: recordCount > ZLIB_MAX_BLOCK / stride
 *   T-01-02: offset cap BEFORE read — subtraction form: offset > streamLen - len
 *   T-01-03: zlib inflate bomb via Zlib.cpp caps (ZLIB_MAX_BLOCK = 256 MB)
 *   T-01-05: v6000 enumerate-only (extractEntry refuses payload for isEnumerateOnly())
 *   T-01-19: CRC-collision safe scan — binary search lands near CRC; scan left/right for name tie-break
 */

#include "TreArchive.h"
#include "../compress/Zlib.h"
#include <cstring>
#include <stdexcept>
#include <algorithm>
#include <cstdio>

#ifdef _WIN32
  #define SWG_STRICMP _stricmp
#else
  #include <strings.h>
  #define SWG_STRICMP strcasecmp
#endif

namespace swg {

// ─── CRC-32 (Crc::calculate — FORWARD / MSB-first) ──────────────────────────
// GROUND TRUTH: swg-client-v2 .../sharedFile/src/shared/Crc.cpp Crc::calculate.
// This is the FORWARD (non-reflected) CRC-32: polynomial 0x04C11DB7,
// init 0xFFFFFFFF, final XOR 0xFFFFFFFF, MSB-first.
//   for (crc=0xFFFFFFFF; *s; ++s)
//       crc = table[((crc>>24) ^ (uint8)*s) & 0xFF] ^ (crc<<8);
//   return crc ^ 0xFFFFFFFF;
// Forward table: c = i<<24; repeat 8: c = (c&0x80000000)?((c<<1)^0x04C11DB7):(c<<1).
// VERIFIED byte-exact: forwardCRC32(lowercase(
//   "appearance/mesh/thm_tato_imprv_building_s09_r0_mesh_l4.msh")) == 3830594,
//   matching crc@offset0 of bottom.tre entry 0.
// NOTE: the incoming name is already lowercased/normalized by resolve()
//   (fixUpFileName). Crc::calculate does NOT lowercase — neither do we here.

// Full 256-entry FORWARD CRC-32 table (polynomial 0x04C11DB7)
static uint32_t crcTable[256];
static bool     crcTableInitialized = false;

static void initCrcTable() {
    if (crcTableInitialized) return;
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t c = i << 24;
        for (int j = 0; j < 8; ++j)
            c = (c & 0x80000000u) ? ((c << 1) ^ 0x04C11DB7u) : (c << 1);
        crcTable[i] = c;
    }
    crcTableInitialized = true;
}

/**
 * Compute the FORWARD CRC-32 of a normalized filename.
 * Source: swg-client-v2 Crc.cpp Crc::calculate.
 */
static uint32_t crcCalculate(const char* str) {
    initCrcTable();
    uint32_t crc = 0xFFFFFFFFu;
    while (*str) {
        crc = crcTable[((crc >> 24) ^ static_cast<uint8_t>(*str)) & 0xFF] ^ (crc << 8);
        ++str;
    }
    return crc ^ 0xFFFFFFFFu;
}

// ─── LE uint32 read (unaligned-safe) ─────────────────────────────────────────
static inline uint32_t readLE32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0])
        | (static_cast<uint32_t>(p[1]) << 8)
        | (static_cast<uint32_t>(p[2]) << 16)
        | (static_cast<uint32_t>(p[3]) << 24);
}

static inline int32_t readLE32s(const uint8_t* p) {
    return static_cast<int32_t>(readLE32(p));
}

// ─── Parse ────────────────────────────────────────────────────────────────────

TreArchive TreArchive::parse(IInputStream& stream) {
    TreArchive arc;

    const int streamLen = stream.length();

    // ── Read 36-byte header ────────────────────────────────────────────────
    // Source: swg-client-v2 TreeFile_SearchNode.h:174-185 (Header struct);
    //         TreeFile_SearchNode.cpp:267-275 (constructor read).
    if (streamLen < 36) {
        throw std::runtime_error("TreArchive::parse: stream too short for TRE header (need 36 bytes)");
    }
    uint8_t hdr[36];
    if (stream.read(0, hdr, 36) != 36) {
        throw std::runtime_error("TreArchive::parse: failed to read TRE header");
    }

    // ── Validate magic "EERT" ─────────────────────────────────────────────
    // Source: swg-client-v2 TreeFile_SearchNode.cpp:237 (header.token != TAG_TREE);
    //         Utinni TreFile.cs:155-156 (magic bytes 'E','E','R','T').
    if (std::memcmp(hdr, "EERT", 4) != 0) {
        throw std::runtime_error(
            std::string("TreArchive::parse: invalid magic (expected EERT, got '") +
            char(hdr[0]) + char(hdr[1]) + char(hdr[2]) + char(hdr[3]) + "')"
        );
    }

    // ── Parse version ────────────────────────────────────────────────────
    // Source: Utinni TreFile.cs:163-172, TreVersion.cs:60-73.
    arc.m_version = parseVersionString(reinterpret_cast<const char*>(hdr + 4));

    // ── Unpack remaining header fields ───────────────────────────────────
    const uint32_t numberOfFiles          = readLE32(hdr + 8);
    const uint32_t tocOffset              = readLE32(hdr + 12);
    const uint32_t tocCompressor          = readLE32(hdr + 16);
    const uint32_t sizeOfTOC             = readLE32(hdr + 20);
    const uint32_t blockCompressor        = readLE32(hdr + 24);
    const uint32_t sizeOfNameBlock        = readLE32(hdr + 28);
    const uint32_t uncompSizeOfNameBlock  = readLE32(hdr + 32);

    // ── Security T-01-01: count cap BEFORE alloc ─────────────────────────
    // Source: Utinni TreFile.cs:223-265.
    // Division form: recordCount > Max / stride avoids overflow.
    const int stride = recordStride(arc.m_version);
    if (numberOfFiles > static_cast<uint32_t>(ZLIB_MAX_BLOCK) / static_cast<uint32_t>(stride)) {
        throw std::runtime_error("TreArchive::parse: numberOfFiles exceeds security cap");
    }

    // ── Security T-01-02: TOC offset+size bounds ─────────────────────────
    // Source: Utinni TreFile.cs:328 (subtraction form: offset > streamLen - len).
    if (static_cast<uint64_t>(tocOffset) + sizeOfTOC > static_cast<uint64_t>(streamLen)) {
        throw std::runtime_error("TreArchive::parse: TOC block out of stream bounds");
    }

    // ── Read + inflate TOC block ──────────────────────────────────────────
    // Source: swg-client-v2 TreeFile_SearchNode.cpp:288-309 (compressed/uncompressed TOC).
    const uint32_t expectedTocSize = static_cast<uint32_t>(stride) * numberOfFiles;
    std::vector<uint8_t> tocData;
    {
        std::vector<uint8_t> tocRaw(sizeOfTOC);
        if (stream.read(static_cast<int>(tocOffset), tocRaw.data(), static_cast<int>(sizeOfTOC)) !=
                static_cast<int>(sizeOfTOC)) {
            throw std::runtime_error("TreArchive::parse: failed to read TOC block");
        }
        if (tocCompressor == 0) {
            tocData = std::move(tocRaw);
        } else {
            // Inflate the TOC block
            tocData = treInflate(static_cast<int>(tocCompressor),
                                 tocRaw.data(), sizeOfTOC, expectedTocSize);
        }
    }
    if (tocData.size() < expectedTocSize) {
        throw std::runtime_error("TreArchive::parse: inflated TOC too small");
    }

    // ── Read + inflate name block ─────────────────────────────────────────
    // Source: swg-client-v2 TreeFile_SearchNode.cpp:311-332 (name block read).
    const uint32_t nameOffset = tocOffset + sizeOfTOC;
    if (static_cast<uint64_t>(nameOffset) + sizeOfNameBlock > static_cast<uint64_t>(streamLen)) {
        throw std::runtime_error("TreArchive::parse: name block out of stream bounds");
    }
    std::vector<uint8_t> nameRaw(sizeOfNameBlock);
    if (stream.read(static_cast<int>(nameOffset), nameRaw.data(), static_cast<int>(sizeOfNameBlock)) !=
            static_cast<int>(sizeOfNameBlock)) {
        throw std::runtime_error("TreArchive::parse: failed to read name block");
    }
    std::vector<uint8_t> nameData;
    if (blockCompressor == 0) {
        nameData = std::move(nameRaw);
    } else {
        nameData = treInflate(static_cast<int>(blockCompressor),
                              nameRaw.data(), sizeOfNameBlock, uncompSizeOfNameBlock);
    }
    // Store name block as a string (null-terminated entries within)
    arc.m_nameBlock.assign(reinterpret_cast<const char*>(nameData.data()), nameData.size());

    // ── Unpack TOC entries ────────────────────────────────────────────────
    // The on-disk TOC record is CRC-FIRST for ALL versions. This was proven
    // byte-exact against real archives (bottom.tre ver "5000" stride 24;
    // SwgRestoration_00.tre ver "6000" stride 32) AND matches the client's
    // own on-disk struct.
    // GROUND TRUTH: swg-client-v2 .../sharedFile/src/shared/TreeFile_SearchNode.h:189
    //   (TableOfContentsEntry: crc, length, offset, compressor, compressedLength,
    //    fileNameOffset). V6000 adds 8 bytes of padding at [24..31] (stride 32).
    // The old "size-first" layout (length@0 … crc@16) for v0004/0005/0006/5000 was
    // fabricated/incorrect for real archives and has been removed.
    arc.m_entries.resize(numberOfFiles);

    for (uint32_t i = 0; i < numberOfFiles; ++i) {
        const uint8_t* r = tocData.data() + static_cast<size_t>(i) * stride;
        TreEntry& e = arc.m_entries[i];

        // CRC-first layout (ALL versions): crc, length, offset, compressor,
        // compressedLength, fileNameOffset [, pad, pad].
        // Source: swg-client-v2 TreeFile_SearchNode.h:189.
        e.crc            = readLE32(r);
        e.length         = readLE32s(r + 4);
        e.offset         = readLE32s(r + 8);
        e.compressor     = readLE32s(r + 12);
        e.compressedLength = readLE32s(r + 16);
        e.fileNameOffset = readLE32s(r + 20);
        // stride-32 (V6000) has 8 bytes of padding at [24..31] — ignored
    }

    return arc;
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

int TreArchive::resolve(const std::string& normalizedName, bool& deleted) const {
    deleted = false;
    if (m_entries.empty()) return -1;

    // Source: swg-client-v2 TreeFile_SearchNode.cpp:364-408.
    const uint32_t targetCrc = crcCalculate(normalizedName.c_str());

    // Binary search keyed on CRC
    int left  = 0;
    int right = static_cast<int>(m_entries.size()) - 1;
    int mid   = 0;
    bool found = false;

    while (!found && left <= right) {
        mid = (left + right) / 2;
        const uint32_t midCrc = m_entries[mid].crc;

        if (midCrc < targetCrc)
            left = mid + 1;
        else if (midCrc > targetCrc)
            right = mid - 1;
        else {
            // CRC match — tie-break by case-insensitive name compare
            // Source: swg-client-v2 TreeFile_SearchNode.cpp:382.
            // T-01-19: collision-safe scan — search left/right for name match.
            const char* entryName = m_nameBlock.c_str() + m_entries[mid].fileNameOffset;
            const int res = SWG_STRICMP(entryName, normalizedName.c_str());
            if (res < 0)
                left = mid + 1;
            else if (res > 0)
                right = mid - 1;
            else
                found = true;
        }
    }

    if (!found) return -1;

    // Tombstone check: length == 0 means deleted
    // Source: swg-client-v2 TreeFile_SearchNode.cpp:397-401.
    if (m_entries[mid].length == 0) {
        deleted = true;
        return -1;
    }

    return mid;
}

// ─── Extract ─────────────────────────────────────────────────────────────────

std::vector<uint8_t> TreArchive::extractEntry(int idx, IInputStream& stream) const {
    // T-01-05: refuse payload extraction for enumerate-only archives (v6000)
    // Source: Utinni TreVersion.cs:79-86 (IsEnumerateOnly => V6000 only).
    if (isEnumerateOnly(m_version)) {
        throw std::runtime_error(
            "TreArchive::extractEntry: archive is enumerate-only (v6000 encrypted payload)"
        );
    }

    if (idx < 0 || idx >= static_cast<int>(m_entries.size())) {
        throw std::runtime_error("TreArchive::extractEntry: index out of range");
    }

    const TreEntry& e = m_entries[idx];

    if (e.length == 0) {
        return {}; // tombstone / empty
    }

    // Security T-01-02: bounds check before read (subtraction form)
    // Source: Utinni TreFile.cs:328.
    const int streamLen = stream.length();
    const int32_t readLen = (e.compressor != 0) ? e.compressedLength : e.length;
    if (readLen < 0 || static_cast<int64_t>(e.offset) > static_cast<int64_t>(streamLen) - readLen) {
        throw std::runtime_error("TreArchive::extractEntry: entry out of stream bounds (T-01-02)");
    }

    std::vector<uint8_t> rawBytes(static_cast<size_t>(readLen));
    if (stream.read(e.offset, rawBytes.data(), readLen) != readLen) {
        throw std::runtime_error("TreArchive::extractEntry: failed to read entry payload");
    }

    return treInflate(e.compressor, rawBytes.data(), static_cast<size_t>(readLen),
                      static_cast<size_t>(e.length));
}

// ─── resolveTombstoneIndex ────────────────────────────────────────────────────

int TreArchive::resolveTombstoneIndex(const std::string& normalizedName) const {
    if (m_entries.empty()) return -1;

    const uint32_t targetCrc = crcCalculate(normalizedName.c_str());
    int left  = 0;
    int right = static_cast<int>(m_entries.size()) - 1;
    int mid   = 0;
    bool found = false;

    while (!found && left <= right) {
        mid = (left + right) / 2;
        const uint32_t midCrc = m_entries[mid].crc;

        if (midCrc < targetCrc)
            left = mid + 1;
        else if (midCrc > targetCrc)
            right = mid - 1;
        else {
            const char* entryName = m_nameBlock.c_str() + m_entries[mid].fileNameOffset;
            const int res = SWG_STRICMP(entryName, normalizedName.c_str());
            if (res < 0)
                left = mid + 1;
            else if (res > 0)
                right = mid - 1;
            else
                found = true;
        }
    }

    return found ? mid : -1;
    // Returns the index even if entry is a tombstone (length==0).
}

// ─── nameAt ──────────────────────────────────────────────────────────────────

const std::string& TreArchive::nameAt(int fileNameOffset) const {
    // Returns the static member itself is wrong — we return a string_view or a static.
    // Since we store m_nameBlock as one contiguous string, return a temporary.
    // For callers that need the name, they should use: m_nameBlock.c_str() + fileNameOffset.
    // This method is provided for interface compatibility; it returns the full block.
    static thread_local std::string s_temp;
    s_temp = m_nameBlock.c_str() + fileNameOffset;
    return s_temp;
}

} // namespace swg
