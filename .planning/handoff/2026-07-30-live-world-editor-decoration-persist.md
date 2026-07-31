# Live World Editor — model-D interior-decoration persistence (built + proven live; 1 provider blocker)

**Date:** 2026-07-30 · **Workstream:** Live World Editor, decoration-persist round trip. **Branch:** `main`,
all pushed, HEAD `826b8ed`. Supersedes `2026-07-19-phase05-closed-pivot-to-live-world-editor.md`.

## TL;DR

The **entire model-D interior-decoration persistence pipeline is BUILT, WIRED, and PROVEN LIVE end-to-end**,
blocked on **ONE** thing: resolving the containing **building's `.ws` node id** in-game. Request filed +
consumer **pre-wired** — it lights up on the next provider exe restage with **no toolkit rebuild**.

Model D = edit an in-cell `.ilf` decoration live, persist it as pure data: write an edited `.ilf` + a derived
building template (copy of the stock building `.iff` with only `interiorLayoutFileName` re-pointed) into the
client's loose override dir, then `wsSetNodeTemplateName(buildingId, derivedTemplate)` + `wsSaveSnapshot` so
that ONE building instance loads the edited interior. See [[reference-model-d-building-id-resolution]].

## The blocker (the only thing left)

`wsSetNodeTemplateName` + the derived template need the **POB building's** NetworkId + template. In-game we
can't get it: `collideScreenRay` returns **0** for an id-less `.ilf` decoration (by design) and the **CELL**
id for a wall/floor click (`object/cell/shared_cell.iff` — **no `interiorLayoutFileName`** → derive
fail-closes with `-3 ABORT`). `object::getParent` isn't advertised → can't walk cell→building consumer-side.

**Fix = one provider shim `object::getContainingBuildingId(object)`** (chain
`getParentCell→getPortalProperty→getOwner→getNetworkId`, all inline → copy-out mandatory).
- Request filed: `swg-client-v2/.planning/handoff/2026-07-30-toolkit-getContainingBuildingId-REQUEST.md` (uncommitted in their repo — **maintainer relays it**).
- Toolkit mirror: `.planning/handoff/2026-07-30-CHANGE-REQUEST-getContainingBuildingId.md`.
- **Consumer PRE-WIRED** (`826b8ed`): `rva_table.cpp` binds `{"object::getContainingBuildingId", …}` (null until shipped); `overlay.cpp` `armDecorationEdit` prefers it, falls back to the click pick. Also drops the wall-click step (hover decoration → Arm).

## Resume steps (when the provider ships the shim + restages the exe)

1. **No toolkit rebuild needed** — the row binds by name. Just re-launch the toolkit + **re-attach** the client
   (advertised gl11, `rasterMajor=11`). The agent DLL is current (rebuilt this session).
2. In the decoration probe the hint should read "hover the decoration → Arm → move → Persist" (means the shim resolved).
3. Enter a decorated POB (cantina), **Allow target anything ON**, **mount the client's TRE set in the toolkit**
   first (`D:/Code/SWGSource Client v3.0/swgsource_3.0.tre` + `disable_wayfar_dearic_snow.tre` — the set the
   running client uses, so `object/building/…` resolves in `readVfs`).
4. Hover the table → **Arm** (gizmo locks to the table) → **move** → **Persist**.
5. Watch the "last rebind" line → **code 0** = success. Then **Reload current scene** (button in overlay) or
   re-enter the building → **the table should hold its moved position** (loads from the edited `.ilf`). That's the win.
6. If it aborts, read the trace: **`%TEMP%\swg-toolkit-decoration-debug.log`** (override dir, building path, OK/ABORT+reason).

## What's DONE + proven live this session (commit chain)

- `4748a85` toolkit-side assembly `assembleDecorationEdit` (+ `ilf.ts`/`buildingTemplate.ts`/`decorationPersist.ts`, ~34 tests)
- `5612650` bind `object::getTransformO2P` (v24) + live o2p probe readout — **o2p confirmed live**
- `c513a42` channel contract (`LIVE_DECORATION_LAYOUT`, IPC msgs) · `26b59c8` C++ channel mirror (mapping 400→**1308**, static-asserted both ends)
- `3156bd5` agent capture + rebind-apply (overlay) · `3f5b732` host `writeRebind` N-API
- `736051b` renderer CAPTURE/RESULT decode (`decorationChannel.ts`, 7 tests) · `f7a59a7` renderer orchestrator (`decorationPersistOrchestrator.ts`) — round trip wired
- `c75ec1d` building-id from click-selection · `308f129` follow-hover latch-steal fix · `d4275d4` **override-dir via `detectClients()`** (fixed the decoupled swg-client-v2 stage client) + on-disk trace
- `826b8ed` cell→building blocker: request filed + pre-wired

**Verified live:** injection + overlay + gizmo; o2p read; the FULL channel round trip (capture → orchestrator
assembles files + `writeRebind` → agent rebind → RESULT → renderer log); override-dir resolution to
`D:/Code/swg-client-v2/stage/override`. **Only** the building-id source is unproven (the blocker above).

## Build / rebuild

- **Agent DLL (x86):** `cmake --build packages/live-inject/agent/build-agent --config Release` (needs `node` on PATH: `$env:PATH="C:\Program Files\nodejs;$env:PATH"`). Dev injector loads `agent/build-agent/Release/swg_toolkit_agent.dll` (`useLiveService.ts:153`).
- **Host addon (x64):** `npm -w @swg/live-inject run build` → `build/Release/swg_live_inject.node` (no `prebuilds/` shadow).
- **Contracts:** `npm -w @swg/contracts run build` — **REQUIRED** after editing `contracts/src`; the renderer imports `dist/index.js` (gitignored, so rebuild locally or the app misses new symbols).
- **Renderer changes** need an app reload/restart, not a client re-attach.

## Cleanup owed (non-blocking)

- The orchestrator's on-disk debug trace (`decorationPersistOrchestrator.ts` `dbg()` → `%TEMP%\swg-toolkit-decoration-debug.log`) is temporary diagnostics — keep while smoking, remove/gate once model-D is signed off.
- Live probes still to run once the shim lands: **P1** same-session double-edit accumulation (readVfs reads the override dir first, so it *should* accumulate); **P2** the target building is a client `.ws` node not server-streamed (a bad id → `NODE_NOT_FOUND`).

## Provider/consumer separation (unchanged)

swg-client-v2 is a SEPARATE session — never edit it; emit change-requests to its inbox, **maintainer relays**.
Utinni read-only reference. Commits only when asked (this session: asked). See [[reference-cross-repo-change-request-handoffs]].
