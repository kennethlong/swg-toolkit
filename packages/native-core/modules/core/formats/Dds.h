/**
 * modules/core/formats/Dds.h — Engine-free C++20 Microsoft DDS texture parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 Dds.h (struct layout + format constants)
 *   swg-client-v2 Texture.cpp:487-654 (DDS load path: magic + header + format dispatch)
 *
 * KEY GROUND-TRUTH FACTS (verified against source):
 *   DDS binary layout:
 *     Bytes 0-3:   magic = 'DDS ' (0x44445320, little-endian fourCC)
 *     Bytes 4-127: DDS_HEADER (124 bytes, 31 DWORDs):
 *       +0:  dwSize (must be 124)
 *       +4:  dwHeaderFlags
 *       +8:  dwHeight
 *       +12: dwWidth
 *       +16: dwPitchOrLinearSize
 *       +20: dwDepth
 *       +24: dwMipMapCount
 *       +28: dwReserved1[11] (44 bytes = 11 DWORDs)
 *       +72: DDS_PIXELFORMAT (32 bytes = 8 DWORDs):
 *         +72:  dwSize (must be 32)
 *         +76:  dwFlags (DDS_FOURCC=0x4, DDS_RGB=0x40, etc.)
 *         +80:  dwFourCC (e.g. 'DXT1' = 0x31545844 LE)
 *         +84:  dwRGBBitCount
 *         +88:  dwRBitMask
 *         +92:  dwGBitMask
 *         +96:  dwBBitMask
 *         +100: dwABitMask
 *       +104: dwSurfaceFlags
 *       +108: dwComplexFlags
 *       +112: dwReserved2[3] (12 bytes)
 *     Bytes 128+: mip data (mip 0 first, then mip 1, 2, ...)
 *
 *   Format detection:
 *     dwFlags & DDS_FOURCC (0x4) → compressed
 *       dwFourCC == 'DXT1' (0x31545844 LE) → DXT1
 *       dwFourCC == 'DXT2' → DXT2
 *       dwFourCC == 'DXT3' → DXT3
 *       dwFourCC == 'DXT4' → DXT4
 *       dwFourCC == 'DXT5' → DXT5
 *     dwFlags & DDS_RGB (0x40) → uncompressed; use bit masks
 *       dwABitMask != 0 + 32 bits → RGBA8
 *
 *   Mip sizes for DXT compressed textures:
 *     Each DXT block encodes a 4×4 pixel region.
 *     DXT1: 8 bytes per block (4 bits/pixel)
 *     DXT2/DXT3/DXT4/DXT5: 16 bytes per block (8 bits/pixel)
 *     Block count: ceil(w/4) * ceil(h/4)
 *     Mip i: width = max(1, w >> i), height = max(1, h >> i)
 *
 * NOTE: PARSER-NATIVE format (not IFF). Operates on raw bytes.
 * Round-trip: parse → DdsResult → re-emit DDS bytes.
 *
 * Decision D-02: C++20, engine-free.
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include "Mesh.h"  // FormatParseError

namespace swg_core {
namespace formats {

// ─── DDS format enum ─────────────────────────────────────────────────────────

enum class DdsFormat {
    DXT1,
    DXT2,
    DXT3,
    DXT4,
    DXT5,
    RGBA8,
    Unknown
};

// ─── DDS result structs ───────────────────────────────────────────────────────

struct DdsMipEntry {
    uint32_t offset;      // byte offset from start of file
    uint32_t byteLength;  // compressed (or uncompressed) byte length of this mip
    uint32_t width;       // mip width in pixels
    uint32_t height;      // mip height in pixels
    DdsFormat format;     // inherited from top-level format
};

struct DdsResult {
    uint32_t                 width;       // base level width
    uint32_t                 height;      // base level height
    uint32_t                 mipCount;    // number of mip levels (min 1)
    DdsFormat                format;
    std::string              formatName;  // e.g. "DXT1", "RGBA8"
    std::vector<DdsMipEntry> mips;
    // Raw bytes copy for round-trip (DDS is opaque; serialization is identity)
    std::vector<uint8_t>     rawBytes;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a Microsoft DDS texture from raw bytes.
 *
 * Parses the 128-byte header, detects format, and computes per-mip byte extents.
 * rawBytes is copied into DdsResult for identity round-trip.
 * Throws FormatParseError on malformed input.
 *
 * Source: Dds.h (struct layout) + Texture.cpp:487-654.
 */
DdsResult parseDds(const uint8_t* data, uint32_t size);

/**
 * Serialize a DdsResult back to canonical DDS bytes.
 * For DDS this is an identity round-trip (returns rawBytes).
 */
std::vector<uint8_t> serializeDds(const DdsResult& dds);

} // namespace formats
} // namespace swg_core
