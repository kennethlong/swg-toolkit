# Phase 0: Toolchain De-risk & App Shell - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the entire cross-process pipeline (`C++ → N-API → backend → preload → renderer`) end-to-end, lock the Electron security posture (context isolation + COOP/COEP cross-origin isolation), stand up the `contracts/` shared-types package, and ship the dark, dockable, persistent app shell. This is **de-risk + scaffold** — no SWG format parsing or feature work yet. Delivers FND-01..FND-05.

</domain>

<decisions>
## Implementation Decisions

### Build toolchain
- **D-01:** Use **Electron Forge + the Vite plugin** for the app shell build (user's explicit choice over the `electron-vite` + `electron-builder` alternative). Note: research flagged the Forge Vite plugin as "experimental" — if it fights the native-addon load or COOP/COEP setup during Phase 0, that's the trigger to reconsider `electron-vite`. This is the app/renderer bundler only and is **separate** from the C++ client's MSBuild toolchain.

### Native addon process placement
- **D-02 (revised 2026-06-22 — DROPPED for the data path):** The original decision placed the native `.node` addon in a dedicated Electron utility process. This was falsified by the Phase 0 cross-write experiment (Plan 00-03): cross-process `SharedArrayBuffer` sharing is impossible in Electron 42 (every MessagePort path throws `An object could not be cloned`). Under **Path B** (adopted), the addon loads **in the renderer process** (`sandbox:false + nodeIntegration:true + contextIsolation:false`). The utility process is **not** on the data path; `utility-worker.ts` was deleted. The utility process may return in a future phase for crash-isolated parsing (out of Phase-0 scope). Rationale and tradeoff documented in [00-REPLAN.md](00-REPLAN.md) DECISION section and [00-03-SUMMARY.md](00-03-SUMMARY.md).

### Monorepo & package manager
- **D-03:** **pnpm workspaces.** Packages: `native-core` (C++ N-API addon), `backend` (Node services / utility-process host), `renderer` (React app), and the keystone `contracts/` shared-types package (IPC message shapes, byte offsets, opcodes). The Blender plugin lives in-repo but **out-of-workspace**; an optional `mcp-server` package is anticipated later.

### Pipeline-proof depth
- **D-04 (revised 2026-06-22 — proof is in-process same-memory round-trip):** Phase 0's wiring proof goes all the way to a real zero-copy `SharedArrayBuffer` round-trip, but the proof architecture changed from the original design. The original D-04 specified a cross-process utility→renderer nonce cross-write, which is impossible (see D-02 above). The **as-built proof** is an **in-process same-memory bidirectional round-trip** (Path B): C++ `writeSab(sab, 0, 0xDEAD)` → renderer reads `Int32Array(sab)[0] === 0xDEAD`; renderer writes a per-run nonce → C++ `readSab(sab, 1)` sees it; Web Worker shares the same C++ SAB. All five assertions passed (captured 2026-06-22). `crossOriginIsolated === true` is maintained via COOP/COEP headers. A trivial "hello" call alone remains insufficient — the bidirectional same-memory proof is the bar. Evidence: [00-03-SUMMARY.md](00-03-SUMMARY.md) Runtime Proof Evidence section.

### Locked upstream (from research — do not re-litigate)
- Stack: Electron 42, React 19.2, TypeScript 6, node-addon-api 8 (cmake-js build + prebuildify), **dockview** (docking), Tailwind v4, Zustand 5. See `docs/00-overview/tech-stack.md` + `.planning/research/STACK.md`.
- Electron process model + COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`). See `docs/00-overview/architecture.md` §"Electron process model (corrected)".
- Security defaults (original intent): `contextIsolation: true`, `nodeIntegration: false`, narrow typed validated preload bridge. **Revised by D-02/D-04 above:** Path B posture is `sandbox:false + nodeIntegration:true + contextIsolation:false`; COOP/COEP and `crossOriginIsolated:true` are preserved.

### Claude's Discretion
- Exact cmake-js vs node-gyp choice for the addon (research leans cmake-js, especially since reusing the swg-client-v2 C++ later wants CMake) — planner/researcher resolves against the real client build.
- Testing framework, CI, linting setup, and the specific dark-theme tokens / dockview panel layout details for the shell.
- Whether the Phase-0 `native-core` addon is a throwaway "wiring proof" stub or the seed of the real addon (lean: seed it minimally, keep it real).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 0 design (this repo)
- `docs/00-overview/architecture.md` — layered stack, the **corrected Electron process model** (addon in main/utility, SharedArrayBuffer via `MessageChannel`, COOP/COEP), C++ module split, pnpm monorepo layout.
- `docs/00-overview/tech-stack.md` — version-pinned stack + open decisions (this phase resolves the Forge-vs-electron-vite one).
- `docs/04-live-sync/live-memory-and-ipc.md` — the dual-channel IPC + SharedArrayBuffer design the round-trip proves (and its ⚠ research-correction callout: handle unification, `PROCESS_VM_*` flags, `ArrayBuffer.Data()` GC lifetime — relevant when the SAB pointer is held in C++).
- `docs/08-ui-ux/workspace-layout.md` — the dockview dark dockable shell to scaffold.
- `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `SUMMARY.md` — authoritative version pins, build-order, and the Electron/N-API/COOP-COEP gotchas.

### Ground-truth reference projects (read access via `.claude/settings.local.json`)
- `swg-client-v2/src/engine/shared/.../sharedFile/TreeFile.cpp` (+ `TreeFile_SearchNode`) — the **canonical C++ TRE archive reader/writer** to harvest in Phase 1; built with MSBuild/v145 (reuse means compiling these specific `.cpp` into the cmake-js addon).
- `swg-client-v2/src/engine/shared/application/{TreeFileBuilder,TreeFileExtractor}` — standalone TRE build/extract apps.
- `swg-client-v2/tools/tre-compare/` — standalone TRE diff tool (Python/uv) with multi-server verify configs (SWGEmu/Infinity/Legends/Stardust/SWGSource) — a ready-made **byte-exact verification asset** for the Phase 1 round-trip gate.
- `Utinni/UtinniCoreDotNet/Formats/{Iff,Tre}` — **working C# IFF/TRE implementations** (a second ground-truth alongside the swg-client-v2 C++).
- `Utinni/Utinni.Cli.Tests/Fixtures/{iff,tre}` and `Utinni/UtinniCoreDotNet.Tests/FormatsTests/{Iff,Tre}` — real format **test fixtures** for the verification harness.
- `Utinni/.planning/phases/` — Utinni's own GSD plans for editors we will build (TRE browser 07, IFF editor 08, datatable editor 09, STF editor 10, **object-template editor 11**, worldsnapshot/particle/clienteffect 15/22, user-definable IFF chunk templates 23) — reference roadmap + validation of `docs/02-formats/object-templates.md`.
- `Utinni/Utinni.Mcp` — existing MCP integration (reference for Phase 8).
- `UtinniPlugins/The Jawa Toolbox`, `UtinniPlugins/SytnersUtinniPlugin`, `Utinni/sdk/UtinniPluginTemplates/DotNetEditorPluginTemplate` — existing editor plugins + plugin SDK pattern.
- `../Core3`, `../swg-main` — server ground truth (Phase 8 parity).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **TRE C++ core (swg-client-v2 `TreeFile.cpp`)** — harvest directly in Phase 1 rather than re-implementing from the AI-proposed docs; it is ground truth.
- **`tre-compare` + Utinni `Fixtures/{iff,tre}`** — seed the Phase 1 format-verification harness from these real fixtures and the existing diff configs.
- **Utinni `UtinniCoreDotNet/Formats`** — cross-check binary layouts (C# impl) against the C++ when a format detail is ambiguous (two independent ground truths beat one).
- **Utinni editor phase plans** — a proven decomposition for the datatable/STF/object-template/worldsnapshot editors (our Phases 5/7).

### Established Patterns
- This repo is **greenfield** — no app code yet. Phase 0 establishes the patterns (pnpm workspace boundaries, the `contracts/` typing discipline, the utility-process/MessageChannel IPC shape) that every later phase inherits.
- Reference projects are sibling dirs; `AGENTS.md` documents the ground-truth-verification discipline this phase's successors must follow.

### Integration Points
- The `contracts/` package is the single source of truth for the native↔backend↔renderer boundary — stand it up first so the SAB round-trip is typed end-to-end.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly prefers the **official Electron Forge flow** over electron-vite, accepting the experimental-plugin risk.
- The user wants **Utinni referenced for existing editors and formats**, not just injection — it is the closest prior art for the whole editor surface and has a C# format library + GSD plans + fixtures + MCP to mine.
- Crash isolation matters enough to pay the utility-process MessagePort hop.

</specifics>

<deferred>
## Deferred Ideas

- **Reuse vs. rewrite of Utinni's C# format code** — Utinni's formats are C#; our core is C++. Whether to port logic, cross-reference for validation only, or wrap is a **Phase 1** decision, not Phase 0.
- **MCP server design informed by `Utinni.Mcp`** — Phase 8.
- **Editor decomposition mirroring Utinni's editor phases** — Phases 5/7 (could refine the roadmap later).
- **cmake-js integration with swg-client-v2's MSBuild TRE sources** — concrete build wiring is a Phase 1 concern; Phase 0 only proves a minimal addon builds + loads.

None of these expand Phase 0 scope — captured so they aren't lost.

</deferred>

---

*Phase: 0-Toolchain De-risk & App Shell*
*Context gathered: 2026-06-21*
