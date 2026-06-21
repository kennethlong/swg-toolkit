# Phase 0: Toolchain De-risk & App Shell — Research

**Researched:** 2026-06-21
**Domain:** Electron Forge + Vite + cmake-js N-API + utility process + SharedArrayBuffer + dockview + pnpm workspaces
**Confidence:** HIGH (all major claims verified via Context7 / official Electron docs / npm registry; one area LOW — see Assumptions Log)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use **Electron Forge + the Vite plugin** for the app shell build. The Forge Vite plugin is flagged "experimental"; if it fights the native-addon load or COOP/COEP setup during Phase 0, that is the trigger to switch to `electron-vite`. This is the app/renderer bundler only — separate from the C++ client's MSBuild toolchain.
- **D-02:** The native `.node` addon runs in a **dedicated Electron utility process** (spawned from main), not main process and never the sandboxed renderer. SharedArrayBuffer data channel is transferred from utility process to the renderer.
- **D-03:** **pnpm workspaces.** Packages: `native-core` (C++ N-API addon), `backend` (Node services / utility-process host), `renderer` (React app), `contracts/` (shared types — IPC shapes, byte offsets, opcodes). Blender plugin lives in-repo but out-of-workspace.
- **D-04:** Phase 0 wiring proof goes all the way to a **real zero-copy SharedArrayBuffer round-trip** — C++ (utility process) allocates/fills a SAB, transfers it to the renderer via MessageChannel, renderer reads it on an animation frame with `crossOriginIsolated === true`. A trivial "hello" call alone is not sufficient.
- **Stack pins (do not re-litigate):** Electron 42, React 19.2, TypeScript 6, node-addon-api 8 (cmake-js + prebuildify), dockview (docking), Tailwind v4, Zustand 5.
- **Security defaults:** contextIsolation: true, nodeIntegration: false, narrow typed validated preload bridge, COOP `same-origin` + COEP `require-corp`.

### Claude's Discretion

- cmake-js vs node-gyp for the addon (lean cmake-js; validate against the real swg-client-v2 C++ build which is MSBuild/v145 — what does cross-compiling/consuming those sources later imply for the build system choice now?).
- Testing framework, CI, linting setup, and the dark-theme tokens / dockview panel layout details.
- Whether the Phase-0 `native-core` addon is a throwaway stub or the minimal seed of the real addon (lean: seed it minimally, keep it real).

### Deferred Ideas (OUT OF SCOPE)

- Reuse vs. rewrite of Utinni's C# format code — Phase 1 decision.
- MCP server design informed by `Utinni.Mcp` — Phase 8.
- Editor decomposition mirroring Utinni's editor phases — Phases 5/7.
- cmake-js integration with swg-client-v2's MSBuild TRE sources — concrete build wiring is Phase 1; Phase 0 only proves a minimal addon builds and loads.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | App boots as an Electron desktop app with secure context isolation and a narrow, validated preload bridge (no Node in the renderer). | Electron `contextIsolation: true`, `nodeIntegration: false`, `contextBridge` — fully documented; pattern verified. |
| FND-02 | The C++ Node-API addon builds via cmake-js (prebuildify distribution) and loads in the Electron main/utility process. | cmake-js 8 + prebuildify 6 + `@electron/rebuild` 4 — all confirmed on npm; utility process pattern verified via Electron docs. swg-client-v2 is MSVC `.sln`, not CMake — cmake-js is still the right choice; implications documented. |
| FND-03 | Cross-origin isolation (COOP/COEP) is enabled so `SharedArrayBuffer` is allocatable in the renderer. | `session.webRequest.onHeadersReceived` + `app.commandLine.appendSwitch` both confirmed; `Napi::SharedArrayBuffer::New` confirmed in node-addon-api 8. |
| FND-04 | A shared-types `contracts/` package defines the IPC, byte-offset, and opcode types used across native ↔ backend ↔ renderer. | pnpm workspace topology with a `contracts/` package importing from `@swg/contracts` is the standard pattern. |
| FND-05 | The app presents a dark, dockable, persistent multi-panel workspace (dockview) — sidebar / 3D canvas / data pane / inspector. | `DockviewReact` with `api.toJSON()`/`api.fromJSON()` persistence confirmed via Context7 docs. |
</phase_requirements>

---

## Summary

