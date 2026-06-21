# Architecture Research

**Domain:** Desktop modding suite (Electron + React/TS + Node-API C++ core) for Star Wars Galaxies assets, with live process injection and a Blender bridge
**Researched:** 2026-06-21
**Confidence:** HIGH on the layering and process model (verified against Electron/N-API docs); MEDIUM on the exact data-channel transfer mechanism (refines what `docs/` proposes); the binary *format* layouts remain unverified per project caveats and are out of scope for this document.

> **Verdict on the proposed `docs/00-overview/architecture.md` layering: VALIDATED, with three concrete refinements.** The three-tier shape (React/TS UI → Node backend → C++ N-API core) is correct and is the right spine for this project. The refinements concern (1) *where the native addon physically runs* under Electron's sandbox, (2) *how the zero-copy data channel actually crosses the renderer boundary*, and (3) *splitting the monolithic "C++ core" into independently-built modules* so the killer feature (live injection) isn't blocked on the format-parsing work. These are detailed below.

---

## Standard Architecture

### System Overview

The proposed layering is sound but under-specifies the Electron **process model**. Electron is not one process — it is a main process, N renderer processes (sandboxed), and optional utility processes. A native `.node` addon **cannot load in a sandboxed renderer**, and `SharedArrayBuffer` cannot be minted against a raw C++ pointer *inside* the sandbox. The corrected map places the C++ core in a non-sandboxed host process and crosses into the renderer via a `MessageChannel`.

