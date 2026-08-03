---
created: 2026-08-02
updated: 2026-08-02 (CLOSED — root cause was an ENGINE defect, fixed upstream by the provider and verified live)
source: 05.1-09 live checkpoint — remote RELOAD_CURRENT_SCENE acked code=1 but left the world degraded
affects: Plan 05.1-12 (ADD verification uses reload), Plan 05.1-15 (sign-off uses reload)
fixed-by: provider commit 04c3f8e11 (engine). Residual determinism work = Plan 05.1-17.
status: CLOSED for the original defect. See "STILL OPEN" at the bottom — one NEW regression was introduced by the fix.
severity: was high — silently invalidated a verification step several plans depend on
---

# "Reload current scene" was LOSSY — the phased snapshot parse never finished in-world

> ## ✅ CLOSED 2026-08-02 — fixed upstream, verified live
>
> The root cause was a defect in the **engine**, not in our usage. Provider commit **`04c3f8e11`**
> hoists the `WorldSnapshot::loadStep()` pump out of `GroundScene::updateLoading()` (which early-returns
> unless `m_loading`) and into `GroundScene::update()`, per-frame and unconditional.
>
> **Verified live on the restaged exe:** after an in-world reload the world returns — buildings,
> collision, snapshot creatures — **in one to two seconds, progressively.** No wandering required.
>
> Two consequences, both carried into Plan 05.1-17:
> 1. The rebuild is **asynchronous**, so a reload-then-immediately-verify checkpoint still races it.
>    05.1-17 adds a completion barrier so `ack=1` means "world rebuilt".
> 2. **A NEW regression appeared** — see STILL OPEN below.
>
> The analysis below is retained because it is the verified mechanism and because two plausible
> hypotheses were falsified along the way; do not re-derive either.

## Observed (maintainer, live, 2026-08-02)

Remote `RELOAD_CURRENT_SCENE` acked `code=1`. The scene did reload. Then:

- **Most buildings were GONE** — the cantina simply was not there.
- **Collision was gone too** — able to run straight through where walls should be, up to NPCs
  (the creature trainer) known to be behind them.
- **NPCs were fine throughout** — they came back immediately (server-streamed, not snapshot nodes).
- **Snapshot creatures did NOT** — banthas, dewbacks were missing alongside the buildings.
- **After running around for a while, everything popped in AT ONCE** — "like I crossed a portal
  boundary" — and, decisively, *"the banthas came back as well when the buildings came back"*. One
  restoration event for the whole snapshot set, not several.

An ack of `code=1` is therefore NOT evidence the world is intact. The agent truthfully reports that
the engine call was made; it says nothing about the resulting world state.

---

## ROOT CAUSE — VERIFIED (2026-08-02, against real `../swg-client-v2` source)

**`WorldSnapshot::load()` is a phased, budgeted parse, and nothing pumps it while you are in-world.**

The chain, every link read from source:

1. `WorldSnapshot::load()` (`WorldSnapshot.cpp:503-574`) does a **cheap prologue only** — it opens the
   `.ws`, calls `ms_reader.beginIncrementalLoad()`, sets `ms_parsePhase` / `ms_parsePending = true`,
   and returns. Its own comment (`:523-527`, CONSULT-60) states the node parse, per-area buildout
   tables, **and the sphere-tree build** all run in budgeted `loadStep()` calls, because the old
   synchronous body froze the main loop ~3s.
2. `WorldSnapshot::loadStep()` is pumped from **exactly one place**: `GroundScene::updateLoading()`
   (`GroundScene.cpp:2106`).
3. **`GroundScene::updateLoading()` early-returns unless `m_loading` is true** (`GroundScene.cpp:2072-2073`).
   In-world there is no loading screen, so `m_loading` is false and **`loadStep()` never runs**.
4. `WorldSnapshot::update()` — the function that actually creates snapshot objects — **early-returns
   while `ms_parsePending`** (`WorldSnapshot.cpp:1032-1033`): *"no snapshot object creation until the
   phased parse is done (the sphere tree is only populated in the final parse phase)."*

So after an in-world reload the snapshot is parsed to a stall, the sphere tree is empty, and **zero
snapshot objects are ever created**. That is the missing buildings, the missing collision, and the
missing banthas — one cause, not three. NPCs are unaffected because they are server-streamed objects,
never snapshot nodes. **Exactly the split observed.**

### Why everything returned in one instant

Roughly twenty engine and shim entry points are guarded with `if (ms_parsePending) finishLoadNow();`
(`WorldSnapshot.cpp:1337, 1356, 1399, 1417, 1447, 1477, 1528, 1549, 1757, 1782, 1798, 2102, 2266,
2350, 2478, 2605, 2749`, …). `finishLoadNow()` (`:796-803`) spins `loadStep()` until the parse
completes. Running around eventually tripped one of them; the entire parse finished inside that one
blocking call, and the very next `update()` created the whole set at once.

