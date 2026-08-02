---
created: 2026-08-02
source: 05.1-16 live checkpoint — "teleport after load editor scene puts me inside the cantina and it isn't rendered properly, almost everything is see through from the inside"
affects: Plan 05.1-09 (TELEPORT HOST_CMD action), Plan 05.1-11 (D-07 teleport bookmarks)
---

# Teleport must reparent the player's cell, not just write the world transform

## Symptom

Teleporting to coordinates INSIDE a POB lands the player in the right place but the interior renders
wrong — walls and geometry read as **see-through** from inside. Outdoor teleports are unaffected.

## Cause

`overlay.cpp`'s teleport writes the world transform ONLY:

```cpp
void* player = swg::endpoints::getPlayer();
swg::endpoints::setTransform_o2w(player, t);   // world-space 3x4, identity rotation
```

SWG interiors use **portal culling** (the client's own `[PortalCullProbe] DOOR portal=... cell=...`
telemetry shows the per-cell portal set being evaluated every frame). The visible cell set is driven
by the player's **parent cell**, not by world coordinates. Writing the transform moves the player's
position while leaving them parented to the **world cell**, so the engine evaluates the outdoor portal
set from a position that is physically indoors — hence see-through walls.

Note the teleport default (`overlay.cpp`, `s_tpPos`) is hardcoded to the Mos Eisley cantina front
door, so "it put me inside the cantina" is the button working as designed; only the rendering is wrong.

## Fix

`object::setParentCell` is **advertised but NOT bound** in `packages/live-inject/agent/rva_table.cpp`
(only referenced in a comment about the `getParentCell()->getPortalProperty()->getOwner()` chain).
Legacy parity exists too: Utinni binds `Object::setParentCell 0x00B22C30` (`swg/object/object.cpp:140`)
and `0x00555410` for the ClientObject variant (`client_object.cpp:42`).

Sequence to work out and verify live (do NOT assume the ordering):
1. Resolve the destination cell — `getContainingBuildingId` gives the building from an object, but
   teleport starts from raw coordinates, so the cell must come from somewhere else (candidate:
   pick/collide at the destination, or accept a cell id alongside the coords).
2. `setParentCell(player, cell)` and write the transform. Whether the transform should then be
   **cell-relative (o2p)** rather than world (o2w) is the open question — `object::getTransformO2P`
   exists for the read side, which suggests interiors are authored in parent space.

## Why not fixed in 05.1-16

That plan is crash-safety for scene swaps. Cell-aware teleport is new capability with an unverified
call sequence, and getting it wrong writes bad player state into a live client. Scoping it out kept
16 shippable.

An honest in-UI note was added instead (`eb54583`): the teleport button now reports
`"moved (interiors render wrong — world-cell parent, see todo)"` rather than appearing to work fully.

---

# SECOND, DISTINCT TELEPORT DEFECT — stale player pointer immediately after a scene reload

Different bug, same consumers. Fix both together or the survivor still looks broken.

## Symptom

Intermittent: after "Reload current scene", clicking teleport does nothing at all — no movement, no
error. Retrying later works. Reported twice at the 05.1-16 checkpoint, then NOT reproducible on the
instrumented run.

## What the instrumentation proved (commit `a166f24`, DebugView capture)

```
click 1-2:  player=2B1E83A0  read-back == target
click 3-5:  player=381F8400  read-back == target      <- different object after the reload
```

5/5 clicks registered. 5/5 writes landed. `getPlayer()` returned null **zero** times. So the button,
the click path, and `setTransform_o2w` are all fine — the naive "the write fails" and "the player is
null" explanations are both FALSIFIED by evidence.

## Leading hypothesis (NOT yet confirmed — the failing case has not been captured)

`getPlayer()` briefly returns the **OLD, freed player** in the window right after a reload, before the
engine repoints its player global. Writing to it appears to succeed (freed memory is still writable)
and the read-back matches **because it reads the same freed memory back** — so even instrumentation
reports success while the real player never moves. Intermittent precisely because it depends on
clicking inside that window.

Consistent with everything observed, and it is the same disease as the rest of the 05.1-16 checkpoint:
stale pointers across a scene-lifecycle boundary. Note `invalidateSceneCachedPointers()` (`eb54583`)
canNOT help here — `getPlayer()` is the ENGINE's accessor, not one of our cached globals.

**To confirm:** capture a failing instance. The `overlay: teleport click — player=%p` trace is already
in the build; a failing click whose pointer equals a PRE-reload pointer confirms it outright.

## Mitigation options (in preference order)

1. **Temporal gate.** After a scene change, refuse player writes until the `getPlayer()` pointer has
   been stable across N consecutive ticks. Cheap, needs no new bindings, and addresses the actual
   mechanism.
2. **Identity cross-check.** Compare `object::getNetworkId(player)` before/after — but this derefs the
   suspect pointer, so it shares the UAF risk it is meant to detect.
3. **`object::isActive`** (advertised, `engine_hookpoints.inc:305`, currently UNBOUND) — **does NOT
   solve this.** Calling it on freed memory is itself undefined behavior. It distinguishes
   "allocated but not in world" from "in world"; it is not a liveness test for a freed object. Do not
   reach for it as the fix.

## Consumers that need this

- **Plan 05.1-09** wires `TELEPORT` as a remote HOST_CMD action — it inherits this limitation verbatim.
- **Plan 05.1-11** builds D-07 teleport bookmarks. Bookmarking a spot *inside a building you are
  decorating* is the obvious use case for a world editor, and is exactly the case that renders wrong.
  Consider whether bookmarks should store a cell reference alongside x/y/z.
