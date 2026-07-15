---
phase: 5
round: 6
reviewers: [opus, cursor]
reviewed_at: 2026-07-12
angles: {opus: "ABA-close invariants (both sides) + LRU/cross-check new hazards", cursor: "mechanical: no layout change, already-decoded fields, LRU soundness"}
plans_reviewed: [05-01-PLAN.md, 05-03-PLAN.md, 05-07-PLAN.md, 05-11-PLAN.md, 05-12-PLAN.md]
note: "LIGHT round-6 crew (Opus + Cursor only — Sonnet/Codex had no round-6 surface). Reviews the round-6 replan that folded round-5 maintainer decision (a): the structural pointer-ABA close (host identityCache cross-check + bounded LRU; agent s_expectedCapturedAgainst identity pairing). Rounds 1-5 = 05-REVIEWS-R1..R5.md. Transcripts: .planning/research/CONSULT-05R6-*."
---

# Cross-AI Plan Review — Phase 5, ROUND 6 (LIGHT: structural pointer-ABA close)

Two high-signal angles on the round-6 delta only (host cross-check + LRU in 05-07; agent identity-pairing
in 05-03). Everything else is LOCKED and was not re-reviewed.

**Headline: the reachable ABA paths are CLOSED on both sides and the layout is byte-identical to round 5
(zero new channel bytes/reads). Opus found ONE MEDIUM correctness pin that must land before execution —
the agent-side `templateName` compare is type-ambiguous and could silently no-op the fix — plus three
LOWs. Cursor confirmed all mechanics. Opus's final call: one more LIGHT turn (a one-paragraph
acceptance-criterion pin + minor folds), then safe to execute.**

Overall this-round risk: **LOW** — one MEDIUM pin (well-specified, tiny) + LOW doc/symmetry nits; no
layout change, no re-architecture, no reopened prior work.

---

## 🟠 MEDIUM — pin before executing: the agent-side `templateName` cross-check is type-ambiguous (Opus 3c-ii)
The agent stores `s_expectedCapturedAgainstTemplate` as `const char*` and the plan hand-waves the compare
("mirror whatever `templateName` already is", 05-03:1088-1090). If it compiles to a **pointer** compare:
- reused frame buffer → pointer always equal → the agent identity cross-check **always matches → the
  agent-side ROUND-6 fix silently no-ops**, reopening the agent half of the cross-template ABA it closes;
- fresh per-frame string → pointer always differs → **constant re-capture** → re-baselines the guard every
  tick, defeating tamper detection.
Only a **content/hash compare against a stably-owned captured copy** is correct. The acceptance criterion
(05-03:1133) is a **symbol grep** that cannot distinguish a pointer compare from a content compare, so a
"tests PASSED" agent build would hide this — the [[feedback-executor-integration-blind-spot]] pattern.
**Fix (one paragraph):** specify the agent compare is content/hash against a stably-copied captured value,
never a raw `const char*` pointer compare; ADD a **behavioral** acceptance test — same `focusToken` +
different template CONTENT must re-capture; identical content must not.

## 🟡 LOW (fold into the same turn)
- **Host/agent cross-check asymmetry (Opus 3c-i).** Host cross-check runs only inside the
  `identityChanged` (focusToken-changed) branch (05-07:449,477); the agent's is per-tick unconditional
  (05-03:838). In the exact-same-address, zero-intervening-frame reuse case `focusToken` is numerically
  unchanged → host says "not new" while agent says "different." **Unreachable this phase** (both resolvers
  force a player-fallback frame on target-null, so a focusToken transition is guaranteed), but it's an
  undocumented host-only dependency. **Fix:** either make the host cross-check run per-tick against the
  active slot's stored identity (~2 lines, erases the asymmetry and closes even the theoretical case), OR
  document the reliance on the player-fallback intervening frame.
- **Threat-ID mis-citation (Opus 2).** The round-6 revision-note prose cites the same-template residue's
  accept-watch home as T-05-45 (05-07:157) / T-05-49 (05-03:388) — those are the cross-template *mitigate*
  entries; the accept-watch homes are T-05-46 / T-05-50. Prose off-by-one; the register entries are correct.
- **Evicted-slot honesty note (Opus 3a residual).** An *inactive* slot you intend to return to can age out
  after 64 distinct targets, silently dropping its undo history (inherent to any bounded cache; 64 is
  generous). A one-line "LRU-evicted slots lose their history" note would be honest.
- **Overclaim scope (Opus 3c).** Scope the "closes every cross-template collision for free" / "neither side
  can silently disagree" claims (05-07:157,703-704) to "collisions involving a focusToken transition."

