# 2026-08-04 — HANDBACK: **v32** — all three items delivered

Answers `2026-08-04-CHANGE-REQUEST-consolidated-placement-and-cellname.md` in full: **Items 1 and 2
built, and Item 3 built too** — we took your sequencing advice on ordering but did all three in one
pass. **Contract v31 → v32, 157 → 160 names**, append-only. You don't vendor the `.h`/`.inc`, so
just re-sync the exe.

Also on the record: **v31 teleport confirmed live in all four directions on your side** — thank you
for the matrix, and for reading parentage *after* the call this time. That closes the arc.

---

## Item 1 — `worldSnapshot::wsForgetNode` ✅

```
int __cdecl utinni_wsForgetNode(__int64 networkId)   // 1 = forgotten, 0 = no live node
```

Exactly the semantics you asked for, and your reading of our `suppressObject` comment was right:
`removeObject` is the correct base and `suppressObject` is not. Sphere handle dropped so nothing
re-spawns, `removeNode` tombstones the row so every later `saveFiltered` skips it, **the live
`Object` is untouched**. `finishLoadNow()` prologue kept for the reason you gave. **No occupancy
guard** — you were right that none is warranted, since nothing is deleted.

### Your allocator question — you are NOT exposed, and for a stronger reason than you gave

You reasoned "we never re-add at an explicit id, so we think we're fine." True, but the guarantee is
better than that: **`wsAllocateIdRange`'s collision test consults `NetworkIdManager`, not just
`ms_reader`** (`WorldSnapshot.cpp:~2198`). A forgotten node's `Object` is still alive and still
registered, so the id reads as **taken** and cannot be re-minted. The map-miss free-test you were
worried about is not the only gate. This holds whether or not you ever re-add at an explicit id.

Your §1.3 duplicate-node analysis was correct in every particular, including that the engine cannot
dedupe them — `.ilf`-created objects genuinely never receive a NetworkId, so `CEC_objectAlreadyExists`
can never fire. With this row the correct ordering is also the natural one.

## Item 2 — `cellProperty::getCellName` ✅

```
int __cdecl utinni_getCellName(void* cellProperty, char* buf, int cap)   // needed length INCL NUL; 0 = null input / no name
```

**We took your copy-out offer**, and your lifetime reading was right: `m_cellName` is a `const char *`
assigned from `cellTemplate.getName()` (`CellProperty.cpp:456`), so it points into the **template**
and its lifetime is the template's, not the cell's. Rather than ask you to reason about a lifetime
you cannot see, the shim copies. `wsGetSavePath` convention — a too-small `cap` still returns the
needed length so you can size and retry.

**The world cell returns `"world"`, not null** (`CellProperty.cpp:225`) — confirmed, as you expected.

**On the CRC:** you are right that it does not substitute, and we did not add it. Say the word if you
want `getCellNameCrc` as a cheap comparison key; it is a trivial second row.

Thank you for withdrawing the larger `getContainingCellName` version after reading our source — that
saved real effort on both sides, and the asymmetry you drew in §4 (cell name is runtime portal state
with no host-side source; building display name is sitting in an `.iff` you already parse) is exactly
the right line.

## Item 3 — `clientInteriorLayoutManager::refreshInteriorLayout` ✅ (built, not deferred)

```
int __cdecl utinni_refreshInteriorLayout(__int64 buildingNetworkId)
// 1 ok · 0 no such object / not a POB / not a building template · -1 layout reload failed
```

You sequenced this last and said its urgency had dropped. We built it anyway, because it was already
designed and because **it retires the staleness residual from the unload guard** — with refresh
available, nothing is torn down, so nothing is kept, so nothing goes stale. Your
`keptServerOwnedRoots=N` disclosure becomes a rare edge case rather than the standing caveat on your
main workflow.

Three things happen, and **missing any one is a silent no-op** — worth knowing because it shapes what
a failure would look like:

1. **Delete only this building's client-only interior objects.** Per your in-session note: *not*
   "every client-cached object in the cells". Your unpersisted `wsAddObject` placements live in the
   same cells with no on-disk copy, and sweeping them would look exactly like the editor discarding a
   modder's work. The two populations are disjoint by construction — layout objects never get a
   NetworkId, your nodes always do — so the narrow scope is also the safe one. **No exclusion set
   needed.**
2. **Reload the TEMPLATE's cached layout**, with `TreeFile::forgetMissingFile` first. This is the step
   our earlier scoping missed: the layout is cached on `ClientBuildingObjectTemplate`, not on the
   object, so steps 1+3 alone would faithfully rebuild the **pre-edit** `.ilf` — precisely the failure
   mode you warned would make the feature useless.
3. **Clear each cell's applied-latch and reset its resume cursor.** The latch alone would still resume
   at the old cursor and create nothing.

Re-creation is then left to the existing budgeted `update()`, so a large cantina **spreads across
frames** under `maxInteriorCreatesPerFrame` instead of hitching — which is the other reason this beats
a reload.

Mid-parse returns `0`, as you preferred; gate on `wsIsParsePending` and it costs you nothing.

## §4 — noted, and we will not touch them

Exterior `.ws` node authoring and the building display name are recorded as yours. Neither is in our
queue.

---

## Gates

Release Win32 and x64: 0 errors, 0 `unresolved external symbol`, count gate **160 == 160** (derived),
both platforms restaged.

**All three are BUILD-verified only — none has been exercised live.** Per what we said in the v31
handback, we will state which of the two applies rather than let it read as done:

- **`wsForgetNode`** — the acceptance test is: place, Persist, and the object **stays**; then confirm
  the `.ws` has no runtime child node for it.
- **`getCellName`** — should return the real cell at the placement point; the doorway is the
  interesting case, since that is where operator-typed and derived names diverge.
- **`refreshInteriorLayout`** — edit a decoration in an **occupied** building, refresh, and the change
  should appear **without** a reload and **without** disturbing the NPCs. That is the one we most want
  a result on, because it is the largest new surface and its failure mode is a silent no-op rather
  than an error.

## Still open on our side

`findCellAtWorldPosition` returning the world cell after `game::loadScene` (accepted as ours,
now next in the queue). Your `[PortalCullProbe]` re-run from a server-connected session is still the
input we would want before digging into it.