```
┌──────────────────────────────────────────────────────────────────────┐
│  RENDERER PROCESS (sandboxed, contextIsolation: true)                  │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐ ┌──────────────────┐   │
│  │ React 19   │ │ Zustand    │ │ R3F / three  │ │ Golden Layout    │   │
│  │ UI panels  │ │ stores     │ │ viewport     │ │ docking shell    │   │
│  └─────┬──────┘ └─────┬──────┘ └──────┬───────┘ └────────┬─────────┘   │
│        └──────────────┴───────────────┴──────────────────┘             │
│                          window.api  (preload contextBridge)            │
└───────────────┬──────────────────────────────────┬─────────────────────┘
   control: ipcRenderer.invoke (JSON)   data: MessagePort + SharedArrayBuffer
                │                                    │
┌───────────────▼────────────────────────────────────▼────────────────────┐
│  MAIN / UTILITY PROCESS (Node runtime, NOT sandboxed)                     │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  Node Backend (TS): workspace state machine, file watchers,       │    │
│  │  TRE mount registry, cache, plugin router, WebSocket bridge       │    │
│  └───────────────────────────────┬──────────────────────────────────┘    │
│                                   │  node-addon-api (direct call)          │
│  ┌────────────────────────────────▼─────────────────────────────────┐    │
│  │  C++ N-API CORE  (one .node, several internal modules)            │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │    │
│  │  │ iff      │ │ tre      │ │ format   │ │ inject   │ │ navmesh │ │    │
│  │  │ (parse/  │ │ (mount/  │ │ parsers  │ │ (Win32   │ │ (Recast │ │    │
│  │  │  write)  │ │  pack)   │ │ (msh…)   │ │  memory) │ │  /Detour│ │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────┘ │    │
│  │        async work → libuv worker threads / Napi::AsyncWorker      │    │
│  └───────────────────────┬───────────────────────┬──────────────────┘    │
└──────────────────────────┼───────────────────────┼───────────────────────┘
              OpenProcess / WriteProcessMemory   Detours recv/send hooks
                           ▼                       ▼
                  ┌──────────────────────────────────────┐
                  │  Running SWGClient.exe  (Windows)     │
                  └──────────────────────────────────────┘

   Separate sidecar (NOT in the addon):
   ┌──────────────────────────┐  ws://localhost:9012  ┌────────────────────┐
   │ Blender (bpy + Python)   │ ─────────────────────▶│ WS server in Node  │
   │ swg-blender-plugin       │ ◀─────────────────────│ backend (main proc)│
   └──────────────────────────┘                       └────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Renderer (React/R3F) | All UI, the 3D viewport, gizmo input. Owns *no* native handles. | React 19 + R3F + drei + Zustand + Golden Layout, sandboxed |
| Preload (`contextBridge`) | The *only* renderer→backend surface. Exposes a typed `window.api`; sets up the data `MessagePort`. | `src/preload.ts`, `contextIsolation: true` |
| Node backend (TS) | Orchestration: workspace state, TRE mount registry, file watchers, cache, plugin routing, the WebSocket bridge, IPC routing. Holds the addon reference. | TS in main (and/or a utility process), `require('…/swg_native_core.node')` |
| C++ N-API core | All CPU/memory-heavy work: IFF parse/serialize, TRE mount/(de)compress, per-format parsers, live memory I/O, Recast navmesh. Returns zero-copy buffers. | One `.node` built with `node-addon-api` + node-gyp/cmake-js |
| Live-injection module | `OpenProcess`/`WriteProcessMemory` transform patch; Detours `recv`/`send` packet hooks; `ThreadSafeFunction` callbacks up. | Windows-only sub-target inside the core |
| Blender bridge | Decoupled WS server inside the Node backend; receives geometry/animation/property JSON from the `swg-blender-plugin`, routes into the C++ compilers. | `ws` server on `localhost:9012` |
| MCP server | Tool-wraps the *backend services* (not the UI) so AI agents reuse the same APIs the UI calls. | Separate Node entry point importing the backend service layer |

**Why the C++ core must not sit in the renderer:** Electron sandboxes renderers by default since v20; native modules cannot be loaded in a sandboxed renderer, and disabling the sandbox to do so forfeits the security model and is explicitly discouraged. The addon therefore lives in the Node-privileged main/utility process, exactly as the `docs/` packaging snippet already does (`require(...swg_native_core.node)` in `src/main.ts`). The architecture doc's three boxes are correct; this just pins the middle and bottom boxes to the *main/utility* process, not the renderer.

---

## Refinement 1 — The data channel actually crosses the renderer boundary via MessagePort

`docs/04-live-sync/live-memory-and-ipc.md` shows the `SharedArrayBuffer` being allocated in TypeScript and its pointer handed to C++ via `initializeSharedChannel`. That is correct **only if that TypeScript runs in the same process as the addon** (the main/utility process). A sandboxed renderer cannot pass a live buffer pointer into a native addon it cannot load.

The correct, verified pattern:

1. **Backend (main/utility) creates the `SharedArrayBuffer`** and binds its pointer into the C++ core (`g_sharedMatrixBuffer`). This is the doc's existing code — just relocated to the backend process.
2. **Transfer one end of a `MessageChannel` to the renderer** via `ipcRenderer.postMessage` / `webContents.postMessage`. `SharedArrayBuffer` is shareable across Electron processes (same machine, shared memory), so the renderer's R3F gizmo writes the 16-float matrix directly into the shared region.
3. **The renderer fires a tiny control ping** (`signalMemoryPatch(objectId, address)`) over the port; the backend's addon reads the already-written shared matrix and issues `WriteProcessMemory`. No serialization, no copy.

This preserves the doc's "two channels by frequency" contract and its sub-millisecond goal — it just inserts the one boundary the doc omitted. **Cross-origin isolation** (`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` response headers, or the `app.commandLine` equivalent) must be enabled for `SharedArrayBuffer` to be constructible in the renderer; flag this as a setup task.

**Data-flow contract (validated and made precise):**

| Payload | Direction | Transport | Rule |
|---------|-----------|-----------|------|
| File-open, parse manifest, palette pick, pack/compile trigger | renderer ↔ backend | `ipcRenderer.invoke` (JSON, structured clone) | Small structure/metadata only |
| Geometry / texture / audio / terrain buffers | backend → renderer | `ArrayBuffer` transferred via `postMessage` (transfer list) | Never JSON; consumed straight into `BufferGeometry` / `DataTexture` |
| 60 fps transform gizmo → live client | renderer → backend → process | `SharedArrayBuffer` (write in renderer) + control ping | Zero-copy; throttled to `requestAnimationFrame` |
| 64-bit memory pointers | both ways | `BigInt` | Preserve full address width |
| Packet sniffer stream | C++ hook thread → renderer | `Napi::ThreadSafeFunction` → JSON over IPC | Low volume, JSON acceptable |
| Blender geometry/animation | Blender → backend | WebSocket JSON (+ raw float arrays) | Decoupled; never touches renderer |

---

## Refinement 2 — Split the "C++ core" into modules with a clean dependency root

The docs treat the C++ core as one box. For *build ordering and risk isolation* it must be seen as several modules with a strict dependency root. **Everything in the toolkit ultimately depends on `iff` + `tre`** (`docs/01-core-engine/iff-and-tre.md` is explicitly "the lowest-level building blocks referenced by every other format parser"). But the **live-injection module depends on neither** — it only needs Win32 + a matrix buffer. This matters: it means the killer differentiator can be built in parallel with, not after, the format-parsing tower.

```
                 ┌─────────────────────────┐
                 │  iff (read/write prims) │   ← dependency root, the WHOLE tower
                 └────────────┬────────────┘
            ┌─────────────────┼──────────────────┐
            ▼                 ▼                  ▼
      ┌───────────┐    ┌─────────────┐   ┌──────────────┐
      │ tre mount │    │ format       │   │ (later)      │
      │ /pack     │    │ parsers      │   │ shader/anim  │
      └─────┬─────┘    │ (msh/skt/…)  │   │ compilers    │
            │          └──────┬───────┘   └──────────────┘
            └──────────┬──────┘
                       ▼
              ┌──────────────────┐        ┌──────────────────────────┐
              │ asset pipeline   │        │ inject (Win32 memory)    │  ← INDEPENDENT
              │ (TRE→IFF→buffers)│        │ depends only on Win32    │     of iff/tre
              └──────────────────┘        └──────────────────────────┘
              ┌──────────────────────────┐
              │ navmesh (Recast/Detour)  │  ← independent third-party island
              └──────────────────────────┘
