---
created: 2026-08-02
source: CONSULT-RT-03 (crew adversarial review of Plan 05.1-18), then verified directly
affects: any plan that guards player writes in overlay.cpp only
severity: medium — real, but already partially mitigated; the residual is narrow and specific
status: open — investigated 2026-08-02, deliberately NOT folded into Plan 05.1-18
---

# The agent's D-03 poll thread writes engine objects off the game thread, unsynchronized

## What is verified

Two threads in the agent touch the same engine objects with **zero synchronization primitives anywhere
in the package** (grepped: no `CRITICAL_SECTION`, `std::mutex`, `SRWLOCK`; the only interlocked op is an
unrelated install guard):

| | Thread | What it does |
| --- | --- | --- |
| **D-03 poll loop** | `agent_init`, a **fresh remote thread** (`agent_main.cpp:145`, `DWORD WINAPI`) | `Sleep(16)` ≈60 Hz (`:600`); calls `getPlayer()` every iteration (`:294`), defaults focus to the player, dereferences via `getTransform_o2w`/`getNetworkId`/`getTemplateFilename`, and **writes** via `applyWrite` → `setTransform_o2w`/`setScale` (`:548`, `write.cpp:36-43`) whenever a host `LiveCommand` arrives |
| **Overlay** | the **game thread**, via the Present hook and the `game::mainLoop` detour | teleport, gizmo, arm/persist, deferred queue |

## Why this is NOT as bad as it first looks

**The entire poll span is SEH-guarded and this risk was already recognised.** `__try` at
`agent_main.cpp:292` wraps everything from `getPlayer()` through focus resolution, the reads, and
`applyWrite`; `__except(EXCEPTION_EXECUTE_HANDLER)` at `:592` sets `s_agentFaultRecovered`. The comment
at `:283-291` names the exact scenario:

> *"An access violation on a freed/relocated `Object*`/`SwgCuiHud*` (the sim thread tearing an object
> down mid-poll — **T-05-32, accept-watched**) degrades to one skipped frame plus a transient liveness
> bit, never a client crash."*

So this is a **known Phase-5 accept-watch with a deliberate mitigation**, not an unrecognised hazard.
Any write-up describing it as "completely unsynchronized and unguarded" is overstating it — correct on
the letter, wrong on the substance.

**Thread affinity is also not being violated.** The provider's `game-thread-only` annotations attach to
the newer shim rows (`collideScreenRay*`, `getTransformO2P`, `getContainingBuildingId`, `setParentCell`,
the worldSnapshot block). The plain object accessors the poll thread uses — `getPlayer`,
`getTransform_o2w`, `setTransform_o2w`, `setScale`, `getNetworkId` — carry no stated affinity
requirement.

## The residual risk, stated precisely

**SEH converts a use-after-free READ into a skipped frame. It does nothing for a use-after-free WRITE.**
A write into freed-but-still-mapped memory does not fault — it silently succeeds. And that is exactly
the signature of the unreproduced teleport defect: write issued, read-back matched, player never moved
(`.planning/todos/pending/cell-aware-teleport.md`).

The poll thread calls `getPlayer()` **60 times a second**. The overlay's teleport calls it on a click.
So if there is a window in which `getPlayer()` returns a freed player — and the mechanism for one is
confirmed in source at `GameNetwork.cpp:480-505` / `Game.cpp:2214-2217` — **the poll thread is
overwhelmingly the more likely path to enter it**, and it is the one path SEH structurally cannot
protect.

A guard installed only at `overlay.cpp`'s teleport call sites does nothing for this.

## Why it was not folded into Plan 05.1-18

Scoping 05.1-18 to a cross-thread concurrency rework would have blown up a plan whose evidenced content
(cell-aware teleport) is well-understood and shippable. The investigation was run first — at the
maintainer's direction — precisely to find out whether it had to be folded in, and the answer is no:
the overlay-side work is correct on its own, and `setParentCell` is game-thread-only so it must never
be reachable from this thread anyway (an explicit constraint in 05.1-18).

## What to do about it, when it is picked up

1. **Cheapest first — measure before designing.** 05.1-18 Task 3 adds player-pointer + scene-id logging
   on every write. Extend the same logging to the poll thread's `applyWrite` path so a correlation
   between poll-thread writes and a failing teleport becomes visible in a single capture. Sonnet's
   suggested cross-check: correlate `s_agentFaultRecovered` / guard-status writes against
   failing-teleport timestamps.
2. **If a real interaction is demonstrated**, the options in order of preference are: (a) marshal
   poll-thread writes onto the game thread via the 05.1-16 deferred queue, which already exists and
   already drains at the right point; (b) a lock, which is the worse answer because it can block the
   game thread on a 60 Hz poller.
3. **Do not reach for `object::isActive`** to test pointer liveness — calling it on freed memory is
   itself undefined behavior.

Related: [[raw-pointer-identity-aba-across-process-boundary]],
`.planning/todos/pending/cell-aware-teleport.md`.
