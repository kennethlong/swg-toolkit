---
phase: 00-toolchain-de-risk-app-shell
plan: 03
subsystem: infra
tags: [electron, path-b, native-in-renderer, zero-copy, sab, coop-coep, nodejs-integration, contextbridge-failure]

# Dependency graph
requires:
  - phase: 00-02
    provides: cmake-js N-API addon (hello + allocateSab), prebuild distribution, FND-02

provides:
  - writeSab/readSab C++ exports for bidirectional SAB proof
  - Path B fallback posture: sandbox:false + nodeIntegration:true + contextIsolation:false
  - Electron app with COOP/COEP (crossOriginIsolated=true verified at runtime)
  - Bidirectional same-memory proof (C++→JS, JS→C++, intra-cluster Worker share)
  - window.__transport / __zeroCopy / __sabValue / __crossWriteOk / __sabIsShared test hooks
  - Revised FND-01 (addon in renderer, not utility process; posture documented with residual risk)

affects:
  - 00-04 (React shell replaces renderer/index.html + src/main.tsx; inherits Path B posture)
  - 00-05 (E2E spec asserts in-process same-memory proof via window.__* hooks)
  - Phase 1+ (Path B established as the transport for all native↔renderer data; posture decision documented)

# Tech tracking
tech-stack:
  added:
    - "Napi::SharedArrayBuffer::Data() — raw pointer access for writeSab/readSab (00-03)"
  patterns:
    - "Path B posture: sandbox:false + nodeIntegration:true + contextIsolation:false (fallback B — preferred contextBridge fails for C++ SAB)"
    - "Preferred posture tried first: contextBridge cannot carry a C++ SharedArrayBuffer across isolated-world boundaries (structured-clone throws)"
    - "COOP/COEP registration BEFORE BrowserWindow creation AND loadURL — crossOriginIsolated=true is independent of nodeIntegration/sandbox"
    - "Renderer requires('@swg/native-core') directly — no IPC, no copy, no bridge"
    - "pnpm hoisted node-addon-api: CMakeLists.txt must search workspace-root node_modules as fallback"

key-files:
  created:
    - packages/native-core/src/sab-rw.cpp
    - packages/renderer/index.html
    - packages/renderer/src/main.tsx
  modified:
    - packages/native-core/src/addon.cpp
    - packages/native-core/index.d.ts
    - packages/native-core/CMakeLists.txt
    - packages/native-core/test/hello.test.ts
    - packages/backend/src/main.ts
    - packages/backend/src/preload.ts
    - vite.main.config.ts
    - vite.preload.config.ts
    - vite.renderer.config.ts
  removed:
    - packages/backend/src/utility-worker.ts

key-decisions:
  - "Path B fallback posture (nodeIntegration:true) chosen after empirical contextBridge failure: C++ SAB cannot cross isolated-world boundary via contextBridge (structured-clone throws)"
  - "Preferred posture (contextIsolation:true + contextBridge narrow API) attempted first and rejected at runtime — not a paper decision"
  - "FND-01 revised: native addon in renderer (not utility process); residual risk is accepted for trusted desktop app"
  - "COOP/COEP maintained: crossOriginIsolated=true is a header policy, independent of nodeIntegration/sandbox setting"
  - "CMakeLists.txt: add workspace-root node_modules as secondary include path (pnpm hoisted layout)"
  - "utility-worker.ts removed: utility process is NOT on the data path; no utility fork in main.ts"
  - "Plan 00-04 owns the React shell replacing renderer/index.html + src/main.tsx"

requirements-completed:
  - FND-01 (revised — see posture section)
  - FND-03

# Metrics
duration: single-session
completed: 2026-06-22
---

# Phase 0 Plan 03: Path B Native-in-Renderer Zero-Copy Transport Summary

**Path B (native-in-renderer, fallback posture: sandbox:false + nodeIntegration:true + contextIsolation:false) implemented and proven by running. All five bidirectional same-memory proof assertions passed. Cross-process utility SAB relay removed.**

## Performance

- **Duration:** Single session
- **Completed:** 2026-06-22
- **Tasks:** 5 (4 implementation + 1 runtime proof)
- **Files modified:** 9 modified, 3 created, 1 removed

## Accomplishments

