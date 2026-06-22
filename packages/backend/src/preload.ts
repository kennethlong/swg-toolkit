/**
 * packages/backend/src/preload.ts
 * Path B preload — requires the native addon and exposes a narrow contextBridge API.
 *
 * TRANSPORT DECISION (00-03 REPLAN § DECISION 2026-06-22 — Path B):
 *   The native addon is loaded HERE in the preload script. The preload runs with Node
 *   because sandbox:false, so require('@swg/native-core') succeeds. The SAB is
 *   allocated in-process and lives in the renderer's process cluster — no IPC, no copy.
 *
 * SECURITY POSTURE (preferred B posture — verified empirically, see 00-03-SUMMARY.md):
 *   sandbox:false + contextIsolation:true + nodeIntegration:false
 *   - The preload (Node context) requires the addon and allocates the SAB.
 *   - contextBridge.exposeInMainWorld() exposes a NARROW API to the isolated main world.
 *   - The main world CANNOT call require() — it accesses the addon only via window.api.
 *   - The key empirical question: does a C++ SharedArrayBuffer survive contextBridge?
 *     If yes: preferred posture is in effect (this file).
 *     If no: fallback to nodeIntegration:true + contextIsolation:false (documented in SUMMARY).
 *
 * WINDOW.API SURFACE (narrow allowlist — revised for Path B):
 *   allocateSab(byteLength)           — C++ allocates a SAB, returns it to renderer
 *   writeSab(sab, int32Index, value)  — C++ writes Int32 into SAB (C++ → renderer proof)
 *   readSab(sab, int32Index)          — C++ reads Int32 from SAB (renderer → C++ proof)
 *   hello()                           — round-trip to C++ hello(), returns 'pong'
 *
 * REMOVED from old preload.ts (utility-relay model):
 *   - ipcRenderer.invoke('hello') relay — hello() now calls nativeCore.hello() directly
 *   - onSabPort() — no longer needed (no SAB relay over MessagePort)
 *   - crossWriteSab() — no longer needed (no cross-process write check)
 *
 * COOP/COEP CHECK:
 *   If crossOriginIsolated is false after DOMContentLoaded, SharedArrayBuffer is
 *   unavailable. Log a clear error (do NOT throw — the window still loads for debugging).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  hello: () => string;
  allocateSab: (byteLength: number) => SharedArrayBuffer;
  writeSab: (sab: SharedArrayBuffer, int32Index: number, value: number) => void;
  readSab: (sab: SharedArrayBuffer, int32Index: number) => number;
};

import { contextBridge } from 'electron';

// ---------------------------------------------------------------------------
// crossOriginIsolated guard — LOG-ONLY (do NOT throw; window still loads).
// Runs after DOMContentLoaded so self.crossOriginIsolated is available.
// crossOriginIsolated === true is required for SharedArrayBuffer; it comes
// from the COOP/COEP headers registered in main.ts (independent of sandbox:false).
// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  if (!self.crossOriginIsolated) {
    console.error(
      '[preload] COOP/COEP not active — crossOriginIsolated=false. SharedArrayBuffer may be unavailable. ' +
      'Check that COOP/COEP headers are set (main.ts onHeadersReceived). Restart the app.'
    );
  } else {
    console.log('[preload] crossOriginIsolated=true — SharedArrayBuffer is available.');
  }
});

// ---------------------------------------------------------------------------
// Narrow contextBridge API — FOUR methods, nothing else.
// The renderer main world accesses the native addon ONLY through this surface.
// No require, no process, no __dirname, no arbitrary Node API exposed.
//
// T-00-07: Only the explicitly listed methods are reachable from the renderer.
// ---------------------------------------------------------------------------
contextBridge.exposeInMainWorld('api', {
  /**
   * Allocates a SharedArrayBuffer of the given byteLength in C++ and returns it
   * to the renderer main world via the contextBridge.
   *
   * PATH B KEY QUESTION: Does the C++ SAB survive the contextBridge boundary?
   * If contextBridge can carry the SAB, the renderer receives a real
   * SharedArrayBuffer in-process (same memory, no IPC). This is verified
   * empirically at runtime — see 00-03-SUMMARY.md proof evidence.
   *
   * @param byteLength Number of bytes to allocate (Phase 0: 8).
   */
  allocateSab: (byteLength: number): SharedArrayBuffer => nativeCore.allocateSab(byteLength),

  /**
   * C++ writes a 32-bit integer value into the SAB at the given Int32 index.
   * Used by the bidirectional same-memory proof:
   *   C++ writes 0xDEAD → renderer reads Int32Array(sab)[0] (C++ → renderer direction).
   */
  writeSab: (sab: SharedArrayBuffer, int32Index: number, value: number): void =>
    nativeCore.writeSab(sab, int32Index, value),

  /**
   * C++ reads and returns a 32-bit integer from the SAB at the given Int32 index.
   * Used by the bidirectional same-memory proof:
   *   renderer writes nonce → C++ reads it back (renderer → C++ direction).
   */
  readSab: (sab: SharedArrayBuffer, int32Index: number): number =>
    nativeCore.readSab(sab, int32Index),

  /**
   * Round-trip to the C++ hello() export. Returns 'pong'.
   * Proves the preload-to-addon call chain works end-to-end.
   * Synchronous — no IPC hop (addon is in-process).
   */
  hello: (): string => nativeCore.hello(),
});
