/**
 * modules/core/math/CompressedQuaternion.cpp — Engine-free C++20 verbatim port.
 *
 * VERBATIM PORT of:
 *   swg-client-v2/src/engine/shared/library/sharedMath/src/shared/CompressedQuaternion.cpp
 *   lines 82-122  (s_formatPrecisionInfo table + cs_* constants)
 *   lines 156-228 (FormatData::install + expandTenBit + expandElevenBit)
 *   lines 386-419 (CompressedQuaternion::install() — builds s_formatData[255])
 *   lines 370-380 (doExpand — unpack x,y,z from packed uint32, compute w)
 *
 * BINARY3/BINARY2 macros from the client source produce literal values:
 *   BINARY3(0011,1111,1111) = 0x3FF (valueMask 11-bit = 1023)
 *   BINARY3(0001,1111,1111) = 0x1FF (valueMask 10-bit = 511)
 *   BINARY3(0100,0000,0000) = 0x400 (signBit 11-bit)
 *   BINARY3(0010,0000,0000) = 0x200 (signBit 10-bit)
 *   Precision-level formatIds (from BINARY2 patterns):
 *     0xFE (level 0), 0xFC (level 1), 0xF8 (level 2), 0xF0 (level 3),
 *     0xE0 (level 4), 0xC0 (level 5), 0x80 (level 6)
 *   baseIndexMasks (not directly needed for read path):
 *     0x00, 0x01, 0x03, 0x07, 0x0F, 0x1F, 0x3F
 */

#include "math/CompressedQuaternion.h"
#include <stdexcept>
#include <cstring>

namespace swg_core {
namespace math {

// ─── Internal namespace (mirrors CompressedQuaternionNamespace) ───────────────

namespace {

// packed format: [MSB] x-11-bit  y-11-bit  z-10-bit
// (CompressedQuaternion.cpp:83-84)
const uint32_t cs_xShift = 21;
const uint32_t cs_yShift = 10;

// 11-bit compressed format (CompressedQuaternion.cpp:95-100)
const uint32_t cs_valueMaskElevenBit = 0x3FFu;  // BINARY3(0011,1111,1111)
const uint32_t cs_signBitElevenBit   = 0x400u;  // BINARY3(0100,0000,0000)

// 10-bit compressed format
const uint32_t cs_valueMaskTenBit    = 0x1FFu;  // BINARY3(0001,1111,1111)
const uint32_t cs_signBitTenBit      = 0x200u;  // BINARY3(0010,0000,0000)

const int cs_minFormatValue = 0;
const int cs_maxFormatValue = 254;  // s_formatData is [0..254] (255 entries)

// ── FormatPrecisionInfo (CompressedQuaternion.cpp:35-49) ──────────────────────
struct FormatPrecisionInfo {
    uint8_t  formatId;
    uint8_t  baseIndexMask;
    int      baseCount;
    float    baseSeparation;
    float    compressFactorElevenBit;
    float    expandFactorElevenBit;
    float    compressFactorTenBit;
    float    expandFactorTenBit;
};

// MAKE_BASE_SEPARATION(shift) = 2.0f / ((1<<shift) + 1)  (CompressedQuaternion.cpp:51)
inline float makeBaseSeparation(int shift) {
    return 2.0f / static_cast<float>((1 << shift) + 1);
}

// s_formatPrecisionInfo[7] — verbatim from CompressedQuaternion.cpp:108-117
// MAKE_PRECISION_INFO(formatId, baseIndexMask, baseShiftCount)
// {formatId, baseIndexMask, 1<<baseShiftCount, MAKE_BASE_SEPARATION(baseShiftCount), 0,0,0,0}
static FormatPrecisionInfo s_formatPrecisionInfo[7] = {
    { 0xFEu, 0x00u, 1 << 0, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },  // level 0
    { 0xFCu, 0x01u, 1 << 1, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },  // level 1
    { 0xF8u, 0x03u, 1 << 2, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },  // level 2
    { 0xF0u, 0x07u, 1 << 3, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },  // level 3
    { 0xE0u, 0x0Fu, 1 << 4, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },  // level 4
    { 0xC0u, 0x1Fu, 1 << 5, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },  // level 5
    { 0x80u, 0x3Fu, 1 << 6, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f },  // level 6
};

const int cs_maxBaseShiftCount = 6;  // sizeof(s_formatPrecisionInfo)/sizeof(...) - 1

// ── FormatData (CompressedQuaternion.cpp:55-78) ───────────────────────────────
struct FormatData {
    float   m_baseValue           = 0.0f;
    uint8_t m_formatPrecisionIndex = 0;
    bool    m_installed           = false;

