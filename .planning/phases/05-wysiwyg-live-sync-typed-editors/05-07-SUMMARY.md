---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 07
subsystem: live-sync
tags: [live-inject, zustand, react, zero-allocation, seqlock, wysiwyg, vitest]

# Dependency graph
requires:
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 01
    provides: "400-byte LIVE_CHANNEL_LAYOUT (FOCUS_TOKEN offset 320, GUARD_STATUS/GUARD_ADDR offsets 392/396), LIVE_CMD_FLAGS/LIVE_GUARD_FLAGS bit constants"
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 03
    provides: "Agent-side guarded write path publishing focusToken/hasTarget/targetUnavailableOnBuild/scaleUnavailableOnBuild every tick, GUARD_FLAG_STOPPING acknowledgement"
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 04
    provides: "Host-side writeCommand(name, transformBytes, scaleBytes, flags) N-API export"
provides:
  - "useCommandWriter.ts — zero-allocation writeTransform(mappingName, transform12, scale3, flags=0)/writeStop/writeRebaselineGuard imperative write path (two preallocated Float32Array buffers, reused for process lifetime)"
  - "liveStore identityCache: Map<focusToken, IdentitySlot> — per-identity COW snapshot/write-log/per-channel guard state, keyed on the agent-published focusToken (never networkId/templateName), with ROUND 6 pointer-ABA cross-check on cache HIT and bounded 64-entry LRU eviction"
  - "liveStore revertWrite/revertAll — gate-on-blocked, ONE coalesced writeTransform(..., REBASELINE_GUARD) call, per-channel lastDiscardedChange disclosure, expectedTransform()/expectedScale() HUD selectors"
  - "useChannelReader.ts zero-allocation read path — parseChannelView reuses one Float32Array(12) via DataView reads (no buf.slice()); getRegionView caches a single Uint8Array view keyed on backing-ArrayBuffer identity; decodeGuardFields explicitly decodes GUARD_STATUS/GUARD_ADDR; VerifiedObjectState gains hasTarget/targetUnavailableOnBuild/scaleUnavailableOnBuild/focusToken"
  - "useLiveService.detachUI() — now async; resends writeStop on a ~33ms bounded (~750ms) retry loop polling GUARD_FLAG_STOPPING before closing the channel"
  - "LiveInspectorPanel Detach button (D-04 item 2)"
