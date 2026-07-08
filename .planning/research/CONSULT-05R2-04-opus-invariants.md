# Consult task — fresh Opus (spec-correctness / invariants) — Phase 5 round-2

Angle: math & invariants. You have read access to the repo and D:/Code/swg-client-v2, D:/Code/Utinni.
Verify claims against real source where it matters; reason precisely about the invariants.

The plans (.planning/phases/05-wysiwyg-live-sync-typed-editors/05-01..05-12 PLAN.md) were revised to
close a round-1 cross-AI review (05-REVIEWS.md). Three of the fixes rest on non-obvious invariants.
Pressure-test each:

1. **Interior-object guard read-back fix (round-1 Opus finding, single-source).** Round 1 claimed: for a
   NON-world-cell object, `setTransform_o2w` stores `objectToCell = invert(cellToWorld)·objectToWorld`
   (swg-client-v2 Object.cpp:1460-1470), so reading o2w back next frame differs from the written
   `cmd.transform` by float rounding, false-failing an EXACT compare on write N+1. The fix: after a
   successful apply, set `s_expectedTransform` from a FRESH `getTransform_o2w(focus)` read-back rather
   than from `cmd.transform`. **Verify the premise against Object.cpp:1450-1470 yourself** (round 1 only
   one reviewer checked it), and then verify the FIX actually holds: does `getTransform_o2w` return the
   reconstructed world matrix (which would then exactly match the next frame's read, making the compare
   pass) or the stored cell-relative matrix? If it returns a freshly-recomputed world matrix each call,
   is the read-back on apply-frame guaranteed byte-identical to the read on the NEXT frame (no further
   sim mutation in between)? Identify any residual false-fail window.

2. **Revert-rebaseline invariant.** `revertAll`/`revertWrite` send `CMD_FLAG_REBASELINE_GUARD` which
   makes the agent re-baseline `s_expectedTransform`/`s_expectedScale` to CURRENT live bytes before
   applying the revert write. The stated invariant: "still no forward force-write." Is that true? Walk
   the sequence: guard is blocked (live ≠ expected) → user hits Revert → agent rebaselines expected =
   current live → then writes the snapshot value. Does this correctly restore the snapshot WITHOUT ever
   accepting the tamperer's value as a new baseline for a FORWARD write? Prove it or find the hole.

3. **Scale guard asymmetry.** Transform refreshes its baseline from a read-back; scale sets
   `s_expectedScale = cmd.scale` directly because "no read accessor exists for scale." Does that
   asymmetry create a false-fail or false-pass for scale on interior objects or under external scale
   mutation? Is `setScale` writing `m_scale` verbatim (so cmd.scale == stored, no rounding) — verify
   against swg-client-v2 Object.cpp:2205 area.

Also briefly: the off-thread setter concern (writes from the Sleep(16) poll thread racing the sim) — is
it materially worse now that we call BOTH setTransform_o2w and setScale, and now that we resolve a
target object (more pointer chasing) off-thread? One-line severity.

Output: per-item VERIFIED/REFUTED/RESIDUAL-RISK with the specific source lines you checked, then a one-
line overall invariant-risk verdict (LOW/MEDIUM/HIGH).
