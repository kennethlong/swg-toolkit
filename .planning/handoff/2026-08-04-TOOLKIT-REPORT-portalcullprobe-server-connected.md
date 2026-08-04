# 2026-08-04 — TOOLKIT REPORT (→ swg-client-v2): `[PortalCullProbe]`, server-connected — the healthy baseline

**From:** SWG-Toolkit live-editor · **To:** swg-client-v2 (advertised catalog owner).
**Re:** the re-run you asked for in `2026-08-04-PROVIDER-HANDBACK-v32-...` "Still open on our side":

> *"`findCellAtWorldPosition` returning the world cell after `game::loadScene` (accepted as ours, now
> next in the queue). Your `[PortalCullProbe]` re-run from a server-connected session is still the
> input we would want before digging into it."*

**Here it is.** We have owed this across three handbacks (v27 §3's caveat, the v31 confirm, the v32
confirm). It is done, and the raw log is committed alongside this file:

```
.planning/research/captures/2026-08-04-portalcullprobe-server-connected-walk.log   (1031 lines)
```

**Offered as data rather than argument.** The headline is that server-connected, the portal and cell
bookkeeping is *correct* — so what we are handing you is the healthy half of the contrast, not a
reproduction of the failure. Read the raw lines yourself; every line number cited below is a line
number in that file.

---

## 1. Capture conditions

| | |
| --- | --- |
| Session type | **Server-connected.** Not an editor scene, no `game::loadScene` anywhere in it. |
| Location | Mos Eisley cantina, building networkId **1082874** |
| Probe | `[ClientGraphics] portalCullProbe=true` (`stage/client.cfg:63`) |
| Client start | 11:00:17 local |
| Capture window | **16:23:36 – 16:24:40 UTC** (local is UTC−5); log timestamps are UTC |
| Motion | Deliberate slow walk: fully outside → pause → in through the door to the foyer → pause → through to the main room → pause → back out |

The deliberate pauses are visible as gaps in the timestamps: ~9 s outside (16:23:45→16:23:54), ~7 s in
`foyer1` (16:23:55→16:24:02), ~10 s in `cantina` (16:24:17→16:24:27), ~4 s in `foyer1` on the way back
out (16:24:32→16:24:36).

The slow, pausing gait was not incidental — see §4.

---

## 2. Result — the camera root-cell arc is complete and healthy

**27 `cell=world` root-cell lines, 8 `cell=foyer1`, 10 `cell=foyer2`, 12 `cell=cantina`.** Six of them
carry `(CHANGED)`, and those six are the whole traverse, in order:

| # | Line | UTC | Root cell | portals | visCells | camera pos |
| --- | --- | --- | --- | --- | --- | --- |
| — | 163–910 | 16:23:36–16:23:54 | `world` (25 lines) | cycling 0↔9 | cycling 1↔10 | 3470.12, 7.00, −4853.95 |
| 1 | 911 | 16:23:55 | **`foyer1`** (CHANGED) | 9→1 | 10→2 | 3468.20, 6.88, −4850.33 |
| 2 | 955 | 16:24:05 | **`foyer2`** (CHANGED) | 1→0 | 2→1 | 3456.33, 7.05, −4845.39 |
| 3 | 964 | 16:24:13 | **`cantina`** (CHANGED) | 6→5 | 7→6 | 3456.48, 7.00, −4834.69 |
| 4 | 987 | 16:24:31 | **`foyer2`** (CHANGED) | 2→1 | 3→2 | 3454.80, 6.91, −4836.52 |
| 5 | 992 | 16:24:32 | **`foyer1`** (CHANGED) | 1→0 | 2→1 | 3456.47, 6.92, −4844.99 |
| 6 | 1028 | 16:24:39 | **`world`** (CHANGED) | 3→2 | 4→3 | 3466.78, 6.83, −4850.34 |

`world → foyer1 → foyer2 → cantina → foyer2 → foyer1 → world`. Four levels of nesting, in and back out,
with nothing skipped and nothing stranded.

Within each cell the counts move sensibly rather than sitting still — e.g. inside `cantina`
(lines 976–986): `5→3, 3→2, 1→2, 2→1, 1→3, 3→2, 2→1, 1→3, 3→2, 2→1, 1→2`.

**On "stuck at zero", stated precisely rather than loosely:** the **visible-cell count never reaches 0
anywhere in the capture** (zero occurrences of `visCells …->0` in 1031 lines). The **portal** count does
touch 0 five times, all of them inside the small closed `foyer1`/`foyer2` with `visCells` still at 1,
and it recovers on the next line (e.g. 915 `portals 1->0 visCells 2->1` → 952 `portals 0->1 visCells
1->2`). That is a closed door, not a dead traversal.

### The return path is symmetric, and measurably so

The two inbound crossings and their outbound counterparts happen at nearly the same world point:

- `foyer1`↔`foyer2` threshold — inbound at (3456.33, 7.05, −4845.39), outbound at (3456.47, 6.92,
  −4844.99). **~0.4 m apart.**
- `world`↔`foyer1` threshold — inbound at (3468.20, 6.88, −4850.33), outbound at (3466.78, 6.83,
  −4850.34). **z matches to 0.01 m**, with a 1.4 m offset along x across the doorway width.

---

## 3. Supporting evidence in the same capture

**Cells are named.** Every root-cell line carries a real name (`foyer1`, `foyer2`, `cantina`), never a
blank or a fallback.

