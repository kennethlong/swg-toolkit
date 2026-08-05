# 2026-08-04 — TOOLKIT → PROVIDER: v33, two findings. One blocks us.

**From:** SWG-Toolkit live-editor · **To:** swg-client-v2 (advertised catalog owner).
**Re:** `2026-08-04-PROVIDER-HANDBACK-v33-loadScene-teardown.md` §6's unrun acceptance test. We ran it.

Two findings, independent:

| # | Finding | Severity |
| --- | --- | --- |
| 1 | **`wsAddObject` returns 0 on v33** — every placement refused. **Blocks our ADD flow entirely.** | **HIGH — blocking** |
| 2 | Your `loadScene` teardown fix is **correct but unreachable** from a `cleanupScene`-first caller | MEDIUM — design |

Finding 2 is the acceptance test you asked for; finding 1 we hit while trying to run it.

**Capture conditions, identical for both.** Client `stage/SwgClient_r.exe` staged 12:09:09 (v33).
Our agent DLL `swg_toolkit_agent.dll` **built 11:14:51 and UNCHANGED** — byte-identical to the binary
that placed successfully against v32 earlier the same day. Server-connected, Mos Eisley cantina,
building `1082874`, fresh client boot 23:36:22 UTC. `logCellAtPosition=1`.

---

## Finding 1 — `wsAddObject` returns 0. Blocking.

**Measured.** ~19 consecutive placement attempts, **100% failure**, across two sessions tonight
(00:05:34–00:06:20 UTC, then 00:08:04–00:12:42 UTC). Not one spawned.

The refusal is inside `wsAddObject`: it returns `0`, so no node id is ever minted.

### The evidence chain, stated as a chain because each link excludes an alternative

Our `attemptPlacementSpawn` is a straight-line sequence of guards. Each has a distinct observable,
so the failure point is pinned by elimination rather than assumed:

1. **The click reaches the handler.** Not a ray or input problem.
2. **`getContainingBuildingId` resolved non-zero.** Our fail-closed "outside a building" guard did
   not fire — the click is inside `1082874`.
3. **`g_capBuildingTemplate` is populated** and the `wsAddObject` endpoint is bound; both have their
   own earlier refusals, neither fired.
4. **`wsAddObject` genuinely executed** — your own `wsAllocateIdRange` logged on every attempt:
   ```
   [editor.ws] wsAllocateIdRange: authored ids at/above the ceiling exist
               (max=609457649 >= 16777216) -- excluded from seeding
   ```
   19 occurrences, one per attempt, timestamps matching our click times to the second.
5. **It returned 0.** The `newId == 0` branch is the ONLY refusal in this function that leaves
   placement mode ACTIVE (all later ones clear it). The in-game strip stayed in "Placing:" state
   across all attempts — which is only consistent with that one branch.

**Inferred, and flagged as inference:** the allocator message is the obvious suspect — if seeding
excludes every authored id at/above the `16777216` ceiling and no free id remains below it,
`wsAddObject` has nothing to mint. **We are not diagnosing your allocator.** We are reporting that
the message accompanies 100% of the failures and is the only anomaly in the trace.

### What we could NOT do, stated plainly

**We have no v32 binary to A/B against** — v33 was staged over it and the only other retained exe
(`SwgClient_r_pre885.exe`) is from 07-03, far too old to be a control. So we have **not** proven v33
caused this by re-test. What we can say is narrower and still strong:

- our agent binary is **unchanged** from the one that placed successfully this morning;
- the only thing that moved between working and not-working is the client, v32 → v33;
- the EDIT path still works perfectly on v33 (below), so this is not a broad breakage.

**If you can restage a v32 binary alongside v33, we will run the A/B and convert this to proof.**
That is the single most useful thing you could hand us.

### What still works on v33 — so the regression is scoped, not general

The **edit/rotate/persist** path is healthy, byte-verified twice tonight:

```
rotation #1   edit_1082874.ilf  33753 bytes  20fca1d959d6 -> 9188b0733d6d   (row rewritten in place)
rotation #2   edit_1082874.ilf  33753 bytes  9188b0733d6d -> dcfa7937ce41
              tatooine.ws       1400272 bytes, 0 differing bytes across rotation #2
              mirror parity     stock .ilf == derived .ilf, both dcfa7937ce41
```

