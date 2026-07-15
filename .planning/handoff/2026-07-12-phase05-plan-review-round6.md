# Handoff — Phase 05: round-6 replan + LIGHT crew done, one MEDIUM pin before execute

**Date:** 2026-07-12 · **Branch:** `main` · **HEAD:** `22ef1ac` (nothing committed this session)
**Status:** Round-6 `--reviews` replan (structural ABA close, option a) **done**, plan-checker **PASSED
clean (0 warnings)**, LIGHT round-6 crew (Opus + Cursor) **done**, and the one MEDIUM pin + LOW folds
**DIRECT-APPLIED + quick-checked** (2026-07-13). Verdict **LOW**; Opus's execute-gate now satisfied.
**All UNCOMMITTED. Not pushed.** Only remaining step = maintainer go-ahead to execute (paused per rule).

## Full session arc (one sitting, rounds 3→6)
Round-3 decisions recorded → round-4 replan (5 fixes) → PASS → round-4 crew (HIGH→MEDIUM, identity-key
mismatch) → Path A → round-5 replan (identity unification, FOCUS_TOKEN, 396→400) → PASS → round-5 crew
(MEDIUM→LOW-MEDIUM, pointer-ABA) → option (a) → round-6 replan (ABA cross-check + LRU, no layout change) →
PASS clean → LIGHT round-6 crew (Opus+Cursor). Full detail: 05-REVIEWS.md (round 6) + 05-REVIEWS-R1..R5.md.

## Round-6 verdict (05-REVIEWS.md round 6)
- **CLOSED (Opus + Cursor):** reachable cross-template ABA both sides (host evict+recreate on template/
  networkId mismatch; agent re-key on identity mismatch); same-template residue correctly accept-watched
  (T-05-46/50 + 05-12 UAT); LRU can't evict the ACTIVE slot (max-lastActiveMs invariant); no torn-read
  false-evict (single seqlock); NO channel-layout change (400 byte-identical, zero new reads); LRU cap-64
  test; no regression on CLOSED paths.
- **🟠 MEDIUM pin (Opus 3c-ii) — LAND BEFORE EXECUTE:** the agent `s_expectedCapturedAgainstTemplate`
  compare is type-ambiguous (`const char*`, plan says "mirror whatever templateName is"). A POINTER compare
  would silently no-op the agent-side fix (reused buffer → always equal → reopens agent-side ABA) or
  re-capture every tick (fresh string → defeats tamper detection). Only a CONTENT/hash compare vs a
  stably-copied value is correct. The acceptance criterion is a SYMBOL GREP that can't tell pointer from
  content compare → a "tests PASSED" build hides it ([[feedback-executor-integration-blind-spot]]). FIX
  (one paragraph in 05-03): specify content/hash compare + a BEHAVIORAL test (same focusToken + different
  template content → re-capture; identical → not).
- **🟡 LOW folds:** host cross-check is focusToken-gated vs agent per-tick (theoretical zero-intervening-
  frame asymmetry, unreachable given player-fallback resolvers, but undocumented) → symmetrize host to
  per-tick OR document; fix T-05-45→46 / T-05-49→50 citation slip; evicted-slot-loses-history honesty note;
  scope the two "closes every collision / never disagree" overclaims to "focusToken-transition collisions."

## Decision needed (do NOT auto-advance to execute — [[feedback-pause-after-plan-phase]])
Opus: item 1 is "a one-paragraph acceptance-criterion addition," not a re-architecture; "once pinned, safe
to execute." Proportionate options:
- **Direct-apply:** edit 05-03 (content-compare spec + behavioral test) + 05-07 (LOW doc folds) inline with
  Opus's exact spec, quick plan-check, pause before execute. Proportionate to the tiny fix.
- **Round-7 `--reviews` replan:** heavier, consistent with prior rounds.
- **Pause:** maintainer reads 05-REVIEWS.md round 6 and decides later.
Either way this is the LAST correctness pin the crew surfaced; the trend is terminating.

## Note for next session
- Background CLI redirects: use ABSOLUTE in/out paths (a round-5 relative-path redirect hit
  DirectoryNotFoundException and lost Codex/Cursor output; re-ran with absolute paths).
- Nothing committed all session — the entire rounds-3→6 replan + 6 review docs + handoffs sit in the tree.
  The maintainer's pattern is to review the tree before committing (as with the round-3 replan).

## Related memory
[[feedback-pause-after-plan-phase]] · [[feedback-crew-catches-what-plancheck-cannot]] · [[feedback-executor-integration-blind-spot]]
(the round-6 MEDIUM is a live instance) · [[raw-pointer-identity-aba-across-process-boundary]] · [[reference-live-target-builds-in-scope]]
