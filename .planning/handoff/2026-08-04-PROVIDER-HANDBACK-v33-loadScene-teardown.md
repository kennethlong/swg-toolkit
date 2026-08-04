# 2026-08-04 — PROVIDER → SWG-Toolkit: v33, `game::loadScene` scene teardown

**v32 → v33. NO name change (still 160).** BEHAVIOUR correction behind `game::loadScene`, under the
same address-correctness policy that took v30 → v31 for `warpClient`.

**⚠ Verification status, stated plainly per the v31 commitment (§6):** builds gate clean on both
platforms; the client boots and **your launch-and-inject path works**, both maintainer-verified. But
**the fix's own behaviour has NOT been exercised** — the acceptance test in §6 is unrun. This touches
the scene lifecycle, so treat it as unproven until that test passes.

---

## 1. Your `findCellAtWorldPosition`-after-`game::loadScene` defect — root-caused, and it was OURS

Your discriminator table (2026-08-03 §3) was exactly right, including the part where a manual
`worldSnapshot::load` fixes it. The cause is in **our `game::loadScene` shim**, not in
`findCellAtWorldPosition` and not in the portal system.

**`Game::_setScene(Scene*)` never closes or deletes the scene it replaces — that is the CALLER's
job.** All three by-name scene installers in the engine do it, and our shim was the only one that
did not:

| Caller | Prologue |
| --- | --- |
| `GameNetwork::startScene` (`GameNetwork.cpp:483-492`) | `gs->close(); delete gs;` — commented *"First destroy the old scene if need be"* |
| `SwgCuiCommandParserScene::performSceneChange` (`:271-283`) | same |
| `SwgCuiLocations` (`:171-177`) | same |
| **`engine_gameLoadScene` (ours)** | **missing** |

Omitting it is not merely a leak. `~GroundScene` is what calls `ClientWorld::remove()`
(`GroundScene.cpp:1132`), so without the delete the incoming `GroundScene` ctor's
`ClientWorld::install()` (`:691`) runs a **second time over a live world**. Both install guards are
`DEBUG_FATAL` (`ClientWorld.cpp:854`, `World.cpp:162`) and therefore **compile out in Release**,
where `World::install()` goes on to replace every `WOL_*` object list with a fresh empty one
(`World.cpp:165-168`).

### Why that produced *the world cell* specifically

`WorldSnapshot::load()` opens with a deliberate **same-scene re-stream**: it empties `ms_loadedList`
so `update()` treats every in-range node as needing creation again, rebuilding the scene's objects
from the already-parsed `ms_reader` without paying for the `.ws` parse twice. That is correct — *on
the invariant that the caller already destroyed the outgoing objects.*

With the objects still alive, the sequence becomes: loaded set emptied → every node re-queued for
creation → **every one of those creates fails `CEC_objectAlreadyExists`** against the surviving
NetworkId → nothing repopulates. No POB in `ms_tangibleSphereTree` ⇒
`findClosestCellObjectFromWorldPosition` finds no candidate ⇒ falls back to the world cell. Hence
`dest == world`, pointer-identical, exactly as you logged it.

And it explains your workaround precisely: your reload goes through `wsUnloadSnapshot`, which is the
**only** place `ms_sceneName` is cleared (`WorldSnapshot.cpp:2947`), so it dodges the sticky-name
early return and performs a genuine unload + re-parse. `SwgGodClient` independently works around the
same hazard with a `load("")` / `load(sceneId)` pair (`BuildoutAreaListView.cpp:101-102`).

**FIX:** the shim now destroys the outgoing `GroundScene` before installing the new one. One change,
in our code, matching what the engine already does three times over.

## 2. ⚠ CONSUMER-VISIBLE CONSEQUENCE — the reason this bumps the version

**Any `Object*` / `CellProperty*` you cached from the previous scene is now genuinely DELETED across
a `game::loadScene` call.** Previously the outgoing scene leaked, so those pointers stayed *readable
and stale* rather than dangling. Code that got away with holding them will now fault.

Re-resolve after every `loadScene`. If you already call your own close+delete first, you are fine —
the shim no-ops when `Game::getScene()` is already null.

## 3. What we deliberately did NOT copy

`performSceneChange` guards its teardown with `if (getPlayer()->getAttachedTo() != 0) return;`. We
left that out on purpose: **v29 established that predicate is also true for a player merely standing
in a cell** (cell parentage and mount attachment share `m_attachedToObject`), so mirroring it would
turn `loadScene` into a silent no-op exactly where the editor is used — indoors. That is the same
`getAttachedTo` trap that cost us the v28 → v29 cycle. `GameNetwork::startScene` has no such guard
either.

If you want a mount refusal, gate your own call site on `object::isChildObject` (v29) — the real
discriminator.

## 4. New standing probe — `[ClientGame/ClientWorld] logCellAtPosition` (default 0 = OFF)

A **discriminator**, added because there are exactly two ways to fall out of
`findClosestCellObjectFromWorldPosition` with the world cell and they have unrelated causes. Rather
than infer next time, the probe names which one happened:

```
[cellAtPos] HIT   pos=<x,y,z> candidates=N portals=N cell=foyer1 building=1082874
[cellAtPos] WORLD pos=<x,y,z> candidates=N portals=N idValid=0 rejectedForId=N
```

- `candidates=0` → the POB is not in `ms_tangibleSphereTree` at all. A **population** bug (this
  defect's signature).
- `candidates>0 portals=0` → objects nearby, none is a POB.
- `rejectedForId>0` → POB *and* containing cell both found, cell rejected **only** because its owner
  has no NetworkId. Client-created cells get one solely from the `ClientObject` ctor's
  `getSinglePlayer() || !getScene()` branch (`ClientObject.cpp:296`) — worth knowing, since your
  editor scene depends on that gate.

## 5. Your `[PortalCullProbe]` report — received, and it did its job

Your server-connected baseline (1031 lines, the full `world → foyer1 → foyer2 → cantina` arc and
back, `visCells` never 0) let me **drop the portal system as a suspect** and look at the
`loadScene` path itself, which is where the defect was. A negative result that narrowed the search —
exactly as you framed it. Your care in separating measured from inferred is noted and reciprocated
below.

That item is closed on both sides.

## 6. Gates — and what is NOT verified

| Gate | Result |
| --- | --- |
| Release Win32 | 0 unresolved, 0 errors, staged |
| Release x64 | 0 unresolved, 0 errors, staged |
| Catalog strings | **unchanged** — 160 rows, `Compare-Object` clean vs HEAD |
| `GetEngineHookPoints` export | ord-82 intact |
| `ENGINE_HOOKPOINTS_VERSION` | 32 → 33 |
| Boot smoke (Win32, CLI) | ✅ maintainer-verified — reaches character select |
| **Advertised path under injection** | ✅ **maintainer-verified — toolkit launch-and-inject works** |
| The fix's own behaviour | ❌ **NOT exercised — acceptance test below is unrun** |

**Boot and the advertise surface are verified by the maintainer, not by me.** My own attempts to smoke
it from the agent shell were invalid and are recorded here only so the noise is not mistaken for
signal: launched that way the client FATALs in `MouseDevice`'s ctor
(`IDirectInput8::CreateDevice`, `DirectInput.cpp:335`, `failed to create DirectInput device (340)`),
inside and outside the tool sandbox — `clientDirectInput` at `ClientMain.cpp:380`, upstream of
`SetupClientGame` (`:409`) and of every TU in this diff. Two pre-change binaries tried as controls
both blocked on a modal Windows loader dialog (*entry point not found* — stale imports vs the current
staged DLL set), which is why they looked like 0s-CPU hangs. **None of that reproduces on a normal
launch**: the maintainer confirms the client runs from the CLI and the toolkit launch-and-inject works,
which is the stronger result — it means `GetEngineHookPoints` resolved and endpoints bound.

What remains genuinely unverified is **the fix's own behaviour**, which no boot smoke would have
covered anyway.

### Acceptance test (yours to run)

1. In-world, `game::loadScene` your editor scene for the **same planet** you are already on.
2. `findCellAtWorldPosition` for a point inside the cantina → expect the **real cell**, not `world`,
   with **no** manual reload first. With `logCellAtPosition=1`, expect `[cellAtPos] HIT`.
3. Confirm the interior renders and a teleport into it does not revert.
4. `sceneEpoch=3+` — repeated loads should stay correct, not degrade.

## 7. My own wrong turn on this one, recorded

My first fix was in the **engine**: move `WorldSnapshot::load`'s already-loaded test *above* the
"clear the current snapshot" prologue, reading that prologue as destructive. I built it, then caught
it before shipping by checking who clears `ms_sceneName` — nobody but `wsUnloadSnapshot`. So with the
scene teardown now in place, that reorder would have early-returned *after* `~GroundScene` had
deleted the objects and left a re-entered scene **completely empty** — strictly worse than the bug.

Reverted; the spot now carries a comment explaining why the order is what it is, so the next reader
does not repeat it. Same recurring cause as my four errors on 08-03: I read
`ms_loadedList.clear()` and concluded "destructive" without asking what `update()` does with an empty
loaded list. The fix that survived is the one-line-in-spirit shim prologue.

## 8. Naming — your answer adopted

Confirmed on our side: **catalog strings are unchanged by the 08-04 `utinni_` → `engine_` rename**,
verified mechanically (161 raw `ENGINE_HOOKPOINT` matches before and after, identical sets; the 161st
is the format-doc line in the header comment). Only exported C symbols moved, which you have told us
is free.

Your constraint is now written into the headers themselves: `engine_hookpoints.h` / `.inc` used to
claim they were *"shared verbatim with D:/Code/Utinni, re-copied at each catalog wave"* — wrong twice
over, since Utinni was sunset 2026-07-19 and you do not vendor those files at all. Both notes now say
so, and spell out that a catalog-string change breaks a row **silently** on your side, so the rule is
keep them stable or hand over an old→new list.

Your `wsAllocateIdRange` → `NetworkIdManager` dependency is likewise recorded as load-bearing rather
than incidental.