```

---

## Recommended Project Structure

A **pnpm/npm-workspaces monorepo** is the right call (it is already flagged as an open decision in `tech-stack.md`). Four primary workspaces match the four runtimes, plus shared contracts. Keep the Blender plugin in the same repo for atomic cross-cutting changes, but it is *not* an npm workspace (it's a Python addon).

```
swg-toolkit/
├── package.json                # workspaces root, shared scripts
├── pnpm-workspace.yaml         # (or "workspaces" field)
├── tsconfig.base.json          # shared TS config, path aliases
├── forge.config.ts             # Electron Forge (app-level packaging)
│
├── packages/
│   ├── native-core/            # ← C++ N-API addon (the dependency root)
│   │   ├── CMakeLists.txt       # cmake-js preferred over raw node-gyp for multi-module
│   │   ├── binding.gyp          # (if node-gyp) — keep ONE build system
│   │   ├── src/
│   │   │   ├── iff/             # read/write primitives — build & test FIRST
│   │   │   ├── tre/             # mount + pack + consolidate
│   │   │   ├── formats/         # msh, skt, ans, trn, fld… one dir per format
│   │   │   ├── inject/          # Win32 memory + Detours (compiled #ifdef _WIN32)
│   │   │   ├── navmesh/         # Recast/Detour wrapper
│   │   │   └── addon.cpp        # NODE_API_MODULE registration / exports
│   │   ├── index.d.ts          # hand-written TS types for the addon surface
│   │   └── test/               # native unit tests (catch2/gtest) + round-trip fixtures
│   │
│   ├── backend/                # ← Node/TS orchestration (main + utility process)
│   │   ├── src/
│   │   │   ├── main.ts          # Electron main entry, loads .node, owns SharedArrayBuffer
│   │   │   ├── workspace/       # virtual workspace state machine, file watchers
│   │   │   ├── mount/           # TRE mount registry, priority/override resolution
│   │   │   ├── services/        # parse, pack, inject, cfg-manager, server-parity
│   │   │   ├── bridge/          # Blender WebSocket server (ws @ 9012)
│   │   │   ├── ipc/             # invoke handlers + MessageChannel data-port setup
│   │   │   └── plugins/         # plugin router
│   │   └── package.json        # depends on @swg/native-core, @swg/contracts
│   │
│   ├── renderer/               # ← React 19 + R3F UI (sandboxed)
│   │   ├── src/
│   │   │   ├── app/             # Golden Layout shell, routing
│   │   │   ├── viewport/        # R3F scene, gizmos, loaders (BufferGeometry consumers)
│   │   │   ├── editors/         # per-format panels (terrain, datatable, shader graph…)
│   │   │   ├── state/           # Zustand stores
│   │   │   └── api/             # typed wrapper over window.api (control + data ports)
│   │   ├── preload.ts          # contextBridge surface, MessagePort handshake
│   │   └── package.json        # depends on @swg/contracts
│   │
│   └── contracts/              # ← shared TS types: IPC payloads, buffer schemas,
│       └── src/                #   SharedArrayBuffer byte-offset layout, opcodes.
│                               #   Single source of truth across all three runtimes.
│
├── blender-plugin/            # ← Python bpy addon (NOT an npm workspace)
│   ├── __init__.py            # register/unregister, panels, operators
│   ├── bridge/                # websocket-client dispatch, coord conversion
│   └── pyproject.toml
│
├── apps/ (optional)
│   └── mcp-server/            # MCP entry importing @swg/backend service layer
│
└── tools/                     # build scripts, fixture extraction, codegen
```

### Structure Rationale

- **`contracts/` is the keystone.** Three runtimes (renderer, backend, blender) plus the native addon all agree on byte-offset layouts, opcode tables, and IPC payload shapes. Defining them once kills an entire class of "the matrix is column-major on one side and row-major on the other" bugs — exactly the failure mode that sinks zero-copy designs.
- **`native-core` is its own workspace** so it builds and is unit-tested independently of Electron. You want to run IFF round-trip tests in CI without spinning a window. This is also where the format-verification work (the project's #1 risk) is contained.
- **`backend` vs `renderer` split mirrors the process boundary.** The addon reference, all OS handles, and the `SharedArrayBuffer` allocation live in `backend`; `renderer` is pure UI and can stay sandboxed. This is the single most important structural decision and the docs' three-layer diagram already implies it.
- **Blender plugin in-repo, out-of-workspace.** Atomic commits across the bridge protocol on both sides, but Python tooling stays out of the JS dependency graph.
- **MCP server imports the backend service layer**, not the UI. AI and UI call the same functions; no logic is duplicated or UI-coupled.

---

## Architectural Patterns

### Pattern 1: Backend service layer as the single API surface (UI ⊂ MCP ⊂ services)

**What:** Every capability (open file, parse mesh, pack TRE, inject transform) is a backend *service function*. The renderer's `window.api`, the MCP tools, and the Blender bridge handlers are all thin adapters over the same service functions.
**When to use:** Always, from day one — retrofitting this later is expensive.
**Trade-offs:** One extra indirection layer; pays for itself the moment the MCP layer or a second UI surface appears (and the project explicitly wants both UI and MCP).

```typescript
// packages/backend/src/services/mesh.ts — one definition, three consumers
export async function loadSwgMesh(path: string): Promise<MeshBuffers> { /* calls native-core */ }
// renderer: ipcMain.handle('mesh:load', (_, p) => loadSwgMesh(p))
// mcp:      tool('load_swg_mesh', ({path}) => loadSwgMesh(path))
// blender:  on 'export:mesh_geometry' → compileMeshToMsh(...)
```

### Pattern 2: Zero-copy buffer hand-off, mutate-in-place in hot loops

**What:** C++ returns `Napi::ArrayBuffer`/typed arrays; the renderer feeds them straight into `BufferGeometry` attributes and *reuses* the geometry on reload rather than recreating it. Math objects (`Vector3`/`Matrix4`) are module-level singletons in `useFrame`.
**When to use:** All geometry/texture/audio/terrain paths; all per-frame code.
**Trade-offs:** Manual lifetime discipline (who owns the backing buffer, when is it safe to overwrite). Document buffer ownership in `contracts/`.

### Pattern 3: Async N-API workers — never block the V8 thread

**What:** Decompression and deep IFF walks run on `Napi::AsyncWorker` / libuv threadpool; results delivered via promise or `ThreadSafeFunction`. The control channel is `async` end-to-end.
**When to use:** Any parse/decompress/pack of a non-trivial file; the packet sniffer (separate hook thread → `ThreadSafeFunction`).
**Trade-offs:** Thread-safety burden in C++. The high-frequency injection *patch* itself is deliberately a fast synchronous call (it only memcpy's 64 bytes + one syscall) — async would add latency the live loop can't afford.

### Pattern 4: Mount registry with priority override (TRE semantics in the backend)

**What:** The backend keeps an ordered TRE mount list; path lookups resolve top-down so a patch archive shadows retail trees — mirroring the client's `[ResourceSystem] searchTree=` ordering. The changeset consolidator (`docs` §12) flattens layers newest-wins using the same rule.
**When to use:** The virtual-filesystem core; mod packaging; changeset rollback.
**Trade-offs:** Lookup cost grows with mount count; cache resolved paths.

---

## Data Flow

### Open-and-render flow (control + data)

```
[User opens human_m.msh]
   renderer → window.api.loadSwgMesh(path)         (control: invoke, JSON)
      → backend service → native-core (async worker: TRE seek → zlib → IFF walk)
        → returns {vertexBuffer, indexBuffer} as ArrayBuffers
      → backend postMessage(..., [transfer buffers]) (data: zero-copy transfer)
   renderer → new Float32Array(vertexBuffer) → BufferGeometry.setAttribute(...)