Phase 0 de-risks the entire pipeline before any SWG format work. The five key technical problems are: (1) wiring Electron Forge + Vite plugin to load a native `.node` addon out of ASAR; (2) placing that addon in a utility process and piping its output back to a sandboxed renderer via `MessageChannel`; (3) setting `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response headers so `crossOriginIsolated === true` in the renderer (enabling `SharedArrayBuffer`); (4) constructing the `contracts/` shared-types package so TypeScript compiles and type-checks cleanly across all workspace packages; and (5) scaffolding the dockview dark workspace with layout serialization/restore.

The research confirms all five problems have well-documented solutions. The main risk is the Forge Vite plugin's experimental status — specifically, the combination of native-addon externalization, ASAR unpacking, and the dev-server vs. packaged build header-injection gap. A concrete fallback trigger (switch to `electron-vite` + `electron-builder`) is documented below.

The swg-client-v2 ground truth confirms the client uses pure MSVC `.sln`/`.vcxproj` (no CMakeLists.txt exists). This means cmake-js for Phase 0 does NOT mean consuming the client build system — cmake-js is used to build a minimal C++ stub that proves the N-API pipeline. The actual harvesting of `swg-client-v2` C++ into the addon is a Phase 1 concern.

**Primary recommendation:** Scaffold with Electron Forge Vite template, externalize the native addon, use `@electron-forge/plugin-auto-unpack-natives`, set COOP/COEP via `session.webRequest.onHeadersReceived`, and keep the cmake-js stub minimal but real (a "ping" that returns a value + a SAB round-trip that fills 4 bytes).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| App window / BrowserWindow lifecycle | Backend (main process) | — | Electron main process owns window creation |
| Native addon loading | Backend (utility process) | Main process spawns it | Addon cannot load in sandboxed renderer |
| COOP/COEP header injection | Backend (main process) | — | `session.webRequest.onHeadersReceived` is main-only |
| SAB allocation | Backend (utility process) | — | `Napi::SharedArrayBuffer::New` runs in the process that holds the addon |
| MessageChannel / port transfer | Main process bridge | Renderer receives port | Main transfers `MessageChannelMain` port to renderer via `webContents.postMessage` |
| SharedArrayBuffer read (60fps) | Renderer (via transferred port) | — | R3F `useFrame` reads from shared buffer; no IPC round-trip per frame |
| contracts/ type definitions | Shared (compile-time only) | — | Pure TypeScript, imported by all packages |
| pnpm workspace wiring | Build-time | — | `pnpm-workspace.yaml` + package.json `workspace:*` deps |
| Dockview workspace shell | Renderer | — | React component, `DockviewReact` + `localStorage` persistence |
| Layout persistence (save/restore) | Renderer | — | `api.toJSON()` / `api.fromJSON()` via `onDidLayoutChange` |

---

## Standard Stack

### Core — Phase 0 Only

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron` | `42.4.1` | Desktop shell | Confirmed on npm registry; ships Chromium M148+ (supports SAB + COOP/COEP) [VERIFIED: npm registry] |
| `@electron-forge/cli` | `7.11.2` | Scaffold / build / package | Official Electron toolchain; confirmed on npm [VERIFIED: npm registry] |
| `@electron-forge/plugin-vite` | `7.11.2` | Vite integration for Forge | Explicitly locked by D-01; confirmed on npm [VERIFIED: npm registry] |
| `@electron-forge/plugin-auto-unpack-natives` | `7.11.2` | Unpacks `.node` from ASAR | Required for native addons inside ASAR; documented on electronforge.io [VERIFIED: npm registry + Context7 /websites/electronforge_io] |
| `node-addon-api` | `8.8.0` | C++ N-API wrapper | ABI-stable; `Napi::SharedArrayBuffer::New` confirmed in docs [VERIFIED: npm registry + Context7 /nodejs/node-addon-api] |
| `cmake-js` | `8.0.0` | Builds C++ addon via CMake | Chosen for Phase 1 forward-compat; confirmed on npm; no postinstall risks [VERIFIED: npm registry] |
| `prebuildify` | `6.0.1` | Bakes prebuilt binaries into package | End-users need no compiler; confirmed on npm [VERIFIED: npm registry] |
| `node-gyp-build` | `4.8.4` | Runtime picks correct prebuilt | Companion to prebuildify; confirmed on npm [VERIFIED: npm registry] |
| `@electron/rebuild` | `4.0.4` | Rebuilds addon against Electron ABI | Required after `npm install`; confirmed on npm [VERIFIED: npm registry] |
| `typescript` | `6.0.3` | Type safety | Pinned; confirmed on npm [VERIFIED: npm registry] |
| `pnpm` | `11.8.0` | Workspace package manager | Locked by D-03; confirmed on npm [VERIFIED: npm registry] |

### UI / Workspace — Phase 0

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react` + `react-dom` | `19.2.x` | UI framework | Always; pinned |
| `tailwindcss` | `4.3.1` | Utility CSS | v4 via `@tailwindcss/vite` plugin; no PostCSS [VERIFIED: npm registry] |
| `@tailwindcss/vite` | `4.3.1` | Vite plugin for Tailwind v4 | Confirmed on npm; replaces old PostCSS setup [VERIFIED: npm registry] |
| `dockview` | `6.6.1` | IDE docking shell | `DockviewReact` + `api.toJSON()`/`fromJSON()` confirmed [VERIFIED: npm registry + Context7 /mathuo/dockview] |
| `dockview-react` | `6.6.1` | React wrapper for dockview | Separate package; use `DockviewReact` from `dockview-react` [VERIFIED: npm registry] |
| `zustand` | `5.0.14` | State management | Pinned [VERIFIED: npm registry] |

### Development / Test — Phase 0

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `vitest` | `4.1.9` | Unit tests (TS + Node backend) | Vite-native; fast; shares Vite config [VERIFIED: npm registry] |
| `@playwright/test` | `1.61.0` | E2E / Electron integration | First-class Electron support via `_electron.launch` [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@electron-forge/plugin-vite` | `electron-vite` + `electron-builder` | electron-vite is more mature for native addons; switch if Forge Vite plugin fights native addon + COOP/COEP in dev server mode |
| `cmake-js` | `node-gyp` | node-gyp is simpler for greenfield C++; cmake-js wins here because Phase 1 will add C++ sources that may need external libs; invest in CMake once |
| `dockview` | `allotment` | allotment = lightweight splitter only (no drag-to-tab, no persistence, no popout); dockview is the right tool at the right time |
| `vitest` | `jest` | jest requires transform setup in Vite projects; vitest shares Vite config natively |

**Installation — Phase 0 root workspace:**

```bash
# Package manager (install once globally)
npm install -g pnpm

# Scaffold the Electron Forge Vite-TypeScript app
pnpm create electron-app@latest . --template=vite-typescript

# Add workspace packages
pnpm init  # for native-core, backend, renderer, contracts — each in packages/

# UI / workspace
pnpm add react@^19.2 react-dom@^19.2 zustand@^5 dockview dockview-react
pnpm add -D tailwindcss@^4 @tailwindcss/vite

# Native addon toolchain
pnpm add node-addon-api@^8 node-gyp-build@^4
pnpm add -D cmake-js@^8 prebuildify@^6 @electron/rebuild

# Dev / test
pnpm add -D typescript@^6 vitest@^4 @playwright/test
```

---

## Package Legitimacy Audit

> slopcheck was run but interpreted these as PyPI packages (cross-ecosystem confusion — all packages in this phase are npm). Registry verification performed via `npm view` for all packages. No packages cross-checked against PyPI.

