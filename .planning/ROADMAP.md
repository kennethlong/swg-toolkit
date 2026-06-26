# Roadmap: SWG Toolkit

## Overview

The journey runs from a proven cross-process pipeline to a complete, in-game-verified modding studio. It opens by de-risking the riskiest infrastructure (C++ -> N-API -> backend -> preload -> renderer wiring, Electron security, cross-origin isolation) and standing up the dark dockable shell. It then builds the **dependency root** — IFF read/write primitives, TRE mount, and the byte-exact verification harness that retires the project's #1 risk (format fidelity) — and proves the whole zero-copy contract by rendering a real SWG mesh in the viewport (the MVP). In parallel, the Win32 live-injection foundation branches off early (it depends only on Win32, not the format tower). The edit/deploy loop closes "idea -> deployed `.tre`," then the two independently-built halves (viewport gizmo + injection) join into the WYSIWYG zero-restart loop alongside the first typed edit surfaces. The Blender bridge (decoupled sidecar) and the parallelizable format-editor leaves add breadth, and the suite finishes with the independent islands: Core3 parity, navmesh, MCP, and AI assists.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 0: Toolchain De-risk & App Shell** - Prove the full native->renderer pipeline, lock Electron security/isolation, ship the dark dockable shell ✓ 2026-06-22 (Path B: native-in-renderer zero-copy)
- [x] **Phase 1: Core Engine — IFF + TRE + Verification Harness** - The dependency root: parse/serialize IFF byte-exact, mount TRE, bake the standing round-trip gate (completed 2026-06-23)
- [ ] **Phase 2: 3D Mesh Viewport (MVP Proof)** - Render a real SWG mesh with textures, skeletons, and animation; extract and export
- [ ] **Phase 3: Live-Injection Foundation** - Attach to a running client on Win32, read-verify live memory, file-patch fallback (parallel track)
- [ ] **Phase 4: Edit & Deploy Loop** - Repack edits to a `.tre` patch, activate via `.cfg`, changeset rollback, Git/LFS for mod outputs
- [ ] **Phase 5: WYSIWYG Live-Sync & Typed Editors** - Drag a gizmo and move the object in the running client; first DTII/STF edit surfaces
- [ ] **Phase 6: Blender Bridge** - Connect Blender over WebSocket and round-trip animation to a valid `.ans` (decoupled sidecar)
- [ ] **Phase 7: Format Editors** - Terrain, world snapshots, flora, collision/portals, UI, audio/FX — parallelizable leaves on the IFF root
- [ ] **Phase 8: Parity, Navmesh, MCP & AI** - Core3 dual-track parity, navmesh, MCP server, and advisory AI assists (independent islands)

## Phase Details

### Phase 0: Toolchain De-risk & App Shell
**Goal**: Prove the entire pipeline wiring (C++ -> N-API -> backend -> preload -> renderer) with a trivial round-trip, lock the security posture, and present the dark dockable workspace — before any real format work accrues.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05
**Success Criteria** (what must be TRUE):
  1. The app boots as an Electron desktop app with `contextIsolation: true`, `nodeIntegration: false`, and a renderer that calls native code only through a narrow, typed, validated preload bridge (no Node in the renderer).
  2. The C++ Node-API addon builds via cmake-js, loads in the Electron main/utility process (never the sandboxed renderer), and returns a value from a "hello" call observable in the renderer.
  3. `crossOriginIsolated === true` in the packaged renderer (COOP/COEP set), so a `SharedArrayBuffer` can be allocated.
  4. A shared-types `contracts/` package compiles and is imported by both backend and renderer, defining IPC, byte-offset, and opcode types.
  5. The user sees a dark, dockable, persistent multi-panel workspace (sidebar / 3D canvas / data pane / inspector) whose layout survives a restart.
