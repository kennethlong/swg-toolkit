/**
 * sentinels.h — 4-sentinel gate declarations (pure / Win32-free — testable standalone).
 *
 * All functions operate on byte buffers; no live process calls.
 * Implementation in Plan 03-03.
 */

#pragma once
#include <cstddef>
#include <cstdint>

// Transform layout (RESEARCH.md §Transform memory layout — VERIFIED):
// swg::math::Transform = float[3][4], 12 floats / 48 bytes, row-major.
// Translation is column 3: mat[0][3], mat[1][3], mat[2][3].
// The IPC doc's "64-byte 4×4 matrix" is WRONG for SWG — use 48 bytes.
static constexpr size_t TRANSFORM_BYTE_SIZE = 48;

struct SentinelResult {
    bool        passed;
    const char* failReason;
};

/**
 * Sentinel 1: sane transform (finite, ~orthonormal, translation within world bounds).
 * Input: raw 48-byte buffer from getTransform_o2w (float[3][4], row-major).
 * Implementation in Plan 03-03.
 */
SentinelResult checkTransform(const float* mat3x4);

/**
 * Sentinel 2: non-null networkId.
 * Implementation in Plan 03-03.
 */
SentinelResult checkNetworkId(uint64_t id);

/**
 * Sentinel 3: readable object/... template name (ASCII, starts with "object/").
 * Implementation in Plan 03-03.
 */
SentinelResult checkTemplateName(const char* name, size_t maxLen);

/**
 * Sentinel 4: player/world liveness (getPlayer non-null, !isOver, counter advancing).
 * Implementation in Plan 03-03.
 */
SentinelResult checkLiveness(bool playerNonNull, bool isOver, int loopCounterDelta);

/**
 * All four must pass for the write gate to open (D-05).
 * Implementation in Plan 03-03.
 */
bool allSentinelsPassed(const SentinelResult results[4]);
