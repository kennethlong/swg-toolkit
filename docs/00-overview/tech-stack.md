# Tech Stack & Key Decisions

> Consolidates the technology choices that recur across the design docs, with rationale. Source: synthesized from the full research transcript.

These are **proposed defaults**, strong but not locked. Revisit during planning against the real reference projects.

## Stack at a glance

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Desktop shell | **Electron Forge** | Built-in Node.js runtime executes the native C++ addon directly; Tauri would need a Rust bridge for the C++ data path. See [packaging](../06-workflow/packaging-and-distribution.md). |
| UI framework | **React 19 + TypeScript** | Component model, huge ecosystem, type safety across the binary bridge. |
| Build/dev | **Vite** | Fast refresh; instant UI iteration vs. legacy restart-to-test. |
| Styling | **Tailwind CSS + Radix UI** | Utility-first dark IDE aesthetic; accessible primitives. See [workspace layout](../08-ui-ux/workspace-layout.md). |
| 3D | **Three.js + React Three Fiber + @react-three/drei** | Declarative scene graph; `TransformControls`/`OrbitControls`/overlays out of the box. |
| State | **Zustand** | Works in both the React render cycle and high-frequency R3F `useFrame` loops without re-render storms. |
| Native bridge | **Node-API via `node-addon-api`** | Stable ABI; zero-copy `ArrayBuffer`/typed-array hand-off; async worker threads. |
| Native core lang | **C++** (reusing `swg-client-v2` logic) | Reuse real client IFF/TRE parsing; raw memory I/O for live injection. |
| Compression | **zlib** (TRE), **stb_image / DirectXTex** (DDS→PNG/WebP) | Standard, embeddable. |
| Nav/collision | **Recast & Detour** | Industry-standard navmesh voxelization. See [collision](../02-formats/collision-and-portals.md). |
| Docking UI | **Golden Layout** | Persistent drag/dock panels for the studio workspace. |
| Node graph UI | **React Flow** | The visual shader/material editor. See [shaders](../03-rendering/shaders-and-fx.md). |
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

- **Electron vs. Tauri** — recommended Electron, but confirm against the C++ addon loading story you want.
- **Monorepo layout** — how to organize the C++ addon, Node backend, React app, and Blender plugin (likely a workspace/monorepo).
- **Which formats are MVP** vs. later — the design covers ~40 formats; the roadmap must sequence them (start with TRE mount + IFF + mesh viewer).
- **Cross-platform scope** — memory injection is Windows-specific; decide how much of the editor is cross-platform vs. Windows-only.
- **Charting / node-graph library** specifics — pick concrete versions.