| Package | Registry | Age | Source Repo | slopcheck (npm) | Disposition |
|---------|----------|-----|-------------|-----------------|-------------|
| `@electron-forge/cli` | npm | ~8 yr (2018) | github.com/electron/forge | [ASSUMED OK — npm verified] | Approved |
| `@electron-forge/plugin-vite` | npm | same umbrella | github.com/electron/forge | [ASSUMED OK — npm verified] | Approved |
| `@electron-forge/plugin-auto-unpack-natives` | npm | same umbrella | github.com/electron/forge | [ASSUMED OK — npm verified] | Approved |
| `electron` | npm | ~10 yr | github.com/electron/electron | [ASSUMED OK — npm verified] | Approved |
| `cmake-js` | npm | ~11 yr (2015) | github.com/cmake-js/cmake-js | [ASSUMED OK — npm verified] | Approved |
| `prebuildify` | npm | ~9 yr (2017) | github.com/prebuild/prebuildify | [ASSUMED OK — npm verified] | Approved |
| `node-gyp-build` | npm | ~9 yr (2017) | github.com/prebuild/node-gyp-build | [ASSUMED OK — npm verified] | Approved |
| `node-addon-api` | npm | ~9 yr (2017) | github.com/nodejs/node-addon-api | [ASSUMED OK — npm verified] | Approved |
| `@electron/rebuild` | npm | same umbrella | github.com/electron/rebuild | [ASSUMED OK — npm verified] | Approved |
| `dockview` | npm | ~6 yr (2020) | github.com/mathuo/dockview | [ASSUMED OK — npm verified] | Approved |
| `vitest` | npm | known Vite ecosystem | github.com/vitest-dev/vitest | [ASSUMED OK — npm verified] | Approved |
| `@playwright/test` | npm | Microsoft-owned | github.com/microsoft/playwright | [ASSUMED OK — npm verified] | Approved |
| `tailwindcss` | npm | ~9 yr | github.com/tailwindlabs/tailwindcss | [ASSUMED OK — npm verified] | Approved |
| `@tailwindcss/vite` | npm | same umbrella | github.com/tailwindlabs/tailwindcss | [ASSUMED OK — npm verified] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck ran against PyPI (wrong ecosystem). Registry identity for all packages above was confirmed via `npm view <pkg> version`. All are well-established packages from known maintainers with multi-year histories. Postinstall scripts checked for cmake-js, prebuildify, node-gyp-build, node-addon-api, @electron/rebuild — none present.*

---

## Architecture Patterns

### System Architecture Diagram

```
PHASE 0 — PIPELINE WIRING PROOF

  [forge.config.ts]
       │ pnpm workspaces
       ├── packages/native-core/    ← cmake-js builds swg_core.node
       ├── packages/backend/        ← Electron main + utility process host
       ├── packages/renderer/       ← React 19 + Tailwind v4 + dockview
       └── packages/contracts/      ← Shared TS types (zero runtime code)

  RUNTIME DATA FLOW:

  [main process]
    │ utilityProcess.fork(backend/utility-worker.js)
    │
    ↓
  [utility process]  ← require('@swg/native-core') → swg_core.node
    │  Napi::SharedArrayBuffer::New(env, 4)   // allocate 4-byte SAB
    │  nativeCore.hello() → "pong"            // control-channel proof
    │
    │  const { port1, port2 } = new MessageChannelMain()
    │  childProcess.postMessage({ type:'port' }, [port2])   // give port2 to util
    │  mainWindow.webContents.postMessage('sab-port', sabBuffer, [port1]) // give port1 to renderer
    ↓
  [renderer process — crossOriginIsolated === true]
    │  preload: contextBridge exposes window.api.hello()
    │  ipcRenderer receives 'sab-port' → stores port1, reads SAB
    │  R3F useFrame: reads sharedView[0] each frame → display
    │  
    │  "hello" call: renderer → window.api.hello() → ipcMain.invoke → util process nativeCore.hello()
    │                                                 → "pong" → renderer toast
    ↓
  CROSS-ORIGIN ISOLATION (required for SAB):
    main: session.webRequest.onHeadersReceived → inject COOP + COEP headers
    verify: renderer console: self.crossOriginIsolated === true
```

### Recommended Project Structure

```
swg-toolkit/
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml             # packages: ['packages/*']
├── forge.config.ts                 # Electron Forge config
├── tsconfig.base.json              # shared TS config, paths
│
├── packages/
│   ├── contracts/                  # ← keystone: shared types
│   │   ├── package.json            # name: "@swg/contracts"
│   │   └── src/
│   │       ├── ipc.ts              # IPC message shape types
│   │       ├── sab-layout.ts       # SharedArrayBuffer byte offsets
│   │       └── opcodes.ts          # opcode enums (seed, not full)
│   │
│   ├── native-core/                # ← C++ addon
│   │   ├── package.json            # name: "@swg/native-core"
│   │   ├── CMakeLists.txt          # cmake-js target
│   │   ├── src/
│   │   │   ├── hello.cpp           # exports hello() → "pong"
│   │   │   ├── sab.cpp             # exports allocateSab(bytes) → SAB
│   │   │   └── addon.cpp           # NODE_API_MODULE registration
│   │   └── index.d.ts              # hand-written TS types for addon surface
│   │
│   ├── backend/                    # ← Electron main + utility process
│   │   ├── package.json            # name: "@swg/backend"
│   │   └── src/
│   │       ├── main.ts             # BrowserWindow, COOP/COEP headers, utility process fork
│   │       ├── preload.ts          # contextBridge: window.api.hello(), SAB port setup
│   │       └── utility-worker.ts   # loads native-core, allocates SAB, handles MessagePort
│   │
│   └── renderer/                   # ← React app
│       ├── package.json            # name: "@swg/renderer"
│       └── src/
│           ├── main.tsx            # React 19 root
│           ├── App.tsx             # DockviewReact workspace wrapper
│           ├── workspace/
│           │   ├── WorkspaceShell.tsx    # DockviewReact + persistence
│           │   └── workspace-config.ts  # INITIAL_LAYOUT, localStorage key
│           └── panels/
│               ├── SidebarPanel.tsx
│               ├── ViewportPanel.tsx    # placeholder canvas
│               ├── DataPanel.tsx
│               └── InspectorPanel.tsx
│
└── blender-plugin/                 # out-of-workspace Python bpy addon
```

