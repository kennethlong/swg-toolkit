# Round-5 review — CURSOR angle: recompute the 400-byte layout + FOCUS_TOKEN wiring

Read `.planning/research/CONSULT-05R5-SHARED-PREAMBLE.md` first. Then take THIS angle only (leave the
identity invariants to Opus, honesty to Sonnet, citations to Codex).

**The layout grew 396→400 with a new FOCUS_TOKEN field at offset 320 shifting the whole command region
+4. Recompute the byte map from scratch and confirm it is byte-for-byte consistent across every plan that
touches it, and that FOCUS_TOKEN's seqlock coverage + producer/consumer wiring are correct.**

Verify specifically:

1. **Recompute the full 400-byte map** field-by-field from 05-01 (the source of truth: contract
   `packages/contracts/.../live-inject.ts` + native `channel.h` + the `static_assert(offsetof(...))`
   lines + `LIVE_READFRAME_BYTES` + total-size assert). Produce an offset table (field | offset | bytes |
   producer | consumer). Confirm the arithmetic sums to exactly 400 and that pre-existing read-frame
   fields (SEQ 0, TRANSFORM 4, NETWORK_ID 52, TEMPLATE_NAME 60, LIVENESS 316) are UNCHANGED.

2. **Cross-plan consistency.** The SAME offsets must appear in: 05-03 (agent publishes focusToken at 320
   + writes command-region reads at the shifted offsets), 05-04 (host `WriteCommand` writable span — must
   be 324..391, never touching FOCUS_TOKEN@320 / GUARD_STATUS@392 / GUARD_ADDR@396 — + `CHANNEL_BYTE_SIZE`
   = 400), 05-07 (renderer decodes FOCUS_TOKEN@320 and GUARD_ADDR@396), 05-12 (soak-test byte-size
   assertions = 400). ANY offset that disagrees across these is a HIGH. List each plan's stated offsets
   and diff them.

3. **FOCUS_TOKEN seqlock coverage.** Confirm FOCUS_TOKEN@320 is inside the READ-FRAME seqlock region
   (covered by the same `LIVE_READFRAME_BYTES` memcpy + seq counter as transform/networkId), NOT a
   loose word like GUARD_STATUS/GUARD_ADDR. If it landed outside the seqlock, the host could read a torn
   token/transform pair — flag HIGH. Also confirm `LIVE_READFRAME_BYTES` actually grew 316→320 so the
   copy span includes it.

4. **static_assert completeness.** Are there `static_assert(offsetof(...))` lines for the NEW FOCUS_TOKEN
   offset AND updated ones for every shifted command field, plus the new total-size assert (400)? A
   shifted field without an updated assert is a silent-regression risk — list any missing.

5. **Command-region tie-break.** COMMAND_FLAGS moved to 388 and GUARD_STATUS to 392 — confirm they are
   distinct words (no overlap) and that STOP-bit / guard-status bit semantics from round 4 still land on
   the correct (now-shifted) offsets.

Output: the recomputed offset table proving 400, a per-plan offset diff, per-check VERDICT (CLOSED /
STILL-OPEN / NEW-ISSUE) with plan line numbers, severity for any inconsistency. Anchor to plan file:line
and the contract/channel.h layout.
