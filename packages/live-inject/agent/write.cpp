/**
 * write.cpp — pure read-verify write guard implementation (D-03).
 *
 * See write.h for the full contract. Pure C++, no Windows.h, no I/O, no
 * side effects — mirrors sentinels.cpp's testability discipline.
 *
 * applyWrite is intentionally NOT defined in this file — see write.h's
 * comment. 05-03 completes it alongside the resolved setter fn pointers.
 */

#include "write.h"

namespace {

// Static string literals for failReason — mirrors sentinels.cpp's pattern of
// returning fixed diagnostic strings rather than allocating.
constexpr const char* kTransformMismatch        = "transform mismatch";
constexpr const char* kScaleMismatch             = "scale mismatch";
constexpr const char* kTransformAndScaleMismatch = "transform and scale mismatch";

}  // namespace

GuardResult checkWriteGuard(const float liveXform[3][4], const float expectedXform[3][4],
                             const float liveScale[3], const float expectedScale[3]) {
    // Transform channel: all 12 floats must exactly match (bytewise/exact
    // compare — the agent captured expectedXform from its own prior read, so
    // an exact match is the correct condition, not a tolerance compare).
    bool transformPassed = true;
    for (int row = 0; row < 3 && transformPassed; ++row) {
        for (int col = 0; col < 4; ++col) {
            if (liveXform[row][col] != expectedXform[row][col]) {
                transformPassed = false;
                break;
            }
        }
    }

    // Scale channel: independent of the transform check above (REVIEWS.md Fix
    // B — scale must never be silently ungated by a transform-only check).
    bool scalePassed = true;
    for (int i = 0; i < 3; ++i) {
        if (liveScale[i] != expectedScale[i]) {
            scalePassed = false;
            break;
        }
    }

    const char* failReason = nullptr;
    if (!transformPassed && !scalePassed) {
        failReason = kTransformAndScaleMismatch;
    } else if (!transformPassed) {
        failReason = kTransformMismatch;
    } else if (!scalePassed) {
        failReason = kScaleMismatch;
    }

    return { transformPassed, scalePassed, failReason };
}
