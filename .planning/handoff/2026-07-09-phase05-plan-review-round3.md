# Handoff — Phase 05 (WYSIWYG Live-Sync & Typed Editors): round-3 cross-AI review done, replan UNCOMMITTED

**Date:** 2026-07-09
**Branch:** `main` · **HEAD:** `2be9586` (docs(05): cross-AI review round 3)
**Status:** Phase 05 **planning + 3 review rounds complete**; the round-3 `--reviews` replan is **sitting
uncommitted in the working tree**; round-3 review says **do NOT execute 05-03/05-07 as written** — two
provable HIGH gaps + one unmet-intent HIGH remain. **Not pushed.**

---

## ⚠️ READ THIS FIRST — uncommitted work in the tree

`git status` shows **7 modified plan files + STATE.md that are the round-3 replan and are NOT committed:**

```
 M .planning/phases/05-.../05-01-PLAN.md   05-03  05-04  05-07  05-10  05-11  05-12
 M .planning/STATE.md
?? .planning/research/CONSULT-05R3-*.md          (this round's 4 review task files)
?? .planning/research/CONSULT-05-*.md            (earlier planning-crew task files, also untracked)
```

- These plan edits are the maintainer's **round-3 replan** (folded the four round-2 decisions). **The
  round-3 review I just committed (`2be9586`) reviewed exactly this uncommitted state.**
- **Do nothing destructive** (`git checkout -- .`, `git reset --hard`, `git stash` without noting it)
  until this replan is either committed or deliberately discarded. If restarting from a clean session,
  the tree should already carry these edits — verify with `git status` before touching plan files.
- The `.out` reviewer transcripts (`CONSULT-05R3-*.out`) are gitignored/untracked and hold the FULL
  reviews if you need more than the synthesis.

---

## Where Phase 05 sits

Phase 05 joins the Phase-2 viewport gizmo + Phase-3 live-injection agent into the **zero-restart WYSIWYG
write loop** over the SharedArrayBuffer channel, plus two typed IFF editors (DTII datatable grid, `.stf`
strings). Delivers **LIVE-03, DATA-01, DATA-02**. 12 plans / 6 waves. Full boundary + decisions in
`05-CONTEXT.md` (D-01…D-12). UI contract locked in `05-UI-SPEC.md`.

**Review history (all in the phase dir):**
- `05-REVIEWS-R1.md` — round 1 (found the setScale crash BLOCKER + byte HIGHs).
- `05-REVIEWS-R2.md` — round 2 (post first `--reviews` replan; raised the 4 decisions below).
- `05-REVIEWS.md` — **round 3, current** (this session).

**The write loop, one paragraph:** an x86 agent DLL injected into the running SWG client polls a
toolkit→agent command slot in the SAB each `Sleep(16)` tick and applies it by calling the client's own
`setTransform_o2w` / `setScale` (harvested RVAs on legacy SWGEmu; advertised `GetEngineHookPoints`
catalog on swg-client-v2). A read-verify guard compares live object bytes to a toolkit snapshot and
**fails closed**. A liveness bitfield reports per-build capability. Latest-wins single command slot,
zero-alloc hot path.

---

## What the round-3 replan folded in (the four round-2 decisions)

1. **Targeting scope → option 1b (pursue the stronger cross-build path).** Advertised build now calls
   `getSelectedObject()` (catalog rows `cuiHud::g_instance` + `cuiHud::getTarget`); both builds can
   resolve `NetworkId → Object*`. Legacy keeps the `+1432` look-at chain.
2. **W2 scale-guard split.** New liveness **bit4 `scaleUnavailableOnBuild`** = `isAdvertisedClient() &&
   setScale == nullptr`; `SCALE_REFUSED` no longer set for unresolved `setScale`. Zero channel growth.
3. **Revert model.** `revertWrite`/`revertAll` now gate on `guardState==='blocked'` and **coalesce**
   rebaseline+apply into one seqlock write; surface the discarded change (`lastDiscardedChange`).
4. **Byte prose + minors.** 05-04 span "391→387" fixed.

**All four confirmed landed by ≥2 reviewers.** Codex verified every cited catalog row/RVA exists at the
cited source line.

---

## Round-3 verdict: HIGH — the two headline changes each opened a new HIGH gap; intent still unmet

Full synthesis + interleavings + fixes: **`05-REVIEWS.md`**. The **maintainer decisions needed**, in
priority order:

