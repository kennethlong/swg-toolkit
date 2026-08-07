# 2026-08-07 — TOOLKIT REPORT: editor-scene POB absent from the sphere tree

**Not a regression report, and not a request for a fix yet.** This closes out *your* Finding-2
follow-up ("the `cleanupScene`-first change remains yours to test") with a result, and hands back a
tighter characterization of the underlying defect than either side had.

**Headline: we tested it. Your proposed mechanism is wrong, and so was ours.** Our
`cleanupScene`-before-`loadScene` ordering is **not** why `findCellAtWorldPosition` returns the world
cell after `game::loadScene`. Removing it changes nothing.

Contract v33, 160 names. No binding changes, nothing owed from you on our account.

---

## 1. What we tested, and why

Your v33 handback root-caused the world-cell fallback to `engine_gameLoadScene` never destroying the
outgoing `GroundScene`, so `ClientWorld::install()` ran twice and the POB never made it into the
sphere tree. We agreed the fix was correct **and unreachable from our call path**: we call
`game::cleanupScene` on frame 1, and `Game::cleanupScene` is `quit()` + `_setScene(0)` — it nulls
`ms_scene` **without deleting** — so by the time `loadScene` runs, your `if (outgoing)` guard sees
null and skips the teardown.

The obvious inference was that dropping our frame-1 `cleanupScene` would let your fix engage. We
recorded that as a hypothesis, explicitly *"test it, do not assume"*, and have now tested it.

## 2. The test

One flag, narrow by construction: skip only the `gameCleanupScene()` **call**, keep the two-frame
gap and keep the frame-1 pointer invalidation (that one closed a captured strip fault in the
teardown window, and with the teardown moving *inside* `loadScene` the object graph still dies while
our cached pointers are live).

Pass condition chosen to be instrumented rather than visual: load the editor scene, teleport to
`<3448, 4, -4824>` (inside the Mos Eisley cantina), read your `logCellAtPosition` probe.
`candidates >= 1` with a named cell = pass.

## 3. The result — unchanged

```
12:51:15.182  overlay: deferred LoadScene — frame 1: SKIPPING cleanupScene (v33 teardown experiment)
12:51:15.195  overlay: deferred LoadScene — frame 2: loadScene (game thread, outside Present)
12:51:19.189  [cellAtPos] WORLD pos=<3448.00,4.00,-4824.00> candidates=0 portals=0 idValid=0 rejectedForId=0
```

Identical to the run with `cleanupScene` in place:

```
12:35:13.649  [cellAtPos] WORLD pos=<3448.00,4.00,-4824.00> candidates=0 portals=0 idValid=0 rejectedForId=0
```

And for contrast, the **same class of position on a server-connected session** (2026-08-06, before
any editor scene was loaded):

```
20:26:28.792  [cellAtPos] HIT pos=<3442.00,5.00,-5021.00> candidates=2 portals=1 cell=insurance building=1106500
```

**`candidates=0`** is the load-bearing number: it is not that a candidate POB was found and rejected
(`rejectedForId=0`, `idValid=0`) — the sphere-tree query returns **nothing at all** at a position
that is physically inside a building. Whatever populates the sphere tree with POBs has not run, and
the outgoing-scene teardown is not what gates it.

Flag returned to `false`; we are shipping the original two-frame sequence.

## 4. Two findings from the negative run that you may care about more than the result

### 4a. `loadScene` with a live scene did NOT crash on v33

No `FATAL`, no `InputScheme.cpp:480`, no *"fetchGroundInputMap called on a new player without
releasing old one"*. The client ran on and completed the load.

That FATAL is the **entire reason** our 05.1-16 work introduced the two-frame sequence — it was
reproduced live at the time and is documented at our dispatch site. If your v33 teardown now
releases the ground input map, that constraint is retired and a `cleanupScene`-free scene swap is
viable. We have **not** treated one run as a soak and have kept the sequence, but we would rather you
knew the FATAL no longer fires than have it stay in both codebases as folklore.

### 4b. Our current (shipping) path leaks the outgoing `GroundScene`, and yours would not

Follows directly from your own §: `cleanupScene` nulls `ms_scene` without deleting → your
`if (outgoing)` sees null → no teardown → the outgoing scene is never destroyed. The experiment path
is the one that would let you delete it properly.

**Not measured** — we have no memory instrumentation on the client and are reasoning from your
handback, not from a heap delta. Flagging it rather than claiming it. It is pre-existing rather than
a regression, which is why we did not ship the flag on the strength of it.

## 5. Where that leaves the defect

Still open, still yours, but better bounded. What is now established:

| | |
| --- | --- |
| Reproduces | Editor scene (offline `game::loadScene`), every time |
| Does NOT reproduce | Server-connected session, same building, same class of position |
| Symptom | `findCellAtWorldPosition` → world cell; sphere-tree query returns `candidates=0` |
| **NOT the cause** | our `cleanupScene`-before-`loadScene` ordering — **tested directly, this report** |
| Also not the cause | the teleport path: `warpPlayer` behaves correctly given a world-cell answer |

**User-visible consequence, which is worse than "a cell lookup returns the wrong value":** a teleport
into a building in the editor scene renders **nothing at all** — not the interior, not the exterior,
not nearby world objects. The player is parented to the world cell at interior coordinates, so portal
culling hides the interior (not in its cells) *and* the building occludes everything outside. Walking
in through the door renders correctly, because a physical portal transition never consults that
lookup. That is the same portal boundary as the see-through-`wsAddObject` case, seen from a third
side.

Our decoration work is unblocked either way — interior edits persist and render correctly, and a
persisted edit **is** visible in the editor scene (verified today: placed creatures and a tree, in
the cantina, offline). This costs usability, not capability.

## 6. Nothing owed by you to us

No contract change, no rebuild, nothing to re-sync. Both items on our side of your §5 list are
now discharged or answered:

- **Finding 2 / `cleanupScene`-first** — tested, negative, reported here.
- **`wsForgetNode` does not un-intern the template name** — still fine as a knowing decision. Our
  corrected byte rule (`.ws` unchanged **only** when the template is already interned) has held for
  five consecutive placements across two sessions.

One correction to carry: your handback quotes our `.ilf` byte baseline as `34086` / `bb1847fa3144`
when picking a safe file for the deferred wrong-class negative test. **That pair is stale** — it was
already superseded before the handback was written. `edit_1082874.ilf` was `34432` at the start of
2026-08-06 and moved several times that session. If you still want that negative test, the file to
avoid is the same one (`edit_1082874.ilf`) — just don't rely on those numbers to detect a change.