### Pattern 1: Utility Process Fork + MessageChannel SAB Transfer

**What:** Main process forks a utility process using `utilityProcess.fork()`. Utility process loads the `.node` addon, calls `Napi::SharedArrayBuffer::New`, creates a `MessageChannelMain` in main, sends one port to the utility worker (to receive the SAB), and sends the other port to the renderer via `webContents.postMessage`.

**When to use:** Any time native code must share a buffer with the sandboxed renderer.

```typescript
// Source: Context7 /websites/electronjs — utilityProcess.fork + MessageChannelMain
// packages/backend/src/main.ts

import { app, BrowserWindow, utilityProcess, MessageChannelMain, session, ipcMain } from 'electron'
import path from 'node:path'

function setupCrossOriginIsolation() {
  // VERIFIED pattern: session.webRequest.onHeadersReceived
  // [VERIFIED: Context7 /websites/electronjs webRequest.onHeadersReceived]
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    })
  })
}

app.whenReady().then(() => {
  setupCrossOriginIsolation()

  const win = new BrowserWindow({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,  // Electron 20+ default; enforce explicitly
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  const worker = utilityProcess.fork(path.join(__dirname, 'utility-worker.js'))
  const { port1, port2 } = new MessageChannelMain()

  // Give port2 to the utility process so it can post the SAB through
  worker.postMessage({ type: 'init-port' }, [port2])

  // When the worker responds with the SAB, relay port1 + the SAB to the renderer
  worker.on('message', (data) => {
    if (data.type === 'sab-ready') {
      // Transfer port1 to the renderer; renderer receives it in preload ipcRenderer.on('sab-port')
      win.webContents.postMessage('sab-port', data.sab, [port1])
    }
  })

  win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL ?? `file://${MAIN_WINDOW_VITE_NAME}`)
})
```

```typescript
// packages/backend/src/utility-worker.ts

// Runs in the Electron utility process — can require() native addons
const nativeCore = require('@swg/native-core')

// Allocate a 4-byte SAB in C++ and hand back a SharedArrayBuffer to JS
const sab: SharedArrayBuffer = nativeCore.allocateSab(4)
const view = new Int32Array(sab)
view[0] = 0xDEAD  // sentinel — renderer will read this to prove round-trip

// Receive the MessagePort from main, then post the SAB back through it
process.parentPort.once('message', (event) => {
  if (event.data.type === 'init-port') {
    const [port] = event.ports
    port.postMessage({ type: 'sab-ready', sab }, [sab])
    // Can now use port for ongoing control-channel communication
  }
})

// Control-channel: answer hello() pings from main
process.parentPort.on('message', (event) => {
  if (event.data.type === 'hello') {
    process.parentPort.postMessage({ type: 'pong', value: nativeCore.hello() })
  }
})
```

**Critical note:** The SAB transfer path above requires `crossOriginIsolated === true` in the renderer before the SAB is usable. The COOP/COEP headers must be set BEFORE the window is created or loaded.

### Pattern 2: COOP/COEP Header Injection — Dev vs. Packaged

**What:** Two separate mechanisms, both required.

**Dev server (Forge Vite plugin):** The Vite dev server serves files over `http://localhost:XXXX`. `session.webRequest.onHeadersReceived` intercepts ALL responses including those from the dev server, so the same `setupCrossOriginIsolation()` function works in dev.

