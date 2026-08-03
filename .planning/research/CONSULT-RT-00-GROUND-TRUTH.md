# CONSULT-RT-00 — Shared ground truth (LOCKED)

Shared preamble for consult tasks RT-01..RT-04. Everything below was read directly from source on
2026-08-02 and is line-cited. **Treat every numbered item as GIVEN. Do not re-derive it, do not
contradict it, and do not spend effort verifying it** — verify the things your own task asks about.

If you believe a locked item is wrong, say so explicitly and separately at the end of your answer,
with the file:line that refutes it. Do not silently work around it.

## Repositories (all readable, absolute paths)

| Path | What |
| --- | --- |
| `D:/Code/SWG-Toolkit` | the consumer — our toolkit + the x86 injected agent (`packages/live-inject/agent/`) |
| `D:/Code/swg-client-v2` | the modernized SWG **client** — the live target and the authoritative engine source |
| `D:/Code/Utinni` | a heavily-modified Utinni — prior-art live-injection reference |

The consumer injects an x86 agent DLL into the running client. The agent calls engine functions
through an **advertised catalog**: the client EXE exports a `GetEngineHookPoints` name→address table
(declared in `swg-client-v2/src/game/client/application/SwgClient/src/shared/engine_hookpoints.inc`,
populated in `.../win32/engine_advertise.cpp`). The agent binds rows **by name** at runtime
(`SWG-Toolkit/packages/live-inject/agent/rva_table.cpp`); a row that is not in the catalog resolves to
a **null slot**.

## LOCKED — world-snapshot load/unload (all in `swg-client-v2/src/engine/client/library/clientGame/src/shared/core/WorldSnapshot.cpp`)

1. `WorldSnapshot::unload()` is at `:433-499`. Its body clears the preload template list, then loops
   every reader node and per node calls `ms_sphereTree.removeObject(node->getSpatialSubdivisionHandle())`,
   `node->setSpatialSubdivisionHandle(0)`, `node->removeFromWorld()`, and deletes the object found via
   `NetworkIdManager::getObjectById(...)` (`:463-480`). It then clears `ms_loadedList`,
   `ms_pendingCreateList`, `ms_pendingDeleteList`, `ms_eventObjectMap`, and `ms_reader`.
2. `WorldSnapshot::load(char const*)` is at `:503-574`. It clears `ms_loadedList`, calls
   `ms_reader.removeFromWorld()`, resets `ms_lastCellProperty = 0` and
   `ms_lastPosition_w.set(0.f, -9999.f, 0.f)`; early-returns if `_stricmp(sceneName, ms_sceneName) == 0`;
   otherwise sets `ms_sceneName`, calls `unload()`, opens `snapshot/<scene>.ws` into `ms_parseIff`,
   calls `ms_reader.beginIncrementalLoad(*ms_parseIff)`, calls `SharedBuildoutAreaManager::load(sceneName)`,
   sets `ms_parsePhase` and `ms_parsePending = true`, and finally calls `finishLoadNow()` **only if**
   `ConfigClientGame::getWorldSnapshotParseBudgetMs() <= 0`.
3. A comment at `:523-527` (tagged CONSULT-60) states: *"cheap prologue only. The node parse, per-area
   buildout tables, and sphere-tree build all run in budgeted loadStep() calls pumped from GroundScene's
   loading update -- the old synchronous body froze the main loop ~3s inside the GroundScene
   constructor, BEFORE the loading screen was even enabled."*
4. `WorldSnapshotNamespace::finishLoadNow()` is at `:796-803` and its body is
   `while (ms_parsePending) WorldSnapshot::loadStep();`.
5. `WorldSnapshot::loadStep()` is at `:807`. `ms_parsePending` is set false at `:903`.
6. `WorldSnapshot::update(CellProperty const*, Vector const&)` is at `:1026`. Its first statement after
   the profiler block is `if (ms_parsePending) return;` (`:1032-1033`), commented *"no snapshot object
   creation until the phased parse is done (the sphere tree is only populated in the final parse
   phase)"*. Its second early-out (`:1035`) returns when the pending lists are empty, the cell is
   unchanged, and `ms_lastPosition_w.magnitudeBetweenSquared(position_w) < ms_updateDistanceSquared`.
7. Many entry points in this file are guarded with `if (ms_parsePending) finishLoadNow();` — including
   at `:1337, 1356, 1399, 1417, 1447, 1477, 1528, 1549, 1757, 1782, 1798, 2102, 2266, 2350, 2478, 2605, 2749`.
