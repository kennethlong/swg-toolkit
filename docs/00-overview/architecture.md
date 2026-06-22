# Target Architecture

> Covers: the layered stack, end-to-end data flow, the N-API binary bridge contract, and the React 3D ecosystem.
> Source: research doc lines 79–135, 207–239, 594–613 (synthesized).

## The layered stack

```
┌────────────────────────────────────────────────────────┐
│                   React + TypeScript                   │  ← 100% custom extensible UI
│   (Tailwind CSS, Radix UI, Three.js / R3F / WebGL)     │
└───────────────────────────┬────────────────────────────┘
                            │ JSON (control) / ArrayBuffer (data) over IPC
┌───────────────────────────▼────────────────────────────┐
│                     Node.js Backend                    │  ← state machine, file watchers,
│   (virtual workspaces, TRE mounting, cache, plugins)   │     plugin routing
└───────────────────────────┬────────────────────────────┘
                            │ N-API C++ bindings (node-addon-api)
┌───────────────────────────▼────────────────────────────┐
│                   Custom C++ Core                      │  ← SWG client parsing logic,
│  (IFF parse, TRE (de)compression, CRC, memory I/O)     │     reused from swg-client-v2
└────────────────────────────────────────────────────────┘
```

**Why this shape:** the C++ core reuses real client parsing logic and does all the CPU/memory-heavy work; Node orchestrates workspaces and routing; React renders a flexible, hot-reloadable UI. This replaces SIE's native DirectX-into-HWND renderer and Utinni's hard-linked C++ struct → WinForms panel coupling.

### Structural advantages over the legacy tools

| Concern | Legacy (SIE / Utinni) | This toolkit |
|---------|-----------------------|--------------|
| UI engine | C# WinForms / embedded hooks | React + TypeScript + Tailwind |
| 3D rendering | Native DirectX / window injection (`JodelEngine.dll`) | Three.js / WebGL / WebGPU in-canvas |
| Hot reloading | Restart or fragile injection | Vite fast refresh |
| Data flow | Hard-linked C++ structs → UI panels | Binary buffers + schema-validated JSON |

## End-to-end data flow

```
[ SWG Client / live memory ] ◀── memory injection ──▶ [ C++ core (N-API) ]
                                                              │
                                                   ArrayBuffer / SharedArrayBuffer
                                                              │
                                                              ▼
[ React UI (Zustand) ] ◀── state ──▶ [ TypeScript API layer ] ──▶ [ Three.js viewport ]
```

Two distinct channels, by frequency (detailed in [`../04-live-sync/`](../04-live-sync/)):

1. **Control channel** — JSON over async N-API. Low-frequency, heavy actions: load a file, parse a manifest, pick a palette index, run a compile/pack.
2. **Data channel** — `SharedArrayBuffer`. High-frequency, real-time actions: dragging a transform gizmo at 60 fps and patching live game memory with zero serialization overhead.

## The N-API binary-bridge contract

The single most important rule of the whole system:

> **Never serialize large binary payloads (vertices, textures, terrain, audio) to JSON.** It crashes the V8 main thread on big files. Pass raw `Napi::ArrayBuffer` / `Napi::Buffer` / typed arrays (`Float32Array`, `Uint16Array`, `Int32Array`) directly; consume them straight into Three.js `BufferGeometry` attributes or Web Audio buffers.

Bridge conventions used throughout the docs:
- **IFF chunks → nested JS objects** for structure/metadata (small, fine as JSON).
- **Geometry/animation/texture/terrain payloads → typed arrays / `ArrayBuffer`** (zero-copy).
- **Heavy work → async C++ worker threads**, never the main thread, so the React UI never freezes during decompression or deep IFF walks.
- **64-bit memory pointers → `BigInt`** across the boundary (to preserve full address width for live injection).

## React 3D ecosystem

Building raw Three.js inside React produces messy lifecycle code. Standardize on:

1. **React Three Fiber (R3F)** — declarative Three.js as React components; clean scene-graph, visibility, and component-based game objects.
2. **@react-three/drei** — helpers: `TransformControls`, `OrbitControls`, camera rigs, in-canvas HTML overlays (nameplates, debug HUDs).
3. **Zustand** — lightweight state that works both in the React render cycle and inside high-frequency R3F `useFrame` loops, so the properties panel and the 3D canvas stay in sync without re-render storms.

**Three.js capabilities to keep in reach.** Beyond the SWG-specific pipelines documented elsewhere, Three.js offers building blocks worth remembering as features are scoped: standard model **loaders** (glTF/FBX/OBJ — useful for reference imports), **morph targets / shape keys** (relevant if a character-customization slider system is built), **procedural mesh generation**, **instanced rendering** (already leaned on for foliage/spawns), and **cinematic post-processing** (bloom, DoF, ambient occlusion). Not all are near-term, but morph targets in particular map cleanly onto SWG character customization.

## Performance principles (apply everywhere)

- **Keep the main thread free.** All decompression/parsing in async C++ workers.
- **Reuse, don't allocate, in hot loops.** Don't `new` Three.js `Vector3`/`Matrix4` per frame; reuse globals. SWG scenes have thousands of small objects — GC churn = frame drops.
- **Zero-copy buffers, mutate in place.** Don't destroy/recreate geometry on chunk reload; reuse `BufferGeometry` and overwrite attribute arrays.
- **Instance everything repeated.** Foliage, spawn markers, crowds → `InstancedMesh`.
- **Throttle high-frequency IPC** to the client's frame/input boundary (e.g. `requestAnimationFrame`-gated transform pushes).

## App shell

