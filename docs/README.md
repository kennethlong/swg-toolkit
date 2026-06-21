# SWG Toolkit — Design & Reference Documentation

A modern, open-source, all-in-one modding suite for **Star Wars Galaxies (SWG)** — a spiritual successor to Sytner's IFF Editor (SIE) and Utinni, rebuilt on a React + TypeScript + Node-API (N-API) + C++ stack with a Three.js viewport, live in-game memory sync, Blender integration, and an MCP/AI layer.

This `docs/` tree is the **AI-readable specification and reference** for planning and building the toolkit. It was distilled and reorganized from a large stream-of-consciousness research session (`SWG assets editor research.txt`) into structured, code-preserving reference documents.

> ⚠️ **Read [`00-overview/source-provenance.md`](00-overview/source-provenance.md) first.** The source material is AI-generated (Gemini). Code samples and especially **binary format/struct layouts are AI-proposed designs**, not verified ground truth. Validate every format detail against the real `swg-client-v2`, `swg-main`, `Core3`, and existing community tools before implementing.

---

## How to navigate

| Section | What's inside |
|---------|---------------|
| **[00-overview/](00-overview/)** | Project vision, target architecture, tech-stack decisions, source provenance |
| **[01-core-engine/](01-core-engine/)** | IFF chunk format, TRE archive read/pack/consolidate, the N-API binary bridge |
| **[02-formats/](02-formats/)** | Per-format parse → serialize → render reference for every SWG asset type |
| **[03-rendering/](03-rendering/)** | Three.js / R3F viewport: shaders, gizmos, brushes, painting, culling, baking |
| **[04-live-sync/](04-live-sync/)** | Live client memory injection, dual-channel IPC, packet analysis (the Utinni core) |
| **[05-server-integration/](05-server-integration/)** | Core3 / SWGEmu Lua parity, server deployment daemon, client↔server sync |
| **[06-workflow/](06-workflow/)** | Version control (Git/LFS), backups/changesets, mod packaging & distribution |
| **[07-blender/](07-blender/)** | Blender ↔ app WebSocket bridge, animation export, AI mocap retargeting |
| **[08-ui-ux/](08-ui-ux/)** | Main workspace layout, docking system, dark-theme styling |
| **[09-ai-mcp/](09-ai-mcp/)** | MCP server wrapper + where AI integration adds value (forward-looking) |

## Document conventions

- Each format/system doc states the SWG file types it covers, a short summary, and a **Source** provenance line (original research-doc line range).
- **Generic IFF binary read/write helpers** live once in [`01-core-engine/iff-and-tre.md`](01-core-engine/iff-and-tre.md). Format docs reference them rather than re-pasting boilerplate, and show only format-specific parsing.
- Code is fenced by language (`cpp`, `typescript`, `tsx`, `python`, `glsl`). Where the source ran statements together on one line (a copy artifact), formatting was restored without changing logic.
- Conversational filler, citation markers (`[1]`), and "Would you like to…" trailers from the research session were removed.

## Reference projects (local, on the maintainer's machine)

These existing codebases are the **ground-truth sources** to verify formats against and to harvest logic from:

| Path | What it is |
|------|------------|
| `../swg-client-v2` | SWG Source client, heavily modified/modernized — canonical client-side parsing logic |
| `../swg-main` | SWG Source server project, running in Docker |
| `../Core3` | SWGEmu open-source cleanroom server, running in WSL2 |
| `../Utinni` | Heavily modified Utinni — live memory injection reference (architecture to improve on) |
| `../UtinniPlugins` | Partner project to Utinni |
| `../io_scene_swg_msh` | Older Blender plugin for SWG meshes |
| `../swg-blender-plugin` | The maintainer's in-progress Blender plugin (functionality to draw from) |
| `D:/SWG Infinity` | Installed Infinity client — TRE file source |
| `D:/SWGEmu Client/SWGEmu` | Installed SWGEmu client — TRE file source |
