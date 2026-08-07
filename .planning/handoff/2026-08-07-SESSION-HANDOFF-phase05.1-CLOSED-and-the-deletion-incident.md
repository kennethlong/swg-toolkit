# 2026-08-07 — SESSION HANDOFF: Phase 05.1 CLOSED, and the `.ilf` deletion incident

**Read this first.** Supersedes `2026-08-05-SESSION-HANDOFF-phase05.1-sign-off-in-progress.md`.
Everything below is committed **and pushed** (`origin/main` = `862f0f6`, 180 commits).

---

## 1. Status

| | |
| --- | --- |
| Phase 05.1 | ✅ **CLOSED** — 18/18 plans, sign-off 13/13, gap ledger 14/14 (0 escalated) |
| Branch | `main`, clean, **pushed** — first push since before 05.1 began |
| Suites | renderer **843 / 78 files**, `@swg/live-inject` 56/56, `tsc --noEmit` clean |
| Agent DLL | x86 Release, current, contract v33 (160 names) |
| Next phase | **exterior `.ws`-node editing** — see §6 |

Phase artifacts: `05.1-15-SUMMARY.md`, `05.1-15-CHECKPOINT-WORKSHEET.md` (Parts 0b/0c/C/E/F carry
the live evidence), and D-02/D-03/D-06/D-09/D-12 annotated in `05.1-CONTEXT.md`.

---

## 2. ⚠ The incident — a toggle deleted a user's work. Read before touching mirror mode.

**A mirror-mode toggle deleted `edit_1082874.ilf` — 34,422 bytes of persisted decoration work —
silently, reporting zero failures on both passes.** Fixed in `808bcca`; four defects, five regression
tests. Nothing was lost (see §4 recovery).

### The chain

1. The agent reports the **live node's** building template. Model-D rebinds that node to a **derived**
   template on the first persist, so from the SECOND capture onward it honestly reports
   `object/building/toolkit/edit_<id>.iff`.
2. That path was written into `worldEditorBuildingTemplates`, which is documented
   (`worldEditorScan.ts:62-64`) to hold the **stock** path. **The map self-poisoned.**
3. `reconcileMirrorMode` resolves a building's mirror target by READING its recorded template. The
   derived template declares `interiorlayout/toolkit/edit_<id>.ilf` — so the "mirror path" became the
   user's own edit file.
4. Mirror-**OFF** unlinked it. Mirror-**ON** rescanned, found the building gone (the scan is
   disk-driven), and skipped it. Hence total silence.

### Why it appeared only now

**Only reachable because the editor scene started working earlier the same day** (§3). Before that,
editor-scene persists could not succeed; and a *server-connected* session reports the STOCK template,
because the server streams buildings from stock data. Every mirrored persist verified during 05.1 was
server-connected. **A fix elsewhere unlocked a latent bug here** — worth expecting again.

### The four fixes

1. `removeStockMirror` **refuses** a toolkit-authored path (`isToolkitAuthoredIlfPath`). The guard is
   in the **primitive**, not the call site: there are TWO destructive routes (the OFF branch and the
   rollback of a prior write) and a call-site guard covers one and misses the other.
2. `resolveStockBuildingTemplate` prefers the durable map's stock path over a derived capture, and a
   derived capture is **never** written back. The map is **write-once-correct** — only the pre-rebind
   capture ever knows the stock path, because a derived template's DERV base names a GENERIC base,
   never the specific stock building.
3. `reconcileMirrorMode` cross-checks in its **zero-writes** phase that no resolved mirror path is a
   toolkit file or any scanned building's edit file → reported failure, untouched disk.
4. `stageDurable` no longer hardcodes `action:'add'`.

### Two traps this incident set, both of which caught me

- **`0 modify` in the Deploy tab was not evidence.** `stageDurable` hardcoded `'add'`, and
  `stagingStore.addEntry` de-dupes by `virtualPath` — so three pushed entries rendered as
  `2 staged · 2 add · 0 modify`. That reading made me discard the *correct* hypothesis for an hour.
- **The mirror had been silently stale for a full day before the deletion.** Every persist reported
  success. No error, no log line, no UI signal.

