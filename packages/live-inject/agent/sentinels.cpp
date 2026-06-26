/**
 * sentinels.cpp — 4-sentinel gate implementations (pure / Win32-free).
 *
 * All predicates operate on byte buffers; no live process calls, no Windows.h.
 * See sentinels.h for the full interface and TRANSFORM_BYTE_SIZE constant.
 *
 * Security: treat all inputs as untrusted — bounds-check every foreign read
 * before use (RESEARCH.md §Pitfall 4, T-03-04 threat mitigation).
 *
 * Transform layout (VERIFIED — swg_math.h:69):
 *   float[3][4] row-major, 12 floats / 48 bytes.
 *   Translation: column 3 — indices 3, 7, 11 in row-major order.
 */

#include "sentinels.h"
#include <cmath>
#include <cstring>

// ---------------------------------------------------------------------------
// Sentinel 1: sane transform (finite, bounded translation, ~orthonormal rows)
// ---------------------------------------------------------------------------

SentinelResult checkTransform(const float* mat3x4) {
    if (!mat3x4) {
        return { false, "transform pointer is null" };
    }

    // All 12 floats must be finite — NaN and +/-Infinity are both rejected.
    // NaN self-compare is checked first so the failReason is specific.
    for (int i = 0; i < 12; ++i) {
        if (mat3x4[i] != mat3x4[i]) {          // IEEE 754: NaN != NaN
            return { false, "NaN in transform element" };
        }
        if (!std::isfinite(mat3x4[i])) {
            return { false, "infinite transform element" };
        }
    }

    // Translation bounds: column 3 of each row (row-major indices 3, 7, 11).
    // SWG worlds are bounded; +/-100,000.0f is a conservative gate.
    constexpr float WORLD_BOUND = 100000.0f;
    if (std::abs(mat3x4[3])  > WORLD_BOUND ||
        std::abs(mat3x4[7])  > WORLD_BOUND ||
        std::abs(mat3x4[11]) > WORLD_BOUND) {
        return { false, "translation out of world bounds" };
    }

    // Rotation row norms: the first 3 elements of each row must be ~unit-length
    // (0.5 < norm < 2.0 catches zero matrices and wildly-scaled transforms).
    for (int row = 0; row < 3; ++row) {
        const float* r = mat3x4 + row * 4;
        float norm = std::sqrt(r[0]*r[0] + r[1]*r[1] + r[2]*r[2]);
        if (norm < 0.5f || norm > 2.0f) {
            return { false, "rotation row norm out of range" };
        }
    }

    return { true, nullptr };
}

// ---------------------------------------------------------------------------
// Sentinel 2: non-null networkId
// ---------------------------------------------------------------------------

SentinelResult checkNetworkId(uint64_t id) {
    if (id == 0) {
        return { false, "networkId is null/zero" };
    }
    return { true, nullptr };
}

// ---------------------------------------------------------------------------
// Sentinel 3: readable object/... template name
// ---------------------------------------------------------------------------

SentinelResult checkTemplateName(const char* name, size_t maxLen) {
    if (!name) {
        return { false, "template name pointer is null" };
    }

    // Prefix check: must start with "object/" (ASCII, case-sensitive per SWG convention)
    static const char PREFIX[]      = "object/";
    static const size_t PREFIX_LEN  = sizeof(PREFIX) - 1;  // 7

    if (maxLen < PREFIX_LEN) {
        return { false, "template name too short to contain prefix" };
    }
    for (size_t i = 0; i < PREFIX_LEN; ++i) {
        if (name[i] != PREFIX[i]) {
            return { false, "template name must start with \"object/\"" };
        }
    }

    // Scan at most maxLen bytes: all characters must be printable ASCII (0x20-0x7E)
    // or a null terminator.  A missing null terminator within maxLen is also rejected.
    bool foundNull = false;
    for (size_t i = 0; i < maxLen; ++i) {
        const unsigned char c = static_cast<unsigned char>(name[i]);
        if (c == '\0') {
            foundNull = true;
            break;
        }
        if (c < 0x20 || c > 0x7e) {
            return { false, "non-printable ASCII character in template name" };
        }
    }

    if (!foundNull) {
        return { false, "template name not null-terminated within maxLen" };
    }

    return { true, nullptr };
}

// ---------------------------------------------------------------------------
// Sentinel 4: player/world liveness
// ---------------------------------------------------------------------------

SentinelResult checkLiveness(bool playerNonNull, bool isOver, int loopCounterDelta) {
    if (!playerNonNull) {
        return { false, "player pointer is null" };
    }
    if (isOver) {
        return { false, "game loop is over" };
    }
    if (loopCounterDelta <= 0) {
        return { false, "loop counter not advancing" };
    }
    return { true, nullptr };
}

// ---------------------------------------------------------------------------
// Gate: all four must pass to allow a channel write (D-05)
// ---------------------------------------------------------------------------

bool allSentinelsPassed(const SentinelResult results[4]) {
    for (int i = 0; i < 4; ++i) {
        if (!results[i].passed) {
            return false;
        }
    }
    return true;
}
