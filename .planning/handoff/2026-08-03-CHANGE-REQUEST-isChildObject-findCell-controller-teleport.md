# 2026-08-03 — TOOLKIT → PROVIDER: v28 live results — one row falsified, one caveat confirmed

**From:** SWG-Toolkit live-editor. **Re:** v28 (`2026-08-02-toolkit-v28-five-rows-HANDBACK.md`).
Cell-aware teleport is built and verified live against the v28 rows. Two findings you will want.

---

## 1. ✅ v28 works — cell-aware teleport is live

The engine's own idiom, adopted whole as you specified:

```
findCellAtWorldPosition -> setParentCell -> { setPortalTransitionsEnabled(false) }
    setTransform_o2w -> { (true) } -> collisionWorld::objectWarped
```

```
overlay: teleport cell — dest=367B7740 world=0ADC8770 setParentCell=1 after=367B7740 suppressed=1 warped=1
```

`dest != world` (a real interior cell resolved), reparent applied, suppression engaged, collision
reconciled. Maintainer: *"teleporting into cantina works and NPCs are all present and interior looks
correct."* The defect that started this arc is closed.

`setPortalTransitionsEnabled` is behind an RAII guard with a destructor, per your warning — it is
called from exactly one place and survives an SEH unwind.

---

## 2. ⚠ `object::getAttachedTo` cannot be used as the mount guard — your §1.4 guidance is falsified

Your handback said: *"One row covers both needs: **non-null means do not reparent**."* We implemented
exactly that. It refused **every teleport made from inside a building**:

```
overlay: teleport REFUSED — player is a child object (mounted/vehicle)   <- standing in the cantina
overlay: teleport cell — dest=3AFB6B90 world=0B288770 ...                <- standing outside, works
```

Cause: cell attachment and mount attachment share `m_attachedToObject`. `setParentCell` does
`attachToObject_w(&cellProperty->getOwner(), false)`, so **any player inside a POB reports a non-null
`getAttachedTo`** — the cell owner. The row cannot distinguish "mounted" from "indoors", and indoors is
the entire workflow.

**The ask: advertise `object::isChildObject`** (`Object.h:1289`, inline → shim) — the `m_childObject`
flag is the actual discriminator and it is what the compiled-out `DEBUG_FATAL` at `Object.cpp:1396`
tests. A plain `int (void* object)` is all we need.

**Our interim workaround**, so you can see what we are running: treat an attachment as a mount only
when the parent cell is the world cell.

| state | parent | attached | our result |
| --- | --- | --- | --- |
| mounted outdoors | world | mount | REFUSED (correct — the common case) |
| unmounted outdoors | world | null | allowed (correct) |
| unmounted indoors | cell | cell owner | allowed (correct — was the false positive) |
| mounted indoors | cell | mount | **allowed — unguarded**, the gap `isChildObject` would close |

Not urgent; the exposure is the same as before v28. But it is the one case where a silent pose
corruption is still reachable.

---

## 3. ✅ Your `findCellAtWorldPosition` sphere-tree caveat is CONFIRMED — with a repro and a workaround

Your §1.3: *"whether snapshot-loaded POBs are in `ms_tangibleSphereTree` at all times or only once
their objects exist… If the doorway test misbehaves specifically right after a reload, that is the
first suspect."*

It does, and the discriminator is clean. **Same call, same coordinates, different answer depending on
how the scene was populated:**

| after | `findCellAtWorldPosition` for a point inside the cantina |
| --- | --- |
| `game::loadScene` (our offline editor scene) | **returns the WORLD cell** → we reparent to world → interior does not render |
| a subsequent `worldSnapshot::load` (reload) | **returns the real cell** → reparents → interior renders |

Logged evidence from the editor scene, where `dest` and `world` are the same pointer:

```
sceneEpoch=2  overlay: teleport cell — dest=0AB08770 world=0AB08770 setParentCell=1 after=0AB08770
```

versus a populated scene:

```
overlay: teleport cell — dest=367B7740 world=0ADC8770 setParentCell=1 after=367B7740
```

Maintainer, confirming the workaround directly: *"Reload after load editor scene, then teleport does
not revert, stays in new location"* and the interior renders.

**So `game::loadScene` appears to leave the snapshot incompletely populated until a manual reload.**
That is a sharper statement of the `[PortalCullProbe] 1095 → 0` observation we withdrew as
editor-scene-contaminated — the contamination concern was real and the withdrawal was right as stated,
but there is a genuine signal underneath it and this is it. Yours to judge; the reload is an adequate
workaround for us so it is not blocking.

---

## 4. REQUEST — a controller-path teleport. Our `setTransform_o2w` approach is structurally wrong.

**Symptom:** in a **live server session** the player lands correctly and is then yanked back after
~1s. It does **not** revert in the offline editor scene.

We first wrote this off as "server authority, expected, not your problem." **That was wrong**, and the
maintainer caught it by pointing us at how Utinni does a *persistent* teleport. Utinni never writes the
transform:

```cpp
// UtinniCore/swg/object/player_object.cpp:106-120
pTeleportPlayer teleportPlayer = (pTeleportPlayer)0x0062A8B0;   // "Controller function", from IDA
teleportPlayer(memory::read<swgptr>((swgptr)Game::getPlayerCreatureObject() + 0x2C), &destPos);
```

`CreatureObject + 0x2C` is the **controller**. Reading your source, that is clearly the right shape and
ours is not — teleport here is a **sequenced, server-driven handshake**, not a position write:

`PlayerCreatureController::handleNetUpdateTransform` (`:2390-2428`)
→ `doClientHandleNetUpdateTransform(message)`
→ `CollisionWorld::objectWarped(creature)`
→ retarget the `FreeChaseCamera` (*"authoritative for orientation"*)
→ **`ackTeleport(message.getSequenceNumber())`** (`:2336-2341`, sends `MessageQueueTeleportAck`)

with `m_serverSequenceNumber` tracked and older packets explicitly disregarded. A raw
`setTransform_o2w` participates in none of that, so it is an **unsequenced write the next server update
legitimately overwrites**. Offline there is no server, hence no revert — which is why our editor-scene
testing never showed it.

**The ask:** an advertised row that performs a client-initiated teleport through the controller path,
so the move is sequenced/acked and survives. Something like:

```
int __cdecl utinni_teleportPlayer(float x, float y, float z)   // 1 ok / 0 no player / -1 refused
```

Shape is yours to choose — you can see whether the correct implementation is appending a
`MessageQueueDataTransform` to the player's controller queue (driving the existing handler, including
its `objectWarped` and camera retarget for free), or something more direct. We deliberately are not
guessing: the parameter is an engine type and the sequencing is your domain. Note
`messageQueue::appendMessage` already exists in the catalog as a `{name,0}` placeholder row, if that
turns out to be the natural vehicle.

**If this lands, it likely supersedes most of §1's hand-rolled sequence** — the controller path already
does `objectWarped` and the camera retarget internally, and possibly the cell reparent too. We would
rather call one correct engine entry point than reproduce its steps from outside. Worth telling us if
that is the case, because we would then simplify rather than keep both.

Not blocking: the offline editor scene is unaffected and is where our verification runs today.

---

## 5. Still owed by us

The `[PortalCullProbe]` re-run from a server-connected session (§3 above supersedes part of it, but not
all). And your per-building interior-refresh work is unblocked from our side whenever you get to it —
the in-session-objects answer is in `2026-08-02-toolkit-interior-refresh-INSESSION-OBJECTS.md`.