---

## 3. Post-close: the editor-scene defect is FIXED — three constraints RETIRED

The provider shipped a same-scene sphere-index re-arm, **verified live on our path**
(`2026-08-07-TOOLKIT-CONFIRM-editor-scene-rearm-live.md`):

```
BEFORE  editor scene  candidates=0  tree=  1/  0/9
AFTER   editor scene  candidates=1  tree=106/236/0  cell=cantina building=1082874
```

**Do not carry these into 5.2 or the exterior work — they are dead:**

1. **"Load the editor scene LAST"** — the ordering rule that shaped the entire sign-off.
2. **"Any ADD after a `loadScene` derives `cellName: \"world\"`"** — verified retired: post-fix ADDs
   wrote `cantina` and `alcove2` correctly, `world` count 0.
3. **"`Reload scene` is required for a usable editor scene."**

Root cause was two mechanisms — `suppressObject`/failed-creates stripping handles (removed individual
authored buildings) and the `PP_sphereTree` gate skipping buildout POB roots when not single-player
(emptied the city) — with a same-scene `loadScene` early-returning before any re-parse.

**Our own lead was wrong and INVERTED** (we proposed stale NON-zero handles refused by the add gate;
the truth is ZERO handles never re-armed). Recorded so it is not later cited as the insight.