The desktop shell is **Electron Forge** (recommended over Tauri for this project: Electron's built-in Node.js runtime executes the native C++ addon directly, whereas Tauri would require bridging C++ data through a Rust middleware layer). See [`../06-workflow/packaging-and-distribution.md`](../06-workflow/packaging-and-distribution.md).

---

## Electron process model (corrected)

> Source: [`../../.planning/research/ARCHITECTURE.md`](../../.planning/research/ARCHITECTURE.md) — validated 2026-06-21.

### Native addon placement (Path B — as built in Phase 0)

> **CONFIRMED (2026-06-22, Plan 00-03).** Evidence: [CONSULT-P0SAB-SYNTHESIS.md](../../.planning/research/CONSULT-P0SAB-SYNTHESIS.md) + [00-03-SUMMARY.md](../../.planning/phases/00-toolchain-de-risk-app-shell/00-03-SUMMARY.md).

Under **Path B** (adopted for Phase 0 and beyond), the compiled `.node` addon loads **in the renderer process** — not in a separate utility or main process. The Electron window is created with `sandbox: false` so `require()` is available, and the renderer calls `require('@swg/native-core')` directly. No IPC, no MessagePort hop for the data path.

**Posture in effect (fallback B — proven by running):** `sandbox:false + nodeIntegration:true + contextIsolation:false`. The preferred posture (`sandbox:false + contextIsolation:true + preload contextBridge`) was attempted first and failed empirically: `contextBridge.exposeInMainWorld()` uses the structured-clone algorithm to transfer values across the isolated-world boundary, and a `SharedArrayBuffer` allocated by C++ in the preload's agent cluster cannot be cloned into the renderer main world's agent cluster — same root cause as the cross-process finding (see below). Use of the fallback posture is a deliberate maintainer decision documented in [00-REPLAN.md](../../.planning/phases/00-toolchain-de-risk-app-shell/00-REPLAN.md).

**Residual risk:** A native crash takes the renderer (no crash-isolation boundary). Accepted for SWG-Toolkit as a trusted local desktop tool. If an untrusted web content pane is added in future, it must use a separate `BrowserWindow` with `sandbox:true`.

### SharedArrayBuffer data channel — CONFIRMED NEGATIVE (cross-process path FALSIFIED 2026-06-22)

> **CONFIRMED NEGATIVE — FALSIFIED (2026-06-22).** The previous claim that a `SharedArrayBuffer`
> backing store could be shared zero-copy between an Electron Node process (main or utility) and the
> renderer is **impossible in Electron 42**. Every IPC/MessagePort path throws
> `Error: An object could not be cloned` for a SAB. Root cause: a SAB is namable only within one
> agent cluster / V8 process cage; the Node main and utility processes are not in the renderer's
> cluster. This is mandated by the HTML structured-clone spec and confirmed by the Electron C++ source
> (`shell/common/v8_util.cc SerializeV8Value`). Evidence: 4-way cross-AI convergence + measured A/B
> performance in [CONSULT-P0SAB-SYNTHESIS.md](../../.planning/research/CONSULT-P0SAB-SYNTHESIS.md).
>
> **Additional runtime finding (same root cause):** `contextBridge.exposeInMainWorld()` (same renderer
> PROCESS, but preload isolated-world → main world) also CANNOT carry a C++ `SharedArrayBuffer`.
> Structured-clone at the isolated-world boundary enforces the same agent-cluster restriction. Verified
> at runtime in Plan 00-03 (throws "An object could not be cloned").

**Two real transport options (characterized by Phase 0 A/B spike):**

**Path A — IPC ArrayBuffer copy (~450 MB/s, sandbox-preserving).** Utility/main process passes bytes to the renderer over a MessagePort as a transferable `ArrayBuffer`. This is a **copy** (not a move; `sourceDetached` remains `false`), bounded at ~450–490 MB/s. Adequate for delta/changed-region sync (≤1 MB/frame → comfortable 60fps). Not viable for large full-frame streaming (16 MB/frame → ~29fps ceiling). Keeps utility crash-isolation and renderer sandbox.

**Path B — Native-in-renderer, in-process zero-copy (~10,600 MB/s, CHOSEN for Phase 0).** The C++ addon loads in the renderer process, allocates the `SharedArrayBuffer` there, and the renderer reads the same memory with no IPC and no copy. Proof (all assertions passed, 2026-06-22):
- `crossOriginIsolated=true` (COOP/COEP active — independent of nodeIntegration/sandbox)
- C++ `writeSab(sab, 0, 0xDEAD)` → `Int32Array(sab)[0] === 0xDEAD` (C++ → JS same memory)
- Renderer writes nonce → `readSab(sab, 1)` sees it (JS → C++ same memory)
- Web Worker shares the same C++ SAB (intra-cluster Worker share)

**Cross-origin isolation is mandatory.** `SharedArrayBuffer` requires `crossOriginIsolated === true` in the renderer. Enable it by setting the following headers on all Electron responses:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Verify at runtime with `if (!crossOriginIsolated) throw new Error('COOP/COEP not active')`.

### C++ core module split

The monolithic "C++ core" should be decomposed into focused modules for maintainability and independent testing:

| Module | Responsibility |
|--------|---------------|
| `iff` | IFF chunk parsing and serialization |
| `tre` | TRE archive mounting, CRC, zlib decompression |
| `formats` | Format-specific parsers (mesh, terrain, collision, etc.) |
| `inject` | Win32 `OpenProcess` / `WriteProcessMemory` live injection |
| `navmesh` | Recast & Detour navmesh voxelization |

### Recommended monorepo structure

Use **pnpm workspaces** with the following packages:

```
packages/
  native-core/   ← C++ addon (node-addon-api, cmake-js, prebuildify)
  backend/       ← Electron main + utility process, file watchers, plugin routing
  renderer/      ← React + Vite UI
  contracts/     ← Shared TypeScript types (the keystone package imported by all)
blender-plugin/  ← In-repo but out-of-workspace (Python/bpy, no npm)
mcp-server/      ← Optional; separate workspace package if included
```

The `contracts/` package is the single source of truth for all IPC message shapes, buffer schemas, and shared enums. Every other package imports from it — never from each other directly.
