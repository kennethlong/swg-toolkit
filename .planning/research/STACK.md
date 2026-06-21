# Stack Research

**Domain:** Cross-platform Electron desktop app — game-asset modding suite with React 19 + TS frontend, Three.js/R3F 3D viewport, and a C++ Node-API native core (proprietary binary parsing + Win32 live-memory injection)
**Researched:** 2026-06-21
**Confidence:** HIGH (versions verified against npm registry + official docs/release schedules; build-tooling and injection recommendations MEDIUM-HIGH)

---

## TL;DR — Verdict on the Proposed Stack

The proposed stack in `docs/00-overview/tech-stack.md` is **fundamentally sound and well-chosen.** Electron + React 19 + TS + node-addon-api + Three.js/R3F + Zustand is exactly the right shape for this problem, and the "binary stays binary / heavy work off-thread / N-API zero-copy" architecture is correct. Validate and ship it.

**Seven changes/pins the docs should adopt:**

1. **Docking UI: replace Golden Layout with `dockview`.** Golden Layout is React-hostile (imperative, aging); dockview is zero-dependency, first-class React, actively maintained, and purpose-built for IDE layouts. **(HIGH)**
2. **Node-graph UI: pin `@xyflow/react` v12, NOT `reactflow`.** `reactflow` (v11) is the deprecated old package name. The maintained package is `@xyflow/react`. **(HIGH)**
3. **C++ build tool: commit to `cmake-js` (not node-gyp), distribute with `prebuildify` + `node-gyp-build`.** This is the only realistic path given you're reusing `swg-client-v2` C++ (almost certainly CMake-based) and shipping a binary to non-developers who must not need a compiler. **(HIGH)**
4. **Memory injection lives IN the C++ N-API core, NOT a JS FFI library.** Do not pull in `memoryjs` (semi-abandoned, node-gyp-only) or `koffi`/`ffi-napi`. You already have Utinni's C++ injection logic to harvest; call `OpenProcess`/`ReadProcessMemory`/`WriteProcessMemory` directly from the addon and hand 64-bit pointers across as `BigInt`. **(HIGH)**
5. **Tailwind is now v4 with a different setup.** Use the official `@tailwindcss/vite` plugin (Rust "Oxide" engine, no PostCSS/autoprefixer, CSS-first `@theme` config). The docs' v3 mental model (`tailwind.config.js`, three `@tailwind` directives) is obsolete. **(HIGH)**
6. **Pin TypeScript to 6.x, watch (do not yet adopt) TS 7 / `tsgo`.** TS 7.0 (Go-native compiler) is at RC as of June 2026 — fast, but not GA. **(HIGH)**
7. **Flag the Electron Forge + Vite risk.** Forge's Vite plugin has been "experimental" for a long time. It works, but `electron-vite` (Vite-native, mature) is a credible fallback if the Forge+Vite+native-addon combination fights you. Decide deliberately during planning. **(MEDIUM)**