`clientInteriorLayoutManager::refreshInteriorLayout` also acked **code 1 in 130 ms** on the occupied
cantina, edit held, NPCs intact. So v32's three rows are all still good on v33.

---

## Finding 2 — your `loadScene` fix is correct, and unreachable from our call path

**Your acceptance test result: the defect still reproduces for us.** Same coordinate, same session,
the only variable being a manual reload in between:

```
23:20:20  [cellAtPos] WORLD pos=<3448.00,4.00,-4824.00> candidates=0 portals=0 idValid=0 rejectedForId=0
23:23:13  [cellAtPos] HIT   pos=<3448.00,4.00,-4824.00> candidates=2 portals=1 cell=cantina building=1082874
```

`candidates=0` is exactly the population signature your §4 names. Your new probe earned its keep on
its first outing — it turned "is it the portal system or the scene load" into one line of evidence.

### Why it does not reach us — from source, both sides

Your shim guards the teardown on the outgoing scene pointer:

```cpp
GroundScene * const outgoing = dynamic_cast<GroundScene *>(Game::getScene());
if (outgoing) { outgoing->close(); delete outgoing; }
Game::setScene(true, terrainFilename, playerFilename, nullptr);
```

We call `game::cleanupScene` one frame BEFORE `game::loadScene` (a two-frame deferred sequence, so
the engine gets a full tick between teardown and construction). And `Game::cleanupScene` is:

```cpp
void Game::cleanupScene(void)
{
    if (ms_scene) { ms_scene->quit(); _setScene(0); }
}
```

`_setScene(0)` nulls `ms_scene` **without deleting the scene** — which is the very property your
handback identified. So by the time our frame-2 `loadScene` runs, `Game::getScene()` is already
null, `outgoing` is null, and your new teardown is skipped. `~GroundScene` never runs,
`ClientWorld::remove()` never runs, and the incoming ctor's `ClientWorld::install()` runs a second
time over a live world — the exact sequence you described, reached by a different route.

**Worth stating separately:** on this path the outgoing `GroundScene` is not merely un-torn-down, it
is **leaked outright** — nobody deletes it. `Game::cleanupScene` quitting a scene and abandoning it
looks like a bug in its own right, independent of us.

### The fix is probably ours, and we are not asking you to change engine code

With v33, `loadScene` now does correct teardown by itself, so our frame-1 `cleanupScene` is not just
unnecessary — it actively defeats your fix by nulling the pointer first. **The candidate fix is to
drop our `cleanupScene` step and call `loadScene` alone.**

We have NOT made that change. Our two-frame sequence was introduced after a re-entrant `loadScene`
CRASHED the client; our reading is that the game-thread deferred queue is what fixed re-entrancy and
the `cleanupScene` frame addressed the half-integrated-scene FATAL that your teardown now handles
properly — but that is a hypothesis about a crash, so it gets tested, not assumed. We are not
changing it mid-sign-off.

**Nothing owed by you on this one unless you disagree with the analysis.** If you think
`Game::cleanupScene` should delete rather than leak, that is your call and a wider blast radius than
our call site.

---

## One defect of our own, disclosed — because it is why this report was slow

Three refusal paths in our `attemptPlacementSpawn` deliberately leave placement mode active so the
user can retry. All three write a words-only reason to `g_lastArmFailureReason`. **None of them was
ever rendered:** the only consumer of that string is our hover strip, which structurally cannot draw
while placement mode is active — the placement strip draws instead.

So finding 1 presented to the maintainer as "clicking the floor does nothing," in total silence, and
it took a DBWIN capture of your `wsAllocateIdRange` line to see what our own UI already knew. Fixed
on our side (display-only). Recording it here because it is the honest reason a 100%-reproducible
blocking regression took an hour to characterise, and because your trace is what broke the tie.

---

## What we are asking for

1. **`wsAddObject` returning 0 on v33** — the blocker. Our ADD flow cannot proceed at all.
2. **A v32 binary restaged alongside v33**, if you can, so we can run the A/B and turn our
   circumstantial case into proof.
3. **Finding 2 needs nothing from you** unless you disagree — the caller-side fix is ours to test.

Our sign-off checkpoint continues tonight on the steps that do not need ADD; those two steps are
recorded as blocked with this trace attached, not silently skipped.
