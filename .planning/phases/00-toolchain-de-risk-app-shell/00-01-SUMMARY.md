---
phase: 00-toolchain-de-risk-app-shell
plan: "01"
subsystem: infra
tags: [pnpm, electron-forge, vite, typescript, node-addon-api, contracts, vitest, playwright, cmake, msvc, ci]

# Dependency graph
requires: []
provides:
  - pnpm workspace root with four linked packages (contracts, backend, renderer, native-core)
  - "@swg/contracts shared-types package (IpcMessage with correlation ids, SAB_LAYOUT, NativeOpcode)"
  - Electron Forge + Vite build configs with AutoUnpackNativesPlugin + asar
  - vite.main.config.ts single source-of-truth worker path (packages/backend/src/utility-worker.ts)
  - Vitest config with @swg/* workspace aliases; Playwright config with Electron fixture
  - scripts/check-prereqs.js preflight (cmake >= 3.15 + MSVC toolset detection)
  - .nvmrc + engines.node pinned to Node v22.12.0 (Electron 42 bundled Node line)
  - Split CI workflow (lean always-on job + packaged-gate job gated on 00-03 architecture gate)
  - Toolchain preflight checkpoint PASSED (cmake 3.31.6 + MSVC v143 + pnpm install clean)
affects: [00-02, 00-03, 00-04, 00-05, 01-core-engine]

# Tech tracking
tech-stack:
  added:
    - pnpm 11.8.0 (workspace manager)
    - Electron Forge 7.11.2 + @electron-forge/plugin-vite 7.11.2
    - "@electron-forge/plugin-auto-unpack-natives 7.11.2"
    - Vite (renderer/main/preload configs)
    - TypeScript 6.0.3
    - node-addon-api ^8.8.0 (native-core stub)
    - node-gyp-build ^4 + prebuildify ^6 (FND-02 distribution stubs)
    - "@electron/rebuild ^4.0.0 (optional devDep fallback, overridden via pnpm-workspace.yaml)"
    - vitest 4.1.9
    - "@playwright/test 1.61.0"
    - cmake-js ^8 (native build driver, Plan 02)
  patterns:
    - "pnpm workspaces: packages/contracts, packages/backend, packages/renderer, packages/native-core"
    - "@swg/contracts as single shared-types import point across backend and renderer"
    - "Discriminated union IPC types with numeric correlation id on all request/response pairs"
    - "vite.main.config.ts names both entry points (main + utility-worker) at exact repo-root-relative paths"
    - "Split CI: lean always-on job (no packaging) + separate packaged-gate job (gated on 00-03 arch gate)"
    - "check-prereqs.js: cmake + MSVC hard-required, Node version mismatch is warn-only (N-API ABI-stable)"

key-files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - tsconfig.base.json
    - .nvmrc
    - scripts/check-prereqs.js
    - packages/contracts/package.json
    - packages/contracts/tsconfig.json
    - packages/contracts/src/index.ts
    - packages/contracts/src/ipc.ts
    - packages/contracts/src/sab-layout.ts
    - packages/contracts/src/opcodes.ts
    - packages/backend/package.json
    - packages/backend/tsconfig.json
    - packages/renderer/package.json
    - packages/renderer/tsconfig.json
    - packages/native-core/package.json
    - forge.config.ts
    - vite.main.config.ts
    - vite.preload.config.ts
    - vite.renderer.config.ts
    - .gitignore
    - vitest.config.ts
    - playwright.config.ts
    - e2e/fixtures/electron-helpers.ts
    - .github/workflows/ci.yml
  modified: []

key-decisions:
  - "D-WORKSPACE: pnpm workspace with @electron/rebuild overridden to ^4.0.0 via pnpm-workspace.yaml overrides (prevents Forge from pulling a breaking v5+)"
  - "D-TSCONFIG: tsconfig.base.json uses baseUrl+ignoreDeprecations:6.0 for TypeScript 6 path aliases (TypeScript 6 deprecates the old paths-without-baseUrl pattern)"
  - "Node 24 vs .nvmrc 22.12.0 is a non-blocking warning: the single --napi prebuild is ABI-stable; developers may use nvm use 22.12.0 for exact parity but it does not block Plan 02"
  - "packaged-gate CI job gated on vars.ARCH_GATE_PASSED == true (00-03 architecture gate outcome) per round-3 Sonnet SON-C — packaged CI not pre-invested before the cross-write experiment survives"

patterns-established:
  - "Pattern: workspace:* for all intra-monorepo deps — no relative paths across packages"
  - "Pattern: single source-of-truth rollup entry path — both Plans 03 and Vite config reference the same packages/backend/src/utility-worker.ts literal"
  - "Pattern: all IPC request/response types carry a numeric id for Plan 03's demux Promise resolution"
  - "Pattern: SAB_LAYOUT offsets are the assertion anchors for E2E specs — never derive offsets inline"

requirements-completed: [FND-01, FND-04]

# Metrics
duration: 12min
completed: 2026-06-22
---

# Phase 00 Plan 01: Monorepo Scaffold + Contracts + Harness Summary

**pnpm workspace with four linked packages, @swg/contracts shared-types (correlation ids + SAB layout), Electron Forge/Vite build configs with AutoUnpackNativesPlugin, split CI workflow (lean + packaged-gate), and toolchain preflight checkpoint PASSED (cmake 3.31.6 + MSVC v143 + Node 24 warning-only)**

## Performance

- **Duration:** ~12 min (Tasks 1-3 elapsed 2026-06-22T07:03:31Z to 07:07:44Z; checkpoint resolved same session)
- **Started:** 2026-06-22T07:03:31Z
- **Completed:** 2026-06-22T12:30:00Z (checkpoint resolved)
- **Tasks:** 3 auto + 1 checkpoint (PASSED)
- **Files created:** 25

## Accomplishments

- pnpm workspace root with four packages (contracts, backend, renderer, native-core) linked and installing cleanly (`pnpm install` exits 0, "Already up to date")
- `@swg/contracts` compiles with `tsc --noEmit` (zero errors); IpcMessage discriminated union carries correlation `id: number` on all four correlated types (HelloRequest, HelloResponse, CrossWriteReq, SabCrossWriteAck), SAB_LAYOUT exports both sentinels at their correct offsets (HELLO_SENTINEL @ 0, RENDERER_SENTINEL @ 4)
- Electron Forge build config has AutoUnpackNativesPlugin + asar; vite.main.config.ts names BOTH rollup entries at exact repo-root-relative paths (packages/backend/src/main.ts, packages/backend/src/utility-worker.ts) — the single source-of-truth path Plan 03's `utilityProcess.fork()` will consume
- Split CI workflow: lean always-on job (prereqs + install + contracts tsc + vitest + non-packaged Playwright with --forbid-only) + separate packaged-gate job (package:ci + 05-packaged, --forbid-only, gated on `vars.ARCH_GATE_PASSED` from the 00-03 architecture gate)
- Toolchain preflight checkpoint PASSED: cmake 3.31.6 found, MSVC v143 (VS2022) found, pnpm install clean — Plan 02 native cmake-js build is cleared to proceed

## Task Commits

1. **Task 1: Workspace root + four package stubs + de-risk hygiene** - `70a9164` (feat)
2. **Task 2: Build configs — forge, vite, .gitignore, CI workflow** - `f016f87` (feat)
3. **Task 3: contracts/ types (with correlation id) + test harness** - `5f3c0a2` (feat)
4. **Planning state update (Tasks 1-3, checkpoint pending)** - `753276f` (docs)

**Plan metadata:** _(this commit — see below)_

## Files Created

- `package.json` — workspace root; engines.node >=22.12.0; scripts: start, build, package, package:ci, test, test:e2e, prereqs
- `pnpm-workspace.yaml` — packages/*; @electron/rebuild override ^4.0.0
- `tsconfig.base.json` — strict, ESNext, moduleResolution bundler, @swg/* path aliases, ignoreDeprecations "6.0"
- `.nvmrc` — v22.12.0 (Electron 42 bundled Node line)
- `scripts/check-prereqs.js` — cmake >= 3.15 + MSVC toolset check; Node mismatch is warn-only
- `packages/contracts/src/ipc.ts` — discriminated union IpcMessage with correlation ids
- `packages/contracts/src/sab-layout.ts` — SAB_LAYOUT (HELLO_SENTINEL @ 0, RENDERER_SENTINEL @ 4)
- `packages/contracts/src/opcodes.ts` — const enum NativeOpcode { Hello = 0, AllocSab = 1 }
- `packages/contracts/src/index.ts` — re-exports all three modules
- `packages/backend/package.json` — @swg/contracts: workspace:*, @swg/native-core: workspace:*
- `packages/renderer/package.json` — @swg/contracts: workspace:*; React 19, dockview 6.6.1, tailwindcss 4
- `packages/native-core/package.json` — node-addon-api ^8.8.0, node-gyp-build ^4; @electron/rebuild ^4 devDep-only
- `forge.config.ts` — AutoUnpackNativesPlugin + asar + VitePlugin
- `vite.main.config.ts` — external @swg/native-core + node-gyp-build; rollup inputs: main + utility-worker (single source of truth)
- `vite.preload.config.ts` — preload.ts input; electron external
- `vite.renderer.config.ts` — root packages/renderer; @tailwindcss/vite plugin
- `.gitignore` — node_modules/, packages/*/dist/, native-core/build/, native-core/prebuilds/, *.node, .vite/, out/
- `vitest.config.ts` — @swg/* aliases; test.include: packages/*/test + packages/*/src; pool: forks
- `playwright.config.ts` — testDir: e2e; workers: 1; packaged spec hard gate comment
- `e2e/fixtures/electron-helpers.ts` — electronApp + window fixture using @playwright/test _electron
- `.github/workflows/ci.yml` — lean job (always-on) + packaged-gate job (needs: lean, gated on ARCH_GATE_PASSED)

## Decisions Made

- **@electron/rebuild overridden to ^4.0.0** in pnpm-workspace.yaml overrides: Forge pulls @electron/rebuild as a transitive dep; v5+ has breaking API changes. Override locks it to ^4 to prevent surprise breakage in Plan 02's native build.
- **ignoreDeprecations: "6.0" in tsconfig.base.json**: TypeScript 6 deprecated the `paths`-without-`baseUrl` pattern. The override silences this for now; a future migration to project references is tracked as a deferred item.
- **Node 24 vs .nvmrc v22.12.0 — non-blocking**: `check-prereqs.js` emits a WARN (not an error) when Node version mismatches. The single `--napi` prebuild is ABI-stable across Node + Electron, so building on Node 24 is acceptable for FND-02. Developers may `nvm use 22.12.0` for exact parity.
- **packaged-gate CI gated on `vars.ARCH_GATE_PASSED`**: The 00-03 architecture gate determines whether the utility→renderer SAB sharing is zero-copy. Pre-investing the packaged CI before that experiment survives would waste CI time and potentially gate on a design pivot. The 00-03 SUMMARY will set this repo variable.

## Deviations from Plan

### Auto-applied Deviations

**1. [Rule 2 - Missing Critical] @electron/rebuild override to ^4.0.0**
- **Found during:** Task 1 (workspace root + package stubs)
- **Issue:** The plan specified @electron/rebuild as a devDep in native-core's package.json but did not specify a version override at the workspace level. Forge's transitive dep on @electron/rebuild can pull v5+, which has breaking API changes that would silently break the optional Forge rebuild path.
- **Fix:** Added `overrides: { "@electron/rebuild": "^4.0.0" }` to pnpm-workspace.yaml's pnpm.overrides block, capping it at the last compatible v4 series.
- **Files modified:** pnpm-workspace.yaml
- **Committed in:** 70a9164 (Task 1 commit)

**2. [Rule 2 - Missing Critical] ignoreDeprecations: "6.0" in tsconfig.base.json**
- **Found during:** Task 1 (workspace root + tsconfig.base.json)
- **Issue:** TypeScript 6 deprecates the `paths`-without-`baseUrl` pattern used by the plan's `@swg/*` path aliases. Without `ignoreDeprecations: "6.0"`, tsc would emit deprecation errors on every compile.
- **Fix:** Added `"ignoreDeprecations": "6.0"` to tsconfig.base.json compilerOptions.
- **Files modified:** tsconfig.base.json
- **Committed in:** 70a9164 (Task 1 commit)

---

**Total deviations:** 2 auto-applied (both Rule 2 — missing critical configuration for correct operation)
**Impact on plan:** Both fixes are correctness requirements. No scope creep. The plan's stated behavior ("tsc --noEmit exits 0 in contracts/") requires both.

## Checkpoint — Task 4: Toolchain Preflight Gate — PASSED

**Evidence (collected by orchestrator before continuation):**

| Check | Result |
|-------|--------|
| `node scripts/check-prereqs.js` exit code | **0** |
| cmake version | **3.31.6** (>= 3.15 required) |
| MSVC toolset | **v143 (VS2022)** found |
| Node version | v24.15.0 running vs v22.12.0 in .nvmrc — **NON-BLOCKING WARNING** |
| `pnpm install` exit code | **0** ("Already up to date", all 5 workspace projects) |

The Node 24 vs v22.12.0 mismatch is a known item carried forward. Developers may use `nvm use 22.12.0` for exact parity. This does not block Plan 02's native cmake-js build because the single `--napi` prebuild is ABI-stable across Node + Electron (round-3 / Cursor CUR-1).

## Verification Block Results (run post-checkpoint)

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm install` exits 0 | **PASS** — "Already up to date", all 5 workspace projects |
| 2 | `node scripts/check-prereqs.js` exits 0 | **PASS** — cmake 3.31.6, MSVC v143, Node warn-only |
| 3 | `pnpm --filter @swg/contracts exec tsc --noEmit` exits 0 | **PASS** — zero errors |
| 4 | `grep "AutoUnpackNativesPlugin" forge.config.ts` | **PASS** — import + usage found |
| 5 | `grep "packages/backend/src/utility-worker" vite.main.config.ts` | **PASS** — single source-of-truth path present |
| 6 | `grep "@swg/contracts.*workspace" packages/backend/package.json packages/renderer/package.json` | **PASS** — both contain workspace:* |
| 7 | `grep "node-addon-api.*8.8" packages/native-core/package.json` | **PASS** — ^8.8.0 confirmed (not ^8) |
| 8 | `grep -c "id: number" packages/contracts/src/ipc.ts` | **PASS** — count: 4 (>= 4 required) |
| 9 | `grep "package:ci" .github/workflows/ci.yml && grep "05-packaged" && grep "forbid-only" && grep "needs:"` | **PASS** — split CI with packaged hard gate wired |
| 10 | `ls e2e/fixtures/electron-helpers.ts .nvmrc scripts/check-prereqs.js .github/workflows/ci.yml` | **PASS** — all four files exist |

**All 10 verification checks: PASS**

## Requirements Addressed

- **FND-01** (workspace + shared-types package compiles and is importable from backend and renderer): COMPLETE
- **FND-04** (check-prereqs preflight + .nvmrc/engines hygiene + CI workflow): COMPLETE

## Issues Encountered

None beyond the two auto-applied deviations documented above.

## Next Phase Readiness

- **Plan 02 (cmake-js native addon)** is unblocked: cmake 3.31.6 and MSVC v143 confirmed present; workspace installed cleanly; node-addon-api ^8.8.0 stub in native-core ready for the real binding.gyp/CMakeLists.txt.
- **Plans 03-05** have their type contracts (@swg/contracts), Vite entry paths (vite.main.config.ts), and test infrastructure (Playwright fixture + vitest config) in place.
- **Known carry-forward item:** Node 24 vs v22.12.0 — warn-only; no action required before Plan 02.

---

## Self-Check

**Created files exist:**
- `D:\Code\SWG-Toolkit\.planning\phases\00-toolchain-de-risk-app-shell\00-01-SUMMARY.md` — this file

**Commits verified:**
- 70a9164 — feat(00-01): workspace root + four package stubs + de-risk hygiene — CONFIRMED
- f016f87 — feat(00-01): build configs — forge, vite, .gitignore, CI workflow (split packaged gate) — CONFIRMED
- 5f3c0a2 — feat(00-01): contracts/ types (with correlation id) + test harness — CONFIRMED
- 753276f — docs(00-01): update planning state after Tasks 1-3 complete (checkpoint pending) — CONFIRMED

**Verification block:** All 10 checks PASS (see table above).

## Self-Check: PASSED

---
*Phase: 00-toolchain-de-risk-app-shell*
*Completed: 2026-06-22*
