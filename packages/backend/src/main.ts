/**
 * packages/backend/src/main.ts
 * Electron main process — Path B (native-in-renderer, true zero-copy).
 *
 * TRANSPORT DECISION (00-03 REPLAN § DECISION 2026-06-22):
 *   Cross-process SAB sharing is IMPOSSIBLE in Electron 42 (throws "An object
 *   could not be cloned"). Path B is the chosen transport: the native addon is
 *   loaded in the renderer process (via the preload script, which has Node
 *   because sandbox:false). The addon allocates the SAB in-process; the renderer
 *   reads/writes the SAME memory with no IPC and no copy (~10,600 MB/s vs
 *   ~450 MB/s for Path A IPC copy).
 *
 * SECURITY POSTURE (revised FND-01 — preferred B posture):
 *   sandbox:false + contextIsolation:true + nodeIntegration:false + preload
 *   The preload (runs with Node because sandbox:false) requires the addon and
 *   exposes a NARROW API via contextBridge. The renderer main world is isolated;
 *   it cannot call require() directly. This preserves as much of FND-01's intent
 *   as is possible under Path B.
 *
 *   Fallback posture (if contextBridge cannot carry a C++ SAB):
 *   sandbox:false + nodeIntegration:true + contextIsolation:false
 *   (documented in 00-03-SUMMARY.md if the preferred posture fails at runtime)
 *
 * COOP/COEP (unchanged from previous main.ts):
 *   session.webRequest.onHeadersReceived is registered synchronously BEFORE
 *   win.loadURL() — RESEARCH Pitfall 1. COOP: same-origin + COEP: require-corp
 *   on ALL responses. crossOriginIsolated === true is independently required for
 *   SharedArrayBuffer and is maintained under sandbox:false (it is a header
 *   policy, not a sandbox flag).
 *
 * REMOVED from the previous (old-transport) main.ts:
 *   - utilityProcess.fork() — utility process no longer on the data path
 *   - MessageChannelMain + SAB relay machinery
 *   - Correlation-id demux (pendingHello / pendingCrossWrite Maps)
 *   - ipcMain.handle('hello') / ipcMain.handle('cross-write-sab') relay handlers
 *   - worker.on('exit') reject-on-crash machinery
 *   All of the above belonged to the FALSIFIED utility-process SAB relay model.
 */

import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';

// ---------------------------------------------------------------------------
// COOP/COEP — MUST be called synchronously BEFORE win.loadURL() is called.
// (RESEARCH Pitfall 1: registering after loadURL() means the initial HTML
// response is served WITHOUT the headers, crossOriginIsolated === false,
// and SharedArrayBuffer is unavailable.)
//
// This is independent of sandbox:false — COOP/COEP are HTTP response header
// policies enforced by the browser, not by the sandbox flag.
// ---------------------------------------------------------------------------

function setupCrossOriginIsolation(): void {
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
  // ── STEP 1: COOP/COEP FIRST ──────────────────────────────────────────────
  // This must be the FIRST call in the whenReady callback (RESEARCH Pitfall 1).
  setupCrossOriginIsolation();

  // ── STEP 2: BrowserWindow — Path B preferred posture ─────────────────────
  // sandbox:false — required so the preload can require('@swg/native-core').
  //   A sandboxed preload cannot call require(); native addon would be unavailable.
  // contextIsolation:true — renderer main world is isolated from the preload world.
  //   The contextBridge API is the ONLY surface the renderer can reach.
  // nodeIntegration:false — renderer main world cannot call require() directly.
  //   All Node/native access goes through the contextBridge narrow surface.
  //
  // PREFERRED POSTURE: sandbox:false + contextIsolation:true + nodeIntegration:false
  // This retains as much of FND-01's intent as is possible while loading the addon
  // in the renderer process cluster. Verified empirically at runtime — see SUMMARY.
  //
  // If the C++ SharedArrayBuffer cannot survive the contextBridge hand-off,
  // the fallback posture (nodeIntegration:true + contextIsolation:false) is
  // documented in 00-03-SUMMARY.md.
  const preloadPath = app.isPackaged
    ? path.join(app.getAppPath(), '.vite', 'build', 'preload.js')
    : path.join(__dirname, 'preload.js');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // Path B preferred posture — see comment above.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  // ── STEP 3: loadURL LAST ──────────────────────────────────────────────────
  // RESEARCH Pitfall 1: loadURL must be the LAST step so that:
  //   1. onHeadersReceived is already registered when the browser fetches the page.
  //   2. The BrowserWindow (with sandbox:false) is created before the first navigation.
  // No utility process to fork — the addon lives in the renderer's process cluster.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(app.getAppPath(), '.vite', 'renderer', MAIN_WINDOW_VITE_NAME, 'index.html'));
  }
});
