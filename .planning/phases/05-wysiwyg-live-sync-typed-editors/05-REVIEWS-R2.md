---
phase: 5
round: 2
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-07-08
angles: {codex: "repo-tracer / ground-truth", cursor: "channel byte-layout + guard integrity", sonnet: "lateral / intent-closure", opus: "spec-correctness / invariants"}
plans_reviewed: [05-01-PLAN.md, 05-02-PLAN.md, 05-03-PLAN.md, 05-04-PLAN.md, 05-05-PLAN.md, 05-06-PLAN.md, 05-07-PLAN.md, 05-08-PLAN.md, 05-09-PLAN.md, 05-10-PLAN.md, 05-11-PLAN.md, 05-12-PLAN.md]
note: "Round-1 review is preserved at 05-REVIEWS-R1.md. This round reviews the --reviews replan that folded round-1 in."
---

# Cross-AI Plan Review — Phase 5, ROUND 2 (post-`--reviews` replan)

Four independent reviewers, each led with the just-applied fixes as **locked ground truth** (do not
re-derive) and pointed at a different open question. The round-1 BLOCKER and byte-level HIGHs are
confirmed genuinely closed. This round's signal is a **productive divergence** on two fronts: the
object-targeting scope, and the revert/guard safety model.

Overall this-round risk: **MEDIUM-HIGH** — not because the replan regressed, but because two of its
headline fixes solve a *narrower or different* problem than intended, and ground truth (Codex) shows a
better path exists. None require re-architecting; all are targeted.

---

## ⭐ Headline — Object targeting solves a DIFFERENT problem than the reported intent, and a stronger cross-build path exists (Sonnet + Codex converge)

**Sonnet (intent):** Round-1's complaint was "load a mesh in the viewport, drag the gizmo, and the
mesh you're viewing does NOT move — the player avatar does." The replan does **not** close this. It
closes a *different, narrower* problem: the live write now targets the **player's in-game UI look-at /
selected target** (via `getPlayerCreatureObject()+1432 → cachedNetworkIdGetObject`, legacy-only; gated
off entirely on the advertised build), falling back to the player. This has **zero relationship to the
asset loaded in the toolkit's 3D viewport** — the gizmo handles still bind to the local preview mesh
(05-10 Task 1). User-visible result after the fix ships:
- Drag gizmo → the local preview mesh moves cosmetically in the viewport (drei TransformControls), AND
- `writeTransform` fires at the player's live in-game target (or the player avatar) — an object
  generally **unrelated** to what's loaded. If the player happens to have another `womprat` targeted,
  the honest `target: <templateName>` HUD label can even *coincidentally match* the loaded mesh's name
  while being a different networkId — a false sense of correspondence.
- The round-1 scenario ("load a creature, drag, creature doesn't move") is **unchanged**; the fix makes
  the wrong-object behavior *honestly labeled*, not *correct*. The plans' claim to have "closed REVIEWS
  Sonnet HIGH" **oversells** it.

**Codex (ground truth) — the better path is real and source-reachable:**
- Arbitrary `NetworkId → Object*` resolver exists on **both** builds: `utinni::Network::getObjectById`
  (legacy literal `idManagerGetObjectById = 0x00B380E0`, network.cpp:39; advertised
  `NetworkIdManager::getObjectById` at engine_advertise.cpp:707, impl NetworkIdManager.cpp:72-79).
- The **advertised** build has a direct viewed/world-picked object path:
  `SwgCuiHud::getLastSelectedObject()` (engine_advertise.cpp:703-704), wrapped by Utinni as
  `CuiManager::getSelectedObject()` (cui_manager.cpp:183-205).
- No direct `template → live Object*` resolver — template targeting needs a known networkId or an
  enumeration/search path.

**Net:** the plan's legacy-only "player's look-at target" is **not the ceiling**. A cross-build
"target the selected/picked object" or "attach by networkId" mechanism is source-reachable. This is a
**maintainer scope decision** — see "Decisions needed" below.

---

## 🔴 HIGH — Revert's unconditional guard rebaseline (Sonnet HIGH vs Opus "safe"; reconciled)

`revertWrite`/`revertAll` (05-07 Task 2) send `writeRebaselineGuard` **then** the revert write,
**unconditionally on every revert**, regardless of current `guardState`; the button is always clickable.

- **Sonnet (HIGH):** rebaselining to *current live bytes* immediately before the revert-write trivially
  makes the guard pass, so **every revert silently discards whatever external change the guard would
  have caught**, with no diff/confirmation of what the external change was. The two-step sequence
  *together* is functionally a force-write **for the revert case** — the exact category "no force-write
  affordance exists" (D-03) was meant to prevent.
