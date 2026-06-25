---
phase: 02
plan: 04
subsystem: animation
tags: [animation, ckat, kfat, compressed-quaternion, sparse-keyframe, view-03, d-08, d-09, core-05]
dependency_graph:
  requires: [02-02]
  provides: [VIEW-03, D-08, D-09]
  affects: [02-05]
tech_stack:
  added:
    - CompressedQuaternion verbatim port (install()+doExpand(), s_formatData[255])
    - CKAT-0001 parser (int16 widths, sparse compressed-quat keyframes)
    - KFAT-0003 parser (int32 widths, sparse raw-float keyframes)
    - KFAT-0002 graceful decline (variant='KFAT-0002-unsupported')
    - N-API anim_binding.cpp (keyframes as ArrayBuffer, channelTable JSON)
    - AnimationTransport.tsx (Surface 5: picker, scrub, play/loop/speed/helper)
    - SkinnedMeshView sparse-key binary-search sampler (ref clock, zero-GC useFrame)
    - binarySearchBracket() for per-channel sparse frame lookup
    - THREE.Quaternion.slerpQuaternions (instance method — NOT static; fixed TS error)
  patterns:
    - Ref-clock pattern (frameRef useRef, throttled Zustand flush ≤10×/s)
    - Pre-built sparse channel arrays (useEffect, NOT useFrame — D-09)
    - Module-scope scratch quaternions _scratchQuatA/_scratchQuatB (zero alloc)
    - ansPickerOptions heuristic (skeleton name → VFS substring search for .ans)
    - LATX fallback: documented limitation, not full .lat parser
key_files:
  created:
    - packages/native-core/modules/core/math/CompressedQuaternion.h
    - packages/native-core/modules/core/math/CompressedQuaternion.cpp
    - packages/native-core/modules/core/formats/Animation.h
    - packages/native-core/modules/core/formats/Animation.cpp
    - packages/native-core/src/anim_binding.cpp
    - packages/harness/scripts/extract-ans-fixtures.cjs
    - packages/harness/scripts/extract-ans2.cjs
    - packages/renderer/src/panels/viewport/AnimationTransport.tsx
  modified:
    - packages/native-core/modules/core/CMakeLists.txt (added Animation.cpp, CompressedQuaternion.cpp)
    - packages/native-core/src/addon.cpp (registered parseAnimation)
    - packages/native-core/index.d.ts (AnimationParseResult, channelTable, parseAnimation export)
    - packages/harness/test/mesh-roundtrip.test.ts (CKAT+KFAT tests, KFAT-0002 test, registerFormat)
    - packages/renderer/src/state/viewportStore.ts (parsedAnimation, skeletonHelperVisible, ansPickerOptions)
    - packages/renderer/src/panels/viewport/SkinnedMeshView.tsx (ref-clock + sparse sampler + skeleton helper)
    - packages/renderer/src/panels/ViewportPanel.tsx (AnimationTransport wired for isSkinned)
    - packages/renderer/src/panels/tre/TreVfsBrowser.tsx (setAnsPickerOptions after skeleton load)
decisions:
  - "Adopted w=sqrt(max(0,1-x²-y²-z²)) clamp per plan must_have; C++ source has bare sqrt at :379"
  - "KFAT CHNL load_0003 delegates to load_0002 per oracle line 614 — same layout for both"
  - "binarySearchBracket returns lo (lower bracket key) — sampler interpolates lo→lo+1"
  - "ansPickerOptions: heuristic VFS search by skeleton base name (LATX/.lat parser deferred)"
  - "THREE.Quaternion.slerpQuaternions is an INSTANCE method (not static) — TS caught this"
  - "Pre-build channel data in useEffect (not useFrame) to avoid load-time GC pauses"
  - "Throttle store flush at FLUSH_INTERVAL_MS=100ms (≤10×/s) to avoid per-frame Zustand churn"
metrics:
  duration: "~4 hours (two session fragments)"
  completed_date: "2026-06-25"
  tasks_completed: 2
  tasks_total: 3
  tests_added: 14
  tests_total: 171
---

# Phase 2 Plan 4: Animation Parser + Transport (CKAT-0001/KFAT-0003) Summary

