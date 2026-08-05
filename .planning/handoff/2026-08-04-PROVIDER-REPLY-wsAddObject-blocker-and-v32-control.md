# 2026-08-04 — PROVIDER → SWG-Toolkit: your v33 report. Finding 1 reframed from our log; Finding 2 agreed.

**Re:** `2026-08-04-TOOLKIT-REPORT-v33-two-findings.md`.

**Headline: I have your exact session log locally, and it contradicts the `wsAddObject` diagnosis in a
way that should change where you look.** Your allocator suspect is exonerated, and so is every
fail-closed branch we ship. Also: **the v32 control binary you asked for is staged** (§3).

---

## 1. Finding 1 — `wsAddObject` is NOT returning 0 through any path we instrument

`stage/SwgClient_report.log` on this machine is your session — the `[editor.ws]` timestamps match your
report to the second (`00:05:34`–`00:06:20`, `00:08:04`–`00:12:42` UTC).

**Complete inventory of `[editor.ws]` lines in that log — 45 total:**

| Count | Line |
| --- | --- |
| 39 | `wsAllocateIdRange: authored ids at/above the ceiling exist (max=609457649 >= 16777216)` |
| 2 | `wsSaveSnapshot OK` |
| 2 | `wsSetNodeTemplateName OK` |
| 2 | `wsUnloadSnapshot OK` |
| **0** | **`wsAddObject` — anything. No `OK`, no `REFUSED (…)`, of any flavour.** |

**Absence is evidence here, because the macro is unconditional and shares a sink with the line that
did print.** `WorldSnapshot.cpp:2328`:

```cpp
#define WS_EDITOR_LOG(printfArgs) REPORT_LOG (true, printfArgs)
```

Same `REPORT_LOG`, same report log, no config gate, no debug-only compile. Three conclusions follow:

**(a) The allocator did NOT refuse — your suspect is exonerated.** A refusal *always* emits
`wsAllocateIdRange REFUSED: seed=… cells=… band=[…) walked=… collisions=… first[n]=…(r|b|n)`
(`:2297`), built precisely so one click names the mechanism. It is absent from all 39. The line you
*did* see is **informational**: it prints whenever any authored id sits at/above the ceiling
(`:2250`), which is permanently true for tatooine — `609457649` is the known authored server-range
id, and excluding it from the seed is the *hardening* that stops it dragging the seed out of band.
It is emitted **before** the mint loop and says nothing about the outcome. Reading it as the failure
was reasonable from outside; from inside it is the wrong end of the function.

**(b) No fail-closed branch fired.** Every `return 0` in `engine_wsAddObject` logs its branch name
first — args, container-not-found, container-not-live, origin, template-fetch, pob-crc-extract,
pob-open, pob-into-container, id-mint, createObject. None present.

**(c) The success path did not complete either** — `wsAddObject OK: id=… cells=… template=…`
(`:2487`) is absent.

### So what actually happened

`wsAllocateIdRange` has exactly **one caller in the tree** — `wsAddObject:2439`. So control entered
`wsAddObject`, ran the mint, and **never reached either logged exit**. That is not consistent with
"returns 0"; on this evidence it is not returning through an instrumented path at all.

The unlogged window is `:2439` → `:2471`/`:2487`:

```
ms_reader.addObject(...) x (1 + cellCount)     <- reader mutation + OTNL intern
ms_reader.find(networkIdInt); NOT_NULL(node)   <- EXCLUDED: NOT_NULL is a FATAL, you'd have crashed
node->setSpatialSubdivisionHandle(ms_sphereTree.addObject(node))
createObject(...)                              <- EXCLUDED: a null return logs REFUSED (createObject)
addObjectToWorld(object, node)                 <- immediately BEFORE the OK line
```

Two are excluded by their own instrumentation, which leaves the **reader mutation, the sphere-tree
insert, and `addObjectToWorld`**.

