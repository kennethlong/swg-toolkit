# Round-5 review — OPUS angle: does identity unification close BOTH round-4 MEDIUMs without opening a new one?

Read `.planning/research/CONSULT-05R5-SHARED-PREAMBLE.md` first. Then take THIS angle only (leave
byte-layout to Cursor, honesty to Sonnet, citations to Codex).

**You found the round-4 host/agent identity-key mismatch (fails-open revert force-write) and the lossy
focus-flip. The round-5 replan claims fix #1 (FOCUS_TOKEN + host re-key on it + per-identity cache)
closes both. Prove it from the plan's control flow — and hunt for what the new mechanism could break.**

Verify specifically:

1. **Fail-open revert MEDIUM — CLOSED?** Reconstruct the two-same-template-rocks interleaving (target R1,
   drag; retarget R2 same template; Revert All). With the host now re-keying `cowSnapshot`/`writeLog` on
   `focusToken` (05-07), does R2 get its OWN snapshot (so Revert All can no longer send R1's pose to R2)?
   Confirm the host reads the token from the read frame that corresponds to the SAME tick the agent is
   acting on — i.e. is there still any window where host `cowSnapshot.focusToken` and the agent's live
   `focus` disagree (the ≤1-frame skew the round-4 review flagged on the coalesced-revert path)?

2. **Lossy focus-flip MEDIUM — CLOSED?** Reconstruct A→B→A. With the `identityCache: Map<focusToken,
   IdentitySlot>` (05-07), does flipping back to A restore A's ORIGINAL baseline + writeLog, or does any
   path still overwrite/evict A's slot? Check: is the cache keyed on the token only? Is there an eviction
   policy, and can it evict A while A is still editable? Is writeLog per-slot or still global?

3. **NEW risks the token mechanism introduces — hunt hard:**
   - **Pointer ABA / reuse.** `focusToken` is a raw x86 pointer. If the client frees object A and later
     allocates object C at the SAME address, C's token == A's stale cached token. Interleaving: edit A;
     A despawns; C spawns at A's old address; user targets C → host finds A's cached slot → applies A's
     baseline/writeLog to C. Does anything invalidate a cached slot when the underlying object changes
     identity? Is this a real fail-open, and at what severity? (Consider that despawn-then-reuse mid-edit
     is plausible in a live world.)
   - **Token staleness / seqlock coverage.** Is `FOCUS_TOKEN` inside the same seqlock-protected read
     frame as transform/networkId (so host never reads a torn token paired with a mismatched transform)?
     If it were published outside the seqlock, the host could pair token-of-B with pose-of-A.
   - **Token == 0 / null focus.** When `focus = player` fallback or nothing is resolved, what is
     `focusToken`? Can two genuinely-different "no target" states collide on token 0 and share a cache
     slot incorrectly?
   - **Unbounded cache growth.** Does the Map grow without bound as the user targets many objects across
     a long session (a slow leak in the host)? Minor, but note it.

4. **Regression check.** Did adding the FOCUS_TOKEN publish every tick perturb the agent's hot-loop
   ordering relative to the already-CLOSED gated-rebaseline / SEH span / read-back capture? Confirm the
   token publish is additive (a struct-field set before the existing `channelWrite`), not a reordering of
   the guarded apply.

Output: per-item VERDICT (CLOSED / STILL-OPEN / NEW-ISSUE) with an explicit interleaving + plan line
numbers; severity for anything open (especially rank the pointer-ABA risk); overall verdict on whether
fix #1 is safe to execute or needs one more turn. A grounded NEW-ISSUE is the most valuable output.
