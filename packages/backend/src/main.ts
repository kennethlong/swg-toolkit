/**
 * packages/backend/src/main.ts
 * Electron main process — BrowserWindow, COOP/COEP, utility fork, demuxed relay,
 * cross-write IPC, reject-pending-on-exit.
 *
 * SECURITY INVARIANTS (from PLAN 03 / threat model):
 *   T-00-06: nodeIntegration: false — renderer cannot call require()
 *   T-00-07: preload bridge is a narrow allowlist (hello/onSabPort/crossWriteSab only)
 *   T-00-08: COOP/COEP registered synchronously FIRST in whenReady callback
 *   T-00-09: native addon only in utility process (sandbox: true)
 *   T-00-11: onHeadersReceived called before win.loadURL() — RESEARCH Pitfall 1
 *   T-00-22: ONE persistent worker.on('message') demux; no one-shot listener race
 *   T-00-25: worker.on('exit') rejects ALL pending promises (crash cannot hang renderer)
 *   T-00-26: cross-write ack carries the UTILITY RE-READ, not an echo of the IPC arg
 *
 * ARCHITECTURE NOTE (review fix MEDIUM-5 / Codex + Cursor):
 *   The transferred MessagePort (port1/port2) carries ONLY the SAB relay (sab-port).
 *   The cross-write ack rides the persistent worker.on('message') demux → ipcMain.handle
 *   response — NOT through the transferred port. The prior "port carries the ack" framing
 *   was dead wiring and is explicitly NOT implemented here.
 */

import { app, BrowserWindow, utilityProcess, MessageChannelMain, session, ipcMain } from 'electron';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

// ---------------------------------------------------------------------------
// COOP/COEP — MUST be called synchronously (RESEARCH Pitfall 1).
// Called as the FIRST statement in the whenReady callback to ensure the hook
// fires BEFORE the initial page load in both dev (http://localhost) and
// packaged (file://) modes.
// ---------------------------------------------------------------------------