affects: [05-10-hud-guard-status, 05-11-hud-target-labels, 05-12-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Monkey-patch the real, process-cached native addon object + dynamic import(AFTER patching) to test code that does a bare require('@swg/<addon>') — vi.mock does NOT intercept CJS require() of a native addon in this project's vitest setup (confirmed by direct repro against both @swg/live-inject and @swg/native-core); ESM-imported LOCAL sibling modules (e.g. useCommandWriter.ts imported by liveStore.ts) mock normally via vi.mock"
    - "Per-identity cache (Map<focusToken, IdentitySlot>) with a cross-check-on-HIT (templateName/networkId) before trusting a restore, plus least-recently-active-bounded eviction — closes cross-template pointer-ABA without a channel-layout change"
    - "getRegionView / preallocTransform module-level singleton buffers, reused across every RAF tick — zero-allocation hot-path idiom for both the write (useCommandWriter) and read (useChannelReader) halves of the loop"

key-files:
  created:
    - packages/renderer/src/hooks/useCommandWriter.ts
    - packages/renderer/src/hooks/useCommandWriter.test.ts
    - packages/renderer/src/state/liveStore.test.ts
    - packages/renderer/src/hooks/useLiveService.test.ts
    - packages/renderer/src/panels/LiveInspectorPanel.test.tsx
    - packages/renderer/src/hooks/useChannelReader.test.ts
  modified:
    - packages/contracts/src/live-inject.ts
    - packages/renderer/src/state/liveStore.ts
    - packages/renderer/src/hooks/useChannelReader.ts
    - packages/renderer/src/hooks/useLiveService.ts
    - packages/renderer/src/panels/LiveInspectorPanel.tsx

key-decisions:
  - "identityCache keys on the agent-published focusToken exclusively — never (networkId, templateName), which collapses to (0, templateName) on legacy and lets two same-template objects share one host-side identity"
  - "On every cache HIT, cross-check the stored slot's templateName/networkId against the CURRENT state before restoring — a mismatch evicts and recreates (safe miss) rather than trusting a focusToken match alone (closes cross-template pointer-ABA)"
  - "identityCache bounded to 64 entries via least-recently-ACTIVE eviction (not least-recently-inserted)"
  - "revertWrite truncates writeLog to the entries strictly before the reverted one (the reverted entry and everything after it is treated as undone); revertAll resets writeLog to empty — an implementation-detail fill for log bookkeeping the plan's action text did not explicitly specify beyond the send-target computation"
  - "When cowSnapshot.scale is still null (no scale-bearing write has ever happened this identity) and a revert needs a scale payload, fall back to an identity scale (1,1,1) rather than force-writing zeros or fabricating a 'discarded' value — applied consistently in both the actual writeTransform payload (resolveScaleForSend) and the lastDiscardedChange disclosure"
  - "detachUI's signature changed from sync void to async Promise<void> to support the bounded stop-retry loop; the one call site (LiveInspectorPanel's new Detach button) uses the existing 'void detachUI()' fire-and-forget idiom already used by the file's other attach handlers"

patterns-established:
  - "Native-addon test seam: require the real addon once at test-file top level, monkey-patch the specific method(s) under test, THEN dynamically import() the module under test so its own top-level require() resolves the SAME (now-patched) cached object — documented in useCommandWriter.test.ts's header comment for future plans testing useLiveService.ts/useChannelReader.ts-style bare-require modules"

requirements-completed: [LIVE-03]

# Metrics
duration: ~24min
completed: 2026-07-15
---

# Phase 05 Plan 07: Renderer Write/Read Path — Zero-Alloc Command Writer, Per-Identity Guard State, Zero-Alloc Channel Reader Summary

**Zero-allocation imperative writeTransform/writeStop path, a per-focusToken identity cache replacing liveStore's single COW slot (closing two same-template/focus-flip data-loss bugs from the cross-AI review), and a zero-allocation channel reader that also decodes GUARD_STATUS/GUARD_ADDR/FOCUS_TOKEN every tick — plus a bounded stop-signal retry loop and a real Detach button.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-07-15T17:19:29Z (STATE.md session, immediately following 05-06's completion)
- **Completed:** 2026-07-15T17:42:57Z
- **Tasks:** 3 (Task 1 and Task 3 were tdd="true": RED + GREEN each; Task 2 was type="auto")
- **Files modified:** 11 (5 modified, 6 created — 5 of the created files are new test suites)

## Accomplishments
- `useCommandWriter.ts`: `writeTransform(mappingName, transform12, scale3, flags=0)`/`writeStop`/`writeRebaselineGuard` reuse two module-level `Float32Array(12)`/`Float32Array(3)` buffers for the entire process lifetime — proven via a 100-call identity test (the addon mock always receives the SAME buffer object references) plus explicit default/non-zero `flags` pass-through tests.
- `liveStore.ts`: the single ROUND-4 COW slot is replaced by `identityCache: Map<focusToken, IdentitySlot>`. `captureSnapshotIfNeeded` re-keys on the agent-published `focusToken` (never `networkId`/`templateName`), cross-checks the stored slot's `templateName`/`networkId` on every cache HIT before restoring it (a mismatch evicts and recreates — closes the cross-template pointer-ABA fail-open), and bounds the cache to 64 identities via least-recently-active eviction. `revertWrite`/`revertAll` gate-on-blocked per channel, send ONE coalesced `writeTransform(..., LIVE_CMD_FLAGS.REBASELINE_GUARD)` call only when actually needed, and populate a per-channel `lastDiscardedChange` (scale explicitly marked `gotVerified: false`, since no live-scale channel field exists this round). `expectedTransform()`/`expectedScale()` selectors always derive the HUD's "expected" baseline from the last successful write.
- `useChannelReader.ts`: `parseChannelView` no longer allocates a `Float32Array` via `buf.slice()` per tick — it writes into one reused module-level buffer via `DataView.getFloat32` reads. `getRegionView` caches a single `Uint8Array` view keyed on the backing `ArrayBuffer`'s object identity, which is a genuine zero-copy technique here (confirmed by inspecting `channel_binding.cpp`'s `ReadChannelView`, which returns the SAME persistent `Napi::Reference`-backed `ArrayBuffer` every call for an open channel, not a fresh one). `decodeGuardFields` explicitly decodes `GUARD_STATUS`/`GUARD_ADDR` (no hedge); `parseChannelView` decodes `hasTarget`/`targetUnavailableOnBuild`/`scaleUnavailableOnBuild`/`focusToken`, deliberately leaving liveness bit5 undecoded (documented agent-only telemetry).
- `useLiveService.ts`'s `detachUI()` is now async: it resends `writeStop` on a ~33ms interval, polling the agent's sticky `GUARD_FLAG_STOPPING` bit, bounded by a ~750ms timeout, before closing the channel — closing the class of bug where a later drag command overtakes a single fire-and-hope STOP on the latest-wins command slot.
- `LiveInspectorPanel.tsx` gained a Detach button (visible only while attached), closing the previously-noted "no such button exists yet" gap.
- Discovered and documented a project-wide test-infrastructure gap: `vi.mock('@swg/<native-addon>', ...)` does NOT intercept a bare `require('@swg/<native-addon>')` call (confirmed via direct repro against both `@swg/live-inject` and `@swg/native-core` — the REAL, already-built native binary loads instead). Established and applied a working alternative (monkey-patch the real process-cached addon object, then dynamically `import()` the module under test) across all three new test files that exercise bare-require modules.

