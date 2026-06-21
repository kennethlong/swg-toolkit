# Project Research Summary

**Project:** SWG Toolkit
**Domain:** Cross-platform Electron desktop modding suite — visual editor for ~40 SWG proprietary asset formats, real-time Three.js/R3F viewport, C++ Node-API native core, Win32 live-memory injection, Blender bridge, Core3 parity, MCP/AI layer
**Researched:** 2026-06-21
**Confidence:** HIGH (stack, architecture, cross-cutting pitfalls verified against official docs); the binary *format layouts* remain unverified by design and are the project's standing risk

## Executive Summary

The SWG Toolkit is the open-source successor to Sytner's IFF Editor (SIE), TRE Explorer, and Utinni — an all-in-one studio that lets a modder go from raw idea to in-game-verified mod without leaving the app or restarting the client. All four research tracks independently converged on the same conclusion: **the proposed stack and three-tier architecture are fundamentally sound** (Electron + React 19 + TS + node-addon-api C++ core + Three.js/R3F + Zustand is exactly the right shape), and the real work is (a) a handful of version corrections, (b) pinning *where* the native addon physically runs under Electron's sandbox, and (c) sequencing the build around a hard dependency chain while keeping the killer differentiator off the critical path.

The single most important cross-cutting finding — surfaced by all four researchers — is the **dependency root: IFF read/write primitives → TRE mount → mesh-in-viewport.** This is a hard chain (you cannot render a mesh you cannot read out of a TRE you cannot mount with IFF primitives you don't have), and rendering a real SWG mesh in the R3F viewport is the MVP proof that validates the entire zero-copy pipeline end-to-end. Every format editor (terrain, datatables, strings, skeletons, world snapshots) is a parallelizable *leaf* on the IFF root once that chain exists. Critically, the two differentiators — **live in-game injection** (depends only on Win32 + a matrix buffer) and the **Blender bridge** (decoupled WebSocket sidecar) — branch off EARLY and run in parallel. The roadmap must NOT serialize the differentiator behind the entire format-parsing tower.

The project's defining risk is not technical novelty — it is **format fidelity**. Every binary layout in `docs/` was distilled from an ~88k-word Gemini session and is an AI-proposed *hypothesis*, not a spec (the project's own `source-provenance.md` rates them "LOW — VERIFY"). A parser written straight from the docs will compile, pass on synthetic buffers, and then silently corrupt real assets or crash the client. The mitigation is a **standing verification gate**: no format parser merges without (a) a cited `swg-client-v2` source reference and (b) a passing byte-exact round-trip test on a real extracted asset. This harness must be built in Phase 1 so every later format phase inherits the discipline for free.

## Key Findings

### Recommended Stack

The stack is validated with seven version corrections/pins. See [STACK.md](./STACK.md) for full detail. **One-liner:** Electron 42 + React 19.2 + TypeScript 6 + node-addon-api 8 (cmake-js build, prebuildify distribution) + Three.js 0.184 / R3F 9 / drei 10 (lockstep) + Zustand 5 + dockview + @xyflow/react 12 + Tailwind v4 + Radix, with all binary parsing and Win32 memory injection living *inside* the C++ N-API core.

**Core technologies:**
- **Electron `~42.x`**: desktop shell whose in-process Node runtime can `require()` the C++ addon directly — the exact reason to choose it over Tauri (which would force a Rust↔C++ bridge and lose the zero-copy path).
- **React 19.2 + @react-three/fiber 9.6 + @react-three/drei 10.7 + three 0.184**: the viewport. These four must move in **lockstep** (fiber 9 ↔ React 19, drei 10 ↔ fiber 9, exact-pin `three` since it has no stable major).
- **node-addon-api 8 + C++17/20**: ABI-stable native core; zero-copy `Napi::ArrayBuffer`/`AsyncWorker`. Reuses real `swg-client-v2` parsing and Utinni injection logic.
- **cmake-js 8 (build) + prebuildify 6 + node-gyp-build 4**: build the addon via CMake (matches `swg-client-v2`/Core3); ship prebuilt binaries so end-user modders need no compiler.
- **Zustand 5 + dockview + @xyflow/react 12 + Tailwind v4 + Radix**: state, IDE docking shell, node-graph editor, styling, accessible primitives.

