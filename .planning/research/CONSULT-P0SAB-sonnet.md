# CONSULT — Lateral working transports for native→renderer bulk data (Sonnet angle)

## LOCKED GROUND TRUTH — measured 2026-06-22. Do NOT contradict or re-derive. (numbered)

Env: Electron **42.4.1**, Windows 11. Three OS processes: **main** (Node), **utility** (Node, `utilityProcess.fork`), **renderer** (sandboxed Chromium, `crossOriginIsolated === true`).

1. Renderer is cross-origin isolated; `new SharedArrayBuffer(n)` is allowed IN the renderer.
2. The C++ N-API addon loads in the utility process and allocates a working SAB (canary `view[0]=0xdead`). Allocation is NOT the problem.
3. Posting a `SharedArrayBuffer` FROM a Node process **THROWS `An object could not be cloned`** via every IPC/MessagePort mechanism (utility parentPort, utility transferred port, main webContents.postMessage, main MessageChannelMain). Tested with a PLAIN JS SAB.
4. CONTROL: plain objects + **transferable ArrayBuffers** (move semantics, with transfer list) post fine.

### FALSIFIED — do NOT propose
- "main↔renderer SAB via MessageChannel + transferred port" (`docs/architecture.md`). Tested: THROWS.

## YOUR ANGLE — out-of-the-box, CONCRETE working alternatives

Given a SAB cannot cross to the renderer (axiom 3), design CONCRETE transports for **native (C++) →
sandboxed renderer bulk binary data at interactive / up-to-60fps rates** in Electron 42. The project's
differentiator is a **live in-game sync mirror**: the renderer continuously reflects geometry/state
read from a running game client's memory.

For each idea, state: the data path, whether it is zero-copy in the native→renderer direction, the
per-frame cost, and bidirectionality. Consider at least:
- **Transferable ArrayBuffer double/triple-buffering** — native writes buffer N, transfers (moves) it
  to the renderer; renderer returns the prior buffer to be refilled. Pool to avoid per-frame alloc.
- **Renderer-allocated SAB shared only with a renderer-side Web Worker** (same agent cluster, so SAB
  works there) — native data arrives into the renderer via transfer, the worker does heavy parsing.
- **Direct GPU upload** — main/utility decodes to a texture/vertex buffer; renderer consumes via
  WebGL/WebGPU/OffscreenCanvas. What can cross the boundary here?
- **Single-process placement** — put the SAB owner inside the renderer's agent cluster; accept reduced
  process isolation for the hot channel only.
- **IPC ring buffer over transferable ArrayBuffers** — bounded latency, backpressure.

Rank them for THIS use case (live 60fps mirror of native memory). Flag any that secretly still need
cross-process SAB (axiom 3 forbids it). Stay on the lateral-alternatives angle — divergence from the
other consultants is the point.