## Task Commits

Each task was committed atomically:

1. **Task 1: useCommandWriter.ts (TDD)** - `9c01e52` (test, RED) → `d5f4d4b` (feat, GREEN)
2. **Task 2: liveStore/useLiveService/LiveInspectorPanel/contracts** - `c5c6390` (feat)
3. **Task 3: useChannelReader.ts (TDD)** - `a208b10` (test, RED) → `4b3d7bc` (feat, GREEN)

**Plan metadata:** (this commit, see final_commit below)

_Note: Tasks 1 and 3 are tdd="true" — RED (failing tests) then GREEN (implementation) as two separate commits, per project TDD convention. Task 1's GREEN commit also amended the RED test's mocking strategy (see Deviations) since the original approach failed for a reason unrelated to the missing implementation._

## TDD Gate Compliance

RED gates: `9c01e52` (Task 1), `a208b10` (Task 3).
GREEN gates: `d5f4d4b` (Task 1), `4b3d7bc` (Task 3) — both follow their respective RED commits in the expected order.
No REFACTOR commits were needed for either TDD task.

## Files Created/Modified
- `packages/renderer/src/hooks/useCommandWriter.ts` - New: zero-alloc writeTransform/writeStop/writeRebaselineGuard
- `packages/renderer/src/hooks/useCommandWriter.test.ts` - New: buffer-reuse identity + flags pass-through tests
- `packages/contracts/src/live-inject.ts` - VerifiedObjectState gains hasTarget/targetUnavailableOnBuild/scaleUnavailableOnBuild/focusToken
- `packages/renderer/src/state/liveStore.ts` - identityCache per-focusToken cache, gate-on-blocked coalesced revert, expected*/guardAddr
- `packages/renderer/src/state/liveStore.test.ts` - New: 15 tests covering the identity cache, revert gating, and disclosure contracts
- `packages/renderer/src/hooks/useLiveService.ts` - detachUI async bounded stop-retry loop
- `packages/renderer/src/hooks/useLiveService.test.ts` - New: retry/acknowledge/timeout behavior tests
- `packages/renderer/src/panels/LiveInspectorPanel.tsx` - New Detach button
- `packages/renderer/src/panels/LiveInspectorPanel.test.tsx` - New: Detach button visibility + click wiring tests
- `packages/renderer/src/hooks/useChannelReader.ts` - Zero-alloc parseChannelView/getRegionView, guard/focusToken decode
- `packages/renderer/src/hooks/useChannelReader.test.ts` - New: 12 tests covering allocation identity, seqlock, and all new field decodes

