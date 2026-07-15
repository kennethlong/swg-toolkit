# Handoff — Phase 05: round-4 cross-AI review done, replan + review UNCOMMITTED

**Date:** 2026-07-12
**Branch:** `main` · **HEAD:** `22ef1ac` (unchanged — nothing committed this session)
**Status:** Round-4 `--reviews` replan **done**, plan-checker **PASSED**, round-4 de-anchoring crew
**done**. Verdict dropped **round-3 HIGH → round-4 MEDIUM**: the two provable HIGHs are CLOSED, but the
round-4 fix opened two MEDIUM fail-modes on the legacy revert path. **All work is UNCOMMITTED in the
tree. Not pushed.** Awaiting maintainer decision: round-5 replan vs. accept-and-document.

---

## ⚠️ Uncommitted tree (same posture as the round-3 handoff)

`git status` shows the round-3 replan PLUS this session's round-4 edits, all uncommitted:
- 7 plan files (05-01/03/04/07/10/11/12) — round-3 replan + round-4 edits
- `05-01-PLAN.md` — round-4 warning fixes (T-05-26 threat text, STOP-bit success_criteria)
- `05-REVIEWS.md` — **now round 4** (round-3 rotated to `05-REVIEWS-R3.md`, which carries the round-3
  maintainer-decisions block the replan consumed)
- `.planning/research/CONSULT-05R4-*.md` (4 task files + SHARED-PREAMBLE) and `*.out` (codex/cursor
  transcripts, gitignored)

Do nothing destructive before preserving. Nothing committed — consistent with how the round-3 replan
was intentionally left in the tree for maintainer review.

## What this session did
1. Recorded the 5 round-3 maintainer decisions into `05-REVIEWS-R3.md` (#3 → **option (a)**, HUD warning
   + honesty), then ran `/gsd:plan-phase 5 --reviews` (Sonnet planner — correct for injection per
   [[opus-cyber-safeguard-on-injection-planning]]). All 5 decisions landed across the 7 plans; DTII/STF
   plans untouched.
2. Plan-checker **PASSED** (no blockers). Fixed its 2 doc-staleness warnings in 05-01.
3. Ran the round-4 de-anchoring crew (Codex + Cursor CLIs + fresh Sonnet + Opus), non-overlapping angles,
   led with LOCKED ground-truth. Synthesized into `05-REVIEWS.md` round 4.
4. Ignored a wrong-window "Utinni handback" message (was meant for the maintainer's other session).

## Round-4 verdict: MEDIUM (see `05-REVIEWS.md` for full synthesis + interleavings)

**CLOSED (confirmed ≥2 reviewers):** Change #2 ungated rebaseline (structurally, grep-proven
`05-03:1011`); Change #1 baseline re-key **agent-side**; Change #4 SEH span; 396 layout + STOP sticky
bit zero-growth; citations mostly fixed; UAT now surfaces the gap.

**THE convergent finding (Opus invariant + Sonnet honesty, same root cause):** **template-name is not a
unique object identity**, and round-4 leaned on it twice —
- 🟠 **Opus MEDIUM, fails OPEN (legacy revert):** host re-keys on `(networkId, templateName)` but agent
  re-keys on the raw `focus` pointer; legacy `networkId≡0`, so two same-template objects collide → a
  Revert All force-writes object-1's pose onto object-2. Ordinary workflow, not a race.
- 🟠 **Sonnet MEDIUM-HIGH:** the ⚠ HUD warning compares name-basenames only → silent (false reassurance)
  in the same-template coincidence case ground truth already flagged twice.

**Other MEDIUM:** Opus — single `cowSnapshot`/`writeLog` slot → focus-flip A→B→A destroys A's original
baseline + undo history (fails safe but lossy). Sonnet — banned "closes...for real" overclaim survives
at `05-03:1057` + `05-10:311` (05-10 invented an unauthorized (a)/(b) split); bit6 `agentFaultRecovered`
has no UI consumer. Cursor — 05-11 guard-blocked banner should name `liveStore.guardAddr`; scale-only
`lastDiscardedChange.got` may degrade.

**LOW:** Codex — advertised catalog citations drifted +2 (`703/704/707` → **705/706/709**; keys/convention
still match); "only identity source" overstated (`Object::networkId` exists at `object.h:86`). Opus —
`getPlayer()` sits before the `__try`.

## Decision needed (do NOT auto-advance to execute — [[feedback-pause-after-plan-phase]])
**The one non-mechanical fork = Opus rec #1: unify object identity** (publish the agent focus token in
the read frame every tick; host re-keys on that; small per-identity snapshot/writeLog cache). Closes the
fail-open legacy-revert MEDIUM AND the lossy-flip MEDIUM. Small local channel+host change, not a
re-architecture. Cheaper alternative: read real `Object::networkId` (object.h:86) on legacy for a genuine
host key (closes fail-open, not the flip loss).

- **Path A — round-5 replan:** `/gsd:plan-phase 5 --reviews` folding decision #1 + the doc/citation
  minors, then re-review, then execute. Most robust.
- **Path B — accept + document:** apply only the cheap doc fixes (overclaim purge, +2 citations, HUD
  name-only caveat) and ship the two legacy-revert MEDIUMs as documented known limitations (normal drag
  — the primary path — is unaffected). Opus's own fallback.

## Related memory
[[feedback-pause-after-plan-phase]] · [[feedback-crew-catches-what-plancheck-cannot]] (round-4 caught
the identity mismatch + the +2 citation drift plan-check passed) · [[reference-live-target-builds-in-scope]]
(legacy is the primary target the MEDIUMs hit) · [[swg-client-v2-advertised-hooks]]
