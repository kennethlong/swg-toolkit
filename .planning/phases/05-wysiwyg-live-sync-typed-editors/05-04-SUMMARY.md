---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 04
subsystem: live-sync
tags: [live-inject, seqlock, shared-memory, n-api, c++, host-side, wysiwyg]

# Dependency graph
requires:
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 01
    provides: "400-byte LiveState channel layout (FOCUS_TOKEN + command region + guard status), LIVE_CMD_FLAGS/LIVE_GUARD_FLAGS bit constants"
provides:
  - "Host-side writeCommand(name, transformBytes, scaleBytes, flags) N-API export writing into the SAME named shared mapping openChannel already created"
  - "CHANNEL_BYTE_SIZE = 400 in channel_binding.cpp, matching the 05-01 contract"
affects: [05-07-renderer-writeback-ui, 05-10-hud-guard-status, 05-11-hud-target-labels, 05-12-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Host-side seqlock write mirrors the agent's own channelWrite increment-write-increment shape (channel.cpp), just run into the command-slot offset of the SAME mapping instead of offset 0"
    - "Fixed-size TypedArray/ArrayBuffer validation (exact byte length) before any memcpy — malformed calls throw rather than writing partial/garbled commands"

key-files:
  modified:
    - packages/live-inject/src/channel_binding.cpp
    - packages/live-inject/src/addon.cpp

key-decisions:
  - "WriteCommand accepts either a Float32Array (checked via IsTypedArray, honoring byteOffset) or a raw ArrayBuffer for transform/scale arguments — matches the flexibility already implicit in the plan's acceptance criteria ('Float32Array/ArrayBuffer of exactly 12/3 floats') without adding a second validation path"
  - "flags defaults to 0 when omitted or explicitly undefined/null, per the plan's action text"

requirements-completed: [LIVE-03]

# Metrics
duration: ~7min
completed: 2026-07-15
---

# Phase 05 Plan 04: Host-Side writeCommand N-API Export Summary

**Added the host-side `writeCommand` N-API export that lets the renderer write into the command-slot region (offsets 324-391) of the already-open shared file-mapping, completing the host-side half of the D-02 write path that 05-01 defined and 05-03's agent poll loop consumes.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-15T16:30:02Z (immediately following 05-03's completion commit)
- **Completed:** 2026-07-15T16:37:18Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- `CHANNEL_BYTE_SIZE` in `channel_binding.cpp` grew from 320 to 400 bytes, matching 05-01's ROUND 5 layout (read frame + FOCUS_TOKEN + command region + GUARD_STATUS + GUARD_ADDR) — the single source of truth driving both `CreateFileMappingA` and `MapViewOfFile`'s size in `OpenChannel`.
- New `WriteCommand` N-API export: validates the channel name, validates `transformBytes` (exactly 12 floats / 48 bytes) and `scaleBytes` (exactly 3 floats / 12 bytes) accepting either a TypedArray or raw ArrayBuffer, defaults `flags` to 0 when omitted, looks up the channel in the existing `s_channels` map (no second registry), and throws `"writeCommand: channel not open — call openChannel first"` if the channel was never opened.
- The write itself is a seqlock spanning EXACTLY offsets 324-391 (`InterlockedIncrement` → memcpy cmdTransform(328,48)/cmdScale(376,12)/cmdFlags(388,4) → `InterlockedIncrement`), mirroring the agent's own `channelWrite` shape in `channel.cpp` but run from the host side. FOCUS_TOKEN (320-323), GUARD_STATUS (392-395), and GUARD_ADDR (396-399) are never touched.
- `addon.cpp` gained the forward declaration and `exports.Set("writeCommand", ...)` registration, plus updated header doc-comments listing the new export in both files.

## Task Commits

Each task was committed atomically:

1. **Task 1: WriteCommand export + CHANNEL_BYTE_SIZE bump + addon registration** - `86bc836` (feat)

**Plan metadata:** (this commit, see final_commit below)

## Files Created/Modified
- `packages/live-inject/src/channel_binding.cpp` - `CHANNEL_BYTE_SIZE` 320→400; new `WriteCommand` export; updated header doc-comment with the full 400-byte layout map
- `packages/live-inject/src/addon.cpp` - Forward declaration + `exports.Set("writeCommand", ...)` registration; updated header doc-comment

## Decisions Made
- `WriteCommand` accepts both `Float32Array` (via `IsTypedArray()`, honoring `ByteOffset()`) and raw `ArrayBuffer` for the transform/scale arguments, matching the plan's own "Float32Array/ArrayBuffer of exactly 12/3 floats" acceptance-criteria phrasing without a second code path.
- `flags` defaults to 0 when the 4th argument is omitted, `undefined`, or `null` — matches the plan's action text ("defaults to 0 if omitted").

## Deviations from Plan

None - plan executed exactly as written. The plan's five REVISION NOTEs (ROUND 1-5) already fully specified the final 400-byte layout and the exact 324-391 write span; this execution implemented that specification directly with no additional architectural choices required.

## Verification

- `cmake --build packages/live-inject/build --config Release --target swg_live_inject` succeeded cleanly (zero warnings/errors).
- Functional round-trip test via `node -e` against the built `.node` addon: `writeCommand` is callable; throws `"channel not open"` on an unopened channel name (no crash); after `openChannel` + `writeCommand`, `readChannelView` returns a 400-byte `ArrayBuffer` with an even seq counter at offset 324, correct transform bytes at offset 328, correct scale bytes at offset 376, correct flags at offset 388, and FOCUS_TOKEN (320)/GUARD_STATUS (392)/GUARD_ADDR (396) all remaining 0 (untouched).
- `grep` confirms the highest byte-offset literal in any `WriteCommand` memcpy/`InterlockedIncrement` call is 388 (cmdFlags start, ending at byte 391) — no reference to 392/395/396/399.
- `grep` confirms the seqlock word is incremented at offset 324, not 320.
- Full package test suite: `npx vitest run` — 49/49 tests pass across 6 files (no regressions from the `CHANNEL_BYTE_SIZE` bump, which the TS contracts already expected at 400 since 05-01).

## Issues Encountered

None. The build succeeded on the first attempt; no reconfigure was needed since no new `.cpp` files were added (unlike 05-01's `write.cpp` addition, which required a CMake reconfigure for `file(GLOB *.cpp)` to pick it up).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `writeCommand` is exported, registered, and proven (via a real built-and-run round-trip, not just a compile check) to write into the same shared mapping `openChannel`/`readChannelView` already use — the host-side half of the D-02 write path is complete.
- Ready for 05-07 (renderer writeback UI) to call `writeCommand(name, transform12, scale3, flags)` on every gizmo-drag/numbox-edit event, and to poll `readChannelView` for `state.focusToken`/`GUARD_STATUS`/`GUARD_ADDR` for its own host-side identity re-key and guard-status display.
- No blockers.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*

## Self-Check: PASSED

All modified files verified present on disk; task commit hash (86bc836) verified present in git log.
