---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 01
subsystem: live-sync
tags: [live-inject, seqlock, shared-memory, n-api, c++, win32-agent, wysiwyg]

# Dependency graph
requires:
  - phase: 03-live-injection-foundation
    provides: LiveState read-frame seqlock channel (320-byte layout), sentinels.h/.cpp testability convention, channelOpen/channelWrite/channelClose primitives
provides:
  - "LIVE_CHANNEL_LAYOUT extended to 400 bytes: FOCUS_TOKEN (per-tick read-frame identity), COMMAND_SEQ_COUNTER/COMMAND_TRANSFORM/COMMAND_SCALE/COMMAND_FLAGS (host-to-agent write command slot), GUARD_STATUS/GUARD_ADDR (agent-authoritative guard outcome + diagnostic address)"
  - "LIVE_CMD_FLAGS (STOP_REQUESTED, REBASELINE_GUARD) and LIVE_GUARD_FLAGS (TRANSFORM_REFUSED, SCALE_REFUSED, STOPPING) bit constants"
  - "channel.h LiveState struct mirrors the 400-byte layout with seven new static_asserts; channelWrite fixed to copy LIVE_READFRAME_BYTES (named constant) instead of sizeof(LiveState) arithmetic"
  - "channelReadCommand (agent-side seqlock retry-read of the command region) and channelWriteGuardStatus (InterlockedExchange, no seqlock) implemented against the existing mapped view"
  - "Pure, Win32-free checkWriteGuard(liveXform, expectedXform, liveScale, expectedScale) -> GuardResult{transformPassed, scalePassed, failReason} in write.h/write.cpp, independently gating transform and scale (REVIEWS.md Fix B)"
