# Phase 1: Core Engine — IFF + TRE + Verification Harness - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the **dependency root** of the whole toolkit:

- **IFF** — parse an arbitrary FORM/chunk file into a navigable tree and serialize an edited structure back **byte-exact** (full read+write).
- **TRE** — mount one or more `.tre` archives as a virtual filesystem with correct load-order/override (shadow) resolution; browse + search by path/name; extract; **and** repack/write archives (full read+write — see D-04).
- **Verification harness** — a reusable byte-exact round-trip gate, seeded from real fixtures, wired in as a standing requirement every later format phase inherits.
- All heavy work (multi-GB archive mount/decompress, large IFF parse) runs on **async worker threads** so the renderer UI never blocks.

Delivers CORE-01..CORE-06. This is the read-the-world + edit-IFF foundation; the 3D mesh viewport is Phase 2, typed format editors are Phases 5/7.

</domain>

<decisions>
## Implementation Decisions

### Native C++ reuse strategy
- **D-01:** **Port to clean, modern C++** — re-author the IFF/TRE logic as fresh, dependency-light C++ using `swg-client-v2` as the line-by-line spec. Do **not** compile `swg-client-v2`'s `TreeFile.cpp`/`Iff` `.cpp` as-is (it drags in a sizable SOE engine subset — `sharedFoundation` ConfigFile/ExitChain/Os/Production, `sharedSynchronization/Mutex`, `sharedDebug`, `FileStreamer`, `FileManifest`). Do **not** write docs-first (docs are AI-distilled and frequently fabricated — see source-provenance).
- **D-02:** Structure the port as a **standalone, engine-free C++ static library** — no globals, injectable IO/streams, RAII, C++20-ish. The N-API addon is a **thin binding layer** over it. The verification harness links the lib **headless**; the lib is reusable later by the MCP server / CLI tools.
- **D-03:** **Two ground truths.** Primary spec = `swg-client-v2` `TreeFile.cpp` (+ `TreeFile_SearchNode`) and the IFF loader; cross-check binary layouts against **Utinni's C# `Formats/{Iff,Tre}`** when a detail is ambiguous (two independent ground truths beat one). Every parser/serializer must cite its `swg-client-v2` loader source (standing gate).

### TRE/IFF read+write scope
- **D-04:** **Full read + write for BOTH TRE and IFF in Phase 1.** IFF byte-exact serialize is already CORE-04; the user chose to also build the **TRE builder/repacker** now so the full archive round-trip (read → write → byte-identical `.tre`) is proven immediately. **⚠ Roadmap overlap:** this pulls the `.tre` patch-packaging work forward from **DEPLOY-01 (Phase 4)** — flag for the planner to dedupe Phase 4 scope later. This deepens the CORE round-trip capability (not a new capability), so it stays in Phase 1 scope.
- **D-05:** **Support ALL TRE format variants** (e.g. v0005/v0006 and all compressors), not just one client's flavor.

