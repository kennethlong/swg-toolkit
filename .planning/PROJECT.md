# SWG Toolkit

## What This Is

A modern, open-source, all-in-one **modding suite for Star Wars Galaxies (SWG)** — the spiritual successor to Sytner's closed-source IFF Editor (SIE) and to Utinni. It combines, in a single cross-platform-leaning app: a visual editor for SWG's ~40 proprietary asset formats with a real-time **Three.js 3D viewport**; **live in-game editing** by injecting into a running `SWGClient.exe` (WYSIWYG, zero-restart iteration); a **Blender bridge** that hands elite 3D/rig/animation work to Blender and round-trips it into native SWG formats; **Core3/SWGEmu server parity**; a full **mod workflow system** (workspaces, Git/LFS, changeset rollback, one-click `.tre` packaging); all wrapped in an **MCP server** with AI integrated where it adds genuine value.

Built for SWG modders and the emulator/preservation community. Stack: **React 19 + TypeScript + Node-API (N-API) + C++ core**, Three.js / React Three Fiber, Electron Forge.

Full design is captured in [`docs/`](../docs/README.md) — distilled from an ~88k-word research session into 25 structured, code-bearing reference documents.

## Core Value

> **One tool that takes a modder from raw idea to deployed, in-game-verified SWG mod without leaving the app — and without restarting the client to see a change.**

If everything else is cut, this must work: open SWG assets, edit them with live 3D feedback, and get the result into the game.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — greenfield; ship to validate.)

### Active

<!-- Hypotheses we're building toward. Detailed specs live in docs/. -->

- [ ] **Core engine**: mount `.tre` archives as a virtual filesystem; parse/serialize SWG's IFF chunk format; zero-copy binary bridge (C++ → N-API → TS). See `docs/01-core-engine/`.
- [ ] **3D asset viewer**: render meshes, composite appearances, skeletons & animations in a Three.js/R3F viewport. See `docs/02-formats/meshes-and-appearances.md`, `skeletons-and-animation.md`.
- [ ] **Format editors**: terrain (`.trn`), flora (`.fld`), world snapshots (`.ws`), datatables (DTII), strings (`.stf`), audio (`.snd`), particles/effects (`.prt`/`.eft`), collision/portals (`.cdf`/`.pob`/`.floc`), UI (`.ui`), properties/config/environment. See `docs/02-formats/`.
- [ ] **Live in-game sync**: attach to a running client, push transforms/edits to live memory, packet inspection. See `docs/04-live-sync/`.
- [ ] **Blender integration**: WebSocket bridge + Python plugin; export Blender animation to `.ans`; AI mocap retargeting. See `docs/07-blender/`.
- [ ] **Server parity**: keep client `.iff`/`.tre` data in sync with Core3/SWGEmu Lua templates. See `docs/05-server-integration/`.
- [ ] **Mod workflow**: virtual workspaces, Git/LFS versioning, changeset/rollback, one-click `.tre` patch packaging & distribution. See `docs/06-workflow/`.
- [ ] **Studio UX**: dockable IDE-style workspace, dark theme. See `docs/08-ui-ux/`.
- [ ] **MCP + AI layer**: expose the toolkit as an MCP server; AI assists (NL queries, mocap, format reverse-engineering, asset search). See `docs/09-ai-mcp/`.

*All Active requirements are hypotheses until shipped and validated. The roadmap will sequence them — the core engine (TRE mount + IFF + mesh viewer) is the foundation everything else depends on.*

### Out of Scope

<!-- Explicit boundaries with reasoning. -->

- **Being a from-scratch SWG client/server** — we integrate with the existing `swg-client-v2` / `swg-main` / `Core3`, not replace them.
- **Reimplementing Blender's 3D editing in-app** — we bridge to Blender for mesh/UV/weight/animation authoring rather than rebuild it.
- **Non-SWG game formats** — scope is SWG only.
- **Trusting AI-proposed binary layouts as-is** — all format details from the research doc must be verified against ground-truth source before implementation (see `docs/00-overview/source-provenance.md`).

## Context

- **Not greenfield-from-nothing.** The maintainer has a modernized client (`swg-client-v2`) and server (`swg-main`), a running `Core3` (WSL2), a heavily-modified Utinni (`Utinni`/`UtinniPlugins`) to mine for injection logic, an in-progress Blender plugin (`swg-blender-plugin`), and installed clients (Infinity, SWGEmu) as TRE asset sources. Full map in `docs/README.md`.
- **The design docs are AI-distilled (Gemini).** High-level architecture/strategy is sound; **binary format/struct details are plausible-but-unverified** and must be checked against `swg-client-v2`/community tools. This is the project's single biggest technical risk.
- **The killer differentiator** is live, zero-restart in-game editing (memory injection). Design for it early — it's the workflow shift over SIE.
- **Why now / why this:** existing tools are scattered, aging (WinForms-era), and closed-source. The community needs one modern, open, extensible, scriptable, AI-augmented studio.

## Constraints

- **Tech stack**: React 19 + TS + Node-API + C++ core; Three.js/R3F; Electron Forge — chosen for direct native-addon execution and reuse of client C++ parsing logic. (Strong defaults, see `docs/00-overview/tech-stack.md`; revisit in planning.)
- **Platform**: live **memory injection is Windows-specific** (`OpenProcess`/`WriteProcessMemory`); decide per-feature how much of the editor is cross-platform vs. Windows-only.
- **Performance**: binary stays binary (zero-copy buffers, never JSON for geometry/textures/audio/terrain); heavy parsing on async C++ worker threads; reuse objects in hot render loops.
- **Format fidelity**: every binary layout must be validated against ground-truth before shipping a parser/serializer.
- **Openness**: open-source, plugin-routable backend, schema-driven UI — the opposite of the closed tools it replaces.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| React/TS/Node-API/C++ over WinForms/C# (rebuild, not extend Utinni) | Flexible hot-reloadable UI + reuse of native client parsing; clean decoupled architecture | — Pending |
| Electron Forge over Tauri | Built-in Node.js runtime executes the C++ addon directly; Tauri needs a Rust bridge | — Pending |
| Three.js/R3F instead of native DirectX-into-HWND (replace JodelEngine.dll) | In-canvas WebGL rendering, no native window injection | — Pending |
| Bridge to Blender vs. rebuild 3D editing | Don't reinvent mesh/rig/UV/animation tooling | — Pending |
| Treat AI-distilled formats as drafts to verify | Source is Gemini-generated; layouts may be fabricated | — Pending |
| Researcher + synthesizer GSD agents on Opus | Maintainer prioritizes deep research/synthesis quality | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-21 after initialization*
