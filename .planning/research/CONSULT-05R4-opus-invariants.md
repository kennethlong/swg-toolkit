# Round-4 review — OPUS angle: invariants / concurrency / fail-safe

Read `.planning/research/CONSULT-05R4-SHARED-PREAMBLE.md` first (locked axioms + the five claimed
changes). Then take THIS angle only (leave targeting-citations, byte-layout, and user-intent to the
other three reviewers):

**You found the two most serious round-3 defects (ungated rebaseline; baseline-vs-focus). The round-4
replan claims to have closed BOTH. Your job: from the plan's own control flow, prove they are actually
closed — and prove the round-4 edits did not open a NEW invariant break.** Reason from the plan text as
if it were the code; construct the exact frame-by-frame interleaving.

Verify specifically:

1. **Change #1 — baseline re-key (was: once-per-attach baseline vs per-frame focus).** The claim: a static
   `s_expectedCapturedAgainst` is compared to the freshly-resolved `focus` every iteration; on mismatch
   `s_expectedCaptured=false` (re-arm capture) then `s_expectedCapturedAgainst=focus`. Construct the
   interleaving: attach with player focus → select object O → first write to O. Does O now capture its
   OWN baseline before the guard runs, or can the first write to O still false-block / can `revertAll`
   still force the player's pose onto O? Check BOTH the agent side (05-03) AND the host `cowSnapshot`
   re-key (05-07). Does the host reset `writeLog`/`guardState`/`lastDiscardedChange` on the SAME identity
   change, or can host and agent disagree about which object the baseline belongs to for a window?

2. **Change #2 — gated + unified rebaseline (was: ungated rebaseline defeats the guard).** The claim: the
   REBASELINE mutation is now LEXICALLY inside the `cmdSeq`-new + non-torn guard (once-per-command), and
   BOTH channels rebaseline to the LIVE value. Construct the latest-wins-slot interleaving: revert command
   in slot, then frames 2..k re-read the SAME command. Does the rebaseline re-run every frame (→ can still
   adopt an external tamper as baseline), or does the seq-new gate now fire it exactly once? Verify from
   the plan text that the rebaseline assignment is inside the same lexical block as the seq compare, not
   merely "after a command was read". Then the scale side: does scale now rebaseline from the LIVE
   `m_scale` read (so a scale-only blocked revert un-sticks), or does any residue of the `cmd.scale` pin
   remain (→ scale-only revert still won't un-stick on legacy)?

3. **Change #4 — SEH bound.** Does the `__try/__except` span the ENTIRE resolve→read→apply (including the
   advertised two-step `hudInstance` window), so a UAF degrades to a skipped frame + `agentFaultRecovered`
   rather than a crash — or does any pointer deref (focus resolution, read-back, apply) sit OUTSIDE the
   guarded span? A deref outside the block is the whole mitigation failing.

4. **NEW invariant breaks from the round-4 edits.** The re-key resets `s_expectedCaptured=false` and the
   host resets `writeLog`/`guardState`. Can a rapid focus flip (A→B→A within a few frames) cause: lost
   revert history, a rebaseline that adopts a mid-flight tamper, a guard that's momentarily disabled, or a
   STOP that's dropped because the STOPPING bit races the re-key reset? Look specifically for anything the
   round-4 additions introduced that fails OPEN (applies a write it shouldn't) rather than fails closed.

Output: per-change VERDICT (CLOSED / STILL-OPEN / NEW-ISSUE) each backed by an explicit frame-by-frame
interleaving citing plan line numbers, severity for anything not closed, and an overall risk verdict.
A grounded STILL-OPEN or NEW-ISSUE is the most valuable thing you can produce — do not rubber-stamp.