**Packaged (ASAR / file:// protocol):** Same `onHeadersReceived` hook fires for `file://` responses. The Forge Vite plugin serves the packaged app from `file://` so the same code path covers production.

**Fallback / alternative:** Register a custom privileged scheme (`app://`) via `protocol.registerSchemesAsPrivileged` and inject headers in the `protocol.handle` response. More portable but more code.

```typescript
// Verification assertion — add to preload.ts or renderer startup
// [VERIFIED: Electron docs — crossOriginIsolated is a browser standard]
if (!self.crossOriginIsolated) {
  throw new Error('COOP/COEP not active — SharedArrayBuffer will be undefined. Check header injection.')
}
```

**Known landmine (Forge Vite + dev):** The Forge Vite plugin's dev server may serve the renderer's initial HTML before the `session.webRequest.onHeadersReceived` hook is registered if `app.whenReady()` is awaited inside an async block that yields. Register the hook synchronously in the `app.whenReady()` callback BEFORE calling `win.loadURL()`. [ASSUMED — inferred from Forge Vite plugin initialization order; verify during implementation]

### Pattern 3: cmake-js Minimal Addon (Phase 0 stub)

**What:** A single `.node` binary with two exports: `hello()` → string and `allocateSab(byteLength)` → `SharedArrayBuffer`. This is the minimal real addon that seeds the structure for Phase 1.

**Why cmake-js over node-gyp for this project:**
- swg-client-v2 is MSVC `.sln`/`.vcxproj` — there is **no** CMakeLists.txt in the client repo. cmake-js does NOT need to reuse the client's build system in Phase 0.
- cmake-js is chosen for Phase 1 forward-compatibility: when TRE/IFF C++ is pulled in (Phase 1), it will need to link against zlib and possibly other libs. CMakeLists.txt handles `find_package(ZLIB)` naturally; `binding.gyp` does not.
- cmake-js 8 confirmed on npm; no postinstall scripts.

```cmake
# packages/native-core/CMakeLists.txt
cmake_minimum_required(VERSION 3.15)
project(swg_native_core)

# cmake-js provides the node-addon-api include paths
include_directories(${CMAKE_JS_INC})
file(GLOB SOURCE_FILES "src/*.cpp")
add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB})

# node-addon-api: no exceptions variant (NAPI_DISABLE_CPP_EXCEPTIONS)
target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api)
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_DISABLE_CPP_EXCEPTIONS)
```

```cpp
// packages/native-core/src/addon.cpp
// [VERIFIED: node-addon-api 8 — Napi::SharedArrayBuffer::New]
// Source: Context7 /nodejs/node-addon-api

#include <napi.h>

Napi::Value Hello(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), "pong");
}

Napi::Value AllocateSab(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    size_t byteLength = info[0].As<Napi::Number>().Uint32Value();
    // Napi::SharedArrayBuffer::New — confirmed in node-addon-api 8 docs
    return Napi::SharedArrayBuffer::New(env, byteLength);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("hello", Napi::Function::New(env, Hello));
    exports.Set("allocateSab", Napi::Function::New(env, AllocateSab));
    return exports;
}

NODE_API_MODULE(swg_native_core, Init)
```

### Pattern 4: dockview Persistence

**What:** `DockviewReact` with an `onReady` callback that restores saved layout from `localStorage`. `onDidLayoutChange` serializes updated layout back. Both `toJSON()` and `fromJSON()` are confirmed in Context7 /mathuo/dockview docs.

```typescript
// Source: Context7 /mathuo/dockview — toJSON/fromJSON/onDidLayoutChange
// packages/renderer/src/workspace/WorkspaceShell.tsx

import { DockviewReact, DockviewReadyEvent, DockviewApi } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'

const LAYOUT_STORAGE_KEY = 'swg-workspace-layout'

const panelComponents = {
  sidebar:   SidebarPanel,
  viewport:  ViewportPanel,
  data:      DataPanel,
  inspector: InspectorPanel,
}

export function WorkspaceShell() {
  const apiRef = useRef<DockviewApi | null>(null)

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api

    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (saved) {
      event.api.fromJSON(JSON.parse(saved))
    } else {
      // First launch — build default layout
      event.api.addPanel({ id: 'sidebar',   component: 'sidebar',   position: { direction: 'left' } })
      event.api.addPanel({ id: 'viewport',  component: 'viewport' })
      event.api.addPanel({ id: 'data',      component: 'data',      position: { direction: 'below', referencePanel: 'viewport' } })
      event.api.addPanel({ id: 'inspector', component: 'inspector', position: { direction: 'right' } })
    }

    event.api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(event.api.toJSON()))
    })
  }

  return (
    <DockviewReact
      className="dockview-theme-dark"
      components={panelComponents}
      onReady={onReady}
      style={{ width: '100vw', height: '100vh' }}
    />
  )
}
```

**Tailwind v4 dark theme overlay:**
```css
/* packages/renderer/src/index.css */
@import "tailwindcss";
@import "dockview-react/dist/styles/dockview.css";

@theme {
  --color-swg-bg:       #0c0c0e;
  --color-swg-panel:    #16161a;
  --color-swg-border:   #1e1e24;
  --color-swg-accent:   #00ffcc;
  --color-swg-danger:   #ff0055;
  --color-swg-warning:  #ffcc00;
}

/* Override dockview dark theme to match Nordic Carbon aesthetic */
.dockview-theme-dark {
  --dv-background-color: #0c0c0e;
  --dv-tabs-and-actions-container-background-color: #121214;
  --dv-activegroup-visiblepanel-tab-background-color: #1a1a1f;
  --dv-activegroup-visiblepanel-tab-color: #00ffcc;
  --dv-tab-color: #666;
  font-family: 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 11px;
}
```

### Pattern 5: pnpm Workspace Wiring + contracts/ Shared Types

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
# blender-plugin/ is intentionally NOT listed — Python, out of workspace
```

```json
// packages/contracts/package.json
{
  "name": "@swg/contracts",
  "version": "0.0.1",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "dev": "tsc --watch" }
}
```

```typescript
// packages/contracts/src/ipc.ts — Phase 0 seed (minimal, real)
export type HelloRequest  = { type: 'hello' }
export type HelloResponse = { type: 'pong'; value: string }
export type SabReadyMsg   = { type: 'sab-ready'; sab: SharedArrayBuffer }
export type PortInitMsg   = { type: 'init-port' }

// SharedArrayBuffer layout — 4-byte Phase 0 proof region
export const SAB_LAYOUT = {
  HELLO_SENTINEL: { offset: 0, length: 4 },  // Int32: 0xDEAD written by C++, read by renderer
} as const

