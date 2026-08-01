# SWG Toolkit — Requirements

Derived from `PROJECT.md`, the `docs/` design library, and `.planning/research/` (STACK / FEATURES / ARCHITECTURE / PITFALLS / SUMMARY). All v1 requirements are hypotheses until shipped and validated.

**REQ-ID format:** `[CATEGORY]-[NN]`. Requirements are user-centric, specific, testable, and atomic.

> **Standing gate (applies to every CORE/DATA/format requirement):** no binary parser or serializer is "done" until it passes a **byte-exact round-trip test on a real extracted asset** and cites the corresponding `swg-client-v2` loader source. Binary layouts in `docs/` are AI-proposed hypotheses (see `docs/00-overview/source-provenance.md`).

---

## v1 Requirements

### Foundation & App Shell (FND)
- [x] **FND-01**: App boots as an Electron desktop app with COOP/COEP cross-origin isolation (`crossOriginIsolated=true`). Native code runs **in the renderer process** under the Path B fallback posture (`sandbox:false + nodeIntegration:true + contextIsolation:false`). The preferred posture (`sandbox:false + contextIsolation:true + preload contextBridge`) was attempted first and rejected at runtime: `contextBridge.exposeInMainWorld()` cannot carry a C++ `SharedArrayBuffer` across the isolated-world boundary (same agent-cluster restriction as cross-process SAB, throws "An object could not be cloned"). **Residual risk:** renderer runs native code; a native crash takes the renderer. Accepted as a deliberate maintainer decision for this trusted local desktop tool (see [00-REPLAN.md](phases/00-toolchain-de-risk-app-shell/00-REPLAN.md) DECISION section). Mitigation: no external web content is loaded in the main renderer window; if a web content pane is added, it must use a separate `BrowserWindow` with `sandbox:true`. `[x]` reflects the revised criterion: COOP/COEP active + Path B posture documented with residual risk.
- [x] **FND-02**: The C++ Node-API addon builds via cmake-js (prebuildify distribution) and loads **in the renderer process** (Path B — `sandbox:false`, `nodeIntegration:true`). The addon is never auto-loaded into an untrusted or sandboxed web context; the renderer is the trusted app shell. Original text said "main/utility process" — revised because the utility process is not on the data path under Path B (utility-worker.ts was removed in Plan 00-03). ABI-stable N-API ensures one `prebuilds/` artifact serves both bare Node (vitest) and Electron without a separate Electron ABI rebuild. Non-circularity proven in 00-02 (load from `prebuilds/`, not `build/`).
- [x] **FND-03**: Cross-origin isolation (COOP/COEP) is enabled so `SharedArrayBuffer` is allocatable in the renderer.
- [x] **FND-04**: A shared-types `contracts/` package defines the IPC, byte-offset, and opcode types used across native ↔ backend ↔ renderer.
- [x] **FND-05**: The app presents a dark, dockable, persistent multi-panel workspace (dockview) — sidebar / 3D canvas / data pane / inspector.

### Core Engine — IFF & TRE (CORE)
- [x] **CORE-01**: User can mount one or more `.tre` archives as a virtual filesystem with correct load-order/override resolution.
- [ ] **CORE-02**: User can browse and search the mounted virtual filesystem by path/name.
- [x] **CORE-03**: System parses an arbitrary IFF (FORM/chunk) file into a navigable tree the UI can display.
- [x] **CORE-04**: System serializes an edited IFF structure back to a byte-exact file/archive.
- [x] **CORE-05**: A reusable format-verification harness round-trips real extracted assets byte-for-byte (fixtures + assertion), and is wired into every format's tests.
- [ ] **CORE-06**: Binary payloads (geometry, textures, audio, terrain) cross the N-API bridge zero-copy and parse on async worker threads (UI never blocks).

### TRE Mount (TRE)
- [x] **TRE-05**: User can mount a decoupled client's FULL base via `searchTOC` (.toc master index, with `TOCTreePath` applied) + `searchPath` loose dirs + `searchTree` overlays in correct precedence — not just `searchTree`. *(Phase 4.2)*

### 3D Viewer (VIEW)
- [x] **VIEW-01**: User can open a static or skinned mesh (`.msh`/`.mgn`) and see it rendered in a Three.js viewport with an orbit camera.
- [x] **VIEW-02**: System renders `.dds` textures and `.pal` palette customization on the displayed mesh.
- [ ] **VIEW-03**: User can preview a skeleton (`.skt`/`.sat`) and play back `.ans` animations.
- [ ] **VIEW-04**: User can extract raw assets and export a viewed mesh to glTF/COLLADA.

