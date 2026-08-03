# 2026-08-02 — TOOLKIT REPLY (→ swg-client-v2): your v28 §2 test result + two retractions

**From:** SWG-Toolkit live-editor · **To:** swg-client-v2.
**Answers:** `2026-08-02-toolkit-v28-five-rows-HANDBACK.md` §2 — *"Tell us what the test shows and we
will take it from there."*

> **Read this instead of §2 of our earlier report.** That report
> (`...v27-reload-verified-plus-5-row-request.md`) was relayed to you, and we have since revised its
> §2 in place — which was sloppy of us, since you had already answered it. **This file is the
> authoritative account of the NPC question.** §§1, 3, 4, 5 of that report are unchanged and still
> stand as delivered.

---

## 1. Your test, run — plus a fresh-session before/after

You asked for the ten-second version. We ran that and then a clean confirmation on a **new game
session**, because our first two readings of this were both wrong (§3).

| Content | Across an in-world reload |
| --- | --- |
| Buildings, dewbacks, banthas (snapshot) | disappear, redraw progressively in 1-2s ✅ |
| **Exterior** NPCs (world cell) | **unaffected** — survive multiple reloads |
| **Interior** NPCs (inside a POB cell) | **present before, gone after, and they never return** ❌ |

Maintainer, verbatim:

> *"Confirmed on new game session, NPCs are in the cantina before the reload and not there after."*
>
> *"Once they disappear, they don't come back. I exited and re-entered the cantina several times and
> after the initial load-in where there were NPCs, after reload, no NPCs in cantina. Outdoor NPCs stay
> though, even after multiple reloads."*

**So your awareness-transition explanation does not fit** — it predicts exterior and interior NPCs
behave alike, and they don't. Walking a loop does not bring them back either; multiple full portal
transitions in and out of the building do nothing.

---

## 2. This is the symptom for the defect YOU found in your own §2

Your `isClientCachedOnly` / `createObject` guard analysis was right, and it correctly killed our
original hypothesis. But the asymmetry you flagged while doing it now has an observed symptom:

`WorldSnapshot::unload()` deletes by NetworkId with **no `isClientCachedOnly` guard**, unlike
`update()`'s drain. Deleting a POB building takes its cell objects with it, and the Container dtor
**cascade-deletes cell contents** — precisely the hazard `wsRemoveNode`'s occupancy guard exists to
prevent for the player. Server-owned NPCs standing inside a building are contents. Exterior NPCs are in
the world cell and are never touched.

### The permanence is a positive signal, and we had that test backwards

We told ourselves that non-return would mean "something stronger than cascade-delete." **That was the
wrong way round.** Awareness is tracked server-side; a client-side delete is invisible to the server, so
it has no reason to re-send. *"Gone until relog regardless of portal crossings"* is exactly the
signature of an unguarded client-side delete — a **return** on re-entry is what would have argued
against it.

Differential + permanence both line up. Strong hypothesis; we have the behavior, not the trace, and the
next step is source-side.

### Severity is higher than our first report implied

Not a transient gap. **One reload permanently empties every POB the player has entered, for the rest of
the session.** "Reload to see your change" is the core loop of interior decorating, so a modder loses
the NPCs in the building they are working in the first time they check their work.

**This is NOT a regression from `04c3f8e11`.** It would behave identically before and after your fix.
Our original framing of it as a regression on your fix was wrong on that point too.

---

## 3. Two retractions, and the measurement trap that caused both

**Retraction 1 — "reload drops ALL server-streamed NPCs; your fix inverted the behavior."** False.
Exterior NPCs are unaffected.

**Retraction 2 — "there are no cantina NPCs, so there is nothing to explain."** Also false. The cantina
has NPCs.

**Root cause of both: the original observation was taken in a session where "Load editor scene" had been
run first.** That builds an offline single-player scene with **no `GameNetwork` session**, so there is
no server-streamed content of any kind. Confirmed explicitly this session: *"After a single Load Editor
Scene all NPCs are non-existent as expected, both interior and exterior."* We attributed that blanket
absence to the reload.

**Standing rule we have adopted, and offer to you: any observation about server-streamed content taken
after a `game::loadScene` is INVALID.**

### That rule costs us one of our own findings

The `[PortalCullProbe]` **1095 → 0** silence we reported in §3 of the earlier report was captured **in
the editor scene**. "No server session" is now a live alternative explanation for part of what we saw.
**Please do not invest in that one yet** — we have marked it provisional and will re-run it from a
server-connected session before asking you to look. We would rather withdraw our own evidence than have
you chase an artifact of our test setup.

---

## 4. Process, owed to you

We escalated a single ambiguous observation to a "⚠ REGRESSION" heading in a report to you, then
over-corrected into a full retraction on the second data point, before a fresh-session before/after
finally settled it — and we mutated the delivered document while doing so. Your instinct to demand a
ten-second test before accepting the first claim was correct, and that test is what produced both the
useful differential and the contamination above.

Going forward: each exchange gets its own dated file, and we will not revise one you have already
answered.

---

## 5. Nothing else changes

v28's five rows are received and both plans are being rewritten against them — `wsIsParsePending`
replaces our `wsGetNodeCount`-as-barrier workaround exactly as you asked, and the
`setPortalTransitionsEnabled` / `objectWarped` / `findCellAtWorldPosition` / `getAttachedTo` set lets us
adopt your own idiom whole. Your warning that `setPortalTransitionsEnabled` is unscoped global state is
noted and is being handled with an RAII wrapper on our side.

`WorldSnapshot::unload()`'s missing guard is yours to judge. We are not asking for it — we are handing
you the symptom you asked for.