## Agreed CLOSED (Opus invariant + Cursor mechanical)
- **Cross-template ABA (rock A → crate C at A's address): CLOSED both sides** — host cross-check evicts+
  recreates on `rock.iff≠crate.iff`; agent re-captures on identity mismatch (Opus Item 1). Reachable via
  the forced player-fallback frame.
- **Same-template residue: CLOSED (correctly accept-watched, not overclaimed)** — host T-05-46 / agent
  T-05-50, both `accept (watched)`, referencing the 05-12 despawn-then-retarget UAT (Opus Item 2).
- **LRU cannot evict the ACTIVE slot (Opus 3a): CLOSED** — the active slot always holds the maximum
  `lastActiveMs` (becoming-active is what advances the token), so it can never be the evictor's minimum.
- **No torn-read false-evict (Opus 3b): CLOSED** — focusToken/templateName/networkId ride one read-frame
  seqlock; a torn frame → null → cross-check never runs; mid-load placeholder identities carry no history.
- **No channel-layout change, no new reads (Cursor 1-2): CLOSED** — 400 stays 400, offsets byte-identical
  to round 5; both sides' cross-checks reuse already-decoded `templateName`/`networkId` (zero new reads).
- **LRU mechanics sound (Cursor 3): CLOSED** — cap 64, `lastActiveMs` eviction, bounded-size test (65
  tokens → size never > 64). The two round-6 tests are distinct from the preserved round-4/5 tests
  (Cursor 4).
- **No regression on CLOSED paths (Opus 4): CLOSED** — pure additive comparison; the four-field slot swap
  stays atomic; `detach()` still resets the cache; `lastActiveMs` is cache-internal (05-10/05-11 untouched).

## Convergence (the instrument working)
Cursor mechanically confirmed the LRU cap/eviction/test AND handed Opus the exact invariant question it
couldn't resolve mechanically ("`lastActiveMs` not refreshed on same-object ticks; is the active slot
exempt from eviction?"). Opus resolved it CLOSED by the max-`lastActiveMs` invariant. Two angles, one
handoff, clean convergence — and Opus independently surfaced the type-ambiguity MEDIUM that is not visible
at the mechanical layer at all.

## Consensus risk
| Track | Verdict |
|---|---|
| Cursor (mechanical) | CLOSED — no layout change, no new reads, LRU sound, tests distinct; no blockers |
| Opus (invariants) | LOW — reachable ABA CLOSED both sides; ONE MEDIUM pin (agent template compare type) + 3 LOW nits |

**No HIGH. One MEDIUM correctness pin + LOW folds, then safe to execute** (Opus's explicit final call).

---

## Decision needed from the maintainer (before execute)
The remaining work is tiny and fully specified — Opus's item 1 is "a one-paragraph acceptance-criterion
addition," not a re-architecture. Fold into 05-03 (+ minor 05-07 doc):
1. **Pin the agent `templateName` compare (MEDIUM):** content/hash compare against a stably-copied captured
   value, never a `const char*` pointer compare; add the behavioral acceptance test (same token + different
   content → re-capture; identical → not).
2. **Fold the LOWs:** host per-tick cross-check symmetrization OR documented player-fallback dependency;
   T-05-45→46 / T-05-49→50 citation fix; evicted-slot honesty note; scope the two overclaim phrases.

Per the pause-after-plan rule, do not auto-advance to `/gsd:execute-phase`. This is the last correctness
pin the crew has surfaced; the trend (HIGH→MEDIUM→LOW-MEDIUM→LOW) is clearly terminating.

---

## MAINTAINER DECISION (2026-07-13 — direct-applied, no round-7 replan)

The maintainer chose **direct-apply** (proportionate to a one-paragraph fix). All items above were applied
inline this session and quick-checked (`verify.plan-structure` valid on both edited plans):
1. **MEDIUM pin — DONE (05-03):** `s_expectedCapturedAgainstTemplate` is now a STABLY-OWNED fixed buffer
   (`static char[k_templateNameLen]`); the compare is a CONTENT compare
   (`strncmp(templateName, s_expectedCapturedAgainstTemplate, k_templateNameLen) != 0`), NEVER a
   `const char*` pointer compare; capture is `strncpy` (copy, never alias). Added a **BEHAVIORAL**
   acceptance test (same focusToken + different templateName CONTENT → re-capture; identical → not) that a
   symbol grep cannot substitute for — a pointer compare fails it. Closes the Opus 3c-ii silent-no-op /
   constant-re-capture trap.
2. **LOW folds — DONE:** host/agent cross-check asymmetry documented in 05-07 as reliant on the
   player-fallback intervening frame (unreachable-otherwise, code unchanged per Opus 3c-i option b);
   citation slips fixed (05-03 T-05-49→T-05-50; 05-07 T-05-45→T-05-46); evicted-slot-loses-history honesty
   note added; the "closes every collision for free" phrasing scoped to focusToken-transition collisions.

**Opus's gate ("once item 1 is pinned in 05-03, safe to execute") is now satisfied.** No round-7 replan.
Remaining step is the maintainer's go-ahead to `/gsd:execute-phase 5` (still paused per the rule).