**This positively explains the observation that ruled out the buildout hypothesis** — the banthas and
the buildings returned in the same instant because *neither* had been created until that moment.

### Two hypotheses this REPLACES — do not re-derive either

1. ~~"Our reload skips the spatial-subdivision / `removeFromWorld` / `clearPreloadList` steps Utinni
   calls."~~ **FALSIFIED.** The engine's own `WorldSnapshot::unload()` already performs exactly that
   teardown per node — `ms_sphereTree.removeObject()`, `setSpatialSubdivisionHandle(0)`,
   `removeFromWorld()`, `delete object` (`WorldSnapshot.cpp:463-480`) — and `utinni_wsUnloadSnapshot`
   (`:2710-2719`) calls straight into it. The unload side is complete and correct.
   Further: the five Utinni symbols the earlier draft named (`get/setNodeSpatialSubdivisionHandle`,
   `removeFromWorld`, `unload`, `clearPreloadList`) are **hardcoded SWGEmu RVAs explicitly documented
   as NOT in the advertised catalog** (WS-3 comment, `../Utinni/UtinniCore/swg/scene/world_snapshot.cpp:176-192`).
   Binding them against the advertised client would be garbage pointers, not a fix.
   Decisively: **Utinni's own advertised-path reload** (`WorldSnapshotLive::reloadSnapshot`,
   `world_snapshot.cpp:1082-1099`) is `wsUnloadSnapshot()` + `load(scene)` — byte-for-byte what we
   already do. There was never a missing step to copy.
2. ~~"Buildout-sourced content is restored by a different mechanism than authored content."~~
   **FALSIFIED** by the maintainer's follow-up (same-instant return), and now also by the mechanism
   above — the phased parse covers `PP_wsNodes` *and* `PP_buildout`, so both stall together.

## ✅ INTERIOR-NPC LOSS FIXED UPSTREAM 2026-08-02 (`0b2e9259c`) — but read the residual below

The provider guarded `WorldSnapshot::unload()`'s delete with the same `isClientCachedOnly` predicate
`update()`'s drain already used. Live-verified: 54 occupants survived on node 1082874, *"npcs are there
and targetable."* Mechanism confirmed as predicted — two Container hops, `PortalProperty : Container`
→ cells → `CellProperty : Container` → occupants.

> ### ⚠ RESIDUAL, and it is worse for us than the bug was
>
> **A kept building renders its PRE-EDIT state.** The surviving root collides with the re-parsed node
> on the next `load()` (`createObject` → `CEC_objectAlreadyExists`; `update()` strips the NEW node's
> sphere handle), so the building shows what was on disk **before the edit** until a zone change or
> relog. Unoccupied buildings are unaffected.
>
> **Consequence: reload is no longer a valid way to verify an interior edit**, because the cantina —
> the primary decorating target — is occupied. Plan 05.1-17's completion poll does NOT help; it makes
> reload atomic, not correct.
>
> **Per-building interior refresh requested and ACCEPTED** — provider is building it
> (`2026-08-02-PROVIDER-SCOPING-interior-refresh.md`). It removes the residual and is a better
> instrument for the decorating loop anyway. Plans 12 and 15 carry `verification_instrument_changed`
> blocks pointing at it.
>
> **Mechanism changed during scoping — do not reference the original one.**
> `ClientInteriorLayoutManager::applyInteriorLayout` (which their §7 offered and our request named) is
> **dead code in this configuration**: gated off by `ms_disableLazyInteriorLayoutCreation` (default
> false, `update()` is the live path with the inverted condition), and add-only anyway — calling it
> would duplicate every decoration rather than refresh it.
>
> The real shape: delete the cell's client-cached interior objects → **reset the per-cell
> created-count cursor on `CellProperty`** → let the budgeted `update()` lazy creator re-build from the
> current layout. Better than what we asked for: it inherits the CONSULT-46 throttle (10 creates/frame)
> so a large building spreads across frames instead of hitching.
>
> Confirmed by them: resolves from the building's **current** template (so a model-D derived `.ilf` is
> picked up), `forgetMissingFile` handled in their shim, client-cached only (no refusal for occupancy),
> return `1`/`0`/`-1`.
>
> **Open risk we flagged back to them** (`...-INSESSION-OBJECTS.md`): unpersisted in-session placements
> are `wsAddObject`-minted **snapshot** nodes, not `.ilf` content. If their teardown widens from the
> client-only interior-layout list to "all client-cached objects in the cell", a refresh would silently
> discard a modder's unsaved placements.
>
> Disclosure hook available now: `wsUnloadSnapshot`'s `[editor.ws]` line carries
> `keptServerOwnedRoots=N`.