Also falsified by measurement and **not to be re-derived**: the handoff's Finding-2 candidate fix
(`cleanupScene`-first) is **not** the cause — tested live, `candidates=0` unchanged (`5f1a4da`). Two
findings from that negative run: `loadScene` with a live scene **no longer FATALs** on v33 (retiring
the constraint 05.1-16's two-frame sequence was built around), and our shipping path **leaks the
outgoing `GroundScene`** while the experimental one would not (reasoned, not measured).

---

## 4. Instruments — two I did not know existed, both better than what I built

**`swg-client-v2/stage/SwgClient_report.log`** — the client's own report log. Timestamped
(**UTC**), persistent, survives session end, needs no capturer, cannot be pre-empted. **Use this for
the provider's `[cellAtPos]` probe**, not DBWIN. I built a DBWIN harness, fought the single-capturer
constraint, lost a run to an expired window, then recovered that run from this file.

**`%TEMP%\swg-toolkit-decoration-stage\`** — `stageDurable` writes `<sha16>_<basename>` for every
persisted file. This is (a) a **recovery cache** — the "lost" edit was restored from it — and (b) an
**independent audit trail**: the cantina mirror stops being paired after `2026-08-06 19:03`, dating
the poisoning without reference to any log or map.

**`SWG_TOOLKIT_DECO_TRACE=1`** gates the orchestrator's `dbg()` to
`%TEMP%\swg-toolkit-decoration-debug.log`. **Off by default**, so that class of question costs a
relaunch. Note the orchestrator's `dbg` is a FILE; the agent's `dbg` is `OutputDebugString` — they are
different mechanisms and I conflated them once.

**Promoted to `packages/harness/scripts/` this session** (they were scratchpad-only and would have
expired):
- `list-interior-layouts.cjs` — a building is decoratable **iff** an
  `interiorlayout/<portal-layout>.ilf` exists. Only **298** exist against ~1,178 building templates.
  ⚠ `.ilf` names follow the PORTAL LAYOUT, not the building template
  (`shared_cantina_tatooine.iff` → `shared_cantina_mos_eisley_tatooine.ilf`) — never assume they match.
- `extract-stock-ilf.cjs` — pull a pristine `.ilf` from the TREs, for diffing edits against stock.
- `capture-dbwin.ps1` — DBWIN capture (agent `dbg()` only; single capturer system-wide).

**`.ws` node record layout**, reverse-engineered this session (no parser existed):
```
FORM <len> NODE                  <- outer form; NODE tag at h
  FORM <len> "0000"              <- version form at h+4
    DATA <len=0x34>              <- 52-byte payload, tag at h+16, payload at h+24
      +0 nodeId  +4 parentId  +8 objectTemplateNameIndex  +12 cellIndex
      +32 x  +36 y  +40 z  +44 radius(512.0)  +48 (NOT a portal CRC — falsified)
OTNL: int32 count at +8, then that many NUL-terminated ASCII names.
Tatooine: 15,808 node records, 1,178 interned names.
```

---

## 5. Byte-verification rules (carried forward, still correct)

- `.ilf` — both files grow by **one NODE per placement** and stay byte-identical while mirror is ON.
  An EDIT rewrites a row **in place**: size unchanged, md5 moves.
- `.ws` — unchanged **only** when the placed template is already interned; a novel template grows it
  by exactly `strlen(templatePath)+1`. **An 84-byte NODE appearing is still the duplicate-node defect.**
- **`.ws` full-resave drifts ~2000 scattered bytes and this is NORMAL** — 1-2 ULP quaternion drift,
  proven pre-existing by A/B on prior controls. Do **not** read a large scattered `.ws` diff as corruption.
- **Snapshot the FILE, not the hash.** Twice this week a hash-only baseline produced a wrong call.
- `wsForgetNode` has now held for **six** consecutive placements across three sessions.

---

## 6. Next: exterior `.ws`-node editing

Recommended as its own phase, **ahead of 5.2 Guided Workflows**.
Todo: `.planning/todos/pending/exterior-ws-node-editing.md`.

**There are THREE object classes, not two** (established live this session):

| Class | Lives in | Route | Status |
| --- | --- | --- | --- |
| Interior decoration | `.ilf` | derived template + rebind | **BUILT** |
| Exterior world object | `.ws` node | direct node edit + `wsSaveSnapshot` | designed, NOT built |
| **Server-spawned** | **server datatable** | datatable edit + server push | not designed |

Class 2 is the common case by a wide margin — **15,808 node records on Tatooine alone**. Class 3
(e.g. the cloning terminal, from swg-main's `cloning_facility_terminal.tab`) **cannot** join the
unified "editor picks the route" model: it needs a server push, not `wsSaveSnapshot`. Give it an
honest refusal naming the reason.

The maintainer's design intent is binding: the buttons work identically inside and out, and the
container is resolved from the **placement point, not the player** — the doorway is the acceptance test.

---

## 7. Owed by the maintainer (nothing owed by me)

1. **Relay two handoffs** to the provider — untracked on their side:
   `2026-08-07-TOOLKIT-REPORT-editor-scene-sphere-tree.md` and
   `2026-08-07-TOOLKIT-CONFIRM-editor-scene-rearm-live.md`.
2. **Add `stage/override/` to `swg-client-v2`'s `.gitignore`.** That tree is **fully untracked** with
   no ignore entry — a `git clean -fd` or `git stash -u` there would wipe every `edit_*.ilf`, every
   derived template, and `tatooine.ws`. Their repo, so not ours to change.
3. **`logCellAtPosition=1`** is still enabled in `stage/client.cfg` — set to 0 when done diagnosing.

Still open, unchanged: provider **4b** (`wsAddObject` executes text on a wrong-class template) and
**4c** (`wsForgetNode` does not un-intern) — both knowing decisions, both non-blocking. Their
wrong-class `.ilf` refusal branch remains unexercised; the negative test is available on request.

---

## 8. Method note — the pattern worth carrying

**Six of the seven defects fixed this session were failures that reached NO surface at all.** Not
wrong messages — *absent* ones: refusal reasons computed then discarded, a strip state made
structurally unreachable, an abort reason routed to the wrong log, a mirror silently going stale, and
a deletion reporting success. That is the standing failure mode in this subsystem, and it is now
written into D-12's annotation: **SC1's intent is that a failure is EXPLAINED, not merely worded** — a
surface showing nothing, or a true-but-empty word like `"aborted"`, satisfies the letter and fails
the decision.

**The crew earned its keep on the deletion.** Two of my own mechanisms had already failed against the
code. Four non-overlapping angles (`CONSULT-76`) each found something the others did not; the
recovery of the "lost" edit came from the consultant reasoning purely from file-state transitions,
and one of them correctly flagged that a fact in **my own evidence packet** was stale and would send
readers to the wrong place. Withholding my failed hypotheses from the packet was the right call.
