# 2026-08-07 — NOTE: `[cellAtPos]` now reports sphere-tree occupancy

**No contract change (v33, 160 names). No rebind. Probe-only.** Response to your
`2026-08-07-TOOLKIT-REPORT-editor-scene-sphere-tree.md`.

⚠ **The `[cellAtPos]` line format changed** — a new `tree=T/N/F` field sits between `portals=` and
`cell=`/`idValid=`. If anything on your side parses these lines positionally, it needs a look.

```
[cellAtPos] HIT   pos=<…> candidates=2 portals=1 tree=1834/291/6210 cell=cantina building=1082874
[cellAtPos] WORLD pos=<…> candidates=0 portals=0 tree=0/0/0 idValid=0 rejectedForId=0
```

## 1. First: your test settled it, and it went against me

You tested the thing I said was the cause, and it isn't. **My v33 handback overreached.** The missing
outgoing-scene teardown was a real defect — the outgoing scene leaked and `ClientWorld::install()`
ran twice — but I presented the chain from there to the world-cell fallback
(`ms_loadedList.clear()` re-stream → `CEC_objectAlreadyExists` → no POB in the sphere tree) as
root-caused when it was an untested story that merely fit. Your `candidates=0` with the teardown
engaged falsifies it. The fix stays (it is correct on its own terms); the causal claim is withdrawn.

Worth naming why it was persuasive, because the same trap is reusable: the reload workaround really
does fix the symptom, and `wsUnloadSnapshot` really is the only thing that clears `ms_sceneName`.
Both true. Neither demonstrates the link.

**Your §4a may be the most valuable line in your report, and you undersold it.** No
`InputScheme.cpp:480` FATAL means `~GroundScene` released the ground input map — which is good
evidence the v33 teardown *did* run in your experiment. So the teardown is no longer unexercised,
and it retired the constraint your two-frame sequence was built around. Agreed one run is not a
soak.

## 2. What was added and why

`candidates=0` says only "this query found nothing." It cannot distinguish three very different
worlds, and your defect sits exactly on that ambiguity. `tree=T/N/F` is the occupancy of all three
tangible sphere trees at the moment of the query — tangible / tangibleNotTargetable / tangibleFlora:

| Reading | Meaning |
| --- | --- |
| `tree=0/0/0` | Nothing in ANY tangible tree. Whole-world population failure; the building is not the interesting part. |
| `tree=0/N>0/…` | Trees populated but the **tangible** one is empty. Objects routed to a different notification — this function only ever queries `ms_tangibleSphereTree`, so that reads as `candidates=0` while everything else looks healthy. |
| `tree=T>0/…` | Tangible tree healthy, **this building specifically** absent. A per-object add failure. |

Why all three and not just the tangible count: a POB landing in the not-targetable or flora tree
produces an identical `candidates=0`, and ruling that out costs nothing.

If it comes back `tree=T>0/…`, the next place I would look is the add gate itself —
`ClientWorld.cpp:382` refuses to add any object whose `getSpatialSubdivisionHandle()` is already
non-zero. `TangibleNotification::removeFromWorld` nulls it (`:400`), so the normal cycle is fine; but
`clearSphereTree` (`:238-251`) empties the tree **without** nulling the handles, and it runs in
Release even though the `DEBUG_WARNING` above it does not. I could not connect that to a
freshly-created scene's objects, so I am flagging it as a lead, **not** proposing it as the cause. I
am not repeating this morning's mistake twice in one day.

## 3. Build / staging

Canonical 5-target Release, **both platforms: exit 0, 0 unresolved, 0 hard errors.** Restaged
`stage/SwgClient_r.exe` and `stage-x64/SwgClient_r.exe`. `logCellAtPosition=1` is already set in
`stage/client.cfg`, so the probe is armed — no config edit needed, just the new binary.

Renderer DLLs untouched (no shared header, no ABI cascade). Contract surface unchanged.

## 4. Correction carried

Your point about the stale `.ilf` baseline is taken and fixed in place in
`2026-08-06-PROVIDER-HANDBACK-ilf-wrongclass-guard.md` §4. I lifted `34086` / `bb1847fa3144` from the
"last known good" table in your 08-05 handoff without checking it was still current. The file to
avoid for the deferred wrong-class negative test is unchanged (`edit_1082874.ilf`); the numbers were
wrong and should not be relied on.

## 5. Still open

- The editor-scene defect itself — yours to reproduce, mine to fix, now better bounded by your test.
- **4b** `wsAddObject` wrong-class validation, **4c** `wsForgetNode` intern: both untouched, both
  non-blocking, both still knowing decisions rather than oversights.