- **Opus (LOW, fails-safe):** verified the value ever passed to `setTransform_o2w` is only the toolkit's
  own snapshot — never the tamperer's bytes — and a second tamper landing between rebaseline and
  revert-write re-blocks. So there is **no forward force-write of foreign data**; it fails safe.

**Reconciliation (both correct, different lenses):** memory-SAFE (Opus) but an **intent/UX safety gap**
(Sonnet) — revert always proceeds and silently overwrites an external change without surfacing it.
**Agreed fix:** only rebaseline when `guardState === 'blocked'` (Opus's round-1 framing), and have the
reverted-banner state what external change was discarded. Medium-to-High; cheap.

**Opus also found a related liveness bug:** rebaseline and revert are two commands on a single-slot,
seq-keyed channel. Fired back-to-back synchronously, the agent may poll only the later `writeTransform`
(seq N+1) and miss the rebaseline (seq N) → the revert runs against the un-rebaselined baseline and
stays **blocked**, defeating the un-stick purpose. Fails safe, but flaky. Fix: ack-gate the revert on an
observed guard-status clear, or coalesce rebaseline+revert into one "apply-after-rebaseline" command.

---

## 🔴 HIGH — W2 confirmed worse than a warning; clean fix identified (Cursor + Sonnet)

`SCALE_REFUSED` (guard bit `0x2`) is set for **two unrelated causes** (05-03): a genuine scale tamper
(`!scalePassed`) OR `setScale` simply being unresolved (`!swg::endpoints::setScale`). On the advertised
build before the maintainer adds the optional upstream `object::setScale` row, `setScale` stays
permanently null, so **any** Scale interaction latches `SCALE_REFUSED` for the whole session, and 05-11
renders the locked **tamper** banner ("The object's memory changed outside the toolkit… the game or
another tool moved it") + flips the card to danger-border — **factually false**; nothing moved, the
setter doesn't exist. This fires on **essentially every advertised-build UAT run** (05-12), misdirecting
debugging toward a nonexistent tamper/race.

- **Cursor** traced that the renderer **cannot** distinguish the two causes from data on the channel
  today (`targetUnavailableOnBuild` bit3 is orthogonal — it's about target resolution, not `setScale`).
- **Cursor's recommended fix (least total change, matches the existing honest-degradation idiom):** stop
  setting `SCALE_REFUSED` for `!setScale` alone; add **liveness bit4 `scaleUnavailableOnBuild`**
  (mirror of bit3 `targetUnavailableOnBuild`), set once after resolve when
  `isAdvertisedClient() && setScale == nullptr`. **Zero channel-size growth.** 05-07 decodes it; 05-11
  precedence: `scaleUnavailableOnBuild` → "Scale unavailable on this build" (reuse 05-10's
  disabled-with-reason pattern); `guardState.scale === 'blocked'` *without* that flag → tamper banner.
  Preferred over a new `GUARD_STATUS` bit (same 4 touch points but grows the guard word).

---

## 🟠 MEDIUM — Fix D (interior read-back) holds only for STATIC cells (Opus + Sonnet)

Both verified the premise against `Object.cpp:1450-1470` and the fix against `getTransform_o2w`
(1418-1446): refreshing `s_expectedTransform` from a fresh `getTransform_o2w(focus)` read-back correctly
survives **static** non-world-cell/interior objects (buildings), because the read-back returns the
reconstructed world matrix that the next frame also reproduces deterministically. **Residual (fails
safe):** for a **dynamically-moving parent** (`m_attachedToObject` = a mount/vehicle/POB ship), the
world-space read-back drifts every frame as the parent moves → guard false-fails write N+1 independent
of any tamper. Rare for a modding tool's edit targets; correct behavior (fail-closed) but the plan's
unqualified "survives non-world-cell objects" **overstates** — it's *static* non-world-cell only. Add a
one-line caveat.

## 🟠 MEDIUM — Off-thread setter race amplified (Opus)

Writing **both** setters plus the new off-thread resolution chain (`getPlayerCreatureObject` → `+1432`
deref → `cachedNetworkIdGetObject`) widens the pre-existing race: the sim thread can delete/relocate the
resolved `focus` between resolution and the setter call → write-to-freed / torn state. The 4-sentinel +
torn-read checks guard *reads*, not the setter's target lifetime. Pre-existing MEDIUM, amplified, not
newly created. Add the 05-12 sustained-drag/attached-parent UAT watch item (already partly planned).

## 🟡 LOW / hygiene (confirmed)

- **Byte layout is sound** (Cursor): 396-byte layout non-overlapping and identical across 05-01/04/07;
  `LIVE_READFRAME_BYTES=316` math correct; host seqlock payload 324..387 does not touch
  `GUARD_STATUS`/`GUARD_ADDR` (388..395). **Minor plan-text defect:** 05-04 `must_haves` says the host
  WriteCommand span ends at **391** (incl. guardStatus); the actual memcpy ends at **387** — fix the
  prose to 387. (Shipped `contracts/live-inject.ts` + `channel_binding.cpp` are still 320-byte — that's
  expected; 05-01 lands the growth.)
- **W1 (STF sourceCrc copy) genuinely closed** (Sonnet) — old "auto on save"/"CRC32 auto" strings gone,
  grep-banned; UI-SPEC reconciled this session.
- **"No scale read accessor exists"** (05-03) **overstates** (Opus): `Object::getScale()` exists
  (Object.h:512-515); the accurate claim is "the agent binds no `getScale` RVA." The verbatim-store
  argument (`setScale` does `m_scale = scale;` at Object.cpp:2205) makes the read-back genuinely
  unnecessary, so the conclusion is safe — only fix the phrasing.
- **`+1432` numeric offset is comment-backed, not independently proven** (Codex): Utinni returns
  `(swgptr)playerObj + 1432` (game.cpp:733) with a "lookAt-target slot" comment; swg-client-v2 confirms
  `CreatureObject::m_lookAtTarget` is a `CachedNetworkId` current-target field (CreatureObject.h:707-708)
  distinct from own id `Object::m_networkId` (Object.h:444) — but no source independently proves the
  literal `1432` equals that member. The *semantics* (it's the target, NOT networkId) are corroborated,
  so Fix E (never read it as networkId) is correct regardless; the numeric offset stays a harvested
  constant to validate live.

---

## Cross-check divergences (the instrument working)

- **Revert-rebaseline:** Opus "LOW, fails-safe (no forward force-write of foreign data)" vs Sonnet
  "HIGH, silently discards external change every revert." Both true; reconciled above → gate on
  `blocked` + surface the discarded change. Neither is a memory-corruption hole.
- **Targeting ceiling:** the plan (and its self-assessment) assumed player-look-at-target was the
  reachable mechanism; Codex's ground-truth read found `getObjectById` (both builds) +
  `getLastSelectedObject`/`getSelectedObject` (advertised) — a stronger path the plan didn't consider.

## Agreed strengths (2+ reviewers, confirmed still-good)

- Round-1 BLOCKER (setScale-crash) structurally closed: null-seed + `!isAdvertisedClient()` conditional
  install + call-only-if-non-null, grep-verified (Codex, Cursor, Opus).
- 396-byte layout clean and consistent; `LIVE_READFRAME_BYTES` over-copy fix genuinely prevents the
  latent stomp (Cursor, Opus).
- Interior read-back fix and scale-guard-asymmetry are mathematically sound and fail-safe (Opus).
- All cited target/write RVAs confirmed against real Utinni source (Codex).

---

## Consensus risk

| Track | Verdict |
|---|---|
| Codex (ground truth) | MEDIUM — RVAs confirmed; `+1432` comment-backed; a stronger resolver exists |
| Cursor (channel integrity) | MEDIUM — layout sound; `SCALE_REFUSED` overload will show false-tamper UX |
| Sonnet (intent/lateral) | MEDIUM-HIGH — targeting solves the wrong problem; revert = unconditional bypass |
| Opus (invariants) | LOW — all fixes fail-safe; two non-safety items (revert race, wording) |

---

## Decisions needed from the maintainer (before another `--reviews` round)

1. **Object-targeting scope.** The delivered capability = "nudge the player's in-game target / player,"
   NOT "move the mesh you're viewing." Codex found a source-reachable stronger path on **both** builds
   (`getObjectById` by networkId; advertised `getSelectedObject`/pick-under-cursor). Choose:
   (a) **Accept the narrow capability** as the Phase-5 ceiling — but correct the plans' overclaim
       (stop saying it "closes" the round-1 viewport-mesh finding) and make the HUD copy state plainly
       that it moves the in-game target/player, not the loaded asset; OR
   (b) **Pursue the stronger path** — add a `getObjectById`/`getSelectedObject` resolver so the gizmo
       can target a selected/picked live instance (materially larger; new agent capability; the only
       route that actually satisfies "move what you're viewing"). Codex confirms it's reachable.
2. **W2 fix** — apply Cursor's liveness-bit4 `scaleUnavailableOnBuild` split (recommended; zero layout
   growth) so advertised-build Scale shows honest "unavailable on this build," not the tamper banner.
3. **Revert model** — gate the guard-rebaseline on `guardState === 'blocked'` + surface the discarded
   external change; ack-gate or coalesce the two-command revert to fix the miss-the-rebaseline race.
4. **Minor** — 05-04 prose 391→387; "no scale accessor exists" → "agent binds no getScale RVA"; add the
   Fix-D static-cell caveat; add the off-thread sustained-drag/attached-parent UAT watch item.

To fold these in: `/gsd:plan-phase 5 --reviews` (after deciding #1).
