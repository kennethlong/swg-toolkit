# CONSULT R3-02 — Codex — Delta re-trace: did the round-2 edits stay internally consistent?

Third round. The replan layered six fixes onto the plans. Your angle: trace ONLY the round-3
deltas for internal consistency and any regression they introduced. Layered edits are where
contradictions hide.

## LOCKED AXIOMS (settled — don't review)
- NAPI gating settled; SAB-sharing is a deliberate likely-negative experiment (not a defect);
  port topology was corrected (the cross-write ack rides ipcRenderer.invoke→ipcMain→parentPort,
  NOT the transferred MessagePort) — confirm it stayed corrected, don't re-argue it.

## DELTAS TO RE-TRACE (find the contradiction)
1. **Argless `crossWriteSab()` propagation.** Round-2 made it argless and switched to a per-run
   random nonce written to view[1], never sent over IPC. Trace EVERY consumer: contract type
   (`value?` decoy or removed), preload (`crossWriteSab: () => ipcRenderer.invoke('cross-write-sab')`
   — no arg), main (`ipcMain.handle('cross-write-sab', () => worker.postMessage({type:'cross-write',
   id}))` — no value), renderer/StatusBar (writes nonce to view[1], calls argless, asserts
   echoed===nonce). Does ANY consumer still pass/expect a value? Does the StatusBar still hold the
   nonce to compare against the ack (the nonce must be in renderer scope, not re-derived)?
2. **`id` correlation field.** Round-2 added `id` to Hello/Pong/CrossWrite/SabCrossWriteAck. The
   demux resolves pending promises by `id`. CRITICAL: does the worker (utility-worker.ts) actually
   ECHO `event.data.id` back on EVERY reply path — `pong` AND `sab-cross-write-ack`? A demux keyed by
   id where the worker forgets to echo id on one path = that promise NEVER resolves (hang). Verify
   both reply paths carry `id: event.data.id`.
3. **`build.bak` move (00-02 Task 4).** Task 4 renames build/→build.bak to force prebuilds/
   resolution, then restores. Does any OTHER task or the CI `package:ci` step assume `build/Release`
   is present at the same time? Does Task 4 run AFTER the build (Task 2) and is build/ guaranteed
   restored before the human checkpoint (Task 5) and before 00-05 packaging? Any ordering hole where
   build/ is absent when something needs it?
4. **Early canary + architecture gate.** Round-2 added an early SAB canary in utility-worker and made
   00-03 a blocking checkpoint. Confirm the wave/depends_on DAG still serializes so the gate
   (end of 00-03, wave 2) genuinely PRECEDES 00-04 (wave 3) — i.e., 00-04 depends_on includes 00-03,
   no path lets 00-04 start before the gate resolves. Any same-wave file collision newly introduced?
5. **`__crossWriteState` enum.** Added across 00-03/04/05 as {shared|copy|error}. Is it SET on all
   three paths and READ consistently (00-05 asserts the right value; no plan still reads the old
   boolean `__crossWriteOk` in a way that contradicts the enum)?

## Deliverable
A PASS/FAIL per delta with the exact file:line contradiction if any. Lead with any HANG path
(unresolved-promise) you find — those are the most dangerous. If all deltas are consistent, say so
explicitly (a clean PASS is a valid finding; do not manufacture issues).

## Files
- All five: D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-0{1,2,3,4,5}-PLAN.md

Output: markdown, severity-tagged.
