/**
 * modules/core/math/CompressedQuaternion.h — Engine-free C++20 verbatim port.
 *
 * PORT SOURCE (verbatim):
 *   swg-client-v2/src/engine/shared/library/sharedMath/src/shared/CompressedQuaternion.cpp
 *   Lines 82-122 (s_formatPrecisionInfo table + format constants)
 *   Lines 156-228 (FormatData::install, expandTenBit, expandElevenBit)
 *   Lines 386-419 (CompressedQuaternion::install() — builds s_formatData[255])
 *   Lines 370-380 (doExpand — unpack x,y,z from packed uint32, compute w)
 *
 * KEY GROUND-TRUTH FACTS (LOCKED — do NOT re-derive):
 *   packed uint32 layout: x-11-bit (bits 31..21) | y-11-bit (bits 20..10) | z-10-bit (bits 9..0)
 *   x shift = 21; y shift = 10; z uses bits 0..9 directly.
 *   11-bit mask = 0x3FF (valueMask), sign = 0x400
 *   10-bit mask = 0x1FF (valueMask), sign = 0x200
 *   7 precision levels (baseShiftCount 0..6):
 *     formatId: {0:0xFE, 1:0xFC, 2:0xF8, 3:0xF0, 4:0xE0, 5:0xC0, 6:0x80}
 *     baseCount = 1 << baseShiftCount (1,2,4,8,16,32,64)
 *     baseSeparation = 2.0f / ((1<<baseShiftCount) + 1)
 *     halfRange = 0.5f * (4.0f / ((1<<baseShiftCount) + 1)) = baseSeparation
 *     expandFactorElevenBit = halfRange / 1023
 *     expandFactorTenBit    = halfRange / 511
 *     formatIndex = formatId | i; baseValue = -1.0f + (i+1)*baseSeparation
 *   s_formatData[0..254] built by install(); index 0xFF (255) NOT set.
 *   w = sqrt(1.0f - (x*x + y*y + z*z))  [bare sqrt, no clamp in C++ source]
 *     BUT: plan's must_have adopts w = sqrt(max(0, ...)) for robustness on normalized inputs.
 *
 * Decision D-02: C++20, engine-free (no SOE headers).
 */

#pragma once

#include <cstdint>
#include <cmath>
#include <algorithm>

namespace swg_core {
namespace math {

/**
 * install() — Initializes the static s_formatData table (255 entries).
 * MUST be called once before any doExpand() call.
 * Verbatim port of CompressedQuaternion::install() (CompressedQuaternion.cpp:386-419).
 */
void installCompressedQuaternion();

/**
 * doExpand() — Decompress a CKAT packed uint32 into (w, x, y, z) float components.
 *
 * Verbatim port of doExpand() (CompressedQuaternion.cpp:370-380).
 * xFormat, yFormat, zFormat are the uint8 format bytes read ONCE per QCHN channel (not per key).
 * Output quaternion order: (w, x, y, z) — consistent with on-disk KFAT floatQuaternion order.
 * Caller must reorder to THREE.Quaternion(x, y, z, w) at render time.
 *
 * @param data    packed uint32 from disk (CKAT QCHN per-key field)
 * @param xFormat uint8 from QCHN channel header
 * @param yFormat uint8 from QCHN channel header
 * @param zFormat uint8 from QCHN channel header
 * @param outW    output: w component
 * @param outX    output: x component
 * @param outY    output: y component
 * @param outZ    output: z component
 */
void doExpandCompressedQuaternion(
    uint32_t data,
    uint8_t  xFormat,
    uint8_t  yFormat,
    uint8_t  zFormat,
    float&   outW,
    float&   outX,
    float&   outY,
    float&   outZ);

} // namespace math
} // namespace swg_core
