# Round-5 review — SONNET angle: is the overclaim really purged + is the HUD caveat honest now?

Read `.planning/research/CONSULT-05R5-SHARED-PREAMBLE.md` first. Then take THIS angle only (leave the
identity invariants to Opus, byte-layout to Cursor, citations to Codex).

**In rounds 3-4 you found (a) the WYSIWYG "closes the round-1 finding for real" overclaim surviving in
prominent sections, and (b) the ⚠ HUD warning silently false-reassuring in the same-template coincidence
case. Round 5 claims to have struck the overclaim and added a name-only caveat. Verify both are genuinely
honest now — think like a modder who only uses the tool + a checker who only reads the plan's active
sections.**

Verify specifically:

1. **Overclaim purge — complete?** Grep 05-03 and 05-10 for the banned phrasing ("for real", "closes the
   round-1", "closes...for real"). Confirm it survives ONLY inside `#`-prefixed archived revision-note
   lines — NOT in any active must_haves / success_criteria / threat_model / `<action>` / `<done>` /
   acceptance_criteria body. Round 5 also claims 05-10's unauthorized (a)/(b) split (which re-litigated the
   finding's boundary to keep the phrase) was DELETED — confirm 05-10's top-of-file note no longer carves
   the finding into (a)/(b) to preserve a closure claim. Any active-section survivor, or any residual
   (a)/(b) reframing, is a MEDIUM.

2. **HUD name-only caveat — does it actually disarm the false reassurance?** 05-11 claims a "(name match
   only — not a verified object identity)" caveat that renders whenever the loaded-asset basename matches
   the target templateName basename. Walk the coincidence scenario: load `womprat`, an unrelated `womprat`
   NPC is selected (names match, different live object). Does the caveat now fire so the modder is warned
   the match is name-only, not identity? Confirm it renders in the MATCH case specifically (not only the
   mismatch case). Is the copy honest (doesn't overstate)? Is there an acceptance criterion for the
   same-template-coincidence case? (Note: the plan judged a full identity compare infeasible for a static
   viewport asset with no live identity — is that a defensible call, or could the new FOCUS_TOKEN have
   been used here too?)

3. **bit6 honesty.** `agentFaultRecovered` (bit6) — round 4 flagged it had no UI consumer. Round 5 claims
   it's now documented agent-only (like bit5). Confirm the documentation exists and is honest — OR, if a
   fault-near-live-memory genuinely warrants a user signal, is "agent-only" an under-disclosure? Judge
   whether documenting-agent-only is honest here or a dodge.

4. **`gotVerified` degrade honesty.** Round 5 did NOT add a live-scale channel field; instead a
   `gotVerified: boolean` flag drives honest "last known… not independently re-verified" copy for a
   scale-only discarded change (05-07/05-11). Is that copy honest (doesn't claim a "found <bytes>"
   disclosure it can't back), or does it still imply a verification that didn't happen?

5. **Lateral.** Any NEW honesty gap the round-5 additions introduce — e.g. the FOCUS_TOKEN / per-identity
   cache / write-log reset creating a user-visible behavior (history clearing on retarget, a stale cache
   hit) the HUD doesn't explain.

Output: per-item VERDICT (HONEST-NOW / STILL-MISLEADING / NEW-CONFUSION) with the plan line proving it,
severity for anything not honest, overall verdict on whether a modder could still be misled. Anchor to
plan file:line.