8. `extern "C" int __cdecl utinni_wsGetNodeCount(void)` is at `:1780-1791`; its first two lines are
   `if (ms_parsePending) finishLoadNow();`.
9. `extern "C" int __cdecl utinni_wsGetGeneration(void)` carries a comment at `:1918` stating it is a
   **PURE counter read by contract: no finishLoadNow** (pollable during a load).
10. `extern "C" void __cdecl utinni_wsUnloadSnapshot(void)` is at `:2710-2719`; its body is
    `WorldSnapshot::unload(); ms_sceneName.clear();`.
11. `WorldSnapshot::update(...)` is called from `GroundScene.cpp` at `:1953`, `:1956`, `:1962`, `:2081`.
    `WorldSnapshot::loadStep()` is called from exactly one place outside this file:
    `GroundScene.cpp:2106`, inside `GroundScene::updateLoading()`, which begins at `:2069` with
    `if (!m_loading) return;` (`:2072-2073`).

## LOCKED — advertised catalog membership

12. `engine_hookpoints.inc:346` — `ENGINE_HOOKPOINT(worldSnapshot, wsGetNodeCount)` **is advertised**.
13. `engine_hookpoints.inc:172` — comment on the object block reads:
    *"(addToWorld/removeFromWorld/**setParentCell** are VIRTUAL -> skipped in .cpp; move_o is INLINE
    Object.h:1216 -> OMITTED; no plain getType/move symbol.)"* — **`object::setParentCell` is NOT in
    the catalog.**
14. `engine_hookpoints.inc:178` — `ENGINE_HOOKPOINT(object, getParentCell)` **is advertised**.
15. `Object.h:167-168` — `CellProperty *getParentCell() const;` (non-virtual) and
    `virtual void setParentCell(CellProperty *cellProperty);` (virtual).
16. The consumer's `rva_table.cpp` currently binds **neither** `worldSnapshot::wsGetNodeCount` nor
    `object::getParentCell` nor `object::setParentCell`.

## LOCKED — Utinni prior art

17. `Utinni/UtinniCore/swg/scene/world_snapshot.cpp:176-192` documents that the offline
    `WorldSnapshotReaderWriter`, its singleton `0x1913E94`, and
    `swg::worldsnapshot::{unload, clearPreloadList, createObject}` are **hardcoded SWGEmu RVAs NOT in
    the advertised catalog** — garbage on the advertised client. A helper
    `offlineSnapshotUnavailable()` returns `isAdvertisedClient()` and gates them off.
18. `world_snapshot.cpp:1082-1099` — Utinni's **advertised-path** reload,
    `WorldSnapshotLive::reloadSnapshot()`, body is `wsUnloadSnapshot(); load(sceneName);` and nothing
    else.
19. `world_snapshot.cpp:570-587` — Utinni's **SWGEmu-path** `WorldSnapshot::unload()` loops every node
    calling `removeNodeFull()` before `swg::worldsnapshot::unload()`. It is gated off on the advertised
    client by item 17.

## LOCKED — observed live behavior (maintainer, in-world, advertised client, 2026-08-02)

20. The consumer's reload is `wsUnloadSnapshot(); wsLoad(scene);` — the same two calls as item 18.
21. After triggering it in-world: most buildings were absent (the cantina was not there); **collision
    was absent** (able to run through where walls should be, up to NPCs known to be behind them);
    snapshot creatures (banthas, dewbacks) were absent; **NPCs were present and unaffected throughout**.
22. After moving around for a while, **everything reappeared simultaneously** — the maintainer's words:
    *"the banthas came back as well when the buildings came back."* One restoration event for the whole
    set, not several.
23. The engine call itself reported success; the agent's ack said the call was made.

## LOCKED — observed live behavior, teleport

24. The consumer teleports by writing the player's world transform only:
    `void* player = getPlayer(); setTransform_o2w(player, t);` with an identity-rotation 12-float
    row-major 3x4.
25. Teleporting to coordinates inside a POB (portalized building) lands the player correctly but the
    interior renders **see-through** from inside. Outdoor teleports are unaffected. **Walking out the
    door repairs it.** A scene load produces the same state, so it is not teleport-specific.
26. Separately and intermittently: after a scene reload, a teleport click sometimes does nothing at all.
    An instrumented run (5 clicks) recorded: **all 5 clicks registered; all 5 writes were issued; the
    read-back of the transform matched the target every time; `getPlayer()` returned null zero times.**
    The player pointer differed before vs. after the reload (`2B1E83A0` → `381F8400`). The failing case
    was **not** captured on that run.
