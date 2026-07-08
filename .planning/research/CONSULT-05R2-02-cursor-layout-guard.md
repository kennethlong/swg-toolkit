# Consult task — Cursor (detailed code reader / byte-map) — Phase 5 round-2 review

You are one of four independent reviewers. Your angle: **channel byte-layout + guard-state integrity**.
Read the actual plan files and the existing code; verify consistency at the byte/field level. A
productive DISAGREEMENT with the other reviewers is the goal, not agreement.

Plans live in D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editors/ (05-01, 05-03,
05-04, 05-07, 05-11 PLAN.md). Existing code: D:/Code/SWG-Toolkit/packages/live-inject/agent/channel.cpp,
channel.h, agent_main.cpp; packages/renderer/src/hooks/useChannelReader.ts; packages/renderer/src/store/liveStore.ts.

## LOCKED ground truth (treat as GIVEN — do NOT re-derive)
- The command slot grew from 392 to **396 bytes** this round by adding a `GUARD_ADDR` field (a real
  x86 object pointer the agent writes, host reads) so the guard-blocked HUD banner can show a real
  `<addr>` instead of a placeholder. This design choice is settled; your job is to verify it is
  CONSISTENT and non-overlapping, not to re-argue whether to add it.

## Verify (report each PASS / FAIL with the specific offsets you computed)
1. The 396-byte layout is non-overlapping and IDENTICAL across 05-01 (definition), 05-04 (host
   `CHANNEL_BYTE_SIZE`), and 05-07 (renderer decode). Lay out the offset table (read-frame 0..320, then
   each command field, then GUARD_ADDR at 392, ending at 396) and confirm the arithmetic and that
   GUARD_ADDR does not overlap any command field. Confirm the host WRITE span (the odd/even seqlock
   payload) still excludes GUARD_ADDR (agent-authoritative / host-read-only).
2. The guard is now split into INDEPENDENT `transformPassed` / `scalePassed` results, with distinct
   `GUARD_FLAG_TRANSFORM_REFUSED` / `GUARD_FLAG_SCALE_REFUSED` status bits. Confirm 05-01/05-03/05-11
   agree on these bit names and that transform and scale never collapse into one ambiguous guard state.
3. The `LIVE_READFRAME_BYTES` fix (replacing `sizeof(LiveState)-sizeof(LONG)` in channel.cpp's
   `channelWrite` memcpy) must still be correct after the struct grew — confirm the read-frame copy span
   does not now stomp into the command/GUARD_ADDR region. Check the actual `channelWrite` in channel.cpp.

## The open question I most need you to answer
An internal check flagged this (WARNING 2): the plan sets `GUARD_FLAG_SCALE_REFUSED` for TWO distinct
causes — (a) a genuine external-tamper guard mismatch, and (b) `setScale` simply being unresolved on
the advertised build (no upstream hookpoint yet). But 05-11's guard-blocked banner always renders the
TAMPER copy ("The object's memory changed outside the toolkit... the game or another tool moved it").
For cause (b) that text is factually false — nothing moved the object; the endpoint just doesn't exist
on that build yet. Trace whether the RENDERER can already distinguish (b) from (a) using data it has
(e.g. a scale-endpoint-unresolved / `targetUnavailableOnBuild`-style signal), so it could render honest
"Scale unavailable on this build" copy instead — OR whether a distinct native status bit
(`SCALE_UNRESOLVED` separate from `SCALE_REFUSED`) is actually required. Give a concrete recommendation:
renderer-side precedence rule, or new native bit — and which is less total change.

Output: PASS/FAIL per numbered item with the offsets/bit-names you actually saw, then your recommendation
on the open question, then a one-line risk verdict (LOW/MEDIUM/HIGH) on the channel-integrity track.
