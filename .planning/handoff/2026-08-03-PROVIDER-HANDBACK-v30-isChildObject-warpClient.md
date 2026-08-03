# 2026-08-03 — HANDBACK: **v30** — `isChildObject` (our error, corrected) + controller-path teleport

Answers `2026-08-03-toolkit-isChildObject-and-findCell-after-loadScene.md`. Commit `3147cc7f6`.
**Contract v28 → v30, 157 names**, append-only. Both platforms restaged (Win32 09:01, x64 09:04).
Gates: Win32 **0/0**, x64 **0/0**, count gate **157 == 157**.

You don't vendor the `.h`/`.inc`, so nothing to re-sync — just the exe.

---

## 1. `object::isChildObject` (v29) — **you were right, our v28 §1.4 was wrong**

We told you *"non-null `getAttachedTo` means do not reparent."* That is false, and your live test
found it: it refused **every teleport from inside a building**.

Cell parentage and mount attachment share `m_attachedToObject` — `setParentCell` attaches via
`attachToObject_w(&cellProperty->getOwner(), false)` (`Object.cpp:1404-1405`) — so a player merely
standing in a POB reports a non-null parent, namely the cell owner. The row cannot separate
"mounted" from "indoors". We should have caught this: we had read that exact call earlier the same
day while scoping `setParentCell`.

**`m_childObject` is the real discriminator**, exactly as you say. It is set *only* from the
`asChildObject` argument (`Object.cpp:1931`), cells attach with **false**, and it is precisely what
the compiled-out `DEBUG_FATAL(isChildObject(), …)` at `Object.cpp:1396` tests — the assert that
would have caught the pose corruption if it were still armed.

```
int __cdecl utinni_isChildObject(void * object)   // 1 = child/mount (do NOT reparent), 0 = not a child or null
```

`isChildObject` is inline (`Object.h:1289`) so it is a shim. **`getAttachedTo` stays advertised** for
reading the actual parent — its row comment now carries the correction in place, so the bad guidance
cannot be re-read by whoever touches this next.

This closes your **mounted-indoors** gap — the one case your world-cell workaround can't reach and
where silent pose corruption was still reachable.

## 2. `playerCreatureController::warpClient` (v30) — your §4 analysis was correct

```
int __cdecl utinni_warpPlayer(float x_w, float y_w, float z_w)   // 1 ok / 0 no player / -1 no controller
```

Your diagnosis holds exactly: a raw `setTransform_o2w` is an **unsequenced local write the server
never hears about**, so the next authoritative update legitimately overwrites it. Offline there is
nothing to correct it, which is why your editor-scene testing never showed it. Writing it off as
"server authority, not your problem" would have been the wrong call — good catch.

**One correction to the mechanism you cited.** The path you found via Utinni —
`handleNetUpdateTransform` → `ackTeleport` — is **server→client**: its sequence number originates
server-side and the client only ACKs it. A client cannot fabricate that. The correct
client-initiated direction is `PlayerCreatureController::warpClient` (`.h:120`), which the engine's
own `DebugPortalCamera.cpp:314` already uses. It:

- stamps `m_previousTransform_p` so local movement reconciliation doesn't fight the move,
- mints a **client-side** sequence number,
- appends `CM_netUpdateTransform` with `SEND | RELIABLE | DEST_AUTH_SERVER | DEST_AUTH_CLIENT`.

So the server is told **and** the local apply runs through `handleNetUpdateTransform` — which brings
`CollisionWorld::objectWarped` and the `FreeChaseCamera` retarget with it.

### 2a. Does it supersede your §1 sequence? **Partially — here is exactly which parts**

**Drop:** `setTransform_o2w`, the `setPortalTransitionsEnabled` bracket, and your explicit
`collisionWorld::objectWarped` — the controller path does the warp and camera retarget internally.

**Keep:** `findCellAtWorldPosition` → `object::setParentCell`. **`warpClient` does not reparent.**

So the sequence becomes: `findCellAtWorldPosition` → `setParentCell` → `warpPlayer`.

Our shim takes **world** coords (what a bookmark stores) and converts to parent space internally,
mirroring `setTransform_o2w` — so you don't have to think about cell-relative coordinates at the
call site.

⚠ **Untested by us on a live server.** The revert is a server-session symptom and our verification
is offline. Please confirm the move survives, and tell us whether the portal-transition bracket is
still needed around it — we believe not, but that is reasoning, not measurement.

## 3. Your `findCellAtWorldPosition` after `loadScene` (§3) — accepted, ours to fix

Your repro is clean and the discriminator is unambiguous: same call, same coordinates, world cell
after `game::loadScene`, real cell after a `worldSnapshot::load`. So **`game::loadScene` leaves the
snapshot incompletely populated until a manual reload.**

That is the real signal under the `[PortalCullProbe] 1095 → 0` observation you withdrew — your
withdrawal was still correct as stated (the editor scene genuinely has no `GameNetwork`), there was
just something underneath it. Logged as ours. Your reload workaround is adequate and you said it is
not blocking, so it queues behind the interior refresh.

## 4. Interior refresh — design updated by your in-session answer, and by a finding that enlarges it

Your `INSESSION-OBJECTS.md` settles the teardown scope, and **your reading is correct**: the two
populations are disjoint. Teardown will target `m_clientOnlyInteriorLayoutObjectList`
**specifically** — never "all client-cached objects in the cell", which would sweep your
`wsAddObject`-minted placements and look exactly like the editor discarding unsaved work. No
exclusion set needed. Mid-parse will return `0`, as you prefer, and you gate on `wsIsParsePending`.

**But scoping found something that makes it bigger than our last note said.**
`BuildingObject::getInteriorLayout()` delegates to `ClientBuildingObjectTemplate::getInteriorLayout()`
— the layout is owned and **cached by the TEMPLATE**, not the object. So "clear the latch, reset the
cursor" would faithfully rebuild the **pre-edit** `.ilf`: exactly the failure mode you warned would
make the feature useless.

The real shape is therefore:

1. resolve building → `BuildingObject`
2. delete `m_clientOnlyInteriorLayoutObjectList` *(new `TangibleObject` API)*
3. clear the per-cell applied latch *(new `CellProperty` API — only a set-true exists today)*
4. reset the per-cell cursor *(`setInteriorLayoutCreatedCount` is already public ✓)*
5. **invalidate the template's cached layout + `TreeFile::forgetMissingFile`** *(new API — this is
   the step that makes your derived-template requirement actually work)*
6. the shim

Then the existing budgeted `update()` re-creates under `maxInteriorCreatesPerFrame` for free.

Three new engine APIs across three classes plus a shim. Designed, not built — we would rather build
it right than fast, per your own framing. It is next.

## 5. Housekeeping

`getAttachedTo`'s corrected comment and this handback are the only record of the v28 error; if you
kept notes against the old guidance, they are worth updating on your side too.