### Edit & Deploy Loop (DEPLOY)
- [x] **DEPLOY-01**: User can repack edits into a deployable `.tre` patch archive.
- [x] **DEPLOY-02**: System updates the client `.cfg` search order to activate a patch (with safe, BOM-free writes).
- [x] **DEPLOY-03**: User can roll back changes via a changeset/snapshot history.
- [ ] **DEPLOY-04**: User can version **mod-produced** assets via Git/LFS (never retail `.tre` dumps).
- [x] **DEPLOY-05**: User drives the deploy loop from ONE combined Deploy surface — staging (working changes) over the version graph (per-node expandable changed-file lists) with a `Deploy…` modal CTA — composed into the shell as a single `Inspect | Deploy` dock group (approved sketches 005-B/006-D/008). *(Phase 4.1)*
- [x] **DEPLOY-06**: The shadow-sandbox deploy model is **lazy/virtual and reversible** — only modified files materialize into the override archive, the original client config is snapshot+restorable, and the multi-GB base copy is retired. *(Phase 4.1; gated on ground-truth cfg/TRE verification)*
- [x] **DEPLOY-07**: User can stage assets directly from the TRE browser (Extract→Add, no manual virtual-path entry) and can reopen a closed panel / reset the workspace layout (no soft-brick). *(Phase 4.1)*
- [x] **DEPLOY-08**: User can deploy staged edits by writing loose files into the client's highest-priority `searchPath` override dir (no TRE pack, no `.cfg` surgery); the original install + generated `client.cfg` stay byte-untouched, and a reset removes only toolkit-written files. *(Phase 4.2)*

### Project & Client Binding (PROJ)
- [x] **PROJ-01**: User binds a project to a client install (the workflow front door), which auto-mounts that client's base TRE set into the VFS; non-client projects are first-class (no bound client, deploy-to-client disabled). *(Phase 4.1)*

### Dev-Client Support (CLIENT)

> **Note:** CLIENT-01 is intentionally unused/reserved to maintain ID continuity within the CLIENT category. The first shipped requirement is CLIENT-02 to match the ROADMAP's proposed identifier for this phase.

- [x] **CLIENT-02**: Toolkit detects `client.cfg`-style decoupled installs (binary dir with zero co-located `.tre`, external TRE data by absolute path) — or completes via a manual cfg-path + TRE-dir override — and persists the layout with the project binding. *(Phase 4.2)*

### Live In-Game Sync (LIVE) — *Windows-only differentiator*
- [x] **LIVE-01**: User can attach the toolkit to a running SWG client process on Windows.
- [x] **LIVE-02**: System read-verifies an object's live memory state before writing to it.
- [x] **LIVE-03**: User can drag a viewport gizmo and see the object move in the running client in real time (zero restart). *(Build-and-guard verification closes in 05-12; a prior plan's summary prematurely marked this complete before the maintainer's in-world UAT — checkpoint pending, see 05-12-SUMMARY.md)*
- [x] **LIVE-04**: System provides a live memory/packet inspector HUD.
- [x] **LIVE-05**: The editor remains fully usable in file-patch mode when injection is unavailable.

### Typed Data Editors (DATA)
- [x] **DATA-01**: User can view and edit DTII datatables in a virtualized grid and save them back.
- [x] **DATA-02**: User can view and edit `.stf` localized strings and save them back.

### Format Editors — leaves (FMT)
- [ ] **FMT-01**: User can view/edit and serialize terrain (`.trn`) layers and fractals.
- [ ] **FMT-02**: User can view/edit and serialize world snapshots (`.ws`) — object placement.
- [ ] **FMT-03**: User can view/edit and serialize flora (`.fld`) placement.
- [ ] **FMT-04**: User can view/edit and serialize collision/portals (`.cdf`/`.pob`/`.floc`).
- [ ] **FMT-05**: User can view/edit and serialize client UI layouts (`.ui`).
- [ ] **FMT-06**: User can view/edit and serialize audio (`.snd`) and particles/effects (`.prt`/`.eft`).

### Blender Bridge (BLND)
- [ ] **BLND-01**: The Blender plugin connects to the toolkit over a WebSocket bridge.
- [ ] **BLND-02**: User can export a Blender animation to a valid SWG `.ans` (with Z-up→Y-up coordinate conversion).

### Server Parity (SRV)
- [ ] **SRV-01**: User can sync client datatable changes to Core3/SWGEmu Lua templates with a parity audit reporting zero drift.

