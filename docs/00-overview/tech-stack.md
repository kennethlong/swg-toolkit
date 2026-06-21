# Tech Stack & Key Decisions

> Consolidates the technology choices that recur across the design docs, with rationale. Source: synthesized from the full research transcript.
>
> **Version-pinned reference (verified 2026-06-21):** [`../../.planning/research/STACK.md`](../../.planning/research/STACK.md) is the authoritative source for all library versions listed below. The corrections in this section supersede any stale names in other design docs.

These are **proposed defaults**, strong but not locked. Revisit during planning against the real reference projects.

## Stack at a glance

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Desktop shell | **Electron 42** (via Electron Forge or `electron-vite` + `electron-builder` — see open decisions) | Built-in Node.js runtime executes the native C++ addon directly; Tauri would need a Rust bridge for the C++ data path. See [packaging](../06-workflow/packaging-and-distribution.md). |
| UI framework | **React 19.2 + TypeScript 6** | Component model, huge ecosystem, type safety across the binary bridge. (TypeScript 7 / tsgo is not yet production-ready.) |
| Build/dev | **Vite** | Fast refresh; instant UI iteration vs. legacy restart-to-test. |
| Styling | **Tailwind v4 + Radix UI** | Tailwind v4 uses a Vite plugin and CSS `@theme` — there is **no `tailwind.config.js`** and **no PostCSS** step. Utility-first dark IDE aesthetic; accessible primitives. See [workspace layout](../08-ui-ux/workspace-layout.md). |
| 3D | **Three.js 0.184 + @react-three/fiber 9 + @react-three/drei 10** | These three packages move in **lockstep** — pin all three together. Declarative scene graph; `TransformControls`/`OrbitControls`/overlays out of the box. |
| State | **Zustand 5** | Works in both the React render cycle and high-frequency R3F `useFrame` loops without re-render storms. |
| Native bridge | **`node-addon-api` 8** built with **cmake-js**, distributed via **prebuildify** | Stable ABI; zero-copy `ArrayBuffer`/typed-array hand-off; async worker threads. `memoryjs` (semi-abandoned) and `ffi-napi` (dead) are explicitly avoided. |
| Native core lang | **C++** (reusing `swg-client-v2` logic) | Reuse real client IFF/TRE parsing; raw memory I/O for live injection. **Memory injection calls Win32 directly in the C++ N-API core** — it is not a JS FFI lib. |
| Compression | **zlib** (TRE), **stb_image / DirectXTex** (DDS→PNG/WebP) | Standard, embeddable. |
| Nav/collision | **Recast & Detour** | Industry-standard navmesh voxelization. See [collision](../02-formats/collision-and-portals.md). |
| Docking UI | **`dockview`** | Zero-dependency, React-native docking with multi-monitor popout windows. Replaces the previously noted "Golden Layout". |
| Node graph UI | **`@xyflow/react` v12** | React Flow's current package name. The visual shader/material editor. See [shaders](../03-rendering/shaders-and-fx.md). |
| Charts | charting lib (e.g. Recharts/visx) | DPS/balance curves. See [datatables](../02-formats/datatables-and-strings.md). |
| Versioning | **Git + Git LFS** | Large binary mod assets (.tre/.trn/.fld). See [version control](../06-workflow/version-control-and-backup.md). |
| Blender bridge | **WebSocket** + Blender **Python (bpy)** | Decoupled inter-app link. See [blender](../07-blender/blender-integration.md). |
| AI / agent layer | **MCP server + Claude models** | Tool-wrap the toolkit; AI where it adds value. See [AI & MCP](../09-ai-mcp/ai-and-mcp-integration.md). |

## Non-negotiable architectural rules

These come up everywhere and are the spine of the design (full detail in [architecture.md](architecture.md)):

1. **Binary stays binary.** Geometry, textures, audio, terrain → zero-copy `ArrayBuffer`/`SharedArrayBuffer`/typed arrays, never JSON. Structure/metadata → small JSON is fine.
2. **Heavy work off the main thread.** Decompression and deep IFF walks run in async C++ workers so the UI never freezes.
3. **Reuse in hot loops.** No per-frame allocation of Three.js math objects; mutate geometry attributes in place.
4. **Two IPC channels by frequency.** JSON control channel + SharedArrayBuffer data channel. See [live sync](../04-live-sync/live-memory-and-ipc.md).
5. **Verify formats against ground truth.** Treat AI-proposed binary layouts as drafts ([source provenance](source-provenance.md)).

## Open decisions to resolve during planning

- **Electron Forge Vite plugin vs. `electron-vite` + `electron-builder`** — Electron Forge's Vite plugin is still marked "experimental"; `electron-vite` + `electron-builder` is the mature, battle-tested fallback. Decide in Phase 0.
- **Monorepo layout** — recommended: **pnpm workspaces** with packages `native-core`, `backend`, `renderer`, and a keystone `contracts/` shared-types package; Blender plugin lives in-repo but out-of-workspace; optional `mcp-server` package. See [architecture.md](architecture.md).
- **Which formats are MVP** vs. later — the design covers ~40 formats; the roadmap must sequence them (start with TRE mount + IFF + mesh viewer).
- **Cross-platform scope** — memory injection is Windows-specific; decide how much of the editor is cross-platform vs. Windows-only.
