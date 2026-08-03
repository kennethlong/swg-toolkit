# CONSULT-RT-02 (Cursor) — Hazards in collapsing three reload call sites into the deferred queue

Read `D:/Code/SWG-Toolkit/.planning/research/CONSULT-RT-00-GROUND-TRUTH.md` first. Its numbered items
are GIVEN — do not re-verify them.

You are the detailed code reader. This is a **concrete file:line review of consumer code we are about
to change**. Cite file:line for every claim.

## Files

- `D:/Code/SWG-Toolkit/packages/live-inject/agent/overlay.cpp` — the injected agent's ImGui overlay,
  the deferred command queue, and the HOST_CMD dispatcher
- `D:/Code/SWG-Toolkit/packages/live-inject/agent/rva_table.cpp` — endpoint bindings
- `D:/Code/SWG-Toolkit/.planning/phases/05.1-live-world-editor-productization/05.1-17-PLAN.md` — the
  proposed change
- `D:/Code/SWG-Toolkit/.planning/phases/05.1-live-world-editor-productization/05.1-16-PLAN.md` — the
  plan that built the deferred queue, including its per-action routing table

## Background you need

The agent renders an ImGui overlay from inside a D3D `Present` hook (`hkSwapChainPresent`). A prior
plan (05.1-16) established that **scene-lifecycle engine calls issued from inside `Present` FATAL the
client**, and built a fixed-capacity deferred command queue drained from a `game::mainLoop` detour on
the game thread, outside `Present`. `LOAD_EDITOR_SCENE` uses a two-frame `cleanupScene` → `loadScene`
sequence through that queue.

There are currently **three** places that reload a scene, all doing `wsUnloadSnapshot(); wsLoad(x);`:

| Site | Context |
| --- | --- |
| `overlay.cpp:944-954` | the deferred `Reload` case (HOST_CMD `RELOAD_CURRENT_SCENE`) — already on the game thread |
| `overlay.cpp:1311-1315` | the local "Reload current scene" ImGui button — **inside `Present`** |
| `overlay.cpp:1324-1328` | the manual "Load##scene" by scene id button — **inside `Present`** |

Plan 05.1-17 proposes to (a) add a call that forces a potentially multi-second synchronous parse to
complete after `wsLoad`, and (b) route all three sites through the single deferred `Reload` case so
that call never runs inside `Present`.

## Questions — answer each separately, file:line

**Q1.** Walk the deferred queue implementation in `overlay.cpp` — enqueue, capacity, overflow, drain
order, the `DeferredCmd` struct and its fields, and the `sceneCleaned` two-frame mechanism. What are
its actual invariants? Anything a new caller could violate?

**Q2. Ack correctness.** The queue carries a `hostCmdEpoch` and acks on execution. The two ImGui
buttons are LOCAL — they have no epoch. Trace exactly what happens if a local button enqueues a
`Reload` with `hostCmdEpoch == 0`. Does any path ack, double-ack, or fail to ack? Does a local enqueue
interfere with a concurrent remote HOST_CMD's pending epoch? Check the epoch-vs-last-applied gating.

**Q3. Capacity and starvation.** What is the queue's capacity, and what happens on overflow today?
If a user clicks a reload button repeatedly (an ImGui button can fire on many consecutive frames if
held or if the handler is reached each frame), can the queue fill? Is the enqueue path idempotent or
coalescing? What is the worst outcome — a dropped command, a double scene load, or something worse?

**Q4. Interaction with the two-frame LoadScene sequence.** If a `Reload` is enqueued while a
`LoadScene` is mid-sequence (frame 1 done, frame 2 pending), what happens? Trace the drain loop.
Is there an ordering or interleaving that produces a scene load against a half-cleaned scene?

**Q5. The manual "Load##scene" site loads an ARBITRARY scene id**, not the current one. The deferred
`Reload` case reads `cmd.scene`. Confirm the field is sized and populated such that routing the manual
load through it is lossless, and identify anything that assumes `cmd.scene` is the *current* scene.

**Q6. Latency and feel.** Moving the two local buttons off the immediate path adds at least one frame
before anything happens, plus a multi-second synchronous parse once it runs. Is there any existing UI
state in the overlay (button disable, in-flight indicator, the note strings) that would now be
misleading — e.g. a button that looks like it did nothing for a frame, or a stale note?

**Q7. `invalidateSceneCachedPointers`.** Each of the three sites calls it with a different reason
string. After the collapse, what is the correct call point and reason, and does any caller depend on
it having happened synchronously with the button click?

**Q8.** Anything else in these files that would break, or any hazard in the plan as written that the
questions above did not reach.

## What NOT to do

- Do not review the root-cause analysis of WHY reload is lossy. Another consultant owns that. Assume
  the force-finish call is going in and review the mechanics of where it goes.
- Do not review `05.1-18-PLAN.md` (teleport). Out of scope here.
