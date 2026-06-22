# CONSULT R2-01 — Cursor — Primary-source check: is cross-process SAB sharing real?

You are one of four independent reviewers. Answer ONLY from primary sources / your own
knowledge of the real APIs. Do not defer to the plan's claims; the plan is what we are testing.

## LOCKED AXIOMS (treat as given — do NOT re-derive or contradict)
1. `Napi::SharedArrayBuffer` is **experimental-gated**: it requires the `NAPI_EXPERIMENTAL`
   compile define AND node-addon-api >= 8.6.0. (This was primary-source verified in a prior
   round against `doc/shared_array_buffer.md`; the underlying `node_api_create_sharedarraybuffer`
   landed in Node v24.9.0 as experimental.) The plan now defines `NAPI_EXPERIMENTAL` and pins
   `node-addon-api@^8.8.0`. **Do not re-litigate this — it is settled.**
2. Electron `webContents.postMessage(channel, message, [transfer])` and
   `MessagePortMain.postMessage(message, [transfer])` accept ONLY `MessagePortMain[]` in the
   transfer list. A `SharedArrayBuffer` travels inside `message` via structured clone, NOT in
   the transfer list.
3. The Electron utility process (`utilityProcess.fork`) is a **separate OS process**, not a
   worker thread of the main/renderer.

## BANNED framing (do not use it to reach a conclusion)
"The 0xDEAD sentinel value survives the IPC hop, therefore the SAB is shared." A serialized
COPY survives that test identically. Value-survival is NOT evidence of sharing. The open
question below is about **same backing store**, not value transport.

## THE OPEN QUESTION (your angle — answer this specifically)
The plan's whole live-sync premise (D-04, FND-03) rests on a `SharedArrayBuffer` allocated in
C++ **inside the utility process** being observable as the **same backing store** in the
**renderer** — so that the renderer writing `0xBEEF` into `Int32[1]` is later re-read by the
utility over a live port **without any re-post**.

Per primary sources (Electron docs, Chromium/V8 structured-clone semantics, Node
`worker_threads`/`MessageChannel` behavior, node-addon-api SAB docs):

- When a `SharedArrayBuffer` is passed in a structured-clone `message` from a utility process
  to a renderer process in Electron, do **both processes share one backing store**, or does the
  receiver get an independent **copy**? Cite the mechanism (SAB structured clone shares the
  backing store ONLY between agents in the same "agent cluster" / same address-space group — is
  utility↔renderer in one cluster, or are they separate clusters that force a copy or a throw?).
- Does Electron/Chromium even **permit** transferring/cloning a SAB across the utility↔renderer
  boundary when `crossOriginIsolated` is true on the renderer but the utility process has no
  such notion? Could it throw `DataCloneError` instead of copying?
- If sharing is NOT possible across that boundary, what is the real-world pattern the live-sync
  feature would have to use instead (e.g., allocate the SAB in the renderer/main and pass a
  handle the other way, or use `MessagePortMain` byte streaming, or a shared memory file)?

## Deliverable
A short verdict: **SHARED / COPY / THROWS / DEPENDS** for the utility→renderer SAB hop, with the
primary-source mechanism and 1-2 citations. If you cannot confirm sharing from primary sources,
say so plainly — "undocumented / not confirmable" is a valid and important answer (it means the
plan's de-risk finding is the real test, not a foregone conclusion). Then: does 00-03 Task 2's
cross-write test correctly DETECT a copy-only outcome (i.e., would it fail loudly rather than
false-pass) if sharing turns out impossible?

## Files (read the real plans — full fidelity, don't trust my summary)
- D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-03-PLAN.md
- D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-02-PLAN.md
- D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-RESEARCH.md (Patterns 1-3, Pitfall 4)

Output: a markdown review. Severity-tag any concern HIGH/MEDIUM/LOW.