export type IpcMessage = HelloRequest | HelloResponse | SabReadyMsg | PortInitMsg
```

```json
// packages/backend/package.json — workspace dependency
{
  "name": "@swg/backend",
  "dependencies": {
    "@swg/contracts": "workspace:*",
    "@swg/native-core": "workspace:*"
  }
}
```

```json
// packages/renderer/package.json — workspace dependency
{
  "name": "@swg/renderer",
  "dependencies": {
    "@swg/contracts": "workspace:*"
  }
}
```

### Anti-Patterns to Avoid

- **Loading the native addon in the renderer:** The renderer is sandboxed (`sandbox: true` default since Electron 20); `require()` is unavailable. Never `nodeIntegration: true` to work around this.
- **Setting COOP/COEP after `win.loadURL()`:** The headers must be in the HTTP response that loads the page. Set up `onHeadersReceived` before `loadURL`.
- **Using `new SharedArrayBuffer()` in JS and passing the pointer to C++:** The correct pattern for Phase 0 is C++ (`Napi::SharedArrayBuffer::New`) allocates the SAB and returns it to JS. This avoids the `arrayBuffer.Data()` dangling-pointer trap from the start.
- **Two CMake + node-gyp build files:** Pick cmake-js and stick with it. Do NOT add a `binding.gyp` alongside `CMakeLists.txt`.
- **`git add .` in a dirty repo:** The monorepo root will have `node_modules/`, `packages/*/dist/`, and `packages/native-core/build/` — all of which must be gitignored before any commit.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ASAR unpacking for native addons | Custom unpack logic | `@electron-forge/plugin-auto-unpack-natives` | Forge plugin handles all native modules in `node_modules/` automatically |
| Header injection for COOP/COEP | Custom protocol / proxy | `session.webRequest.onHeadersReceived` | Electron's built-in intercept; works for both dev server and file:// |
| IDE docking with persistence | Custom drag/drop, resize, tab | `dockview-react` | Handles panel lifecycle, drag, tab, split, popout, `toJSON`/`fromJSON` |
| Layout serialization/restore | localStorage ad-hoc code | `DockviewApi.toJSON()` / `.fromJSON()` | Serializes the full panel tree; one call per direction |
| SAB allocation from C++ | JS `new SharedArrayBuffer()` + pointer hand-off | `Napi::SharedArrayBuffer::New` in the addon | C++ owns allocation → no dangling-pointer risk |
| pnpm workspace linking | Symlinks by hand | `workspace:*` in `package.json` dependencies | pnpm handles cross-package imports with type-safe path aliases |

**Key insight:** Every "clever" workaround for Electron native addon loading is already a plugin (`auto-unpack-natives`). Use the plugin; don't re-implement ASAR unpacking.

---

## Common Pitfalls

### Pitfall 1: Forge Vite Plugin Dev-Server COOP/COEP Gap

**What goes wrong:** In development, the Forge Vite plugin starts a Vite dev server (HMR, `http://localhost:XXXX`). The `session.webRequest.onHeadersReceived` hook intercepts ALL responses from Electron's session, including the Vite dev server's responses. However, if the hook is registered *after* the first page load (e.g., inside an `async` function that yields before registering), the initial HTML response won't have the headers and `crossOriginIsolated` will be `false`.

**Why it happens:** `app.whenReady()` returns a promise; developers `await` it and then do async work before registering the hook.

**How to avoid:** Register `onHeadersReceived` as the FIRST thing inside the `app.whenReady().then(...)` callback, synchronously, before any `await` or `win.loadURL()`.

**Warning signs:** `self.crossOriginIsolated === false` in devtools console despite headers being set; works in packaged build but not dev.

### Pitfall 2: Native Addon Not Found After ASAR Pack

**What goes wrong:** The packaged app throws `Error: Cannot find module '@swg/native-core'` or `Error: Invalid ELF header` because the `.node` file is inside the ASAR archive, which doesn't support `dlopen`.

**Why it happens:** The `@electron-forge/plugin-auto-unpack-natives` plugin must be in `forge.config.ts`'s `plugins` array AND `packagerConfig.asar` must be `true` (or an options object). If either is missing, `.node` files go into the ASAR and fail to load.

**How to avoid:** `forge.config.ts`:
```typescript
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { VitePlugin } from '@electron-forge/plugin-vite'

export const forgeConfig = {
  packagerConfig: { asar: true },
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({ /* renderer/main vite configs */ }),
  ],
}
```
Also externalize the native package in the Vite main-process config:
```typescript
// vite.main.config.ts
export default defineConfig({
  build: {
    rollupOptions: { external: ['@swg/native-core'] }
  }
})
```

**Warning signs:** Runtime `MODULE_NOT_FOUND` for the addon in packaged build; works in `npm start` / dev mode.

### Pitfall 3: Utility Process Cannot Load Addon Without `modulePath` Pointing to the Right Entry

**What goes wrong:** `utilityProcess.fork('./utility-worker.js')` — the path must resolve relative to the packaged app's resource directory, not the source directory. In packaged builds the worker JS lands in a different path than in dev.

**How to avoid:** Use Electron Forge's build constants (`MAIN_WINDOW_VITE_DEV_SERVER_URL`, `MAIN_WINDOW_VITE_NAME`) pattern for the main window; for the utility worker, compute the path via `path.join(app.getAppPath(), 'dist', 'utility-worker.js')` and ensure Forge bundles the worker file. Add the worker to the Vite `build.rollupOptions.input` so it's emitted as a separate file.

### Pitfall 4: `Napi::SharedArrayBuffer::New` Requires `NAPI_EXPERIMENTAL` on Older Node-API Versions

**What goes wrong:** On older node-addon-api releases, `Napi::SharedArrayBuffer` was behind a feature flag. node-addon-api 8 ships it by default, but the CMake build must define `NAPI_VERSION=8` or higher.

**How to avoid:**
```cmake
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8)
```
Or use the cmake-js `node-gyp` Node.h variables — cmake-js 8 injects `NAPI_VERSION` automatically if the target ABI is correct.

### Pitfall 5: dockview `fromJSON` Requires All Component Types Registered

**What goes wrong:** `api.fromJSON()` will throw or silently skip panels if a component name in the serialized JSON doesn't match a key in the `components` prop of `DockviewReact`.

**How to avoid:** Always register all panel component names before calling `fromJSON`. If a panel is added later (Phase 2 viewport, Phase 3 injection HUD), update the `components` map first. Use a central `panelRegistry` object that both the `fromJSON` restore and the default-layout builder reference.

### Pitfall 6: swg-client-v2 Is MSVC `.sln`, Not CMake — cmake-js for Phase 0 Does Not Consume It

**What goes wrong:** Planners might schedule a task to "integrate cmake-js with swg-client-v2's CMake" — but swg-client-v2 has no CMakeLists.txt. Its build system is pure MSVC `.vcxproj`/`.sln`.

**What this means for Phase 0:** cmake-js builds a *standalone* C++ stub in `packages/native-core/`. In Phase 1, the actual TRE/IFF C++ from swg-client-v2 will be **copied and adapted** into the cmake-js build (the .cpp files), not linked to the existing `.sln`. cmake-js is still the right choice because it gives us CMake for adding deps (zlib, etc.) cleanly in Phase 1.

**Warning signs:** Any Phase 0 task that references `swg-client-v2/src/build/win32/swg.sln` or tries to consume MSBuild from cmake-js.

---

## Runtime State Inventory

Step 2.6 triggered: SKIPPED — this is a greenfield phase (no app code exists yet). No existing runtime state to migrate or rename.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | pnpm, Vite, Electron dev | ✓ | (verified via npm view working) | — |
| pnpm | Workspace management | Install via `npm i -g pnpm` | 11.8.0 on registry | `npm workspaces` (less ergonomic) |
| MSVC / Visual Studio Build Tools | cmake-js C++ compile on Windows | [ASSUMED] present — swg-client-v2 was built | v145 toolchain confirmed used for swg-client-v2 | MinGW (less tested with Electron) |
| CMake | cmake-js | [ASSUMED] present (standard dev machine) | ≥ 3.15 required | Install from cmake.org |
| Git | project commits | ✓ (repo is in git) | — | — |
| Python 3 | node-gyp build fallback | ✓ (slopcheck ran) | 3.14 | — |

**Missing dependencies with no fallback:** None identified for Phase 0 core goals.

**Missing dependencies with fallback:**
- CMake: if not installed, `winget install Kitware.CMake` or download from cmake.org. cmake-js 8 will surface a clear error if CMake is absent.

---

## Validation Architecture

> nyquist_validation is enabled (workflow.nyquist_validation not explicitly false in config.json).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.9 + @playwright/test 1.61.0 |
| Config file | `vitest.config.ts` (Wave 0 gap — does not exist yet) |
| Quick run command | `pnpm vitest run` |
| Full suite command | `pnpm vitest run && pnpm playwright test` |

### Success Criterion → Test Map

| SC# | Success Criterion | Test Type | Automated Command | File Exists? |
|-----|-------------------|-----------|-------------------|-------------|
| SC-1 | App boots with `contextIsolation: true`, `nodeIntegration: false`, no Node in renderer | E2E | `playwright test --grep "contextIsolation"` | ❌ Wave 0 |
| SC-1 | Preload bridge narrow & typed — renderer cannot access `require`/`process` | E2E | `playwright test --grep "preload security"` | ❌ Wave 0 |
| SC-2 | cmake-js addon builds and loads in utility process | Unit/integration | `vitest run native-core/hello.test.ts` | ❌ Wave 0 |
| SC-2 | `nativeCore.hello()` returns `"pong"` observable in renderer | E2E | `playwright test --grep "hello round-trip"` | ❌ Wave 0 |
| SC-3 | `self.crossOriginIsolated === true` in packaged renderer | E2E | `playwright test --grep "crossOriginIsolated"` | ❌ Wave 0 |
| SC-3 | `new SharedArrayBuffer(4)` does not throw in renderer | E2E | `playwright test --grep "SAB allocatable"` | ❌ Wave 0 |
| SC-4 | SAB byte-pattern round-trip: C++ writes `0xDEAD`, renderer reads `0xDEAD` | E2E | `playwright test --grep "SAB round-trip"` | ❌ Wave 0 |
| SC-4 | contracts/ compiles cleanly (`tsc --noEmit` in all packages) | Build / CI | `pnpm -r tsc --noEmit` | ❌ Wave 0 |
| SC-5 | Dark dockable workspace renders 4 panels on first launch | E2E | `playwright test --grep "workspace panels"` | ❌ Wave 0 |
| SC-5 | Layout survives app restart (localStorage persist) | E2E | `playwright test --grep "layout persistence"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm vitest run` (unit tests only, <10s)
- **Per wave merge:** `pnpm vitest run && pnpm playwright test` (includes E2E)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `packages/native-core/test/hello.test.ts` — covers SC-2 (unit: hello() returns "pong")
- [ ] `e2e/01-boot.spec.ts` — covers SC-1 (contextIsolation, preload security)
- [ ] `e2e/02-isolation.spec.ts` — covers SC-3 (crossOriginIsolated, SAB allocatable)
- [ ] `e2e/03-sab-roundtrip.spec.ts` — covers SC-4 (byte pattern 0xDEAD visible in renderer)
- [ ] `e2e/04-workspace.spec.ts` — covers SC-5 (panels visible, persistence across restart)
- [ ] `vitest.config.ts` — shared Vitest config for all packages
- [ ] `playwright.config.ts` — Playwright config with `electron.launch()` setup

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not applicable (desktop app, no user auth in Phase 0) |
| V3 Session Management | No | Not applicable |
| V4 Access Control | Partial | Preload `contextBridge` surface must be minimal and typed; no broad API exposure |
| V5 Input Validation | Yes | All IPC message shapes validated via `contracts/` types; no untyped `any` in preload |
| V6 Cryptography | No | No crypto in Phase 0 |

### Phase 0 Threat Model

| Threat | STRIDE | Standard Mitigation |
|--------|--------|---------------------|
| Renderer escape via broad preload API | Elevation of Privilege | Minimal typed `contextBridge` surface; `window.api.hello()` only in Phase 0 |
| `nodeIntegration: true` accidental enablement | Tampering | Explicit `nodeIntegration: false` + `sandbox: true` in `BrowserWindow` options; E2E test asserts `require` is undefined in renderer |
| Injection of native addon into renderer | Tampering | Addon lives only in utility process; renderer never `require()`s it |
| ASAR traversal (native addon bundled inside ASAR) | Tampering | `auto-unpack-natives` plugin ensures `.node` is unpacked before `dlopen` |
| COOP/COEP misconfiguration enabling Spectre/SAB misuse | Information Disclosure | Verified in E2E suite: `crossOriginIsolated === true`; SAB only allocated in utility process |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `nan` (Native Abstractions for Node) | `node-addon-api` (ABI-stable N-API wrapper) | ~2017 | No recompile per Electron version; write once |
| `postMessage` with `structuredClone` for SAB | `MessageChannelMain` + `SharedArrayBuffer` transferred | Electron 14+ | Zero-copy; no serialization |
| `session.webRequest.onBeforeSendHeaders` for header injection | `session.webRequest.onHeadersReceived` for response headers | — | Correct intercept point for COOP/COEP (response, not request) |
| Golden Layout | dockview | 2020+ | Zero deps, React-native, `toJSON`/`fromJSON` persistence, popout windows |
| Tailwind v3 (PostCSS + `tailwind.config.js`) | Tailwind v4 (`@tailwindcss/vite` + CSS `@theme`) | 2024 | No PostCSS step; Rust "Oxide" engine; `@import "tailwindcss"` entry |
| `child_process.fork()` for utility workers | `utilityProcess.fork()` (Electron UtilityProcess API) | Electron 20 | Chromium Services API; MessagePort native to Electron; preferred over `child_process.fork` per Electron docs |

**Deprecated/outdated:**
- `electron.remote` module: removed in Electron 14. Not used here.
- `ipcRenderer.sendSync`: blocks the renderer; never use. Use `ipcRenderer.invoke` (Promise-based).
- `nan`: replaced by `node-addon-api`. Do not reference in any C++ addon code.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | MSVC v145 toolchain is installed on the build machine (required by cmake-js to compile the C++ addon on Windows) | Environment Availability | cmake-js build fails; install VS Build Tools 2022 with "Desktop development with C++" workload |
| A2 | CMake ≥ 3.15 is installed on the build machine | Environment Availability | cmake-js cannot invoke CMake; install from cmake.org |
| A3 | The Forge Vite plugin `session.webRequest.onHeadersReceived` correctly fires for the dev server's `http://localhost` responses (not just `file://`) | Pitfall 1 | crossOriginIsolated may be false in dev; fallback: add a custom Chromium flag via `app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')` or switch to `electron-vite` which has a known-good COOP/COEP integration path |
| A4 | `Napi::SharedArrayBuffer::New` in node-addon-api 8 does not require `NAPI_EXPERIMENTAL` flag (confirmed in node-addon-api docs it is stable in NAPI 6+; NAPI 8 = Node 18+) | Pattern 3 | Build fails with undefined; fix: `target_compile_definitions(...NAPI_EXPERIMENTAL)` |
| A5 | All slopcheck verdicts above are `[ASSUMED OK]` due to cross-ecosystem tool confusion (PyPI vs npm); each package was independently verified via `npm view` | Package Legitimacy Audit | Low risk — all packages are well-known with multi-year histories and large download counts |

