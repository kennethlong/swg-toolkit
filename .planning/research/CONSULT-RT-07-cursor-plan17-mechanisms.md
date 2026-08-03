# CONSULT-RT-07 (Cursor) — Do Plan 05.1-17's prescribed mechanisms actually work?

Detailed file:line review. You reviewed an EARLIER draft of this plan (CONSULT-RT-02) and found four
hazards. The plan has been rewritten. **Your job now is to check whether the rewrite actually closes
them or papers over them** — and to judge whether the prescribed approaches are implementable against
the real code.

## Files

- `D:/Code/SWG-Toolkit/.planning/phases/05.1-live-world-editor-productization/05.1-17-PLAN.md` (rewritten)
- `D:/Code/SWG-Toolkit/packages/live-inject/agent/overlay.cpp`
- `D:/Code/SWG-Toolkit/packages/live-inject/agent/rva_table.cpp`

## Questions

**Q1 — Task 2e, the interleave guard.** The plan says: when the drain dequeues a `Reload` while a
`LoadScene` is mid two-frame sequence, re-enqueue the `Reload` behind it. Trace that against the real
ring buffer (`overlay.cpp:797-821`, drain `:880-958`). Does it actually work, or does it deadlock /
starve / reorder wrongly? Specifically: how does the drain KNOW a `LoadScene` is mid-sequence — is
there state for that, or must it be added? Does re-enqueueing risk an infinite shuffle within one
drain pass given the `toProcess` snapshot at `:887`? Is there a simpler correct mechanism?

**Q2 — Task 2f, coalescing.** "Collapse a `Reload` enqueue when one is already pending for the same
scene." Is that safe with respect to ack semantics? A remote HOST_CMD `Reload` carries a
`hostCmdEpoch` and MUST be acked exactly once. If a remote reload is coalesced into a pending local
one (epoch 0), what happens to the remote's ack? Give the correct rule.

**Q3 — Task 2b, fallback detection.** The plan says detect the fallback drain path (`:1492-1493`, which
runs inside `hkSwapChainPresent` when the `mainLoop` hook is missing) and skip the barrier there. Is
that state actually knowable at the drain point? Show how, or say it needs new state.

**Q4 — Task 2d, invalidate ordering.** Moving `invalidateSceneCachedPointers` to BEFORE
`wsUnloadSnapshot`. Does anything in the current code depend on it running after `wsLoad`? Check the
`LoadScene` precedent (`:917-922`) and confirm the reorder is consistent with it.

**Q5 — Ack timing.** The plan requires the ack fire AFTER the barrier so `ack=1` means "world rebuilt."
Confirm this is compatible with the exactly-one-ack-per-epoch invariant on every path — including
barrier-skipped (fallback), slot-unbound, coalesced, and interleave-deferred cases. Enumerate the paths
and say which could ack zero times or twice.

**Q6 — Anything the rewrite introduced that is worse than what it replaced.** Be specific.

## Scope fence

Do not review Plan 05.1-18 (teleport/cell) — a different consultant owns it.
