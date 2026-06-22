# CONSULT — Electron 42 cross-process SharedArrayBuffer transport (Cursor angle)

## LOCKED GROUND TRUTH — measured 2026-06-22. Do NOT contradict, re-derive, or "fix". (numbered)

Env: Electron **42.4.1**, Windows 11, Node v24.15.0 (bare) / Electron's embedded Node. pnpm monorepo,
Electron Forge + Vite. Native addon = node-addon-api (N-API v8), built with cmake-js. Three OS
processes: **main** (Node), **utility** (Node, `utilityProcess.fork`), **renderer** (sandboxed Chromium).

1. The renderer IS cross-origin isolated: COOP `same-origin` + COEP `require-corp` injected via
   `session.webRequest.onHeadersReceived` BEFORE `loadURL`; renderer reports
   `self.crossOriginIsolated === true`. `new SharedArrayBuffer(n)` is allowed in the renderer.
2. The C++ N-API addon LOADS in the Electron utility process and `allocateSab(8)` returns a working
   `SharedArrayBuffer` (canary printed `view[0]=0xdead`). **Allocation is NOT the problem.**
3. Posting a `SharedArrayBuffer` FROM a Node process **THROWS `Error: An object could not be cloned`**
   via ALL FOUR mechanisms, each tested with a PLAIN JS SharedArrayBuffer (addon-independent):
   - (a) utility `process.parentPort.postMessage({sab})`
   - (b) utility transferred `MessagePortMain.postMessage({sab})`
   - (c) main `win.webContents.postMessage('ch', {sab})`
   - (d) main `MessageChannelMain` port `.postMessage({sab})`  ← the mechanism `docs/architecture.md` prescribes
4. CONTROL (same processes, same calls): plain objects clone OK; a **transferable `ArrayBuffer`**
   (with transfer list) posts OK. The serializer works; it **specifically refuses SharedArrayBuffer**.

### FALSIFIED — BANNED as an answer
- "Electron main↔renderer SAB zero-copy works via MessageChannel + transferred port"
  (`docs/architecture.md`). Tested at (3d): THROWS. Do NOT propose it.

## YOUR ANGLE — Electron 42's actual API surface (you are the precise code/API reader)

Read Electron 42's documented API, TypeScript types, and (if reachable) the relevant serialization
source. Question: **Is there ANY supported Electron 42 mechanism to give a SharedArrayBuffer's BACKING
STORE to the sandboxed, cross-origin-isolated renderer from a Node (main or utility) process — or to
move it the reverse direction (renderer-allocated SAB sent OUT to a Node process)?**

Investigate concretely and cite doc-anchor / file:line evidence:
- `webContents.postMessage` / `ipcRenderer.postMessage` transfer semantics — anything SAB-specific?
- `MessagePortMain` vs Node `node:worker_threads` `MessageChannel`/`MessagePort` — different serializer?
- Command-line switches / feature flags (`app.commandLine.appendSwitch`, `--enable-features`,
  `SharedArrayBuffer`, `--js-flags`), `webPreferences` (sandbox on/off, `nodeIntegrationInWorker`).
- Does `sandbox: true` vs `false` change the result? Does a renderer-side **Web Worker** (same agent
  cluster) plus a transfer-in change anything?
- Any Electron issue/PR/changelog noting SAB-over-IPC support or its removal around v28–v42.

Deliver: the EXACT supported path if one exists (with evidence), or a plain statement that **no
supported path exists** in Electron 42. Do not propose the FALSIFIED (3d) mechanism. Convergence with
the other consultants from a DIFFERENT angle is the signal — stay on the API-surface angle.
