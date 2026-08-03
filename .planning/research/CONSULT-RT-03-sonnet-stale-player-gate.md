# CONSULT-RT-03 (fresh Sonnet) — Attack the player-write stability gate

Read `D:/Code/SWG-Toolkit/.planning/research/CONSULT-RT-00-GROUND-TRUTH.md` first. Its numbered items
are GIVEN — do not re-verify them. Items **24-26** are the ones this task is about.

You are the lateral thinker on this crew. Your value here is finding what the obvious answer misses.
Be adversarial. A confident "the design is fine" is the least useful thing you can return.

## The defect

Intermittently, after a live scene reload, clicking teleport in the injected agent's overlay does
nothing — the player does not move. Retrying later works.

An instrumented run recorded (ground truth item 26): **all 5 clicks registered, all 5 writes issued,
the transform read-back matched the target every time, `getPlayer()` returned null zero times.** The
player pointer differed before vs. after the reload. **The failing case was not captured** — that run
did not reproduce the bug.

So: "the write fails" and "the player is null" are both **falsified by evidence**. Do not propose
either.

## The proposed fix (attack this)

A **temporal gate**: sample `getPlayer()` once per game-thread tick in an existing `game::mainLoop`
detour. Track how many consecutive ticks the returned pointer has been unchanged. Refuse player writes
until that count reaches some N. Additionally, reset the counter unconditionally on a scene change,
because a freed-then-reallocated object can land at the same address (the ABA problem), so pointer
equality alone is not proof of identity. Never dereference the suspect pointer to test it — an
explicitly rejected alternative was calling an `isActive()` accessor, which is undefined behavior on
freed memory.

The full plan is at
`D:/Code/SWG-Toolkit/.planning/phases/05.1-live-world-editor-productization/05.1-18-PLAN.md`.
The agent code is `D:/Code/SWG-Toolkit/packages/live-inject/agent/overlay.cpp` (teleport at
`:1354-1410`, HOST_CMD teleport at `:1024-1044`). The engine is `D:/Code/swg-client-v2` — you may read
it; `GroundScene`, `Game`, and `CreatureObject`/player lifecycle are the relevant areas.

## Questions

**Q1. What ELSE could produce these exact observations?** The write is issued, the read-back matches,
the player never moves. Generate as many distinct mechanisms as you can that are consistent with ALL
of that evidence — not just the freed-player hypothesis. For each, say what observation would
distinguish it. Some seeds to go past, not to stop at: the write landing on a *different* player
object than the rendered one; a second player-like object; the transform being overwritten later the
same frame by movement/collision/authority reconciliation; the camera being detached from the player;
cell-relative vs world-relative transform semantics; a client-side prediction layer; the object being
in a state where `setTransform_o2w` is legal but has no visible effect.

**Q2. Would the temporal gate actually DETECT the freed-player case?** Reason it through concretely. If
`getPlayer()` returns a freed pointer for K ticks and then returns the new one, what does the counter
look like? Is there a scenario where the pointer is *stable and freed* for longer than N — in which
case the gate passes and the bug still fires? Does the scene-change reset actually cover that, given
the agent learns about scene changes from its own actions and not from an engine callback?

**Q3. What does the gate BREAK?** Enumerate false refusals. What legitimate situations change the
player pointer or trigger a scene-change reset — zoning, death/respawn, vehicle or mount
enter/exit, character switch, `/reloadui`, the offline editor scene? For each, is refusing a write for
N ticks acceptable or actively wrong?

**Q4. How should N be chosen, and what happens if it is wrong in each direction?** Is a fixed tick
count even the right shape, or should it be time-based, or event-based? Note the agent's tick source
is a `mainLoop` detour whose rate varies with framerate — does that matter?

**Q5. Is there a fundamentally better design available?** Constraints: the consumer is an out-of-process
tool driving an in-process agent; it can only call functions in the advertised catalog (ground truth
items 12-16 show what is and is not in it); it must not dereference a possibly-freed pointer. Given
those, propose alternatives and say honestly whether any beats the temporal gate. Consider whether
some already-advertised row could establish player identity safely, and whether the right move is to
request a new one from the client provider instead of working around it.

**Q6. How would you CAPTURE the failing case?** The bug did not reproduce on the instrumented run. What
instrumentation or repro procedure would maximize the chance of catching it, and what single
observation would confirm or kill the freed-player hypothesis outright?
