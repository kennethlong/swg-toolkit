---
phase: 03-live-injection-foundation
plan: "01"
subsystem: live-inject
tags: [scaffold, wave-0, tdd, contracts, cpp, cmake]
dependency_graph:
  requires: []
  provides:
    - "@swg/live-inject workspace package"
    - "packages/live-inject/CMakeLists.txt (host x64 N-API addon)"
    - "packages/live-inject/agent/CMakeLists.txt (plain Win32 DLL x86)"
    - "packages/contracts/src/live-inject.ts (LIVE_CHANNEL_LAYOUT, ENGINE_ENDPOINT_NAMES, VerifiedObjectState, LiveIpcMessage)"
    - "Wave-0 RED test stubs (resolve, sentinels, channel-layout, handle)"
  affects:
    - packages/contracts (new live-inject.ts export)
    - packages/harness/fixtures-real/live/ (new fixture dir)
tech_stack:
  added: []
  patterns:
    - "cmake-js host x64 N-API addon (no format-tower deps)"
    - "plain Win32 x86 DLL via separate cmake invocation"
    - "pnpm workspace package with hoisted vitest (no workspace:* ref)"
    - "local vitest.config.ts per package to resolve CWD root issue"
    - "TDD Wave-0 RED stubs with expect(true).toBe(false)"
key_files:
  created:
    - packages/live-inject/CMakeLists.txt
    - packages/live-inject/cmake-js.json
    - packages/live-inject/package.json
    - packages/live-inject/vitest.config.ts
    - packages/live-inject/src/addon.cpp
    - packages/live-inject/src/inject_binding.cpp
    - packages/live-inject/src/procmem_binding.cpp
    - packages/live-inject/src/channel_binding.cpp
    - packages/live-inject/agent/CMakeLists.txt
    - packages/live-inject/agent/agent_main.cpp
    - packages/live-inject/agent/resolve.h
    - packages/live-inject/agent/resolve.cpp
    - packages/live-inject/agent/rva_table.cpp
    - packages/live-inject/agent/sentinels.h
    - packages/live-inject/agent/sentinels.cpp
    - packages/live-inject/agent/channel.cpp
    - packages/contracts/src/live-inject.ts
    - packages/harness/fixtures-real/live/.gitkeep
    - packages/live-inject/test/resolve.test.ts
    - packages/live-inject/test/sentinels.test.ts
    - packages/live-inject/test/channel-layout.test.ts
    - packages/live-inject/test/handle.test.ts
  modified:
    - packages/contracts/src/index.ts
    - pnpm-lock.yaml
decisions:
  - "D-01 confirmed: agent/ is OUR own injected x86 DLL (option A) — never loads/wraps UtinniCore.dll"
  - "vitest workspace:* invalid for root devDeps; use hoisted vitest with local vitest.config.ts per package"
  - "Test files use .test.ts extension (project convention) not .spec.ts (plan spec was incorrect)"
  - "TRANSFORM.length = 48 locked by passing test from day 1 (channel-layout.test.ts)"
  - "x86 MSVC toolset: PRESENT on both VS 2022 (17.14) and VS 2026 (18.6)"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-26"
  tasks: 3
  files: 22
---

# Phase 03 Plan 01: Live-Inject Wave-0 Scaffold Summary

**One-liner:** packages/live-inject workspace package scaffolded with host x64 N-API CMakeLists, plain Win32 x86 agent CMakeLists, LIVE_CHANNEL_LAYOUT contracts (TRANSFORM=48 bytes, TOTAL=320), and 4 Wave-0 RED test stubs (15 failing / 2 passing sanity checks).

## Tasks Completed

| Task | Name | Commit | Key Outputs |
|------|------|--------|-------------|
| 1a | Build-config files | 42c81ba | CMakeLists.txt, cmake-js.json, package.json; pnpm workspace picks up @swg/live-inject |
| 1b | Stub C++/agent sources | 520403e | 12 stub files in src/ and agent/ |
| 2 | Contracts + RED tests | a2ce6ab | live-inject.ts, 4 test files, vitest.config.ts, fixtures-real/live/ |

## Verification Results

- `pnpm install --frozen-lockfile`: PASS (workspace recognizes @swg/live-inject)
- `pnpm --filter @swg/contracts build`: PASS (live-inject.ts compiles without TypeScript error)
- `pnpm --filter @swg/live-inject test`: 15 RED stubs (AssertionError) + 2 GREEN sanity checks
  - GREEN: `TRANSFORM.length is 48 (not 64)` — PASS from day 1
  - GREEN: `TOTAL_SIZE.length is 320` — PASS from day 1
  - RED: resolve (3 stubs), sentinels (8 stubs), seqlock round-trip (1 stub), handle (3 stubs)
- Full suite `pnpm test`: 4 new files (15 failed + 2 passed) | 17 existing files (190 passed) — no regressions
- `grep -c "live-inject" packages/contracts/src/index.ts`: 1
- `grep -c "TRANSFORM.*length.*48"` in live-inject.ts: 1 (64-byte matrix not present in code)