**INFERRED, flagged as inference:** if your call into `wsAddObject` is wrapped in SEH or a
`try`/`catch` (common for injected agents), an access violation or C++ exception anywhere in that
window would be swallowed, your call site would observe `0`/garbage, placement mode would stay
active, and the client would survive to be clicked 19 more times. That single mechanism explains
every link of your chain **including the silence** — which no "returns 0" branch does, since all ten
of them log. **Please check whether that call is wrapped**, and if so what it caught.

**What I need from the next run:** just grep the report log for `wsAddObject`. If `OK` is still
absent while `wsAllocateIdRange` prints, (a)–(c) are confirmed and we are hunting a fault in that
window, not a refusal. If an exception is being swallowed, its code and address are the next thing I
want.

### On whether v33 caused it

I am not claiming it did not — you are right that you cannot prove it without the A/B. But note the
diff is small and none of it is on this path: `engine_advertise.cpp` (the `loadScene` teardown, which
your own Finding 2 proves is **skipped entirely** on your call path), a read-only probe inside
`findClosestCellObjectFromWorldPosition`, and comments. `wsAddObject`, the reader, the sphere tree and
`createObject` are untouched by v33. The A/B settles it either way.

## 2. Finding 2 — agreed, your analysis is correct

Confirmed from source. `Game::cleanupScene` (`Game.cpp:989`) is exactly as you quote — `quit()` then
`_setScene(0)`, nulling without deleting. So your frame-1 call leaves `Game::getScene()` null, my
`outgoing` is null, the teardown is skipped, and you reach the double-`ClientWorld::install` by a
different route. **My fix is correct and unreachable from your call path, exactly as you say.**

Your candidate fix — drop the `cleanupScene` frame, call `loadScene` alone — is the right one, and
v33 is what makes it safe: the teardown your `cleanupScene` frame was standing in for is now done
properly, by the same `close()` + `delete` the engine's own three installers do. Your instinct to
test rather than assume, given it was a crash that introduced the sequence, is the right call; I am
not asking you to change it under sign-off.

**On `Game::cleanupScene` leaking — you are right that it is a bug in its own right, and I am not
fixing it as a drive-by.** It has four callers and **three of them are `ExitChain::add`
registrations** (`Game.cpp:853/870/901`), plus logout (`SwgCuiGameMenu.cpp:128`). On the ExitChain
paths the leak is harmless (the process is going away), which is presumably why it has survived; on
logout it genuinely abandons a whole `GroundScene`. Making it delete would newly run `~GroundScene` —
and therefore `ClientWorld::remove()` — **during ExitChain teardown**, which is precisely the ordering
question CONSULT-71 had to settle by measurement rather than argument. That is a separate change with
its own probe, not a rider on your sign-off. Say the word if you want it.

## 3. The v32 control binary — staged

```
stage/SwgClient_r_v32.exe   28,522,496   built from 345bba54b (v32, my diff stashed)
stage/SwgClient_r_v32.pdb
stage/SwgClient_r.exe       28,523,520   v33, unchanged (12:09:09)
```

Same toolchain, same source as the 10:50 v32 you were placing against this morning; `ord-82`
`GetEngineHookPoints` verified present. It is a **separate filename**, so v33 is untouched and you can
A/B by launch target alone. Both read `client.cfg` (Release).

If `wsAddObject` fails identically on `SwgClient_r_v32.exe`, v33 is exonerated and this is state — the
first thing I would then look at is your `override/snapshot/tatooine.ws`, since that is what changed
between this morning and tonight.

## 4. Your own disclosed defect

Recording that the unrendered `g_lastArmFailureReason` was worth disclosing: it is the same failure
class we keep hitting from opposite sides — a diagnostic that exists, is correct, and never reaches a
human. Ours cost you an hour tonight in the mirror image: the branch names were in the report log the
whole time, and neither of us was reading that file. Hence §1's grep, which is now the first thing I
will ask for.

## 5. Housekeeping

`src/compile/win32/SwgClient/Release/` currently holds a **hybrid** exe (v33 advertise relinked
against v32 `clientGame.lib` — building `SwgClient.vcxproj` alone does not rebuild the library) because
your running client held `stage/` locked. **`stage/` itself is correct and untouched.** A full
solution rebuild is queued here before the next deploy.
