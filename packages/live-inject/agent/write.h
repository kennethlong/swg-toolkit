/**
 * write.h — pure, Win32-free read-verify write guard (D-03).
 *
 * Mirrors the sentinels.h/.cpp testability discipline exactly: no Windows.h,
 * no I/O, no side effects — byte/float-buffer-only signatures the agent poll
 * loop calls before applying any write.
 *
 * The guard is the ONLY gate on a write: it compares the object's CURRENT
 * live bytes against the agent's own locally-tracked expected transform AND
 * scale, independently (REVIEWS.md Fix B — scale is never silently ungated).
 * There is no force-write escape hatch at this layer; CMD_FLAG_REBASELINE_GUARD
 * (see channel.h) is the only way to un-stick a blocked guard, and it may only
 * ever adopt bytes the agent reads/computes itself — never an arbitrary
 * forward-write target (T-05-26).
 */

#pragma once
#include <cstdint>
#include <cstddef>

// Forward declaration only — LiveCommand's full definition lives in channel.h.
// applyWrite takes it by const reference, which does not require a complete
// type at this declaration point, so write.h stays free of channel.h's
// Windows.h dependency (lean-header contract, mirrors resolve.h/sentinels.h).
struct LiveCommand;

struct GuardResult {
    bool        transformPassed;
    bool        scalePassed;
    const char* failReason;   // nullptr when both pass; else names which channel(s) mismatched
};

/**
 * checkWriteGuard — exact (not tolerance) compare of live vs. expected
 * transform AND scale, independently. Both must exactly match the agent's own
 * last-known-good captured values for their respective channel to pass; a
 * transform mismatch never gates the scale check and vice versa (REVIEWS.md
 * Fix B). failReason names which channel(s) mismatched when either check
 * fails, or is nullptr when both pass.
 *
 * expectedXform/expectedScale start uninitialized/unset until the agent's
 * first passing-sentinel read after attach (the D-03 "attach-time" capture);
 * this function only implements the comparator — capture timing is wired in
 * 05-03's agent_main.cpp integration.
 *
 * Scale-channel parity note: this comparator has ALWAYS applied the identical
 * exactness rule to liveScale/expectedScale as to transform — there is no
 * "scale gets a looser check" branch here. A caller that feeds expectedScale
 * back into the liveScale argument (self-comparing no-op) can never detect an
 * externally-driven scale change; 05-03 wires a genuine live-read liveScale
 * value so an external scale tamper is caught with the same reliability as an
 * external transform tamper — this module's contract does not change to make
 * that true, only its caller does.
 */
GuardResult checkWriteGuard(const float liveXform[3][4], const float expectedXform[3][4],
                             const float liveScale[3], const float expectedScale[3]);

/**
 * applyWrite — setter-invocation wrapper (declared here so its call-site type
 * is stable for 05-04's host consumers; NOT defined in this task). 05-03
 * completes the definition alongside the fn-pointer typedefs it needs to call
 * the real setTransform_o2w/setScale endpoints, each gated on its OWN guard
 * bit AND its OWN non-null resolved-fn check (REVIEWS.md Fix A). This task
 * implements ONLY checkWriteGuard; applyWrite is intentionally left
 * undefined here (declaration only, no body) — nothing in Task 2's scope
 * calls it.
 */
void applyWrite(void* target, const LiveCommand& cmd, const GuardResult& guard);
