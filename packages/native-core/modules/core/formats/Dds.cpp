/**
 * modules/core/formats/Dds.cpp — Engine-free C++20 Microsoft DDS texture parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 Dds.h:16-105 (struct layout, format constants, MakeFourCC)
 *   swg-client-v2 Texture.cpp:487-654 (DDS load: magic validation, header parse, format detect)
 *
 * Decision D-02: C++20, engine-free.
 */

#include "Dds.h"
#include <cstring>
#include <algorithm>

namespace swg_core {
namespace formats {

// ─── DDS constants (from Dds.h) ──────────────────────────────────────────────

// FourCC LE encoding: 'DXT1' → bytes 'D','X','T','1' → LE uint32 = 0x31545844
static constexpr uint32_t makeFourCC(char a, char b, char c, char d) {
    return static_cast<uint32_t>(static_cast<uint8_t>(a))        |
           (static_cast<uint32_t>(static_cast<uint8_t>(b)) << 8) |
           (static_cast<uint32_t>(static_cast<uint8_t>(c)) << 16)|
           (static_cast<uint32_t>(static_cast<uint8_t>(d)) << 24);
}

static constexpr uint32_t FOURCC_DDS  = makeFourCC('D','D','S',' ');
static constexpr uint32_t FOURCC_DXT1 = makeFourCC('D','X','T','1');
static constexpr uint32_t FOURCC_DXT2 = makeFourCC('D','X','T','2');
static constexpr uint32_t FOURCC_DXT3 = makeFourCC('D','X','T','3');
static constexpr uint32_t FOURCC_DXT4 = makeFourCC('D','X','T','4');
static constexpr uint32_t FOURCC_DXT5 = makeFourCC('D','X','T','5');

static constexpr uint32_t DDS_FOURCC = 0x00000004u; // DDPF_FOURCC
static constexpr uint32_t DDS_RGB    = 0x00000040u; // DDPF_RGB
static constexpr uint32_t DDS_ALPHA  = 0x00000001u; // DDPF_ALPHA

static constexpr uint32_t DDS_HEADER_FLAGS_MIPMAP = 0x00020000u; // DDSD_MIPMAPCOUNT

// dwCaps2 / dwComplexFlags flags (at hdr+108)
static constexpr uint32_t DDSCAPS2_CUBEMAP = 0x00000200u; // cube map present

// ─── DDS_HEADER offsets within the 124-byte header block (after magic) ───────
// All offsets relative to start of DDS_HEADER (byte 4 in file).
// DWORD = 4 bytes, little-endian.
//
//  0: dwSize
//  4: dwHeaderFlags
//  8: dwHeight
// 12: dwWidth
// 16: dwPitchOrLinearSize
// 20: dwDepth
// 24: dwMipMapCount
// 28: dwReserved1[11] → 44 bytes
// 72: DDS_PIXELFORMAT (32 bytes)
//   +0:  pfSize
//   +4:  pfFlags
//   +8:  pfFourCC
//   +12: pfRGBBitCount
//   +16..28: bit masks (skip)
// 104: dwSurfaceFlags
// 108: dwComplexFlags
// 112: dwReserved2[3]

static uint32_t readU32LE(const uint8_t* p) {
    uint32_t v;
    std::memcpy(&v, p, 4);
    return v;
}

// ─── Mip size computation ─────────────────────────────────────────────────────

static uint32_t mipDim(uint32_t base, uint32_t level) {
    return std::max(1u, base >> level);
}

// DXT1: 8 bytes/block; DXT2..5: 16 bytes/block; 4×4 pixel block
static uint32_t dxtMipBytes(uint32_t w, uint32_t h, DdsFormat fmt) {
    uint32_t blockW = (w  + 3) / 4;
    uint32_t blockH = (h  + 3) / 4;
    uint32_t bytesPerBlock = (fmt == DdsFormat::DXT1) ? 8u : 16u;
    return blockW * blockH * bytesPerBlock;
}

static uint32_t uncompressedMipBytes(uint32_t w, uint32_t h, uint32_t bitsPerPixel) {
    return w * h * bitsPerPixel / 8;
}

// ─── parseDds ─────────────────────────────────────────────────────────────────

DdsResult parseDds(const uint8_t* data, uint32_t size)
{
    if (size < 128) throw FormatParseError("parseDds: file too short (< 128 bytes)");

    // Magic
    uint32_t magic = readU32LE(data);
    if (magic != FOURCC_DDS) throw FormatParseError("parseDds: missing DDS magic");

    // DDS_HEADER at offset 4 (124 bytes)
    const uint8_t* hdr = data + 4;
    uint32_t dwSize         = readU32LE(hdr +   0);
    uint32_t dwHeaderFlags  = readU32LE(hdr +   4);
    uint32_t dwHeight       = readU32LE(hdr +   8);
    uint32_t dwWidth        = readU32LE(hdr +  12);
    // +16: dwPitchOrLinearSize
    // +20: dwDepth
    uint32_t dwMipMapCount  = readU32LE(hdr +  24);

    (void)dwSize;         // tolerate; source does FATAL in debug only
    (void)dwHeaderFlags;  // used for optional MIPMAP / VOLUME / etc.

    // dwComplexFlags / dwCaps2 at hdr+108 — cube map detection
    uint32_t dwComplexFlags = readU32LE(hdr + 108);
    bool isCubemap = (dwComplexFlags & DDSCAPS2_CUBEMAP) != 0;

    // DDS_PIXELFORMAT at hdr+72
    const uint8_t* pf = hdr + 72;
    // +0: pfSize
    uint32_t pfFlags  = readU32LE(pf +  4);
    uint32_t pfFourCC = readU32LE(pf +  8);
    uint32_t pfBitCnt = readU32LE(pf + 12);
    // bit masks follow
    uint32_t pfAMask  = readU32LE(pf + 28);

    if (dwWidth == 0 || dwHeight == 0 || dwWidth > 16384 || dwHeight > 16384) {
        throw FormatParseError("parseDds: invalid dimensions");
    }
    if (dwMipMapCount > 16) {
        throw FormatParseError("parseDds: mipMapCount too large");
    }
    uint32_t mipCount = dwMipMapCount == 0 ? 1 : dwMipMapCount;

    // Format detection (mirrors Texture.cpp:597-654)
    DdsFormat fmt = DdsFormat::Unknown;
    std::string fmtName = "Unknown";
    uint32_t bitsPerPixel = pfBitCnt;

    bool isFourCC = (pfFlags & DDS_FOURCC) != 0;
    bool isRGB    = (pfFlags & DDS_RGB) != 0;

    if (isFourCC) {
        if      (pfFourCC == FOURCC_DXT1) { fmt = DdsFormat::DXT1; fmtName = "DXT1"; }
        else if (pfFourCC == FOURCC_DXT2) { fmt = DdsFormat::DXT2; fmtName = "DXT2"; }
        else if (pfFourCC == FOURCC_DXT3) { fmt = DdsFormat::DXT3; fmtName = "DXT3"; }
        else if (pfFourCC == FOURCC_DXT4) { fmt = DdsFormat::DXT4; fmtName = "DXT4"; }
        else if (pfFourCC == FOURCC_DXT5) { fmt = DdsFormat::DXT5; fmtName = "DXT5"; }
        else {
            // Unknown FourCC — still parseable as "Unknown"
            char buf[8];
            std::memcpy(buf, &pfFourCC, 4); buf[4] = '\0';
            fmtName = std::string("FOURCC:") + buf;
        }
    } else if (isRGB) {
        if (pfBitCnt == 32 && pfAMask != 0) {
            fmt = DdsFormat::RGBA8; fmtName = "RGBA8";
        } else if (pfBitCnt == 32) {
            fmt = DdsFormat::RGBA8; fmtName = "RGBA8"; // treat RGB32 as RGBA8
        } else {
            fmtName = "RGB" + std::to_string(pfBitCnt);
        }
    }

    // Build mip table
    DdsResult result;
    result.width     = dwWidth;
    result.height    = dwHeight;
    result.mipCount  = mipCount;
    result.format    = fmt;
    result.formatName = fmtName;
    result.isCubemap  = isCubemap;
    result.mips.reserve(isCubemap ? mipCount * 6 : mipCount);  // 6 faces for cube maps

    uint32_t offset = 128; // data starts after 4-byte magic + 124-byte header

    // For cube maps: 6 faces, each face contains mipCount mip levels (face-major order).
    // mips[] will contain 6*mipCount entries: face0_mip0, face0_mip1, ..., face1_mip0, ...
    // Callers that build CompressedCubeTexture need face[i] = mips[i * mipCount + level].
    // For non-cubes: standard mipCount entries.
    uint32_t faceCount = isCubemap ? 6u : 1u;

    for (uint32_t face = 0; face < faceCount; ++face) {
        for (uint32_t i = 0; i < mipCount; ++i) {
            DdsMipEntry mip;
            mip.width  = mipDim(dwWidth,  i);
            mip.height = mipDim(dwHeight, i);
            mip.format = fmt;
            mip.offset = offset;

            if (isFourCC && fmt != DdsFormat::Unknown) {
                mip.byteLength = dxtMipBytes(mip.width, mip.height, fmt);
            } else {
                mip.byteLength = uncompressedMipBytes(mip.width, mip.height, bitsPerPixel > 0 ? bitsPerPixel : 32);
            }

            result.mips.push_back(mip);
            offset += mip.byteLength;
        }
    }

    // Copy raw bytes for identity round-trip
    result.rawBytes.assign(data, data + size);

    return result;
}

// ─── serializeDds ─────────────────────────────────────────────────────────────

std::vector<uint8_t> serializeDds(const DdsResult& dds)
{
    // DDS is an opaque binary format — round-trip is identity.
    return dds.rawBytes;
}

} // namespace formats
} // namespace swg_core
