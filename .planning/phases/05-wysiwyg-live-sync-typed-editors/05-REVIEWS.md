---
phase: 5
round: 3
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-07-09
angles: {codex: "repo-tracer / targeting ground-truth", cursor: "channel byte-layout + guard-state integrity", sonnet: "lateral / intent-closure", opus: "invariants / concurrency / fail-safe"}
plans_reviewed: [05-01-PLAN.md, 05-03-PLAN.md, 05-04-PLAN.md, 05-07-PLAN.md, 05-10-PLAN.md, 05-11-PLAN.md, 05-12-PLAN.md]
note: "Reviews the uncommitted round-3 --reviews replan that folded the four ROUND-2 maintainer decisions (targeting scope 1b, W2 scale-guard bit4, revert model, byte-prose). Round-1 = 05-REVIEWS-R1.md; Round-2 = 05-REVIEWS-R2.md. Full reviewer transcripts: .planning/research/CONSULT-05R3-*.out and the sonnet/opus agent transcripts."
---

# Cross-AI Plan Review — Phase 5, ROUND 3 (post-`--reviews` replan of the round-2 decisions)

Four independent reviewers, each led with the round-2 decisions as **claimed-applied** and pointed at a
different open question, with an explicit instruction to verify against real source rather than the
plan's own self-assessment prose.

**The good news is real and confirmed by ≥2 reviewers each:** the round-2 mechanical fixes landed. The
round-1 setScale crash BLOCKER stays closed; the W2 false-tamper-banner is fixed (bit4
`scaleUnavailableOnBuild`, zero channel growth); the two-command revert race is structurally closed by
coalescing into one seqlock write; the 396-byte layout is non-overlapping and consistent across
05-01/03/04/07; the 05-04 "391→387" prose defect is repaired; every advertised catalog row and legacy
RVA the replan cites **exists at the cited line** (Codex verified all of them against source).

**The bad news is that the replan's two headline changes — the stronger targeting path and the revert
coalesce — each opened a new HIGH-severity gap that the plan's own control flow provably contains, plus
the round-1 user-facing promise is still not met.** Opus found the two most serious (ungated rebaseline;
single-baseline-vs-per-frame-focus), both *intent-unsafe and provable from the plan text*, both fixable
with small local changes. This is the instrument working: the replan is not a regression, but it is not
yet executable as written on 05-03/05-07.

Overall this-round risk: **HIGH** — driven by two provable intent-unsafe invariant breaks on the live
write path (not crashes, not re-architecture; two localized fixes convert both back to fail-safe).

---

## 🔴 HIGH — The once-per-attach baseline was never reconciled with the new per-frame focus resolver (Opus; converges with Sonnet's intent gap)