- `writeSab(sab, int32Index, value)` and `readSab(sab, int32Index)` added to native-core (C++ `Napi::SharedArrayBuffer::Data()` pointer access); addon rebuilt and prebuild refreshed; 14/14 unit tests green
- Electron main process rewritten for Path B: `sandbox:false + nodeIntegration:true + contextIsolation:false`; `setupCrossOriginIsolation()` remains FIRST in `whenReady` callback; `utilityProcess.fork()` and the entire utility SAB relay machinery removed
- `utility-worker.ts` deleted (git rm); `vite.main.config.ts` input entry removed
- Preload simplified to logging/COI status only; no `contextBridge.exposeInMainWorld()` call
- Minimal renderer proof entry (`packages/renderer/index.html` + `src/main.tsx`) runs the 5-step bidirectional same-memory proof and sets `window.__*` test hooks for 00-05 E2E
- **PROVEN BY RUNNING:** All 5 proof assertions passed (see Runtime Proof Evidence below)

## Chosen Posture: Fallback B (nodeIntegration:true)

### What was tried first (preferred posture — FAILED empirically)

`sandbox:false + contextIsolation:true + nodeIntegration:false + preload contextBridge`

The preload (Node context) required the addon and attempted to expose `allocateSab / writeSab / readSab / hello` via `contextBridge.exposeInMainWorld()`. At runtime:

```
Uncaught (in promise) Error: Uncaught Error: An object could not be cloned.
```

**Root cause:** `contextBridge.exposeInMainWorld()` uses the structured-clone algorithm to transfer values across the isolated-world boundary. A `SharedArrayBuffer` allocated by the C++ addon in the preload's agent cluster cannot be cloned into the renderer main world's agent cluster — the same fundamental constraint that makes cross-process SAB sharing impossible also prevents cross-isolated-world SAB transfers via contextBridge. This is a direct consequence of the agent-cluster model (same root cause as the utility-process finding).

### Fallback posture in effect (PROVEN)

`sandbox:false + nodeIntegration:true + contextIsolation:false`

The renderer main world has full Node.js access and calls `require('@swg/native-core')` directly. The addon lives in the renderer's own process cluster. The SAB is allocated there and stays there — no IPC, no copy, no clone.

### Revised FND-01

**Original FND-01:** "renderer calls native only via a narrow validated preload bridge; no Node in renderer"

**Revised FND-01 (Path B):** Native code runs in the renderer process. The fallback posture (nodeIntegration:true) exposes full Node.js to the renderer main world. Residual risk:

- The renderer can call `require()` and access all Node APIs
- **Mitigation for SWG-Toolkit:** This is a trusted local desktop tool, not a public web app. External web content is never loaded in the main renderer window. XSS from external content is not a realistic threat vector; the attack surface is local file access only.
- **Future hardening:** If a web content pane is added (e.g., live game preview), sandbox it in a separate BrowserWindow with `sandbox:true` and the original secure posture.

## Runtime Proof Evidence (captured 2026-06-22 09:30:11)

The following lines were captured verbatim from `ELECTRON_ENABLE_LOGGING=1 pnpm start` on 2026-06-22:

```
[main] COOP/COEP response headers registered (onHeadersReceived).
[proof] --- Path B bidirectional same-memory proof ---
[proof] crossOriginIsolated=true
[proof] posture=fallback: nodeIntegration=true, contextIsolation=false
[proof] PASS: nativeCore.hello()="pong"
[proof] PASS: allocateSab(8) instanceof SharedArrayBuffer, byteLength=8
[proof] PASS: C++ writeSab(sab,0,0xDEAD) → Int32Array(sab)[0]=0xDEAD (C++ → JS same memory)
[proof] PASS: Renderer wrote nonce=1437041945 → C++ readSab(sab,1)=1437041945 (JS → C++ same memory)
[preload] crossOriginIsolated=true — SharedArrayBuffer is available.
[preload] Path B fallback posture: nodeIntegration=true, contextIsolation=false
[proof] PASS: Worker sees Int32Array(sab)[0]=0xDEAD (intra-cluster SAB share)
[proof] === ALL PROOF ASSERTIONS PASSED — Path B zero-copy confirmed ===
[proof] transport=B-native-in-renderer
[proof] zeroCopy=true
[proof] sabValue=0xdead
[proof] crossWriteOk=true
[proof] sabIsShared=true
[proof] posture=fallback: nodeIntegration=true, contextIsolation=false
```

