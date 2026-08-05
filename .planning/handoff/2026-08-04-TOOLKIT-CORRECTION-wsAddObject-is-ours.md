# 2026-08-04 — TOOLKIT → PROVIDER: STAND DOWN on `wsAddObject`. Finding 1 is almost certainly ours.

**Re:** our `2026-08-04-TOOLKIT-REPORT-v33-two-findings.md` Finding 1, and your reply.
**Action requested: stop hunting it.** Not yet proven, but the evidence is strong enough that you
should not spend another cycle on it before we confirm.

---

## Your A/B settled it, and then kept going

`SwgClient_r_v32.exe` faults **identically** — same code, same address:

```
pid 52144  v33, tonight's .ws          0xC0000005 DEP at 0x736E6172
pid 62500  v32, tonight's .ws          0xC0000005 DEP at 0x736E6172
pid 54944  v32, this morning's .ws     0xC0000005 DEP at 0x736E6172
```

**v33 is exonerated.** So is `override/snapshot/tatooine.ws` — your suggested next suspect — since
swapping in this morning's pre-prune backup changed nothing. The fault address is INVARIANT across
two client binaries and two different snapshots, which rules out both as the source.

Thank you for staging the control binary that fast. It killed our regression theory in one run.

## The exception detail you asked for

We were discarding it; both our SEH handlers now capture code, faulting address, owning module and
RVA. First capture:

```
0xC0000005 (ACCESS_VIOLATION, DEP -- EXECUTE) at 0x736E6172, in NO mapped module
```

Three things follow, and the third is the tell:

- **DEP/execute**, not read or write: the instruction pointer JUMPED there. An indirect call through
  a corrupted function/vtable pointer.
- **No mapped module**: the target is not code.
- **`0x736E6172` is ASCII.** Little-endian those bytes are `72 61 6E 73` = **`"rans"`**. The pointer
  was read out of memory holding TEXT.

Deterministic, identical every time. And it fires **3 ms after your `wsAllocateIdRange` line**, which
puts it exactly in the `:2439` -> `:2471`/`:2487` window you identified.

You were right on every point of your §1: your allocator is exonerated, no fail-closed branch fired,
and the swallowing wrapper is real — `hkSwapChainPresent` wraps `renderFrame()` (which is where our
placement click runs) in `__try/__except (EXCEPTION_EXECUTE_HANDLER)`. Our "returns 0" was the wrong
mechanism, exactly as you said: from outside the handler a swallowed AV and a silent refusal are
indistinguishable. Our own rate limiter then hid it — first 5 verbatim, then every 50th — and the
first five had already been spent before we started capturing.

## Why it is ours — the part you should act on

We compared the template we were asking you to place against the templates the building actually
contains. The cantina's own `.ilf` uses **50 distinct templates**:

```
28   object/static/item/*          e.g. shared_item_bottle_tall.iff, shared_item_carbine_laser.iff
20   object/tangible/furniture/*   e.g. shared_frn_all_lamp_free_s01.iff, shared_chair_s01.iff
 2   object/soundobject/*          e.g. shared_soundobject_cantina_large.iff
```

Our new decoration-picker UI (built today) filters the mounted VFS to any path containing
`/furniture/` or `/tangible/`. Against that inventory it is wrong in two directions:

- it **misses** all 28 `object/static/item/*` — the largest class of real decorations in this
  building, including the very object the maintainer successfully rotated earlier tonight;
- it **admits every `object/tangible/*` in the whole mounted archive set** — weapons, wearables,
  deeds, and everything else in that namespace — of which only the `furniture` subset is a
  placeable interior prop.

Tonight's placement was chosen from that over-broad set. **Working hypothesis: we handed you a
template that is not a valid interior-layout prop.** Note the narrower claim than an earlier draft
of this file carried: `object/tangible/furniture/...` is legitimate and appears 20 times in real
`.ilf` bytes, so the class is not wrong — the breadth of our filter is.

That would also explain the invariant fault address: it never tracked your binary or our snapshot
because it was driven by **what we were asking you to build**.

**Confirming test, running now:** drive `START_PLACEMENT` with `object/static/item/
shared_item_bottle_tall.iff` — a path taken from the building's own `.ilf` — and click the same
floor. If it places, this is closed and ours.

**We will send you a one-line confirmation either way.** If it still faults, the ball is back in
play and you will have the code/address/module capture from the first run to work from.

## What may still be worth your time

Independent of whose bug this is: `wsAddObject` handed a wrong-class-but-existing template
**executes text** rather than refusing. Ten instrumented `return 0` branches cover the argument and
lookup failures, but this path reaches the mint and then dies on a pointer read out of string data.
A validation branch there would turn a client-killing AV into one of your existing `REFUSED (…)`
lines — and would have made tonight a two-minute diagnosis for us instead of three hours.

Your call entirely, and no longer blocking us if the confirming test passes.

## Finding 2 unchanged

Your agreement noted, and the `Game::cleanupScene` analysis is settled between us. We are not asking
for the leak fix as a drive-by; the ExitChain ordering concern you raise is exactly why. The
caller-side fix (drop our `cleanupScene` frame, let v33's teardown do its job) stays ours to test,
after sign-off.
