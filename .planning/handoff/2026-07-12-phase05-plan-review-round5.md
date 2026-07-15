# Handoff — Phase 05: round-5 replan + review done, replan UNCOMMITTED

**Date:** 2026-07-12 · **Branch:** `main` · **HEAD:** `22ef1ac` (nothing committed this session)
**Status:** Round-5 `--reviews` replan **done** (Path A, identity unification), plan-checker **PASSED**,
round-5 crew **done**. Verdict **round-4 MEDIUM → round-5 LOW-MEDIUM**: both round-4 MEDIUMs CLOSED
(tested), but the fix opened ONE narrower new fail-open (pointer-ABA, Opus MEDIUM). **All UNCOMMITTED.
Not pushed.** Awaiting maintainer: close ABA via (a) structural or (b) documented accept-watch.

## What this session did (full chain, one sitting)
1. Recorded round-3 decisions → round-4 replan (5 fixes) → plan-checker PASS → round-4 crew (verdict
   HIGH→MEDIUM, found host/agent identity-key mismatch) → maintainer chose **Path A**.
2. Round-5 replan (Sonnet planner) folded the 4 Path-A decisions: **#1 identity unification** = new
   read-frame `FOCUS_TOKEN` field (agent publishes truncated `addrOf(focus)` every tick), host re-keys
   `cowSnapshot`/`writeLog` on it, per-identity `Map<focusToken,IdentitySlot>` cache replaces the single
   slot. Layout grew **396→400** (FOCUS_TOKEN@320, command region +4). #2 overclaim purge, #3 HUD
   name-only caveat, #4 minors (citations→705/706/709, getPlayer inside __try, bit6 agent-only,
   gotVerified flag).
3. Plan-checker PASS (0 blockers). Fixed its 1 warning (self-referential overclaim in acceptance grep —
   reworded to satisfiable readable assertions across 05-03/05-10).
4. Round-5 crew (Codex+Cursor CLIs — note: FIRST run's output was lost to a PowerShell relative-path
   redirect `DirectoryNotFoundException`; re-ran with ABSOLUTE paths — use absolute in/out paths for bg
   CLI redirects). Synthesized into `05-REVIEWS.md` round 5 (round-4 rotated to `-R4.md`).
5. Fixed Cursor's 2 LOW stale-prose lines in 05-01 (command seqlock "320+"→"324+"; "six"→"seven"
   static_asserts).

## Round-5 verdict (full detail in 05-REVIEWS.md)
- **CLOSED (tested):** both round-4 MEDIUMs (two-same-template revert 05-07:519; flip A→B→A 05-07:520);
  400-byte layout consistent across 05-01/03/04/07/12; FOCUS_TOKEN in read-frame seqlock; overclaim purge;
  HUD caveat honest; citations accurate; hot loop unperturbed.
- **🟠 NEW pointer-ABA (Opus MEDIUM, THE finding):** cache keys on a raw x86 `Object*` with no
  invalidation/eviction. Despawn A → client reallocs C at A's address → target C → host hits A's stale
  slot → Revert All writes A's pose to C (fail-open; dual — agent `s_expectedCapturedAgainst` same blind
  spot). NARROWER than the round-4 bug it replaces (needs realloc coincidence, not ordinary workflow) →
  net improvement, but unacknowledged. Amplified by unbounded cache (LOW).
- **🟡 LOW:** command-apply focus-skew (Opus, accept-watch); HUD cache-restore-on-flip not disclosed
  (Sonnet); x64 token-widening future caveat (Codex); the 2 Cursor stale-prose (FIXED).

## Decision needed (do NOT auto-advance to execute — [[feedback-pause-after-plan-phase]])
Close pointer-ABA:
- **(a) structural:** template/networkId cross-check on every `identityCache` hit (no channel growth — uses
  read-frame data already decoded; converts cross-template ABA to a safe miss) + bounded LRU. Round-6
  `--reviews` replan. Most robust; narrow same-template-realloc residue accept-watched.
- **(b) documented:** accept-watched threat entry + 05-12 despawn-then-retarget UAT watch item; no behavior
  change. Cheapest.
Either way fold the LOW minors (HUD cache-restore copy; command-skew note; x64 caveat). Opus: with (a) or
(b), **safe to execute**. Trend: rounds 4→5 each traded a fail-open for a strictly narrower one — converging.

## Related memory
[[feedback-pause-after-plan-phase]] · [[feedback-crew-catches-what-plancheck-cannot]] (round-5: Opus caught
the ABA fail-open the plan-checker passed) · [[reference-live-target-builds-in-scope]] (x86 target = full
pointer token; x64 would alias) · [[raw-pointer-identity-aba-across-process-boundary]] (the reusable lesson)
