# 2026-08-07 — HANDBACK: editor-scene world loss FIXED (sphere-index re-arm)

**Pushed.** **No contract change — still v33 / 160 names.** Nothing to re-sync, no rebind, no version
bump. Engine-internal fix plus three new log lines.

**Your `Reload scene` is no longer load-bearing.** An editor scene entered after a server login now
comes up fully populated. Please stop treating the reload as a required step — and see §5, because
that button has a data-loss footgun we deliberately did not paper over.

---

## 1. What was actually wrong — two mechanisms, not one

Your report ("editor-scene POB absent from the sphere tree", `tree=1/0/9` vs `228/458/0`) was right
that this was whole-world, not per-object. The cause was two separate things, both correct in
isolation, both wrong on re-entry:

1. **STRIPPED (class 1).** `WorldSnapshot::suppressObject` drops a node's sphere handle when the
   server streams a POB the snapshot already spawned — correct, the server copy supersedes ours. A
   failed create (`:1373-1375`, typically `CEC_objectAlreadyExists`) strips it too.
2. **NEVER INDEXED (class 2).** The `PP_sphereTree` gate (`:1034-1040`) skips buildout POB roots
   entirely when **not** single-player, because the server was going to stream them.

Then `game::loadScene` re-enters the **same terrain name**, `WorldSnapshot::load` early-returns at
`:676-680` **before any re-parse**, and `ms_sceneName` is only ever cleared by
`engine_wsUnloadSnapshot`. So both populations stay out of the index, and offline nothing will ever
stream them. **Class 2 is what emptied the city; class 1 removed individual authored buildings.**

That distinction is why the obvious fix would have failed: undoing only the strips restores 322
nodes and leaves the 27 buildout roots missing — i.e. Mos Eisley still broken. The fix instead
**re-evaluates the gate under the current mode**, which reproduces exactly what a fresh-process parse
would have indexed.

## 2. The fix

In `WorldSnapshot::load`'s same-scene early-return branch, after the prologue: walk the root nodes
and re-index anything with a zero handle that the gate (re-evaluated live) says belongs. Guards, each
load-bearing:

- **`!isDeleted()`** — `removeNode` tombstones a node *in place*, zeroing the handle **and the network
  id** while leaving it in the node list, so it still enumerates. Arming those would inject id-0
  phantoms into the spawn set.
- **root indices only** — child nodes are never sphere-tree indexed; they spawn via parent recursion.
- **skipped entirely while `ms_parsePending`** — `PP_sphereTree` does not test `handle == 0` before
  `addObject`, so arming ahead of an in-flight parse would double-insert.
- **`ms_eventObjectMap` cleared** to match `unload()`, so a re-entered scene re-defers event objects
  rather than accumulating duplicates.

While connected it is a near no-op: nodes that legitimately failed the gate stay suppressed.

## 3. Live verification (maintainer, gl11)

Log in → walk Mos Eisley → **Editor scene ▸**, no reload:

```
[ws.load] same-scene re-arm: 322 stripped + 27 buildout node(s) re-indexed (singlePlayer=1, scene=tatooine)
```

| | |
| --- | --- |
| Re-armed | 322 stripped + 27 buildout = 349 nodes |
| Strips accounted for | 288 `suppressObject` + 34 failed creates = **exactly 322** |
| `createObject FAILED` **after** the re-arm | **0** |
| `suppressObject` **after** the re-arm | **0** |

Cantina present, interior edits intact, no reload. The zero on that third row is the one that
mattered: had any NetworkId survived the outgoing-scene teardown, all 349 would have failed
`objectAlreadyExists` and been stripped straight back out — an empty city indistinguishable from the
unfixed bug. Measured, not assumed.

Also now quantified for the first time: **a normal login session silently strips 288 snapshot
nodes.**

## 4. Three new log lines you will see

All `REPORT_LOG` — they survive Release, which is the whole point; every failure mode here was
previously invisible in the only build anyone runs.

- **`[ws.load] same-scene re-arm: N stripped + M buildout …`** — once per same-scene re-entry.
  Silence after an editor load means the re-arm did not fire.
- **`[editor.ws] suppressObject: id=… handle dropped`** — the strip that cost us a day. It used to
  happen in total silence in every build.
- **`[editor.ws] createObject FAILED: id=… reason=… — node dropped from sphere tree`** — a permanent
  strip whose every diagnostic was previously a `DEBUG_WARNING`, i.e. nothing in Release.

Expect a burst of the middle one during login and the last one during a hybrid session; both are
normal. What is **not** normal is either appearing *after* a re-arm line.

## 5. Why not a forced re-parse — and a claim of ours CORRECTED

We considered fixing this by forcing a full re-parse on every `loadScene` (what SwgGodClient, Utinni
and your reload all do) and rejected it. The reasons that stand:

- **~3.1 s of parse on every editor scene load**, on your hot loop.
- **It walks straight into the CONSULT-71 kept-root residual** on every editor load after a connected
  session: the guard leaves server-owned POB roots alive, the re-parsed node then fails create and is
  stripped, and the building shows stale/absent state until a zone change.
- **Id-allocator hazard**: the mint's free-test is a reader map-miss, so a cleared `ms_reader` makes
  just-minted ids look free.
- All three existing tools expose that rebuild as an **explicit user action**, never implicit.

> ⚠ **CORRECTED 2026-08-07 (maintainer).** An earlier version of this section also claimed the
> re-parse would "silently discard a modder's unsaved placements", and warned that your `Reload
> scene` button is a data-loss footgun needing a save prompt. **That overstated it and the warning is
> withdrawn.** The toolkit persists to disk immediately when the user presses persist, so there is no
> long-lived accumulation of unpersisted objects — the exposure is bounded by whatever has happened
> since the last persist, which the user controls, not a session's worth of work.
>
> What remains true at code level: `unload()` does call `ms_reader.clear()` (`:639-640`), and
> mutations do live in `ms_reader` until `wsSaveSnapshot`. What was wrong was inferring a workflow
> hazard from that capability without checking how your persist actually behaves. No action needed on
> your side; the reasons above are sufficient on their own to keep the fix surgical.

## 6. Corrections carried

- **The v33 `loadScene` teardown story is withdrawn** (already noted 2026-08-07 AM). The missing
  teardown was a real defect — leak plus double `ClientWorld::install()` — but it was **not** the
  cause of the world-cell fallback. Your test killed it. Your §4a was also right and undersold: the
  absent `InputScheme.cpp:480` FATAL is good evidence the v33 teardown *did* run and retired the
  constraint your two-frame sequence was built around.
- The player-at-origin streaming theory that briefly replaced it is **also dead**, refuted from your
  own log (103 s inside the cantina with no create, while a control building healed in 6 s).

## 7. Still open

- **4b** — `wsAddObject` executes text on a wrong-class-but-existing template. Untouched, non-blocking.
- **4c** — `wsForgetNode` does not un-intern the template name. Untouched, still a knowing decision.
- Your **teleport-lands-somewhere-else** observation after an editor scene load (vs after a reload) is
  recorded but not investigated. It may simply dissolve now that the world is populated and
  `findCellAtWorldPosition` returns a real cell — worth re-checking before either of us spends time on
  it.
