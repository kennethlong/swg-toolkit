# 2026-08-02 — HANDBACK: **v28** (all 5 rows granted) + the NPC regression re-framed

**Pushed.** `origin/master` = `2ea5673ec`. Answers your
`2026-08-02-TOOLKIT-REPORT-v27-reload-verified-plus-5-row-request.md`.

**Contract: v28, 155 names**, append-only.

```
engine_hookpoints.h    0e36cbaa958aa648eda47c33d1bd3b31930f32feb7eeef03af08e6f44127f576
engine_hookpoints.inc  540fecbe473c94bbc8f7ff0c5a9b0cda16ef11dcaa2c86b12bb77f79d164815a
```

Both platforms restaged 19:32. Gates: Win32 **0/0**, x64 **0/0**, `GetEngineHookPoints`
**ord-82 undecorated**, count gate **155 == 155**.

---

## 0. Corrections to OUR last handback — you were right twice

**Checklist item 1 was wrong and is withdrawn.** It told you to re-sync
`engine_hookpoints.h`/`.inc` byte-identically against published sha256s. **You don't vendor
those files, and you never have** — that instruction is Utinni-era boilerplate that survived
into a document aimed at you. Your binding model (by name, `ENGINE_HOOKPOINTS_VERSION` at
`resolve.h:21` as the only artifact) is correct as-is. The hashes above are published for
provenance only; **ignore them**. Nothing to sync. Consider bumping your `6` to `28` purely to
silence the warning.

**§3's ordering correction is accepted and the comment is rewritten** (`2ea5673ec`). You were
right: `setParentCell` does not run the sweep — it fires only `cellChanged(false)` (`:1408`),
and `CellPropertyNamespace::Notification` overrides only `getPriority`/`positionChanged`/
`positionAndRotationChanged` (`CellProperty.cpp:42-66`), never `cellChanged`. `Object::cellChanged`
is non-virtual so the observer set is closed, all re-derive from current state, and none caches
a position — **our "stale position" rationale was cosmetic**. Your replacement reasoning is now
the comment verbatim in substance: transform-first lets the sweep's pick be *unconditionally
overwritten* by the trailing `setParentCell`; reparent-first leaves that pick **final and
uncorrected** — a silent permanent mis-parent feeding `getContainingBuildingId` and placement
routing. Right conclusion, wrong reason, now fixed so nobody leans on the bad one.

Your point 2 is also right and now recorded: our internal call sites bracket **the transform
write only**, and their cell-first choice is *conditional on the suppression they have* — which
you now have too (§1.1).

---

## 1. The five rows — all granted

### 1.1 `cellProperty::setPortalTransitionsEnabled` — `void (bool)`, plain `&fn`

Public out-of-line static (`CellProperty.h:73` / `.cpp:336`). You called this the one that
would let you stop reasoning about sweep behavior; we agree, so take the engine's own idiom
whole (`GroundScene.cpp:1492-1497`):

```
setParentCell(C);
setPortalTransitionsEnabled(false);
    setTransform_o2p(...);          // note: o2p, because you have already reparented
setPortalTransitionsEnabled(true);
collisionWorld::objectWarped(player);
```

> ⚠ **It is GLOBAL state, not scoped.** No RAII, no refcount. An early return or a throw
> between disable and re-enable leaves portal transitions off **for the rest of the session**,
> and the resulting symptom will look nothing like its cause. Wrap it on your side.

With the bracket in place the §3 ordering analysis is moot — that is the point of the row.

### 1.2 `collisionWorld::objectWarped` — `void (Object*)`, plain `&fn`

Out-of-line static (`CollisionWorld.h:82` / `.cpp:1334`). Completes the idiom above. Granted on
the strength of our own call site, as you asked — still no independent symptom evidence.

### 1.3 `clientWorld::findCellAtWorldPosition` — `void* (float x, float y, float z)`, shim

**The placement-routing primitive**, and the one that closes the gap our §2b identified.
Wraps `ClientWorld::findClosestCellObjectFromWorldPosition` (`ClientWorld.h:227` / `.cpp:1649`)
and folds in the `getCellProperty()` hop so you never dereference an engine type.

**Never returns null** — null-checked at every hop with an explicit fallback to
`getWorldCellProperty()`, so the result is *always* a legal `setParentCell` argument (which
FATALs on null). And since it is the client's own containment heuristic (its other caller is
`SwgCuiQuestHelper.cpp:997`), tool and engine cannot disagree about which cell a doorway point
belongs to.

*Your caveat, unresolved and now yours to watch:* whether snapshot-loaded POBs are in
`ms_tangibleSphereTree` at all times or only once their objects exist. We did not chase it. If
the doorway test misbehaves specifically right after a reload, that is the first suspect — and
`wsIsParsePending` (§1.5) is how you'd avoid asking during the window.

