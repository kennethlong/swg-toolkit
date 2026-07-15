# Round-6 review (LIGHT) — CURSOR: mechanical confirmation of the ABA close

Light confirmation pass on the round-6 delta only (the pointer-ABA structural fix). Leave the invariant
reasoning to Opus; you confirm the mechanical facts.

## Context
Phase 05 live-sync. Round 6 adds a `templateName`/`networkId` cross-check on every host `identityCache`
HIT (evict+recreate on mismatch) + a bounded LRU (cap ~64), and an agent-side mirror in
`s_expectedCapturedAgainst`. This is claimed to need NO channel-layout change (reuses fields the read frame
already decodes). The 400-byte layout from round 5 (FOCUS_TOKEN@320, command region 324+, GUARD_STATUS@392,
GUARD_ADDR@396, total 400) must be UNCHANGED.

## Verify (read 05-01, 05-03, 05-07 PLAN.md in .planning/phases/05-wysiwyg-live-sync-typed-editors/)
1. **No channel-layout change.** Confirm 05-01 has NO round-6 layout edit: `TOTAL_SIZE` still 400,
   `LIVE_READFRAME_BYTES` still 320, no new `LIVE_CHANNEL_LAYOUT` field/offset. Confirm the round-5 offset
   table (SEQ 0 / TRANSFORM 4 / NETWORK_ID 52 / TEMPLATE_NAME 60 / LIVENESS 316 / FOCUS_TOKEN 320 /
   COMMAND region 324-391 / GUARD_STATUS 392 / GUARD_ADDR 396) is intact. ANY offset change is a BLOCKER.
2. **Cross-check reuses already-decoded fields only.** Confirm 05-07's cross-check reads `templateName`
   and `networkId` from the state the read frame ALREADY decodes each tick (NETWORK_ID@52, TEMPLATE_NAME@60),
   introducing ZERO new channel reads. Confirm 05-03's agent mirror reads the same fields it already reads
   for the read-frame publish (no new agent reads).
3. **LRU logic soundness (mechanical).** Confirm the cap is a concrete number (~64), eviction is
   least-recently-active (`lastActiveMs`), and there's a test asserting the cache size never exceeds the
   cap across >cap distinct identities. Note (for Opus, don't resolve) whether the active slot is refreshed
   so it can't be evicted mid-edit.
4. **The two round-6 tests exist and are distinct** from the round-4 tests (two-same-template revert @
   05-07:~571, flip A→B→A @ ~572 must still be present and unchanged): the new cross-check-recreates test
   and the LRU-cap test.

Output: per-check VERDICT (CLOSED / STILL-OPEN / BLOCKER) with plan line numbers; confirm the layout is
byte-identical to round 5; flag any offset drift or new channel read.