**Plans**: 5 plans
Plans:
**Wave 1**
- [x] 00-01-PLAN.md — Monorepo scaffold, pnpm workspace, contracts/ shared types (cross-write SAB layout + correlation `id`), Vitest + Playwright harness, .nvmrc/engines, check-prereqs preflight, CI workflow (with the 05-packaged HARD gate: skip = fail), single source-of-truth Vite worker path
- [x] 00-02-PLAN.md — cmake-js native addon (hello + allocateSab, NAPI_EXPERIMENTAL + node-addon-api ^8.8.0) + prebuildify/node-gyp-build distribution (FND-02) proven NON-CIRCULARLY (build/ moved aside, load asserted from prebuilds/, Electron ABI), TDD RED->GREEN

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 00-03-PLAN.md — Electron security posture, COOP/COEP, utility-process IPC, SAB pipeline with same-memory NONCE cross-write proof (zero-copy, not a copy/echo); demuxed relay + reject-on-exit; autonomous:false architecture gate (utility→renderer SAB sharing is likely-negative — a failing cross-write BLOCKS the D-04 claim) + documented pivot contingency

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 00-04-PLAN.md — Dark dockable workspace shell: DockviewReact (explicit panel sizing), 5 locked themes, StatusBar as single owner of SAB hooks + per-run-NONCE cross-write driver (shared/copy/timeout distinguished); runs after the 00-03 architecture gate

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 00-05-PLAN.md — E2E suite (SC-1..SC-5 incl. Object.keys allowlist + instanceof + NONCE cross-write + REAL close/relaunch restart against the real userData path + packaged file:// HARD gate via package:ci/PACKAGED_EXE_PATH, skip = fail) + independent Nyquist sign-off certifying only what was proven (FND-02 non-circular resolution + Electron-ABI packaged load — not a proxy)
**UI hint**: yes

### Phase 1: Core Engine — IFF + TRE + Verification Harness
**Goal**: Stand up the dependency root — IFF read/write primitives, TRE mount with correct override resolution, and the byte-exact verification harness that retires the format-fidelity risk — all on async worker threads so the UI never blocks.
**Mode:** mvp
**Depends on**: Phase 0
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06
**Success Criteria** (what must be TRUE):
  1. The user can mount one or more real `.tre` archives from an installed client as a virtual filesystem, with load-order/override resolution where a patch archive correctly shadows retail trees.
  2. The user can browse and search the mounted virtual filesystem by path/name.
  3. The system parses an arbitrary real IFF (FORM/chunk) file into a navigable tree with zero unexplained trailing bytes, and serializes an edited structure back **byte-exact** (round-trip gate, verified against a cited `swg-client-v2` loader).
  4. The reusable format-verification harness round-trips a real extracted asset byte-for-byte from fixtures and is wired in as a standing gate every later format inherits.
  5. Mounting/decompressing a multi-GB archive and parsing a large IFF run on async worker threads — the UI stays responsive (no main-thread freeze) throughout.
**Plans**: 4 plans
Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Verification harness mechanism (CORE-05 standing gate) + engine-free C++20 TRE read core (EERT/36-byte header, CRC-first TOC, zlib) + contracts/tre.ts + committed fixtures + OPEN-1 real-asset field-order arbiter ✓ 2026-06-22

**Wave 2** *(blocked on 01-01)*
- [x] 01-02-PLAN.md — TRE mount/override resolver (priority shadow + tombstones) + AsyncWorker zero-copy binding + TRE VFS browser UI (Surface 1): mount, search, shadow chain, v0006 enumerate-only chip
  - Tasks 1-2 COMPLETE (commits 61de191, b4e1e2d); Task 3 awaiting human-verify checkpoint

**Wave 3** *(blocked on 01-02)*
- [x] 01-03-PLAN.md — Engine-free IFF parse + byte-exact serialize (BE, no-pad, hybrid-DOM, trailing-bytes) + IFF Structure tree + Hex/ASCII inspector UI (Surfaces 2/3, read-only D-08)

**Wave 4** *(blocked on 01-03)*
- [x] 01-04-PLAN.md — TRE builder/repacker (byte-identical self-built: MD5 trailer, response-file order, zlib L6; retail per-record slice identity) + standing-gate registration + AI-distilled docs correction

### Phase 2: 3D Mesh Viewport (MVP Proof)
**Goal**: Validate the zero-copy contract end-to-end by rendering a real SWG mesh in the Three.js/R3F viewport with textures, palette customization, skeletons, and animation — and let the user extract and export it. This is the moment the tool beats TRE Explorer on viewing.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: VIEW-01, VIEW-02, VIEW-03, VIEW-04
**Success Criteria** (what must be TRUE):
  1. The user can open a real static or skinned mesh (`.msh`/`.mgn`) and see it render correctly in the viewport with an orbit camera (geometry crosses the bridge zero-copy into `BufferGeometry`).
  2. The displayed mesh shows its `.dds` textures and `.pal` palette customization applied correctly.
  3. The user can preview a `.skt`/`.sat` skeleton and play back an `.ans` animation on the mesh without per-frame GC hitching.
  4. The user can extract a raw asset and export a viewed mesh to glTF/COLLADA that opens in an external tool.
  5. Each parser added here passes the Phase 1 byte-exact round-trip gate with a cited `swg-client-v2` source.
**Plans**: 5 plans
Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Install three/R3F/drei; contract types (mesh/skeleton/animation/material, Uint32 indices, MeshAttributeSlice byte offsets); C++ static .msh + .lmg/.ldt/.sht/.pal/.dds parsers + de-index utility + N-API binding; CORE-05 fixtures — generic-IFF for .msh/.lmg/.ldt/.sht, PARSER-NATIVE for .pal/.dds

**Wave 2** *(blocked on 02-01)*
- [x] 02-02-PLAN.md — C++ SKMG (INFO 9×int32+4×int16, TWDT from INFO) / SKTM (v0001+v0002 BPMJ-branched) / SMAT / APT parsers + de-index+vec4-normalize + CORE-05 fixtures; TS resolver (composed/composed-static/leaf, texture-byte plumbing, D-04); R3F Viewport + StaticMeshView AND SkinnedMeshView, multi-PSDT, no material.skinning (VIEW-01 static+skinned); viewportStore (source-entry fields); LodPicker; AppearancePanel

**Wave 3** *(blocked on 02-02)*
- [x] 02-03-PLAN.md — Custom ShaderMaterial (skinning chunks, samplers in fragment, uTexFactor + distinct uMaterialColor, DOT3 tangents, multi-map); DDS GPU upload via S3TC + real CPU-decode fallback; texture bytes consumed from 02-02 resolver; multi-group CustomizationPanel live color-swap (D-06) + multi-group MaterialInspector (VIEW-02)

**Wave 4** *(blocked on 02-02)*
- [x] 02-04-PLAN.md — C++ Animation parser with SEPARATE CKAT(int16)/KFAT(int32) sparse per-channel byte tables + VERBATIM CompressedQuaternion::install()/doExpand() port (255-entry s_formatData, w-clamp); KFAT 0002 declined; CORE-05 fixtures (no on-load decimation); AnimationTransport (D-08, populated picker); ref-clock sparse-key zero-GC sampler (VIEW-03)

**Wave 5** *(blocked on 02-03 + 02-04)*
- [x] 02-05-PLAN.md — glTF (reliable) + COLLADA (best-effort) export with matrix X-mirror (winding+normals+tangents+bind matrices+animation) on a deep-cloned scene, applied once (no double-apply); buildAnimationClip from corrected 02-04 IR; Extract… via viewportStore source-entry fields; precise docs callouts (DDS mis-citation fixed) (VIEW-04)

**UI hint**: yes

### Phase 3: Live-Injection Foundation
**Goal**: Build the Win32 injection module — which depends only on Win32, not on the format tower — so attach + read-verify is proven early against a running client; ensure the editor degrades gracefully to file-patch mode when injection is unavailable. (Parallel track off the critical path.)
**Mode:** mvp
**Depends on**: Phase 0 (Win32-only; independent of Phases 1-2)
**Requirements**: LIVE-01, LIVE-02, LIVE-04, LIVE-05
**Success Criteria** (what must be TRUE):
  1. The user can attach the toolkit to a running SWG client process on Windows through a correctly-flagged process-handle lifecycle (`PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE` for inject; `PROCESS_VM_READ` for read-only RPM), with graceful failure messaging when not elevated.
  2. The system resolves target addresses using deterministic, build-specific mechanisms — name-keyed `GetEngineHookPoints()` table for the advertised swg-client-v2 build, and known harvested RVAs from Utinni source for the legacy SWGEmu build. Both supported builds prove successful attach using only these deterministic, build-specific endpoints. (D-04)
  3. The system read-verifies an object's live memory state (sane matrix / known sentinel) before any write, refusing to patch when validation fails.
  4. The system provides a live memory/packet inspector HUD that surfaces the verified object state.
  5. The editor remains fully usable in file-patch mode when injection is unavailable (no feature requires admin/injection to do core editing).
**Plans**: 7 plans
Plans:
**Wave 1**
- [x] 03-01-PLAN.md — Package scaffold (packages/live-inject/), contracts/live-inject.ts, Wave-0 RED test stubs

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03-02-PLAN.md — Agent DLL: resolver + RVA table (name-keyed + legacy gaps closed)
- [x] 03-03-PLAN.md — Agent DLL: 4-sentinel predicates + seqlock channel writer

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 03-04-PLAN.md — agent_main.cpp + host addon: procmem/channel bindings

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 03-05-PLAN.md — inject_binding.cpp: LaunchAndInjectWorker (12-step) + AttachAndInjectWorker

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 03-06-PLAN.md — Renderer HUD: liveStore.ts, LiveInspectorPanel (three states + HexInspector), StatusBar mode indicator, WorkspaceShell registration, ROADMAP SC-2 doc fix
- [ ] 03-06b-PLAN.md — HUD wiring: useLiveService hook, useChannelReader, attach trigger UI, channel polling integration, manual UAT checkpoint

### Phase 4: Edit & Deploy Loop
**Goal**: Turn the viewer into an editor that closes the modder loop — repack validated edits into a deployable `.tre` patch, activate it via the client `.cfg`, and provide changeset rollback and safe Git/LFS versioning of mod outputs only.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04
**Success Criteria** (what must be TRUE):
  1. The user can repack edits into a deployable `.tre` patch archive that the client loads.
  2. The system updates the client `.cfg` search order to activate a patch with a safe, BOM-free, atomic write that preserves duplicate `searchTree=` entries in priority order (with backup).
  3. The user can roll back changes via a changeset/snapshot history that reverts the workspace to a prior state.
  4. The user can version mod-produced assets via Git/LFS, and a fresh clone is small with no retail `.tre` in `git log` (base/extracted assets are ignored, never blind `git add .`).
**Plans**: TBD
**UI hint**: yes

### Phase 5: WYSIWYG Live-Sync & Typed Editors
**Goal**: Join the two independently-built halves — viewport gizmo and injection module — into the zero-restart WYSIWYG loop over the SharedArrayBuffer data channel, and ship the first typed edit surfaces (DTII grid, `.stf` strings) as the highest-frequency editing entry points.
**Mode:** mvp
**Depends on**: Phase 2, Phase 3
**Requirements**: LIVE-03, DATA-01, DATA-02
**Success Criteria** (what must be TRUE):
  1. The user can drag a viewport gizmo and see the object move in the running client in real time with zero restart, driven through a `SharedArrayBuffer` write + control ping (no allocation in the 60 fps path; survives a GC-pressure soak test without dangling the native pointer).
  2. A bad live write can be reverted via the changeset/snapshot system (read-verify guard before write).
  3. The user can view and edit DTII datatables in a virtualized grid and save them back, passing the byte-exact round-trip gate.
  4. The user can view and edit `.stf` localized strings and save them back, passing the byte-exact round-trip gate.
**Plans**: TBD
**UI hint**: yes

### Phase 6: Blender Bridge
**Goal**: Connect Blender to the toolkit over a decoupled WebSocket sidecar and round-trip animation into a valid native SWG `.ans`, developed against fixtures so it never blocks on injection or the renderer.
**Mode:** mvp
**Depends on**: Phase 1 (animation parsers); develops in parallel against fixtures
**Requirements**: BLND-01, BLND-02
**Success Criteria** (what must be TRUE):
  1. The Blender plugin connects to the toolkit over the WebSocket bridge (`localhost:9012`) and exchanges messages without touching the renderer/sandbox.
  2. The user can export a Blender animation to a valid SWG `.ans` with correct Z-up -> Y-up coordinate conversion, and the result passes the byte-exact round-trip gate against `swg-client-v2`/community-plugin output.
**Plans**: TBD
**UI hint**: yes

### Phase 7: Format Editors
**Goal**: Add breadth by building the parallelizable format-editor leaves on the IFF root — terrain, world snapshots, flora, collision/portals, UI, and audio/FX — each re-applying the Phase 1 verification gate and (for world/flora) designed around `InstancedMesh` from the start.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: FMT-01, FMT-02, FMT-03, FMT-04, FMT-05, FMT-06
**Success Criteria** (what must be TRUE):
  1. The user can view/edit and serialize terrain (`.trn`) layers and fractals, with the terrain/world rendering built on `InstancedMesh` so a dense scene stays within a draw-call ceiling.
  2. The user can view/edit and serialize world snapshots (`.ws`) object placement and flora (`.fld`) placement.
  3. The user can view/edit and serialize collision/portals (`.cdf`/`.pob`/`.floc`).
  4. The user can view/edit and serialize client UI layouts (`.ui`) and audio (`.snd`) plus particles/effects (`.prt`/`.eft`).
  5. Every format added here passes the Phase 1 byte-exact round-trip gate with a cited `swg-client-v2` source before merge.
**Plans**: TBD
**UI hint**: yes

### Phase 8: Parity, Navmesh, MCP & AI
**Goal**: Layer the independent islands — sequenced by value, not dependency — onto the established service layer: Core3/SWGEmu dual-track parity with a standalone audit, a Recast/Detour navmesh, an MCP server wrapping the backend services, and advisory AI assists that always preview before writing.
**Mode:** mvp
**Depends on**: Phase 5 (datatable editor for parity), Phase 1-2 (assets for navmesh)
**Requirements**: SRV-01, AI-01, AI-02
**Success Criteria** (what must be TRUE):
  1. The user can sync client datatable changes to Core3/SWGEmu Lua templates through a transactional stage-validate-commit-both flow (verified against the real `MMOCoreORB` tree), and a standalone parity audit reports zero drift.
  2. The toolkit exposes its capabilities as an MCP server with read-only resources and confirmation-gated write tools, reusing the same backend services the UI calls.
  3. AI assists add value advisorily (e.g. natural-language datatable queries, mocap->`.ans`, format reverse-engineering aid) and always show a diff/preview before any write.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

(Phase 3 — live-injection — and Phase 6 — Blender bridge — are deliberately OFF the critical path and may be developed in parallel with the format chain; they are listed in numeric order here.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Toolchain De-risk & App Shell | 4/5 | In Progress|  |
| 1. Core Engine — IFF + TRE + Verification Harness | 4/4 | Complete   | 2026-06-23 |
| 2. 3D Mesh Viewport (MVP Proof) | 0/5 | Not started | - |
| 3. Live-Injection Foundation | 6/7 | In Progress|  |
| 4. Edit & Deploy Loop | 0/TBD | Not started | - |
| 5. WYSIWYG Live-Sync & Typed Editors | 0/TBD | Not started | - |
| 6. Blender Bridge | 0/TBD | Not started | - |
| 7. Format Editors | 0/TBD | Not started | - |
| 8. Parity, Navmesh, MCP & AI | 0/TBD | Not started | - |
