# CONSULT — Is cross-process SAB-to-renderer EVER possible? (Opus spec/first-principles angle)

## LOCKED GROUND TRUTH — measured 2026-06-22. Do NOT contradict or re-derive. (numbered)

Env: Electron **42.4.1**, Windows 11. Three SEPARATE OS processes: **main** (Node V8), **utility**
(Node V8, `utilityProcess.fork`), **renderer** (sandboxed Chromium/Blink, `crossOriginIsolated === true`).

1. Renderer is cross-origin isolated (COOP `same-origin` + COEP `require-corp`); `new SharedArrayBuffer(n)` allowed in the renderer.
2. C++ N-API addon loads in the utility process and allocates a working SAB (canary `view[0]=0xdead`). Allocation is NOT the problem.
3. Posting a `SharedArrayBuffer` FROM a Node process **THROWS `An object could not be cloned`** via utility parentPort, utility transferred MessagePortMain, main webContents.postMessage, AND main MessageChannelMain port. Tested with a PLAIN JS SAB.
4. CONTROL: plain objects + transferable ArrayBuffers post fine. The serializer specifically refuses SAB.

### FALSIFIED — do NOT cite as working
- "main↔renderer SAB via MessageChannel + transferred port" (`docs/architecture.md`). Tested: THROWS.

## YOUR ANGLE — reason from the spec & process model (you are the spec reasoner)

From the HTML structured-clone algorithm, the ECMAScript SharedArrayBuffer semantics, and the
Chromium/V8 **agent-cluster** model, reason rigorously:

1. Under what EXACT conditions can a SharedArrayBuffer's backing store be shared across two contexts?
   (agent-cluster membership, `crossOriginIsolated`, COOP/COEP, same-origin, same V8 isolate group?)
2. Are Electron's Node **main / utility** processes members of the renderer's agent cluster? They are
   not DOM agents and are separate OS processes/V8 isolates. Does that **categorically** exclude them,
   making axiom 3 a FUNDAMENTAL constraint rather than an Electron bug or a missing flag?
3. Is there ANY spec-permitted path by which native-sourced bytes reach a renderer SAB? E.g. the
   **renderer** creates the SAB and shares it ONLY within its own agent cluster (window + its Web
   Workers), with native data delivered separately by transfer/copy — i.e., the SAB never crosses a
   process boundary at all. Does that satisfy "zero-copy in the renderer" while obeying the spec?
4. Conclude: is "share one SAB backing store between a Node process and the renderer" **impossible by
   construction**, or merely unsupported-by-this-API? State your confidence and the decisive reason.

Reason from first principles; cite the spec sections / Chromium design where you can. Confirm or refute
"fundamentally impossible." Stay on the spec angle — agreement with the others FROM A DIFFERENT BASIS
is the real signal; collapsing onto one shared assumption is the failure mode.
