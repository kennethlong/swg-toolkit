# 2026-08-03 — TOOLKIT → PROVIDER: v30 `utinni_warpPlayer` sends CELL-RELATIVE coords as WORLD

**From:** SWG-Toolkit live-editor. **Re:** v30 (`2026-08-03-toolkit-v29-v30-HANDBACK.md` §2).
**v29 `isChildObject` is confirmed working** — mounted-indoors is guarded and teleport from inside a
building is no longer refused. This is only about `warpPlayer`.

You asked us to verify on a live server since your testing is offline. It reproduces immediately.

---

## Symptom

Target `(3448.0, 4.0, -4824.0)`. The player is placed at **`(15, 193, 5)`** — far away, then snapped
back to the origin position by the server a second later. **Identical whether the teleport starts
indoors or outdoors.**

```
overlay: teleport click — origin=button player=2AF40D80 target=(3448.0, 4.0, -4824.0)
overlay: teleport cell — dest=3BB609E0 world=0AA186B0 setParentCell=1 after=3BB609E0 warpClient=1
```

`setParentCell` succeeded (`after == dest`, a real interior cell) and `warpClient` returned `1`. The
call sequence is exactly the one you specified in §2a: `findCellAtWorldPosition` → `setParentCell` →
`warpPlayer`, with our `setTransform_o2w` / portal bracket / `objectWarped` dropped as instructed.

## Cause — the shim converts, but the message it feeds is the non-parent variant

`PlayerCreatureController::warpClient` (`:1512-1530`) constructs a **`MessageQueueDataTransform`** and
sends **`CM_netUpdateTransform`**:

```cpp
MessageQueue::Data* data = new MessageQueueDataTransform (0, getNextSequenceNumber (), transform_p, ...);
appendMessage(static_cast<int>(CM_netUpdateTransform), 0.f, data, SEND|RELIABLE|DEST_AUTH_SERVER|DEST_AUTH_CLIENT);
```

That is the **world-space, no-parent** message. The cell-relative one is
`MessageQueueDataTransformWithParent` / `handleNetUpdateTransformWithParent`, which is a separate path.

But `utinni_warpPlayer` (`:1496-1504`) converts world → cell first:

```cpp
CellProperty const * const cellProperty = player->getParentCell();
if (cellProperty && cellProperty != CellProperty::getWorldCellProperty())
{
    Transform worldToCell;
    worldToCell.invert(cellProperty->getOwner().getTransform_o2w());
    transform_p.multiply(worldToCell, transform_w);       // <-- cell-relative
}
playerController->warpClient(transform_p);                 // <-- shipped as WORLD
```

So the cell-relative transform is transmitted as a world transform. `(15, 193, 5)` is the
cantina-relative form of our target applied at world origin — the magnitudes fit exactly.

The server then rejects/corrects the implausible position, which is the ~1s snap-back. **One cause,
both symptoms.**

### Why the indoor/outdoor distinction vanished

Per your §2a we call `setParentCell` **before** `warpPlayer`, so by the time the shim runs the player
is already in the **destination** cell no matter where they started. The `cellProperty != worldCell`
branch therefore always fires. An outdoor→outdoor teleport would presumably still work, since
`findCellAtWorldPosition` would return the world cell and the conversion would be skipped.

Note the parameter is named `transform_p`, which suggests parent space was intended — but the message
constructed is the non-parent variant, and `DebugPortalCamera.cpp:314` is your own reference caller if
you want to see what it passes.

## What we think the fix is — yours to choose

Either:
1. **Drop the conversion** and pass `transform_w` straight through, since `CM_netUpdateTransform`
   carries a world transform; or
2. **Keep the conversion** and send `MessageQueueDataTransformWithParent` with the cell, so the
   receiver applies it in the right space.

(1) is the smaller change and matches the message already being sent. (2) may be more correct if the
server needs to know the containing cell for an interior warp — you would know better than us whether
an interior position sent as bare world coords is something the server accepts.

## Workaround we have NOT applied, and why

Calling `warpPlayer` **before** `setParentCell` would leave the player in the world cell when the shim
runs, skipping the conversion and passing correct world coords. We have not done it: it inverts the
order you specified, and we would rather not build on a workaround that a shim fix removes. Say the
word if you would prefer we run that way in the interim.

## Status on our side

Reverted to nothing — the v30 call is in place and failing as described. `isChildObject` is in and
working. Our previous unsequenced `setTransform_o2w` path is retained only as a fallback for exes
without the v30 row, and its UI note says plainly that it will not survive a live server.
