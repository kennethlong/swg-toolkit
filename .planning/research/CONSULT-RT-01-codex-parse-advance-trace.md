# CONSULT-RT-01 (Codex) — Can the phased snapshot parse advance in an in-world client?

Read `D:/Code/SWG-Toolkit/.planning/research/CONSULT-RT-00-GROUND-TRUTH.md` first. Its numbered items
are GIVEN — do not re-verify them.

You are a repo tracer. This is a **call-graph question about `D:/Code/swg-client-v2`**, not a design
review. Answer from source with file:line for every claim. Do not speculate about what "probably"
happens; if a path is conditional, name the condition and where it is set.

## Scope

`WorldSnapshot::load()` leaves `ms_parsePending == true` and defers work to `WorldSnapshot::loadStep()`
(ground truth items 2-5). The scenario of interest is: **the client is fully in-world and playing —
no loading screen, no scene transition — and something calls `WorldSnapshot::load()` at that moment.**

## Questions — answer each separately

**Q1. Enumerate every caller of `WorldSnapshot::loadStep()`** in the whole of `swg-client-v2/src`.
For each, state the enclosing function and every condition that must hold for the call to be reached.
Ground truth item 11 names one; **confirm or refute that it is the only one** and report anything it
missed.

**Q2. Enumerate every caller of `finishLoadNow()`**, in and out of `WorldSnapshot.cpp`. Group them by
what kind of thing triggers them: per-frame engine work, UI/input, network/streaming, the
`utinni_*` advertised shims, or something else. Which of these, if any, can fire during **ordinary
in-world play with no editor tooling attached and no snapshot query in flight?**

**Q3. In the in-world scenario above, is there ANY path that advances or completes the parse?**
Trace it. If there is none, say so plainly and show the coverage that justifies "none". If there are
some, say what would trigger them and roughly how likely each is during normal play (e.g. movement,
crossing an area boundary, targeting something, a network event).

**Q4. Does `finishLoadNow()` complete ALL parse phases?** Read `loadStep()` (`WorldSnapshot.cpp:807`
onward) and its phase machine. Enumerate the phases in order. Confirm specifically whether the
**sphere-tree build** is one of the phases that runs inside `loadStep()`, and whether `ms_parsePending`
can be cleared (`:903`) before the sphere tree is populated. If there is any state that is only
initialized by a code path OUTSIDE `loadStep()` — for example something the loading screen or
`GroundScene` does around the load — name it, because a force-finish would skip it.

**Q5. Cost.** Roughly what does a full `finishLoadNow()` do for a scene like Tatooine — how much work,
and is any of it I/O? The CONSULT-60 comment (item 3) cites ~3s for the old synchronous body; is that
the same work `finishLoadNow()` now does, or more, or less?

**Q6. Re-entrancy and thread affinity.** Is `loadStep()`/`finishLoadNow()` safe to call from an
arbitrary point on the game thread — specifically, from a `game::mainLoop` detour, outside the
graphics present callback? Name anything that would make it unsafe (re-entrancy into `load`/`unload`,
assumptions about being inside `GroundScene`'s loading state, `m_loading` being true, an active
loading screen, allocation on a specific thread, etc.).

## What NOT to do

- Do not evaluate or propose a fix. Another consultant owns that.
- Do not read the consumer's plans in `SWG-Toolkit/.planning/phases/` — they contain a working
  hypothesis and would anchor you. Stay in `swg-client-v2`.
- Do not assume the observed live symptoms (ground truth items 21-22) have any particular cause. They
  are listed for context only; your job is the call graph, and if it contradicts them, say so.
