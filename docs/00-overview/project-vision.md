# Project Vision

## What we're building

An **open-source, modern, all-in-one modding toolkit for Star Wars Galaxies** — the definitive tool the SWG preservation and emulator community has lacked. It unifies what is today a scattered collection of aging, closed-source utilities into a single cohesive studio.

It is, in one app:
- a **visual asset editor** (meshes, appearances, terrain, textures, UI, datatables, strings, audio, particles, animations, collision) with a real-time **Three.js 3D viewport** — replacing Sytner's IFF Editor (SIE) and its closed `JodelEngine.dll` renderer;
- a **live in-game editor** that injects into and reads/writes a running `SWGClient.exe` for WYSIWYG, zero-restart iteration — the capability Utinni pioneered, rebuilt on a clean architecture;
- a **Blender bridge** that hands elite 3D mesh/rig/animation work to Blender and round-trips it into native SWG formats — folding in the maintainer's existing `swg-blender-plugin`;
- a **server-parity layer** that keeps client `.iff`/`.tre` data in sync with `Core3`/SWGEmu Lua templates;
- a **mod workflow system** — virtual workspaces, version control (Git/LFS), changeset/rollback, and one-click `.tre` patch packaging & distribution;
- wrapped in an **MCP server** with **AI integration** at the points where it genuinely helps (see [`../09-ai-mcp/`](../09-ai-mcp/)).

## Why it needs to exist

The current SWG modding landscape is fragmented and aging:

- **Sytner's IFF Editor (SIE)** is the legendary cornerstone tool, but it is **closed-source**, Windows-only, WinForms-era, and depends on a private 3D renderer (`JodelEngine.dll`). The community cannot extend or maintain it.
- **Utinni** brought live memory injection but is built on a heavy, legacy architecture (WinForms/C# with fragile hooks) that the maintainer finds limiting — hence a clean rebuild rather than continued extension.
- The **content pipeline is painfully manual**: model in Blender → export OBJ/FBX → run a community converter to `.msh` → copy into a client dir → pack a `.tre` → restart the client to test. Every iteration costs minutes.
- Knowledge of SWG's proprietary formats is **tribal and tool-locked**, not captured in open, reusable code.

This project replaces all of that with one modern, cross-platform-leaning, open, extensible, scriptable, AI-augmented studio.

## Core value

> **One tool that takes a modder from raw idea to deployed, in-game-verified SWG mod without leaving the app — and without restarting the client to see a change.**

If everything else is cut, the thing that must work is: **open SWG assets, edit them with live 3D feedback, and get the result into the game.**

## Foundations the maintainer already has

This is not greenfield-from-nothing. Existing assets to draw from:
- Modernized client source (`swg-client-v2`) and server source (`swg-main`), plus a running `Core3`.
- A heavily modified Utinni (`Utinni` + `UtinniPlugins`) to mine for injection logic.
- An in-progress Blender plugin (`swg-blender-plugin`) with real functionality already built.
- Installed clients (Infinity, SWGEmu) as TRE asset sources.

See [`../README.md`](../README.md#reference-projects-local-on-the-maintainers-machine) for the full reference-project map.

## Guiding principles

1. **Native heavy lifting, web-flexible UI.** All decompression, binary parsing, CRC, and memory I/O happens in C++ behind an N-API bridge; the UI stays in React/TS. Pass binary as zero-copy `ArrayBuffer`/`SharedArrayBuffer`, never as serialized JSON blobs.
2. **Don't reinvent 3D editing.** Where Blender already does a job superbly (mesh editing, weight painting, UVs, animation authoring), bridge to it instead of rebuilding it.
3. **Verify formats against ground truth.** The design docs are AI-distilled — confirm every binary layout against `swg-client-v2`/community tools (see [`source-provenance.md`](source-provenance.md)).
4. **Open and extensible.** Plugin-routable backend, schema-driven UI, MIT-spirited openness — the opposite of the closed tools it replaces.
5. **Live-first iteration.** The in-game memory sync isn't a bonus feature; it's the workflow differentiator. Design for it early.

## Out of scope (initially)

- Being a general game engine or a from-scratch SWG client/server (we *integrate with* the existing ones).
- Reimplementing Blender's 3D editing in-app (we bridge to Blender instead).
- Non-SWG game formats.

*(These are starting boundaries, captured to prevent scope creep; revisit as the roadmap matures.)*
