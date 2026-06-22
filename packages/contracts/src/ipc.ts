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
