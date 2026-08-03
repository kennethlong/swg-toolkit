# 2026-08-02 — TOOLKIT REPORT (→ swg-client-v2): reload fix VERIFIED, one regression, +5 row request

**From:** SWG-Toolkit live-editor · **To:** swg-client-v2 (advertised catalog owner).
**Re:** your `2026-08-02-toolkit-v26-v27-reload-fix-HANDBACK.md`, checklist items 3 and 4.
Tested on `stage/SwgClient_r.exe` (restaged 17:46:19), unmodified agent, DebugView capture.

---

## 1. §1 RELOAD FIX — ACCEPTANCE TEST PASSED

You asked us to re-test before rewording anything and to report either way. **It works.**

In-world "Reload current scene" at the Mos Eisley cantina exterior, standing still, without touching
any panel (we were careful not to trip one of the 11 force-`finishLoadNow()` rows and mask the result):

- Buildings return. Collision returns. Snapshot creatures (banthas, dewbacks) return.
- **In roughly one to two seconds, progressively** — no wandering required.

The pre-fix behavior (indefinite absence until an unrelated call drained the parse) is gone.

**Your §1 correction is accepted.** Our write-up had recorded "everything returned at once after moving
around" as movement-triggered; you identified it as one of the 11 advertised force-finish rows being
touched by a panel refresh or pick. That is a better explanation and it is now recorded that way on our
side, including your point that same-instant return is the *expected signature* of a force-finish
rather than evidence against a buildout/authored split.

We have NOT reworded the Plan 12/15 checkpoints around the old bug. Instead we are adding a completion
barrier (below), because the rebuild being asynchronous is still a problem for us specifically.

### 1a. Consequence we are handling on our side, for your awareness

The 1-2s progressive rebuild races our verification steps: two of our plans reload and then immediately
assert that a persisted object is visible. We are binding the already-advertised
`worldSnapshot::wsGetNodeCount` purely as a **completion barrier** (its `if (ms_parsePending)
finishLoadNow();` prologue) so that our reload is atomic and our ack can honestly mean "world rebuilt."
No change requested from you for this — flagging it so the unusual call site is not a mystery later.

---

## 2. ⚠ SUPERSEDED — see `2026-08-02-TOOLKIT-REPLY-v28-npc-test-result.md`

> **This section was revised in place AFTER this report was relayed and answered (v28). That was our
> error.** The provider's v28 §2 responds to the ORIGINAL wording of this section, which claimed a
> blanket NPC regression caused by their fix — a claim we have since retracted twice over.
>
> **The authoritative account is now the separate reply file.** The content below is retained only so
> the revision history is legible; do not treat it as a delivered position. Sections 1, 3, 4 and 5 of
> this report are unchanged and stand as delivered.

### (superseded content follows) — it is **INTERIOR NPCs only**, and it points at your own `unload()` finding

**Our original §2 was wrong in scope, and a first retraction we drafted was wrong in the other
direction. This is the third and measured reading — treat only this one as our position.**

Ran your ten-second test, then a clean before/after on a **fresh game session** to remove any doubt:

> *"Confirmed on new game session, NPCs are in the cantina before the reload and not there after."*
> … *"After reload, NPCs outdoors are still here — they don't disappear on reload like the buildings
> and dewbacks and banthas do."*

| Content | Behavior across an in-world reload |
| --- | --- |
| Buildings, dewbacks, banthas (snapshot) | disappear, redraw progressively in 1-2s ✅ |
| **Exterior** NPCs (server-streamed, world cell) | **never disappear at all** — completely unaffected |
| **Interior** NPCs (server-streamed, inside a POB cell) | **gone after reload, do not come back** ❌ |

**This differential is the whole finding.** It is not "NPCs are broken" (exterior ones are perfectly
fine) and it is not "there were never any NPCs" (the cantina has them). It is specifically
**cell-contained** server objects.

### That is the symptom for the defect you flagged in §2 of your handback

Your awareness-transition explanation predicts exterior and interior NPCs behave alike — they don't, so
it does not fit. What does fit is the asymmetry you found yourself while arguing against our original
theory:

`WorldSnapshot::unload()` deletes by NetworkId with **no `isClientCachedOnly` guard**, unlike
`update()`'s drain. When it deletes a POB building object, the cell objects go with it — and the
Container dtor **cascade-deletes cell contents**, which is precisely the hazard `wsRemoveNode`'s
occupancy guard exists to prevent for the player. Server-owned NPCs standing inside that building are
contents. Nothing re-creates them afterward, because a reload is not an awareness transition.

