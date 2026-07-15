---
phase: 5
round: 5
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-07-12
angles: {codex: "targeting/RVA ground-truth + FOCUS_TOKEN derivation + citations", cursor: "400-byte layout + FOCUS_TOKEN wiring", sonnet: "overclaim-purge completeness + HUD honesty", opus: "identity-unification invariants / concurrency / fail-safe"}
plans_reviewed: [05-01-PLAN.md, 05-03-PLAN.md, 05-04-PLAN.md, 05-07-PLAN.md, 05-10-PLAN.md, 05-11-PLAN.md, 05-12-PLAN.md]
note: "Reviews the round-5 --reviews replan that folded the FOUR round-4 Path-A decisions (identity unification via FOCUS_TOKEN + host re-key + per-identity cache; overclaim purge; HUD name-only caveat; wiring/citation minors). Rounds 1-4 = 05-REVIEWS-R1..R4.md. Full transcripts: .planning/research/CONSULT-05R5-*.out (codex/cursor) + the sonnet/opus agent transcripts."
---

# Cross-AI Plan Review — Phase 5, ROUND 5 (post-`--reviews` replan of the round-4 Path-A decisions)

Four independent reviewers, non-overlapping angles, led with the round-4 changes as claimed-applied and
the locked ground truth up front. This round the only substantive design change was fix #1 (identity
unification); the crew was weighted toward it.

**Headline: risk drops again, round-4 MEDIUM → round-5 LOW-MEDIUM. Both round-4 MEDIUMs are CLOSED —
verified from control flow, each backed by a dedicated structural test (05-07:519 two-same-template
revert; 05-07:520 flip A→B→A). The layout growth to 400 bytes is byte-consistent across all five
touching plans and the new FOCUS_TOKEN rides the read-frame seqlock correctly. The overclaim purge and
HUD honesty items are genuinely closed.** The one real new finding: the fix itself opened a NARROWER,
unacknowledged fail-open — pointer-ABA on the never-invalidated identity cache (Opus). It is a *net
improvement* over the bug it replaces (needs a despawn+realloc coincidence, not an ordinary workflow),
but it must not ship labeled "no new issue." Opus's recommended close is small and offers two options.

Overall this-round risk: **LOW-MEDIUM** — no HIGH, no crash; one narrow new fail-open MEDIUM (recoverable,
single-user, allocation-coincidence-gated) + several LOW doc/UX residuals.

---

## 🟠 THE finding — pointer-ABA on the identity cache (Opus, NEW-ISSUE MEDIUM; the load-bearing result)

Fix #1 keys the host `identityCache` (and the agent's `s_expectedCapturedAgainst`) on a **raw x86
`Object*`** with **no invalidation and no eviction**. Codex confirmed the ground truth Opus's analysis
rests on: on the x86 target the token is the full pointer, so distinct *simultaneously-live* objects can
never alias — which is exactly why the round-4 two-rocks collision is gone. But *non-simultaneous* reuse
is unhandled:

1. Target A (`Object*`=0x0A000000) → drag → cache slot 0x0A000000 holds A's edited snapshot + writeLog.
2. A despawns (mob dies / cell change / cull) → client frees 0x0A000000.
3. Client allocates a NEW object C at the SAME 0x0A000000 (pooled/same-size realloc — routine in a live world).
4. Target C → agent publishes `focusToken=0x0A000000` → host `identityCache.get(0x0A000000)` **HITS A's
   stale slot** → Revert All sends A's stale pose → agent applies it to C. **Fail-open.**

It is a **dual** failure: the agent's `s_expectedCapturedAgainst` has the same blind spot, so C's first
legit edit also *false-tamper-blocks* (guard baseline is still A's). Amplified by unbounded cache growth
(Opus 3d, LOW): the cache never evicts within a session, so every stale slot is a future ABA landmine and
collision probability rises with session length; `captureSnapshotIfNeeded` also clones the whole Map per
flip (O(n)).

**This is narrower than the bug it replaces** (round-4 was a deterministic two-rocks workflow; this needs
a despawn+realloc address coincidence), so it is a genuine net improvement — NOT a regression. But the
plans nowhere mention pointer-ABA, and 05-07's T-05-41/42 claim CLOSED with no ABA caveat.

**Opus's close (small, pick one):**
- **(a) structural** — on every `identityCache.get(token)` **hit**, cross-check the stored slot's
  `templateName`/`networkId` against the current read-frame `state`'s; on mismatch treat as a NEW identity
  (evict+recreate) instead of restoring. Uses read-frame data already decoded — **no channel growth**.
  Converts every *cross-template* ABA into a safe miss for free. Add a **bounded LRU** to cap memory + the
  ABA window. (The narrow *same-template + networkId≡0 + realloc-at-same-address* residue — two rocks, one
  despawns and a rock reallocs at its address — still collides on legacy; that needs a generation counter
  or despawn signal and is reasonably accept-watched.)
- **(b) documented** — add an explicit accept-watched threat entry for pointer-ABA + unbounded growth, and
  a 05-12 UAT watch item for despawn-then-retarget.

With either in place, Opus: **safe to execute.**

---

## Both round-4 MEDIUMs — CLOSED (Opus, verified from control flow + tests)
- **Fail-open two-same-template revert: CLOSED.** Token = raw pointer (distinct per object, full value on
  x86 per Codex), so R2 gets its own fresh cache slot; Revert All can no longer send R1's pose to R2
  (05-07:410-421, test 05-07:519). The round-4 torn-pairing worry is also closed — FOCUS_TOKEN rides the
  SAME read-frame seqlock as transform/id/template (Cursor confirmed), so the host can never pair
  token-of-B with pose-of-A.
- **Lossy focus-flip A→B→A: CLOSED.** The per-identity `Map<focusToken, IdentitySlot>` restores A's
  original snapshot + writeLog verbatim on flip-back (05-07:410-414, test 05-07:520); writeLog is per-slot,
  the four fields swap atomically.

## 🟡 LOW residuals (fold into the same close)
- **Command-apply focus-skew (Opus, Item 1 LOW).** The command slot carries no identity, so a retarget in
  the ~1-2 frame gap between "Revert All" and the agent's `applyWrite(focus,…)` writes the snapshot pose
  onto whatever `focus` resolves that tick. The guard doesn't catch it (it checks external tamper, not
  intended-vs-current identity). Was a deterministic workflow pre-fix, now a tight race → accept-watch OK
  for a single-user tool; principled close is a command-slot `expectedFocusToken` echo (one more field).