All five proof assertions:

| Assertion | Result |
|-----------|--------|
| `crossOriginIsolated=true` (COOP/COEP active) | PASS |
| `nativeCore.hello()="pong"` (addon loaded in renderer) | PASS |
| `allocateSab(8) instanceof SharedArrayBuffer` (in-process allocation) | PASS |
| `writeSab(sab,0,0xDEAD) → view[0]=0xDEAD` (C++ → JS same memory) | PASS |
| `view[1]=nonce → readSab(sab,1)=nonce` (JS → C++ same memory) | PASS |
| `Worker reads 0xDEAD from sab` (intra-cluster SAB share) | PASS |

## Task Commits

1. **Task 1: writeSab/readSab native-core extension** — `a466a6c`
2. **Task 2+3: main.ts + preload.ts + renderer entry (preferred posture attempt)** — `f741c79`
3. **Task 4+5: fallback posture + empirical proof (PASSED)** — `fa77553`
4. **Task 6: 00-03-PLAN.md rewrite** — `aba3200`

## Files Created/Modified

- `packages/native-core/src/sab-rw.cpp` — `WriteSab()` and `ReadSab()` using `Napi::SharedArrayBuffer::Data()` pointer; bounds-checked; full input validation
- `packages/native-core/src/addon.cpp` — registered `writeSab` and `readSab` exports
- `packages/native-core/index.d.ts` — TypeScript declarations for `writeSab()` and `readSab()`
- `packages/native-core/CMakeLists.txt` — add workspace-root `node_modules` as secondary include path for `napi.h` (pnpm hoisted layout)
- `packages/native-core/test/hello.test.ts` — 6 new tests (9-14) for `writeSab`/`readSab`; total 14/14 green
- `packages/backend/src/main.ts` — Path B fallback posture; COOP/COEP kept; utility fork removed
- `packages/backend/src/preload.ts` — logging/COI check only; no contextBridge
- `packages/backend/src/utility-worker.ts` — **REMOVED** (git rm)
- `packages/renderer/index.html` — Phase-0 proof entry; replaced by Plan 00-04
- `packages/renderer/src/main.tsx` — 5-step bidirectional proof + `window.__*` test hooks
- `vite.main.config.ts` — removed `utility-worker` rollup input
- `vite.preload.config.ts` — added `@swg/native-core` + `node-gyp-build` as externals
- `vite.renderer.config.ts` — added `@swg/native-core` + `node-gyp-build` as externals; updated comment for Path B

## Decisions Made

- **Preferred posture rejected empirically:** `contextIsolation:true + contextBridge` cannot carry a C++ `SharedArrayBuffer` across isolated-world boundaries. The same structured-clone agent-cluster restriction that prevents cross-process SAB sharing also blocks cross-isolated-world SAB transfer via `contextBridge`. This was verified at runtime (not a theoretical concern).

- **Fallback posture adopted:** `sandbox:false + nodeIntegration:true + contextIsolation:false`. The renderer requires the addon directly; SAB lives in the renderer cluster. This matches the Utinni model (native + UI in one process) for a trusted desktop tool.

- **FND-01 revised:** "native in renderer" accepted for SWG-Toolkit as a local trusted tool. Residual risk documented above. Future: separate sandbox for any external web content pane.

- **COOP/COEP unchanged:** `crossOriginIsolated=true` is maintained. It's a header policy registered `BEFORE` `loadURL()` — independent of `nodeIntegration`/`sandbox`. Required for `SharedArrayBuffer` availability.

- **CMakeLists.txt workspace-root path:** `pnpm` with `nodeLinker:hoisted` hoists `node-addon-api` to the workspace root, not the package-local `node_modules/`. Added `${CMAKE_SOURCE_DIR}/../../node_modules/node-addon-api` as a secondary search path.