**The deepest finding of the round, and it undermines the whole round-2 "move what you selected" goal.**
The replan resolves `focus` **every frame** (advertised two-step `getSelectedObject`; legacy `+1432`
chain), but both the agent's `s_expectedTransform/Scale` and the host's `cowSnapshot` are still captured
**once per session** against whatever was in focus at attach (the player), keyed to nothing — never
re-captured when focus changes. This directly contradicts locked **D-03 ("COW snapshot … captured per
object (once) … on first edit of an object")**.

Exact interleaving (from the plan's own control flow):
1. Attach with nothing selected → `focus = player`; baseline = **player's** pose.
2. User selects object O in-game → `focus = O` (different object, different transform).
3. User drags → `checkWriteGuard(live = O.transform, expected = player.transform)` → mismatch → **first
   write to O is refused, guard blocks.** (flaky/fail-safe facet)
4. To un-stick, `revertAll()` sends `cowSnapshot` = **player's** pose with REBASELINE → **force-writes
   the player's attach pose onto O → O teleports to a foreign pose** (intent-unsafe facet — not caught,
   because REBASELINE force-writes past the guard). The read-back then "heals" the baseline to that
   wrong pose.

On **legacy the host cannot even detect the focus change** (networkId is intentionally 0/unavailable per
Fix E), so it can't re-key. **Net: you cannot cleanly begin editing any object other than the one
focused at attach** — which is exactly the multi-object editing the round-2 scope decision (1b) was
supposed to enable. **Fix (small, local):** re-capture the agent baseline and host snapshot whenever the
resolved focus identity changes (networkId/templateName on advertised; raw `focus` pointer on legacy) —
minimum: agent resets `s_expectedCaptured=false` when `focus` differs from the pointer it captured
against.

---

## 🔴 HIGH — The revert coalesce introduced an ungated rebaseline that defeats the transform guard for an unbounded window (Opus; the scale side is Cursor's HIGH, same asymmetry from the other end)

The coalesce fix is correct in spirit but the rebaseline mutation is placed in the **outer
command-read scope**, gated only by "a command was read this frame," **not** by the
`cmdSeq != lastAppliedCmdSeq` newness gate that protects the apply. Because the command slot is
latest-wins, `channelReadCommand` re-reads the *same* REBASELINE command every frame until a new command
overwrites the slot — so the rebaseline **re-runs every frame** in the `[revert, next-command]` window.

Interleaving: frame 1 revert applied; frames 2..k the rebaseline harmlessly re-pins `s_expectedTransform`
to the live read; **frame 5 an external tool moves the object to X → the frame-5 rebaseline adopts X as
the baseline**; frame 6 the user drags → `checkWriteGuard(live=X, expected=X)` passes → **the drag
applies against a tampered object with no block and no disclosure.** The transform read-verify guard is
defeated for the whole window — the exact "no force-write affordance" category D-03 forbids, re-opened
for the post-revert window.

**The scale channel is asymmetric, and the two reviewers read the asymmetry from opposite ends
(productive divergence — both are right):**
- **Opus:** transform rebaselines to the *live* read (→ the defeat above); scale rebaselines to
  `cmd.scale` (a constant) — so scale is *not* defeated the same way. Frames it as: the transform side
  is the bug.
- **Cursor (HIGH):** because scale pins `s_expectedScale = cmd.scale` (the revert target) while
  `checkWriteGuard` compares live `currentScale` vs that expected, a **scale-only** blocked revert on
  legacy where the external scale tamper ≠ revert target **still fails the guard → does not un-stick.**
  The plan's "guard trivially passes" claim (05-03) is true for transform, **not generally true for
  scale.** Frames it as: the scale side is the bug.

**Reconciliation:** the rebaseline semantics are *inconsistent across channels* AND the transform one is
*ungated*. The single fix that satisfies both: (a) move the rebaseline mutation **inside** the
`cmdSeq`-new + non-torn guard so it is once-per-command and atomic with the apply (Opus suggestion 1),
and (b) make both channels rebaseline the **live** value at that gated instant, then apply the target
(so scale un-sticks like transform — Cursor suggestion 1). Add an acceptance grep asserting the
rebaseline assignment is lexically inside the seq-new guard.

---

## 🔴 HIGH — WYSIWYG intent still unmet: dragging the gizmo does not move the asset loaded in the viewport, and the plan now contradicts itself about it (Sonnet)

The replan gives the advertised build a **genuine, source-confirmed selection mechanism** it previously
lacked (before, advertised could only ever move the player) — that is real progress. But it creates **no
correspondence between the asset in the toolkit viewport and the live object that moves**. The plan says
so itself ("there is NO template→live-Object* resolver on either build … this plan does not attempt to
resolve 'the mesh loaded in the viewport' to a live instance; it resolves 'what the player has
selected/targeted in-game right now'"), and then a few lines later claims this round "actually closes"
the round-1 viewport-mesh finding. **Those two statements contradict each other.**

User scenario (round-1 bug, reproduced): modder loads a Stormtrooper mesh to pose it, attaches, does
**not** separately go select a Stormtrooper in-game (nothing tells them they must), drags → the player
avatar (or whatever was last selected) moves. Worse, if they loaded `womprat` and happen to have an
**unrelated** `womprat` NPC selected in-game, the honest `target: womp_rat` HUD label *coincidentally
matches* while pointing at a different networkId — a false sense of correspondence with no in-product
warning. And the **05-12 UAT is worded around the gap** ("with an object loaded in the viewport *matching
the live focus object from step 1b*") — it pre-arranges the one scenario where the gap is invisible, so
sign-off would never surface it.

This is a MEDIUM/HIGH depending on how LIVE-03 is marked "done." **Cheap honesty fixes (no new
resolver):** (1) the toolkit already knows both the loaded asset's name and `verifiedState.templateName`
— render an inline `⚠ viewing <loaded>, moving <target>` when they differ; (2) rewrite the "corrects the
overclaim" note in 05-03 so it doesn't itself overclaim ("makes the fallback real/symmetric on both
builds; does NOT close the viewport↔live-object binding gap, which remains open until Phase 7 `.ws`");
(3) add a UAT step that deliberately tests the *mismatch* case and records the maintainer's
acknowledgement; (4) soften LIVE-03 status language wherever it is marked complete.

---

## 🟠 MEDIUM — Off-thread setter/resolver lifetime + concurrency race (Codex MEDIUM + Opus HIGH-memory-unsafe; two reviewers, independent convergence — plan correctly accept-watches, does not overclaim)

Both builds collapse target identity to a raw `Object*` and write through it. Codex traced the advertised
path to `SwgCuiHud::getLastSelectedObject()` returning `m_lastSelectedObject.getPointer()` — a
`Watcher<Object>` whose `getPointer()` yields a raw `T*` that is **not watcher-protected** once the agent
stores it; the setter mutates through it (`Object::setTransform_o2w` at `Object.cpp:1450`, object
teardown at `Object.cpp:846-916`) with no source-evident lock. Opus adds two dimensions: (a) the agent is
a **separate `Sleep(16)` poll thread**, not a per-frame main-thread hook (so the brief's "each client
frame" model is not what's implemented — this is the *root enabler*), which means `setTransform_o2w` also
**data-races** the main thread's reads of client render/collision/notification lists even when `focus`
stays alive; and (b) the advertised two-step resolver has an **intermediate `hudInstance` pointer**
window (null-checked ≠ live — the HUD mediator can be torn down between `g_instance()` and `getTarget()`).

This is genuinely **memory-unsafe and unmitigated**, but the plan's **accept-watched** disposition
(T-05-32/37/38 + the 05-12 UAT watch item) is a defensible call for a single-user desktop tool, and it
correctly does **not** claim the guard covers it. **Mitigation (bounds, doesn't solve):** wrap the
resolve→read→apply span in SEH (`__try/__except`) so a UAF degrades to a skipped frame + a published
fault liveness bit instead of a client crash; name the intermediate `hudInstance` window explicitly in
the UAT item.

---

## 🟠 MEDIUM — Guard/liveness wiring gaps on the renderer side (Cursor)

Layout is sound, but several decode/disclosure paths are under-specified:
- **`GUARD_ADDR` (offset 392–395) decode is not explicitly tasked in 05-07** — Task 2 decodes
  `GUARD_STATUS` but no action reads `GUARD_ADDR`, yet 05-11's guard-blocked banner and
  `lastDiscardedChange.addr` both need it. Add an explicit decode task + a synthetic-buffer test
  (`0xDEADBEEF` at 392).
- **`lastDiscardedChange` is transform-only** (05-07 snapshots `expectedTransform()`/`verifiedState.transform`)
  — a scale-only block discloses nothing; 05-11's reverted banner may misreport. Extend to
  `{transform?, scale?}`.
- **Liveness bit5 `scaleGuardUnavailableOnBuild` is published by the agent but decoded by nobody**
  (05-07 decodes bits 2/3/4 only) — on advertised builds with `setScale` resolved but the `m_scale`
  offset unconfirmed, the scale row can show "ok" while the guard is a self-compare. Either consume bit5
  as a fourth scale sub-state or document it as agent-only until the offset handoff closes.

---

## 🟡 MEDIUM/LOW — STOP can be overtaken on the latest-wins slot (Opus)

STOP is written to the **same single latest-wins slot** as drag commands. If a final gizmo-drag
`writeTransform` (seq N+1) lands after `writeStop` (seq N) but before the agent's next poll, the agent
reads only N+1 and **misses STOP** → the poll thread leaks until process exit (host `closeActiveChannel`
doesn't unmap the agent's own view), partially defeating the **D-04.1** "no poll-thread leak across
attach cycles" goal it was meant to fix. Fails safe (OS reclaims on exit) but flaky. **Fix:** give STOP a
dedicated sticky bit checked independently of `cmdSeq`, or have `detachUI` spin until it observes a
published "stopping" liveness bit before closing.

## 🟡 LOW (confirmed, hygiene)

- **Citation defect (Codex):** the replan re-cites `cachedNetworkIdGetObject` to `network.cpp:35`, but
  `:35` is only the **typedef** — the actual `= 0x00B30160` assignment is `network.cpp:42`. Also the
  Utinni path prefixes in the plan/task prose are slightly wrong: real files are `swg/misc/network.cpp`,
  `swg/game/game.cpp`, `swg/ui/cui_manager.cpp` (not `swg/network/…`, `swg/misc/game.cpp`,
  `cui/cui_manager.cpp`). Fix the citations; the RVAs and semantics are correct.
- **`lastDiscardedChange` sourced from stale host state (Opus LOW):** captured host-side at click time
  from a 1–2-frame-old `verifiedState`/`GUARD_ADDR`; a second tamper before the agent applies makes the
  banner name the wrong bytes. Prefer publishing the bytes the agent actually discarded at apply time, or
  soften the banner copy to not assert exact bytes.
- **Fix-D static-cell caveat is present and correct (Opus):** the plan no longer overclaims "survives
  non-world-cell objects"; the moving-parent case fails safe (false-block). **One compounding note:** a
  moving parent is perpetually blocked, so the only way to write is a REBASELINE revert — which then
  trips the HIGH ungated-rebaseline defeat above. Fixing the rebaseline gating closes this compound too.
- **bit4/bit5 "computed once after resolve" is safe (Opus verified):** inputs (`isAdvertisedClient()`,
  `setScale`-resolvedness, `s_advertisedScaleOffsetConfirmed`) are all immutable post-init — unlike
  `focus`, they are not per-frame quantities, so "once" is correct here.
- **`contracts/live-inject.ts` is still the pre-05-01 320-byte stub (Cursor):** expected — 05-01 lands
  the 396-byte growth; the plans extend, they do not fork. Executor must treat 05-01 as authoritative
  over the stale 320-byte comment.

---

## Cross-check divergences (the instrument working)

- **Rebaseline asymmetry — Opus vs Cursor read it from opposite ends.** Opus: transform-rebaselines-to-live
  is the defect (defeats guard); scale-pins-to-constant is fine. Cursor: scale-pins-to-constant is the
  defect (scale-only revert won't un-stick); transform-rebaselines-to-live is fine. **Both are correct
  about their channel** — the real problem is the two channels rebaseline *inconsistently*, and the
  transform one is *ungated*. One fix (gate it + rebaseline both to live at the gated instant) resolves
  both readings.
- **UAF severity — Codex MEDIUM vs Opus HIGH.** Codex scopes it to citation-accuracy-is-fine /
  runtime-lifetime-is-the-risk (MEDIUM); Opus escalates on the added off-main-thread data-race dimension
  (HIGH memory-unsafe). Reconciled: memory-unsafe and real, but accept-watched is defensible for a
  single-user tool — so it does not block, provided the SEH bound + UAT watch item land.
- **Targeting closure — Sonnet (still unmet) vs the plan's self-claim (closed).** Codex confirms the
  *mechanism* is real and reachable; Sonnet confirms the *user promise* ("move what you're viewing") is
  still not delivered because no template→live-object resolver exists. Not a contradiction — the plan
  built a real capability but mislabeled which finding it closes.

## Agreed strengths (≥2 reviewers, confirmed still-good)

- Round-1 setScale-crash BLOCKER stays structurally closed (Codex, Cursor).
- W2 fix genuinely lands: bit4 `scaleUnavailableOnBuild`, zero channel growth, correct precedence
  agent→05-07→05-11 (Cursor, Sonnet).
- Two-command revert race structurally closed by coalesce (Cursor, Sonnet, Opus) — *the original* race;
  see the new ungated-rebaseline defect it opened.
- 396-byte layout non-overlapping and consistent across 05-01/03/04/07; 05-04 "391→387" prose repaired
  (Cursor, recomputed).
- Every advertised catalog row + legacy RVA cited by the replan exists at the cited line; `cuiHud::getTarget`
  is the correct catalog key (Codex, against source).
- Fix-D static-cell caveat correctly added; revert-discard disclosure (`lastDiscardedChange` → banner) is
  a real, non-cosmetic honesty fix (Opus, Sonnet).

---

## Consensus risk

| Track | Verdict |
|---|---|
| Codex (targeting ground truth) | MEDIUM — every cited row/RVA is real; residual risk is raw-`Object*` lifetime, not citation accuracy (one `:35`→`:42` fix) |
| Cursor (channel + guard integrity) | MEDIUM — layout sound & consistent; one HIGH logic defect (scale rebaseline won't un-stick) + wiring gaps (GUARD_ADDR, scale-discard, bit5) |
| Sonnet (intent/lateral) | MEDIUM-HIGH — mechanical fixes real, but WYSIWYG promise still unmet and the plan overclaims closure; UAT hides the gap |
| Opus (invariants) | HIGH — two provable intent-unsafe breaks on the write path (ungated rebaseline; baseline-vs-focus); UAF unmitigated but accept-watched |

---

## Decisions needed from the maintainer (before the next `--reviews` round)

1. **Reconcile the baseline with per-frame focus (HIGH, do first).** Re-capture the agent baseline +
   host COW snapshot on focus-identity change (networkId/templateName advertised; raw `focus` ptr legacy)
   so D-03's per-object model holds and newly-selected objects are editable. Without this, the round-2
   scope decision (1b) does not actually deliver multi-object editing.
2. **Gate + unify the rebaseline (HIGH).** Move the REBASELINE mutation inside the `cmdSeq`-new + non-torn
   guard (once-per-command, atomic with apply), and rebaseline **both** channels to the live value at that
   instant so scale un-sticks like transform. Add the lexical-scope acceptance grep.
3. **Targeting honesty (HIGH or MEDIUM — your call on how LIVE-03 is marked done).** Either (a) add the
   cheap `⚠ viewing X, moving Y` HUD mismatch warning + fix the self-contradicting 05-03 note + add a
   deliberate-mismatch UAT step + soften LIVE-03 status language; or (b) accept the narrow capability and
   correct every "closes the round-1 finding" claim to "makes the fallback real on both builds; viewport↔
   live binding deferred to Phase 7 `.ws`."
4. **Accept-or-mitigate the off-thread UAF (MEDIUM).** Confirm accept-watched, and land the SEH bound +
   the explicit intermediate-`hudInstance` UAT watch item so a UAF degrades to a skipped frame, not a
   client crash.
5. **Wiring gaps (MEDIUM) + minors (LOW).** Task the `GUARD_ADDR` decode + test; extend
   `lastDiscardedChange` to per-channel; consume or document bit5; STOP sticky-bit; fix the `network.cpp:35`→
   `:42` citation and the Utinni path prefixes.

To fold these in: `/gsd:plan-phase 5 --reviews` (after deciding #1–#3). Findings #1 and #2 are small,
local, provable-from-plan-text changes; #3 is doc/UAT + one cheap HUD string; do not execute 05-03/05-07
as written until #1 and #2 land.