affects: [05-03-agent-writeback, 05-04-host-write-export, 05-07-renderer-writeback-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two independent seqlock regions in ONE named file-mapping (no second CreateFileMappingA) — read frame (agent->host) and command region (host->agent) coexist in the same LiveState struct"
    - "Named byte-count constants (LIVE_READFRAME_BYTES) instead of sizeof(LiveState) arithmetic for memcpy spans, so struct growth cannot silently widen a copy into an adjacent region"
    - "TS-port-of-C++-logic testing convention (mirrors sentinels.test.ts) extended to write-guard.test.ts — avoids a native compile cycle for vitest"
    - "Single aligned uint32 status words (guardStatus, guardAddr) written via InterlockedExchange with no seqlock, tolerating a torn read of one stale-but-valid word"

key-files:
  created:
    - packages/live-inject/agent/write.h
    - packages/live-inject/agent/write.cpp
    - packages/live-inject/test/write-guard.test.ts
  modified:
    - packages/contracts/src/live-inject.ts
    - packages/live-inject/agent/channel.h
    - packages/live-inject/agent/channel.cpp
    - packages/live-inject/test/channel-layout.test.ts

key-decisions:
  - "Command slot carries the FULL target state (transform AND scale together) on every write, not a mode-tagged partial update — avoids a write-kind discriminator bit, matches 'renderer maintains one authoritative local pose' (planner's discretion per 05-CONTEXT.md)"
  - "applyWrite is declared in write.h (forward-declaring LiveCommand to avoid pulling channel.h's Windows.h include into write.h's lean-header contract) but left undefined in this plan — 05-03 completes it alongside the resolved setter fn-pointer typedefs"
  - "FOCUS_TOKEN inserted immediately after LIVENESS at offset 320, shifting every command-region field +4 bytes, so it stays inside the SAME seqlocked read-frame span as transform/networkId/templateName/liveness rather than being a separately-timed publish"

patterns-established:
  - "Guard-flag bit layout: TRANSFORM_REFUSED (0x1, renamed from legacy WRITE_REFUSED, same bit value) / SCALE_REFUSED (0x2) / STOPPING (0x4) — independently settable, host-observed via the same ArrayBuffer polling path, no new native export"

requirements-completed: [LIVE-03]

# Metrics
duration: 20min
completed: 2026-07-15
---

# Phase 05 Plan 01: Command-Slot Channel Layout + Write Guard Comparator Summary

**Extended the Phase-3 seqlock read channel to a 400-byte layout carrying a second, independent host-to-agent command region plus a per-tick FOCUS_TOKEN identity field, and implemented a pure transform/scale write-guard comparator both future plans (05-03 agent integration, 05-07 renderer writeback) build on.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-15T15:39:41Z (STATE.md session start)
- **Completed:** 2026-07-15T15:46:00Z
- **Tasks:** 2 (Task 2 was tdd="true": RED + GREEN)
- **Files modified:** 7 (4 modified, 3 created)

## Accomplishments
- `LIVE_CHANNEL_LAYOUT` grew from 320 to 400 bytes with seven new fields (FOCUS_TOKEN, COMMAND_SEQ_COUNTER, COMMAND_TRANSFORM, COMMAND_SCALE, COMMAND_FLAGS, GUARD_STATUS, GUARD_ADDR), verified TS-side via offset assertions and a seqlock-simulation test with a torn-read-rejected case for the command region.
- Fixed the load-bearing `channelWrite` bug (T-05-01): the memcpy byte count is now the named `LIVE_READFRAME_BYTES` constant instead of `sizeof(LiveState) - sizeof(LONG)`, so future struct growth can never silently over-copy into the command region.
- Implemented a pure, Win32-free `checkWriteGuard` that independently gates transform and scale writes with exact (not tolerance) float comparison, proven via a 6-case TS port (both-pass, transform-only-fail, scale-only-fail, both-fail, per-element coverage, float32 exactness) following the project's established sentinels.h TDD/testing convention.
- Both the x86 agent DLL (`channel.cpp` + `write.cpp`) and the `@swg/contracts` package were rebuilt/compiled to confirm the seven new `static_assert(offsetof(...))` lines and the write-guard module compile cleanly — not just TS-verified.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend the channel layout** - `27ff672` (feat)
2. **Task 2: Pure read-verify guard module (TDD)** - `863d06c` (test, RED) → `63e61ac` (feat, GREEN)

**Plan metadata:** (this commit, see final_commit below)

_Note: Task 2 is tdd="true" — RED (failing tests) then GREEN (implementation) as two separate commits, per project TDD convention._

## Files Created/Modified
- `packages/contracts/src/live-inject.ts` - LIVE_CHANNEL_LAYOUT extended to 400 bytes; LIVE_CMD_FLAGS, LIVE_GUARD_FLAGS, LIVE_READFRAME_BYTES exported
- `packages/live-inject/agent/channel.h` - LiveState struct grown to 400 bytes (focusToken, cmdSeqCounter, cmdTransform, cmdScale, cmdFlags, guardStatus, guardAddr), LiveCommand struct, channelReadCommand/channelWriteGuardStatus declarations
- `packages/live-inject/agent/channel.cpp` - Seven new static_asserts; channelWrite fixed to use LIVE_READFRAME_BYTES; channelReadCommand + channelWriteGuardStatus implemented
- `packages/live-inject/agent/write.h` - GuardResult, checkWriteGuard declaration, applyWrite declaration (undefined, deferred to 05-03)
- `packages/live-inject/agent/write.cpp` - checkWriteGuard implementation (independent transform/scale exact-match gating)
- `packages/live-inject/test/channel-layout.test.ts` - New offset/flag assertions, command-region seqlock simulation + torn-read case, FOCUS_TOKEN read-frame round-trip proof
- `packages/live-inject/test/write-guard.test.ts` - New file: TS port of checkWriteGuard + 6 test cases

## Decisions Made
- Command slot carries the full target state (transform + scale) every write rather than a mode-tagged partial update (planner's discretion per CONTEXT.md), avoiding a write-kind discriminator bit.
- `applyWrite` is declared but intentionally left without a definition in this plan — write.h's `struct LiveCommand;` forward-declaration keeps write.h Windows.h-free while still typing the eventual call site correctly for 05-03.
- Guard-flag renumbering: the legacy single `WRITE_REFUSED` bit is renamed `TRANSFORM_REFUSED` at the same bit value (0x1) for zero compat break, with `SCALE_REFUSED` (0x2) and `STOPPING` (0x4) added alongside it.

## Deviations from Plan

None - plan executed exactly as written. The plan's REVISION NOTEs (ROUND 1-5) already fully specified the final 400-byte layout, FOCUS_TOKEN, and STOPPING-bit design; this execution implemented that specification directly with no additional architectural choices required.

## Issues Encountered

None. The x86 agent DLL CMakeLists.txt uses `file(GLOB *.cpp)`, which is evaluated at CMake *configure* time — adding `write.cpp` required an explicit `cmake -B build-agent -A Win32 -G "Visual Studio 17 2022"` reconfigure (not just `cmake --build`) before the new source file was picked up by the generated MSBuild project. This is a one-time note for future plans that add new agent `.cpp` files, not a plan deviation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The 400-byte contract + native struct layout is locked and verified (TS offset tests + x86 native `static_assert`s + a real MSVC build of the agent DLL), ready for 05-03 to wire `channelReadCommand`/`channelWriteGuardStatus`/`checkWriteGuard` into `agent_main.cpp`'s poll loop and complete `applyWrite`.
- `LiveCommand`, `GuardResult`, `LIVE_CMD_FLAGS`, and `LIVE_GUARD_FLAGS` are all available as stable types/constants for 05-04 (host N-API export) and 05-07 (renderer writeback UI) to consume.
- No blockers. The x86 MSVC toolset build succeeded cleanly with the extended struct; no packing surprises beyond what the existing `#pragma pack(push, 4)` already handles.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*

## Self-Check: PASSED

All created/modified files verified present on disk; all three task commit hashes (27ff672, 863d06c, 63e61ac) verified present in git log.