### 🔴 #1 (do first) — Reconcile the baseline with per-frame focus (Opus, provable from plan text)
The per-frame focus resolver was **never squared with the once-per-attach snapshot**. Both the agent's
`s_expectedTransform/Scale` and the host's `cowSnapshot` are captured **once at attach** (against the
player) and never re-keyed. Select any object O other than the attach-focus → first write to O false-
blocks; `revertAll` force-writes the *player's* pose onto O (teleport). Undetectable on legacy
(networkId=0). **Breaks locked D-03 "snapshot per object (once)" and defeats the round-2 "move what you
selected" goal.** Fix (small): re-capture agent baseline + host snapshot on focus-identity change
(networkId/templateName advertised; raw `focus` ptr legacy) — min: agent resets `s_expectedCaptured=false`
when `focus` differs from the captured-against pointer.

### 🔴 #2 — Gate + unify the rebaseline (Opus + Cursor, same asymmetry from opposite ends)
The coalesce put the REBASELINE mutation in the **outer command-read scope**, not the `cmdSeq`-new gate.
Latest-wins slot re-reads the same command every frame → rebaseline re-runs → **adopts an external tamper
as baseline → defeats the transform guard for the whole `[revert, next-command]` window** (Opus). The
scale channel pins to `cmd.scale` instead, so a **scale-only** blocked revert on legacy **won't un-stick**
(Cursor HIGH). One fix: move the rebaseline **inside** the `cmdSeq`-new + non-torn guard (once-per-command,
atomic with apply) AND rebaseline **both** channels to the live value at that instant. Add a lexical-scope
acceptance grep.