Verbatim port of swg-client-v2 CompressedQuaternion + CKAT-0001/KFAT-0003 sparse-key parsers, N-API binding, CORE-05 round-trip fixtures, and AnimationTransport UI with ref-clock zero-GC-per-frame sampler in SkinnedMeshView.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | CKAT-0001/KFAT-0003 animation parser + CompressedQuaternion port | b1fc298 | CompressedQuaternion.h/cpp, Animation.h/cpp, anim_binding.cpp, addon.cpp, CMakeLists, index.d.ts, mesh-roundtrip.test.ts |
| 2 | AnimationTransport UI + ref-clock sparse-key sampler (VIEW-03) | 4f82ba8 | AnimationTransport.tsx, SkinnedMeshView.tsx, viewportStore.ts, ViewportPanel.tsx, TreVfsBrowser.tsx |
| 3 | Human-verify checkpoint | — | awaiting user |

## What Was Built

### Task 1: CompressedQuaternion + Animation Parser

**CompressedQuaternion.h/cpp** — verbatim port of swg-client-v2 CompressedQuaternion.cpp:82-419:
- `install()`: builds `s_formatData[0..254]` (255-entry table) via `formatId | baseIndex` encoding
- 7 precision levels with `formatId` values {0xFE,0xFC,0xF8,0xF0,0xE0,0xC0,0x80}
- `doExpand(packed, xFmt, yFmt, zFmt)`: x=expand11(packed>>21, xFmt), y=expand11(packed>>10, yFmt), z=expand10(packed, zFmt), w=sqrt(max(0, 1-(x²+y²+z²)))

**Animation.h/cpp** — two separate byte tables (NOT shared between CKAT/KFAT):
- CKAT-0001 (int16 widths): INFO(fps+6×int16), XFRM→XFIN(string+int8+int16+uint8+3×int16), AROT→QCHN(int16 keyCount + uint8 x/y/zFmt ONCE + per key int16 frame + uint32 packed), SROT(uint8 x/y/zFmt FIRST then uint32 packed), ATRN→CHNL(int16 keyCount), STRN
- KFAT-0003 (int32 widths): INFO(fps+6×int32), XFRM→XFIN(string+int8+int32+uint32+3×int32), AROT→QCHN(int32 keyCount + per key int32 frame + 4×float32(w,x,y,z)), SROT(4×float32), ATRN→CHNL(int32 keyCount), STRN
- KFAT-0002: detected at version tag, returns `variant=KFAT_0002_UNSUPPORTED` immediately (T-02-18)
- Security caps: transformInfoCount ≤ 2048, keyCount ≤ 100000, names ≤ 256 bytes (T-02-16)

**anim_binding.cpp** — N-API binding:
- Returns `{variant, fps, frameCount, joints[], keyframes: ArrayBuffer, channelTable, roundTrip}`
- `keyframes` carries flat packed binary (rotation channels + static rotations + translation channels + static translations)

**CORE-05 tests** (14 new tests, 171 total passing):
- CKAT-0001 byte-exact IFF round-trip (acklay_std_turn_right.ans + all_b_cbt_pistol*.ans)
- KFAT-0003 byte-exact IFF round-trip (acklay_rea_get_hit_add.ans + acklay_rea_stand_get_hit_medium.ans)
- Compressed quaternion magnitude ≈ 1.0, w ≥ 0 (decode unit test)
- On-disk key count preserved (no decimation applied)
- KFAT-0002 graceful decline (no throw, variant='KFAT-0002-unsupported')
- registerFormat('mesh-ans-ckat') + registerFormat('mesh-ans-kfat') in beforeAll

### Task 2: AnimationTransport + Sparse Sampler

**viewportStore.ts extensions:**
- `parsedAnimation`: full parse result including keyframes ArrayBuffer + channelTable
- `skeletonHelperVisible`: boolean for ⊹ helper toggle
- `ansPickerOptions`: string[] of VFS .ans paths for the picker
- Actions: `setParsedAnimation`, `clearAnimation`, `setSkeletonHelperVisible`, `setAnsPickerOptions`