## Decisions Made
See `key-decisions` in the frontmatter above (identityCache keying, cross-check-on-HIT, bounded LRU, writeLog truncation semantics, scale fallback, detachUI async signature).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected the RED test's addon-mocking strategy after discovering vi.mock does not intercept bare require() of a native addon**
- **Found during:** Task 1 (GREEN attempt) — running the RED test against the newly-written `useCommandWriter.ts` implementation still failed, but with the REAL native addon's `"writeCommand: channel not open — call openChannel first"` error instead of the expected mock assertions.
- **Issue:** `vi.mock('@swg/live-inject', () => ({ writeCommand: vi.fn() }))` does not intercept a bare `require('@swg/live-inject')` call inside the module under test — the already-built, real `.node` addon loads instead (confirmed by a minimal repro script showing the same behavior for both `@swg/live-inject` and `@swg/native-core`, meaning this is a project-wide gap, not specific to this file). This blocked the test from ever reaching its own assertions.
- **Fix:** Require the REAL (process-cached, singleton) addon object directly at the top of the test file and monkey-patch its `writeCommand` property with a `vi.fn()` BEFORE the module under test is loaded, via a dynamic `import()` inside `beforeAll` (rather than a static top-level `import`, which would be hoisted above the patch). Applied the same technique in `useLiveService.test.ts` and `useChannelReader.test.ts`'s design (though the latter tests pure exported functions directly and never needed the addon at all).
- **Files modified:** packages/renderer/src/hooks/useCommandWriter.test.ts
- **Verification:** All 6 tests pass against the real implementation; the full 411/423-test renderer suite has no regressions.
- **Committed in:** `d5f4d4b` (Task 1 GREEN commit, since the test fix and the implementation together constitute reaching a genuine GREEN state)

**2. [Rule 2 - Missing Critical] Added test files not listed in the plan's `files_modified` frontmatter**
- **Found during:** All three tasks — the plan's acceptance criteria explicitly mandate specific unit tests (buffer-reuse identity, per-identity cache behavior, revert-gating disclosure, detachUI retry timing, Detach button visibility, zero-allocation read-path proofs) that did not exist before this plan and are not covered by any pre-existing test file.
- **Issue:** Skipping these tests would leave the plan's own acceptance criteria — and Tasks 1/3's `tdd="true"` designation — unverified by anything beyond code review.
- **Fix:** Created `useCommandWriter.test.ts`, `liveStore.test.ts`, `useLiveService.test.ts`, `LiveInspectorPanel.test.tsx`, and `useChannelReader.test.ts`, covering every acceptance-criteria bullet in the plan.
- **Files modified:** the five test files listed under `key-files.created` above
- **Verification:** `npx vitest run` in packages/renderer — 55 test files, 423 tests, all passing; `tsc --noEmit -p .` clean.
- **Committed in:** split across `9c01e52`/`d5f4d4b` (Task 1), `c5c6390` (Task 2), `a208b10`/`4b3d7bc` (Task 3)

---

**Total deviations:** 2 auto-fixed (1 blocking test-infrastructure fix, 1 missing-critical test coverage)
**Impact on plan:** Both were necessary to reach a genuine, verifiable GREEN state and to satisfy the plan's own literal acceptance criteria. No scope creep — the mocking-strategy fix is a test-authoring correction with zero production-code impact; the added tests directly implement what the plan's acceptance criteria already specified in prose.

## Issues Encountered

The `@swg/live-inject` native addon build from prior plans (05-01/05-03/05-04) was already present on disk (`build/Release/swg_live_inject.node`), which is what caused the RED test's naive `vi.mock` approach to silently load real code instead of failing loudly with a "module not found" error — the discovery only surfaced once a real, sensible-looking error message ("channel not open") appeared during the GREEN attempt. No other issues; `@swg/contracts` was rebuilt (`pnpm --filter @swg/contracts build`) after the `VerifiedObjectState` type change to keep `dist/` in sync, though this has no runtime effect on the vitest suite (TypeScript interfaces are erased at transform time).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The renderer now has a complete, allocation-honest write/read loop: `useCommandWriter.ts` (write), `useChannelReader.ts` (read), and `liveStore.ts` (the per-identity COW/write-log/guard-state model) are all ready for 05-10 (gizmo drag handler calling `writeTransform` directly) and 05-11 (HUD consuming `expectedTransform()`/`expectedScale()`/`lastDiscardedChange`/`hasTarget`/`targetUnavailableOnBuild`/`scaleUnavailableOnBuild`/`guardAddr`).
- The native-addon test-mocking gap (vi.mock does not intercept bare `require()`) is now a documented, working pattern (monkey-patch + dynamic import) any future plan testing `useLiveService.ts`/`useChannelReader.ts`-style modules can reuse directly — worth calling out explicitly if a future phase's plan-checker or reviewer flags "why isn't this using vi.mock" on a similar file.
- No blockers. Full renderer test suite (423 tests across 55 files) and `tsc --noEmit` both green.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*

## Self-Check: PASSED

All created/modified files verified present on disk; all five task commit hashes (9c01e52, d5f4d4b, c5c6390, a208b10, 4b3d7bc) verified present in git log.
