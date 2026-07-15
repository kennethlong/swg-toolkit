# Round-4 review — CURSOR angle: channel byte-layout + guard/wiring integrity

Read `.planning/research/CONSULT-05R4-SHARED-PREAMBLE.md` first (locked axioms + the five claimed
changes). Then take THIS angle only (leave targeting-citations, intent, and concurrency-invariants to
the other three reviewers):

**Your job: recompute the channel byte-map across ALL round-4 edits and confirm the wiring is
consistent, non-overlapping, and fully decoded on the renderer side.** You are the most detailed code
reader — trace exact offsets and every producer/consumer pair.

Verify specifically:

1. **Change #5 STOP sticky bit — zero growth.** 05-01 claims a new `GUARD_FLAG_STOPPING` as bit 0x4 of
   the existing `GUARD_STATUS` byte at offset 388, so the layout stays 396 bytes (no new field). Confirm:
   (a) it packs into GUARD_STATUS without colliding with existing guard-status bit values; (b) the total
   layout in 05-01 (contract + native `channel.h`) still sums to exactly 396 with the same offsets in the
   locked axiom; (c) 05-03's agent publishes `GUARD_FLAG_STOPPING` before `channelClose()` and 05-07's
   `detachUI` retry-loop actually reads THAT bit at offset 388 (not some other flag). Any off-by-one or
   collision is a HIGH.

2. **Change #5 GUARD_ADDR decode.** Round-3 flagged that GUARD_ADDR (offset 392–395) was published by the
   agent but decoded by nobody, yet 05-11's guard-blocked banner + `lastDiscardedChange.addr` need it.
   Confirm 05-07 now has an EXPLICIT decode task for offset 392 + a synthetic-buffer test asserting
   `0xDEADBEEF` at 392 round-trips. Confirm 05-11 consumes the decoded addr. If the decode is still
   untasked or the test absent, HIGH.

3. **Change #5 per-channel lastDiscardedChange.** Round-3: `lastDiscardedChange` was transform-only, so a
   scale-only block disclosed nothing. Confirm 05-07 reshapes it to `{addr, transform?, scale?}` and that
   05-11's reverted/blocked banner reads both sub-fields. A scale-only block that still discloses nothing
   is a MEDIUM.

4. **bit5 consumer.** Round-3: bit5 `scaleGuardUnavailableOnBuild` was published by the agent, decoded by
   nobody. Confirm 05-07 either consumes it as a fourth scale sub-state OR explicitly documents it
   agent-only-until-handoff (either is acceptable). Flag if it's silently dropped with a scale row that
   could show "ok" while the guard is a self-compare.

5. **Change #2 seq-new gate placement (byte view).** Independently of Opus's invariant analysis, confirm
   from the 05-03 plan text that the rebaseline write targets the SAME gated instant as the apply (both
   read cmdSeq at offset 320, both gate on `cmdSeq != lastAppliedCmdSeq`) — i.e. the byte-level read
   ordering is: read cmdSeq → compare → (inside) rebaseline + apply. Report the plan lines.

Output: a recomputed offset table (field | offset | bytes | producer | consumer) proving 396 stays 396,
then per-change VERDICT (CLOSED / STILL-OPEN / NEW-ISSUE) with plan line numbers. Anchor to plan
file:line and, where the contract/native layout matters, to `channel.h` / `contracts/live-inject.ts`.
