# Agent instructions (SWG-Toolkit)

Guidance for AI agents working in this repository. Read by Claude Code (via `CLAUDE.md` →
`@AGENTS.md`), and by Codex / Cursor when consulted in this directory.

This is a **modern, open-source, all-in-one Star Wars Galaxies modding suite** — successor to
Sytner's IFF Editor (SIE) and Utinni. Stack: React 19 + TypeScript + Node-API (N-API) + C++ core,
Three.js / R3F viewport, Electron Forge, live in-game memory injection, Blender bridge, Core3/SWGEmu
parity, MCP + AI layer. Full vision: [.planning/PROJECT.md](.planning/PROJECT.md). Full design:
[docs/README.md](docs/README.md).

## Session startup

Before substantial work, restore context:

1. Read [.planning/PROJECT.md](.planning/PROJECT.md) and, if it exists, [.planning/STATE.md](.planning/STATE.md) — current goals, phase, decisions.
2. Skim [docs/README.md](docs/README.md) to find the reference doc(s) for the subsystem you're touching.
3. If a handoff index exists at `.planning/handoff/README.md`, read the active handoffs (newest/most relevant first). Handoffs live in **`.planning/handoff/`** — one markdown file per workstream, written when context would otherwise be lost.

## ⚠️ The #1 project constraint — verify formats against ground truth

The `docs/` reference library was **distilled from an AI-generated (Gemini) research session.**
High-level architecture is sound, but **every binary format / struct layout / chunk tag in those
docs is plausible-but-unverified and is frequently fabricated.** See
[docs/00-overview/source-provenance.md](docs/00-overview/source-provenance.md).

**Before implementing any parser/serializer:** diff the proposed layout against ground truth —
the real client/server source and **actual asset bytes**. AI consensus is NOT evidence; the real
loader code and a hexdump of a real file are. (This is the project's biggest technical risk and the
direct analog of the "phone a friend" de-anchoring rule in `CLAUDE.md`.)

## Ground-truth reference projects (read access; siblings under `D:\Code\` + drives)

These are authoritative — harvest logic from them and validate formats against them:

| Path | What it is | Use for |
| --- | --- | --- |
| `../swg-client-v2` | Modernized SWG Source **client** (MSBuild) | Canonical client-side IFF/TRE/format parsing logic — the #1 ground truth |
| `../swg-main` | SWG Source **server** (Docker) | Server templates, data tables |
| `../Core3` | SWGEmu cleanroom **server** (WSL2) | Lua templates, client↔server parity (`MMOCoreORB/bin/scripts/managers/templates/`) |
| `../Utinni`, `../UtinniPlugins` | Heavily-modified Utinni | Live memory-injection reference (architecture to improve on) |
| `../swg-blender-plugin` | Maintainer's in-progress Blender plugin | Blender bridge + IFF pipeline (`swg_pipeline/tre_reader.py`, `tre_decrypt.py`) |
| `../io_scene_swg_msh` | Older SWG mesh Blender plugin | Mesh format reference |
| `D:/SWG Infinity`, `D:/SWGEmu Client/SWGEmu` | Installed clients | Real `.tre` asset bytes to validate against |

## Project constraints

- **Verify-against-ground-truth** before trusting any documented format (see above).
- **Binary stays binary:** geometry/textures/audio/terrain cross the N-API bridge as zero-copy
  `ArrayBuffer`/typed arrays, never JSON. Heavy parsing on async C++ worker threads. Reuse objects in
  hot render loops. (Full rules: [docs/00-overview/architecture.md](docs/00-overview/architecture.md).)
- **Live memory injection is Windows-specific** (`OpenProcess`/`WriteProcessMemory`) and mutates a
  running process — gate it behind explicit confirmation; pointer addresses are per-client-build.
- **GSD planning:** milestone state, phases, requirements live under `.planning/`. Model profile =
  **quality (Opus)**; research / plan-check / verifier agents are **on**.
- **Commits:** only when the user asks; do **not** push unless asked.

## Repo & branch model

- **origin** = `github.com/kennethlong/swg-toolset.git`. Branch: **`main`**. (Note: the GitHub repo is
  named `swg-toolset`; the local dir is `SWG-Toolkit`.)
- Trunk-based on `main` for now (the maintainer manages git directly). `.planning/` and `docs/` are
  tracked; `CLAUDE.md`, `AGENTS.md`, `.claude/`, and build artifacts are gitignored.
- `git fetch` before pushing.

## Stack, build & run

> **Greenfield — no application code yet.** This section is forward-looking and fills in as the
> toolchain lands. Target stack and decisions: [docs/00-overview/tech-stack.md](docs/00-overview/tech-stack.md).

- **Frontend:** React 19 + TypeScript + Vite + Tailwind/Radix; Three.js + React Three Fiber + drei; Zustand.
- **Backend:** Node.js + Electron Forge shell.
- **Native core:** C++ via `node-addon-api` (N-API) — reuses parsing logic from `../swg-client-v2`.
- **Build/run commands:** _TBD — add the canonical install/build/dev/test commands here once the
  monorepo is scaffolded (likely `npm install` → `npm run dev` for the app, plus a node-gyp/cmake-js
  step for the C++ addon)._

## Documentation map (your grounding library)

`docs/` is the distilled spec. Start at [docs/README.md](docs/README.md). Key entry points:
- Core engine (IFF/TRE/N-API): `docs/01-core-engine/iff-and-tre.md`
- Per-format references: `docs/02-formats/` (meshes, skeletons/animation, terrain, flora, datatables/strings, audio/effects, collision/portals, UI, world snapshots, properties/config/environment)
- Rendering & viewport tools: `docs/03-rendering/`
- Live in-game sync: `docs/04-live-sync/`
- Core3 server parity: `docs/05-server-integration/`
- Workflow (VCS, packaging): `docs/06-workflow/`
- Blender bridge: `docs/07-blender/`
- UI/UX: `docs/08-ui-ux/` · AI/MCP: `docs/09-ai-mcp/`

## Working conventions

- **Match existing code style; minimize diff scope.** Prefer fixing the caller/data over rewriting.
- **Do reversible local changes in the loop** (config edits, local toggles) without waiting for sign-off.
- **Running code / real asset bytes are truth**, not the docs — treat the AI-distilled docs as a
  starting design to verify, and update them when you confirm or correct a format.
- **Gate close-out commits on an exact staged set** — don't `git commit -a` in a dirty tree; stage explicit paths.
- Use `gh` for issues/PRs when requested.