```

### Live-edit flow (the killer feature)

```
[Drag gizmo @ 60fps]
   R3F onObjectChange → matrix.toArray(sharedFloatView)   (renderer writes SAB directly)
      → port.postMessage({objectId, address})             (1-int control ping, throttled to rAF)
   backend signalMemoryPatch → WriteProcessMemory(addr, sharedBuffer, 64)
      → object moves in live SWGClient.exe  (~sub-ms)
```

### Blender round-trip flow

```
[Blender: Compile Timeline to .ANS]
   bpy operator → ws://localhost:9012 (JSON: channels[])
      → backend bridge handler → native-core SerializeAnimationTrack (inside-out IFF)
        → .ans ArrayBuffer → workspace changeset → TRE pack → (optional) live inject
```

---

## Dependency-Driven BUILD ORDER

This is the spine for roadmap phasing. Ordered by *what must exist before the next thing can be tested*. The root is unambiguous: **IFF read/write primitives.**

| Order | Build | Depends on | Unblocks | Notes for roadmap |
|------|-------|-----------|----------|-------------------|
| **0** | Monorepo skeleton + `contracts/` + addon builds & loads in Electron, prints "hello" over IPC | — | everything | Prove the *whole pipeline wiring* (C++ → N-API → backend → preload → renderer) with a trivial function **before** any real format work. De-risks the build system, ASAR-unpack, and the process model in one shot. |
| **1** | `iff` read/write primitives (+ round-trip unit tests) | 0 | every parser/serializer | The dependency root. Verify byte layout against `swg-client-v2` here — this is where the #1 project risk is retired. |
| **2** | `tre` mount + decompress + the asset-pipeline (TRE→IFF→buffer) | 1 | reading any real asset | Gives you a virtual filesystem over installed clients (`D:/SWG Infinity`, SWGEmu). First "real data" milestone. |
| **3** | `msh`/appearance parser → zero-copy buffers → **R3F viewport renders a real SWG mesh** | 1, 2, + renderer/data-channel wiring | the entire visual editor; validates the zero-copy contract end-to-end | This is the MVP proof — `PROJECT.md`'s "core engine (TRE mount + IFF + mesh viewer) is the foundation everything else depends on." |
| **3b** | `inject` module: attach + single-object transform patch (can run in parallel with 1–3) | 0 + Win32 only | live sync | **Independent of the format tower** — only needs a matrix buffer and a discovered address. Start the address-discovery / Utinni-mining work early since it's the differentiator and the hardest to validate. |
| **4** | `tre` **pack** + `SwgCfgManager` + "Publish Mod" | 1, 2 | the round-trip modder loop | Closes "idea → deployed .tre". Pairs with workspace/changeset state in `backend`. |
| **5** | Live sync wired to the viewport gizmo (SharedArrayBuffer data channel) | 3, 3b | WYSIWYG editing | Connects the two independently-built halves. Needs the cross-origin-isolation + MessagePort plumbing from Refinement 1. |
| **6** | Skeletons/animation parsers; Blender WebSocket bridge + `.ans` compiler | 1, 2, (3 for preview) | rig/animation workflow | Bridge is decoupled; can be developed against fixtures before injection is solid. |
| **7** | Remaining format editors (terrain, flora, datatables, strings, shaders, collision, world snapshots…) | 1, 2, 3 | breadth | Each is an independent leaf on the `iff` root — parallelizable across contributors once 1–3 exist. |
| **8** | Recast/Detour navmesh; Core3 server parity; MCP server | 2 (assets), 7 (datatables) | advanced/preservation features | Navmesh and MCP are independent islands; sequence by value, not dependency. |

**The single most important ordering fact:** steps 1→2→3 are a hard chain (you cannot render a mesh you cannot read out of a TRE you cannot mount using IFF primitives you don't have), but **3b (injection) and 6 (Blender bridge) branch off early and run in parallel.** The roadmap should not serialize the differentiator behind the entire format-parsing tower.

---

## Scaling Considerations

This is a single-user desktop app; "scale" means **asset volume and frame budget**, not concurrent users.

| Scale | Architecture adjustments |
|-------|--------------------------|
| One small mod / few files | In-memory mount + naive parse is fine. |
| A full client's TRE set (GBs, 100k+ virtual files) | Lazy mount index (don't decompress until accessed); LRU buffer cache in backend; stream large meshes off the main thread. Mount-lookup path cache becomes necessary. |
| Dense world scene (thousands of objects @ 60 fps) | `InstancedMesh` for foliage/spawns; reuse `BufferGeometry`/math objects; throttle live-inject pings to `rAF`; keep all parsing on async workers so the frame loop never stalls. |

### Scaling Priorities
1. **First bottleneck: V8 main-thread stalls on large parses.** Fix = async N-API workers (already mandated). Detect via dropped-frame profiling on big `.trn`/`.msh` loads.
2. **Second bottleneck: GC churn in the render loop.** Fix = object reuse / instancing. Detect via sawtooth heap graphs.
3. **Third: TRE mount index memory for full client sets.** Fix = lazy index + LRU eviction.

---

## Anti-Patterns

### Anti-Pattern 1: Loading the native addon in the renderer / disabling the sandbox
**What people do:** Set `nodeIntegration: true` / `sandbox: false` so the React canvas can `require('./swg_native_core.node')` directly.
**Why it's wrong:** Forfeits Electron's security model and still doesn't give the renderer safe access to OS process handles. It also couples UI lifecycle to native lifetime.
**Do this instead:** Addon lives in main/utility; renderer reaches it only through the `contextBridge` `window.api` and the `MessagePort` data channel.

### Anti-Pattern 2: JSON-serializing binary payloads
**What people do:** `JSON.stringify` a vertex/terrain/texture array to cross IPC.
**Why it's wrong:** Stalls/crashes the V8 main thread on large files — the doc's single loudest rule.
**Do this instead:** Transfer `ArrayBuffer`s (transfer list) or write into a `SharedArrayBuffer`; JSON only for small structure/metadata.

### Anti-Pattern 3: Serializing the live-edit loop behind the format tower
**What people do:** Plan injection as a "phase after all parsers are done."
**Why it's wrong:** The injection module depends only on Win32, not on `iff`/`tre`; gating it loses the project's differentiator and defers its hardest validation (per-build address discovery) to the worst possible time.
**Do this instead:** Branch injection (step 3b) in parallel with the format chain; validate addresses against the running client and Utinni early.

### Anti-Pattern 4: Hard-coupling C++ structs to UI panels (the Utinni mistake)
**What people do:** Mirror C++ struct layouts directly into UI components.
**Why it's wrong:** Exactly the rigidity the rewrite exists to escape; any format change ripples into the UI.
**Do this instead:** C++ emits buffers + small JSON described by `contracts/`; UI is schema-driven and decoupled.

### Anti-Pattern 5: Two build systems for the addon
**What people do:** Mix `binding.gyp` (node-gyp) and `CMakeLists.txt` (cmake-js) as the module grows to include Recast, zlib, Detours.
**Why it's wrong:** Diverging include/link config; CI breakage. Recast/Detour/Detours integrate far more cleanly under CMake.
**Do this instead:** Pick one (cmake-js recommended for the multi-library native target) and standardize across CI and `electron-forge make`.

---

## Integration Points

### External Processes / Tools

| Target | Integration Pattern | Notes |
|--------|---------------------|-------|
| `SWGClient.exe` (live) | `OpenProcess`/`WriteProcessMemory` + Detours socket hooks, in the C++ core | Windows-only; per-build addresses; validate against Utinni. Gate behind a Windows feature flag. |
| Blender | WebSocket `localhost:9012`, JSON + raw float arrays | Decoupled sidecar in the Node backend; never touches the renderer or sandbox. |
| Core3 / SWGEmu server | File/Lua parity + (per docs) a remote daemon | Reads/writes shared `.iff`/`.tre`/Lua; sequence after datatable editing exists. |
| Installed clients (Infinity, SWGEmu) | Read-only TRE mount sources | First real test fixtures for steps 2–3. |
| Community offline tools (glTF export) | Out-of-band hybrid pipeline for final exports | Runtime pipeline for browsing; offline for polished exports. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| renderer ↔ backend | `contextBridge` + `ipcRenderer.invoke` (control) and `MessagePort`+`SharedArrayBuffer` (data) | The one boundary that must be airtight; types live in `contracts/`. |
| backend ↔ native-core | `node-addon-api` direct call; async via `AsyncWorker`/`ThreadSafeFunction` | Hand-written `index.d.ts` is the contract. |
| backend ↔ Blender plugin | WebSocket JSON | Versioned message protocol shared in `contracts/` (and mirrored in Python). |
| backend ↔ MCP | In-process import of the service layer | MCP reuses, never reimplements, services. |

---

## Sources

- `docs/00-overview/architecture.md`, `docs/01-core-engine/iff-and-tre.md`, `docs/04-live-sync/live-memory-and-ipc.md`, `docs/07-blender/blender-integration.md`, `docs/06-workflow/packaging-and-distribution.md`, `docs/00-overview/tech-stack.md`, `.planning/PROJECT.md` (project-internal, AI-distilled — architecture HIGH confidence, binary layouts unverified by design)
- [Process Model | Electron](https://www.electronjs.org/docs/latest/tutorial/process-model) — main/renderer/utility process boundaries (HIGH)
- [Process Sandboxing | Electron](https://www.electronjs.org/docs/latest/tutorial/sandbox) — native modules cannot load in a sandboxed renderer; disabling sandbox discouraged (HIGH)
- [Context Isolation | Electron](https://www.electronjs.org/docs/latest/tutorial/context-isolation) and [contextBridge | Electron](https://www.electronjs.org/docs/latest/api/context-bridge) — the only safe renderer surface (HIGH)
- [Inter-Process Communication | Electron](https://www.electronjs.org/docs/latest/tutorial/ipc) — `MessageChannel`/`postMessage`, transfer lists, structured clone limits (HIGH)
- [electron/electron #10409 — sending SharedArrayBuffer between processes](https://github.com/electron/electron/issues/10409) and [#45034 — sharing buffers main→renderer](https://github.com/electron/electron/issues/45034) — confirms SAB/MessagePort cross-process transfer mechanism (MEDIUM, issue-thread)
- [Electron Forge](https://www.electronforge.io/) (Context7 `/websites/electronforge_io`, score 80) — `.node` ASAR unpack, Vite plugin, Squirrel maker (HIGH)

---
*Architecture research for: SWG modding suite (Electron + N-API C++ + R3F + Blender bridge)*
*Researched: 2026-06-21*