## Historical record — the interior-NPC defect as measured (superseded by the fix above)

Measured live 2026-08-02 across four passes, including a clean before/after on a fresh game session:

| Content | Across an in-world reload |
| --- | --- |
| Buildings, dewbacks, banthas (snapshot) | disappear, redraw progressively in 1-2s ✅ |
| **Exterior** NPCs (world cell) | **unaffected** — survive multiple reloads |
| **Interior** NPCs (inside a POB cell) | **gone, and never return** — multiple cell transitions do not restore them ❌ |

**Leading mechanism (strong, not traced):** `WorldSnapshot::unload()` deletes by NetworkId with **no
`isClientCachedOnly` guard**, unlike `update()`'s delete drain. Deleting a POB building takes its cell
objects with it, and the Container dtor **cascade-deletes cell contents** — the exact hazard
`wsRemoveNode`'s occupancy guard exists to prevent for the player. Exterior NPCs live in the world cell
and are never touched. Found by the provider while disproving an earlier (wrong) hypothesis of ours.

**The permanence is a positive signal, not a counter-signal.** Awareness is tracked server-side, so a
client-side delete is invisible to the server and it never re-sends. "Gone until relog regardless of
portal crossings" is the expected signature of an unguarded client-side delete; a *return* on re-entry
would have argued against it.

**This is NOT a regression from `04c3f8e11`** — it would behave identically pre- and post-fix.

### Two corrections to earlier versions of this file — do not restore them

1. ~~"Reload drops ALL server-streamed NPCs; the fix inverted the behavior."~~ **FALSE.** Exterior NPCs
   are unaffected. The original observation was taken in a session where **"Load editor scene" had been
   run first** — that builds an offline single-player scene with no `GameNetwork` session, so ALL
   server content is absent, interior and exterior. Verified: a single editor-scene load removes every
   NPC as expected.
2. ~~"There are no cantina NPCs, so there is nothing to explain."~~ **ALSO FALSE.** The cantina has
   NPCs; they are present before a reload and absent after.

**STANDING MEASUREMENT RULE, learned the hard way:** any observation about server-streamed content taken
after a `game::loadScene` is INVALID. The editor scene has no server session. This also puts the
`[PortalCullProbe]` 1095→0 finding under suspicion — that capture was taken in the editor scene too.

**Consequences:**
- **A reload-based verification step must not assert on interior NPCs**, and the disclosure belongs
  next to the reload control (Plan 05.1-17) — decorating happens inside buildings, which is exactly
  where a reload empties the room.
- Reported to the provider 2026-08-02 with the differential, the permanence, and our own retractions.

## Residual work on our side (Plan 05.1-17) — determinism, not correctness

The engine now completes the parse on its own. What Plan 05.1-17 adds is a **completion barrier** so
the reload is ATOMIC, because Plans 12 and 15 read the world immediately after reloading:

- `worldSnapshot::wsGetNodeCount` is **already advertised** (`engine_hookpoints.inc:346`).
- Its shim opens with `if (ms_parsePending) finishLoadNow();` (`WorldSnapshot.cpp:1780-1791`).
- Our agent does **not** bind it yet — one new row in `rva_table.cpp`, one call site.

Both reload paths need it: the local "Reload current scene" button (`overlay.cpp:1311-1313` and
`:1325-1326`) and the deferred `RELOAD_CURRENT_SCENE` queue action (`overlay.cpp:945-951`).

Cost is a synchronous parse hitch (order of the ~3s the CONSULT-60 comment cites) on the reload frame.
That is the correct price for a reload and it is paid on the game thread, which the 05.1-16 deferred
queue already guarantees.

Note this also means a reload is only as good as its force-finish: **do not add a reload path anywhere
that skips it.**

## Consequences already recorded elsewhere

1. **It invalidated a verification step several plans depend on.** Plan 05.1-12's ADD checkpoint says
   *"Trigger 'Reload current scene'. Confirm exactly ONE instance of the new object is visible"*, and
   Plan 05.1-15's sign-off reloads to confirm a rotation persisted. Before the fix, a correctly
   persisted object could read as MISSING. **05.1-17 is a hard prerequisite for both.**
2. **Collision loss broke placement.** Plan 05.1-12's click-to-place resolves the container from
   `collideScreenRay`. With building collision unregistered, an interior click resolved to building id
   `0`, which under the 2026-08-02 revision correctly REFUSES. Right behavior, confusing symptom —
   and it disappears once the parse actually finishes.
