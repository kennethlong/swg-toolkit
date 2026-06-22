# CONSULT R2-02 — Codex — Cross-plan wiring re-trace (port topology + round-1 fix consistency)

You are one of four independent reviewers. Your angle is cross-plan wiring and the dependency
DAG — trace the actual data flow across the five plans, not the prose claims.

## LOCKED AXIOMS (treat as given)
1. Electron `webContents.postMessage(channel, message, [transfer])` transfers ONLY
   `MessagePortMain[]`; a SharedArrayBuffer rides in `message` (structured clone).
2. The native SAB allocation gating (`NAPI_EXPERIMENTAL` + node-addon-api `^8.8.0`) is settled
   and correct — do NOT review that; assume it compiles.

## THE OPEN QUESTION (your angle)
A prior verification flagged a possible **internal contradiction in 00-03** about whether the
transferred `MessagePort` (`port1`/`port2`) is actually used or is dead wiring. Trace it
concretely across 00-03's own sections:

- 00-03 `must_haves.truths` asserts: *"The transferred MessagePort is USED (carries the
  cross-write ack) — no dead port wiring"* and a key_link `utility-worker.ts → renderer via
  cross-write ack over the live port`.
- BUT 00-03 Task 1 routes the cross-write request through `ipcMain.handle('cross-write-sab')`
  → `worker.postMessage({type:'cross-write',id,value})` and the worker replies via
  `process.parentPort.postMessage({type:'sab-cross-write-ack',...})` → main's
  `worker.on('message')` demux → resolves the renderer's `ipcRenderer.invoke`.
- Meanwhile `port1` is transferred to the renderer with the SAB (`webContents.postMessage(
  'sab-port', {sab}, [port1])`) and `port2` is held by the worker (`worker.postMessage(
  {type:'init-port'}, [port2])`), but Task 2's renderer/preload surface (`onSabPort`,
  `crossWriteSab`) appears to use `ipcRenderer.invoke`, NOT the transferred port.

Question: **Is `port1`/`port2` genuinely carrying the cross-write ack, or is the ack actually
travelling over the ipcMain/parentPort channel while the MessageChannel ports remain dead
wiring** (the exact round-1 Codex concern, possibly only nominally fixed)? If dead, that does
not break the SAB proof, but the `must_haves.truth` and key_link would be FALSE claims that
should be corrected — either wire the cross-write over the port, or drop the "port is used" truth.

## Secondary checks (cross-plan consistency of the round-1 fixes)
1. **Vite worker path single-source-of-truth**: 00-01 declares the utility-worker Vite entry;
   00-03 forks it. Confirm BOTH now reference exactly `packages/backend/src/utility-worker.ts`
   (round-1 had `src/*` vs `packages/backend/src/*` mismatch). Any residual mismatch?
2. **`__sabValue` / `__sabIsShared` / `__crossWriteOk` single owner**: confirm 00-04 declares
   the owner (StatusBar) as a must_haves truth and 00-05 does NOT edit ViewportPanel to add it.
3. **IPC literal consistency** across 00-01 contracts / 00-03 / 00-04 / 00-05: `hello`, `pong`,
   `sab-ready`, `init-port`, `sab-cross-write-ack`, `cross-write`, channel `sab-port`. All agree?
4. **DAG / waves / files_modified**: any cycle, any same-wave plan writing the same path,
   any requirement ID (FND-01..05) present in zero plans?

## Files
- All five: D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-0{1,2,3,4,5}-PLAN.md
- D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-RESEARCH.md

Output: a markdown review. Severity-tag concerns HIGH/MEDIUM/LOW. Lead with the port-topology verdict.
