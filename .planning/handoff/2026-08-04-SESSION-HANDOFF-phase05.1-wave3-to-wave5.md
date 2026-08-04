# 2026-08-04 — SESSION HANDOFF: Phase 05.1, waves 3–4 closed, v32 consumed, wave 5 unblocked

**Read this first when resuming Phase 05.1.** Written at a context-clear boundary after a long
execute session. Everything below is committed unless explicitly marked otherwise.

---

## 1. Status snapshot

| | |
| --- | --- |
| Phase | `05.1-live-world-editor-productization` — **16 of 18 plans complete** |
| Remaining | **05.1-14** (Add-decoration wizard modal, wave 5), **05.1-15** (phase close, wave 6) |
| Branch | `main`, working tree clean except one untracked capture dir (below) |
| Provider contract | **v32** (157 → 160 names). Client exe restaged by the provider; re-sync if rebuilding. |
| Agent DLL | `packages/live-inject/agent/build-agent/Release/swg_toolkit_agent.dll`, built 11:14:51 local |

`05.1-14` is fully unblocked: its `depends_on` are `13, 03, 12, 08, 04` and all are complete.

**`[PortalCullProbe]` capture — delivered.** `6ff6a3e` committed
`.planning/handoff/2026-08-04-TOOLKIT-REPORT-portalcullprobe-server-connected.md` plus the raw
1031-line walk log at `.planning/research/captures/`. That was the last thing we owed the provider.

**FILED TO THE PROVIDER INBOX 2026-08-04.** Committing them here is not the same as sending them —
the provider reads `swg-client-v2/.planning/handoff/`, and their `2026-08-04-SESSION-CLOSE-v25-to-v32-arc.md`
(written 11:28, *after* both of ours) still listed the v32 rows as build-verified-only in §6a and
still recorded "they owe a re-run from a server-connected session" in §6b. Both are now in their
inbox, **untracked** per convention — the maintainer relays:

| Ours | Filed as |
| --- | --- |
| `2026-08-04-TOOLKIT-CONFIRM-v32-live.md` | `2026-08-04-toolkit-v32-CONFIRMED-live.md` |
| `2026-08-04-TOOLKIT-REPORT-portalcullprobe-server-connected.md` | `2026-08-04-toolkit-portalcullprobe-server-connected-REPORT.md` |

Two provider-side corrections were applied to the filed copies only (our originals are untouched):
the raw-log path was made **absolute** (`.planning/research/captures/…` resolves to *their* repo when
read from their side), and the v32 confirm's "Still owed by us" section — which said the
PortalCullProbe re-run was still outstanding — was rewritten, since both files now land together.
Each filed copy points at the other and names the session-close section it answers.

Note when reading that report: the committed log spans **16:23:36–16:24:40 UTC only** (the deliberate
walk). An earlier stretch of the same session — the one that prompted the hypothesis in §4 of that
report — was filtered out and is **not** citable from the committed file.

---

## 2. What shipped this session

Waves 3 and 4 closed, plus an unplanned but significant detour into a real defect (§3).

- **05.1-11** — World panel Activity + Scene accordions + footer, 019-A element-complete. Checkpoint
  approved live. `b18c2f0`, `1b314f8`.
- **05.1-12** — agent placement mode (021-A Frame 2). Checkpoint approved live after a long
  investigation. `51fd769`, `c52a43a`, `93a8a3c`, closed by `1a1c550` / `4ddf962`.
- **05.1-13** — Remove capability + 8s undo toast (D-02/D-03). Fully autonomous, 777 tests green.
  `7f1f3cf`, `a7a4162`, `7572889`, `0c4025e`.
- **05.1-05 unfinished business** — the legacy Slice-0 debug-probe overlay window was still live and
  was actively confounding testing. Retired (`d82f659`), plus two consequences that fell out of it:
  `allowTargetAnything` now enabled on overlay install (`5d82c71`) because the checkbox was its only
  writer, and the 020-A **idle hint** now renders (`c6b3d8b`) because Slice-0 had been masking a
  sketch divergence and its removal left the overlay with no proof-of-life at all.