### 1.4 `object::getAttachedTo` — `void* (void* object)`, shim

Parent object, or `0`. **Safety row.** Your trace is confirmed: the
`DEBUG_FATAL(isChildObject(), …)` at `Object.cpp:1396` is `#if 0`'d, `isInWorldCell()` returns
true *through* the mount so the detach at `:1400` is skipped, and `attachToObject_p`'s
re-entry into `detachFromObject(DF_none)` overwrites the correct `m_objectToParent` at `:2002`.

Both `getAttachedTo` (`Object.h:628/640`) and `isChildObject` (`:1289`) are inline → no PMF
address → shim. One row covers both needs: **non-null means do not reparent.** You can drop
the "do not teleport while mounted" limitation and refuse properly instead.

### 1.5 `worldSnapshot::wsIsParsePending` — `int (void)`, shim

`1` = parse in flight (world still rebuilding), `0` = idle/complete. **The only `ws*` row with
no `finishLoadNow()` prologue** — deliberately pure and non-forcing.

You were right that `getLoadingPercent` is not a substitute (it returns `0` while parsing *and*
reports preload percent, so `0` is ambiguous), and right that forcing to avoid a race is the
wrong trade. **Please drop the `wsGetNodeCount`-as-barrier workaround** from §1a — poll this
from your `game::mainLoop` detour and your ack can honestly mean "world rebuilt" without paying
a multi-second synchronous parse.

---

## 2. §2 NPC regression — we do not think our fix caused it, and there is a 10-second test

Both paths our fix newly enabled are already guarded:

- **`createObject` bails** if an object with that NetworkId already exists — creation never
  clobbers a live server object.
- **`update()`'s delete drain** is wrapped in `if (ContainerInterface::isClientCachedOnly(…))`
  — it explicitly refuses to delete server-owned objects (same guard family as the occupancy work).

So the create/delete pass cannot remove server NPCs, which is what your hypothesis requires.

**What fits every detail instead: the observation protocol changed, not the behavior.** Pre-fix
you had to *wander* to get anything back — and wandering is an awareness transition, which is
exactly what makes the server re-stream NPCs. Post-fix you deliberately stood still (your §1
says so). Snapshot content now returns on its own; with no awareness transition the server never
re-sends the NPCs. The "inversion" is an artifact of no longer needing to walk around.

> **TEST (≈10s):** reload, stand still, confirm NPCs absent — then **walk a short loop** and
> see whether they return. If they do, this is not a regression and never was.

**The real defect this exposes is different, older, and ours.** `WorldSnapshot::unload()` deletes
by NetworkId with **no `isClientCachedOnly` guard at all**, unlike `update()`'s drain:

```cpp
Object * const object = NetworkIdManager::getObjectById(NetworkId(node->getNetworkIdInt()));
if (object)
    delete object;                     // unconditional
```

Combined with the confirmed idmint finding that tatooine `.ws` carries **authored server-range
ids** (up to 609,457,649), a snapshot node id colliding with a live server object's NetworkId
would let `unload()` delete that object outright. That is a plausible mechanism for NPCs
disappearing across *any* reload, pre- and post-fix alike.

**We have deliberately NOT changed it.** It predates both our fixes, it alters teardown
semantics, and the asymmetry may be intentional. Flagging it as a decision, not shipping it.
Tell us what the test shows and we will take it from there.

---

## 3. §3 second observation — on the record, not yet investigated

`[PortalCullProbe]` emitting **1095 lines before `game::loadScene` and exactly 0 after**, across
22 seconds and 7 teleports until shutdown, with neither interior nor exterior drawing and
walking out the door repairing it — that is a **hard zero**, which is a much stronger signal
than a degraded count. Portal traversal appears not to run at all in that scene.

Squarely our domain and we want it. Not touched this pass. If you can say whether the editor
scene's snapshot populated at all (`wsGetNodeCount` post-load, or now `wsIsParsePending`), that
would discriminate "world-cell parentage after scene load" from "snapshot never populated" and
save us a round trip.

---

## 4. Also

- **§1 reload verification received and appreciated** — buildings, collision, banthas and
  dewbacks returning progressively in 1-2s while standing still is exactly the intended
  behavior. Thank you for not rewording Plan 12/15 first.
- **v26 `getShutdownPhase` is unconsumed on your side** and there is still **no push event** —
  it is a poll. If your agent needs to be *woken* rather than sampled, say so; an event plus a
  bounded quiesce ack is designed and costed but deliberately unbuilt.
- Nothing in v28 moved, renamed, or changed an existing row.
