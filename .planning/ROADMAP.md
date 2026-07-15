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
- [x] **Phase 2: 3D Mesh Viewport (MVP Proof)** - Render a real SWG mesh with textures, skeletons, and animation; extract and export ✓ 2026-06-25 (VIEW-01..04; glTF export + Extract human-verified)
- [x] **Phase 3: Live-Injection Foundation** - Attach to a running client on Win32, read-verify live memory, file-patch fallback (parallel track) (completed 2026-06-26)
- [x] **Phase 4: Edit & Deploy Loop** - Repack edits to a `.tre` patch, activate via `.cfg`, changeset rollback, Git/LFS for mod outputs (completed 2026-06-27)
- [x] **Phase 4.1: Deploy & Project UX** *(INSERTED)* - Project↔client binding front door, one combined Deploy tab, stage-from-TRE, lazy/virtual shadow sandbox (build approved sketches 005-B/006-D/007/008) ✓ 2026-07-03 (UAT superseded by 04.3-13)
- [x] **Phase 4.2: Dev-Client Support & Loose-Override Deploy** *(INSERTED)* - Detect `client.cfg` clients whose binary is decoupled from an external TRE set; mount the full base via `searchTOC`/`searchPath` (not just `searchTree`); deploy by dropping loose files into the top-priority override dir (the lazy/virtual-shadow thesis, proven on swg-client-v2) ✓ 2026-07-03 (UAT superseded by 04.3-13)
- [x] **Phase 4.3: Versioning Model & SearchTOC Mount Completion** *(INSERTED)* - Crew UI-vs-sketch gap review first; then rework the deploy/version model (live client mirrors the SELECTED version; per-version deploy flag; reconcile-to-version forward-apply/backward-revert; visual branch-tree history per sketches 002/005) and complete the searchTOC/v6000 master-index mount (read swg-client-v2's full base; v6000 per-payload zlib) ✓ 2026-07-03 (combined UAT approved)
- [ ] **Phase 4.4: UX Polish & Deploy Hardening** *(INSERTED)* - Knock out the 6 UI-related pending todos: delete-project-with-restore + e2e deploy-flow Playwright coverage (the two high-severity items), plus console/log tabs, statusbar mesh name, VFS override dim, viewport default facing
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
- [x] 03-06b-PLAN.md — HUD wiring: useLiveService hook, useChannelReader, attach trigger UI, channel polling integration, manual UAT checkpoint

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
**Plans**: 8 plans
Plans:
**Wave 1**
- [x] 04-01-PLAN.md — Contract types (workspace/staging/changeset/deploy), Zustand stores (workspaceStore/stagingStore/changesetStore), workspaceService (scaffold .studio/, .gitignore, .gitattributes, pre-commit hook, git init)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 04-02-PLAN.md — WorkspaceEntry + ActionBadge (glyph+color+text Rule 1) + StatusBar extend + WorkspaceShell panel registration + StagingPanel (virtualized ROW_HEIGHT=30, Pack Patch auto-seal, path-traversal guard)
- [x] 04-03-PLAN.md — packPatch.ts (buildTre version=5000, tombstone, atomic output) + clientLocator.ts (registry + known paths, never throws) + cfgActivator.ts (scanSharedFile, chooseSlot, activatePatch, deactivatePatch, ensureInclude — BOM-free atomic, backup, never user.cfg/options.cfg)
- [x] 04-04-PLAN.md — changesetService.ts (sealLayer, setActiveVersion — non-destructive pointer only, atomic JSON, 6 tests GREEN) + ChangesetTimelinePanel (virtual list, active/rolled-back states, keyboard activation)
- [x] 04-05-PLAN.md — gitLfsService.ts (execFile arg arrays, never exec(), never git add ., explicit-path staging, message sanitized) + VcsPanel (commit/push/log/LFS status/guard surface)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 04-04b-PLAN.md — ChangesetTimelinePanel (graph-aware version history, branch divergence pips, active/deployed markers, selectVersion wiring)
- [x] 04-06b-PLAN.md — shadowBaseService.ts (estimateTreSize, checkFreeDisk — free-space guard, atomic TRE copy to .studio/shadow/, shadow searchTree entries at higher slots than originals; resetShadow backup-restore; in-client UAT) [autonomous: false]

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 04-06-PLAN.md — DeployDialog (Sections A/B/C: client picker, patch-prepend/shadow-base, cfg slot preview; handleDeploy branches on deployModel — dispatches to deployShadowBase or cfgActivator 6-step sequence; in-client UAT checkpoint on SWG Infinity) [autonomous: false]
**UI hint**: yes

### Phase 04.4: UX Polish & Deploy Hardening (INSERTED)

**Goal:** Clear the UI/hardening todo debt while it's cheap — before Phase 5 builds on the freshly-reworked deploy surfaces. Six pending todos (`todos/pending/`), two substantive + four small ride-alongs:
- **`delete-project-with-restore`** (high) — in-app project delete that FIRST restores the bound client to stock via the model-appropriate reset (`restoreCfg`/`deactivatePatch` for cfg models, `resetLoose` for loose-override — all machinery exists post-04.3), then removes the studio dir + umbrella folder; destructive-action confirm.
- **`e2e-deploy-flow-coverage`** (high) — real-Electron Playwright spec(s) for the 04.3-reworked deploy flow (boot with deploy panels → zero console errors; stage → save version → select/reconcile → deploy → revert), closing the known jsdom-green ≠ Electron-runs blind spot.
- **`inapp-console-log-tabs-inactive`** — wire the Data panel Console/Log tabs to a real in-app log surface.
- **`statusbar-mesh-name-stale`** — status bar reflects the currently rendered mesh (name + vert count) on each load.
- **`vfs-override-archive-dim-too-dark`** — bump the non-override winning-archive label from `--color-text-faint` to a legible mid token (check all 5 themes).
- **`viewport-default-facing-axis`** — apply the SWG forward-axis convention as a pure rotation (det +1, no mirror) so default facing matches SIE/in-game.

During `/gsd:discuss-phase 04.4`, two more pending todos were folded in as ride-alongs: `eft-parser-completion`
(native-core `.eft` STAG fixed-function sampler path + CORE-05 fixture activation) and
`product-thesis-shadow-sandbox-and-server-push` (close-out audit + pluggable TRE codec interface + a working
Core3/swg-main server-push target) — see `04.4-CONTEXT.md` D-19..D-23.

**Mode:** mvp
**Requirements**: todo-driven (the 8 items above; no new parent reqs)
**Depends on:** Phase 4.3 (deploy/version surfaces + restore machinery it hardens), Phase 2 (viewport/status bar)
**Success Criteria** (what must be TRUE):
  1. A user can delete a project from the UI behind an explicit confirm; the bound client is byte-pristine afterward (cfg restored / loose overrides reverted per that project's deploy records) and the studio + umbrella folders are gone.
  2. A Playwright spec suite drives the real Electron renderer through the full deploy loop (stage → save version → select → deploy → revert) with zero console errors, and runs in CI.
  3. The Data panel Console/Log tabs are selectable and show live app logs (no DevTools needed for basic diagnosis).
  4. The status bar mesh name/vert count updates on every viewport load.
  5. The VfsTree non-override archive label is legible across the 5 themes; a mesh's authored front faces the default camera like SIE (rotation only — geometry/winding untouched), OR — an accepted, consciously-documented alternative close per 04.4-04's round-2 revision note — the checkpoint confirms mesh identity is already correct and the residual gap is camera-azimuth-only, which is treated as satisfying this criterion by that characterization alone.
**Plans:** 15/15 plans complete

Plans (revised via `/gsd:plan-phase --reviews` on 2026-07-03, ROUND 2 — folds in round-2 cross-AI review
findings from 04.4-REVIEWS.md; see each PLAN.md's REVISION NOTE for details. 04.4-04 stays in Wave 3 (moved
there in round 1) so its blocking human-verify checkpoint doesn't stall Wave 2. ROUND 2 WAVE CHANGE: 04.4-12's
round-1 Task 3 (a blocking real-server checkpoint) is extracted into its own new plan, **04.4-15** (Wave 3,
`depends_on: ["04.4-12"]`) — the same reasoning Opus applied to flag 04.4-04's original Wave-1 placement:
a blocking `autonomous:false` checkpoint in Wave 2 would otherwise stall the Wave 2→3 barrier and delay
04.4-14 (fully autonomous) from starting on a maintainer-availability constraint it has no real dependency
on. 04.4-12 itself is now fully autonomous and stays in Wave 2):
**Wave 1** *(independent — no cross-file dependencies)*
- [x] 04.4-01-PLAN.md — Delete service core (TDD): `deleteProject.ts` restore-first + shared `deploymentReset.ts` (also used by DeployDialog.handleReset, now with a `cleanupArtifacts` opt-out for delete's use — round 2) + `.trash` session-scoped undo, `deleteUndoStore` (round-2: occupied-destination guard on restore), marked-only stale-trash startup purge (round-3: park under one `.trash/<id>/` entry with a `.complete.json` completion marker written last; purge removes only marked entries, unmarked crash-mid-park entries survive and are surfaced); round-2 also fixes close()-before-rename ordering for the currently-open project, an extended basename-collision guard, and a read-only server-push-orphan warning
- [x] 04.4-02-PLAN.md — `logService`/`logStore` core (TDD) + Console/Log panel wiring, capture installed at module-scope/boot-time (D-12/D-15); round-2 adds `resetConsoleCaptureForTests()` for cross-test console-spy isolation
- [x] 04.4-03-PLAN.md — StatusBar mesh name/vert-count wire-up (extends existing StatusBar.test.tsx) + VfsTree non-override label legibility polish
- [x] 04.4-05-PLAN.md — `.eft` parser: FORM STAG fixed-function sampler path + CI-enforced synthetic fixture (round-2: independently hex-sanity-checked against ShaderImplementation.cpp, not just self-consistent with the parser) + local-only real-fixture activation (native-core)
- [x] 04.4-06-PLAN.md — Native TRE codec interface (pluggable inflate/deflate seam via codecForCompressor/codecForTreVersion/codecForBlockCompressor, D-21) — round-3 (maintainer ruling): seam widened to cover BOTH the per-entry payload path AND the TOC/name-block path (header-field-keyed lookup), reversing round-2's payload-only narrowing; prescribed zlibCompress/treDeflate extraction seam to avoid a circular include retained
- [x] 04.4-07-PLAN.md — Server push: Core3 (Lua-array `config-local.lua` injection, cross-restart persistence) + product-thesis close-out audit (D-20/D-22); round-2 locks the reset-vs-clear-record contract (resetCore3TreOverride never clears serverPush.core3.json — the caller, 04.4-12, always does)
- [x] 04.4-08-PLAN.md — Server push: swg-main (loose-file `[SharedFile]` override, verified servercommon.cfg path, cross-restart persistence, D-22); round-2 locks the identical reset-vs-clear-record contract
- [x] 04.4-09-PLAN.md — E2E infra: CI build-before-E2E fix + `SWG_TEST_MODE` hook surface (module-scope install) + fixture client trees (D-06/D-08/D-11); round-2 adds a `listProjects()` test hook (needed by 04.4-14)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 04.4-10-PLAN.md — Delete UI: sketch-017 kebab menu, descriptive confirm modal, undo toast, inline dimmed rows (undo = project-bytes-only, no re-deploy); round-2 fixes the biggest single risk to this UI (both row surfaces now subscribe reactively to `useDeleteUndoStore`, not a one-shot re-fetch — a delete/restore reflects immediately even without a dialog remount), adds an in-flight guard on Delete, the sketch's global kebab-dismiss handlers, and a post-restore confirmation toast
- [x] 04.4-11-PLAN.md — Console/Log: main-process `main-log` IPC forward folded into installConsoleCapture + deploy/reconcile/mount instrumentation (D-13/D-14); round-2 guards the added `require('electron')` seam so 04.4-02's own test doesn't regress, and defers the one-time "app ready" log to `did-finish-load`
- [x] 04.4-12-PLAN.md — Server push UI wiring (VcsPanel "Server Push" section, disk-backed record rehydration) [autonomous: true — round 2: the real-server checkpoint moved to 04.4-15]
- [x] 04.4-13-PLAN.md — E2E deploy-flow spec (D-07 re-based scenario: stage → save → select/reconcile → deploy → revert); round-3 (maintainer ruling): adds a second loose-override scenario in the same spec file, reversing round-2's cfg-model-only scoping for SC #2

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 04.4-04-PLAN.md — Viewport orientation shared module + facing-axis fix [autonomous: false — D-17 human-verify checkpoint; moved here in round 1 so it doesn't block Wave 2]; round-2 makes the SC #5/D-16 reconciliation explicit if the checkpoint reaches the identity outcome
- [x] 04.4-14-PLAN.md — E2E delete-flow spec (D-09: delete → confirm → client-pristine assert → undo → restored; undo asserts client stays in its delete-restored state, no re-deploy); round-2 fixes a reference to a nonexistent test hook, now naming 04.4-09's concrete `listProjects()` hook
- [x] 04.4-15-PLAN.md — **(round-2 NEW plan)** Real-server round-trip checkpoint for server push (D-22's "working deploy target" bar), extracted from 04.4-12's round-1 Task 3 so it doesn't stall the Wave 2→3 barrier for 04.4-14 [autonomous: false — approved 2026-07-06, flavor: core3-wsl2; the live run found+fixed the bare-global TrePath resolver defect (`d60b29f`) exactly per T-04.4-21b]

### Phase 04.3: Versioning Model & SearchTOC Mount Completion (INSERTED)

**Goal:** Land the two big reworks the 04.1/04.2 in-client UAT surfaced as blocking, gated by a sketch-fidelity review, then re-run a single combined UAT.
- **(0) FIRST — Crew UI-vs-sketch gap review.** Before any rework, run the cross-AI consult crew (CLAUDE.md "phone a friend") to diff the **as-built UI against the sketches** (`.planning/sketches/`, esp. 002-version-graph-timeline / 005-deploy-inspect-tab / 006-combined-deploy-tab / 007 / 008) and enumerate every gap (element-by-element, observed/missing). Operationalizes the new AGENTS.md "Sketches are the UI contract" rule; its findings feed the plan list (the flat-vs-branch-tree version history is one known gap — surface the rest).
- **(1) Versioning rework** — couple the live client to the SELECTED version so navigating the version tree IS deploying/reverting: per-version deploy model (first-class, not the live radio), a reconcile-to-version engine (forward apply/backward revert in one op) wired to selection behind a confirm, B3 stock snapshot/restore across versions, deploy-model picker shown only for a new forward deploy, first-class revert from any state (subsumes the reopen-Reset gap), and the **visual branch-tree** version history per sketches 002/005. Spec: `todos/pending/version-navigation-live-sync-deploy-model.md`.
- **(2) SearchTOC / v6000 mount completion** — mount SearchTOC clients from the master `.toc` index (so swg-client-v2's empty-internal-TOC v6000 container `.tre` files contribute entries; payloads read by offset), make v6000 enumerate-only a per-payload runtime check (plain zlib for SWG-Source, encrypted only for Restoration), fix loose-overlay over-enumeration, and the loose-entry mesh viewport. Spec: `todos/pending/v6000-swg-source-plain-zlib-read-support.md`.

Out of scope (separate future item): `delete-project-with-restore` — now scheduled as Phase 4.4.

**Requirements**: Completes parent reqs **TRE-05** (Pillar B searchTOC/v6000 mount), **DEPLOY-03** (rollback/version-navigation), **DEPLOY-08** (loose-override substrate). Phase-internal candidate IDs (carried in plan frontmatter): VER-01..09, GRAPH-01..08, DEPLOYUI-01..15, PROJUI-01..09, SHELL-01..06, MOUNT-01..07.
**Depends on:** Phase 4.2 (searchTOC/loose-override mount + deploy engine it completes), Phase 4.1 (version graph + deploy UX it reworks). Both phases' in-client UATs (04.1-11, 04.2-06) remain open; this phase's combined UAT supersedes re-running them piecemeal.
**Plans:** 12/12 plans executed — **PHASE COMPLETE** (UAT approved 2026-07-03)

Plans:
**Wave 0 — test scaffolds & fixtures**
- [x] 04.3-02-PLAN.md — Pillar A contract stubs + RED tests (syncLiveToVersion, undoStore, laneLayout, LaneGutter)
- [x] 04.3-03-PLAN.md — Pillar B swg-source v6000 byte-exact fixture + native/resolveFull RED scaffolds
**Wave 1 — parallel reworks**
- [x] 04.3-04-PLAN.md — Pillar A reconcile engine + session undo + single live pointer
- [x] 04.3-05-PLAN.md — Branch-tree graph primitives (laneLayout + LaneGutter SVG, 002-A)
- [x] 04.3-06-PLAN.md — VersionHistoryBody rework (two-column graph + silent reconcile wiring)
- [x] 04.3-07-PLAN.md — Deploy panel + staging chrome + forward-deploy-only modal (005/006)
- [x] 04.3-08-PLAN.md — Project-entry front-door polish (007)
- [x] 04.3-09-PLAN.md — Shell-composition polish (008); VCS-tab S3 left AMBIGUOUS
- [x] 04.3-10-PLAN.md — Native per-payload v6000 extraction + extractAt(descriptor)
- [x] 04.3-11-PLAN.md — Renderer master-.toc mount sourcing + lazy searchPath
**Wave 2 — verification gate**
- [x] 04.3-12-PLAN.md — D-16 de-anchoring crew + byte-exact v6000 gate (GO/NO-GO)
**Wave 3 — combined in-client UAT**
- [x] 04.3-13-PLAN.md — Combined UAT on searchTree + searchTOC clients — APPROVED 2026-07-03 via live UAT-iteration (supersedes 04.1-11 + 04.2-06; selection/deploy model decoupled mid-UAT per crew consult — see 04.3-13-SUMMARY.md)

### Phase 04.1: Deploy & Project UX (INSERTED)
**Goal**: Make the now-working deploy loop **discoverable and zero-risk** by building the **approved sketch designs** (005-B / 006-D / 007 / 008) — not a fresh redesign. Bind a project to a client install as the workflow front door (auto-mount its base TRE set); compose the deploy surface into ONE combined Deploy tab (staging over the version graph with per-node expandable changed-file lists + a `Deploy…` modal CTA) inside a single `Inspect | Deploy` dock group; enable staging assets directly from the TRE browser; and re-architect the shadow-sandbox model to **lazy/virtual** (only modified files materialize; original client config snapshot+restorable) so the original client can never be permanently broken. The Phase 4 deploy **engine** (`packPatch`, `changesetService` flatten/seal/select, `cfgActivator`, `DeployDialog`) is reused as-is — this phase is UI/UX composition + the project-binding workflow + the shadow re-architecture, NOT new byte-level format work.
**Mode:** mvp
**Depends on**: Phase 4 (deploy engine it composes), Phase 1 (TRE mount/VFS it stages from)
**Requirements**: PROJ-01, DEPLOY-05, DEPLOY-06, DEPLOY-07
**Success Criteria** (what must be TRUE):
  1. Opening/creating a project binds it to a client install and auto-mounts that client's base TREs into the VFS browser (or, for a non-client project, cleanly disables deploy-to-client).
  2. The deploy loop (stage → save version → select version → deploy) is driven entirely from ONE combined Deploy tab matching sketch 005-B/006-D, in a single `Inspect | Deploy` dock group — no working-changes-vs-history split across tabs.
  3. A user can stage an asset directly from the TRE browser (Extract→Add) without manual virtual-path entry.
  4. Shadow-base deploy materializes only modified files (no multi-GB base copy), and a reset restores the original client config exactly.
  5. A closed deploy/inspect panel can be reopened / the layout reset without restarting the app.

**Ground-truth gate:** DEPLOY-06 (shadow + cfg path handling) is gated on the queued ground-truth verifications — absolute `searchTree` cfg paths accepted by the client (`TreeFile.cpp:115-149`); server TRE search-path config (Core3/swg-main); v6000 = zlib-vs-encrypted (challenges memory `tre-version-oracles-and-v6000-encryption`) — run under the de-anchoring protocol during plan-phase research, NOT from consensus.

**Plans:** 11/11 plans executed — **PHASE COMPLETE** (UAT superseded by 04.3-13, approved 2026-07-03)
Plans:
**Wave 1**
- [x] 04.1-01-PLAN.md — Foundation: extend WorkspaceInfo contract (kind + binding fields) + shared fake-client-dir test fixture + vitest version alignment
**Wave 2**
- [x] 04.1-02-PLAN.md — Project binding service + auto-mount (PROJ-01): projectBinding (detect/persist/auto-mount), extracted treMount routine, workspaceService persistence
**Wave 3**
- [x] 04.1-03-PLAN.md — Combined DeployPanel (DEPLOY-05): extract StagingPanelBody + VersionHistoryBody (Baseline + ▸deltas), compose one panel + sticky Deploy CTA, DeployDialog auto-select bound client (D-12)
- [x] 04.1-04-PLAN.md — Project front door UI (PROJ-01): ProjectBindingBar (＋Project + chip), NewProjectWizard (4-step, capture-only server, non-client branch), WorkspaceEntry first-run welcome
**Wave 4**
- [x] 04.1-05-PLAN.md — Dock integration + layout-version guard (DEPLOY-05/07): workspace-config panel swap (deploy+vcs, LAYOUT_VERSION=2), WorkspaceShell register DeployPanel + version-mismatch migration
**Wave 5**
- [x] 04.1-06-PLAN.md — .studio relocation (whitespace-free) + Baseline changeset seed (DEPLOY-06/D-08): workspaceService getStudioDir, changesetService seedBaseline
**Wave 6**
- [x] 04.1-07-PLAN.md — Shadow re-arch (DEPLOY-06): shadowBaseService fs.link hardlink + EXDEV fallback, cfgActivator snapshot/restore + idempotent [SharedFile] + backup relocation, DeployDialog model radio (absolute-path default)
**Wave 7**
- [x] 04.1-08-PLAN.md — Stage-from-TRE + reset-layout/reopen-panel (DEPLOY-07): Extract→Add derives virtual path, corrected empty-state copy, reset/reopen affordance
- [x] 04.1-09-PLAN.md — Client-layout detection table + manual override (D-13): clientLayout resolver, clientLocator generalization, wizard/binding surfacing
**Wave 8**
- [x] 04.1-10-PLAN.md — Centralize IPC channel return types (Pattern 8): contracts ipc.ts IpcChannels/TypedIpcRenderer + swap all call sites
**Wave 9**
- [x] 04.1-11-PLAN.md — Phase UAT checkpoint — SUPERSEDED by 04.3-13 (approved 2026-07-03); see 04.1-11-SUMMARY.md

### Phase 4.2: Dev-Client Support & Loose-Override Deploy (INSERTED)
**Goal**: Make the toolkit a first-class citizen of the standard **dev/modder workflow**, where the runnable client is **decoupled** from its TRE data — the client binary dir (`stage/`: exe + dlls + `client.cfg`, **zero `.tre`**) references an **external** game-data install by absolute path (verified ground truth: swg-client-v2 / SWG Source). Three capabilities, built as one vertical slice: (1) **detect `client.cfg` layouts** (add the release row to `clientLayout.ts`/`clientLocator.ts`) plus a **manual cfg-path + TRE-dir override** when auto-detect can't classify an install; (2) **extend the mount** (`clientSearchOrder.ts`/`treAutoMount.ts`) to read the FULL base via **`searchTOC`** (a `.toc` master index, token "TOC"/TAG_0001, listing 131+ TREs + a path→archive index, with `TOCTreePath` prepended to each archive name) and **`searchPath`** loose dirs, not just `searchTree`, so the dev client's full asset set is browsable/extractable; (3) add a **"deploy into the top-priority loose `searchPath` override dir"** deploy mode — write edited loose files straight into the override dir (no TRE pack, no `.cfg` surgery, survives cmake/setup regen), which **realizes the lazy/virtual shadow thesis** Phase 04.1 introduced. Reuses the 04.1 project-binding + deploy surface; this is mount-breadth + a new deploy target + detection, NOT new byte-level format work.
**Mode:** mvp
**Depends on**: Phase 04.1 (project-binding/auto-mount/deploy surface it extends), Phase 1 (TRE mount/VFS + `.toc`/IFF readers)
**Requirements**: CLIENT-02, TRE-05, DEPLOY-08
**Success Criteria** (what must be TRUE):
  1. Binding a project to a swg-client-v2-style install (`client.cfg`, external TRE data, no co-located `.tre`) is detected (or completes via manual cfg/TRE-dir override) and persists with the project.
  2. Opening that project auto-mounts the client's FULL base — the `searchTOC` archives (with `TOCTreePath` applied) + `searchPath` loose dirs + `searchTree` overlays — in correct precedence, so the 131-archive base is browsable and an asset (e.g. `texture/ksk_all_spaceterminal.dds`) resolves + extracts.
  3. A "deploy to override dir" mode writes staged loose files into the client's highest-priority `searchPath` directory; the original client install and its generated `client.cfg` are left byte-untouched.
  4. **End-to-end proof:** the toolkit reproduces the hand-verified space-terminal retexture against swg-client-v2 — extract the `.dds`, stage an edit, deploy to the override dir, and the change appears in-game — with no manual file copying.
  5. Existing SWGEmu/Infinity `searchTree`-only clients still mount + deploy exactly as before (no regression).

**Ground-truth gate** (de-anchoring protocol — verify against `../swg-client-v2` source + real bytes, NOT consensus): mount semantics are LOCKED from the 2026-06-28 source trace — `TreeFile::install` reads `searchPath`/`searchTree`/`searchTOC` per priority 0→maxSearchPriority (`TreeFile.cpp:118-148`); `.toc` = token "TOC"/TAG_0001 (`TreeFile_SearchNode.h:270-299`); `TOCTreePath` prepended to in-toc archive names (`TreeFile_SearchNode.cpp:639-671`); precedence priority-DESC, same-priority ties → **LATER-added wins** (do NOT re-derive as first-added). See memory `reference-swg-client-mount-mechanisms` + todo `client-detection-and-layout-model.md`.

**Plans:** 6/6 plans executed — **PHASE COMPLETE** (UAT superseded by 04.3-13, approved 2026-07-03)
Plans:
**Wave 1**
- [x] 04.2-01-PLAN.md — Contracts + RED test scaffolding: LooseDeployRecord type, 'loose-override' DeployModel, SwgChangeset.deployRecord union; RED stubs for tocReader, looseOverrideDeploy, clientLayout (treDirFromCfg case), clientSearchOrder (quote-stripping, looseDirs)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 04.2-02-PLAN.md — Client detection: clientLayout treDirFromCfg flag + swg-client-v2 KNOWN_LAYOUTS row; clientLocator swg-client-v2 knownPath; clientSearchOrder rename parseSearchNodes + family tags + stripQuotes + searchTOC/searchPath/TOCTreePath parsing + looseDirs/tocEntries/tocTreePaths

**Wave 3** *(blocked on Wave 2 completion — parallel pair)*
- [x] 04.2-03-PLAN.md — TOC reader + unified mount: tocReader.ts full-index reader (parseTocHeader + readTocTreeNames + readTocIndex resolving via engine-faithful CRC binary search per `localExists`, `crc32.ts` port of Crc.cpp); treAutoMount ONE ordered mount across searchTOC/searchTree/searchPath (B1/B2/B4); treMount injectLooseDirOverlay (conditional isOverride); treStore appendLooseEntries
- [x] 04.2-04-PLAN.md — Loose-override deploy: looseOverrideDeploy.ts (resolveOverrideDir max-priority; deployLoose snapshots pre-existing files + prunes prior record; resetLoose RESTORES from snapshot; path-safety hardened — drive-relative + trailing-sep confinement); changesetService broadened type

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 04.2-05-PLAN.md — DeployDialog: third radio 'Loose override dir' + resolvedOverrideDir preview; generalize handleBrowse via resolveLayout; handleDeploy + handleReset loose-override branches (deployLoose/resetLoose only, no packPatch/cfgActivator)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 04.2-06-PLAN.md — In-client UAT — SUPERSEDED by 04.3-13 (approved 2026-07-03); see 04.2-06-SUMMARY.md

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
**Plans**: 12 plans
Plans:
**Wave 1**
- [x] 05-01-PLAN.md — Command-slot channel contract + native seqlock extension + pure read-verify guard (write.h/.cpp)
- [x] 05-02-PLAN.md — DTII native parser/serializer (DataTable.h/.cpp) + N-API binding + CORE-05 fixture

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 05-03-PLAN.md — Agent integration: setTransform_o2w write-slot + setScale (D-09) + legacy 64-bit networkId + 60fps guarded poll loop + clean stop-signal
- [x] 05-04-PLAN.md — Host N-API writeCommand export (channel_binding.cpp)
- [x] 05-05-PLAN.md — .stf native parser/serializer (two-section layout, sourceCrc-preserving) + N-API binding + CORE-05 fixture
- [x] 05-06-PLAN.md — Shared GateBar/GateChip/FailBanner + DatatableGridEditor core grid (crumb/toolbar/virtualized typed grid, D-07 widened badges)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 05-07-PLAN.md — Renderer write path: useCommandWriter (zero-alloc) + liveStore COW/write-log/guard extension + detach control wiring
- [x] 05-08-PLAN.md — DatatableGridEditor completion: SchemaRail + Hex toggle + gate-bar wiring to native round-trip + staging + dockview tab (retires DatatablePanel placeholder)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 05-09-PLAN.md — StfStringsEditor (sibling reuse of shared gate/grid idiom) + gate wiring + dockview tab
- [ ] 05-10-PLAN.md — TransformGizmo (restyled drei TransformControls, 4 modes, D-05 offline disabled-with-reason) + GizmoModeRail

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 05-11-PLAN.md — LiveSyncClientCard (full B2 safety states) + TransformReadoutBar + StatusBar mirror + corner-gizmo/vp-stats + final Viewport wiring

**Wave 6** *(blocked on Wave 5 completion)*
- [ ] 05-12-PLAN.md — GC-pressure soak test + maintainer in-world UAT checkpoint (both targets, incl. Scale) [autonomous: false]
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
Phases execute in numeric order: 0 -> 1 -> 2 -> 3 -> 4 -> 4.1 -> 4.2 -> 4.3 -> 4.4 -> 5 -> 6 -> 7 -> 8

(Phase 3 — live-injection — and Phase 6 — Blender bridge — are deliberately OFF the critical path and may be developed in parallel with the format chain; they are listed in numeric order here.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Toolchain De-risk & App Shell | 5/5 | Complete   | 2026-06-22 |
| 1. Core Engine — IFF + TRE + Verification Harness | 4/4 | Complete   | 2026-06-23 |
| 2. 3D Mesh Viewport (MVP Proof) | 5/5 | Complete   | 2026-06-25 |
| 3. Live-Injection Foundation | 7/7 | Complete   | 2026-06-26 |
| 4. Edit & Deploy Loop | 8/8 | Complete   | 2026-07-01 |
| 4.1 Deploy & Project UX *(INSERTED)* | 11/11 | Complete | 2026-07-03 |
| 4.2 Dev-Client Support & Loose-Override Deploy *(INSERTED)* | 6/6 | Complete | 2026-07-03 |
| 4.3 Versioning Model & SearchTOC Mount Completion *(INSERTED)* | 12/12 | Complete | 2026-07-03 |
| 4.4 UX Polish & Deploy Hardening *(INSERTED)* | 0/15 | Planned, not executed | - |
| 5. WYSIWYG Live-Sync & Typed Editors | 0/12 | Planned, not executed | - |
| 6. Blender Bridge | 0/TBD | Not started | - |
| 7. Format Editors | 0/TBD | Not started | - |
| 8. Parity, Navmesh, MCP & AI | 0/TBD | Not started | - |