- **Plan 00-04 owns the React shell:** `packages/renderer/index.html` and `src/main.tsx` are the Phase-0 proof entry. Plan 00-04 replaces them with the real React app shell. The `window.__*` hooks are retained for 00-05 E2E.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preferred contextBridge posture failed — contextBridge cannot carry C++ SAB**
- **Found during:** Task 2 (first runtime attempt with preferred posture)
- **Issue:** `contextBridge.exposeInMainWorld` uses structured-clone to pass values across isolated-world boundaries. A `SharedArrayBuffer` from the C++ addon in the preload's world cannot be cloned into the renderer's isolated main world — throws "An object could not be cloned". The REPLAN anticipated this and specified a fallback posture.
- **Fix:** Switched to fallback B posture (nodeIntegration:true + contextIsolation:false). Renderer requires the addon directly. Per REPLAN § DECISION: "FALL BACK to: sandbox:false + nodeIntegration:true + contextIsolation:false (renderer requires the addon directly). Use only if (1) cannot share the SAB across the contextBridge boundary."
- **Files modified:** `packages/backend/src/main.ts`, `packages/backend/src/preload.ts`, `packages/renderer/src/main.tsx`

**2. [Rule 1 - Bug] CMakeLists.txt napi.h path missing for pnpm hoisted layout**
- **Found during:** Task 1 (cmake-js rebuild)
- **Issue:** `pnpm` with `nodeLinker:hoisted` places `node-addon-api` in the workspace root `node_modules/`, not in `packages/native-core/node_modules/`. The CMakeLists.txt searched only the package-local path (`${CMAKE_SOURCE_DIR}/node_modules/node-addon-api`), causing a compile error. Plan 02's build had worked because the hoisting configuration was different at that time.
- **Fix:** Added workspace-root path `${CMAKE_SOURCE_DIR}/../../node_modules/node-addon-api` as a secondary include directory in CMakeLists.txt.
- **Files modified:** `packages/native-core/CMakeLists.txt`

---

**Total deviations:** 2 auto-fixed (Rule 1 — both bugs encountered during implementation)
**Impact on plan:** Both required by the REPLAN's fallback specification. The plan's implementation proceeded as specified.

## What Was Removed (utility-relay model)

The following files/features from the old Plan 03 (utility-process SAB relay model) are now gone:

- `packages/backend/src/utility-worker.ts` — deleted
- `utilityProcess.fork()` in main.ts — removed
- `MessageChannelMain` + SAB relay in main.ts — removed
- `pendingHello`/`pendingCrossWrite` correlation-id Maps — removed
- `ipcMain.handle('hello')` / `ipcMain.handle('cross-write-sab')` relay handlers — removed
- `worker.on('exit')` reject-on-crash machinery — removed
- `ipcRenderer.invoke('hello')` relay in preload.ts — removed
- `onSabPort()` / `crossWriteSab()` contextBridge methods in preload.ts — removed
- `utility-worker` rollup input from vite.main.config.ts — removed

## Known Stubs

`packages/renderer/index.html` and `packages/renderer/src/main.tsx` are intentional Phase-0 proof entries, not feature stubs. They are replaced by Plan 00-04 (React shell). This is documented inline in both files.

No functional stubs remain — the proof runs and all assertions pass.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: nodeIntegration | packages/backend/src/main.ts | nodeIntegration:true expands renderer attack surface. Mitigated: trusted desktop app, no external web content in this window. Documented as revised FND-01. |

## Self-Check: PASSED

### Files

- `packages/native-core/src/sab-rw.cpp` — FOUND
- `packages/renderer/index.html` — FOUND
- `packages/renderer/src/main.tsx` — FOUND
- `packages/backend/src/main.ts` — FOUND
- `packages/backend/src/preload.ts` — FOUND
- `packages/backend/src/utility-worker.ts` — REMOVED (correct)
- `.planning/phases/00-toolchain-de-risk-app-shell/00-03-SUMMARY.md` — FOUND

### Commits

- `a466a6c` — FOUND (feat(00-03): add writeSab/readSab to native-core)
- `f741c79` — FOUND (feat(00-03): rewrite Electron main+preload for Path B)
- `fa77553` — FOUND (fix(00-03): switch to fallback B posture after contextBridge SAB failure)
- `aba3200` — FOUND (docs(00-03): rewrite 00-03-PLAN.md for Path B)

### Verification

- `grep -n "onHeadersReceived" main.ts` → line 62 present (before loadURL) ✓
- `grep -n "nodeIntegration.*true"` → lines 91, 107 present ✓
- `grep -c "exposeInMainWorld" preload.ts` → 0 (no contextBridge — fallback posture) ✓
- `ls sab-rw.cpp` → present ✓
- Runtime proof: ALL 5 ASSERTIONS PASSED (captured log in Runtime Proof Evidence section) ✓