### Phase 1 UI surface
- **D-06:** Ship a **functional, read-focused UI** wired into the Phase-0 dockview shell: a **TRE virtual-filesystem browser** (mount archives, see override/shadow order, search by path/name) + a **generic IFF FORM/chunk tree viewer**. No 3D (that's Phase 2).
- **D-07:** For IFF **leaf chunks** with no typed editor yet (every non-IFF/TRE format comes later), show the **structure tree** (tag / size / byte-offset) plus a **raw hex/ASCII inspector pane** (offset │ hex │ ascii) for the selected chunk. This is the SIE-successor baseline and the surface typed editors plug into later. **No** per-format typed decode in Phase 1.
- **D-08:** **No in-UI IFF editing** in Phase 1 — the byte-exact write path is proven via the harness/tests, not through the UI. (UI editing of IFF values is a later phase.)

### Verification harness design
- **D-09:** **Layered fixtures.** (a) Commit **tiny synthesized/handcrafted fixtures** — seed from Utinni's `Fixtures/{iff,tre}` (v0005/v0006, malformed cases) — for fast CI + edge coverage. (b) A **gitignored local-real fixtures** set sourced from real client assets for the "real asset byte-exact" gate. CI on a clean clone never needs retail bytes; real-asset proof runs locally / opt-in lane.
- **D-10:** **Asset safety:** copy reference `.tre` from the installed clients into a **gitignored working/scratch directory**; tests read/write/round-trip on **copies only** — never the reference client files (no clobbering the reference installs).
- **D-11:** Seed the harness from Utinni fixtures **and** `swg-client-v2`'s `tre-compare` verify configs (it already has SWGEmu/Infinity/Stardust/etc. configs — a ready-made byte-exact asset).

### Target client & format scope
- **D-12:** **Multi-client gate from the start** — gate the mount + real-asset round-trip + override-resolution matrix against **SWG Infinity AND SWGEmu equally**. (Combines with D-05: all TRE variants parse; these two installs drive the local-real fixtures and the shadow/override test.)

### Claude's Discretion
- **Harness enforcement mechanism** (D-09 area): user said "you decide." Requirement is only that it be **reusable + coverage-enforced + cites the loader source per fixture** — e.g. a reusable `assertRoundTrip(parse, serialize, fixture)` + fixture registry whose sweep test fails CI if a registered format lacks a round-trip case, or a custom Vitest matcher with a separate coverage check. Planner picks the exact shape.
- **Async worker model for CORE-06** (C++ N-API `AsyncWorker`/libuv threadpool vs Node `worker_threads` vs Web Worker) — not discussed; planner/researcher resolves against the Path-B renderer + zero-copy SAB contract.
- **TRE search semantics** (CORE-02: substring / glob / regex) and **IFF endianness handling** — resolve from `swg-client-v2` ground truth.
- **C++20 specifics, lib/binding file layout, and cmake-js wiring** for the standalone lib.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Ground-truth source — the #1 oracle (read access via `.claude/settings.local.json`)
- `../swg-client-v2/src/engine/shared/library/sharedFile/src/shared/TreeFile.cpp` (971 lines) + `TreeFile_SearchNode.*` — **canonical C++ TRE archive reader/writer** to port (D-01). Note its engine-foundation includes (`sharedFoundation`, `sharedSynchronization/Mutex`, `sharedDebug`, `FileStreamer`, `FileManifest`) — these are what we are NOT vendoring.
- `../swg-client-v2/src/engine/shared/application/{TreeFileBuilder,TreeFileExtractor}` — standalone TRE build/extract apps; reference for the writer/repacker (D-04).
- `../swg-client-v2/.../sharedFile/` IFF loader sources — the IFF FORM/chunk parse/serialize spec (CORE-03/04).
- `../swg-client-v2/tools/tre-compare/` — standalone TRE diff tool (Python/uv) with multi-server verify configs (`verify-swgemu.cfg`, Infinity, Stardust, SWGSource) — **ready-made byte-exact verification asset** + fixture seed (D-11).
- `../Utinni/UtinniCoreDotNet/Formats/{Iff,Tre}` — **working C# IFF/TRE impls** — second ground truth for cross-checking ambiguous layouts (D-03).
- `../Utinni/Utinni.Cli.Tests/Fixtures/{iff,tre}` and `../Utinni/UtinniCoreDotNet.Tests/FormatsTests/{Iff,Tre}` — real format **test fixtures** (synthesized v0005/v0006 + malformed cases) to seed the committed-fixture layer (D-09).

### Real asset sources (for the gitignored local-real gate — copy, don't mutate, D-10/D-12)
- `D:\SWG Infinity\…` — installed SWG Infinity client `.tre` (primary equal target).
- `D:\SWGEmu Client\SWGEmu\…` — installed SWGEmu client `.tre` (primary equal target).

### Project design docs (this repo — starting design, verify against source above)
- `docs/01-core-engine/iff-and-tre.md` — IFF/TRE/N-API design (AI-distilled; verify every layout against `swg-client-v2`).
- `docs/00-overview/source-provenance.md` — why the docs' binary layouts are unverified hypotheses (the project's #1 constraint).
- `docs/00-overview/architecture.md` — zero-copy binary bridge rules, async worker discipline, monorepo layout (CORE-06).
- `docs/08-ui-ux/workspace-layout.md` — the dockview shell the TRE browser + IFF tree wire into (D-06).
- `.planning/REQUIREMENTS.md` — CORE-01..06 + the **standing round-trip gate** statement.
- `.planning/phases/00-toolchain-de-risk-app-shell/00-CONTEXT.md` — Phase 0 decisions this phase inherits (Path B native-in-renderer, SAB zero-copy, pnpm workspace, `contracts/` typing).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/native-core/`** — Phase-0 cmake-js N-API addon (`addon.cpp`, `hello.cpp`, `sab.cpp`, `sab-rw.cpp`); the standalone IFF/TRE lib (D-02) and its thin binding land here.
- **`packages/contracts/`** (`ipc.ts`, `opcodes.ts`, `sab-layout.ts`) — single source of truth for the native↔backend↔renderer boundary; extend with IFF-tree / TRE-vfs / mount-config message + byte-offset types so the parse results cross typed end-to-end.
- **`packages/renderer/`** + the dockview shell — host the TRE browser sidebar + IFF tree/hex data pane (D-06/07).
- **swg-client-v2 `TreeFile.cpp` / `tre-compare` / Utinni `Formats` + fixtures** — port source, verification oracle, and fixture seeds (see canonical refs).

### Established Patterns
- **Path B (Phase 0):** native addon runs **in the renderer** (`sandbox:false + nodeIntegration:true + contextIsolation:false`); zero-copy via `SharedArrayBuffer`; `crossOriginIsolated === true` preserved. Binary stays binary across the bridge — never JSON for archive/chunk payloads.
- **pnpm workspace** boundaries + `contracts/` typing discipline established in Phase 0; Phase 1 follows them.
- **Standing gate discipline** (REQUIREMENTS.md): no parser/serializer merges without a byte-exact round-trip on a real asset + a cited `swg-client-v2` loader source.

### Integration Points
- Native lib → thin N-API binding → `backend` services → `contracts` types → renderer (TRE browser + IFF tree). Mount/parse run off the main thread (CORE-06).
- The harness links the standalone C++ lib headless (bare-Node vitest) — the ABI-stable prebuild from Phase 0 serves both bare Node and Electron.

</code_context>

<specifics>
## Specific Ideas

- Build a **successor to Sytner's IFF Editor (SIE)**: the structure-tree + hex/ASCII inspector (D-07) is the explicit SIE-baseline surface.
- "**Make sure we support all the TRE formats**" — explicit user instruction (D-05).
- "**Copy these to a working directory, run tests, write to them — without worrying about clobbering the reference system's `.tre` files**" — explicit user instruction driving the asset-safety rule (D-10).
- Prove the **full archive round-trip now** (read→write→byte-identical), not just IFF (D-04).

</specifics>

<deferred>
## Deferred Ideas

- **`.tre` patch-packaging / `.cfg` activation as a user workflow** — the *builder* primitive lands in Phase 1 (D-04), but the deploy loop (patch archive activation, BOM-free `.cfg` search-order write, changeset rollback, Git/LFS) remains **Phase 4 (DEPLOY-01..04)**. Planner should dedupe the now-overlapping TRE-write scope.
- **In-UI IFF chunk editing with save-back** — deferred past Phase 1 (D-08); Phase 1 proves the write path via tests only.
- **Per-format typed decoders** (datatables/STF/mesh/terrain/etc.) — Phases 2/5/7; Phase 1's IFF viewer is format-agnostic (D-07).
- **MCP server / CLI reuse of the standalone parsing lib** — enabled by D-02's engine-free design; actual MCP work is Phase 8.

</deferred>

---

*Phase: 1-Core Engine — IFF + TRE + Verification Harness*
*Context gathered: 2026-06-22*
