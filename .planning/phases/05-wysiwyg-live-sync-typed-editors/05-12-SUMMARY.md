---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 12
subsystem: live-sync
tags: [live-inject, gc, soak-test, n-api, seqlock, wysiwyg, uat]

# Dependency graph
requires:
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 01
    provides: "400-byte LIVE_CHANNEL_LAYOUT (command region, FOCUS_TOKEN, GUARD_STATUS/GUARD_ADDR) the soak test's read/write assertions are keyed against"
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 07
    provides: "Zero-allocation renderer read/write hot paths (useCommandWriter.ts/useChannelReader.ts) whose underlying channel_binding.cpp GC-guard this soak test proves safe under forced collection pressure"
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 11
    provides: "Final Surface 1 HUD (LiveSyncClientCard/TransformReadoutBar/StatusBar/Viewport assembly) that Task 2's in-world UAT exercises end-to-end"
provides:
  - "packages/live-inject/test/soak.test.ts — automated GC-pressure soak proof (500 write+forced-GC+read cycles against the REAL channel_binding.cpp addon) that LIVE-03 SC1's command-slot binding survives repeated forced V8 collection without dangling the native Napi::Reference-guarded view pointer"
  - "packages/live-inject/vitest.config.ts execArgv:['--expose-gc'] — enables real, forced, synchronous global.gc() in this package's test runner (Vitest 4 flattened poolOptions to top-level test options)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Soak-test the REAL native addon (not a TS port) when the property under test is the addon's own object-lifetime guarantee (Napi::Reference refcount/finalizer timing) — a TS simulation cannot exercise actual V8 GC behavior against the C++-held pointer"
    - "Vitest 4 execArgv is a top-level `test` option (test.poolOptions was removed entirely) — passes through to whichever pool (forks/threads) is active"

key-files:
  created:
    - packages/live-inject/test/soak.test.ts
  modified:
    - packages/live-inject/vitest.config.ts

key-decisions:
  - "500 iterations (plan's stated 500-1000 range, lower bound) — sufficient to prove the guard holds under repeated forced collection while keeping the soak's own runtime bounded (~1-2s observed); each iteration varies the transform/scale payload so a stale-but-non-null read cannot be mistaken for a valid one"
  - "The soak requires the REAL @swg/live-inject addon (`require('../index.js')`), not a mock — this is the one test in the package's suite that intentionally exercises production C++ lifetime behavior rather than a TS port, matching the plan's own read_first pointer to channel_binding.cpp's GC-guard comment block"

requirements-completed: [LIVE-03]  # ACCEPTED 2026-07-19: the thin-slice live path (viewport gizmo → transform-nudge the targeted object over the channel) satisfies LIVE-03's literal wording and was exercised live end-to-end during the post-Phase-5 debugging (inject → boot into world → stream position/liveness → move a targeted object → clean detach). The maintainer accepted the slice in lieu of the full 9-step UAT because the in-game gizmo (a different, in-process render architecture) supersedes this live path and is deferred to a NEW milestone (see below).

# Metrics
duration: ~7min (Task 1 only; Task 2 accepted without the full 9-step UAT)
completed: 2026-07-19 (Task 1 automated; Task 2 checkpoint accepted by maintainer)
---

# Phase 05 Plan 12: GC-Pressure Soak Test + Maintainer In-World UAT (COMPLETE — checkpoint accepted)

**Automated GC-pressure soak test proves the command-slot channel's Napi::Reference GC guard survives 500 forced-collection cycles without dangling the native pointer. Task 2's in-world UAT was ACCEPTED by the maintainer against the thin-slice live path (verified working end-to-end during post-Phase-5 debugging) rather than run in full, because the in-game gizmo / world-editor supersedes this approach and moves to a new milestone.**

## Status

**Task 1 (automated): COMPLETE.** Task 2 (`checkpoint:human-verify`): **ACCEPTED (2026-07-19).** The maintainer accepted the thin-slice live capability without walking the full 9-step UAT. Rationale: during the post-Phase-5 live-debugging arc the whole pipeline was exercised in-client end-to-end — inject → cwd fix → boot into world → stream real position/`playerActive` → move a targeted object via the write path → process-liveness detach — closing five real bugs (Electron-42 external-buffer channel, agent-DLL path, launch cwd, seq-vs-process liveness, poll-loop). A Utinni ground-truth spike (`.planning/research/SPIKE-utinni-world-editor-gaps.md`) + a 5-consultant crew synthesis (`.planning/research/CONSULT-UTINNI-SYNTHESIS.md`) then established that the *real* target (an in-GAME-WINDOW gizmo with relative object placement, select-anything, insertion, `.ws` snapshot editing) is a fundamentally different, in-process render architecture — new-milestone scope, not a Phase-5 tweak. So the viewport-gizmo transform-nudge is accepted as Phase 5's honest slice (and survives as the OFFLINE asset gizmo); the in-game gizmo is the next milestone.

## Performance

