# Feature Research

**Domain:** SWG (Star Wars Galaxies) modding suite — asset editor + live-client studio replacing SIE / Utinni / TRE Explorer
**Researched:** 2026-06-21
**Confidence:** HIGH for feature categorization (verified against real tools); MEDIUM for complexity estimates (binary formats are AI-proposed and must be ground-truthed against `swg-client-v2`); LOW for live-injection effort (pointer discovery is build-specific and unbounded)

---

## Reality Check: What the Tools Being Replaced Actually Do

This grounds the table-stakes baseline. The bar is higher than "new tool" framing implies — **SIE is already an all-in-one suite**, so parity is the entry ticket, not the differentiator.

| Tool | Verified capabilities | Gap this project exploits |
|------|----------------------|---------------------------|
| **SIE (Sytner's IFF Editor)** | All-in-one editor suite: repository (TRE) access, **3D preview**, content search, TRE/TOC management, many format editors | Closed-source, WinForms-era, not scriptable/extensible, no live-client injection, no Blender round-trip |
| **TRE Explorer (Swg.Explorer)** | Browse multiple TRE archives, preview IFF / STF / DDS / audio, **export static+dynamic meshes to COLLADA (.dae)**, STF→CSV, raw extract | Read/extract only — not an editor; no packing, no live edit |
| **Utinni** (`ptklatt/Utinni`) | Client injection framework, **ImGuizmo 3D gizmos**, object browser from loaded game files, **drop objects as snapshot nodes**, freecam + hide-player, **live reload** (scene/snapshot/UI without restart), C#/C++ plugin frameworks, undo/redo, rebindable hotkeys, embedded WinForms editor | C#/WinForms, embeds the client window (vs. in-canvas WebGL); not a general format editor; injection logic is the asset to mine |
| **SWB (Star Wars Builder)** | Terrain, animation, appearance editing; SWGEmu region editor | Separate tool; not unified with IFF/datatable workflow |
| **Blender plugins** (`nostyleguy/io_scene_swg_msh` + `_mgn`) | Import/export `.msh` (v0004/0005) and `.mgn`: base mesh, UV (auto Y-flip), shader names, bone names→vertex groups, vertex weights, blends→shape keys, occlusion zones, skeleton name | Manual export→convert→copy→pack→restart loop; no live bridge, no automated changeset/packaging |
| **Misc point tools** | STF editors, SKT skeleton editors, APT generators, Lua object creators, FLR collision editors, slot-definition managers, galaxy-map editor | Fragmented; one format each; no shared workspace/versioning |

**Takeaway for sequencing:** The community already has 3D preview (SIE, TRE Explorer→COLLADA), gizmo-based live placement (Utinni), and Blender mesh round-trip (nostyleguy). None of these is novel. The novel combination is **all of them in one open, scriptable app with a zero-restart loop and Core3 parity baked in.** v1 must hit the *baseline* (mount + parse + view + extract) before any differentiator earns trust.

---

## Feature Landscape

### Table Stakes (Users Won't Switch Without These)

Missing any of these makes the tool a downgrade from SIE/TRE Explorer. No credit for having them; immediate rejection for lacking them.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Mount `.tre` / `.toc` archives as virtual FS** | TRE Explorer + SIE both do this; it is the entry point to every asset | MEDIUM | Multiple archives, load-order/override resolution, CRC path lookup. Foundation for everything. See `docs/01-core-engine/iff-and-tre.md`. |
| **Browse + search asset tree** | SIE has content search; modders hunt by name across thousands of CRC paths | LOW–MEDIUM | Virtual path tree, filter, full-text/name search. AI semantic search is the *differentiator* version. |
| **Generic IFF chunk parse/view** | "Everything is IFF"; SIE/TRE Explorer preview raw IFF | MEDIUM | FORM/chunk tree reader; hex + structured views. Prereq for all typed editors. See `docs/02-formats/object-templates.md`. |
| **3D mesh viewer (`.msh`/`.mgn`)** | SIE has 3D preview; TRE Explorer exports COLLADA | HIGH | Three.js/R3F viewport: geometry, materials/shaders (`.sht`), textures (DDS). The core "feel" of the tool. Formats AI-proposed → validate. |
| **Composite appearance assembly (`.sat`/`.apt`)** | A character/creature isn't one mesh; SWG layers LODs + skeletal mesh + variations | HIGH | Compose multiple `.mgn` + skeleton into one rendered appearance. Depends on mesh + skeleton parsing. |
| **Skeleton + animation preview (`.skt`/`.ans`)** | Animated assets must be viewable animated; SWB does animations | HIGH | Three.js Skeleton/AnimationMixer; bind `.ans` tracks to `.skt`. |
| **Datatable (DTII) view/edit as grid** | Stats/balance work is the most common mod task; multiple point tools exist | MEDIUM | Spreadsheet UI over DTII columns/rows; type-aware cells. High-frequency use. |
| **String table (`.stf`) view/edit** | Localization is ubiquitous; STF editors + TRE Explorer CSV export exist | LOW–MEDIUM | Key/value editor, CSV import/export. Low complexity, high expectation. |
| **Texture (DDS) preview** | Every mesh references textures; TRE Explorer renders DDS | LOW | DDS decode to canvas/WebGL texture. |
| **Audio (`.snd`) playback** | TRE Explorer plays audio via NAudio | LOW–MEDIUM | Web Audio playback of decoded samples. |
| **Extract raw files out of archive** | TRE Explorer's baseline; modders need escape hatch to other tools | LOW | Export selected asset(s) to disk, preserving virtual paths. |
| **Export mesh to COLLADA/glTF** | TRE Explorer + Blender plugins set this expectation | MEDIUM | Interop with external 3D tools; glTF preferred over aging COLLADA. |
| **Pack edited assets into `.tre` patch** | The whole point is shipping a mod; no tool is complete without it | MEDIUM–HIGH | C++ archive builder from staging dir. The "deploy" half of the loop. See `docs/06-workflow/packaging-and-distribution.md`. |
| **IFF serialize (write-back)** | Editing is meaningless if you can't save; round-trip fidelity required | HIGH | Byte-exact re-serialization. **Highest correctness risk** — a wrong byte crashes the client. |
| **Undo/redo** | Utinni has it; basic editor hygiene | MEDIUM | Per-document command stack; ties into changeset model. |
| **Dark IDE-style dockable workspace** | Modern editor baseline; SIE/Utinni are dated WinForms | MEDIUM | Dockable panels, tabs. See `docs/08-ui-ux/workspace-layout.md`. |

### Differentiators (This Toolkit's Edge)

These align directly with PROJECT.md Core Value. Do NOT try to differentiate on everything — these are the chosen battlegrounds.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Live in-game injection (zero-restart WYSIWYG)** | THE killer feature: 3–5 min restart loop → 0.1s. Drag in canvas → object moves in running client. No other open tool does this in-canvas. | VERY HIGH | Windows-only (`OpenProcess`/`WriteProcessMemory`); SharedArrayBuffer transform channel + packet sniffer. **Effort unbounded** — pointer/offset discovery is per-client-build and must be mined from Utinni. See `docs/04-live-sync/`. |
| **Blender bridge (round-trip, one-click)** | Collapses export→convert→copy→pack→restart into one button; bridges elite rigging/animation to native SWG formats | HIGH | Local WebSocket + Python addon; mesh/anim/collision-hull extraction; coordinate remap. Builds on existing nostyleguy plugins. See `docs/07-blender/`. |
| **Core3/SWGEmu parity (dual-track save)** | Editing a client DTII auto-generates the matching Core3 Lua template → eliminates client/server drift (rubber-banding, crashes). Unique workflow. | HIGH | Path mapping + Lua codegen + optional remote deploy daemon. Paths AI-proposed → validate against `MMOCoreORB`. See `docs/05-server-integration/`. |
| **MCP server (toolkit as agent-drivable)** | Expose parse/edit/build as MCP tools+resources so Claude can drive SWG modding conversationally. No precedent in this community. | MEDIUM (after core) | Thin wrapper over N-API surface; read-heavy by default, writes behind confirmation. Only valuable once core engine is real. See `docs/09-ai-mcp/`. |
| **AI assists (NL queries, mocap→.ans, format RE, asset search)** | NL datatable edits; video→animation; agent-assisted format reverse-engineering attacks the project's biggest risk | MEDIUM–HIGH | Advisory/reviewable only; diff-before-commit. Mocap pipeline leans on existing cloud/local tools (Rokoko, DeepMotion, OpenPose). |
| **Changeset version control + rollback (Git/LFS)** | Per-change layers, one-click rollback across client+server; nothing in the SWG ecosystem offers this | MEDIUM–HIGH | Changeset VFS over staging dir; Git/LFS for binary assets. See `docs/06-workflow/version-control-and-backup.md`. |
| **Open-source + plugin-routable + schema-driven** | The structural opposite of the closed tools it replaces; community can extend it | MEDIUM | Architectural, not a single feature — earns trust and longevity. |
| **Procedural terrain editor (`.trn`) with live splat preview** | SWB does terrain but separately; unified terrain + live injection is novel | VERY HIGH | LAYR tree, fractals, boundary polys, splat rendering. Largest single-format surface. See `docs/02-formats/terrain.md`. |
| **World snapshot editor (`.ws`) with in-canvas placement** | Utinni does live placement; doing it offline + live + versioned in one tool is the edge | HIGH | OTPL/NODD object nodes; drag-place; ties to live injection. See `docs/02-formats/world-snapshots.md`. |
| **Packet sniffer / live memory auditor** | Debug client crashes by watching opcodes/memory in real time during a test loop | HIGH | WinSock2 Detours hooks; ride-along with injection. Niche but powerful for hard bugs. |

### Anti-Features (Deliberately NOT Building)

Documenting these prevents scope creep. PROJECT.md Out-of-Scope is the source of truth.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **In-app mesh/UV/rig/animation editing** | "One tool to rule them all" temptation; avoid leaving the app | Reinventing Blender = years of work, worse than Blender | **Bridge to Blender** (PROJECT.md Out-of-Scope). Own the SWG binary compilers, not the 3D editing. |
| **From-scratch SWG client or server** | Full vertical control | Massive, duplicates `swg-client-v2`/`swg-main`/`Core3`; preservation community already maintains these | **Integrate** with existing client/server (PROJECT.md Out-of-Scope). |
| **Non-SWG game format support** | "Make it a generic game-asset editor" | Dilutes focus; SWG IFF/TRE specifics are the moat | SWG only (PROJECT.md Out-of-Scope). |
| **Trusting AI-proposed binary layouts as-is** | Faster shipping; docs already describe ~40 formats | Gemini-distilled layouts are plausible-but-fabricated; a wrong struct = client crash / corrupted save | **Validate every layout** against `swg-client-v2` / community tools before shipping a parser/serializer (PROJECT.md Out-of-Scope + every format-doc caveat). |
| **Cross-platform live injection** | "Live edit on Mac/Linux" | `OpenProcess`/`WriteProcessMemory` are Windows-only; SWG client is Windows | Make the *editor* cross-platform-leaning; gate **injection as Windows-only** (PROJECT.md Constraint). Editing/packing works everywhere; live loop is Windows. |
| **JSON-serializing geometry/textures/audio/terrain** | Simpler IPC, uniform pipes | Kills performance; 60Hz transform updates stutter | **Binary stays binary** — zero-copy SharedArrayBuffer/typed-array buffers; JSON only for low-frequency control (PROJECT.md Constraint). |
| **Autonomous AI writing to live client/server** | "Let the agent just do it" | Silent mutation of a running process or live server = data loss / crashes | **Advisory + per-action human confirmation**; dry-run/preview; diff before commit (`docs/09-ai-mcp/` Guardrails). |
| **Collaborative multiplayer live editing (v1)** | Sketched in live-sync doc as a synergy | Requires server-side broadcast daemon + conflict resolution; huge surface for a v1 | Defer to v2+; single-user live loop first. |
| **Remote server deployment daemon exposed on network (as-sketched)** | Hot-reload remote Core3 | Doc daemon binds `0.0.0.0` with no auth — security hole | Local/loopback only until a real auth/TLS review (`docs/05-server-integration/` security note). |

---

## Feature Dependencies

```
TRE mount (virtual FS)
    └──requires──> nothing  [FOUNDATION — first thing built]
            │
            ▼
IFF chunk parser  ──requires──> TRE mount
            │
            ├──> DTII datatable editor ──requires──> IFF parse
            ├──> STF string editor     ──requires──> IFF parse
            ├──> Object-template view   ──requires──> IFF parse
            │
            ▼
Mesh parser (.msh/.mgn) ──requires──> IFF parse + DDS decode
            │
            ▼
3D viewer (Three.js/R3F) ──requires──> Mesh parser + Texture decode
            │
            ├──> Appearance compose (.sat/.apt) ──requires──> Mesh + Skeleton
            └──> Skeleton/Animation (.skt/.ans)  ──requires──> 3D viewer
                        │
                        ▼
            Blender bridge ──requires──> Mesh/Skeleton parse+serialize
                        │
                        ▼
            AI mocap → .ans ──requires──> Blender bridge + .ans serialize

IFF serialize (write-back) ──requires──> IFF parse  [correctness-critical]
            │
            ▼
.tre packer ──requires──> IFF serialize + staging dir
            │
            ▼
Changeset VCS ──requires──> staging dir
            │
            ▼
Core3 parity ──requires──> DTII editor + .tre packer (+ Lua codegen)

Live injection ──requires──> 3D viewer (gizmo) + native C++ memory module
            └──enhances──> World snapshot editor, terrain editor (in-canvas WYSIWYG)

Packet sniffer ──rides-along──> Live injection (shared C++ hook layer)

MCP server ──requires──> a real N-API surface (parse/edit/build) to wrap
AI in-app features ──enhance──> DTII editor, asset search, format RE, parity
```

### Dependency Notes

- **Everything requires TRE mount + IFF parse.** These are the trunk; build them first, validated against ground truth. No editor is possible without them.
- **3D viewer requires mesh + texture decode** before it can render anything; the viewport is the second pillar after the file layer.
- **IFF serialize is the correctness chokepoint.** Every "save," every "pack," every parity sync depends on byte-exact write-back. A single wrong field corrupts the asset and can crash the client. Treat serialize as higher-risk than parse and validate round-trips (parse→serialize→byte-compare) per format.
- **Live injection requires the gizmo/viewport AND a working native memory module.** It cannot precede the 3D viewer. Pointer discovery (mined from Utinni) is its own unbounded research task — sequence it as a dedicated phase, not bundled with the viewer.
- **Blender bridge requires mesh/skeleton parse+serialize**, since round-tripping means compiling Blender geometry back into native `.msh`/`.ans`. The existing nostyleguy plugins are the reference, not a from-scratch effort.
- **Core3 parity requires the DTII editor and the packer** — it's a save-time side-effect (emit Lua alongside the `.iff`), so it layers on after datatable editing + packaging exist.
- **MCP server requires a real, typed N-API surface to wrap** — building it before the core engine exists wraps nothing. Sequence after core engine per `docs/09-ai-mcp/` Status note.
- **Packet sniffer shares the C++ hook layer with injection** — co-locate but treat as optional/niche.

### Conflicts / Ordering Hazards

- **Live injection conflicts with cross-platform goals** — keep the injection module isolated behind a Windows-only boundary so the rest of the editor builds/runs everywhere.
- **AI-proposed formats conflict with "ship fast"** — each format must pass ground-truth validation before its editor ships, which gates editor-feature velocity. Build the validation harness (round-trip + diff against real assets) early.

---

## MVP Definition

### Launch With (v1) — The Minimal Vertical Slice

The foundation everyone agrees on: **TRE mount + IFF parse + 3D mesh viewer.** Plus the minimum to make it a credible read-tool that matches TRE Explorer, so users have a reason to open it at all.

- [ ] **Mount `.tre`/`.toc` archives + load-order resolution** — entry point; nothing works without it
- [ ] **Browse + name/path search across mounted archives** — matches SIE/TRE Explorer baseline; how modders find assets
- [ ] **Generic IFF chunk parser + structured/hex view** — the universal reader; validates the parse pipeline
- [ ] **3D mesh viewer (`.msh`/`.mgn`) with DDS textures + `.sht` shaders** — the "wow" that proves the viewport stack; the second pillar
- [ ] **Skeleton + `.ans` animation preview** — animated assets are core SWG content; demonstrates the appearance pipeline
- [ ] **Extract raw assets + export mesh to glTF/COLLADA** — interop escape hatch; matches TRE Explorer; low cost
- [ ] **DTII datatable grid view (read, then edit)** — most-common mod task; validates the structured-editor pattern
- [ ] **`.stf` string view/edit** — cheap, high-expectation, exercises read+write round-trip
- [ ] **Dark dockable IDE workspace shell** — the container all of the above live in

*Rationale: v1 is "open any SWG asset and see it correctly, in 3D, in a modern app" + the two highest-frequency edit surfaces (datatables, strings). It must already beat TRE Explorer on viewing/extraction or no one switches. Validation harness (round-trip byte-compare against real assets) ships alongside the first serializer.*

### Add After Validation (v1.x) — Earn the Edit/Deploy Loop

Trigger: v1 viewing is trusted and format validation harness is proven.

- [ ] **IFF serialize (write-back) for validated formats** — turns viewer into editor; gate per-format on round-trip validation
- [ ] **`.tre` patch packaging** — closes the "ship a mod" loop; first end-to-end deliverable
- [ ] **Staging workspace + changeset/undo + rollback** — safety net before live/destructive features
- [ ] **Blender bridge (mesh round-trip first, then animation)** — leverages existing nostyleguy plugins; biggest art-workflow win
- [ ] **Core3 parity dual-track save (local only)** — layer onto DTII editor + packer
- [ ] **More format editors** (terrain `.trn`, world `.ws`, flora `.fld`, collision/portals, UI `.ui`, audio/FX) — sequence by demand × validation cost

### Future Consideration (v2+) — The Differentiated Frontier

Defer until the edit/deploy loop is solid and trusted.

- [ ] **Live in-game injection (zero-restart WYSIWYG)** — THE differentiator, but Windows-only, unbounded pointer-discovery effort; needs a stable viewport+gizmo first. Dedicate a phase. Mine Utinni for offsets.
- [ ] **Packet sniffer / live memory auditor** — rides on the injection hook layer
- [ ] **MCP server wrapping the N-API surface** — only valuable once core engine is real
- [ ] **AI in-app assists** (NL datatable edits, mocap→`.ans`, format-RE assistant, semantic asset search) — advisory/reviewable; mocap leans on external tools
- [ ] **Remote Core3 deploy daemon** — requires security review (auth/TLS) before any network exposure
- [ ] **Collaborative multiplayer live editing** — requires server-side broadcast + conflict resolution

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| TRE mount + virtual FS | HIGH | MEDIUM | P1 |
| Browse + search | HIGH | LOW | P1 |
| Generic IFF parse/view | HIGH | MEDIUM | P1 |
| 3D mesh viewer | HIGH | HIGH | P1 |
| Skeleton/animation preview | HIGH | HIGH | P1 |
| DTII datatable grid | HIGH | MEDIUM | P1 |
| STF string editor | MEDIUM | LOW | P1 |
| DDS/audio preview | MEDIUM | LOW | P1 |
| Raw extract + mesh export | MEDIUM | MEDIUM | P1 |
| Dark dockable workspace | MEDIUM | MEDIUM | P1 |
| IFF serialize (write-back) | HIGH | HIGH | P1/P2 (gate on validation) |
| `.tre` packaging | HIGH | MEDIUM | P2 |
| Changeset VCS + rollback | HIGH | MEDIUM | P2 |
| Blender bridge | HIGH | HIGH | P2 |
| Core3 parity (local) | HIGH | HIGH | P2 |
| Terrain / world / flora / collision / UI editors | MEDIUM–HIGH | HIGH | P2/P3 (per demand) |
| Live in-game injection | HIGH (the edge) | VERY HIGH | P3 (dedicated phase) |
| Packet sniffer | LOW–MEDIUM | HIGH | P3 |
| MCP server | MEDIUM | MEDIUM | P3 |
| AI assists (NL/mocap/RE/search) | MEDIUM | MEDIUM–HIGH | P3 |
| Remote deploy daemon | LOW | HIGH (+ security) | P3 |
| Collaborative live editing | LOW (v1) | VERY HIGH | P3 |

**Priority key:** P1 = must have for launch · P2 = add when core is working · P3 = future / differentiated frontier

---

## Competitor Feature Analysis

| Feature | SIE (Sytner) | TRE Explorer | Utinni | SWG Blender plugins | Our Approach |
|---------|--------------|--------------|--------|---------------------|--------------|
| TRE mount/browse | Yes (repository access) | Yes (multi-archive) | Loads game files | — | Virtual FS, open, scriptable |
| 3D preview | Yes | Export to COLLADA | In-client viewport | Renders in Blender | In-canvas Three.js/R3F |
| Content search | Yes | Browse only | Object browser | — | + AI semantic search (P3) |
| IFF/STF/DTII edit | Yes (all-in-one) | View only | — | — | Schema-driven typed editors |
| Mesh export | — | COLLADA | — | msh/mgn round-trip | glTF/COLLADA + Blender bridge |
| Live in-game edit | No | No | **Yes (gizmo + reload)** | No | In-canvas WYSIWYG injection (the edge) |
| Animation authoring | SWB does it | — | — | Blender + plugins | Bridge to Blender + AI mocap |
| Client/server parity | No | No | No | No | **Dual-track DTII→Core3 Lua** |
| Packaging/`.tre` build | Yes (TRE/TOC mgmt) | — | — | — | One-click changeset → `.tre` |
| Versioning/rollback | No | No | Undo/redo | — | Changeset VCS + Git/LFS |
| Scriptable / AI / MCP | No (closed) | No | C#/C++ plugins | Python | **MCP server + AI assists** |
| Open source | No | Yes | Yes | Yes | Yes — plugin-routable, schema-driven |

**Strategic read:** Utinni already owns "live edit in client" and SIE already owns "all-in-one format editor with 3D preview." This project's unique claim is **fusing both** (offline editor + live loop) in one open app, then extending with Core3 parity, changeset VCS, Blender round-trip, and an MCP/AI layer that no existing tool has. v1 must first reach parity on the *boring* baseline (mount/parse/view/extract) or the differentiators have no platform to stand on.

---

## Sources

- PROJECT.md (vision, Core Value, Out-of-Scope, Constraints) — `D:\Code\SWG-Toolkit\.planning\PROJECT.md`
- `docs/04-live-sync/live-memory-and-ipc.md`, `docs/07-blender/blender-integration.md`, `docs/05-server-integration/core3-parity.md`, `docs/09-ai-mcp/ai-and-mcp-integration.md`, `docs/02-formats/*` (AI-distilled design; format/offset details unverified)
- [Utinni README — ptklatt/Utinni](https://github.com/ptklatt/Utinni/blob/master/README.md) (HIGH — live injection, gizmos, object browser, snapshot drop, reload, plugin frameworks) — verified
- [Swg.Explorer / TRE Explorer — wverkley](https://github.com/wverkley/Swg.Explorer) (HIGH — TRE browse, IFF/STF/DDS/audio preview, mesh→COLLADA export) — verified
- [Mod the Galaxy — Tools category](https://modthegalaxy.com/index.php?resources/categories/tools.1/) (HIGH — SIE all-in-one with 3D preview/content search/TRE-TOC; SWB terrain/animation/appearance + region editor; point tools for STF/SKT/APT/FLR/Lua) — verified
- [io_scene_swg_msh — nostyleguy](https://github.com/nostyleguy/io_scene_swg_msh/blob/main/README.md) and [io_scene_swg_mgn](https://github.com/nostyleguy/io_scene_swg_mgn) (HIGH — msh/mgn import/export, UV/weights/blends/skeleton, occlusion) — verified

---
*Feature research for: SWG modding suite (SIE/Utinni/TRE Explorer successor)*
*Researched: 2026-06-21*
