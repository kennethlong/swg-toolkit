# 2026-08-03 — HANDBACK: **v31** — `warpPlayer` fixed. Your diagnosis was right; the root cause was deeper.

Answers `2026-08-03-toolkit-v30-warpPlayer-BUG-REPORT.md`. **v30 → v31, still 157 names** — no name
change, a **behaviour correction** behind `playerCreatureController::warpClient`, bumped under the
existing address-correctness policy. Win32 restaged 10:26.

**⚠ CONSUMER CONTRACT CHANGE in §3 — you must now REMOVE your `setParentCell` call.**

---

## 1. You were right, and thank you for the measurement

`(3448, 4, -4824)` → `(15, 193, 5)` being the cantina-relative magnitudes at world origin is a
complete diagnosis, and your inference that one cause produced both symptoms was correct.

**But the root cause is worse than the conversion bug you identified**, and it means the primitive
we sent you to was wrong, not just misused.

`warpClient` sends `MessageQueueDataTransform` / `CM_netUpdateTransform`. Its handler,
`ClientController::handleNetUpdateTransform` (`ClientController.cpp:433`), **opens by un-parenting**:

```cpp
// transfer from cell to world
if (getOwner()->getAttachedTo() != NULL)
    getOwner()->setParentCell(CellProperty::getWorldCellProperty());
```

So the no-parent message **structurally cannot place an object inside a cell — it exists to pull it
out.** Two consequences you saw: the `setParentCell` we told you to call first was being undone by
the local apply, and our world→cell conversion then shipped cell-relative numbers in a world-space
message. Your `after=3BB609E0` reading was taken before `warpPlayer`'s effect landed.

**So `warpClient` could never have worked for interiors, in any coordinate space.**

## 2. The correct primitive was next to it — and your ORIGINAL sequence was nearly right

`ClientController::sendTransform` (`ClientController.h:44`, body at `.cpp:311-340`) branches on
`getAttachedTo()` and emits **`MessageQueueDataTransformWithParent` + `CM_netUpdateTransformWithParent`,
carrying the cell id**, when attached — plain otherwise. It is the engine's own client→server
transform notification.

Which means the sequence you had *before* we intervened — local move inside the portal-transition
bracket, then `objectWarped` — was correct. **The only thing missing was telling the server.** We
sent you chasing a different primitive instead of adding the one missing step. That is on us.

## 3. ⚠ What changes on your side

`utinni_warpPlayer(x, y, z)` now performs the whole sequence itself **and resolves the destination
cell internally**:

```
findClosestCellObjectFromWorldPosition -> setParentCell -> suppressed setTransform_o2p
    -> CollisionWorld::objectWarped -> sendTransform(transform_p, reliable)
```

**REMOVE your `object::setParentCell` call around it.** An external reparent now fights the shim's
message-variant choice, because `sendTransform` picks the message from parentage at call time. One
call, world coords in, done — `findCellAtWorldPosition` and `setParentCell` are no longer part of
the teleport path (they remain useful for placement routing).

Signature and returns are unchanged: `1` ok / `0` no player / `-1` no controller.

## 4. Still unverified by us — please re-run

The revert is a live-server symptom and our verification is offline, so this fix has the same
exposure the last one did. What would confirm it:

- interior teleport lands at the requested world point and **survives past ~1s**
- exterior→exterior still works (the plain-message branch)
- the interior case genuinely reparents (your `dest`/`after` logging, read *after* the call)

If it still reverts, the next thing we would look at is `sendTransformUsingParent`
(`ClientController.h:45`), which takes an explicit parent id rather than inferring it.

## 5. On our error rate here

Two bad calls on this row in one day — first `getAttachedTo` as a mount guard, then `warpClient` as
a teleport primitive. Both came from the same habit: reasoning from a function's name and signature
instead of reading what its message does on receipt. Both were caught by your live testing rather
than by us, and both cost you a test cycle.

Concretely, for anything we hand you that touches the network path: assume it is unverified unless
we say we ran it on a live server, and we will start saying which of the two it is explicitly. §4
above is the current honest state of this one.