- **Duration (Task 1 only):** ~7 min
- **Completed:** 2026-07-15T19:49:04Z (Task 1 commit); Task 2 timing TBD
- **Tasks:** 1 of 2 executed (Task 2 is the checkpoint, intentionally not executed by the executor agent)
- **Files modified:** 2

## Accomplishments
- `soak.test.ts`: 500 write+forced-GC+read cycles against the REAL `@swg/live-inject` native addon (`openChannel`/`writeCommand`/`readChannelView`/`closeChannel` — not a TS port), each cycle writing a distinct transform/scale payload, forcing a real synchronous `global.gc()`, then re-reading and verifying (a) the returned `ArrayBuffer` is non-null and exactly 400 bytes, (b) the command-region seqlock landed even (not torn), and (c) the just-written transform/scale floats read back correctly at their `LIVE_CHANNEL_LAYOUT` offsets. Finishes by closing the channel and confirming a subsequent `readChannelView` returns `null` (clean teardown, no dangling handle).
- `vitest.config.ts`: added `execArgv: ['--expose-gc']` so `global.gc()` performs a real forced collection instead of relying on incidental GC timing — this is a top-level Vitest 4 `test` option (the plan's original `poolOptions.forks.execArgv` phrasing predates Vitest 4's removal of `poolOptions`; corrected during implementation, see Deviations).
- Verified: `pnpm --filter @swg/live-inject test -- soak` green (1/1); full package suite (7 files / 50 tests) green with no regressions from the `execArgv` config change.

## Task Commits

1. **Task 1: GC-pressure soak test** - `d141373` (test)

Task 2 (checkpoint:human-verify) has no commit — it is a pending human-verification gate, not executable work.

## Files Created/Modified
- `packages/live-inject/test/soak.test.ts` - New: 500-cycle GC-pressure soak test against the real native addon
- `packages/live-inject/vitest.config.ts` - Added `execArgv: ['--expose-gc']` (top-level Vitest 4 option)

## Decisions Made
See `key-decisions` in the frontmatter above (iteration count, real-addon-not-mock requirement).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected the `--expose-gc` wiring location for Vitest 4**
- **Found during:** Task 1, first `pnpm --filter @swg/live-inject test -- soak` run.
- **Issue:** The plan's action text says to add `--expose-gc` "to this package's test script/config if not already present" without specifying the exact mechanism; a first attempt using `test.poolOptions.forks.execArgv` (the pre-Vitest-4 convention) produced a runtime deprecation warning (`test.poolOptions was removed in Vitest 4`) and `global.gc` remained `undefined`, so the soak's own `beforeAll` guard correctly failed loudly rather than silently skipping.
- **Fix:** Vitest 4 flattened `test.poolOptions.<pool>.*` to top-level `test` options — `execArgv` is now a plain `test.execArgv` array (applies to whichever pool is active; this package uses `pool: 'forks'`). Corrected `vitest.config.ts` accordingly.
- **Files modified:** packages/live-inject/vitest.config.ts
- **Verification:** `pnpm --filter @swg/live-inject test -- soak` — `global.gc` is now a function; all 500 soak cycles pass; full package suite (50 tests) unaffected.
- **Committed in:** `d141373` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking config-mechanism correction for a Vitest-version-specific API change; no scope creep, same intent as the plan's original instruction).

## Issues Encountered

None beyond the Vitest 4 `execArgv` location correction documented above.

## User Setup Required

**Task 2's checkpoint requires the maintainer to manually attach to two real, running SWG clients** (an advertised swg-client-v2 build and a legacy SWGEmu build) and step through the plan's `how-to-verify` steps 1-8. This is NOT automatable — see the CHECKPOINT REACHED block in this execution's final response for the exact steps, expected results, and resume-signal wording. No other external service configuration is required for Task 1.

## Next Phase Readiness

- Task 1's automated proof is done and committed — LIVE-03 SC1's GC-pressure soak requirement is satisfied.
- **LIVE-03 as a whole is NOT complete.** Task 2's blocking checkpoint must be run and approved by the maintainer before this plan (and Phase 05 overall — this is the final plan in the phase, 12 of 12) can be considered closed. Do not advance the milestone/phase status past "executing" until that approval is recorded.
- Once the maintainer responds (approved, or a specific step/target failure), a continuation pass should: (a) update this SUMMARY.md with the UAT outcome (including the advertised-Scale known-gap note per decision #2, and the viewport<->live-object binding-gap acknowledgement per decision #3), (b) update STATE.md/ROADMAP.md to reflect phase 05 completion, and (c) run the plan's final metadata commit.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: PENDING (Task 1 only; Task 2 checkpoint outstanding)*

## Self-Check: PASSED (Task 1 scope only)

`packages/live-inject/test/soak.test.ts` and `packages/live-inject/vitest.config.ts` verified present on disk; commit `d141373` verified present in git log. Task 2 has no artifacts to self-check (pending checkpoint).