Nothing here invalidates the architecture. These are refinements + version pins.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Electron** | `~42.x` (latest stable line; 43 stable lands ~Jun 30 2026) | Desktop shell with a real Node.js runtime in-process | Its bundled Node runtime can `require()` the C++ N-API addon directly — no Rust/IPC bridge (which Tauri would force). Confirmed correct vs Tauri for this project. Electron 42 ships Node 22/24-class runtime + Chromium M148+. |
| **React** | `19.2.x` | UI component model | Mature, typed, vast ecosystem; R3F v9 specifically targets React 19. |
| **TypeScript** | `6.0.x` | Type safety across the whole binary bridge | Latest stable (released Mar 2026, the last JS-based compiler). Do **not** jump to TS 7/`tsgo` yet — RC only (Jun 2026), not GA. |
| **node-addon-api** | `8.8.x` | C++ wrapper over Node-API (N-API) | ABI-stable across Node/Electron versions (write once, don't recompile per runtime). Correct choice; gives zero-copy `Napi::ArrayBuffer`/`Napi::TypedArray` + `Napi::AsyncWorker` for the off-thread parsing the architecture mandates. |
| **C++** (core lang) | C++17 or C++20 | IFF/TRE parsing, CRC, zlib, Win32 memory I/O | Reuses real `swg-client-v2` parsing logic and Utinni injection logic; only language that can do raw `WriteProcessMemory` cheaply. |
| **Vite** | `~7.x` (8.x is bleeding edge) | Dev server + bundler for the renderer | Fast HMR = the "no restart to test" promise. Pin to the version your Electron-Forge-Vite (or electron-vite) integration officially supports rather than newest-of-newest. |
| **Three.js** | `0.184.x` | WebGL/WebGPU 3D engine | The viewport. Note: three.js has no 1.0 — every minor (`r###`) can carry breaking changes; pin exactly and upgrade deliberately. |
| **@react-three/fiber** | `9.6.x` | Declarative React renderer for Three.js | v9 is the React-19-compatible line (bundles its own reconciler to handle React 19.2's reconciler bump). Keeps Three.js scene-graph lifecycle out of hand-written `useEffect`s. |
| **@react-three/drei** | `10.7.x` | R3F helpers | `TransformControls`, `OrbitControls`, camera rigs, `<Html>` in-canvas overlays, `<Instances>`, gizmos — exactly the editor primitives the docs call for. Must match R3F v9 (drei 10 ↔ fiber 9). |
| **Zustand** | `5.0.x` | State store | Reads/writes from both the React render cycle AND R3F `useFrame` hot loops without triggering re-render storms — the specific reason it's chosen over Redux/Context. v5 is current. |

### Native Addon Build & Distribution Chain

| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| **cmake-js** | `8.0.x` | Builds the C++ addon via CMake | `swg-client-v2`/Core3 are CMake projects; cmake-js lets you reuse their CMake build graph and link the same libs (zlib, etc.). Cleaner than fighting `node-gyp`'s `binding.gyp` for a large existing C++ codebase. |
| **prebuildify** | `6.0.x` | Builds + bundles prebuilt binaries into the package | End users (modders) must NOT need Visual Studio / CMake installed. prebuildify bakes per-platform `.node` binaries in so install is download-only. |
| **node-gyp-build** | `4.8.x` | Runtime loader that picks the right prebuilt binary | The companion to prebuildify; resolves the correct prebuilt `.node` at `require()` time, falls back to source build only if no prebuild matches. |
| **@electron/rebuild** | latest (`4.x`) | Rebuilds native modules against Electron's ABI | Electron's V8/Node ABI differs from system Node; this (run via Forge/electron-vite hooks) ensures the addon loads inside Electron. node-addon-api's ABI stability minimizes but doesn't fully eliminate the need. |

### 3D / Viewport Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@react-three/drei** | `10.7.x` | (see core) gizmos, controls, overlays, instancing | Always — the viewport's standard toolkit. |
| **@recast-navigation/core** | `0.43.x` | Recast & Detour navmesh (WASM/JS bindings) | Collision/navmesh generation (`docs/02-formats/collision-and-portals.md`). JS bindings exist if you want navmesh in the renderer; otherwise link native Recast in the C++ core. Decide per use. |
| **three-stdlib** | latest | Stabilized Three.js examples (loaders, controls) | If you need glTF/FBX/OBJ reference-import loaders that drei doesn't re-export. Avoids deep-importing from `three/examples/jsm` (which moves between releases). |

### UI / Workspace Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **dockview** (or `dockview-react`) | `6.6.x` | IDE docking/panels (drag, tabs, groups, splits, floating, popout) | The studio workspace shell. **Replaces Golden Layout.** Zero deps, React-native, actively maintained, supports popout windows (useful for multi-monitor modding). |
| **@xyflow/react** (React Flow) | `12.x` | Node-graph editor | The visual shader/material editor (`docs/03-rendering/shaders-and-fx.md`). **Use this package name, not `reactflow`.** |
| **Radix UI** (`@radix-ui/react-*` primitives) | `1.1.x` per primitive | Accessible unstyled UI primitives (dialog, dropdown, tooltip, context-menu, tabs) | Pair with Tailwind for the dark IDE chrome. Prefer individual `@radix-ui/react-*` primitives over the all-in `@radix-ui/themes` (3.x) so you keep full Tailwind styling control. |
| **tailwindcss** | `4.3.x` + `@tailwindcss/vite` | Utility-first styling | The dark IDE aesthetic. v4 uses the Vite plugin + CSS `@theme` config (no `tailwind.config.js`, no PostCSS). |
| **Recharts** | `3.8.x` | Charts (DPS/balance curves) | Datatable/balance views. Simple, declarative, React-19-ready (v3). If you need denser/custom dataviz later, `visx` is the power-user alternative. |

### Compression / Texture / Codec (in the C++ core)

| Library | Purpose | Notes |
|---------|---------|-------|
| **zlib** | TRE archive (de)compression | Standard, embeddable, link in CMake. SWG TRE uses zlib. |
| **DirectXTex** | DDS → RGBA decode (BC1-7 / S3TC) | Windows-first, robust DDS/block-compression support; matches SWG's DDS textures. Decode in C++, hand raw `Uint8Array` to a Three.js `DataTexture`. |
| **stb_image** | PNG/JPG/TGA decode/encode | Single-header, trivial to embed; for non-DDS imports/exports and thumbnails. |
| **(optional) Compressonator / bcdec** | Cross-platform DDS/BCn decode | If you need DDS decode on Linux/macOS where DirectXTex isn't available. Keep texture decode behind one interface so the codec is swappable per-platform. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **Electron Forge** (`@electron-forge/cli` `7.11.x`) | End-to-end scaffold/build/package/sign/publish | Officially recommended toolchain. **Caveat:** its Vite plugin has long been flagged experimental — validate the Forge+Vite+native-addon path early (see risks). |
| **electron-vite** (`5.x`) | Vite-native Electron tooling (fallback) | If Forge's Vite integration fights the native addon, electron-vite is the mature Vite-first alternative. Pair with `electron-builder` for packaging. Decide one toolchain, don't mix. |
| **Vitest** (`4.x`) | Unit/integration tests (TS + Node backend) | Vite-native, fast, shares Vite config. Test the TS API layer, the N-API bridge contract (shapes/byte-layouts), and parsers against golden fixtures. |
| **Playwright** (`@playwright/test` `1.61.x`) | E2E / Electron app testing | Has first-class Electron support (`_electron.launch`) — drive the real app, assert on the viewport + IPC. The standard for Electron E2E. |
| **GoogleTest / Catch2** | C++ unit tests for the core | Test IFF/TRE parsers against ground-truth byte fixtures in C++ directly (fastest feedback for the riskiest, format-fidelity code). |
| **ESLint + Prettier (or Biome)** | Lint/format | Biome is a faster single-tool alternative if you want one Rust-based linter+formatter. |

---

## Installation

```bash
# --- Scaffold (Electron Forge + Vite + TS template) ---
npm init electron-app@latest swg-toolkit -- --template=vite-typescript
# (or: npm create @quick-start/electron  for the electron-vite path)

# --- Core UI ---
npm install react@^19.2 react-dom@^19.2 zustand@^5

# --- 3D viewport (versions must stay in lockstep: three ↔ fiber9 ↔ drei10) ---
npm install three@^0.184 @react-three/fiber@^9.6 @react-three/drei@^10.7
npm install -D @types/three

# --- Styling (Tailwind v4 + official Vite plugin; NO postcss/autoprefixer needed) ---
npm install tailwindcss@^4 @tailwindcss/vite

# --- UI primitives + workspace ---
npm install dockview                       # IDE docking (replaces golden-layout)
npm install @xyflow/react@^12              # node graph (NOT 'reactflow')
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
            @radix-ui/react-tooltip @radix-ui/react-context-menu @radix-ui/react-tabs
npm install recharts@^3

# --- Native C++ addon toolchain ---
npm install node-addon-api@^8 node-gyp-build@^4
npm install -D cmake-js@^8 prebuildify@^6 @electron/rebuild

# --- Optional: navmesh in JS (else link native Recast in the addon) ---
npm install recast-navigation@^0.43

# --- Dev / test ---
npm install -D typescript@^6 vitest@^4 @playwright/test
```

```ts
// vite.config.ts  (Tailwind v4 is a Vite plugin now)
import tailwindcss from '@tailwindcss/vite'
export default { plugins: [tailwindcss() /* + electron/react plugins */] }
```
```css
/* app.css — v4 entry (replaces the three @tailwind directives) */
@import "tailwindcss";
@theme { /* design tokens here, instead of tailwind.config.js */ }
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Electron** | Tauri (Rust + system WebView) | If you did NOT need to load a C++ N-API addon. Tauri would force your C++ data path through a Rust FFI/sidecar bridge — directly contradicts this project's "Node runtime runs the addon" rationale. Stay on Electron. |
| **Electron Forge** | electron-vite + electron-builder | If Forge's experimental Vite plugin causes friction with the native addon/HMR. electron-vite is Vite-native and mature; electron-builder is the most battle-tested packager. A reasonable Plan B — decide early, don't switch mid-project. |
| **cmake-js** | node-gyp | If the C++ core were small/greenfield with no existing CMake. Since you're reusing `swg-client-v2` (CMake), cmake-js wins. node-gyp + `binding.gyp` would mean re-describing an existing build. |
| **prebuildify + node-gyp-build** | prebuild + prebuild-install | Both work; prebuildify bundles binaries in-package (no download step, more reliable for an end-user desktop app) vs prebuild hosting binaries on GitHub releases. Prefer prebuildify here. |
| **dockview** | FlexLayout, rc-dock | FlexLayout is fine and popular; dockview has more momentum, zero deps, and popout-window support. rc-dock is smaller/less maintained. |
| **Zustand** | Jotai, Valtio, Redux Toolkit | Jotai (atomic) if you find global-store granularity painful; Valtio (proxy/mutable) if the team prefers mutable ergonomics. Redux Toolkit only if you need its devtools/time-travel — overkill and re-render-heavy for 60fps viewport state. |
| **Recharts** | visx, Observable Plot | visx if you outgrow Recharts' chart types and need low-level D3 control for custom balance visualizations. |
| **DirectXTex** | bcdec / Compressonator | On non-Windows builds where DirectXTex isn't available; keep the decoder swappable behind one interface. |
| **Radix primitives** | shadcn/ui (on Radix), Base UI | shadcn/ui is a great starting point (copy-paste Radix+Tailwind components) — viable accelerator. Base UI (MUI's headless successor) is an emerging alternative to watch. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Tauri** (for this project) | Rust core can't host a C++ N-API addon in-process; you'd build a Rust↔C++ bridge and lose the zero-copy Node data path. | **Electron** (its Node runtime loads the addon natively). |
| **`reactflow` (v11 package)** | Deprecated old package name; superseded. | **`@xyflow/react`** (v12). |
| **Golden Layout** | Imperative, aging, awkward inside React's lifecycle; weaker IDE-panel ergonomics. | **dockview** (`dockview-react`). |
| **`memoryjs`** | Semi-maintained (slow issue turnaround), node-gyp-only, generic — and you already have Utinni's C++ injection logic to reuse. | **Your own C++ N-API code** calling `OpenProcess`/`ReadProcessMemory`/`WriteProcessMemory` directly; pointers as `BigInt`. |
| **`ffi-napi` / `ref-napi`** | Effectively unmaintained, breaks on modern Node/Electron, slow per-call FFI for a 60fps memory-write loop. | C++ in the N-API core (or `koffi` only for throwaway prototyping). |
| **`nan` (Native Abstractions)** | Pre-N-API; requires recompiling per Node/Electron version. | **node-addon-api** (ABI-stable). |
| **Serializing geometry/textures/terrain to JSON over IPC** | Crashes the V8 main thread on large assets; the architecture's #1 rule. | Zero-copy `ArrayBuffer`/`SharedArrayBuffer`/typed arrays straight into `BufferGeometry`/`DataTexture`/Web Audio. |
| **Tailwind v3 setup docs** (`tailwind.config.js`, `@tailwind base/components/utilities`, postcss+autoprefixer) | Obsolete in v4. | `@tailwindcss/vite` plugin + `@import "tailwindcss"` + CSS `@theme`. |
| **TypeScript 7 / `tsgo` in production (yet)** | RC as of Jun 2026, not GA; not feature-complete. | **TS 6.0** now; adopt 7 once GA and your toolchain (Vite, ESLint, Forge) all support it. |
| **CRA (Create React App), Webpack-from-scratch** | Dead/slow; defeats the fast-HMR goal. | **Vite** (via Forge or electron-vite). |
| **Deep imports from `three/examples/jsm/...`** | Paths/APIs shift between three.js releases — silent breakage on upgrade. | **drei** re-exports, or **three-stdlib**. |

---

## Stack Patterns by Variant

**If a feature requires live memory injection (live in-game sync, packet inspection):**
- That feature is **Windows-only** (`OpenProcess`/`WriteProcessMemory` are Win32). Gate it behind a platform check and a capability flag.
- Implement entirely in the C++ N-API core, exposed as async methods; pass 64-bit addresses as `BigInt`, bulk data via `SharedArrayBuffer`. Harvest the logic from `Utinni`/`UtinniPlugins`.
- Architecture stays cross-platform; only this subsystem is OS-fenced.

**If a feature is pure asset editing (TRE mount, IFF parse, mesh/terrain/texture view & edit, packaging):**
- Keep it **cross-platform** (Windows/Linux/macOS). zlib, the IFF/TRE parsers, and Three.js all run everywhere.
- The only OS-specific concern is texture decode (DirectXTex is Windows-best) — abstract the DDS/BCn decoder behind one interface and provide a cross-platform fallback (bcdec) so the editor builds on Linux/macOS.

**If you hit friction with Electron Forge's experimental Vite plugin + native addon:**
- Switch the *toolchain only* to **electron-vite + electron-builder**. App code (React/R3F/addon) is unchanged. Make this call in Phase 0/1, not mid-roadmap.

**If install reliability on end-user machines matters (it does — modders aren't compiler-equipped):**
- Ship **prebuildify**-bundled binaries for `win32-x64` (primary) + `linux-x64` / `darwin-arm64` (if cross-platform editor ships), loaded by `node-gyp-build`. Never require end users to have CMake/MSVC.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@react-three/fiber@9.x` | `react@19.0–19.2`, `react-dom@19.x` | v9 is the React-19 line; bundles its own reconciler to survive React 19.2's reconciler bump. Do NOT use fiber v8 with React 19. |
| `@react-three/drei@10.x` | `@react-three/fiber@9.x` | drei 10 ↔ fiber 9. Mismatched majors break. |
| `three@0.184` | `@react-three/fiber@9.6` | three.js has no semver-stable major; pin exact `three` and bump fiber/drei together. Check R3F release notes for the supported `three` range before upgrading. |
| `tailwindcss@4.x` | Node ≥ 20; modern browsers only (Chrome 111+, Safari 16.4+) | Electron 42 ships Chromium M148+ — well within range. Uses `@tailwindcss/vite`, not PostCSS. |
| `node-addon-api@8.x` | Node 18+ / Electron with matching N-API version | ABI-stable; still run `@electron/rebuild` (or prebuild per Electron ABI) for Electron targets. |
| `cmake-js@8.x` | CMake ≥ 3.x installed on the *build* machine | Build-time only; end users get prebuilds. Requires a C++ toolchain (MSVC/Clang) on build/CI runners. |
| `vite` | Electron Forge Vite plugin / electron-vite | Pin Vite to the version your chosen Electron toolchain officially supports — don't blindly track Vite 8 if the integration targets 7. |
| `typescript@6.x` | Vite, Vitest, ESLint, Forge (all current) | Safe everywhere. TS 7/`tsgo` not yet supported across this toolchain — wait for GA. |
| `electron@42/43` | `node-addon-api@8`, Node 22/24-class runtime | Electron's support policy = latest 3 stable majors; plan to track it (security). Each Electron major may need an addon rebuild/prebuild. |

---

## Sources

- npm registry (`npm view <pkg> version`, 2026-06-21) — exact current versions: three 0.184.0, @react-three/fiber 9.6.1, @react-three/drei 10.7.7, zustand 5.0.14, node-addon-api 8.8.0, cmake-js 8.0.0, prebuildify 6.0.1, node-gyp-build 4.8.4, react 19.2.7, typescript 6.0.3, electron 42.4.1, @electron-forge/cli 7.11.2, dockview 6.6.1, @xyflow/react 12.11.0, reactflow 11.11.4, recharts 3.8.1, tailwindcss 4.3.1, vite 8.0.16, vitest 4.1.9, @playwright/test 1.61.0, memoryjs 3.5.1, koffi 3.0.2, recast-navigation 0.43.1 — **HIGH**
- Context7 `/electron/forge`, `/electron/electron`, `/electron/rebuild` (resolved) — Electron/Forge tooling reputation & docs — **HIGH**
- https://releases.electronjs.org/schedule — Electron 42/43 stable timeline, Chromium/Node mapping, support policy (latest 3 majors) — **HIGH**
- https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide + pmndrs/drei discussion #2213 — R3F v9 ↔ React 19 (incl. 19.2 reconciler), drei↔fiber major matching — **HIGH**
- https://www.electronforge.io/config/plugins/vite + electron-vite.org — Forge Vite plugin "experimental" status; electron-vite as Vite-native alternative; native modules as externals; auto electron-rebuild hooks — **MEDIUM-HIGH**
- nodejs.github.io/node-addon-examples (build-tools: cmake-js, prebuild) + cmake-js/prebuildify READMEs — build-tool tradeoffs and prebuild distribution — **MEDIUM-HIGH**
- dockview.dev + npmtrends (dockview vs flexlayout-react vs golden-layout vs rc-dock) — docking lib maintenance/adoption; dockview features (popout, zero-dep) — **MEDIUM**
- github.com/Rob--/memoryjs + lextudio koffi/libwin32 write-up — memoryjs maintenance gaps; ffi-napi deprecation; koffi as the modern FFI (but C++-in-core preferred here) — **MEDIUM**
- tailwindcss.com/blog/tailwindcss-v4 + @tailwindcss/vite setup guides — v4 Oxide engine, Vite plugin, CSS `@theme`, no PostCSS, Node 20+/modern-browser requirement — **HIGH**
- visualstudiomagazine.com + microsoft/typescript-go — TS 6.0 GA (Mar 2026, last JS-based), TS 7/`tsgo` RC (Jun 2026, not GA) — **HIGH**

---
*Stack research for: Electron + React 19 + C++ N-API game-modding suite (SWG Toolkit)*
*Researched: 2026-06-21*