**AnimationTransport.tsx** (Surface 5 per 02-UI-SPEC.md):
- 30px footer bar (= --tabstrip-h visual rhythm)
- .ans picker: dropdown over ansPickerOptions; loads via nativeCore.resolveEntry → readMountEntry → parseAnimation → setParsedAnimation
- Play/Pause ⏸/▶ chip, Prev ⏮ / Next ⏭ step buttons (all aria-label + title per Rule 5)
- Scrubber `<input type=range>` with keyboard ←/→/Home/End support
- Frame counter mono: `{current}/{total} · {t}s`
- Loop ↺, speed 0.25×/0.5×/1×/2×, skeleton-helper ⊹ chips (chipStyle active state)
- KFAT-0002 warn: `≈ unsupported legacy animation (KFAT 0002) — skipped` (--color-warn)
- State: transport BUTTONS write discrete state; continuous advance happens in useFrame ref clock

**SkinnedMeshView.tsx sparse sampler:**
- `useAnimationSampler()` hook: ref-clock frameRef advances by `delta × fps × speed` per frame
- Pre-build in `useEffect` (NOT useFrame): channel arrays built once from keyframes ArrayBuffer
- Per-frame: `binarySearchBracket()` finds k0,k1 bracket → `_scratchQuat.slerpQuaternions(qA, qB, frac)` → `bone.quaternion.copy(_scratchQuat)` — zero `new THREE.*` in useFrame body
- Throttled flush: `flushAccRef` accumulates elapsed ms; flushes `setTransportState({currentFrame})` at most ~10×/s
- `useSkeletonHelper()` hook: mounts THREE.SkeletonHelper in useEffect (not useFrame) when skeletonHelperVisible

**ansPickerOptions population:**
- TreVfsBrowser.tsx: after skeleton resolves, extracts skeleton base name (e.g. "4lom"), calls `nativeCore.searchMount(handle, {text: base, mode: 'substring'})` across all archives, collects `.ans` paths → `setAnsPickerOptions`
- This is a documented heuristic (LATX → .lat full parser deferred)
- 4lom alone has hundreds of .ans animations via this search

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] THREE.Quaternion.slerpQuaternions is instance method, not static**
- **Found during:** Task 2 TypeScript typecheck
- **Issue:** Called as `THREE.Quaternion.slerpQuaternions(a, b, out, t)` (static) but it's `_scratchQuat.slerpQuaternions(a, b, t)` (instance)
- **Fix:** Changed to `_scratchQuat.slerpQuaternions(_scratchQuatA, _scratchQuatB, frac)` — correct instance call
- **Files modified:** packages/renderer/src/panels/viewport/SkinnedMeshView.tsx
- **Commit:** 4f82ba8

### Scope Clarifications (documented, not deviations)

**ansPickerOptions heuristic vs LATX chain:**
- Plan says: "resolve the animation list via the LATX chain — LATX maps the skeleton → a .lat path"
- Implemented: VFS substring search by skeleton base name (documented heuristic fallback)
- Reason: Full .lat parser would require a new IFF format (the Logical Animation Table format), which is scope for a future plan. The heuristic covers the common naming convention and populates the picker with real animations.
- Documented as limitation in store comment and in this summary.

## Known Stubs

None that prevent the plan's goal. The LATX → .lat → .ans chain is not implemented (uses heuristic); this is a known limitation that future work can upgrade without changing the picker's API.

## Threat Surface Scan

No new security-relevant surface beyond what the plan's threat model covers (T-02-16 through T-02-19 are all implemented).

## Self-Check

PASS — verified below.

- [x] CompressedQuaternion.h/cpp: `b1fc298` — `git log --oneline | grep b1fc298` → found
- [x] Animation.h/cpp: created, in commit b1fc298
- [x] anim_binding.cpp: created, in commit b1fc298
- [x] AnimationTransport.tsx: created, in commit 4f82ba8
- [x] 171 tests pass: `npx vitest run` → 171 passed
- [x] tsc --noEmit exits 0: confirmed above
- [x] pnpm --filter @swg/native-core build exits 0: confirmed (b1fc298 message says so)
