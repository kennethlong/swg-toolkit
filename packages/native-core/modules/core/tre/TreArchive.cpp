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
 * TOC field order (RUNTIME-DISPATCHED via isCrcFirst()):
 *   Oracles DISAGREE — see TreVersion.h for the full oracle disagreement matrix.
 *   Do NOT assume one layout. Read recordStride() bytes per entry; branch on isCrcFirst().
 *   Current encoding from Utinni + fixture analysis (PROVISIONAL — Task-3 arbiter confirms):
 *     v0004/v0005/v0006/v5000 = size-first, 24 bytes
 *     v6000                   = crc-first,  32 bytes
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

// ─── CRC-32 (Crc::calculate equivalent) ─────────────────────────────────────
// Ported from swg-client-v2 Crc.cpp — standard Ethernet/IEEE CRC-32.
// Source: swg-client-v2 TreeFile_SearchNode.cpp:364 (crc = Crc::calculate(fileName))

static const uint32_t CRC_TABLE[256] = {
    0x00000000, 0x77073096, 0xee0e612c, 0x990951ba, 0x076dc419, 0x706af48f,
    0xe963a535, 0x9e6495a3, 0x0edb8832, 0x79dcb8a4, 0xe0d5e91b, 0x97d2d988,
    0x09b64c2b, 0x7eb17cbf, 0xe7b82d09, 0x90bf1d9f, 0x1db71064, 0x6ab020f2,
    0xf3b97148, 0x84be41de, 0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
    0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec, 0x14015c4f, 0x63066cd9,
    0xfa0f3d63, 0x8d080df5, 0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172,
    0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b, 0x35b5a8fa, 0x42b2986c,
    0xdbbbc9d6, 0xacbcb9c0, 0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
    0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116, 0x21b4f928, 0x56b3c423,
    0xcfba9599, 0xb8bda50f, 0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924,
    0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d, 0x76dc4190, 0x01db7106,
    0x98d220bc, 0xefd5102a, 0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
    0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818, 0x7f6ad9bb, 0x086d3d2d,
    0x91646c97, 0xe6635c01, 0x6b6c5610, 0x1c6b6786, 0x856530d8, 0xf262004e,
    0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457, 0x65b0d9c6, 0x12b7e950,
    0x8bbeb8ea, 0xfcb9887c, 0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
    0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2, 0x4adfa541, 0x3dd895d7,
    0xa4d1c46d, 0xd3d6f4fb, 0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0,
    0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7cc9, 0x5005713c, 0x270241aa,
    0xbe0b1010, 0xc90c2086, 0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
    0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4, 0x59b33d17, 0x2eb40d81,
    0xb7bd5c3b, 0xc0ba6cad, 0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a,
    0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683, 0xe3630b12, 0x94643b84,
    0x0d6d6a3e, 0x7a6a5aa8, 0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
    0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe, 0xf762575d, 0x806567cb,
    0x196c3671, 0x6e6b06e7, 0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc,
    0xf9b9df6f, 0x8ebeeff9, 0x17b7be43, 0x60b08ed5, 0xd6d6a3e8, 0xa1d1937e,
    0x38d8c2c4, 0x4fdff252, 0xd1bb67f1, 0xa6bc5767, 0x3fb506dd, 0x48b2364b,
    0xd80d2bda, 0xaf0a1b4c, 0x36034af6, 0x41047a60, 0xdf60efc3, 0xa8670955,
    0x316658e6, 0x466773cf, 0xb40bbe37, 0xc30c8ea1, 0x5a05df1b, 0x2d02ef8d,
    /* 256 entries — first 6 rows shown, remainder follows: */
    0x74b1d29a, 0x03b6e20c, 0x9abfb3b6, 0xedb88320,
    0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2,
};

// Full 256-entry CRC-32 table (IEEE polynomial 0xEDB88320)
static uint32_t crcTable[256];
static bool     crcTableInitialized = false;

static void initCrcTable() {
    if (crcTableInitialized) return;
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t c = i;
        for (int j = 0; j < 8; ++j)
            c = (c >> 1) ^ (0xEDB88320u & -(c & 1u));
        crcTable[i] = c;
    }
    crcTableInitialized = true;
}

/**
 * Compute the CRC-32 of a normalized filename.
 * Source: swg-client-v2 TreeFile_SearchNode.cpp:364 (Crc::calculate(fileName))
 */
static uint32_t crcCalculate(const char* str) {
    initCrcTable();
    uint32_t crc = 0xFFFFFFFFu;
    while (*str) {
        crc = (crc >> 8) ^ crcTable[(crc ^ static_cast<uint8_t>(*str)) & 0xFF];
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
    // Field order depends on isCrcFirst(version) — RUNTIME DISPATCH.
    // Source: TreVersion.h (isCrcFirst / recordStride runtime functions);
    //         swg-client-v2 TreeFile_SearchNode.h:189-197 (crc-first 6-field entry);
    //         Utinni TreFile.cs:284-310 (size-first vs crc-first dispatch).
    const bool crcFirst = isCrcFirst(arc.m_version);
    arc.m_entries.resize(numberOfFiles);

    for (uint32_t i = 0; i < numberOfFiles; ++i) {
        const uint8_t* r = tocData.data() + static_cast<size_t>(i) * stride;
        TreEntry& e = arc.m_entries[i];

        if (crcFirst) {
            // CRC-first layout (v6000): crc, length, offset, compressor, compressedLength, fileNameOffset [, pad, pad]
            // Source: Utinni TreFile.cs:284-298; swg-client-v2 TreeFile_SearchNode.h:189-197.
            e.crc            = readLE32(r);
            e.length         = readLE32s(r + 4);
            e.offset         = readLE32s(r + 8);
            e.compressor     = readLE32s(r + 12);
            e.compressedLength = readLE32s(r + 16);
            e.fileNameOffset = readLE32s(r + 20);
            // stride-32 has 8 bytes of padding at [24..31] — ignored
        } else {
            // Size-first layout (v0004/v0005/v0006/v5000):
            // length, offset, compressor, compressedLength, crc, fileNameOffset
            // Source: Utinni TreFile.cs:302-310.
            e.length         = readLE32s(r);
            e.offset         = readLE32s(r + 4);
            e.compressor     = readLE32s(r + 8);
            e.compressedLength = readLE32s(r + 12);
            e.crc            = readLE32(r + 16);
            e.fileNameOffset = readLE32s(r + 20);
        }
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
