# SWG Toolkit — Requirements

Derived from `PROJECT.md`, the `docs/` design library, and `.planning/research/` (STACK / FEATURES / ARCHITECTURE / PITFALLS / SUMMARY). All v1 requirements are hypotheses until shipped and validated.

**REQ-ID format:** `[CATEGORY]-[NN]`. Requirements are user-centric, specific, testable, and atomic.

> **Standing gate (applies to every CORE/DATA/format requirement):** no binary parser or serializer is "done" until it passes a **byte-exact round-trip test on a real extracted asset** and cites the corresponding `swg-client-v2` loader source. Binary layouts in `docs/` are AI-proposed hypotheses (see `docs/00-overview/source-provenance.md`).

---

## v1 Requirements

### Foundation & App Shell (FND)
- [x] **FND-01**: App boots as an Electron desktop app with secure context isolation and a narrow, validated preload bridge (no Node in the renderer).
- [x] **FND-02**: The C++ Node-API addon builds via cmake-js (prebuildify distribution) and loads in the Electron **main/utility** process.
- [x] **FND-03**: Cross-origin isolation (COOP/COEP) is enabled so `SharedArrayBuffer` is allocatable in the renderer.
- [x] **FND-04**: A shared-types `contracts/` package defines the IPC, byte-offset, and opcode types used across native ↔ backend ↔ renderer.
- [ ] **FND-05**: The app presents a dark, dockable, persistent multi-panel workspace (dockview) — sidebar / 3D canvas / data pane / inspector.

### Core Engine — IFF & TRE (CORE)
- [ ] **CORE-01**: User can mount one or more `.tre` archives as a virtual filesystem with correct load-order/override resolution.
- [ ] **CORE-02**: User can browse and search the mounted virtual filesystem by path/name.
- [ ] **CORE-03**: System parses an arbitrary IFF (FORM/chunk) file into a navigable tree the UI can display.
- [ ] **CORE-04**: System serializes an edited IFF structure back to a byte-exact file/archive.
- [ ] **CORE-05**: A reusable format-verification harness round-trips real extracted assets byte-for-byte (fixtures + assertion), and is wired into every format's tests.
- [ ] **CORE-06**: Binary payloads (geometry, textures, audio, terrain) cross the N-API bridge zero-copy and parse on async worker threads (UI never blocks).

### 3D Viewer (VIEW)
- [ ] **VIEW-01**: User can open a static or skinned mesh (`.msh`/`.mgn`) and see it rendered in a Three.js viewport with an orbit camera.
- [ ] **VIEW-02**: System renders `.dds` textures and `.pal` palette customization on the displayed mesh.
- [ ] **VIEW-03**: User can preview a skeleton (`.skt`/`.sat`) and play back `.ans` animations.
- [ ] **VIEW-04**: User can extract raw assets and export a viewed mesh to glTF/COLLADA.

### Edit & Deploy Loop (DEPLOY)
- [ ] **DEPLOY-01**: User can repack edits into a deployable `.tre` patch archive.
- [ ] **DEPLOY-02**: System updates the client `.cfg` search order to activate a patch (with safe, BOM-free writes).
- [ ] **DEPLOY-03**: User can roll back changes via a changeset/snapshot history.
- [ ] **DEPLOY-04**: User can version **mod-produced** assets via Git/LFS (never retail `.tre` dumps).

### Live In-Game Sync (LIVE) — *Windows-only differentiator*
- [ ] **LIVE-01**: User can attach the toolkit to a running SWG client process on Windows.
- [ ] **LIVE-02**: System read-verifies an object's live memory state before writing to it.
- [ ] **LIVE-03**: User can drag a viewport gizmo and see the object move in the running client in real time (zero restart).
- [ ] **LIVE-04**: System provides a live memory/packet inspector HUD.
- [ ] **LIVE-05**: The editor remains fully usable in file-patch mode when injection is unavailable.

### Typed Data Editors (DATA)
- [ ] **DATA-01**: User can view and edit DTII datatables in a virtualized grid and save them back.
- [ ] **DATA-02**: User can view and edit `.stf` localized strings and save them back.

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

### AI & MCP (AI)
- [ ] **AI-01**: The toolkit exposes its capabilities as an MCP server (read-only resources + confirmation-gated write tools).
- [ ] **AI-02**: AI assists where it adds value (e.g. natural-language datatable queries, mocap→`.ans`, format reverse-engineering aid) — advisory, with diff/preview before any write.

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

*Every v1 requirement maps to exactly one phase. Coverage: 37/37 (100%).*

| REQ-ID | Phase | Status |
|--------|-------|--------|
| FND-01 | Phase 0 | Complete |
| FND-02 | Phase 0 | Complete |
| FND-03 | Phase 0 | Complete |
| FND-04 | Phase 0 | Complete |
| FND-05 | Phase 0 | Pending |
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| CORE-05 | Phase 1 | Pending |
| CORE-06 | Phase 1 | Pending |
| VIEW-01 | Phase 2 | Pending |
| VIEW-02 | Phase 2 | Pending |
| VIEW-03 | Phase 2 | Pending |
| VIEW-04 | Phase 2 | Pending |
| LIVE-01 | Phase 3 | Pending |
| LIVE-02 | Phase 3 | Pending |
| LIVE-04 | Phase 3 | Pending |
| LIVE-05 | Phase 3 | Pending |
| DEPLOY-01 | Phase 4 | Pending |
| DEPLOY-02 | Phase 4 | Pending |
| DEPLOY-03 | Phase 4 | Pending |
| DEPLOY-04 | Phase 4 | Pending |
| LIVE-03 | Phase 5 | Pending |
| DATA-01 | Phase 5 | Pending |
| DATA-02 | Phase 5 | Pending |
| BLND-01 | Phase 6 | Pending |
| BLND-02 | Phase 6 | Pending |
| FMT-01 | Phase 7 | Pending |
| FMT-02 | Phase 7 | Pending |
| FMT-03 | Phase 7 | Pending |
| FMT-04 | Phase 7 | Pending |
| FMT-05 | Phase 7 | Pending |
| FMT-06 | Phase 7 | Pending |
| SRV-01 | Phase 8 | Pending |
| AI-01 | Phase 8 | Pending |
| AI-02 | Phase 8 | Pending |