### 🔴 #3 — Targeting honesty (Sonnet; severity depends on how LIVE-03 is marked done)
No `template → live-Object*` resolver exists, so dragging the gizmo still moves the in-game **selected**
object, not the loaded viewport asset — and **05-03 now contradicts itself** ("no resolver … does not
attempt" vs "actually closes the round-1 finding"). The 05-12 UAT is worded around the gap ("object …
*matching the live focus object*"), so sign-off would never surface it. Pick: **(a)** add the cheap
`⚠ viewing X, moving Y` HUD mismatch warning (toolkit already has both names) + fix the self-contradicting
05-03 note + add a deliberate-mismatch UAT step + soften LIVE-03 status language; or **(b)** accept the
narrow capability and correct every "closes round-1" claim to "makes the fallback real on both builds;
viewport↔live binding deferred to Phase 7 `.ws`."

### 🟠 MEDIUM (fold in same round)
- **Off-thread `Object*` UAF** (Codex + Opus converge): raw pointer from a `Watcher` + off-main-thread
  `setTransform_o2w` data-races client structures; intermediate `hudInstance` window. Plan **accept-watches**
  (defensible for a single-user tool). Mitigate: wrap resolve→read→apply in SEH so a UAF degrades to a
  skipped frame + fault bit, not a client crash; name the `hudInstance` window in the UAT.
- **Renderer wiring gaps** (Cursor): `GUARD_ADDR` (offset 392) decode is **untasked** in 05-07 but 05-11
  needs it; `lastDiscardedChange` is transform-only (scale-only block discloses nothing); **bit5
  `scaleGuardUnavailableOnBuild` is published by the agent but decoded by nobody**.

### 🟡 LOW
- Citation fix: replan re-cited `cachedNetworkIdGetObject` to `network.cpp:35` — that's the **typedef**;
  the `= 0x00B30160` assignment is `network.cpp:42`. Utinni path prefixes in plan prose are off
  (`swg/misc/network.cpp`, `swg/game/game.cpp`, `swg/ui/cui_manager.cpp` are the real files).
- `lastDiscardedChange` sourced from stale host state (1–2 frames old) — prefer agent-published discarded
  bytes, or soften banner copy.
- Fix-D static-cell caveat **is correctly present** (no longer overclaims). bit4/bit5 "computed once" is
  **safe** (inputs immutable post-init) — verified, no action.

---

## How to restart

1. `git status` → confirm the 7 plan edits + STATE.md are still present (the round-3 replan). If a fresh
   clone/clean tree, they must be re-applied or you're looking at the pre-replan state.
2. Read **`05-REVIEWS.md`** (round 3) top-to-bottom — it has the exact interleavings and the minimal fixes.
3. **Maintainer decides #1, #2, #3** (esp. #3's a-vs-b). #1 and #2 are small, local, provable changes; #3
   is doc/UAT + one HUD string.
4. Fold in: `/gsd:plan-phase 5 --reviews` (round-4 replan reading `05-REVIEWS.md`). Consider committing the
   current uncommitted replan first (or let the `--reviews` pass amend it) so the tree has a clean base.
5. Re-review after the replan (this same skill): `/gsd-review --phase 5`. Per the maintainer rule
   ([[feedback-pause-after-plan-phase]]) auto-RUN review then PAUSE — never auto-advance to execute.
6. Only after HIGHs clear: close planning, then `/gsd:execute-phase 5`.

**Suggested wave order once green** (from 05-CONTEXT "Claude's discretion"): shared `GateBar`/`GateChip`/
`FailBanner` once → DTII (reference consumer) → STF (sibling reuse); the live-write track (highest unknown)
runs in parallel.

---

## Crew invocation (this session's setup, reusable)

Reviewers = **Codex + Cursor** (CLIs, background) + **fresh Sonnet + Opus** (Agent tool). I skip my own
Claude CLI (self-independence). Task files → `.planning/research/CONSULT-05R3-<who>-<topic>.md`, outputs →
`...-<who>.out` (Codex/Cursor) or the agent transcript (Sonnet/Opus).

- **Codex** (repo tracer / ground truth): `$env:PATH="C:\Program Files\nodejs;$env:PATH"` then
  `C:\Users\kenne\AppData\Roaming\npm\codex.cmd exec --skip-git-repo-check --sandbox read-only -` (prompt on
  stdin). Output goes to the `.out` file (the task file just shows `CODEX_DONE`). Codex `.out` is the FULL
  transcript (~490KB) — slice the last `codex` marker → `tokens used`, or just read the tail.
- **Cursor** (detailed code reader): `C:\Users\kenne\AppData\Local\cursor-agent\cursor-agent.cmd -p --mode
  ask --trust --output-format text`. Clean prose to the `.out` file.
- **fresh Sonnet / Opus**: Agent tool, `model: sonnet` / `model: opus`, `general-purpose`, pointed at the
  CONSULT task file by absolute path; final message = the review.

**De-anchoring worked this round:** I led each reviewer with the round-2 decisions as *claimed-applied* and
told them to verify against real source, not the plan's self-assessment — which is exactly how Codex caught
the `:35`/`:42` citation error and Opus caught the two ungated/unreconciled invariant breaks the plan's own
prose asserts are fine. Give non-overlapping angles; convergence-from-divergence (Codex+Opus on the UAF;
Cursor+Opus on the rebaseline asymmetry) is the real signal.

---

## Ground-truth anchors (verified this round, treat as LOCKED)

- **Advertised targeting rows all exist** (Codex vs `D:/Code/swg-client-v2/.../engine_advertise.cpp`):
  `cuiHud::getTarget` (:703, `__fastcall` thunk over `SwgCuiHud::getLastSelectedObject()` at :374-377 /
  `SwgCuiHud.cpp:2211-2213`), `cuiHud::g_instance` (:704), `network::getObjectById` (:707 →
  `NetworkIdManager::getObjectById`, `NetworkIdManager.cpp:72-79`). Catalog **key** must be
  `cuiHud::getTarget` (exact string compare at `agent/resolve.cpp:37-41`), NOT `getLastSelectedObject`.
- **Legacy RVAs** (Utinni): `idManagerGetObjectById=0x00B380E0` (`swg/misc/network.cpp:39`),
  `cachedNetworkIdGetObject=0x00B30160` (**assignment at `:42`**, typedef at `:35`), `+1432` chain
  `game.cpp:733 → 745 → object.cpp:260-268 → network.cpp:84`, `setTransform_o2w=0x00B22CC0`,
  `setScale=0x00B23A10`.
- **396-byte channel layout** (Cursor, recomputed non-overlapping): read-frame `[4..319]`
  (`LIVE_READFRAME_BYTES=316`), host write `[320..387]` (cmd seq 320 / transform 324 / scale 372 / flags
  384), agent guard `[388..395]` (GUARD_STATUS 388, GUARD_ADDR 392). `contracts/live-inject.ts` is still the
  pre-05-01 **320-byte** stub — 05-01 lands the growth; treat 05-01 as authoritative over the stale comment.
- The standing **byte-exact round-trip gate** still governs DTII/STF (no parser merges without a cited
  swg-client-v2 loader + real-asset round-trip). DTII/STF native oracles: `DataTableWriter`,
  `LocalizedStringTableReaderWriter`. See 05-CONTEXT `<canonical_refs>` for the full list.

---

## Related memory
[[feedback-pause-after-plan-phase]] · [[feedback-crew-catches-what-plancheck-cannot]] ·
[[feedback-replans-can-inject-fabrications]] (the `:35`/`:42` citation slip is a live example) ·
[[feedback-sketches-are-ui-source-of-truth]] · [[swg-client-v2-advertised-hooks]] ·
[[reference-live-target-builds-in-scope]] · [[opus-cyber-safeguard-on-injection-planning]]
