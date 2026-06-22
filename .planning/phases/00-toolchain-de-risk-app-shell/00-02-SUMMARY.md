---
phase: 00-toolchain-de-risk-app-shell
plan: 02
subsystem: infra
tags: [cmake-js, node-addon-api, napi, native-addon, prebuildify, node-gyp-build, vitest, tdd, fnd-02]

# Dependency graph
requires:
  - phase: 00-01
    provides: pnpm workspace, contracts/ types, test harness, check-prereqs preflight, Vite/Electron-Forge scaffold

provides:
  - cmake-js C++ Node-API addon (hello + allocateSab) built with NAPI_EXPERIMENTAL on Windows MSVC
  - prebuildify + node-gyp-build single-resolver distribution path (FND-02 no-compiler path)
  - Non-circular FND-02 proof: build/ moved aside, addon asserted to load from prebuilds/ only
  - TypeScript type declarations (index.d.ts) for both exports
  - Passing TDD suite (8 unit tests + 5 non-circular proof tests)
  - Established pattern: one --napi prebuild is ABI-stable across Node AND Electron (no separate Electron-ABI build)

affects:
  - 00-03 (utility-process loads @swg/native-core via the same index.js resolver)
  - 00-05 (Plan 05 packaged hard gate certifies the RUNTIME LOAD of this single --napi artifact in the real Electron binary)
  - Phase 1 (CMakeLists.txt seeded for Phase 1 C++ expansion; pattern established)

# Tech tracking
tech-stack:
  added:
    - cmake-js 8.0.0 (C++ addon build driver, with --generator "Visual Studio 17 2022" --platform x64 pin)
    - node-addon-api ^8.8.0 (C++ N-API wrapper, C++17 required for std::string_view)
    - node-gyp-build ^4 (single-resolver for prebuilds/ layout)
    - prebuildify (prebuilds/ layout production via cmake-js build + copy script)
  patterns:
    - "TDD RED->GREEN->PROOF: write failing tests first, build to pass, then add non-circular distribution proof"
    - "Single N-API prebuild (--napi): one prebuilds/<platform>-<arch>/@swg+native-core.node serves Node + Electron (ABI-stable)"
    - "Non-circular distribution proof: move build/ aside, assert __resolvedPath contains 'prebuilds', restore build/ in finally"
    - "cmake-js generator pin: cmake-js 8.0.0 mis-detects VS2026 (MSVC major 18); always pin --generator + --platform in scripts"
    - "NAPI_EXPERIMENTAL required: Napi::SharedArrayBuffer is experimental-gated; must define alongside NAPI_VERSION=8"

key-files:
  created:
    - packages/native-core/CMakeLists.txt
    - packages/native-core/src/addon.cpp
    - packages/native-core/src/hello.cpp
    - packages/native-core/src/sab.cpp
    - packages/native-core/index.js
    - packages/native-core/index.d.ts
    - packages/native-core/test/hello.test.ts
    - packages/native-core/test/resolve-prebuild.test.ts
  modified:
    - packages/native-core/package.json (added prebuild script, cmake-js scripts with generator pin)

key-decisions:
  - "Single --napi prebuild is ABI-stable across Node AND Electron; no separate Electron-ABI build required (round-3 / Cursor CUR-1)"
  - "cmake-js generator pinned to 'Visual Studio 17 2022' + x64 to work around cmake-js 8.0.0 mis-detecting VS2026"
  - "CMAKE_CXX_STANDARD 17 required for node-addon-api 8 (std::string_view)"
  - "FND-02 non-circular proof: build/ moved aside before re-require, __resolvedPath asserted; full no-compiler-machine proof deferred to CI"
  - "Built against Node v24.15.0 headers; compile-against-Electron-42-headers check deferred to Plan 05 packaged gate"
  - "NAPI_EXPERIMENTAL is REQUIRED for Napi::SharedArrayBuffer::New (ground truth — RESEARCH Pitfall 4)"

patterns-established:
  - "Pattern: cmake-js build -> copy .node into prebuilds/<plat>-<arch>/ layout -> node-gyp-build is the single resolver"
  - "Pattern: non-circular distribution proof via build/ rename + __resolvedPath assertion + afterAll restore"
  - "Pattern: three C++ source files (hello.cpp, sab.cpp, addon.cpp) seeded for Phase 1 expansion"

requirements-completed:
  - FND-02