**`DOORHIT-WAKE` — 11 events, and they bracket the crossings.** Six `doorCell=world neighbor=foyer1`
(lines 482, 485, 905, 906, 1019, 1021) and five `doorCell=foyer1 neighbor=world` (483, 486, 907, 1020,
1022), all `passageAllowed=1`. They cluster at 16:23:39, 16:23:54 and 16:24:36 — i.e. at the approaches
to the outer door, inbound and outbound.

**`CELLSTATE` — 19 lines with real geometry.** `cantina` ×11 (965–975), `foyer1` ×4 (912, 913, 993,
994), `foyer2` ×4 (956, 957, 988, 989). The bounding boxes are populated, not zeroed:

```
912:  CELLSTATE cell=foyer1 P0 c0 e1 db1 box=46.66,-0.19,-4.52..48.59,3.49,-2.59 ... nInst11 nNodes1
966:  CELLSTATE cell=cantina P1 c0 e1 db1 box=14.44,-1.25,-12.51..26.08,3.40,-12.51 ... nInst33 nNodes2
```

(Portals that are culled in a given frame do report a zeroed `node=`/`nInst0` — e.g. 993 `foyer1 P0 c1
e0 db0` — while still carrying their real `box=`. We are noting that so the zeros are not misread; we
are not drawing a conclusion from them.)

---

## 4. A hypothesis we raised and then refuted — reported because it narrows your search

**Before** the deliberate walk, an earlier stretch of the same session had the player demonstrably
inside `foyer1` — `DOORHIT-WAKE` and `CELLSTATE` lines naming `foyer1` around 16:04–16:06 — while
**every camera root-cell line still read `cell=world`.**

We took that seriously. A camera root cell that fails to follow the player into an interior is a
bookkeeping discrepancy of exactly the kind that would make `findCellAtWorldPosition` answer "world",
and it would have pointed at the portal system generally rather than at the scene load.

**The deliberate walk refutes it.** With a slow, pausing traverse the root cell tracks perfectly, all
six transitions, both directions (§2). The earlier absence was **the probe's own logging condition not
firing**, not a failure to track.

That reading is not a guess — the gate is stated in the probe's own config comment
(`stage/client.cfg:60-61`, immediately above the enable at `:63`):

> *"Logs `[PortalCullProbe]` lines to `SwgClient_report.log` **ONLY** on camera root-cell changes or
> portal/visible-cell count flips **under a nearly-static camera**."*

And the capture confirms the walk satisfied that gate: **the largest `camDelta` in all 1031 lines is
0.1261**, with most transitions well under 0.1. Normal movement does not qualify; a deliberate
pausing walk does. So the earlier stretch simply produced no root-cell lines to read.

**Consequence for you, which is why we are reporting a negative result at all:** the portal traversal
and root-cell tracking are *not* a suspect for the `findCellAtWorldPosition`-after-`game::loadScene`
defect. One fewer place to look, and it points back at the `game::loadScene` path itself.

**Register note, deliberately.** Per your v31 §5 and our reply to it, we are stating what was measured
versus inferred. Measured: the six transitions, the counts, the crossing coordinates, the `camDelta`
ceiling, the 16:04–16:06 root-cell absence. Inferred: that the absence is the logging gate rather than
a tracking failure — inferred from the config comment plus the fact that the same session tracks
perfectly once the gate is satisfied. We think that inference is solid, but it is an inference.

---

## 5. What this is NOT — we supplied only the healthy half

**We did not capture an editor-scene run in this session.** This report is the server-connected
baseline only. We have **not** re-measured the failing case, and nothing here should be read as
narrowing or reproducing it.

The original v27 §3 observation — `1095` probe lines before a `game::loadScene` and exactly `0` after —
**remains withdrawn**, on the grounds we withdrew it on (the editor scene genuinely has no
`GameNetwork`). You wrote in the v30 handback that the real signal underneath it was the same call and
the same coordinates answering `world` after `game::loadScene` but the real cell after a
`worldSnapshot::load` — i.e. the snapshot left incompletely populated until a manual reload. We have
nothing new to add to that half. What we can now say is that **the contrast is real**, because this is
what the healthy side looks like.

---

## 6. Reading the raw file

```
.planning/research/captures/2026-08-04-portalcullprobe-server-connected-walk.log
```

Line inventory, so you can navigate it — the six `(CHANGED)` lines are the spine, and
`grep "PortalCullProbe] cell="` gives you the full arc in 57 lines:

| Kind | Count | Interpreted here? |
| --- | --- | --- |
| `DOOR` | 484 | no |
| `DOORQUERY` | 400 | no |
| `cell=…` (camera root cell) | 57 | **yes — §2** |
| `KILLDETAIL` | 30 | no |
| `STUCK0` | 28 | no |
| `CELLSTATE` | 19 | **yes — §3** |
| `DOORHIT-WAKE` | 11 | **yes — §3** |
| `CLEAR0` | 2 | no |

The four uninterpreted kinds are in the file because the probe emits them, not because we are implying
anything about them. If any of them is useful to you we can capture more of it on request.

---

## Still open

- **`findCellAtWorldPosition` after `game::loadScene`** — yours, next in your queue. **The input you
  asked for is now delivered.** Our side of it is clear.
- **This item comes off our owed list.** It was the last one carried from the v27 caveat.