---

## Open Questions

1. **Forge Vite plugin experimental status — specific known failure modes**
   - What we know: The plugin is marked "experimental" in Forge docs; native addon externalization is documented (`rollupOptions.external`); `auto-unpack-natives` plugin is the documented solution.
   - What's unclear: Whether the Forge Vite dev-server mode correctly forwards COOP/COEP headers injected via `onHeadersReceived` without an additional Vite dev-server middleware config. Some community reports suggest the Vite dev server may need explicit proxy headers.
   - Recommendation: Implement, verify `crossOriginIsolated` in dev console on first run; if false, add a Vite dev-server middleware as a Wave 1 fix (before SAB tasks), or switch to `electron-vite` per D-01's explicit fallback trigger.

2. **Utility process `require('@swg/native-core')` path resolution in packaged build**
   - What we know: `utilityProcess.fork(modulePath)` takes an absolute path; the worker JS must bundle or externalize the native-core require and the path must be valid post-pack.
   - What's unclear: Whether Forge's Vite bundler will correctly handle `require('@swg/native-core')` inside the utility worker JS (which is a separate entry point from the main process). It must be externalized in `vite.main.config.ts` — but the utility worker has its own bundle.
   - Recommendation: Add the utility worker as a separate `rollupOptions.input` entry in `vite.main.config.ts` (or a dedicated `vite.worker.config.ts`), and externalize `@swg/native-core` in that bundle. Test both dev and packaged modes in Wave 1 before the SAB tasks.

