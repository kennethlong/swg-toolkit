# CONSULT — How the REFERENCE projects move bulk data to their UI (Codex angle)

## LOCKED GROUND TRUTH — measured 2026-06-22. Do NOT contradict, re-derive, or "fix". (numbered)

Env: Electron **42.4.1**, Windows 11. Three OS processes: **main** (Node), **utility** (Node), **renderer** (sandboxed Chromium).

1. Renderer is cross-origin isolated (`self.crossOriginIsolated === true`); `new SharedArrayBuffer` is allowed there.
2. The C++ N-API addon loads in the utility process and `allocateSab(8)` works (canary `view[0]=0xdead`). Allocation is NOT the problem.
3. Posting a `SharedArrayBuffer` FROM a Node process **THROWS `Error: An object could not be cloned`** via all of:
   utility `parentPort.postMessage`, utility transferred `MessagePortMain`, main `webContents.postMessage`,
   main `MessageChannelMain` port. Tested with a PLAIN JS SAB (addon-independent).
4. CONTROL: plain objects + **transferable ArrayBuffers** post OK. The serializer specifically refuses SharedArrayBuffer.

### FALSIFIED — BANNED as an answer
- "main↔renderer SAB zero-copy via MessageChannel + transferred port" (`docs/architecture.md`). Tested: THROWS.

## YOUR ANGLE — trace what the WORKING reference architectures actually do (you are the repo tracer)

The sibling reference projects are authoritative; the `docs/` are AI-distilled and suspect. Trace the
real code and report with file:line citations:

- `../Utinni`, `../UtinniPlugins` — the live memory-injection reference. HOW does it get bulk binary
  data (geometry / memory snapshots / framebuffer) from the native side to its UI/view layer? Does it
  use SharedArrayBuffer at all? In-process render thread? Direct DLL memory read? Copy-per-frame? OS
  shared memory / memory-mapped file? A separate UI process or same-process overlay?
- `../swg-client-v2` (modernized client) — how is the renderer/viewport fed vertex/texture bytes from
  the C++ asset loaders? Same-process pointer hand-off, or a serialized/transferred buffer?
- Any Electron/CEF/web UI anywhere in the references — what IPC transport carries large buffers?

Goal: **ground the pivot in what real, working SWG-tool architectures actually use** to move native
bytes to a view, NOT in the falsified docs. If none of them attempt cross-process SAB-to-renderer,
say so — that itself is strong signal. Stay on the reference-tracing angle; cite file:line.
