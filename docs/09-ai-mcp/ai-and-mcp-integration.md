# AI & MCP Integration (Forward-Looking)

> Covers: wrapping the toolkit as an MCP server, and where AI integration genuinely adds value. Source: maintainer's stated project goals + the AI video-to-animation (mocap) material (research doc lines 15320–15393). This is the most forward-looking doc — a design direction, not yet a built spec.

## Why this layer exists

A core goal of the project is to **wrap the toolkit in an MCP server and integrate AI into tools where it makes sense** — not AI for its own sake. The toolkit already exposes a large, well-structured native capability surface (parse/serialize ~40 SWG formats, render in 3D, query datatables, inject into a live client, drive Blender, sync to Core3). That surface is exactly what an AI agent needs to be useful: concrete, typed, verifiable operations. MCP is the bridge that lets a model *drive* the toolkit, and selective in-app AI features accelerate the modding work itself.

> Use the latest Claude models for the AI features (e.g. Opus 4.x for deep reasoning tasks, Sonnet/Haiku tiers for cheaper high-volume ones). See the Claude API/model reference when implementing.

## Part 1 — The toolkit as an MCP server

Expose the toolkit's capabilities as **MCP tools and resources** so an AI agent (Claude in Claude Code, Claude Desktop, or a custom agent) can read, edit, and build SWG mods conversationally.

### Resources (read-only context the model can pull)
- **Mounted TRE virtual filesystem** — browse/read any asset path inside mounted `.tre` archives (see [iff-and-tre](../01-core-engine/iff-and-tre.md)).
- **Parsed asset views** — an IFF/DTII/`.stf`/`.trn`/etc. file rendered as structured JSON the model can reason over.
- **Workspace state** — current project, staged changes, changeset stack, diff vs. base.
- **Datatable rows / string-table entries** — queryable structured data.

### Tools (actions the model can invoke)
Mirror the N-API surface, grouped by subsystem:
- `tre.mount`, `tre.list`, `tre.read`, `tre.pack` — archive ops.
- `iff.parse`, `iff.serialize` — generic chunk read/write.
- `datatable.query`, `datatable.editRow` — DTII access (see [datatables](../02-formats/datatables-and-strings.md)).
- `stf.get`, `stf.set` — localization strings.
- `mesh.load`, `appearance.compose` — asset loading for inspection/render.
- `terrain.evaluate`, `terrain.editLayer` — procedural terrain (see [terrain](../02-formats/terrain.md)).
- `world.placeObject`, `world.export` — world snapshot editing (see [world snapshots](../02-formats/world-snapshots.md)).
- `live.attach`, `live.patchTransform`, `live.readMemory` — live client sync (see [live sync](../04-live-sync/live-memory-and-ipc.md)). **Gate these behind explicit user confirmation** — they mutate a running process.
- `parity.sync` — push client+server changes to Core3 (see [Core3 parity](../05-server-integration/core3-parity.md)).
- `blender.send`, `blender.exportAnimation` — drive the Blender bridge (see [blender](../07-blender/blender-integration.md)).
- `vcs.commit`, `snapshot.create`, `snapshot.restore` — history/safety ops.

### Design notes
- **Typed schemas, validated at the tool boundary** — same discipline as the N-API bridge; the model retries on schema mismatch.
- **Read-heavy by default, write behind confirmation.** Parsing/inspecting is safe to automate; packing, live-memory patches, and server syncs should surface a confirmation or run in a dry-run/preview mode first.
- **Provenance-aware.** Because many binary layouts are AI-proposed ([source provenance](../00-overview/source-provenance.md)), tool results should flag unverified formats so the agent doesn't present guesses as facts.
- **Embeddable both ways.** The toolkit can *host* an MCP server (agents drive it) and can also *consume* MCP/AI services for the in-app features below.

## Part 2 — Where AI adds value inside the app

Concrete, high-leverage features where AI is worth integrating:

### Already sketched in the research
- **AI video-to-animation (markerless mocap) → `.ans`.** Use AI pose-estimation (cloud suites or local Blender computer-vision add-ons) to turn an MP4/MOV of a movement into bone keyframes, then **auto-retarget** the generic AI skeleton onto SWG's rig naming scheme (e.g. `spine_01` → `spine1`) and compile to `.ans`. Full pipeline in [blender integration](../07-blender/blender-integration.md#ai-mocap). An AI retargeting-template generator (map arbitrary mocap rigs → SWG skeletons) is a natural assist.

### High-value additions to design toward
- **Natural-language datatable & asset queries.** "Find every two-handed melee weapon with attack speed > 4.0 and bump its min damage 10%" → the agent composes `datatable.query` + `editRow` calls and shows a preview diff.
- **Format reverse-engineering assistant.** Point the agent at an unknown chunk + the real `swg-client-v2` loader source and have it propose/verify a struct layout — directly attacking the project's biggest risk (unverified formats).
- **Asset search & auto-tagging.** Embed/describe meshes, textures, and strings so modders can search "rusty Tatooine moisture vaporator" instead of hunting CRC paths.
- **Procedural content assist.** Generate terrain fractal parameter sets, flora distributions, or spawn tables from a natural-language description, then let the modder fine-tune the resulting `.trn`/`.fld`/`.spw`.
- **Balance & parity guidance.** Given client DTII stats and Core3 Lua, flag drift, suggest balanced values, and explain the rubber-banding risk (ties into [Core3 parity](../05-server-integration/core3-parity.md)).
- **Mod authoring copilot.** Scaffold a mod (changeset + manifest + packaging) from a goal statement; explain SWG formats on demand using these docs as grounding.
- **Localization assist.** Draft/translate `.stf` entries across languages with human review.

### Guardrails
- Keep AI **advisory and reviewable** for anything that writes game data — diff/preview before commit.
- Never let the agent silently patch a **live client** or **server** — those tools require explicit, per-action human approval.
- Treat AI-proposed **format/struct details** as drafts to verify, consistent with the rest of the project.

## Status

This doc is a **direction, not a contract.** The MCP tool list and feature set above should be sequenced in the roadmap after the core engine (TRE mount + IFF parse + mesh viewer) is real enough to wrap.