## x86 MSVC Toolset Status

**PRESENT** — confirmed via vswhere.

| Installation | Version | VC.Tools.x86.x64 |
|---|---|---|
| Visual Studio Community 2022 | 17.14.36915.13 | PRESENT |
| Visual Studio Community 2026 | 18.6.11819.183 | PRESENT |
| Visual Studio Build Tools 2019 | 16.11.36631.11 | PRESENT |
| Visual Studio Build Tools 2026 | 18.5.11716.220 | PRESENT |

x86 agent DLL build is unblocked. Proceed to Plan 03-02 without installing any additional VS components.

Verification command run:
```
vswhere -all -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64
→ returned 4 instances including VS 2022 (17.x) which cmake-js targets
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `vitest: "workspace:*"` is invalid for root-level devDependency**
- **Found during:** Task 1a verification (`pnpm install`)
- **Issue:** The plan specified `"vitest": "workspace:*"` in package.json devDependencies. In pnpm, `workspace:*` protocol references named workspace packages — `vitest` is a root devDependency, not a workspace package. Error: `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.
- **Fix:** Removed vitest from devDependencies entirely; vitest is available via `nodeLinker:hoisted` (same approach as @swg/harness which has empty devDependencies).
- **Files modified:** `packages/live-inject/package.json`
- **Commit:** 42c81ba

**2. [Rule 1 - Bug] Test files used `.spec.ts` extension instead of project convention `.test.ts`**
- **Found during:** Task 2 verification (`pnpm --filter @swg/live-inject test`)
- **Issue:** The plan's `files_modified` frontmatter listed `*.spec.ts` files. The workspace root `vitest.config.ts` uses `include: ['packages/*/test/**/*.test.ts']` — `.spec.ts` files are invisible to vitest.
- **Fix:** Renamed all 4 test files to use `.test.ts` extension (matching the convention of all 17 existing test files in the project).
- **Files modified:** Renamed resolve.spec.ts → resolve.test.ts, etc.
- **Commit:** a2ce6ab

**3. [Rule 3 - Blocking] `pnpm --filter @swg/live-inject test` CWD issue**
- **Found during:** Task 2 verification
- **Issue:** When pnpm runs the `test` script from `packages/live-inject/`, vitest uses that directory as root. The include pattern `packages/*/test/**/*.test.ts` (workspace root relative) resolves as `packages/live-inject/packages/*/test/**/*.test.ts` — no files found. Same pre-existing issue in `@swg/harness`.
- **Fix:** Created `packages/live-inject/vitest.config.ts` with local `include: ['test/**/*.test.ts']` and correct `@swg/contracts` alias. Tests now run correctly both via `pnpm --filter @swg/live-inject test` and `pnpm test` from workspace root.
- **Files modified:** `packages/live-inject/vitest.config.ts` (new)
- **Commit:** a2ce6ab

## TDD Gate Compliance

This plan has `tdd="true"` on Task 2. The plan combines contracts creation (implementation) and test stub creation (RED) in a single task, by design for Wave-0 scaffolding.

- **RED gate:** `test(03-01)` commit exists at a2ce6ab — 15 failing stubs (AssertionError: expected true to be false)
- **GREEN gate for sanity checks:** live-inject.ts in the same commit makes TRANSFORM.length===48 and TOTAL_SIZE.length===320 pass from day 1 (plan intent)
- **GREEN gate for remaining 15 tests:** Deferred to Plans 03-02 through 03-05 (by Wave-0 design — these are the RED stubs that drive later plans to GREEN)

No separate `feat(...)` commit was created because this plan's purpose is Wave-0 RED scaffolding — the contracts file is infrastructure, not a feature implementation. The channel-layout sanity checks serve as the GREEN gate for the layout constants.

## Known Stubs

The following are intentional Wave-0 stubs (by design — each links to the plan that makes it GREEN):

| File | Stub | Resolved In |
|------|------|-------------|
| `packages/live-inject/test/resolve.test.ts` | 3 RED stubs (`expect(true).toBe(false)`) | Plan 03-02 |
| `packages/live-inject/test/sentinels.test.ts` | 8 RED stubs | Plan 03-03 |
| `packages/live-inject/test/channel-layout.test.ts` | 1 RED seqlock stub | Plan 03-05 |
| `packages/live-inject/test/handle.test.ts` | 3 RED stubs | Plan 03-04 |
| All `src/*.cpp` functions | `return env.Undefined()` bodies | Plans 03-04/03-05 |
| All `agent/*.cpp` functions | `return false/nullptr` bodies | Plans 03-02 through 03-05 |

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/live-inject/CMakeLists.txt | FOUND |
| packages/contracts/src/live-inject.ts | FOUND |
| packages/live-inject/test/channel-layout.test.ts | FOUND |
| packages/harness/fixtures-real/live/.gitkeep | FOUND |
| Commit 42c81ba (Task 1a) | FOUND |
| Commit 520403e (Task 1b) | FOUND |
| Commit a2ce6ab (Task 2) | FOUND |