### Guided Workflows (WF) — *maintainer-originated: AI-driven mod wizards*
- [ ] **WF-01**: Guided workflows for the top mod archetypes (texture reskin, mod packaging + per-server policy check, …), fully operable **without AI** (tier A). Includes the keystone **asset-discovery resolver** (template → appearance chain → `.sht` → `.dds`) every wizard reuses, and per-server legality as a first-class concept.
- [ ] **WF-02**: Workflows exposed through the MCP server so an external agent the user already owns (Claude Code/Cursor/Copilot) can drive a wizard — with **human-custody confirmation** (the agent's `workflow.confirm` *requests*; the grant comes from the user in the toolkit; no self-approval past a deploy/live-write boundary).

### AI & MCP (AI)
- [ ] **AI-01**: The toolkit exposes its capabilities as an MCP server (read-only resources + confirmation-gated write tools). *(The `workflow.*` slice + tiers B/C land earlier in Phase 5.2 per WF-02/AI-03; AI-01 here broadens the surface to the full backend service set.)*
- [ ] **AI-02**: AI assists where it adds value (e.g. natural-language datatable queries, mocap→`.ans`, format reverse-engineering aid) — advisory, with diff/preview before any write.
- [ ] **AI-03**: An optional embedded agent with user-supplied credentials (BYO key / Claude subscription) can drive any workflow, stopping at every confirmation boundary; everything still works with AI absent. *(Tier-C SDK/OAuth specifics verified against the current Claude API reference at build time.)*

---

## v2 — Deferred

- Additional format editors beyond the v1 set (`.sky`/`.wth`, `.spw`, `.prp`, `.lsb`/shader graph, `.mif` camera sequencer).
- Visual node-based shader/material editor (`.sht`).
- Application auto-update system (Squirrel + asset-template streaming).
- Multiplayer / collaborative live editing.
- AI mocap retargeting templates; asset semantic search/auto-tagging; procedural-content assist.
- Remote changeset distribution / differential network sync; server deployment daemon.

## Out of Scope

- **From-scratch SWG client/server** — we integrate with `swg-client-v2` / `swg-main` / `Core3`, not replace them.
- **In-app 3D mesh/rig/UV editing** — bridge to Blender instead of rebuilding it.
- **Cross-platform memory injection** — injection is hard-fenced to Win32; other features stay cross-platform.
- **Non-SWG game formats.**
- **Trusting AI-proposed binary layouts** — every format is verified against ground truth before shipping.

---

## Traceability

*Every v1 requirement maps to exactly one phase. Coverage: 47/47 (100%).*

| REQ-ID | Phase | Status |
|--------|-------|--------|
| FND-01 | Phase 0 | Complete |
| FND-02 | Phase 0 | Complete |
| FND-03 | Phase 0 | Complete |
| FND-04 | Phase 0 | Complete |
| FND-05 | Phase 0 | Complete |
| CORE-01 | Phase 1 | Complete |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Complete |
| CORE-04 | Phase 1 | Complete |
| CORE-05 | Phase 1 | Complete |
| CORE-06 | Phase 1 | Pending |
| TRE-05 | Phase 4.2 | Complete (04.3-13 UAT 2026-07-03) |
| VIEW-01 | Phase 2 | Complete |
| VIEW-02 | Phase 2 | Complete |
| VIEW-03 | Phase 2 | Pending |
| VIEW-04 | Phase 2 | Pending |
| LIVE-01 | Phase 3 | Complete |
| LIVE-02 | Phase 3 | Complete |
| LIVE-04 | Phase 3 | Complete |
| LIVE-05 | Phase 3 | Complete |
| DEPLOY-01 | Phase 4 | Complete (04.3-13 UAT 2026-07-03) |
| DEPLOY-02 | Phase 4 | Complete (04.3-13 UAT 2026-07-03) |
| DEPLOY-03 | Phase 4 | Complete (04.3-13 UAT 2026-07-03; decoupled select/deploy model) |
| DEPLOY-04 | Phase 4 | Pending |
| DEPLOY-05 | Phase 4.1 | Complete |
| DEPLOY-06 | Phase 4.1 | Complete |
| DEPLOY-07 | Phase 4.1 | Complete |
| DEPLOY-08 | Phase 4.2 | Complete (04.3-13 UAT 2026-07-03) |
| PROJ-01 | Phase 4.1 | Complete |
| CLIENT-02 | Phase 4.2 | Complete (04.3-13 UAT; detection now content-based, 2026-07-02) |
| LIVE-03 | Phase 5 | Pending (05-12 Task 2 in-world UAT checkpoint not yet approved) |
| DATA-01 | Phase 5 | Complete |
| DATA-02 | Phase 5 | Complete |
| BLND-01 | Phase 6 | Pending |
| BLND-02 | Phase 6 | Pending |
| FMT-01 | Phase 7 | Pending |
| FMT-02 | Phase 7 | Pending |
| FMT-03 | Phase 7 | Pending |
| FMT-04 | Phase 7 | Pending |
| FMT-05 | Phase 7 | Pending |
| FMT-06 | Phase 7 | Pending |
| WF-01 | Phase 5.2 | Pending |
| WF-02 | Phase 5.2 | Pending |
| AI-03 | Phase 5.2 | Pending |
| SRV-01 | Phase 8 | Pending |
| AI-01 | Phase 8 | Pending |
| AI-02 | Phase 8 | Pending |
