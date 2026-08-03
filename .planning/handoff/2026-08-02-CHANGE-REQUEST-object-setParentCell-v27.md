# Change request (→ swg-client-v2): `object::setParentCell` — cell reparenting for teleport / scene load

**Date:** 2026-08-02 · **From:** SWG-Toolkit live-editor · **To:** swg-client-v2 (advertised catalog owner).
**Requested contract bump:** v26 → **v27**.
**Consumer plan that pre-wires it:** SWG-Toolkit `05.1-18`. **Consumer todo:** `.planning/todos/pending/cell-aware-teleport.md`.

## Why

Moving the player by writing the world transform alone leaves them parented to the **world cell**, so
the engine evaluates the outdoor portal set from a position that is physically indoors. Interiors then
render **see-through** from the inside.

Confirmed live, both directions:

- Teleport to a POB interior → see-through walls.
- **Walking out the door repairs it** — crossing a portal makes the engine reassign the cell.
- **Extended 2026-08-02: a SCENE LOAD triggers the same state**, so this is not teleport-specific.

The client's own `[PortalCullProbe] DOOR portal=… cell=…` telemetry shows the per-cell portal set being
evaluated per frame, which is consistent: the visible cell set is driven by the parent cell, not by
world coordinates.

## What is missing (and a correction to our own earlier note)

We previously recorded internally that `setParentCell` was *"advertised but not bound."* **That was
wrong, and we have corrected it in place.** Your contract states the actual position explicitly:

> `engine_hookpoints.inc:172` — *"(addToWorld/removeFromWorld/**setParentCell** are VIRTUAL -> skipped in .cpp; …)"*

So the setter is genuinely absent from the catalog. The **read** side is already there and is
sufficient for us — `ENGINE_HOOKPOINT(object, getParentCell)` (`engine_hookpoints.inc:178`), backed by
the non-virtual `CellProperty *Object::getParentCell() const` (`Object.h:167`). We bind it in 05.1-18.

## The ask

**1. `int __cdecl utinni_setParentCell(void* object, void* cellProperty)`** — shim mandatory, because
`virtual void Object::setParentCell(CellProperty*)` (`Object.h:168`) is virtual and your ABI rule skips
virtuals. Suggested semantics matching the `getContainingBuildingId` v25 precedent: borrowed
consumer-held pointers, game-thread-only, `1` ok / `0` refused (null object or null cell). Note
`Object::setParentCell` itself already `NOT_NULL`s its argument (`Object.cpp:1389`) and no-ops when the
cell is unchanged (`:1392-1393`), so the shim only needs the null guards.

Both pointers can cross as opaque `void*` with **no consumer-side dereference**: we obtain the
destination `CellProperty*` from the already-advertised `object::getParentCell` applied to an object we
picked at the destination via `clientWorld::collideScreenRayObject` (v22). No new read row is needed.

**2. A way to name the world cell** — for the reparent-to-outside direction we need
`CellProperty::getWorldCellProperty()` (`src/shared/portal/CellProperty.h:78`). It is a plain static, so
if it is out-of-line this may be a constant-`&fn` row rather than a shim (the
`cuiPreferences::getAllowTargetAnything` pattern) — your call on which form is correct.

## The one question we are NOT guessing at

**Once the player is reparented, must the transform be written cell-relative (o2p), or does world
(o2w) remain correct?** We are asking rather than experimenting because getting it wrong writes bad
player state into a live client.

Our reading of your source suggests **o2w stays correct and the caller should not convert**:
`Object::setParentCell` attaches via `attachToObject_w(&cellProperty->getOwner(), false)`
(`Object.cpp:1405`) — the `_w` variant, which preserves the **world** transform across the attach and
derives o2p itself. If that is right, the caller writes `setTransform_o2w` and reparents, with no
manual conversion.

**Please confirm (a) that reading, and (b) the correct ORDERING** — reparent-then-write-transform, or
write-transform-then-reparent. We will not assume either.

(Context for why the question arises at all: `object::getTransformO2P` (v24) exists for the read side
and the `.ilf` stores o2p, which made parent-space authoring look like the general rule for interiors.)

## Consumer status

Pre-wired in 05.1-18 so the capability lights up on exe restage with no consumer rebuild — the same
pattern that worked for `getContainingBuildingId` v25:

- `rva_table.cpp`: rows added for `object::getParentCell` (already advertised — bound now, live now)
  and `object::setParentCell` (slot stays null until v27 restages).
- Teleport and the 05.1-11 D-07 bookmarks carry a **cell reference alongside x/y/z** from day one, so
  no bookmark schema migration is needed when the setter arrives. Until then the existing honest UI
  note stands (`"moved (interiors render wrong — world-cell parent, see todo)"`).

## Not part of this request

- The **stale-player-pointer** defect after a scene reload is ours and is fixed consumer-side in
  05.1-18 (temporal gate on `getPlayer()` stability). No provider change needed.
- Legacy **SWGEmu** already has this capability via Utinni's RVAs (`Object::setParentCell 0x00B22C30`,
  `swg/object/object.cpp:140`); that path belongs to our Milestone 9 parity work, not to you.
