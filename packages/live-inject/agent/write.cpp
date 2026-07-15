/**
 * write.cpp — pure read-verify write guard implementation (D-03), plus
 * applyWrite's definition (05-03).
 *
 * checkWriteGuard (below) stays pure/Win32-free, mirroring sentinels.cpp's
 * testability discipline exactly. applyWrite, by contrast, is a thin
 * setter-invocation wrapper that DOES need the resolved fn-pointer slots and
 * LiveCommand's full definition (channel.h) — it is intentionally NOT held to
 * write.h's lean-header contract (that contract only binds the HEADER,
 * write.h, which stays Windows.h-free via LiveCommand's forward declaration).
 */

#include "write.h"
#include "channel.h"  // full LiveCommand definition — needed to read cmd.transform/cmd.scale

// ---------------------------------------------------------------------------
// applyWrite's resolved setter fn-pointer typedefs — mirrors rva_table.cpp's
// pSetTransform_o2w/pSetScale exactly (same calling conventions, opaque
// void* Transform*/Vector* args, no concrete struct dependency).
// ---------------------------------------------------------------------------

typedef void(__thiscall* pSetTransform_o2w)(void*, const void*);
typedef void(__thiscall* pSetScale)(void*, const void*);

namespace swg { namespace endpoints {
    extern pSetTransform_o2w setTransform_o2w;
    extern pSetScale         setScale;
}}

// ---------------------------------------------------------------------------
// applyWrite — setter-invocation wrapper (REVIEWS.md Fix A). Each channel is
// gated INDEPENDENTLY on both its own guard bit AND its own non-null resolved
// fn pointer — a write is NEVER attempted through an unresolved setter.
// ---------------------------------------------------------------------------

void applyWrite(void* target, const LiveCommand& cmd, const GuardResult& guard) {
    if (guard.transformPassed && swg::endpoints::setTransform_o2w) {
        swg::endpoints::setTransform_o2w(target, &cmd.transform);
    }
    if (guard.scalePassed && swg::endpoints::setScale) {
        swg::endpoints::setScale(target, &cmd.scale);
    }
}

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
