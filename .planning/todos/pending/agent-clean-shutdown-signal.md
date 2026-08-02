---
created: 2026-08-01
source: provider handback (relayed by maintainer during Phase 05.1 execution)
blocks: nothing — no consumer exists today
---

# Consume `game::getShutdownPhase` for clean agent shutdown

The provider added one row to the `GetEngineHookPoints` table: **`game::getShutdownPhase`**, an
advertised address you call for an int.

```
0 = running    1 = quit requested    2 = ExitChain unwinding
```

**It is a pull, not a transport.** Mechanically identical to `game::g_runningFlags` /
`game::g_mainLoopCounter` — "call-not-read", a function pointer, not a memory location. No channel
write, no `HOST_CMD` action, no callback into consumer code, no named object.

## Why it matters

Closes the Phase-3 follow-up "(b) agent accumulates one poll thread per attach — Phase 5 stop-signal
should unload/clean". Today detach is host-side only (`closeActiveChannel` / `detachUI`); the agent is
never told to wind down.

It is also strictly better than current liveness detection, which is `process.kill(pid, 0)` (memory
`reference-live-sync-liveness-and-poll-loop`) — that only reports the client is *already gone*.
Phase 1 ("quit requested") is what lets the agent unwind on its own terms rather than being discovered
dead after the fact.

## Zero coupling to Phase 05.1

Confirmed with the maintainer: does **not** touch `LIVE_HOST_CMD`. The 1864-byte channel layout locked
in 05.1-03 does not move; plans 07/09/12 are unaffected. Deliberately NOT folded into 05.1 — that plan
set took 13 review rounds to converge and has no consumer for this signal, so widening it mid-execution
would risk a half-propagated seam for zero gain.

## VERIFIED LANDED 2026-08-01 (checked against the client tree, not assumed)

- `engine_hookpoints.inc:86` — `ENGINE_HOOKPOINT(game, getShutdownPhase)`
- `engine_hookpoints.h:286` — `#define ENGINE_HOOKPOINTS_VERSION 26`, catalog now **150 rows**
- Design rationale + why the obvious candidates fail:
  `../swg-client-v2/.planning/handoff/2026-08-01-gl05-vblock-NONREPRO-and-shutdown-signal-design.md` §6.
  (That doc's §6d still reads "not implemented pending Kenny's call" — it predates the implementation.
  Trust the catalog, not the doc.)

**Consumer contract (§6b):** `>= 1` stop queueing new work; `>= 2` issue NO advertised calls at all.
Monotonic, never decreases. Reading it is a plain `int` load — no locks, no dependent subsystem state,
safe from any thread at any time including CRT teardown.

**Rejected alternatives, do not re-propose:** `ExitChain::isRunning()` is **per-thread**
(`PerThreadData::getExitChainRunning()`) — a toolkit thread gets its own `false` forever, and the one
thread for which it is true is the thread blocked inside teardown. `Game::isOver()` is process-wide but
dereferences `IoWinManager`/`Os` state, so it goes unsafe exactly when it matters most.

## Why this is a REAL risk, not hygiene (§6)

Today's safety is **emergent from ordering, not promised by contract**: toolkit calls marshal onto the
Present-hook drain, and by the time `ExitChain::run` executes the main loop is already over, so Present
has stopped firing before the first destructor runs. Per the provider: *"It breaks the moment any
toolkit thread calls an advertised row directly instead of queueing — a `cuiManager::*` or
`worldSnapshot::ws*` call arriving inside that ~1s window hits freed memory and presents as an
unreproducible exit-time crash."* The MCP server / embedded agent are exactly such threads.

## Zero-cost interim available NOW (§6c) — no provider dependency

`game::g_mainLoopCounter` is **already advertised** and already declared in `rva_table.cpp` (backed by
the out-of-line `Game::getMainLoopCount()` returning `ms_loops`). If it stops advancing, the loop is
over. Gate any direct call on "counter moved recently" for a liveness check today.

## Implementation sketch

- Bind `getShutdownPhase` in `packages/live-inject/agent/rva_table.cpp`. Plan 05.1-09 is the only 05.1
  plan touching that file — after 05.1 lands this is a small standalone edit.
- Poll in the agent frame loop; `>=1` → stop the poll thread, stop writing the channel, unwind.

## Side finding — our contract is 20 versions behind

`packages/live-inject/agent/resolve.h:21` declares `ENGINE_HOOKPOINTS_VERSION 6` vs the client's 26.
Harmless by design (we bind by NAME; `resolve.cpp:54` logs a soft warning and continues) and confirmed
live in a DebugView capture this session: `endpoints: contract version mismatch -- resolving by name
anyway`. But it makes that warning permanent noise that would mask a mismatch that DID matter. Unlike
Utinni — which vendors the `.inc` and has a compile-time X-macro subset `static_assert` so a bogus
binding name fails the BUILD — we vendor no catalog at all, so a typo'd name silently resolves to null
and degrades to "capability unavailable". Worth a cheap sync + consider vendoring the `.inc`.

## The trap — do not repeat the Phase-3 `networkId` mistake

It is **advertised-only**. Legacy SWGEmu has no such export and the slot resolves `nullptr`.

A null slot MUST mean *"no shutdown signal available, fall back to existing behavior"* — never
*"phase is unknown, therefore refuse"*. Phase 3 shipped exactly that inverted gate: the `networkId`
sentinel was an advertised-only field that hard-gated **every** legacy write until it was made
not-applicable when the slot is null (STATE.md, `agent_main.cpp results[1]`).

Related: [[reference-live-target-builds-in-scope]], [[swg-client-v2-advertised-hooks]],
[[reference-live-sync-liveness-and-poll-loop]]. Legacy-support context:
`.planning/backlog/milestone-9-swgemu-capability-parity.md`.