function setupCrossOriginIsolation(): void {
  // NOTE: onHeadersReceived is registered here, BEFORE win.loadURL() is called.
  // If this registration happened after loadURL(), the initial HTML response would
  // not carry COOP/COEP headers and crossOriginIsolated would be false (Pitfall 1).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });
  console.log('[main] COOP/COEP response headers registered (onHeadersReceived).');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // ── STEP 1: COOP/COEP FIRST ────────────────────────────────────────────
  setupCrossOriginIsolation();

  // ── STEP 2: BrowserWindow with locked security defaults ────────────────
  // Resolve preload path: in dev, __dirname points to the Vite build output
  // directory (.vite/build/); in packaged, app.getAppPath() + .vite/build/.
  const preloadPath = app.isPackaged
    ? path.join(app.getAppPath(), '.vite', 'build', 'preload.js')
    : path.join(__dirname, 'preload.js');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // T-00-06: nodeIntegration off — renderer cannot call require()
      contextIsolation: true,
      nodeIntegration: false,
      // T-00-09: sandbox on — renderer cannot load native addons
      sandbox: true,
      preload: preloadPath,
    },
  });

  // ── STEP 3: Fork utility worker ────────────────────────────────────────
  // Worker path: Forge Vite plugin emits utility-worker.js to .vite/build/.
  // RESEARCH Pitfall 3: packaged builds land at a different path; use isPackaged branch.
  // Single source of truth: this path matches the rollup input in vite.main.config.ts.
  const workerPath = app.isPackaged
    ? path.join(app.getAppPath(), '.vite', 'build', 'utility-worker.js')
    : path.join(__dirname, 'utility-worker.js');

  const worker = utilityProcess.fork(workerPath);

  // ── STEP 4: MessageChannelMain — port carries SAB relay ONLY ───────────
  // Review fix MEDIUM-5 / Codex + Cursor:
  //   port1 → renderer (receives the SAB via 'sab-port' ipcRenderer.on)
  //   port2 → utility (posts { type:'sab-ready', sab } back through this port)
  //   The port does NOT carry the cross-write ack — that routes via the demux below.
  const { port1, port2 } = new MessageChannelMain();
  worker.postMessage({ type: 'init-port' }, [port2]);

  // ── STEP 5: Correlation-id registries + counter ────────────────────────
  // Review fix MEDIUM / Sonnet: store BOTH resolve and reject so a utility crash
  // can reject pending promises rather than hanging them forever.
  // Maps are keyed by correlation id; cleared on worker exit.
  const pendingHello = new Map<number, PendingCall>();
  const pendingCrossWrite = new Map<number, PendingCall>();
  let callIdCounter = 0;

  function nextId(): number {
    return ++callIdCounter;
  }

  // ── STEP 6: ONE persistent demux — no one-shot listener race ──────────
  // Review fix MEDIUM / Sonnet:
  //   A one-shot on-('message') listener would be consumed by the first arriving message.
  //   'sab-ready' arrives asynchronously after 'init-port'; if hello() fires first,
  //   the one-shot listener consumes 'sab-ready', and hello() hangs forever.
  //   Solution: ONE persistent on('message') routed by data.type + correlation id.
  //
  // T-00-22: enforced — no one-shot ('once') listeners on the worker are used here.
  worker.on('message', (data: { type: string; id?: number; value?: unknown; sab?: SharedArrayBuffer }) => {
    switch (data.type) {
      case 'sab-ready':
        // Relay the SAB to the renderer via port1 (the SAB-relay port).
        // The SAB is passed as the message payload alongside port1.
        // NOTE: webContents.postMessage transfers port1 out of main-process ownership.
        if (data.sab !== undefined) {
          win.webContents.postMessage('sab-port', { sab: data.sab }, [port1]);
        }
        break;

      case 'pong': {
        // Resolve the pending hello() Promise matching this correlation id.
        const helloCall = pendingHello.get(data.id as number);
        if (helloCall) {
          pendingHello.delete(data.id as number);
          helloCall.resolve(data.value);
        }
        break;
      }

      case 'sab-cross-write-ack': {
        // Resolve the pending crossWriteSab() Promise matching this correlation id.
        // data.value is the utility's RE-READ of view[1] from the held SAB —
        // NOT an echo of the IPC arg (see T-00-26 / review fix MEDIUM-4).
        const xwCall = pendingCrossWrite.get(data.id as number);
        if (xwCall) {
          pendingCrossWrite.delete(data.id as number);
          xwCall.resolve(data.value);
        }
        break;
      }

      default:
        // Unknown message type — ignore; do not throw.
        break;
    }
  });

  // ── STEP 7: Reject-on-exit — crash-isolation guarantee ─────────────────
  // T-00-25 (review fix MEDIUM / Sonnet):
  //   The whole point of the utility process is crash isolation — if the utility
  //   crashes, we MUST NOT leave renderer Promises hanging forever. On exit, reject
  //   every pending call with a descriptive Error and clear both Maps.
  worker.on('exit', () => {
    const exitError = new Error('utility process exited');
    for (const pendingCall of pendingHello.values()) {
      pendingCall.reject(exitError);
    }
    pendingHello.clear();
    for (const pendingCall of pendingCrossWrite.values()) {
      pendingCall.reject(exitError);
    }
    pendingCrossWrite.clear();
    console.warn('[main] Utility process exited — all pending promises rejected.');
  });

  // ── STEP 8: IPC handlers ───────────────────────────────────────────────

  // hello: renderer calls window.api.hello() → ipcRenderer.invoke('hello') → here.
  ipcMain.handle('hello', () => {
    const id = nextId();
    worker.postMessage({ type: 'hello', id });
    return new Promise<unknown>((resolve, reject) => {
      pendingHello.set(id, { resolve, reject });
    });
  });

  // cross-write-sab: renderer calls window.api.crossWriteSab() → here.
  // CRITICAL (review fix MEDIUM-4 / Opus):
  //   NO value is forwarded to the utility. The renderer already wrote its per-run
  //   nonce into view[1] of the shared buffer. The utility re-reads view[1] and acks
  //   the re-read value. Forwarding the nonce would allow a copy-only utility to
  //   echo it and false-pass the proof.
  ipcMain.handle('cross-write-sab', () => {
    const id = nextId();
    // Only the correlation id is sent — the nonce lives in the buffer, not IPC.
    worker.postMessage({ type: 'cross-write', id });
    return new Promise<unknown>((resolve, reject) => {
      pendingCrossWrite.set(id, { resolve, reject });
    });
  });

  // ── STEP 9: loadURL LAST ───────────────────────────────────────────────
  // RESEARCH Pitfall 1: loadURL must be the LAST step so the onHeadersReceived
  // hook is already in place when the browser fetches the initial page.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(app.getAppPath(), '.vite', 'renderer', MAIN_WINDOW_VITE_NAME, 'index.html'));
  }
});
