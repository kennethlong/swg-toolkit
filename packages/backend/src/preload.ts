/**
 * packages/backend/src/preload.ts
 * Narrow contextBridge surface: hello() + onSabPort() + crossWriteSab() ONLY.
 *
 * SECURITY INVARIANTS (threat model):
 *   T-00-07: contextBridge bridge is exposed EXACTLY ONCE below via a strict three-property
 *            allowlist. No require, no process, no __dirname, no arbitrary ipcRenderer
 *            passthrough.
 *   T-00-08: crossOriginIsolated check is LOG-ONLY (console.error) — does NOT throw,
 *            so the renderer shell still loads and the devtools probe in Task 3 is runnable.
 *
 * NONCE INVARIANT (review fix MEDIUM-4 / Opus):
 *   crossWriteSab() takes NO argument. The renderer writes its per-run nonce directly into
 *   Int32Array(sab)[1] and NEVER sends the nonce over IPC. This is the only design that
 *   distinguishes genuine same-memory sharing from a copy that echoes an IPC arg.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ---------------------------------------------------------------------------
// crossOriginIsolated guard — LOG-ONLY, not a throw.
// Runs after DOMContentLoaded so self is available. Plan 05 E2E asserts the
// positive case (crossOriginIsolated === true); this log surfaces the negative
// case in the architecture-gate devtools console during Task 3.
// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  if (!self.crossOriginIsolated) {
    console.error(
      'COOP/COEP not active — SharedArrayBuffer unavailable. Restart the app.'
    );
  }
});

// ---------------------------------------------------------------------------
// Narrow API surface — THREE methods, nothing else.
// Strict allowlist; no generic ipcRenderer passthrough; no Node APIs exposed.
// ---------------------------------------------------------------------------
contextBridge.exposeInMainWorld('api', {
  /**
   * Sends a hello request to the main process, which relays it to the utility
   * worker via the demux. Returns 'pong' (the value nativeCore.hello() returns).
   */
  hello: (): Promise<string> => ipcRenderer.invoke('hello') as Promise<string>,

  /**
   * Registers a callback that is called when the utility worker posts the
   * SharedArrayBuffer via the 'sab-port' IPC channel.
   * The callback receives the SAB; renderer asserts instanceof SharedArrayBuffer.
   */
  onSabPort: (cb: (sab: SharedArrayBuffer) => void): void => {
    ipcRenderer.on('sab-port', (_event, payload: { sab: SharedArrayBuffer }) => {
      cb(payload.sab);
    });
  },

  /**
   * Asks the utility worker to re-read view[1] from the held SharedArrayBuffer
   * and ack the value back over IPC.
   *
   * NONCE INVARIANT: NO argument is passed here. The renderer has already written
   * its per-run nonce into Int32Array(sab)[1] BEFORE calling this method. The utility
   * re-reads that slot directly from the shared buffer. If the buffer is genuinely
   * shared (zero-copy), the utility sees the nonce. If it is only a copy, the utility
   * sees 0 (the initial value). Either outcome is a valid de-risk finding.
   *
   * (review fix MEDIUM-4 / Opus — no value arg prevents a copy-only utility from
   *  echoing the IPC arg and false-passing the cross-write proof)
   */
  crossWriteSab: (): Promise<number> => ipcRenderer.invoke('cross-write-sab') as Promise<number>,
});
