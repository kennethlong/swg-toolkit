/**
 * packages/backend/src/utility-worker.ts
 * Electron utility process — loads native addon, allocates SAB in C++,
 * writes 0xDEAD sentinel, emits early canary, re-reads renderer nonce.
 *
 * Runs as a SEPARATE OS CHILD PROCESS via utilityProcess.fork().
 * Communicates with main via process.parentPort (parentPort ↔ worker.on('message')).
 * Posts the SAB relay via the transferred MessagePort (port2 → sab-ready).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ALLOCATION INVARIANT (RESEARCH Anti-Pattern):
 *   The SAB is allocated in C++ via Napi::SharedArrayBuffer::New,
 *   NEVER via a JS-side SAB constructor (avoids the arrayBuffer.Data() dangling-pointer trap).
 *   The grep check for the JS SAB constructor pattern must return 0.
 *
 * NONCE INVARIANT (review fix MEDIUM-4 / Opus):
 *   ack value MUST be the re-read of view[1], NEVER an echo of
 *   the inbound IPC arg. The renderer never sends its nonce over IPC;
 *   echoing the inbound IPC arg would false-pass a copy.
 *   The nonce-echo grep check (for the IPC arg accessor pattern) must return 0.
 *
 * IPC-ORDERING INVARIANT (review fix LOW / Opus AIRTIGHT):
 *   The utility re-reads view[1] ONLY on-demand after the 'cross-write' IPC message.
 *   The four-hop serialized IPC chain (renderer invoke -> ipcMain -> worker.postMessage
 *   -> parentPort) supplies the happens-before edge. There is NO concurrent reader
 *   racing the writer, so PLAIN writes/reads are correct — Atomics are NOT needed.
 *   Do NOT make this read concurrent/polling without re-introducing Atomics.
 *
 * ARCHITECTURE GATE NOTE (review fix HIGH-3b):
 *   If the utility observes the renderer's nonce, the buffer is genuinely shared (zero-copy).
 *   If it observes 0 (stale), the buffer is a copy at the utility→renderer boundary.
 *   Either outcome is a valid de-risk FINDING — do NOT contrive a pass.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nativeCore = require('@swg/native-core') as {
  hello: () => string;
  allocateSab: (byteLength: number) => SharedArrayBuffer;
};

import type { SabReadyMsg, SabCrossWriteAck } from '@swg/contracts';
import { SAB_LAYOUT } from '@swg/contracts';

// ---------------------------------------------------------------------------
// SAB layout indices (Int32 index = byte offset / 4)
// HELLO_SENTINEL  @ byte 0 → Int32[0]: C++ writes 0xDEAD, renderer reads
// RENDERER_SENTINEL @ byte 4 → Int32[1]: renderer writes nonce, utility re-reads
// ---------------------------------------------------------------------------
const HELLO_IDX: number = SAB_LAYOUT.HELLO_SENTINEL.offset / 4;     // 0
const RENDER_IDX: number = SAB_LAYOUT.RENDERER_SENTINEL.offset / 4; // 1

// ---------------------------------------------------------------------------
// Module-scope state — held across all message events
// ---------------------------------------------------------------------------
let sab: SharedArrayBuffer | null = null;
let view: Int32Array | null = null;
let sabPort: Electron.MessagePortMain | null = null;

// ---------------------------------------------------------------------------
// Message router — ONE persistent handler, no parentPort.once()
// ---------------------------------------------------------------------------
process.parentPort.on('message', (event) => {
  const data = event.data as { type: string; id?: number };

  switch (data.type) {

    // ── 'init-port': receive MessagePort2, allocate SAB, write sentinel, canary ──
    case 'init-port': {
      // Grab the live port (port2) from main.
      sabPort = event.ports[0] as Electron.MessagePortMain;

      // ALLOCATION INVARIANT: allocate via C++ Napi::SharedArrayBuffer::New.
      // This is the ONLY correct allocation path — the JS-side SAB constructor is forbidden.
      // Phase 0 size = 8 bytes (two Int32 slots).
      sab = nativeCore.allocateSab(8);
      view = new Int32Array(sab);

      // Write the 0xDEAD hello sentinel at slot 0 (renderer will read this to
      // prove the utility→renderer round-trip).
      view[HELLO_IDX] = 0xDEAD;

      // EARLY CANARY (review fix HIGH-3c):
      // This line proves the C++ allocation + held view work INSIDE the Electron
      // utility process. It is a DISTINCT signal from the 00-02 Vitest tests, which
      // ran under bare-Node. This canary fires BEFORE the 00-04 renderer shell is
      // built — the "~30-line spike before 17 files" intent. Retained per SON-A
      // reasoning: it surfaces the architecture truth at the 00-03 gate.
      console.log('[canary] SAB allocated in C++; view[0]=0x' + view[HELLO_IDX].toString(16));

      // Relay the SAB to the renderer via the transferred port.
      const sabReadyMsg: SabReadyMsg = { type: 'sab-ready', sab };
      sabPort.postMessage(sabReadyMsg);
      break;
    }

    // ── 'hello': answer a pong round-trip from the renderer ──────────────
    case 'hello': {
      process.parentPort.postMessage({
        type: 'pong',
        id: data.id,
        value: nativeCore.hello(),
      });
      break;
    }

    // ── 'cross-write': re-read view[1] from the held SAB, ack the value ──
    case 'cross-write': {
      // NONCE INVARIANT: re-read view[RENDER_IDX] from the SAME held SAB.
      // Do NOT echo the inbound IPC arg — there is no value field in CrossWriteReq
      // that the utility should read. The renderer writes its nonce directly into
      // the shared buffer slot; the utility reads it here on-demand (IPC-ordering
      // invariant ensures the renderer write happens-before this read).
      const observed: number = view !== null ? view[RENDER_IDX] : -1;

      const ack: SabCrossWriteAck = {
        type: 'sab-cross-write-ack',
        id: data.id as number,
        value: observed,
      };
      process.parentPort.postMessage(ack);
      break;
    }

    default:
      // Unknown message type — ignore safely.
      break;
  }
});