- **HUD cache-restore not disclosed (Sonnet, LOW-MEDIUM).** The per-identity cache now *restores* a prior
  identity's writeLog on flip-back, but no HUD copy explains it — a modder could misread a resurrected
  write-log as stale/buggy data. Round 5 made the mechanism richer (restore vs. wipe) without extending
  disclosure. Backlog/round-6 UI-disclosure minor.
- **Two stale-prose lines in 05-01 (Cursor, LOW) — FIXED THIS SESSION.** `must_haves` said the command
  seqlock starts at "320+" (now 324+; 320 is FOCUS_TOKEN) and T-05-03 said "six" static_asserts (now
  seven). Both corrected in 05-01 on 2026-07-12.
- **x64 token-widening caveat (Codex, LOW/scope).** swg-client-v2 has x64 build scaffolding; if an x64
  client ever becomes a live-sync target, the 32-bit token would alias and must widen. Not a defect for
  the current x86 target — keep the caveat visible.

## Agreed strengths (≥2 reviewers, confirmed)
- **400-byte layout CLOSED and byte-consistent** across 05-01/03/04/07/12 (Cursor recomputed field-by-field;
  plan-checker agreed). FOCUS_TOKEN@320 inside the read-frame seqlock; host write span 324-391 never
  touches the agent-authoritative fields; STOP bit lands correctly on shifted GUARD_STATUS@392; seven
  static_asserts + total=400.
- **Overclaim purge complete** (Sonnet, grep-verified + confirmed this session): the banned phrase survives
  only in `#`-archived lines; 05-10's unauthorized (a)/(b) split is deleted.
- **HUD name-only caveat honest** (Sonnet): the "(name match only — not a verified object identity)" caveat
  fires in the MATCH case (test 05-11:369), killing the round-4 same-template false-reassurance; bit6 and
  `gotVerified` honestly handled with written, grep-checked rationale.
- **Ground truth accurate** (Codex): catalog citations corrected to 705/706/709; FOCUS_TOKEN = full x86
  pointer (no truncation); `getPlayer()` inside the `__try`; `Object::networkId` softening correct.
- **Hot loop unperturbed** (Opus Item 4): the per-tick token publish is additive (a struct-field set before
  the existing channelWrite), not a reordering — the round-3/4 CLOSED gated-rebaseline / SEH / read-back
  sequence is untouched.

---

## Cross-check convergences (the instrument working)
- **Opus (ABA fail-open) ← Sonnet (cache-restore not disclosed) ← Cursor (defers identity-risk to Opus).**
  All three touch the SAME new mechanism — the per-identity cache — from invariant, honesty, and layout
  angles. Opus finds it can fail open on address reuse; Sonnet finds its correct-restore behavior is
  user-invisible; Cursor confirms the byte-level wiring is sound and hands the identity semantics to Opus.
- **Codex ⟂ Opus on truncation.** Codex's firm x86-no-truncation answer is the ground-truth premise of
  Opus's ABA analysis (distinct *live* objects can't alias; only *reused-across-time* addresses can). They
  agree; the x64 caveat is a separate future concern.

## Consensus risk
| Track | Verdict |
|---|---|
| Codex (ground truth) | LOW — all citations/derivations accurate; only the future-x64 token-widening scope caveat to keep visible |
| Cursor (layout) | LOW-MEDIUM — 400-byte map CLOSED & consistent; two LOW stale-prose lines in 05-01 (fixed this session) |
| Sonnet (honesty) | HONEST-NOW on all four round-5 items; one LOW-MEDIUM HUD cache-restore disclosure gap |
| Opus (invariants) | LOW-MEDIUM — both round-4 MEDIUMs CLOSED (tested); one NEW narrower fail-open (pointer-ABA MEDIUM) + LOW cache-growth/command-skew |