# Metrics
duration: continuation (Tasks 1-4 in prior session; checkpoint verified independently)
completed: 2026-06-22
---

# Phase 0 Plan 02: cmake-js N-API Addon + Non-Circular FND-02 Distribution Proof Summary

**cmake-js C++ addon (hello + allocateSab with NAPI_EXPERIMENTAL) built on Windows MSVC, distributed via a single ABI-stable --napi prebuild resolved by node-gyp-build, with non-circular proof that the addon loads from prebuilds/ when build/ is absent**

## Performance

- **Duration:** Continuation plan — Tasks 1-4 committed in prior session; checkpoint resolved and summary written 2026-06-22
- **Started:** Prior session (Tasks 1-4)
- **Completed:** 2026-06-22
- **Tasks:** 5 (4 implementation + 1 human-verify checkpoint — PASSED)
- **Files modified:** 8 created, 1 modified

## Accomplishments

- cmake-js builds `swg_native_core.node` with MSVC v143/v145 using ALL required compile definitions: `NAPI_EXPERIMENTAL`, `NAPI_VERSION=8`, `NAPI_DISABLE_CPP_EXCEPTIONS`
- FND-02 no-compiler distribution path wired: `prebuilds/win32-x64/@swg+native-core.node` resolved by `node-gyp-build` via `index.js` (single source of truth — no second resolver)
- Non-circular FND-02 proof: `build/` moved aside (`build.bak`), addon re-required, `__resolvedPath` asserted to contain `'prebuilds'` (not `'build/Release'`), `build/` restored in `afterAll/finally`
- TDD cycle complete: 8/8 unit tests GREEN (hello + allocateSab), 5/5 non-circular proof tests GREEN
- Human checkpoint (Task 5) passed with independent evidence from orchestrator

## Task Commits

1. **Task 1: RED — failing tests for hello() and allocateSab()** — `6e1f155` (test)
2. **Task 2: GREEN — cmake-js addon C++ (NAPI_EXPERIMENTAL) + build** — `bbc640e` (feat)
3. **Task 3: GREEN — prebuildify + node-gyp-build distribution (FND-02)** — `9b79bfa` (feat)
4. **Task 4: PROOF — non-circular FND-02 distribution proof** — `ca3d6ec` (test)

**Plan metadata:** `[docs commit — see below]`

## Files Created/Modified

- `packages/native-core/CMakeLists.txt` — cmake-js build definition; NAPI_EXPERIMENTAL + NAPI_VERSION=8 + NAPI_DISABLE_CPP_EXCEPTIONS; Phase 1 expansion comment seeded
- `packages/native-core/src/addon.cpp` — NODE_API_MODULE registration; exports hello + allocateSab
- `packages/native-core/src/hello.cpp` — `Hello()` returns `Napi::String::New(env, "pong")`
- `packages/native-core/src/sab.cpp` — `AllocateSab()` returns `Napi::SharedArrayBuffer::New(env, byteLength)`; validates `info.Length() >= 1`
- `packages/native-core/index.js` — `require('node-gyp-build')(__dirname)` resolver; exposes `__resolvedPath` via `node-gyp-build.resolve(__dirname)` for non-circular proof
- `packages/native-core/index.d.ts` — TypeScript declarations: `hello(): string`, `allocateSab(byteLength: number): SharedArrayBuffer`, `__resolvedPath: string`
- `packages/native-core/test/hello.test.ts` — 8 Vitest unit tests (hello + allocateSab, including 0xDEAD sentinel round-trip and zero-length SAB edge case)
- `packages/native-core/test/resolve-prebuild.test.ts` — 5 Vitest tests; moves `build/` to `build.bak`, re-requires `index.js`, asserts `__resolvedPath` contains `'prebuilds'`, restores `build/` in `afterAll/finally`
- `packages/native-core/package.json` — added `prebuild` script (cmake-js build + copy to prebuilds/ layout); cmake-js scripts with `--generator "Visual Studio 17 2022" --platform x64` pin

## Decisions Made

