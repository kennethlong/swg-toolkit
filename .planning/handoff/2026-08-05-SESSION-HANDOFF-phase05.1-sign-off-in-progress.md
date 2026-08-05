# 2026-08-05 — SESSION HANDOFF: Phase 05.1 at 17/18, sign-off checkpoint 3/13 steps passed

**Read this first.** Written after a long live session (2026-08-04 evening into 08-05). Everything
below is committed. Supersedes `2026-08-04-SESSION-HANDOFF-phase05.1-wave3-to-wave5.md`.

---

## 1. Status

| | |
| --- | --- |
| Phase | `05.1-live-world-editor-productization` — **17 of 18 plans complete** |
| Remaining | **05.1-15** only (phase close). Task 1 DONE; Task 2 is the 13-step live checkpoint, **3 steps passed** |
| Branch | `main`, clean, **not pushed** |
| Provider contract | **v33** (160 names, unchanged from v32). Control binary `stage/SwgClient_r_v32.exe` also staged |
| Agent DLL | rebuilt 3× last session; current build has the SEH-detail capture. **x86 Release**, `packages/live-inject/agent/build-agent/` |
| Suites | renderer **834 pass**, root aggregate **742 + 2 skipped**, `tsc --noEmit` clean |

**Checkpoint progress (05.1-15 Task 2):**

| Step | State |
| --- | --- |
| 1 — SC5 rotation persist | ✅ **PASS** — byte-verified twice, `refreshInteriorLayout` ack 1, rotation held, NPCs intact |
| 2, 3, 4 — sketch diffs (019-A, 020-A, 021-A) | not started |
| 5 — editor-scene verify | not started — **see §4, do it LAST** |
| 6 — ADD round trip + `(NEW)` + deferred toast | ✅ **PASS** |
| 7 — refusal paths (7a/7b/7c) | ✅ **PASS** |
| 8, 9, 10, 11 | not started |
| 12 — gap ledger | pre-filled, see the worksheet |
| 13 — maintainer annotations | drafted paste-ready, see the worksheet |

**Working document: `.planning/phases/05.1-live-world-editor-productization/05.1-15-CHECKPOINT-WORKSHEET.md`.**
It holds the running order, the pre-filled step-12 ledger (a)–(n) with code citations, and the
paste-ready step-13 annotation text for D-02/D-03/D-06/D-09/D-12. **Amend it as steps land** — it is
the artifact that survives, not this conversation.

---

## 2. The v33 investigation — read this before touching placement

This consumed most of the session and **the conclusion reversed twice**. The final answer is short:
**a substring in our own template filter.** The long version matters because the reasoning is
reusable.

### What happened

Placement failed 100% of ~19 attempts, silently — clicking the floor did nothing, no message.

1. **First conclusion (WRONG):** `wsAddObject` returns 0 on v33. Filed as a blocking provider
   regression. Reasoned by elimination: it was the only refusal branch that leaves placement mode
   active, which matched the observed state.
2. **Provider refuted it from their own instrumentation.** Every `return 0` branch in
   `engine_wsAddObject` logs its branch name; the success line logs too; **none appeared**. Their
   `wsAllocateIdRange` line — which I had wrongly suspected as the failure — is informational and
   permanently true for tatooine. They predicted the real mechanism before we found it: an exception
   swallowed by an SEH wrapper in our agent.
3. **They staged a v32 control binary within the hour.** v32 faulted **identically**. Swapping in a
   pre-corruption `.ws` also faulted identically. **v33 exonerated, snapshot exonerated.**
4. **Final answer:** our decoration picker filtered VFS paths with a *substring* test for
   `/furniture/`, which matched `object/draft_schematic/furniture/*` — **crafting schematics**. We
   were asking the client to build a schematic as a world prop.

### Why it took four hours — three layers of silence

- **Our agent's outer SEH handler swallowed the AV** (`hkSwapChainPresent` wraps `renderFrame()`,
  and the placement click runs inside it). Frame skipped, `g_placementActive` never cleared, client
  survives to be clicked again.
- **Our own rate limiter hid the log line** — first 5 verbatim, then every 50th. The first five were
  spent before tracing began.
- **Three of `attemptPlacementSpawn`'s refusal paths wrote a reason nothing rendered.** Fixed
  (`dda0edd`) — see §3.

### The engine has NO Release-mode guard below our filter

`ClientInteriorLayoutManager.cpp:143-161`:

```cpp
ClientObject * const interiorObject = safe_cast<ClientObject *>(ObjectTemplateList::createObject(name));
if (interiorObject) { ... setParentCell ... addToWorld(); }
else DEBUG_WARNING(true, ("...invalid interior object template name...Object will be skipped."));
```

`safe_cast` is unchecked in Release; the "will be skipped" diagnostic is a `DEBUG_WARNING`, compiled
out. A wrong-class template that creates non-null yields a bad pointer and the next virtual call
crashes. **Our filter IS the guard.** Do not loosen it casually.

Worse: a bad row **persisted into an `.ilf` crashes on every subsequent load of that building**, not
just at placement. Verified nothing poisoned reached ours — the placements died before persisting.

