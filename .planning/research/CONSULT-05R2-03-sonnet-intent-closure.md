# Consult task — fresh Sonnet (lateral / did-the-fixes-close, intent gap) — Phase 5 round-2

Angle: lateral / blind-spots. You have read access to the repo and reference projects. Do NOT anchor to
the plan's self-assessment — your job is to find what a fix-by-fix reader would miss.

Round 1 (05-REVIEWS.md, already folded in) found: a setScale-crash BLOCKER + 5 HIGH + several MEDIUM.
The plans in .planning/phases/05-wysiwyg-live-sync-typed-editors/ (05-01..05-12 PLAN.md) were revised
to close them. Read 05-REVIEWS.md for the original findings and the revised plans for the fixes.

## Two things I most need from you

1. **Intent gap on object-targeting.** Round-1 Sonnet HIGH #5 was "the live gizmo always moves the
   player avatar, never the mesh you're viewing." The maintainer then chose "add object targeting now."
   What the replan DELIVERED (05-03 Task 2): the agent focus object is **the player's in-game LOOK-AT
   TARGET** (legacy SWGEmu only; advertised build falls back to player with a HUD "unavailable" flag),
   NOT the arbitrary mesh loaded in the viewport. Question: does "player's look-at target / player"
   actually satisfy the intent of "move the object you're viewing"? A user loads a creature mesh in the
   viewport, drags the gizmo — under this design the creature does NOT move unless it happens to be the
   player's current in-game look-at target. Is this a real intent gap the maintainer should see BEFORE
   execution, or an acceptable Phase-5 ceiling? Be concrete about the user-visible behavior.

2. **Did any round-1 fix fail to actually close, or introduce a NEW blind spot?** Especially:
   - The guard baseline now refreshes from a fresh `getTransform_o2w` read-back after each apply
     (Fix D). Any new failure mode from that? (e.g. what if the read-back itself is mid-sim-nudge?)
   - `revertAll`/`revertWrite` now send a `CMD_FLAG_REBASELINE_GUARD` before reverting (to un-stick a
     blocked guard). Does re-baselining the guard to CURRENT live bytes before a revert reintroduce any
     "silently accept external tamper" hazard the no-force-write promise was meant to prevent?
   - The two internal-checker WARNINGS: (W1) STF sourceCrc copy drift — already reconciled; (W2) the
     guard-blocked banner shows tamper copy even when scale is merely unresolved on the advertised
     build. Is W2 worse than "warning" — could it actively mislead the maintainer during UAT?

Output: a direct answer to (1) — intent gap YES/NO with the user-visible behavior spelled out — then a
short list of any unclosed fixes or new blind spots from (2), each tagged HIGH/MEDIUM/LOW, then a one-
line overall risk verdict.