**Key version corrections (load-bearing):**
- **dockview**, NOT Golden Layout (React-hostile, aging).
- **@xyflow/react v12**, NOT `reactflow` (deprecated v11 package name).
- **Tailwind v4** via `@tailwindcss/vite` plugin + CSS `@theme` (no `tailwind.config.js`, no PostCSS — the docs' v3 mental model is obsolete).
- **C++-core memory injection**, NOT `memoryjs`/`ffi-napi` (semi-abandoned, slow per-call FFI for a 60 fps loop; you already have Utinni's C++ logic).
- **TypeScript 6.0** now; do NOT adopt TS 7/`tsgo` yet (RC only as of Jun 2026).
- **Electron Forge + Vite is flagged risk** — `electron-vite` is the mature Vite-native fallback; decide deliberately in Phase 0.

### Expected Features

The bar is parity, not novelty: SIE is *already* an all-in-one suite with 3D preview, and Utinni *already* owns live placement. The unique claim is **fusing offline editor + live loop in one open, scriptable app.** See [FEATURES.md](./FEATURES.md).

**Must have (table stakes — lacking any = downgrade from SIE/TRE Explorer):**
- Mount `.tre`/`.toc` archives as a virtual FS with load-order/override resolution
- Browse + name/path search across mounted archives
- Generic IFF chunk parser + structured/hex view
- 3D mesh viewer (`.msh`/`.mgn`) with DDS textures + `.sht` shaders
- Skeleton + `.ans` animation preview
- DTII datatable grid + `.stf` string editor (the two highest-frequency edit surfaces)
- Raw extract + mesh export (glTF/COLLADA); dark dockable IDE workspace

**Should have (the chosen differentiators — align with PROJECT.md Core Value):**
- **Live in-game injection (zero-restart WYSIWYG)** — THE killer feature (3–5 min loop → 0.1s)
- **Blender bridge (round-trip)** — collapses export→convert→copy→pack→restart into one button
- **Core3/SWGEmu parity (dual-track save)** — auto-emit matching Lua to eliminate client/server drift
- Changeset version control + rollback (Git/LFS); MCP server + AI assists

**Defer (v2+):** Live injection ships as a *dedicated* phase (unbounded pointer discovery), packet sniffer, MCP server (needs a real N-API surface to wrap first), AI assists, remote deploy daemon (needs security review), collaborative editing.

### Architecture Approach

The proposed three-tier shape (React/TS UI → Node backend → C++ N-API core) is **VALIDATED** with three refinements that pin the Electron process model. See [ARCHITECTURE.md](./ARCHITECTURE.md). A **pnpm/npm-workspaces monorepo** with four workspaces (`native-core`, `backend`, `renderer`, `contracts`) plus an in-repo (out-of-workspace) Python `blender-plugin`.

**Major components:**
1. **Renderer (React/R3F, sandboxed)** — all UI, the 3D viewport, gizmo input. Owns *no* native handles; reaches the backend only through `contextBridge` + a `MessagePort` data channel.
2. **Node backend (main/utility process, NOT sandboxed)** — orchestration, TRE mount registry, file watchers, plugin router, Blender WebSocket bridge. Holds the addon reference and allocates the `SharedArrayBuffer`.
3. **C++ N-API core (one `.node`, several internal modules)** — `iff` (the dependency root), `tre`, `formats/`, `inject` (Win32, independent of iff/tre), `navmesh`. All heavy work on `AsyncWorker` threads.
4. **`contracts/` (the keystone)** — shared TS types for IPC payloads, SharedArrayBuffer byte-offset layouts, opcodes — the single source of truth across all three runtimes that kills the "column-major on one side, row-major on the other" class of zero-copy bugs.

**Three refinements (do not skip):** (1) the addon **cannot load in a sandboxed renderer** — it lives in main/utility; (2) the zero-copy data channel crosses to the renderer via a `MessageChannel` + `SharedArrayBuffer` (requires COOP/COEP cross-origin isolation); (3) the C++ "core" splits into modules so `inject` (Win32-only) branches off in parallel with the format tower.

### Critical Pitfalls

Top risks from [PITFALLS.md](./PITFALLS.md), each mapped to a phase:

1. **AI-proposed format layouts as if they were specs (the headline)** — a parser that passes on synthetic buffers silently corrupts real assets and crashes the client. *Avoid:* standing gate in Phase 1 + every format phase — cited `swg-client-v2` source + byte-exact round-trip on a real asset before merge.
2. **Synchronous N-API blocking the main thread on multi-GB files** — UI freezes, looks crashed. *Avoid:* `Napi::AsyncWorker` for all whole-file work from Phase 1; sync only for trivial bounded reads.
3. **SharedArrayBuffer pointer use-after-free + silent unavailability** — a cached `Data()` pointer dangles after GC and streams garbage into the live client; SAB is undefined without cross-origin isolation. *Avoid:* hold a `Napi::Reference` + finalizer (or pass the typed array per call); set COOP/COEP headers in Phase 0 and verify `crossOriginIsolated === true`.
4. **Per-build memory offsets + anti-cheat/AV/privilege friction** — hard-coded addresses break on any other client build (and a stale address corrupts the client); injection looks like malware to AV/EDR. *Avoid:* runtime AOB/signature resolution (mine Utinni), read-verify before write, build-hash-keyed profiles; code-sign, scope to local-offline-own-client only, graceful non-admin fallback.
5. **Electron security (disabled context isolation / leaky preload)** — this app runs `WriteProcessMemory` + git/shell + arbitrary disk I/O; any XSS or malicious community changeset becomes RCE. *Avoid:* secure defaults from Phase 0, minimal typed/validated `contextBridge`, allow-listed workspace root, `execFile` not interpolated `exec`, strict CSP.

(Also: Three.js per-frame GC churn and missing `InstancedMesh` in the viewport/world phases; committing copyrighted retail `.tre` to Git/LFS in the workflow phase; non-atomic Core3 parity drift in the server phase.)

## Implications for Roadmap

The dependency-driven build order from ARCHITECTURE.md is the spine. The hard chain is **0 → 1 → 2 → 3**; **3b (inject)** and **6 (Blender)** branch off early in parallel; **7 (format editors)** are parallelizable leaves.

### Phase 0: Toolchain De-risk & App Shell
**Rationale:** Prove the *whole pipeline wiring* (C++ → N-API → backend → preload → renderer) with a trivial "hello" function BEFORE any real format work. This de-risks the riskiest infrastructure in one shot and locks the security posture before features accrete.
**Delivers:** Monorepo skeleton + `contracts/` package; the C++ N-API addon building (cmake-js) and loading inside Electron's **main/utility process** (not sandboxed renderer) with ASAR-unpack; COOP/COEP cross-origin isolation verified (`crossOriginIsolated === true`); the Electron-Forge-Vite-vs-`electron-vite` decision made; secure Electron defaults (contextIsolation, narrow validated preload, CSP); dark dockable dockview shell.
**Addresses:** Dark IDE workspace shell.
**Avoids:** SharedArrayBuffer isolation (Pitfall 4), Electron security (Pitfall 7), the addon-in-renderer anti-pattern, two-build-systems anti-pattern.

### Phase 1: Core Engine — IFF + TRE + Verification Harness
**Rationale:** The dependency root. Everything depends on IFF read/write primitives; nothing real is possible without them. This is where the #1 project risk (format fidelity) is retired.
**Delivers:** `iff` read/write primitives with byte-exact round-trip unit tests verified against `swg-client-v2`; `tre` mount + decompress + asset-pipeline (TRE→IFF→buffer) over a real installed client; the **format-verification harness** (real-asset round-trip + cited-source gate) baked in as a standing gate; `AsyncWorker` threading pattern for all whole-file work.
**Uses:** node-addon-api, cmake-js, zlib, GoogleTest/Catch2.
**Avoids:** AI-proposed layouts (Pitfall 1), main-thread blocking (Pitfall 2).

### Phase 2: 3D Mesh Viewport (THE MVP PROOF)
**Rationale:** Rendering a real SWG mesh in the R3F viewport validates the zero-copy contract end-to-end — `MessagePort` data channel, `BufferGeometry` consumption, DDS decode. This is PROJECT.md's "foundation everything else depends on" and the moment the tool beats TRE Explorer on viewing.
**Delivers:** `msh`/`mgn` parser → zero-copy buffers → R3F viewport renders a real mesh with DDS textures + `.sht` shaders; skeleton + `.ans` animation preview; raw extract + glTF/COLLADA export; browse + search.
**Uses:** three 0.184 / R3F 9 / drei 10 (lockstep), DirectXTex (DDS decode in C++).
**Avoids:** Three.js per-frame GC churn (reuse scratch objects), JSON-serializing binary (zero-copy transfer).

### Phase 3 (PARALLEL with 1–2): Live Injection Foundation
**Rationale:** The `inject` module depends ONLY on Win32 + a matrix buffer — NOT on iff/tre. Start address-discovery / Utinni-mining EARLY because it is the differentiator and the hardest thing to validate (per-build pointer discovery is unbounded). Do not defer it to the worst possible time.
**Delivers:** Win32 attach + single-object transform patch with runtime AOB/signature resolution, read-verify-before-write guard, single process-handle lifecycle (fix the `hSwgProcess`/`SIZE_t`/`OpenProcess`-flag defects), build-hash-keyed offset profiles.
**Avoids:** Per-build offsets + anti-cheat/AV/privilege (Pitfall 5), SAB pointer lifetime (Pitfall 3).

### Phase 4: Edit/Deploy Loop
**Rationale:** Turns the viewer into an editor and closes "idea → deployed `.tre`." IFF serialize is the correctness chokepoint — gate per-format on round-trip validation.
**Delivers:** IFF serialize (write-back) for validated formats; `.tre` patch packaging; staging workspace + changeset/undo + rollback; DTII grid edit + `.stf` edit (read+write round-trip).
**Avoids:** Retail `.tre` in Git/LFS (LFS mod-outputs only, robust `.gitignore`, never blind `git add .`).

### Phase 5: Wire Live Sync to the Viewport Gizmo
**Rationale:** Connects the two independently-built halves (viewport gizmo + inject module) into the WYSIWYG loop.
**Delivers:** 60 fps transform gizmo → SharedArrayBuffer write → control ping → `WriteProcessMemory`; live-edit rollback via changeset.
**Avoids:** GC churn in the 60 fps path; SAB use-after-free (soak-test through GC pressure).

### Phase 6 (PARALLEL, can start against fixtures): Blender Bridge
**Rationale:** Decoupled WebSocket sidecar; can be developed against fixtures before injection is solid. Builds on existing nostyleguy plugins.
**Delivers:** `localhost:9012` WS server + Python addon; `.msh`/`.ans` round-trip + coordinate remap.

### Phase 7: Format Editors (parallelizable leaves)
**Rationale:** Each format is an independent leaf on the IFF root once 1–2 exist — parallelizable across contributors. Each re-applies the Phase 1 verification gate.
**Delivers:** terrain `.trn` (with `InstancedMesh` from the start), world snapshots `.ws`, flora `.fld`, collision/portals, UI `.ui`, audio/FX. Sequence by demand × validation cost.
**Avoids:** Missing instancing / draw-call explosion (design world/flora around `InstancedMesh`).

### Phase 8: Parity, Navmesh, MCP, AI (independent islands)
**Rationale:** Sequence by value, not dependency. Core3 parity layers onto DTII editor + packer; MCP needs a real N-API surface to wrap.
**Delivers:** Core3 dual-track save (local, transactional, with parity audit); Recast/Detour navmesh; MCP server over the backend service layer; AI assists (advisory/reviewable). Remote deploy daemon deferred pending security review.
**Avoids:** Non-atomic parity drift (stage-validate-commit-both + standalone audit); insecure `0.0.0.0` daemon.

### Phase Ordering Rationale

- **0 → 1 → 2 is a hard chain** (the dependency root): no mesh without TRE without IFF. This is non-negotiable.
- **3b (inject) and 6 (Blender) branch off in parallel** — both are independent of the format tower; serializing the differentiator behind all parsers is the explicit anti-pattern.
- **The verification harness is a Phase 1 keystone that recurs in every format phase** — budget the round-trip tax per phase, not once.
- **Security and isolation are front-loaded into Phase 0** — cheap before features accrete, expensive (HIGH recovery cost) after.
- **`contracts/` stands up in Phase 0** so all three runtimes agree on byte layouts from day one.

### Research Flags

Phases likely needing deeper research during planning (`/gsd:plan-phase --research-phase <N>`):
- **Phase 1 (per format):** Each binary layout needs ground-truth verification against `swg-client-v2` — this is the recurring research tax, not a one-time task.
- **Phase 3/5 (live injection):** Pointer/offset discovery is per-client-build and unbounded; mine Utinni. Effort is genuinely uncertain (LOW confidence on magnitude).
- **Phase 8 (Core3 parity):** Core3 paths/Lua schema are AI-proposed; verify against the real `MMOCoreORB` tree.

Phases with standard patterns (lighter research):
- **Phase 0:** Electron/Forge/N-API/COOP-COEP are well-documented (this research covers them).
- **Phase 2 viewport:** R3F/drei/Three.js patterns are well-established; the SWG-specific risk is the mesh *format*, covered by the Phase 1 gate.
- **Phase 4 packaging/workflow:** Standard Git/LFS + archive-build patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm registry + official docs/release schedules (2026-06-21); build-tooling/injection MEDIUM-HIGH |
| Features | HIGH | Categorization verified against real tools (SIE, TRE Explorer, Utinni, nostyleguy plugins); complexity estimates MEDIUM; live-injection effort LOW (unbounded) |
| Architecture | HIGH | Layering + Electron process model verified against official Electron/N-API docs; binary format layouts unverified by design (out of scope for arch) |
| Pitfalls | HIGH | Cross-cutting platform pitfalls verified against official docs + project's own `source-provenance.md`; anti-cheat/AV magnitude MEDIUM (community-reported) |

**Overall confidence:** HIGH on *how to build it*; the *what* (binary formats) is deliberately unverified and gated.

### Gaps to Address

- **Every binary format layout** is an AI-proposed hypothesis (`docs/` rated LOW—VERIFY). *Handle:* the Phase 1 verification gate (cited `swg-client-v2` source + real-asset round-trip) before any parser merges; recurs every format phase.
- **Live-injection pointer discovery** is per-build and effort-unbounded. *Handle:* dedicated phase, runtime AOB resolution, mine Utinni, build-hash-keyed profiles; treat magnitude as a planning unknown.
- **Electron Forge + Vite + native-addon** integration risk. *Handle:* decide Forge-vs-`electron-vite` deliberately in Phase 0; don't switch mid-roadmap.
- **Core3 paths/Lua schema** are AI-proposed. *Handle:* verify against `MMOCoreORB` before the parity generator is trusted.
- **DDS decode cross-platform** (DirectXTex is Windows-best). *Handle:* abstract the BCn decoder behind one interface with a cross-platform fallback (bcdec) if the editor ships beyond Windows.

## Sources

### Primary (HIGH confidence)
- npm registry (2026-06-21) — exact current versions for all stack packages (STACK.md)
- Electron official docs (Process Model, Sandbox, Context Isolation, IPC, Security) — process boundaries, addon-cannot-load-in-sandboxed-renderer, MessagePort/SAB transfer (ARCHITECTURE.md, PITFALLS.md)
- releases.electronjs.org/schedule — Electron 42/43 timeline, Chromium/Node mapping, support policy (STACK.md)
- R3F v9 migration guide + drei discussion #2213 — R3F 9 ↔ React 19, drei↔fiber major matching (STACK.md)
- node-addon-api ArrayBuffer docs + issue #258 — `Data()` pointer invalid after GC without strong ref (PITFALLS.md)
- MDN SharedArrayBuffer + web.dev COOP/COEP — cross-origin isolation requirement (PITFALLS.md)
- Tailwind v4 blog + `@tailwindcss/vite` guides — v4 Oxide engine, no PostCSS (STACK.md)
- Project ground truth: `docs/00-overview/source-provenance.md` (the LOW—VERIFY format caveat), `docs/00-overview/architecture.md`, `docs/01-core-engine/iff-and-tre.md`, `docs/04-live-sync/live-memory-and-ipc.md`, `.planning/PROJECT.md`

### Secondary (MEDIUM confidence)
- Electron Forge Vite plugin "experimental" status; `electron-vite` as Vite-native alternative (STACK.md)
- cmake-js/prebuildify READMEs — build-tool/distribution tradeoffs (STACK.md)
- dockview.dev + npmtrends — docking lib maintenance/adoption (STACK.md)
- electron/electron #10409, #45034 — SAB/MessagePort cross-process transfer (ARCHITECTURE.md)
- Community anti-cheat/AV friction reports — varies per server/AV vendor (PITFALLS.md)

### Tertiary (LOW confidence — needs validation)
- All SWG binary format/struct layouts in `docs/` (Gemini-distilled) — validate against `swg-client-v2` per the Phase 1 gate
- AI-proposed Core3 Lua paths/schema — validate against `MMOCoreORB`
- Live-injection offsets — per-build, mine from Utinni at runtime

### Verified community tool references (HIGH)
- Utinni (ptklatt/Utinni), Swg.Explorer (wverkley), io_scene_swg_msh/_mgn (nostyleguy), Mod the Galaxy tools catalog (FEATURES.md)

---
*Research completed: 2026-06-21*
*Ready for roadmap: yes*