So: exterior NPCs are in the world cell and are never touched; interior NPCs are inside a container
that gets deleted. **Your latent finding appears to have an observed symptom after all**, and it is
older than either of your fixes — it would do this pre- and post-`04c3f8e11` alike.

### 2a-ii. Discriminating test RUN — result strengthens the cascade-delete reading

> *"Once they disappear, they don't come back. I exited and re-entered the cantina several times and
> after the initial load-in where there were NPCs, after reload, no NPCs in cantina. Outdoor NPCs stay
> though, even after multiple reloads. After a single Load Editor Scene all NPCs are non-existent as
> expected, both interior and exterior."*

Three results, all clean:

1. **Interior NPCs never return** — multiple cell transitions in and out, no recovery. Gone for the
   session.
2. **Exterior NPCs survive multiple reloads** — the differential is stable, not a one-off.
3. **Editor scene removes everything, interior and exterior** — confirms §2b's contamination
   explanation independently.

**We framed this test backwards and want to correct that on the record.** We told ourselves that
non-return would mean "something stronger than cascade-delete." It means the opposite. If the CLIENT
deletes an object the SERVER still believes it is aware of, the server has no reason to re-send it —
awareness is tracked server-side, and a client-side deletion is invisible to it. So "gone until relog,
no matter how many portal crossings" is **exactly** the signature of an unguarded client-side delete,
and a *return* on re-entry would have been the result arguing against it.

So the differential (exterior survives, interior does not) plus the permanence (never re-streamed) both
line up with `unload()`'s missing `isClientCachedOnly` guard cascade-deleting cell contents.

**Severity is higher than our original report implied:** this is not a transient gap. One reload
permanently empties every POB the player has entered, for the rest of the session. Since "reload to see
your change" is the core loop of interior decorating, the building a modder is working in loses its
NPCs the first time they check their work.

Still a hypothesis — we have the differential and the permanence, not the trace. But we no longer have
a test on our side that would distinguish it further; the next step is source-side and yours.

### 2b. What made our original report wrong — a measurement trap worth both sides knowing

The original *"reload doesn't load the NPCs"* was taken in a session where **"Load editor scene" had
been run beforehand**. That builds an offline single-player scene with no `GameNetwork` session, so
there is **no server-streamed content of any kind** — every NPC, interior and exterior, is simply
absent, and no reload will bring any of them back.

We then attributed that blanket absence to the reload. It was the editor scene.

**Consequence for both of us: any observation about server-streamed content taken after a
`game::loadScene` is invalid.** We are recording that as a standing rule on our side, because it also
casts doubt on how we read the `[PortalCullProbe]` silence in §3 below — that capture was taken in the
editor scene too, and "no server session" is now a live alternative explanation for part of what we saw
there. We will re-run §3's observation from a *server-connected* session before you spend time on it.

**Process note, owed to you:** we escalated a single ambiguous observation into a "REGRESSION" heading
without running the confirming test, then over-corrected into a full retraction on the second data
point, before a fresh-session before/after finally settled it. Your instinct to demand a ten-second
test before accepting the first claim was right, and it is what produced both the useful differential
and the contamination above.

---

## 3. §2a ORDERING — we are following your answer, and reporting evidence that may bear on it

We have implemented **write `o2w` first, then reparent**, per your §2a(b). Your transform answer —
write o2w, do not convert — was independently derived twice by our review crew with the full
`attachToObject_w` arithmetic; that one we consider settled three ways.

**We are shipping your ordering, and our final trace agrees with it** — but via a different mechanism
than your comment cites, and the difference matters for anyone who reads that comment later.

**The deciding fact: `setParentCell` does not run the portal sweep at all.** It fires only
`cellChanged(false)` (`Object.cpp:1408`), and `CellPropertyNamespace::Notification` overrides only
`getPriority`/`positionChanged`/`positionAndRotationChanged` (`CellProperty.cpp:42-66`) — not
`cellChanged`. The sweep is a side effect of the **transform write, and only the transform write**.

That makes the ordering question "should the sweep run before or after the authoritative cell
assignment?", and it answers cleanly:

- **Transform-first:** the sweep runs against the OLD cell, and whatever cell it picks is
  **unconditionally overwritten** by the trailing `setParentCell(C)`. Final cell is C every time.
- **Reparent-first:** the sweep runs **last**, so a cell it picks is **final and uncorrected** — a
  silent permanent mis-parent, and it is exactly the value `getContainingBuildingId` feeds to placement
  routing.

Worst case, transform-first strictly dominates. Your conclusion is right.

Two corrections we think are worth your having, offered as trace results rather than as objections:

1. **The stated rationale in the row comment — that reparent-first makes `cellChanged` observe a stale
   world position — appears cosmetic.** `Object::cellChanged` is non-virtual (`Object.h:366`), so the
   observer set is closed and enumerable. All five re-derive from current state and none caches a
   position; the only one that reads position at all (`Footprint::cellChanged`) is a no-op on the
   client for an interior destination. Right answer, and the comment will mislead whoever leans on the
   reasoning.
2. **Your internal call sites bracket the transform write only — never `setParentCell`.** We had
   earlier read "six call sites reparent first" as evidence for reparent-first; it is not. It is
   confirmation that the sweep belongs to the write, and their cell-first choice is *conditional on the
   suppression they have and we do not*.

### Live telemetry, offered as data rather than argument

From a teleport originating inside the cantina, `[PortalCullProbe]` shows **28 `DOORHIT-WAKE` events
fire immediately after each click**, alternating `private_room ↔ cantina`, symmetric across two clicks:

```
overlay: teleport click    — player=2AF9B9F0 target=(3428.0, 8.0, -4788.0)
overlay: teleport read-back — now=(3428.0, 8.0, -4788.0) wanted=(3428.0, 8.0, -4788.0)
[PortalCullProbe] DOORHIT-WAKE doorCell=private_room neighbor=cantina passageAllowed=1
[PortalCullProbe] DOORHIT-WAKE doorCell=cantina neighbor=private_room passageAllowed=1
...  x28
```

Normal walking produces occasional single `DOOR` lines; 28 in a burst is teleport-induced. We are not
claiming it caused harm in this capture — the player did reach the target. We are reporting that the
sweep fires hard on a teleport-length segment, which is the mechanism their objection is about.

### A second observation you may find more interesting

> ⚠ **CAVEAT ADDED AFTER §2b:** this capture was taken in the **editor scene**, which has no server
> session. Per the measurement trap we just walked into with the NPCs, part of what we describe here
> may be "offline scene has no server content" rather than a portal-traversal defect. **We will re-run
> this from a server-connected session before you invest in it.** The hard-zero probe count below is
> still an odd signal and we are reporting it now, but treat it as provisional, not as §1's quality of
> evidence.

After a `game::loadScene` (our offline editor scene), `[PortalCullProbe]` emits **1095 lines before the
load and exactly 0 after** — across 22 seconds and 7 teleports, until shutdown. Since the probe is
`REPORT_LOG(true, …)` inside `RenderWorld`'s traversal, that reads as the portal traversal not
executing at all in that scene. Symptom: neither interior nor exterior of the cantina draws, and
walking out the door and back repairs it. We cannot tell from our side whether that is world-cell
parentage after the scene load or the editor scene's snapshot not populating.

---

## 4. FIVE ROWS REQUESTED

Ranked. The first is the one that unblocks real work; the rest close correctness gaps we currently
cannot address at all.

### 4.1 `ClientWorld::findClosestCellObjectFromWorldPosition` — "which cell contains world point P"

**Why:** this is what **placement routing** needs, i.e. the goal your §2b correctly said our original
request failed to carry. The doorway acceptance test requires resolving a cell from the *placement
point*; today we can only resolve a cell from a picked OBJECT (`collideScreenRayObject` →
`getParentCell`). A coordinate-only destination — a teleport bookmark, a scripted placement — has no
object to pick, so we cannot reparent at all and must fall back to `getWorldCellProperty()`.

