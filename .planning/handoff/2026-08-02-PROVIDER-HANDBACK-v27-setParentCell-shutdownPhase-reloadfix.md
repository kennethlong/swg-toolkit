# 2026-08-02 — HANDBACK: contract **v25 → v27** (+2 rows) and the lossy-reload defect FIXED

**Pushed.** `origin/master` = `96e20b5aa`. Four commits:

| Commit | What |
| --- | --- |
| `18a919e36` | v26 — `game::getShutdownPhase` |
| `04c3f8e11` | **fix** — WorldSnapshot phased parse pumped every frame (the lossy reload) |
| `b9363b5b0` | v27 — `object::setParentCell` + `cellProperty::getWorldCellProperty` |
| `96e20b5aa` | shutdown-phase transition logging (v26 now measured, not inferred) |

**Contract: v27, 150 names**, strictly append-only — no existing row moved, renamed, or
changed semantics.

```
engine_hookpoints.h    ea298bafd823aaa4738b7d9b100a20360c6f657f58e6d829b2c45df05f928639
engine_hookpoints.inc  d4a9b2fab6779b5b3ac06f184fb16a3ec48ecb258a6d34a960c71c4497e815ae
```

Staged both platforms: `stage/SwgClient_r.exe` (Win32, `516abc87e80b…`) ·
`stage-x64/SwgClient_r.exe` (`7697777728bd…`).

---

## 1. The lossy reload is OURS and it is FIXED — hold your Plan 12/15 rewording

Your §5a (`reload-scene-is-lossy.md`) is a defect in the engine, not in your usage.

`WorldSnapshot::loadStep()` had exactly **one** call site outside `finishLoadNow()`, and it
sat inside `GroundScene::updateLoading()` — which opens with `if (!m_loading) return;`.
Once you are in-world that function is dead, and the budgeted parse pump dies with it.

So `wsUnloadSnapshot()` + `load(getSceneId())` **issued in-world** sets
`ms_parsePending = true` and starts a phased parse that **nothing will ever pump**, while
`WorldSnapshot::update()` returns immediately at its `if (ms_parsePending) return;` guard.
Hence: no buildings, no collision, no snapshot creatures — indefinitely.

**This also explains the part that misled you.** "Everything returned AT ONCE after moving
around" was not movement. **11 advertised rows force `finishLoadNow()`** (the Goal B
node-read contract — `wsGetNodeInfo`, `isClientCached`, `moveObject`, `removeObject`, …).
Any panel refresh, hover or pick that touched one drained the entire parse synchronously in
a single call; the next `update()` — sentinels already dirtied by `load()` — then created
everything in one burst. **Buildout and authored content returning in the same instant is
the expected signature of that, not evidence against a buildout/authored split.** Your
ruling-out of that hypothesis was correct but for a different reason than you recorded.

**Fix (`04c3f8e11`):** the pump is hoisted into `GroundScene::update` — `updateLoading()`'s
single call site, per-frame. *Moved, not duplicated*, so the loading-screen pump rate is
unchanged at one call/frame; `loadStep()` self-early-outs when no parse is pending, so it is
free in the normal case. The invariant is now "a pending parse always progresses" rather
than "a pending parse progresses only while a loading screen happens to exist."

> ⚠ **ACTION: do not reword the Plan 12 / Plan 15 checkpoints yet.** Your §5a proposes
> designing those steps *around* the lossy reload. If this fix holds, that rewording
> encodes a bug that no longer exists. **Re-test first**, on the restaged exe.
>
> **This fix is NOT field-verified.** The mechanism is convicted from source and the
> evidence fit is exact, but the acceptance test — a live in-world "Reload current scene"
> that comes back intact — is yours to run. Please report the result either way.

Secondary, now expected to disappear with it: post-reload collision loss made placement
clicks resolve to building id `0` and refuse. Right behavior, wrong cause.

---

## 2. v27 — `object::setParentCell` + `cellProperty::getWorldCellProperty`

Both asks granted as specified. Your reading of the ABI position was correct.

**`object::setParentCell`** — `int __cdecl utinni_setParentCell(void* object, void* cellProperty)`.
Virtual (`Object.h:168`) → shim mandatory. `1` ok / `0` refused. Borrowed consumer-held
pointers, game-thread-only, no consumer-side dereference needed.

> **The null guard is load-bearing, not cosmetic.** `Object::setParentCell` `NOT_NULL`s its
> argument (`Object.cpp:1389`) — a null cell is a **FATAL**, not a graceful refusal. The shim
> returns `0` before ever reaching it.

**`cellProperty::getWorldCellProperty`** — plain constant `&fn` row, **no shim**. It is
out-of-line (`CellProperty.h:78` / `CellProperty.cpp:308`), so your guess at the
`cuiPreferences::getAllowTargetAnything` pattern was right. **It is REQUIRED, not a
convenience:** since null FATALs, this is the only way to express "reparent out to the
exterior."

### 2a. The two questions you refused to guess at — both verified in source

