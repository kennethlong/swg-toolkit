---
phase: 5
round: 4
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-07-12
angles: {codex: "targeting/RVA ground-truth + citations", cursor: "channel byte-layout + guard/wiring integrity", sonnet: "intent-closure / honesty", opus: "invariants / concurrency / fail-safe"}
plans_reviewed: [05-01-PLAN.md, 05-03-PLAN.md, 05-04-PLAN.md, 05-07-PLAN.md, 05-10-PLAN.md, 05-11-PLAN.md, 05-12-PLAN.md]
note: "Reviews the round-4 --reviews replan that folded the FIVE round-3 maintainer decisions (baseline re-key, gated rebaseline, targeting honesty option-a, SEH UAF mitigation, wiring/citation minors). Round 1 = 05-REVIEWS-R1.md; Round 2 = 05-REVIEWS-R2.md; Round 3 = 05-REVIEWS-R3.md (carries the round-3 maintainer decisions the round-4 replan consumed). Full reviewer transcripts: .planning/research/CONSULT-05R4-*.out (codex/cursor) + the sonnet/opus agent transcripts."
---

# Cross-AI Plan Review — Phase 5, ROUND 4 (post-`--reviews` replan of the round-3 decisions)

Four independent reviewers, each led with the round-3 decisions as **claimed-applied** and pointed at a
different angle, with the LOCKED ground-truth axioms up front and an explicit instruction to verify
against real source, not the plan's self-assessment prose.

**Headline: risk drops from round-3 HIGH to ROUND-4 MEDIUM. The two provable round-3 HIGHs are CLOSED
on the agent side — one of them structurally proven by a checkable grep, not prose. No reviewer found a
new HIGH.** But the round-4 fix for decision #1 (baseline re-key) was applied with a **host/agent
identity-key mismatch** that reopens a *narrower, MEDIUM, fail-open* version of the same wrong-object
write on the legacy target — and this converges, from a completely different angle, with Sonnet's
finding that the new HUD honesty-warning leans on the same non-unique identity signal. That convergence
is the signal of the round.

Overall this-round risk: **MEDIUM** — no crash, no provable HIGH; two ordinary-workflow-reachable
MEDIUM fail-modes on the legacy revert path (both rooted in one design fault), plus a surviving
overclaim and a name-only HUD false-reassurance. All fixable with one focused round-5 pass.

---

## 🔶 THE CONVERGENT FINDING — template-name is not a unique object identity, and round-4 leaned on it in two places (Opus invariant + Sonnet honesty, same root cause from opposite ends)

Two reviewers, blind to each other, on different surfaces, landed on the same defect: **the round-4
additions treat `templateName` as if it identified a specific live object. It does not** — SWG worlds
are full of duplicated props (rocks, crates, furniture) that share one `.iff`, and on legacy
`networkId ≡ 0` for every focus object (Fix E, LOCKED), so template-name is the *only* discriminator
left. Both places this identity is used are unsound.

### 🔴→🟠 Opus (invariants, MEDIUM, **fails OPEN**, legacy revert path): host re-key uses a coarser identity key than the agent
The agent re-keys the baseline on the **raw `focus` pointer** (`05-03:760`). The host re-keys
`cowSnapshot`/`writeLog` on **`(networkId, templateName)`** (`05-07:342-343`). On legacy that key
collapses to `(0, templateName)`. Interleaving (two same-template rocks R1, R2):
1. Target R1, drag → host `cowSnapshot=(R1_xform, 0, "rock.iff")`, `writeLog` grows.
2. Re-target R2 → agent re-keys (`R2_ptr != R1_ptr`), captures R2's own baseline. **Host:
   `(0,"rock.iff")==(0,"rock.iff")` → `identityChanged=false` → cowSnapshot/writeLog NOT re-keyed;
   still R1's.**
3. Revert All → host sends `cowSnapshot.transform = R1_xform` (guard `'ok'`, `05-07:388`) → agent's
   focus is R2, guard `R2_live vs R2_baseline` passes → **applies R1's pose to R2.**