- **Single --napi prebuild serves Node AND Electron:** Because this is a pure N-API addon (`NODE_API_MODULE` + `NAPI_VERSION=8`), N-API ABI stability means ONE `prebuilds/win32-x64/@swg+native-core.node` artifact loads in bare Node/Vitest AND in Electron's utility process — there is NO separate Electron-ABI build (round-3 / Cursor CUR-1). `@electron/rebuild` was NOT required and is an optional fallback only.
- **cmake-js generator pinned:** cmake-js 8.0.0 mis-detects VS2026 (MSVC major 18, not yet supported by CMake 3.31.6's "Visual Studio 18 2026" generator). Fixed by pinning `--generator "Visual Studio 17 2022" --platform x64` in all build/rebuild scripts. The MSVC compiler (`cl.exe`) itself was present and working; the issue was the CMake generator name only.
- **CMAKE_CXX_STANDARD 17 required:** node-addon-api 8 uses `std::string_view` which requires C++17. Added to `CMakeLists.txt`.
- **NAPI_EXPERIMENTAL is REQUIRED:** Confirmed ground truth (RESEARCH Pitfall 4). `Napi::SharedArrayBuffer::New` is gated behind `#ifdef NODE_API_EXPERIMENTAL_HAS_SHAREDARRAYBUFFER` which is only defined when `NAPI_EXPERIMENTAL` is set. `NAPI_VERSION=8` alone does NOT compile the SAB symbol.
- **FND-02 honest scope:** Resolution path proven non-circular on this machine (build/ moved aside, loaded from prebuilds/, `__resolvedPath` asserted). Full no-compiler-machine proof (no MSVC on PATH at all) is DEFERRED to a toolchain-free CI runner.
- **Built against Node v24.15.0 headers:** The cmake-js build used Node v24.15.0 embedded headers, NOT Electron 42's embedded Node headers. The compile-against-Electron-42-headers check (round-3 / Cursor CUR-3) is NOT complete on this machine; the runtime check is deferred to Plan 05's packaged gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] cmake-js generator mis-detection (VS2026 / MSVC major 18)**
- **Found during:** Task 2 (cmake-js build step)
- **Issue:** cmake-js 8.0.0 detected the installed VS as "Visual Studio 18 2026" (major 18) — a generator CMake 3.31.6 does not know. Build failed with CMake generator error.
- **Fix:** Pinned `--generator "Visual Studio 17 2022" --platform x64` in the `build`, `rebuild`, and `prebuild` npm scripts in `packages/native-core/package.json`. Added `CMAKE_CXX_STANDARD 17` to `CMakeLists.txt` (node-addon-api 8 requires C++17 for `std::string_view`).
- **Files modified:** `packages/native-core/package.json`, `packages/native-core/CMakeLists.txt`
- **Committed in:** `bbc640e` (Task 2 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug, cmake-js generator mis-detection)
**Impact on plan:** Required fix; the MSVC toolchain itself was present and functional. The fix is a one-line generator pin in package.json scripts. No scope change.

## Checkpoint Record

**Task 5 — Native build + non-circular distribution review: PASSED**

Evidence independently collected by orchestrator (re-ran commands after human approval):
- Build artifact `packages/native-core/build/Release/swg_native_core.node` present
- `prebuilds/win32-x64` directory present containing `@swg+native-core.node`
- `CMakeLists.txt` defines `NAPI_EXPERIMENTAL` + `NAPI_VERSION=8` + `NAPI_DISABLE_CPP_EXCEPTIONS`; no `binding.gyp`; no `nan.h`
- `pnpm vitest run packages/native-core/test/hello.test.ts` => 8/8 PASS
- `pnpm vitest run packages/native-core/test/resolve-prebuild.test.ts` => 5/5 PASS (loaded from `prebuilds/` with `build/` moved aside; `__resolvedPath = D:\Code\SWG-Toolkit\packages\native-core\prebuilds\win32-x64\@swg+native-core.node`, contains `'prebuilds'`, not `'build/Release'`; `build/` restored)

## FND-02 Scope Statement (for Plan 05 Nyquist sign-off)

The following is the exact scope statement that Plan 05 Task 4 (Nyquist sign-off) MUST cite — no proxy certification:

1. **Resolution path is non-circular:** `build/` moved aside, addon loaded, `__resolvedPath` asserted to contain `'prebuilds'` (not `'build/Release'`). Proven on this machine.
2. **Single --napi prebuild is ABI-stable across Node AND Electron:** One `prebuilds/win32-x64/@swg+native-core.node` artifact. No separate Electron-ABI build. `@electron/rebuild` not required.
3. **Full no-compiler-machine proof DEFERRED:** A fresh machine with no MSVC/compiler at all was NOT tested in Phase 0. Belongs on a toolchain-free CI runner.
4. **Packaged-Electron RUNTIME LOAD deferred to Plan 05:** The packaged hard gate in Plan 05 (via `package:ci` / `PACKAGED_EXE_PATH`) certifies that the same single --napi artifact loads correctly in the real Electron binary's utility process. Plan 05 Task 4 must certify ONLY: "resolution path non-circular + packaged-Electron RUNTIME LOAD of the single ABI-stable --napi prebuild via the packaged gate" — not "full no-compiler proof."
5. **Electron-42 Node-header NAPI_EXPERIMENTAL check (CUR-3):** The compile-against-Electron-42-embedded-headers check was NOT performed on this machine (cmake-js used Node v24.15.0 headers). This compile-time risk is deferred to the Plan 05 gate.

## Verification Block Results (all 11 checks)

| Check | Command | Result |
|-------|---------|--------|
| 1 | `ls packages/native-core/build/Release/swg_native_core.node` | PASS — file present |
| 2 | `ls -d packages/native-core/prebuilds/*` | PASS — `win32-x64` directory present |
| 3 | `grep "node-gyp-build" index.js` + `grep "__resolvedPath" index.js` | PASS — both present |
| 4 | `pnpm vitest run hello.test.ts` | PASS — 8/8 tests green |
| 5 | `pnpm vitest run resolve-prebuild.test.ts` | PASS — 5/5 tests green (non-circular) |
| 6 | `grep "NAPI_EXPERIMENTAL" CMakeLists.txt` | PASS — line present |
| 7 | `grep "NAPI_VERSION=8" CMakeLists.txt` | PASS — line present |
| 8 | `grep "NAPI_DISABLE_CPP_EXCEPTIONS" CMakeLists.txt` | PASS — line present |
| 9 | `ls packages/native-core/binding.gyp 2>/dev/null && echo FAIL \|\| echo OK` | PASS — OK (no binding.gyp) |
| 10 | `grep -r "nan.h\|NAN_" packages/native-core/src/` | PASS — no matches |
| 11 | `cat packages/native-core/index.d.ts` | PASS — `hello(): string` and `allocateSab(byteLength: number): SharedArrayBuffer` declared |

All 11 checks: **PASS**

## Issues Encountered

- cmake-js 8.0.0 mis-detection of VS2026 generator (see Deviations). Resolved by generator pin.
- Node v24.15.0 headers used for build (not Electron 42 embedded headers) — documented as deferred risk for Plan 05.

## User Setup Required

None — no external service configuration required. The cmake-js build requires MSVC v143/v145 toolset on the build machine; distribution via `prebuilds/` requires no compiler on end-user machines.

## Next Phase Readiness

- `packages/native-core` is ready for Plan 03 consumption: `require('@swg/native-core')` in the utility process resolves via `index.js → node-gyp-build → prebuilds/win32-x64/@swg+native-core.node`
- Plan 03 (Electron security, COOP/COEP, utility-process IPC, SAB pipeline) is unblocked
- CMakeLists.txt seeded with Phase 1 expansion comment (`# Phase 1: add_subdirectory(modules/core) when TRE/IFF C++ lands`)
- **Carry-forward dependency:** Plan 05 packaged hard gate must certify the RUNTIME LOAD of the single --napi prebuild artifact in the real Electron binary and the non-circular resolution path — see FND-02 Scope Statement above

## Self-Check

### Files
- `packages/native-core/build/Release/swg_native_core.node` — FOUND
- `packages/native-core/prebuilds/win32-x64` — FOUND
- `packages/native-core/index.js` — FOUND
- `packages/native-core/index.d.ts` — FOUND
- `packages/native-core/test/hello.test.ts` — FOUND
- `packages/native-core/test/resolve-prebuild.test.ts` — FOUND
- `packages/native-core/CMakeLists.txt` — FOUND
- `packages/native-core/src/addon.cpp` — FOUND
- `packages/native-core/src/hello.cpp` — FOUND
- `packages/native-core/src/sab.cpp` — FOUND

### Commits
- `6e1f155` — FOUND (test(00-02): RED — failing tests)
- `bbc640e` — FOUND (feat(00-02): cmake-js addon C++)
- `9b79bfa` — FOUND (feat(00-02): prebuildify + node-gyp-build distribution)
- `ca3d6ec` — FOUND (test(00-02): non-circular FND-02 proof)

## Self-Check: PASSED

---
*Phase: 00-toolchain-de-risk-app-shell*
*Completed: 2026-06-22*