### The filter, and the todo that supersedes it

Ground truth, all 51 distinct templates in the real `edit_1082874.ilf`:

```
29  object/static/       item 21, structure 7, creature 1
20  object/tangible/     furniture 14, instrument 4, speaker 1, microphone 1
 2  object/soundobject/
```

Current allowlist is those three **top-level** prefixes, anchored at path start, `.iff` required.
It was wrong twice: originally a substring (admitted schematics), then `object/tangible/furniture/`
(dropped the cantina's own band gear — instrument/speaker/microphone).

**The path-prefix approach is fundamentally an approximation.** The engine's real rule is *"does
`ObjectTemplateList::createObject` return something that IS-A `ClientObject`"* — a **type** property.
Every prefix list will keep needing widening as new buildings surface new classes. **Todo: validate
by reading the candidate template's own IFF type from the VFS.** Filed at
`.planning/todos/pending/` (see §6).

---

## 3. Fixes shipped last session

| Commit | What |
| --- | --- |
| `184b33a` | `find-live-mapping.ps1` died on `STATUS_MORE_ENTRIES` (0x105 — a **success** status meaning "partial batch, call again") instead of paging. Only ever worked while `BaseNamedObjects` fit one 64 KB buffer; several client restarts in a session break that. |
| `dda0edd` | **Placement refusals were invisible.** Three paths in `attemptPlacementSpawn` deliberately stay in placement mode and set `g_lastArmFailureReason` — but the only renderer of that string was the hover strip, which structurally cannot draw while `g_placementActive`. Now rendered on the placement strip, on its own line (a first attempt used `SameLine()` and pushed the text off-screen — the strip is `AlwaysAutoResize`, centre-pivoted). **Live-verified by checkpoint step 7a.** |
| `7097014` | **SEH detail capture.** Both handlers discarded the exception. Now record code, faulting address, owning module + RVA, and for an AV the read/write/DEP operation and inaccessible address. This is what broke the investigation open. |
| `c7a9209`, `1493033` | The decoration filter (§2). |

---

## 4. Provider state — nothing owed by us, one thing owed by them

Four documents last session, in order. **All are filed to `swg-client-v2/.planning/handoff/`,
untracked; the maintainer relays.**

| Ours | Their inbox filename |
| --- | --- |
| `2026-08-04-TOOLKIT-REPORT-v33-two-findings.md` | `...-v33-wsAddObject-BLOCKER-and-loadScene-callpath.md` |
| `2026-08-04-TOOLKIT-CORRECTION-wsAddObject-is-ours.md` | `...-wsAddObject-STAND-DOWN-correction.md` |
| `2026-08-04-TOOLKIT-CONFIRM-wsAddObject-closed-ours.md` | `...-wsAddObject-CONFIRMED-ours-closed.md` |

Their reply is at `2026-08-04-PROVIDER-REPLY-wsAddObject-blocker-and-v32-control.md`.

**Two non-blocking items we raised, both explicitly their call:** `wsAddObject` executes text rather
than refusing when handed a wrong-class template; and the same unguarded shape in
`ClientInteriorLayoutManager.cpp:143`, where the consequence is worse (load-time crash).

### Finding 2 — agreed by both sides, and OUR fix to make

Their v33 `loadScene` teardown fix is **correct and unreachable from our call path**. We call
`game::cleanupScene` on frame 1, and `Game::cleanupScene` is `quit()` + `_setScene(0)` — it nulls
`ms_scene` **without deleting**. So their `if (outgoing)` guard sees null, skips the teardown, and
the incoming `GroundScene` ctor double-runs `ClientWorld::install()` over a live world. The outgoing
scene is also **leaked outright**.

**Candidate fix (ours, UNTESTED): drop the frame-1 `cleanupScene` and call `loadScene` alone** — v33
now does correct teardown itself. NOT done, because the two-frame sequence was introduced after a
re-entrant `loadScene` CRASHED the client (05.1-16). The reading is that the game-thread deferred
queue fixed re-entrancy and the `cleanupScene` frame covered the half-integrated-scene FATAL that
v33 now handles — but that is a hypothesis about a crash. **Test it, do not assume it.**

**⚠ Consequence for checkpoint step 5:** the editor-scene defect (`findCellAtWorldPosition` returns
the world cell) **still reproduces on our path**. Verified with their new `[cellAtPos]` probe:

```
23:20:20  WORLD pos=<3448.00,4.00,-4824.00> candidates=0     (after loadScene)
23:23:13  HIT   pos=<3448.00,4.00,-4824.00> candidates=2 cell=cantina building=1082874   (after manual reload)
```

**So step 5 still goes LAST**, or relog after it — any ADD following a `loadScene` derives
`cellName: "world"`.

---

## 5. Byte-verification rules — one CORRECTED

The old handoff said: *"a placement grows both `.ilf` files by one NODE and leaves `.ws` unchanged;
84 bytes of `.ws` growth means the duplicate-node defect is back."* **The `.ws` half was
over-generalised** — it came from a single observation that happened to place an already-present
template.

**Corrected rule:**

- **`.ilf`** — both files (stock mirror + derived) grow by **one NODE per placement** and stay
  byte-identical to each other while mirror is ON. An EDIT (rotate/move) rewrites a row **in place**:
  size unchanged, md5 moves.
- **`.ws`** — unchanged **only when the placed template is already interned in that snapshot**. A
  template novel to the snapshot grows it by exactly **`strlen(templatePath) + 1`** — the name
  interned into the template-name table. `wsForgetNode` drops the node but not the intern.
  - Positive case: `object/static/creature/shared_endor_roba.iff` (44 chars) → `.ws` +45.
  - Negative case: palm + R5 droid, both already in Tatooine's snapshot → `.ws` size unchanged.
  - **Still a defect: an 84-byte NODE appearing in `.ws`.** That is the duplicate-node class.
- A `.ws` **size change also moves bytes at offset ~8** — that is the outer IFF `FORM` length field.
  Expected, not content drift.

Verified session values (last known good):
```
edit_1082874.ilf / shared_..._tatooine.ilf   34086 bytes   md5 bb1847fa3144  (identical, mirror ON)
snapshot/tatooine.ws                       1400317 bytes   md5 f53feb0f317b
```

---

## 6. Open items

**Blocking nothing, but must not be lost:**

1. **Template validation by IFF type, not path prefix** (§2). The principled fix.
2. **`cleanupScene`-first change** (§4) — test, do not assume.
3. **Three UI findings**, all "works correctly, communicates poorly":
   - `Editor scene ▸` sits flush above `Reload scene`, identical styling, and one silently drops you
     offline into a possibly-unpopulated world. Cost a detour last session.
   - The `+ Add decoration…` precondition is invisible — the hint says *what* but not *where*, and
     the control that satisfies it is a tree selection in another region.
   - `Place here` fails silently with no ray sample (`overlay.cpp:813` bare `return`); right-click is
     unbound and silent; the strip hint says "click floor = place" without saying **left**.
4. **`kStripMessageHoldSec` is 2 s** — brief for the placement strip, where a refusal leaves the user
   stuck indefinitely. Left at the shared constant deliberately (the hover strip uses it too).
5. **`ENGINE_HOOKPOINTS_VERSION` still 32** while the client is v33. Soft warning only, resolves by
   name, no rebuild needed — deliberately not bumped mid-checkpoint.
6. **Step 6's toast copy not explicitly verified** — timing confirmed, but nobody read the
   wrong-room warning naming the cell. Check next time it fires.
7. **`logCellAtPosition=1` left enabled** in `stage/client.cfg` (`[ClientGame/ClientWorld]`, a
   section this session added). Set to 0 when done diagnosing.

---

## 7. Environment / tooling

- **DBWIN capture.** The agent's `dbg()` is `OutputDebugStringA` — DebugView-only. A capture script
  at `<scratchpad>/capture-dbwin.ps1` reads the DBWIN protocol to a file. **Only one capturer
  system-wide**: DebugView must be closed. Invaluable; consider promoting it to
  `packages/harness/scripts/`.
- **Byte controls** in `<scratchpad>/ctl/` — `tatooine.ws.step1`, `.step6`, `.SUSPECT-tonight`,
  `edit_1082874.ilf.step1`. **Lesson: snapshot the FILE, not just its hash.** A hash-only baseline
  cost a wrong "nothing was written" call when a persist landed between the hash and the check.
- **Client binaries:** `stage/SwgClient_r.exe` (v33), `stage/SwgClient_r_v32.exe` (control).
- **Mapping:** `find-live-mapping.ps1` then `drive-host-command.ps1`. Regenerated per attach.
- **Verify the agent is the CURRENT build:** the DLL is locked while loaded, so if a rebuild
  succeeds, nothing had it mapped. `Get-Process().Modules` is unreliable for a 32-bit target from
  64-bit PowerShell — do not trust it saying "not injected".

---

## 8. Method notes — four wrong calls last session, and what caused them

Recorded because the pattern is more useful than the individual errors.

1. **"`wsAddObject` returns 0"** — reasoned by elimination from *our* observable state without
   accounting for a swallowing SEH wrapper we owned. Their instrumentation refuted it.
2. **"Nothing was written"** — misread a `stat` timestamp via a bad column slice, then reported the
   conclusion. `find -mmin` contradicted it immediately.
3. **"Not one `object/tangible`"** — `head -12` on sorted output truncated before the tangible
   entries. Built a filed provider claim on it.
4. **`object/tangible/furniture/`** — bucketed an inventory by the wrong path depth. Caught by the
   maintainer noticing the picker list looked too small.

Common thread: **each was a conclusion drawn from a partial view of real data.** The evidence chain
survived because every one got tested rather than defended — the v32 A/B, the `.ws` swap, the
`grep` of the real `.ilf`. Cost was one wrongly-filed provider report, retracted within the hour.

**The rule that kept paying:** trust the bytes on disk, and hold the control file, not the hash.