**(a) o2p or o2w after reparenting? → Write `o2w`. Do NOT convert.** Your reading was
correct, and there are two independent mechanisms, not one:

- `attachToObject_w` (`Object.cpp:1956`) derives parent-space from the *current world frame*
  (`rotate_w2o` / `rotateTranslate_w2o`) — it preserves world and computes o2p itself.
- `setTransform_o2w` (`Object.cpp:1450`) is **itself cell-aware**: world-cell parent →
  straight `setTransform_o2p`; otherwise it inverts the cell owner's o2w and back-converts.
  So it is correct under either parentage.

**(b) Ordering? → Write the transform FIRST, then reparent.** You were right to ask: the two
orders are *not* equivalent.

- *Reparent-then-write* → `attachToObject_w` snapshots the **old** world position into the new
  cell, then `cellChanged(false)` fires (`:1408`) **while the object is still physically at
  its origin location**. The very bookkeeping you are fixing observes an inconsistent state.
- *Write-then-reparent* → the position is already the destination when `cellChanged` fires.

*Caveat for the scene-load case:* write-then-reparent converts through the **source** cell's
transform. If the player is already in the world cell there it takes the direct branch and
is clean either way; if the source cell is being torn down, reparent to
`getWorldCellProperty()` first, then write, then reparent to the destination.

### 2b. Scoped against placement routing, not just teleport

Your change request framed this as teleport. The maintainer's actual goal (your own §4, and
confirmed to us directly) is **placement routing** — *"standing in the cantina doorway, place
outside → `.ws`; place inside → `.ilf`; the object position determines it."* The row
comments and the v27 version block are written against that, with **the doorway as the
stated acceptance test in both directions**. Worth restating in your plans: the container
comes from the **placement point**, and `setParentCell` is what makes a newly placed interior
object actually *live* in that cell rather than merely sit inside it geometrically.

---

## 3. v26 — `game::getShutdownPhase` (and it is now MEASURED)

Process-wide **monotonic** int, read via an advertised accessor:
`0` running · `1` quit requested · `2` `ExitChain` unwinding.
**Consumer rule: `>=1` stop queueing new work; `>=2` issue no advertised calls at all.**

Safe to call from **any thread at any time**, including during teardown and CRT exit — a
plain `volatile int` load with no locks and no dependent subsystem state. That is the point:

- **`ExitChain::isRunning()` is structurally unusable** for this — it reads `PerThreadData`,
  i.e. **per-thread** state. A consumer polling from its own thread always sees `false`; the
  one thread it is true for is the thread blocked inside teardown, which cannot answer.
- **`game::g_runningFlags` (`&Game::isOver`) goes unsafe exactly when you need it** — it
  dereferences `IoWinManager`/`Os` state.

**Verified by measurement** (`96e20b5aa`), on a real `WM_CLOSE`:

```
20260802224705 [shutdown] phase 0 -> 1
20260802224705 [shutdown] phase 1 -> 2
```

The intermediate `1` is the result. `Game::quit()` is **not** called on a window close —
`isOver()` goes true via `!IoWinManager::haveWindow()`, which never touches `ms_done`. A
first implementation raised phase 1 only at the `ms_done` sites and would have logged a bare
`0 -> 2`, i.e. **no early-warning edge on the most common exit path in the client**. Caught
before shipping; the raise now sits after the `while (!isOver())` loop in `Game::run`, the
one funnel every exit path provably crosses.

**You are not blocked on v27 to start using this**, and one clarification: `game::isOver` is
**already advertised as `game::g_runningFlags`** — you have had the early signal since v25.
What v26 adds is safety *during* teardown.

**No push event.** `getShutdownPhase` is a poll. If your agent needs to be *woken* rather
than sampled, say so — an event + bounded quiesce ack is designed and costed but deliberately
not built, because it would have falsified the v26 record you had already built against.

---

## 4. Gates run

Release **Win32** and **x64**: 0 errors, **0 `unresolved external symbol`** (the `/FORCE`
masking check) · `GetEngineHookPoints` **ord-82, undecorated** · count gate **150 == 150**
(derived `sizeof/sizeof` vs the `.inc` X-macro — no hand-typed number to drift) · boot smoke
on the Win32 exe carrying all four changes: booted to login, closed gracefully via `WM_CLOSE`,
no dumps.

Not covered by any gate, stated plainly: **the reload fix (§1) has never been observed
working**, and `setParentCell` has not been exercised live. Both are consumer-side tests.

## 5. Maintainer checklist

1. Re-sync the two `.h`/`.inc` files byte-identically (sha256s above); rebuild the agent
   `rva_table`.
2. Bind `object::setParentCell` + `cellProperty::getWorldCellProperty` (your 05.1-18 slots).
3. **Re-test the in-world reload BEFORE rewording Plan 12/15** (§1).
4. Teleport smoke: write o2w → reparent → confirm interiors render solid from inside, both
   directions through the doorway.
5. Optional: bump your agent's `ENGINE_HOOKPOINTS_VERSION` (declared `6`) to silence the
   permanent mismatch warning — you bind by name, so it is noise, not risk.
