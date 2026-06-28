/**
 * packages/contracts/src/ipc.ts
 * IPC message type definitions for the native ↔ backend ↔ renderer boundary.
 *
 * CORRELATION ID: hello/pong/cross-write/sab-cross-write-ack ALL carry a numeric `id`.
 * Plan 03's main-process demux resolves the matching pending Promise by this id.
 * Without it the demux would access an untyped `data.id` and tsc --noEmit would be dishonest.
 * (review fix MEDIUM / Codex)
 *
 * No runtime code — types only.
 */

/** Sent by renderer to request a hello/pong round-trip. id is the correlation id. */
export type HelloRequest = { type: 'hello'; id: number };

/** Sent by utility process in response to HelloRequest. id echoes the request. */
export type HelloResponse = { type: 'pong'; id: number; value: string };

/**
 * Sent by renderer to trigger the SAB cross-write proof.
 * @param id - Correlation id, echoed in SabCrossWriteAck
 * @param value - DECOY — do not echo; the utility re-reads view[1] from the shared buffer.
 *                The renderer writes a per-run nonce directly to view[1] and does NOT send
 *                it over IPC. The utility reads the nonce from shared memory and acks it.
 *                (review fix MEDIUM-4 / Opus: echoing the IPC arg would false-pass in a copy world)
 */
export type CrossWriteReq = { type: 'cross-write'; id: number; value?: number };

/**
 * Sent by utility process once the SharedArrayBuffer is allocated and ready.
 * No id — fire-once relay; the main process relays this to the renderer.
 */
export type SabReadyMsg = { type: 'sab-ready'; sab: SharedArrayBuffer };

/**
 * Sent by utility process after the SAB cross-write proof.
 * value is the integer the utility RE-READS from the renderer-written slot (view[1])
 * AFTER the renderer wrote its per-run nonce — it is NOT an echo of CrossWriteReq.value.
 * If the SAB is truly shared (zero-copy), the utility sees the nonce the renderer wrote.
 * (review fix MEDIUM-4 / Opus)
 */
export type SabCrossWriteAck = { type: 'sab-cross-write-ack'; id: number; value: number };

/** Sent by main process to utility process to hand over the MessagePort. */
export type PortInitMsg = { type: 'init-port' };

/** Discriminated union of all IPC message types. Every variant has a required `type` literal. */
export type IpcMessage =
  | HelloRequest
  | HelloResponse
  | CrossWriteReq
  | SabReadyMsg
  | SabCrossWriteAck
  | PortInitMsg;

// ─── Typed IPC channel map (Pattern 8 / H6) ──────────────────────────────────
//
// Single source of truth for ipcMain.handle channel names and return types.
// Binding the backend handlers against IpcChannels means a drift in handler return
// type (e.g. returning string|null instead of string[]) becomes a tsc compile error
// on BOTH the handler side (main.ts) AND every renderer call site.
//
// Channels: args are always empty (OS dialog is invoked with no renderer args).
// Return types must match what the handler actually returns — any mismatch fails tsc.
//
// Source: 04.1-10-PLAN.md Task 1; 04.1-PATTERNS.md §contracts/src/ipc.ts.

/**
 * Typed IPC channel → return value map.
 *
 * Import this in renderer call sites to replace inline per-file return-type casts.
 * Import in backend/src/main.ts handler definitions to enforce shape parity at compile time.
 *
 * T-04.1-24: a mismatch between this map and the real handler return type is a tsc error
 * on the backend side (TypedIpcHandler<C>) AND the renderer side (TypedIpcRenderer).
 */
export interface IpcChannels {
  /** OS folder picker — returns selected paths (length 1) or [] if cancelled. */
  'workspace:pick-dir':  string[];
  /** OS file picker for staging "Add…" — returns selected path (length 1) or [] if cancelled. */
  'workspace:pick-file': string[];
  /** OS multi-file picker for mounting .tre archives — returns selected paths or [] if cancelled. */
  'tre:pick-archives':   string[];
}

/**
 * Typed invoke helper for the renderer side.
 * Replaces inline per-file `{ invoke(channel: '…'): Promise<…> }` casts.
 * Usage: `const { ipcRenderer } = require('electron') as { ipcRenderer: TypedIpcRenderer };`
 */
export type TypedIpcRenderer = {
  invoke<C extends keyof IpcChannels>(channel: C): Promise<IpcChannels[C]>;
};

/**
 * Typed handler callback for the backend side.
 * Usage: `ipcMain.handle('workspace:pick-dir', (): IpcChannels['workspace:pick-dir'] => ...)`
 * A handler that returns the wrong shape (e.g. string|null) fails tsc here.
 */
export type TypedIpcHandler<C extends keyof IpcChannels> =
  () => IpcChannels[C] | Promise<IpcChannels[C]>;