    void install(float baseValue, uint8_t formatPrecisionIndex) {
        m_baseValue            = baseValue;
        m_formatPrecisionIndex = formatPrecisionIndex;
        m_installed            = true;
    }

    // expandTenBit: verbatim CompressedQuaternion.cpp:207-215
    // "works properly with any kind of junk outside the lowest 10 bits"
    float expandTenBit(uint32_t compressedValue) const {
        if ((compressedValue & cs_signBitTenBit) != 0)
            return m_baseValue - (static_cast<float>(compressedValue & cs_valueMaskTenBit)
                                  * s_formatPrecisionInfo[m_formatPrecisionIndex].expandFactorTenBit);
        else
            return m_baseValue + (static_cast<float>(compressedValue & cs_valueMaskTenBit)
                                  * s_formatPrecisionInfo[m_formatPrecisionIndex].expandFactorTenBit);
    }

    // expandElevenBit: verbatim CompressedQuaternion.cpp:220-228
    // "works properly with any kind of junk outside the lowest 11 bits"
    float expandElevenBit(uint32_t compressedValue) const {
        if ((compressedValue & cs_signBitElevenBit) != 0)
            return m_baseValue - (static_cast<float>(compressedValue & cs_valueMaskElevenBit)
                                  * s_formatPrecisionInfo[m_formatPrecisionIndex].expandFactorElevenBit);
        else
            return m_baseValue + (static_cast<float>(compressedValue & cs_valueMaskElevenBit)
                                  * s_formatPrecisionInfo[m_formatPrecisionIndex].expandFactorElevenBit);
    }
};

// s_formatData[0..254] — verbatim CompressedQuaternion.cpp:122
static FormatData s_formatData[cs_maxFormatValue + 1];
static bool       s_installed = false;

// calculateRange(baseShiftCount) = 4.0f / (baseCount + 1)
// (CompressedQuaternion.cpp:240-244)
inline float calculateRange(int baseShiftCount) {
    return 4.0f / static_cast<float>((1 << baseShiftCount) + 1);
}

} // anonymous namespace

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * installCompressedQuaternion() — verbatim port of CompressedQuaternion::install()
 * (CompressedQuaternion.cpp:386-419).
 *
 * Builds s_formatData[0..254]: for each baseShiftCount 0..6:
 *   1. Compute factors from halfRange = 0.5 * calculateRange(baseShiftCount)
 *   2. For each base index i in 0..baseCount-1:
 *        formatIndex = formatId | i
 *        baseValue   = -1.0f + (i+1)*baseSeparation
 *        s_formatData[formatIndex].install(baseValue, baseShiftCount)
 */
void installCompressedQuaternion() {
    if (s_installed) return;

    for (int baseShiftCount = 0; baseShiftCount <= cs_maxBaseShiftCount; ++baseShiftCount) {
        // baseSeparation computed at init time (verbatim)
        s_formatPrecisionInfo[baseShiftCount].baseSeparation = makeBaseSeparation(baseShiftCount);

        float const baseSeparation = s_formatPrecisionInfo[baseShiftCount].baseSeparation;
        float const halfRange      = 0.5f * calculateRange(baseShiftCount);

        // expand/compress factors (CompressedQuaternion.cpp:397-401)
        s_formatPrecisionInfo[baseShiftCount].compressFactorElevenBit =
            static_cast<float>(cs_valueMaskElevenBit) / halfRange;  // 1023 / halfRange
        s_formatPrecisionInfo[baseShiftCount].expandFactorElevenBit  =
            halfRange / static_cast<float>(cs_valueMaskElevenBit);  // halfRange / 1023

        s_formatPrecisionInfo[baseShiftCount].compressFactorTenBit =
            static_cast<float>(cs_valueMaskTenBit) / halfRange;     // 511 / halfRange
        s_formatPrecisionInfo[baseShiftCount].expandFactorTenBit   =
            halfRange / static_cast<float>(cs_valueMaskTenBit);     // halfRange / 511

        uint8_t const formatId  = s_formatPrecisionInfo[baseShiftCount].formatId;
        int     const baseCount = s_formatPrecisionInfo[baseShiftCount].baseCount;

        // For each base: (CompressedQuaternion.cpp:408-415)
        for (int i = 0; i < baseCount; ++i) {
            uint8_t const formatIndex = static_cast<uint8_t>(formatId | static_cast<uint8_t>(i));
            float   const baseValue   = -1.0f + static_cast<float>(i + 1) * baseSeparation;

            // Bounds check (mirrors VALIDATE_RANGE_INCLUSIVE_INCLUSIVE in original)
            if (static_cast<int>(formatIndex) < cs_minFormatValue ||
                static_cast<int>(formatIndex) > cs_maxFormatValue) {
                throw std::runtime_error("CompressedQuaternion::install: formatIndex out of range");
            }
            s_formatData[formatIndex].install(baseValue, static_cast<uint8_t>(baseShiftCount));
        }
    }

    s_installed = true;
}

/**
 * doExpandCompressedQuaternion() — verbatim port of doExpand()
 * (CompressedQuaternion.cpp:370-380).
 *
 * x = expandElevenBit(data >> cs_xShift,  xFormat)   [uses top 11 bits]
 * y = expandElevenBit(data >> cs_yShift,  yFormat)   [bits 20..10; junk above ignored]
 * z = expandTenBit(data,                  zFormat)   [bits 9..0; junk above ignored]
 * w = sqrt(max(0, 1.0f - (x*x + y*y + z*z)))        [w clamp per plan must_have §3]
 *
 * Output order: (w, x, y, z) — matches on-disk KFAT floatQuaternion read order.
 */
void doExpandCompressedQuaternion(
    uint32_t data,
    uint8_t  xFormat,
    uint8_t  yFormat,
    uint8_t  zFormat,
    float&   outW,
    float&   outX,
    float&   outY,
    float&   outZ)
{
    if (!s_installed) {
        throw std::runtime_error("doExpandCompressedQuaternion: installCompressedQuaternion() not called");
    }

    // Bounds-check format bytes against installed range (T-02-16)
    if (static_cast<int>(xFormat) > cs_maxFormatValue ||
        !s_formatData[xFormat].m_installed) {
        throw std::runtime_error("doExpandCompressedQuaternion: xFormat not installed");
    }
    if (static_cast<int>(yFormat) > cs_maxFormatValue ||
        !s_formatData[yFormat].m_installed) {
        throw std::runtime_error("doExpandCompressedQuaternion: yFormat not installed");
    }
    if (static_cast<int>(zFormat) > cs_maxFormatValue ||
        !s_formatData[zFormat].m_installed) {
        throw std::runtime_error("doExpandCompressedQuaternion: zFormat not installed");
    }

    // (CompressedQuaternion.cpp:373-375)
    outX = s_formatData[xFormat].expandElevenBit(data >> cs_xShift);
    outY = s_formatData[yFormat].expandElevenBit(data >> cs_yShift);
    outZ = s_formatData[zFormat].expandTenBit(data);

    // w = sqrt(max(0, 1-(x²+y²+z²)))  — clamp for numerical robustness on disk data
    // Original C++ (line 379): w = sqrt(1.0f - (x*x + y*y + z*z));
    // Plan must_have adopts the clamp to guard against floating-point drift.
    float ww = 1.0f - (outX * outX + outY * outY + outZ * outZ);
    outW = std::sqrt(std::max(0.0f, ww));
}

} // namespace math
} // namespace swg_core