3. **native-core stub vs. real seed — Phase 0 scope**
   - What we know: D-04 mandates a real SAB round-trip (not just hello). CONTEXT.md defers cmake-js integration with swg-client-v2 TRE sources to Phase 1.
   - Recommendation (Claude's Discretion): The native-core stub for Phase 0 should be **two functions only** (`hello()` + `allocateSab(byteLength)`) with a `CMakeLists.txt` that is already structured for Phase 1 expansion (module subdirectories seeded but empty). Do NOT add any IFF/TRE C++ in Phase 0.

---

## Sources

### Primary (HIGH confidence — Context7 + official docs)

- Context7 `/mathuo/dockview` — `DockviewReact`, `onReady`, `api.toJSON()`, `api.fromJSON()`, `onDidLayoutChange`, panel registration [VERIFIED: Context7]
- Context7 `/nodejs/node-addon-api` — `Napi::SharedArrayBuffer::New`, `Napi::ArrayBuffer::New` with finalizer, `Napi::Persistent` strong reference [VERIFIED: Context7]
- Context7 `/websites/electronjs` — `utilityProcess.fork`, `MessageChannelMain`, `webContents.postMessage` with port transfer, `session.webRequest.onHeadersReceived`, `protocol.registerSchemesAsPrivileged` [VERIFIED: Context7]
- Context7 `/websites/electronforge_io` — `@electron-forge/plugin-auto-unpack-natives`, native module externalization in Vite plugin, ASAR unpack pattern [VERIFIED: Context7]
- npm registry (`npm view`, 2026-06-21) — all package versions and existence confirmed [VERIFIED: npm registry]

### Secondary (MEDIUM confidence — inference from docs + known patterns)

- Forge Vite + `onHeadersReceived` for dev server COOP/COEP: inferred from Electron session docs + Forge Vite plugin behavior; no explicit Forge docs example for this exact combination.
- cmake-js `NAPI_VERSION=8` compile definition requirement: inferred from node-addon-api 8 compatibility matrix; standard practice.
- swg-client-v2 MSVC-only build system: confirmed by directory listing (`src/build/win32/*.vcxproj`, `swg.sln` found; `CMakeLists.txt` NOT found at root or in `src/`).

### Tertiary (LOW — noted as assumptions)

- MSVC and CMake presence on build machine (A1, A2)
- Forge Vite dev-server header forwarding behavior (A3)

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all packages verified on npm registry
- Architecture patterns (utility process, MessageChannel, COOP/COEP): HIGH — all patterns verified against official Electron docs via Context7
- dockview persistence: HIGH — `toJSON`/`fromJSON` API confirmed via Context7
- cmake-js for Phase 0 stub: HIGH — package confirmed; MSVC toolchain inference is MEDIUM
- Forge Vite + COOP/COEP dev mode: MEDIUM — general mechanism verified; exact header-forwarding behavior in dev server is ASSUMED

**Research date:** 2026-06-21
**Valid until:** 2026-09-21 (Electron/Forge stable APIs; dockview serialization API stable since 6.x)