This is the *same* wrong-object force-write the round-3 HIGH was about, resurfacing through the host's
coarser key. **Fails OPEN** (writes a pose the user never asked for); trigger is an ordinary WYSIWYG
workflow (two same-template objects + a revert), not a race. `revertWrite` corrupts the same way.
Certain on legacy; **possibly advertised too** — these plans never bind a `getNetworkId` for the
advertised focus object, so if advertised focus `networkId` is also unpopulated the gap extends (not
established this round — claimed certain only for legacy).

### 🟠 Sonnet (honesty, MEDIUM-HIGH): the new ⚠ warning is silent in the same-template coincidence case
05-11's inline `⚠ viewing <loaded>, moving <target>` warning compares **filename-basename vs
`verifiedState.templateName`-basename only** (`05-11:262-267`). Load `womprat`, have an *unrelated*
`womprat` NPC selected → names coincidentally match → **no warning fires, and `target: womprat` reads
as confirmation** while an unrelated object moves. This is the exact false-reassurance failure mode
ground truth flagged **twice** (`05-REVIEWS-R2.md:35-37`, `05-REVIEWS-R3.md:112-114`). A phase-wide grep
for any disclosure that the comparison is name-only/fragile (`coincidence`, `different networkId`,
`name-only`, `fragile`) returns **zero hits in any plan file**. The round-4 fix closed the
visibly-differing-names case but silently reintroduced the same-name-different-instance case — *more*
misleading than no warning, because it looks like confirmation.

**Shared remediation:** unify identity so both surfaces key on the object the agent actually resolved.
Opus's concrete fix (rec #1): the agent already truncates `addrOf(focus)` but only into `GUARD_ADDR` on
apply (`05-03:849`) — instead publish the focus pointer/token in the **read frame every tick** and have
the host re-key on THAT (host and agent can then never disagree about which object the baseline belongs
to). With a real focus token, the HUD warning can also compare identity, not just name — or, minimum,
disclose that its match is name-only.

---