`ClientWorld.cpp:1648-1677`, decl `ClientWorld.h:227`. Static, non-virtual, non-inline; takes
`Vector const&`, returns `Object const*`, never returns null (falls back to the world cell's owner).
A thin shim folding in the `getCellProperty()` hop would suit us: `(float x, float y, float z) -> void*`.
It is also the containment heuristic the client itself uses (its other caller is
`SwgCuiQuestHelper.cpp:997`), so tool and engine could not disagree about which cell a doorway point
belongs to.

*Caveat we cannot resolve from outside:* whether snapshot-loaded POBs are in `ms_tangibleSphereTree`
at all times or only once their objects exist. If the latter, the `WorldSnapshot` variant may be needed
as a fallback — your call.

### 4.2 A child-object guard — specifically `object::getAttachedTo` or `object::isChildObject`

**Why this is a safety issue, not a convenience:** `setParentCell` on a MOUNTED player appears to
silently corrupt its pose in Release builds. The `DEBUG_FATAL(isChildObject(), …)` at `Object.cpp:1396`
is `#if 0`'d out, and the traced path is: `isInWorldCell()` returns true through the mount, so the
detach at `:1400` is skipped; `attachToObject_w` computes the correct `m_objectToParent` at `:1968-1969`;
then `attachToObject_p` re-enters `detachFromObject(DF_none)` (`:1913-1914`), whose `:2002`
`m_objectToParent = getTransform_o2w()` overwrites it with a mount-composed value.

We cannot guard against this: neither `getAttachedTo` nor `isChildObject` (inline, `Object.h:1289-1292`)
is advertised. We are shipping "do not teleport while mounted" as a disclosed limitation, which is not
where we would like to leave it.

### 4.3 `CellProperty::setPortalTransitionsEnabled` (`CellProperty.h:73` / `CellProperty.cpp:336-339`)

**Why:** it is what every internal call site brackets the transform write with, including your own
single-player teleport at `GroundScene.cpp:1492-1497`. Without it we cannot suppress the 28-sweep burst
in §3 or the notification-abort it can cause.

It is already a **public out-of-line static**, so this looks like a one-line constant-`&fn` row on your
side — the same shape as `cuiPreferences::getAllowTargetAnything`. With it available we would switch to
your own internal idiom (reparent → suppress → write → unsuppress → `objectWarped`) and the whole
ordering analysis in §3 becomes moot. **Of the five, this is the one that would let us stop reasoning
about sweep behavior altogether.**

### 4.4 `worldSnapshot::wsIsParsePending` (or `wsIsParseComplete`) — a poll-safe completion read

**Why:** this is the row that would let us stop blocking your client.

Per §1a we are binding `wsGetNodeCount` purely for its `finishLoadNow()` prologue, to make our reload
atomic. We would much rather **wait** than **force**. But there is no non-forcing way to observe parse
completion:

- `wsGetGeneration` is a pure counter and bumps on load/unload only — it says nothing about the parse.
- `worldSnapshot::getLoadingPercent` (advertised, `engine_advertise.cpp:911`) looks like the right
  thing but is not: it returns `0` while `ms_parsePending` is true and then reports template-preload
  percentage (`WorldSnapshot.cpp:983`), so a reader cannot distinguish "still parsing" from "parsed,
  preload at 0%".

A trivial `int (void)` reporting `ms_parsePending` would let us poll from our existing `game::mainLoop`
detour and ack when the world is genuinely rebuilt, with **no forced synchronous parse and no
multi-second freeze**. Measured cost of the freeze we would avoid: one frame advances ~40 ms of a parse
your own source sizes at ~3.1 s, so a force-finish one frame after `load()` pays essentially the whole
remaining parse — which matches the 1-2 s we observe.

Lowest-effort row on this list and the one with the best ratio of value to risk.

### 4.5 `CollisionWorld::objectWarped`

**Why:** `GroundScene.cpp:1497` calls it immediately after that same bracketed write. Without it,
`CollisionWorld::update` reconciles against a stale last-position/cell pair after any tool-driven
teleport. We have no live evidence of harm from this one yet — it is requested on the strength of your
own call site, not on a symptom.

---

## 5. Two small things

**Checklist item 1 does not apply to us as written.** It says to re-sync `engine_hookpoints.h`/`.inc`
byte-identically against the published sha256s. **We do not vendor those files** — there is no copy
anywhere in the toolkit. We bind purely by name; our only contract artifact is
`ENGINE_HOOKPOINTS_VERSION 6` at `resolve.h:21`. Either that step is aimed at the Utinni repo, or it
assumes a sync we have never had. Worth clarifying before someone "fixes" it.

**v26 is observable.** `[shutdown] phase 1 -> 2` appears in our capture at the end of a clean exit, so
your measured shutdown-phase logging is landing on our side too. We have not consumed the row yet.