**No HIGH remains.** Both round-4 MEDIUMs closed; the round-5 residue is one narrow new MEDIUM (pointer-ABA)
plus LOW doc/UX items — and Opus judges the remaining fix small with a documented-accept option.

---

## Decisions needed from the maintainer (before execute)

The only substantive fork is how to close the pointer-ABA (Opus's finding). Everything else is LOW and
either fixed this session (Cursor's two lines) or foldable as minors.

1. **Close pointer-ABA — choose (a) or (b):**
   - **(a) structural (most robust):** template/networkId cross-check on every `identityCache` hit
     (no channel growth) + a bounded LRU. Closes cross-template ABA for free; the narrow same-template
     realloc residue stays accept-watched. Lands in 05-07 (host cache) + 05-03 (agent re-key mirrors the
     cross-check) + a 05-12 UAT watch item. Requires a round-6 `--reviews` replan.
   - **(b) documented accept-watch:** add the pointer-ABA + unbounded-growth threat entry to 05-07 and a
     05-12 despawn-then-retarget UAT watch item; do NOT change behavior. Cheapest; ships the narrow ABA as
     a known single-user limitation.
2. **Fold the LOW minors either way:** HUD cache-restore disclosure copy (05-11); command-apply focus-skew
   note (accept-watch, 05-03/05-07 threat register); keep the x64 token-widening caveat visible (05-01/03).

Per the pause-after-plan rule, this is the maintainer's call — do not auto-advance to `/gsd:execute-phase`.
Note the convergence trend: rounds 4→5 each traded a fail-open bug for a strictly narrower one, and Opus
judges round 5 "safe to execute" once ABA is closed or documented — this is converging, not spiraling.

---

## MAINTAINER DECISIONS (2026-07-12 — Round 5, option (a) structural; resolve before executing)

The maintainer chose **(a) the structural ABA close** (most robust) over documented accept-watch. Fold
into a round-6 `--reviews` replan. Do NOT re-open any round-3/4/5 CLOSED work (the gated rebaseline, SEH
span, STOP bit, agent-side re-key mechanism, the 400-byte layout, both round-4 MEDIUMs' closures, the
overclaim purge, the HUD name-only caveat). Round 6 is additive: close the ABA + fold the LOW minors.

1. **Close pointer-ABA structurally (Opus option a).**
   - **05-07 (host cache):** on every `identityCache.get(focusToken)` **HIT**, cross-check the stored
     slot's `templateName`/`networkId` against the current read-frame `state`'s values (both already
     decoded — NO channel growth). On mismatch, treat as a NEW identity: evict the stale slot and create a
     fresh one (a safe miss) instead of restoring it. This converts every *cross-template* ABA into a safe
     miss. ADD a **bounded LRU** to the cache (suggest cap ~64 distinct identities — enough for a session's
     edited objects; caps memory + the ABA window). Acceptance criteria: (a) a cross-check test — a cache
     hit whose stored templateName/networkId differs from current state does NOT restore, it recreates;
     (b) an LRU-eviction test proving the cache never exceeds the cap.
   - **05-03 (agent re-key — mirror the cross-check to close the DUAL blind spot):** the agent's
     `s_expectedCapturedAgainst` is also the raw pointer, so C@A's-address currently skips re-capture.
     Store the captured-against `templateName`/`networkId` alongside `s_expectedCapturedAgainst`, and
     re-capture (`s_expectedCaptured=false`) when the resolved focus's pointer differs OR its
     templateName/networkId differs from what was captured (the agent already reads these each tick for the
     read frame — no new reads). Acceptance criterion: a grep/behavior check proving the re-key condition
     includes the identity cross-check, not just the pointer compare.
   - Residue to accept-watch (do NOT try to fully close): *same template + legacy networkId≡0 + realloc at
     the same address* (two rocks, one despawns and a rock reallocs at its address) still collides —
     needs a generation counter or despawn signal, out of scope; cover it with the 05-12 UAT watch item
     below and a threat-register note.
2. **Fold the LOW minors:**
   - **05-11:** add brief HUD copy explaining that the write log restored on retarget-back is intentional
     cached history (so a modder doesn't misread a resurrected write-log as stale/buggy data — Sonnet).
   - **05-03/05-07 threat register:** add an accept-watched note for the command-apply focus-skew (the
     ~1-2 frame Revert-All-then-retarget race — Opus Item 1 LOW) and for the same-template-realloc ABA
     residue.
   - **05-12:** add a despawn-then-retarget UAT watch item (target A, edit it, force A to despawn, target a
     freshly-spawned object, confirm no stale pose/history bleeds through).
   - **05-01/05-03:** keep the x64 token-widening caveat visible (Codex) — a comment noting the 32-bit
     FOCUS_TOKEN assumes the x86 live target and must widen if an x64 client is ever supported.
   - The two Cursor stale-prose lines in 05-01 were already fixed this session (no action).