## 🟠 MEDIUM — focus-flip A→B→A silently destroys the original baseline + undo history (Opus, NEW-ISSUE, fails safe but lossy)
The host `cowSnapshot`/`writeLog` is a **single slot**, and a re-key **overwrites** it and **resets
`writeLog`** (`05-07:342-357, 544`). Flip A→B→A: frame 2 re-captures B and discards A's history; frame 3
re-captures A's **already-edited** pose with an empty log. After the flip, A's original baseline and
per-write undo are **permanently gone** — `revertAll` reverts A to its edited pose (a no-op vs. intent),
`revertWrite` has nothing. Fails *safe* (won't itself force a wrong write) but silently defeats
revert-to-original, a WYSIWYG-integrity regression the round-4 reset introduced and the plan does not
disclose. Also reinforces the Change-#1 host gap: a ≤1-frame host↔agent focus-disagreement window is
reachable through the coalesced-rebaseline revert path (same fail-open class, narrower timing).
**Fix:** replace the single slot with a small per-identity snapshot+writeLog cache so flip-back restores
rather than re-captures (Opus rec #2).

---

## 🟠 MEDIUM-HIGH — the banned "closes ... for real" overclaim survives in two prominent sections (Sonnet)
The decision-1b block in 05-03 was fixed in place (`05-03:104-118`, honest verbatim). But the exact
phrase the maintainer ordered struck survives in two high-visibility spots a checker treats as
definitive, not archived history:
- `05-03:1057` (success_criteria — "what this plan proves"): "...closes the round-1 Sonnet HIGH finding
  for real...".
- `05-10:311` (T-05-30 threat row, untouched by the round-4 pass): "...closes REVIEWS.md Sonnet HIGH
  finding for real this round...".
Worse, 05-10's round-4 note (`05-10:27-35`) invents a two-part **(a)/(b) split** to justify keeping the
phrase for sub-item (a) — a reframing **not authorized** by the reviewers' own reconciliation
(`05-REVIEWS-R3.md:214-217`, which is explicit this is a *single* mislabeled finding). **Fix:** strike
both phrases; delete the unauthorized (a)/(b) split; match the scoped language the same files' objective
sections already use.

---

## 🟠 MEDIUM — wiring/disclosure gaps (Cursor + Sonnet)
- **`GUARD_ADDR` → 05-11 guard-blocked banner (Cursor).** Decode is correctly tasked in 05-07 (offset
  392 + `0xDEADBEEF` synthetic test), but 05-11's guard-blocked banner action references abstract
  "`GUARD_ADDR`" rather than naming `liveStore.guardAddr` (the reverted-path already does) — an executor
  could redundantly re-decode in the component. Spec ambiguity. **Fix:** name `liveStore.guardAddr` /
  `formatAddr(guardAddr)` in 05-11's guard-blocked `<action>`.
- **Scale-only `lastDiscardedChange.got` degraded (Cursor).** Shape `{addr, transform?, scale?}` and
  per-channel wiring are CLOSED, but a scale-only block may fall back to `expectedScale()` when no
  renderer live-scale decode exists (`05-07:378-382`), so `got` can equal `expected` and weaken the
  "found <bytes>" disclosure. **Fix:** source scale `got` from a live read, or soften the banner copy.
- **`agentFaultRecovered` (bit6) has no UI consumer (Sonnet).** 05-03 publishes it on a caught SEH fault
  but nothing decodes/renders it (unlike bit5, which 05-07 explicitly documents as agent-only). A fault
  near live game memory would tell the modder nothing beyond an imperceptible skipped frame. **Fix:**
  give bit6 a disclosure path, or explicitly document it agent-only like bit5.
- **Silent write-log wipe on re-key unexplained in HUD (Sonnet, lower).** Correct per D-03, but no
  client-card copy explains why the write log emptied on retarget; a modder could misread it as a bug.

---

## 🟡 LOW (confirmed, hygiene)
- **Advertised catalog row citations drifted +2 (Codex).** 05-03 cites `engine_advertise.cpp:703/704/707`
  for `cuiHud::getTarget`/`cuiHud::g_instance`/`network::getObjectById`; Codex's re-read of current
  source puts them at **705/706/709** (exact key strings + `__thiscall` convention all still match — only
  the line numbers drifted). Fix the three line citations. *(The round-3 axioms carried 703/704/707 too —
  this is fresh drift the crew caught, [[feedback-crew-catches-what-plancheck-cannot]] again.)*
- **"Only identity source" too strong (Codex).** 05-03 calls the raw-pointer re-key the only legacy
  identity option, but `Object::networkId` is a real flat field at `object.h:86`. (Note: this is exactly
  the field that, if read on legacy, would give the host a real per-object key and close the Opus MEDIUM
  above — worth considering alongside the identity-unification fix.)
- **SEH residual (Opus).** `getPlayer()` is resolved *before* the `__try` (`05-03:734-736`); a
  teardown-time AV inside it would escape. It's a stable global accessor and the deref happens inside the
  guard, so the object-deref mitigation holds — but pull `getPlayer()` inside the span for completeness.
- **Naming drift (Cursor).** `LIVE_GUARD_FLAGS.STOPPING` (TS) vs `GUARD_FLAG_STOPPING` (prose) —
  executor-clear, not a layout bug.

---

## Agreed strengths (≥2 reviewers, confirmed)
- **Change #2 (ungated rebaseline): CLOSED structurally** (Opus + Cursor). The rebaseline mutation is
  lexically inside the `cmdSeq`-new + non-torn gate that also gates the apply; enforced by a real
  `grep -n` line-order acceptance criterion (`05-03:1011`), not prose. No residue of the `cmd.scale` pin
  on any reachable path; scale now rebaselines from a live `currentScale` read, so a scale-only blocked
  revert genuinely un-sticks on legacy (Cursor's round-3 HIGH addressed).
- **Change #1 (baseline re-key): CLOSED on the agent side** (Opus + Cursor). A newly-selected object
  captures its OWN baseline before the guard runs; first write is not false-blocked. (Load-bearing
  assumption Opus flags: the 4-sentinel gate short-circuits the iteration on failure so `apply` never
  runs on a frame where `capture` was skipped.)
- **Change #4 (SEH): CLOSED** (Opus). The `__try/__except` spans the full resolve→read→apply including
  the advertised two-step `hudInstance` window; a UAF degrades to a skipped frame + transient bit6, not
  a crash. Grep-proven span (`05-03:1013`).
- **396-byte layout intact, STOP sticky bit zero-growth** (Cursor). `STOPPING=0x4` packs into
  `GUARD_STATUS` @388 without collision; agent publishes it before `channelClose()`; `detachUI` polls
  that bit. Layout sums to 396, matches locked axiom #3.
- **Targeting citations mostly fixed** (Codex). `network.cpp:42` literal / `:35` typedef confirmed; Utinni
  path prefixes fixed; `kLegacyScaleOffset=0x44` derivation sound as a VALIDATE-LIVE candidate; advertised
  key strings + calling convention correct.
- **UAT now surfaces the gap** (Sonnet). 05-12 step 1c is a REQUIRED deliberate-mismatch step; the old
  gap-hiding "matching the live focus object" wording is gone; LIVE-03 status language is correctly
  scoped everywhere except the two residual overclaim phrases.

---

## Cross-check divergences (the instrument working)
- **Identity fragility — Opus (invariant) vs Sonnet (honesty), independent convergence.** Opus proves the
  host re-key force-writes the wrong baseline on same-template legacy objects (fails open); Sonnet proves
  the HUD warning falsely reassures on the same-template coincidence. Neither saw the other's surface;
  both trace to "template-name ≠ object identity." One identity-unification fix addresses both.
- **UAF severity — Cursor (liveness-bit only, CLOSED) vs Opus (SEH span, CLOSED + LOW residual).** No
  conflict: Cursor confirms bit6 doesn't grow the layout; Opus confirms the span covers the derefs and
  flags only the pre-`__try` `getPlayer()`.
- **Change #1 — Cursor "CLOSED (plan text)" vs Opus "agent CLOSED, host STILL-OPEN".** Cursor scoped to
  the byte-map (host wiring is explicit); Opus scoped to the invariant (the host key is coarser than the
  agent's). Both right about their layer — the wiring exists, but keys on the wrong signal.

---

## Consensus risk

| Track | Verdict |
|---|---|
| Codex (targeting ground truth) | LOW — citations mostly fixed; two LOW residuals (catalog rows +2 line drift; "only identity source" overstated) |
| Cursor (channel + wiring) | MEDIUM — 396 layout & STOP bit CLOSED; two MEDIUM spec-ambiguities (05-11 guardAddr naming; scale-only `got` quality) |
| Sonnet (intent/honesty) | MEDIUM-HIGH — UAT + LIVE-03 language honest now, but two banned overclaims survive + the ⚠ warning is silent in the same-template coincidence case |
| Opus (invariants) | MEDIUM — both round-3 HIGHs CLOSED (one grep-proven); round-4 host re-key introduced a fail-open legacy revert MEDIUM + a lossy focus-flip MEDIUM, both rooted in the host/agent identity-key mismatch |

**No provable HIGH remains.** The blocking round-3 defects are closed; the round-4 residue is MEDIUM and
concentrated on the legacy revert path + honesty prose.

---

## Decisions needed from the maintainer (before execute)

1. **Unify object identity across host + agent (Opus rec #1 + #2) — the load-bearing fix.** Publish the
   agent's resolved focus token in the read frame every tick; re-key the host `cowSnapshot`/`writeLog` on
   THAT instead of `(networkId, templateName)`; and replace the single snapshot/writeLog slot with a small
   per-identity cache. Closes BOTH the fail-open legacy-revert MEDIUM (Change #1 host gap) and the lossy
   focus-flip MEDIUM (item 4). Alternative (cheaper, narrower): read the real `Object::networkId` field
   (`object.h:86`) on legacy to give the host a genuine per-object key — closes the fail-open case but not
   the single-slot flip loss.
2. **Purge the surviving overclaim (Sonnet).** Strike "closes ... for real" at `05-03:1057` and
   `05-10:311`; delete 05-10's unauthorized (a)/(b) split.
3. **Disclose the HUD name-only limitation (Sonnet).** Either compare on the unified identity token from
   #1 (best — kills the coincidence false-reassurance), or add a "name match ≠ same object" caveat so the
   coincidence case isn't silently reassuring.
4. **Minors:** bit6 disclosure-or-document (Sonnet); name `liveStore.guardAddr` in 05-11's guard-blocked
   banner + source scale `got` from a live read (Cursor); fix the +2 catalog citations (Codex); pull
   `getPlayer()` inside the SEH span (Opus).

**To fold these in:** `/gsd:plan-phase 5 --reviews` (round-5 replan reading this file). Decision #1 is the
only non-mechanical one — it is a small, local channel+host change, not a re-architecture. **Alternatively,
accept the two MEDIUMs as documented known legacy-revert-path limitations and proceed to execute** —
Opus's own fallback — since none is a HIGH and normal drag (the primary WYSIWYG path) is unaffected; only
the same-template revert and focus-flip-history cases degrade. Per the pause-after-plan rule, this is the
maintainer's call — do not auto-advance to `/gsd:execute-phase`.

---

## MAINTAINER DECISIONS (2026-07-12 — Path A: round-5 replan; resolve before executing)

The maintainer chose **Path A (round-5 replan, most robust)** over accept-and-document. Fold ALL FOUR
items below into the round-5 `--reviews` replan. None is a HIGH; all are MEDIUM/LOW. Do NOT re-open the
already-CLOSED changes (Change #2 rebaseline, Change #1 agent-side, Change #4 SEH span, the 396 layout,
the STOP bit, the UAT step) — they passed; only the round-4 residue below changes.

1. **Unify object identity across host + agent (Opus rec #1 + #2) — the FULL unification, not the cheaper
   networkId-read alternative.** The agent already truncates `addrOf(focus)` but only into `GUARD_ADDR`
   on apply (`05-03:849`). Instead: publish the agent's resolved **focus token/pointer in the READ FRAME
   every tick** (a new small read-frame field — mind the 396-byte layout in 05-01; grow it deliberately
   and update the `static_assert`s + the contract if a field is added, OR reuse an existing per-tick slot
   if one fits). Re-key the host `cowSnapshot`/`writeLog` on THAT token instead of `(networkId,
   templateName)` (`05-07:342-343`), so host and agent can never disagree about which object the baseline
   belongs to. AND replace the single `cowSnapshot`/`writeLog` slot with a **small per-identity
   snapshot+writeLog cache** so a focus-flip A→B→A restores A's original baseline + undo history rather
   than re-capturing its edited pose. Lands in 05-01 (read-frame field + layout), 05-03 (agent publishes
   the token per tick), 05-07 (host re-keys on the token + per-identity cache). Add acceptance criteria:
   (a) the host identity comparison references the published focus token, NOT `templateName`; (b) a
   two-same-template-object revert test proves object-2 is NOT force-written with object-1's pose; (c) a
   flip A→B→A test proves A's original baseline + writeLog are restored. Closes the fail-open legacy
   revert MEDIUM AND the lossy-flip MEDIUM.

2. **Purge the surviving overclaim (Sonnet).** Strike the exact phrase "closes ... for real" at
   `05-03:1057` (success_criteria) and `05-10:311` (T-05-30 threat row); **delete 05-10's unauthorized
   (a)/(b) split** (`05-10:27-35`) — it re-litigates a single mislabeled finding the reviewers'
   reconciliation (`05-REVIEWS-R3.md:214-217`) already settled. Match the scoped, honest language the same
   files' objective sections already use. Add an acceptance grep asserting no "for real"/"closes the
   round-1" overclaim phrase remains in 05-03 or 05-10 outside archived revision-note history.

3. **Disclose the HUD name-only limitation (Sonnet).** With decision #1's unified focus token available,
   prefer comparing the ⚠ `viewing X / moving Y` warning on the unified identity (kills the same-template
   coincidence false-reassurance outright). If a full identity compare isn't feasible in the HUD, minimum:
   add a "name match ≠ same object" caveat so the coincidence case is not silently reassuring. Lands in
   05-11. Add an acceptance criterion covering the same-template-coincidence case.

4. **Minors — APPLY ALL:** give bit6 `agentFaultRecovered` a UI disclosure path OR document it agent-only
   like bit5 (Sonnet); name `liveStore.guardAddr` in 05-11's guard-blocked banner `<action>` and source
   the scale-only `lastDiscardedChange.got` from a live read (Cursor); fix the advertised catalog
   citations to `engine_advertise.cpp:705/706/709` (Codex — keys/convention already correct, only the
   line numbers drifted +2); pull `getPlayer()` inside the `__try` span (Opus); soften the "only identity
   source" claim in 05-03 (Codex — `Object::networkId` exists at object.h:86).