- **v32 consumption** (commits tagged `05.1-19`, which is a label of convenience — **there is no
  plan 05.1-19**; fold these into 05.1-15's close-out narrative). `9274e42`, `f1c8025`, `94f50d5`.
- **Gizmo fix** — the transform gizmo outlived its arm. `c4c9f85`.

---

## 3. The defect story — read this before touching the placement path

This consumed most of the session and the conclusions are load-bearing.

### 3.1 What was reported

A decoration placed from the cantina doorway rendered in **world space** — visible through the open
door, culled when it closed. Diagnosed as `attemptPlacementSpawn()` passing the *building* id to
`wsAddObject` and never reparenting into a cell, and fixed with
`findCellAtWorldPosition` + `setParentCell` + an `isChildObject` mount guard + `objectWarped`
(`93a8a3c`).

### 3.2 The correction that matters

**That report almost certainly came from the legacy "Insert at cursor" button**, not from our
placement path. That button hardcoded `wsAddObject(..., 0)` — and `containedById == 0` registers the
node in the world sphere tree (`swg-client-v2` `WorldSnapshot.cpp`). So the symptom was that button
working as designed. **Our fail-closed exterior guard was never leaking.** The fix is still correct —
justified by `containedById` semantics, the provider's v27 statement that `setParentCell` is what
makes an object *live* in a cell, and the verified after-state — but **not** by that observation.
Do not re-cite the doorway report as evidence for it.

### 3.3 The real defect the investigation found

Every placement was written **twice**: an `.ilf` interior row (correct, cell-relative) *and* an 84-byte
`.ws` snapshot node parented to the **building** with `cellIndex=0` and **world-space** coordinates.
Proven arithmetically — building world Y `5.0` + `.ilf` cell-relative Y equalled the `.ws` Y to full
float precision for two separate placements. The `.ws` node was **not load-bearing** (the `.ilf` loads
via the derived template's `interiorLayoutFileName`, never touching the snapshot) and the engine
**cannot dedupe** it, because `.ilf`-created objects never receive a NetworkId so
`CEC_objectAlreadyExists` can never fire.

Root cause: `wsSaveSnapshot()` ran **before** the preview despawn, so the live preview serialized.
`saveFiltered`'s provenance filter is **top-level only** and our node was a child of an authored
building, so it was never tested.

Fixed by ordering (`47d7561`), then properly by `wsForgetNode` (§4). Two stale nodes already on disk
were pruned from `stage/override/snapshot/tatooine.ws` (1,400,440 → 1,400,272 bytes, `.bak` retained
beside it) using an IFF-tree parser that re-serialized the unmodified tree first and refused to write
unless byte-identical.

---

## 4. Provider exchange — v32 delivered and LIVE-VERIFIED

We sent a consolidated request (`67b239e`); the provider delivered all three
(`2026-08-04-PROVIDER-HANDBACK-v32-...`). All three are now **verified live** by the maintainer and
confirmed back (`a09fd5d`).

| Catalog name | Signature | Live result |
| --- | --- | --- |
| `worldSnapshot::wsForgetNode` | `int(__int64 id)` 1/0 | **PASS** — object stays visible after Persist; `.ws` byte-identical (no node written) |
| `cellProperty::getCellName` | `int(void* cell, char* buf, int cap)` → needed length incl NUL | **PASS** — adversarial test: payload carried `WRONGCELL_SENTINEL`, `.ilf` row got `foyer1`, sentinel absent from both files |
| `clientInteriorLayoutManager::refreshInteriorLayout` | `int(__int64 buildingId)` 1/0/−1 | **PASS** — code 1 in the **occupied** cantina; edit stayed, NPCs intact, interior correct |

**Caller obligations, all recorded in `rva_table.cpp` comments — do not relearn these the hard way:**

- `wsForgetNode` keeps the live `Object`; a forgotten node is invisible to `ms_reader` so
  `wsRemoveNode` can **never** tear it down again. Forget only on a **successful** persist;
  pre-persist cancel keeps using `wsRemoveNode`.
- `getCellName` is copy-out; the world cell returns the literal `"world"`, not null.
- `refreshInteriorLayout` — gate on `wsIsParsePending` (mid-parse returns 0, indistinguishable from a
  miss) and **never call while armed** (it frees and recreates layout objects → dangling
  `g_capFocus`/`g_latchedFocus`). It is deliberately **not** auto-called on the persist path; its only
  call site is `HOST_CMD_ACTION_REFRESH_INTERIOR`.

**`refreshInteriorLayout` and a live preview DO NOT COMPOSE.** Refresh only deletes the building's
client-only layout objects; our placements carry NetworkIds so they survive. Refresh + live preview =
two visible copies, and a *forgotten* node can no longer be removed. Keep them apart.

---

## 5. Open items

**Ours, and 15 is blocked on the first two being right:**

1. ~~**Plan 05.1-15's `verification_instrument_changed` frontmatter is now WRONG.**~~ — **RESOLVED
   2026-08-04.** Both blocks (05.1-15 and 05.1-12) rewritten: the occupied-building restriction is
   marked SUPERSEDED, `refreshInteriorLayout` named as the correct instrument with the
   `drive-host-command.ps1 -Action refreshinterior` invocation, and the superseded text kept inline
   for history. The two constraints that *replace* the old one (refresh does not compose with a live
   preview; never call while armed / gate on `wsIsParsePending`) and the false-pass trap are recorded
   in the same blocks, so they travel with the plan.
2. ~~**Plan 05.1-12's SUMMARY carve-out #1**~~ — **RESOLVED 2026-08-04**, and **carve-out #2 was
   stale too** — this handoff only flagged #1. `getCellName` closed #2 (cell name is derived, not
   operator-supplied; the adversarial `WRONGCELL_SENTINEL` test proves the derive overrides the
   caller string). Both are now marked RESOLVED with their caller obligations attached.
   **The cascade that fell out of #2, all fixed:** 05.1-12's `affects:` line, its "four carve-outs"
   readiness note (now two — 3 and 4), 05.1-15's `must_have` requiring the cell-name gap be *filed*
   as a change-request (there is no gap left to file), and 05.1-15's `files_modified` entry for
   `2026-XX-XX-CHANGE-REQUEST-getContainingCellName.md` (commented out — never create it).
   Only carve-outs **3** (stale ray sample) and **4** (gizmo mode radios) remain open.
3. ~~`.planning/research/captures/` is untracked~~ — **RESOLVED.** Landed as `6ff6a3e` together with
   `.planning/handoff/2026-08-04-TOOLKIT-REPORT-portalcullprobe-server-connected.md`. Nothing owed to
   the provider now except their own open `findCellAtWorldPosition` item.
4. **05.1-14** — the Add-decoration wizard modal. Note it no longer needs to collect a cell name:
   `getCellName` derives it from the placement point, so the wizard's job is template selection and
   triggering `START_PLACEMENT`.

**Carve-outs that remain genuinely open** (recorded in 05.1-12's SUMMARY):

- **"Place here" acts on a stale ray sample.** Hover sampling is gated on `!io.WantCaptureMouse`, so
  it freezes the instant the cursor touches the strip. The floor-click path re-checks that flag and is
  unaffected; the button does not. Filed at
  `.planning/todos/pending/place-here-button-stale-ray-sample.md`.
- **Gizmo World/Local mode radios** went with the Slice-0 window; `g_gizmoMode` has no writer and
  defaults to Local. G/R still work. Accepted narrowing — the maintainer was offered a rehome and did
  not request one.

**Theirs:** `findCellAtWorldPosition` returns the world cell after `game::loadScene` — accepted as
theirs, next in their queue. Our `[PortalCullProbe]` capture (§1) is the input they wanted.

---

## 6. Traps — every one of these cost real time this session

1. **An occupied building can produce a FALSE PASS, not just a false failure.** The known warning is
   that reloading an occupied building shows pre-edit state. The mirror case bit us: the building is
   *kept* across the reload **with its live in-session objects**, so unsaved work looks persisted.
   Trust the bytes on disk, not the screen. (`refreshInteriorLayout` now retires this.)
2. **Never call the addon's `openChannel` from a second process.** It ends in an unconditional
   `memset` of the whole channel, wiping the live session, and resets `HOST_CMD_EPOCH` so your command
   is silently de-duped away. Use `packages/harness/scripts/drive-host-command.ps1`, which attaches via
   `OpenFileMappingA` and mirrors the seqlock discipline.
3. **The live mapping name is discoverable** — `Local\SwgToolkitLive_<random8>`, regenerated per attach
   and never shown in the UI. `packages/harness/scripts/find-live-mapping.ps1` enumerates it from
   `\Sessions\<id>\BaseNamedObjects`. Never ask the maintainer to look it up.
4. **`.ps1` files must be pure ASCII.** Windows PowerShell 5.1 reads them as ANSI; one em dash breaks
   parsing with an error pointing at a *later* line.
5. **File mtimes are LOCAL; `SwgClient_report.log` timestamps are UTC** (local is UTC−5). Both bit us.
   Also, that log **appends across sessions** — filter by timestamp before drawing conclusions.
6. **Don't test `getCellName` in an editor scene.** Our derived name comes off
   `findCellAtWorldPosition`, which has the open world-cell defect after `loadScene` — it would look
   like a `getCellName` bug. Test server-connected.
7. **Stale mtime ≠ broken feature.** A file predating your test may simply mean nobody pressed the
   button since. This produced one confident wrong conclusion; the placement pipeline was fine.

---

## 7. How to resume a live session

```bash
# 1. find the mapping (regenerated every attach)
powershell -File packages/harness/scripts/find-live-mapping.ps1

# 2. non-destructive read of the HOST_CMD region
powershell -File packages/harness/scripts/drive-host-command.ps1 -Name '<mapping>' -Peek

# 3. drive placement (no UI until 05.1-14 ships)
powershell -File packages/harness/scripts/drive-host-command.ps1 -Name '<mapping>' `
  -Action start -Template 'object/static/item/shared_item_bottle_tall.iff' -Cell 'cantina' -Id '0'

# 4. refresh a building's interior (action 7)
powershell -File packages/harness/scripts/drive-host-command.ps1 -Name '<mapping>' `
  -Action refreshinterior -Id '1082874'
```

**Verifying a persist by bytes** — override dir is `D:\Code\swg-client-v2\stage\override\`:
`interiorlayout/shared_cantina_mos_eisley_tatooine.ilf` (stock-path mirror),
`interiorlayout/toolkit/edit_1082874.ilf` (derived), `snapshot/tatooine.ws`.
A placement should grow **both `.ilf` files** by one `NODE` chunk and leave `.ws` **unchanged** —
`.ws` growth of 84 bytes means the duplicate-node defect has returned.

Mos Eisley cantina is building `1082874`; its real cells are `cantina`, `foyer1`, `foyer2`,
`alcove1`–`alcove5`, `stage`, `back_hallway`, `back_entrance` (11, from the real `.ilf`).

---

## 8. Naming

Do **not** use the `utinni_` prefix in our code, comments, or docs — this project reads Utinni as a
reference implementation only. Those are the provider's internal export symbols. We bind by **catalog
name** (`worldSnapshot::wsForgetNode`) from the hook-points table, never by the C symbol. The
maintainer has asked the provider to clean up their side.

**The constraint that matters:** a renamed *catalog string* breaks our rows **silently** — unresolved
rows are null-guarded by design and degrade to a words-only no-op, not an error. If the provider
changes catalog strings they owe us the old→new list.
