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

> ## ✅ UNBLOCKED 2026-08-02 — v27 shipped both rows; defect now MEASURED, not inferred
>
> Provider commit **`b9363b5b0`** added `object::setParentCell` (`engine_hookpoints.inc:447`) and
> `cellProperty::getWorldCellProperty` (`:448`) in response to our change request. The
> "blocked on the provider" section below is superseded — kept for the correction it records.
>
> **Live telemetry 2026-08-02 pins the defect exactly:**
> - Our write is CORRECT. Nine clicks, every one `now == wanted` on the read-back. Not a transform bug.
> - The player reaches the target (`3437.24 → 3428.32`, target X `3428.0`) while the portal probe still
>   reports **`cell=cantina`** — right coordinates, wrong cell. That is the whole defect.
> - **28 `DOORHIT-WAKE` portal sweeps fire after EACH teleport**, alternating `private_room ↔ cantina` —
>   the `positionChanged` line-sweep chewing on a teleport-length segment.
> - After a `loadScene`, `[PortalCullProbe]` goes from **1095 lines to exactly 0** — portal traversal
>   stops executing entirely, which is why neither interior nor exterior of the cantina drew.
>
> Both questions this file left open are answered (verified in provider source, and independently
> derived twice by the review crew): **write `o2w`, do not convert**; provider specifies
> **transform first, then reparent**.
>
> Consumed by **Plan 05.1-18**.

## Fix — was BLOCKED ON THE PROVIDER (corrected 2026-08-02, then SHIPPED — see banner above)

> **CORRECTION.** An earlier draft of this file said `object::setParentCell` is *"advertised but NOT
> bound"*. That is **FALSE and was verified false against the real contract.**
> `engine_hookpoints.inc:172` states it outright: *"addToWorld/removeFromWorld/**setParentCell** are
> VIRTUAL -> skipped in .cpp"*. **`setParentCell` is not in the advertised catalog at all.** Only
> `object::getParentCell` is (`engine_hookpoints.inc:178`) — and our agent does not bind that either.
> Do not plan agent-side work premised on the row existing.

**On the advertised client (swg-client-v2) this cannot be fixed agent-side.** It needs a provider
shim, same pattern and ABI discipline as `object::getContainingBuildingId` (v25) — which means a
cross-repo change request, a provider session, and an exe restage. Request filed:
`.planning/handoff/2026-08-02-CHANGE-REQUEST-object-setParentCell-v27.md`.

On **legacy SWGEmu** the capability does exist and is a harvest job, not research: Utinni binds
`Object::setParentCell 0x00B22C30` (`swg/object/object.cpp:140`) and `0x00555410` for the
ClientObject variant (`client_object.cpp:42`). That path belongs with Milestone 9 (SWGEmu parity),
not with 05.1.

Sequence to work out and verify live once the shim lands (do NOT assume the ordering):
1. Resolve the destination cell — `getContainingBuildingId` gives the building from an object, but
   teleport starts from raw coordinates, so the cell must come from somewhere else (candidate:
   pick/collide at the destination, or accept a cell id alongside the coords).
2. `setParentCell(player, cell)` and write the transform. Whether the transform should then be
   **cell-relative (o2p)** rather than world (o2w) is the open question — `object::getTransformO2P`
   exists for the read side, which suggests interiors are authored in parent space. **This question is
   posed directly to the provider in the change request**; it is not ours to settle by experiment,
   because guessing writes bad player state into a live client.

### What IS actionable on our side now (Plan 05.1-18)

- Bind `object::getParentCell` (advertised, unbound) for the **read** half.
- Carry a cell reference through the bookmark/teleport data path, pre-wired so it lights up when the
  provider ships the setter — the same pre-wire pattern that worked for `getContainingBuildingId`.
- Fix the second defect below, which is independent of the provider.

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

## ⚠ STATUS 2026-08-02: NEVER REPRODUCED under instrumentation — two targeted attempts failed

Do not treat this defect as established. It was reported twice at the 05.1-16 checkpoint and has
**never once been captured**.

**Attempt 1** (after "Reload current scene"): teleport worked normally. Expected — `wsUnloadSnapshot()`
+ `wsLoad()` never touches `GroundScene`/`Game::ms_scene`, so this path cannot reach the mechanism at
all. The original attribution of the defect to the reload button is very likely a mislabel of what
actually happened in that session.

**Attempt 2** (after "Load editor scene" — a genuine scene recreate): the player pointer DID change
across the swap (`2B018640 → 36C4EDD0`), which is the precondition the mechanism requires, and **all
seven subsequent writes landed exactly** (`now == wanted`). Caveat: the first click was 4.68 s after
`loadScene`, past any plausible use-after-free window — catching it by hand needs a click within
milliseconds of the swap.

**Consequence:** Plan 05.1-18 does NOT build a gate for this. It ships cheap always-on instrumentation
(player pointer + scene id on every write) so the next occurrence is diagnosable from the log alone —
or so the defect can be retired. An earlier plan draft specified an N-tick stability gate; that was
**cut** for gating the wrong trigger and for being built against something never observed.

## Leading hypothesis (mechanism REAL in source, but never observed live — see status above)

**Mechanism located in source 2026-08-02** (crew trace): `GameNetwork::startScene()`
(`GameNetwork.cpp:480-505`) does `delete gs` — destroying the old `GroundScene` and its player — **before**
the replacement is built via `Game::setScene(...)`. If scene creation is deferred behind a loading
cutscene (`Game.cpp:1826-1845`), `Game::ms_scene` keeps pointing at the freed object for a
non-deterministic, possibly multi-frame window, and `Game::getPlayer()` (`Game.cpp:2214-2217`)
`dynamic_cast`s through it. **The trigger is therefore scene RECREATION — not `wsLoad`.**

The original framing: `getPlayer()` briefly returns the **OLD, freed player** in the window right after
a reload, before the engine repoints its player global. Writing to it appears to succeed (freed memory is still writable)
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

## Disposition (maintainer decision, 2026-08-02)

**File the provider request now, build everything that is not blocked.** Plan **05.1-18** (inserted
ahead of Wave 3) does the agent-side half: the temporal gate for defect 2, the `getParentCell` read
binding, and the bookmark cell reference pre-wired against the not-yet-shipped setter. Plan 05.1-11
then builds bookmarks on top of it and is **not** hard-blocked on the provider — the cell field ships
inert and lights up on restage, so no bookmark schema migration is needed later.
