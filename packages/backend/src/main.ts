/**
 * packages/backend/src/main.ts
 * Electron main process — Path B (native-in-renderer, true zero-copy).
 *
 * TRANSPORT DECISION (00-03 REPLAN § DECISION 2026-06-22):
 *   Cross-process SAB sharing is IMPOSSIBLE in Electron 42 (throws "An object
 *   could not be cloned"). Path B is the chosen transport: the native addon is
 *   loaded in the renderer process. The addon allocates the SAB in-process; the
 *   renderer reads/writes the SAME memory with no IPC and no copy.
 *
 * SECURITY POSTURE — FALLBACK B posture (empirically chosen):
 *   sandbox:false + nodeIntegration:true + contextIsolation:false
 *
 *   The PREFERRED posture (sandbox:false + contextIsolation:true + nodeIntegration:false
 *   + narrow preload contextBridge) was attempted first and FAILED at runtime: a C++
 *   SharedArrayBuffer returned from the native addon cannot be transferred across the
 *   contextBridge boundary — Electron's contextBridge uses structured-clone, which
 *   throws "An object could not be cloned" for SABs across agent-cluster boundaries
 *   (the isolated preload world and the isolated main world are separate agent clusters).
 *
 *   FALLBACK: The renderer main world gets full Node.js access (nodeIntegration:true).
 *   It requires('@swg/native-core') directly — no IPC, no bridge, no clone. The addon
 *   lives in the renderer's own process and agent cluster; the SAB is allocated there
 *   and stays there. This is the PROVEN Utinni model (native + UI in one process).
 *
 *   Security residual risk (documented in 00-03-SUMMARY.md):
 *   - The renderer main world can call require() and access all Node APIs.
 *   - Mitigated for a trusted desktop app (SWG-Toolkit is a local tool, not a public
 *     web app; XSS from external content is not a realistic threat vector here).
 *   - Future hardening: if a web content pane is added, sandbox it in a separate window.
 *
 * COOP/COEP (unchanged from previous main.ts):
 *   session.webRequest.onHeadersReceived is registered synchronously BEFORE
 *   win.loadURL() — RESEARCH Pitfall 1. COOP: same-origin + COEP: require-corp
 *   on ALL responses. crossOriginIsolated === true is maintained and is required
 *   for SharedArrayBuffer even in the fallback posture.
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
// This is independent of the nodeIntegration/sandbox setting — COOP/COEP are
// HTTP response header policies enforced by the browser, not sandbox flags.
// crossOriginIsolated === true is required for SharedArrayBuffer.
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

  // ── STEP 2: BrowserWindow — Path B fallback posture ──────────────────────
  // FALLBACK POSTURE: sandbox:false + nodeIntegration:true + contextIsolation:false
  //
  // The preferred posture (contextIsolation:true + narrow preload contextBridge) failed
  // because contextBridge uses structured-clone, which cannot transfer a C++ SAB across
  // the isolated-world boundary (throws "An object could not be cloned"). See module-
  // level comment for the full posture selection rationale.
  //
  // nodeIntegration:true — renderer main world can require('@swg/native-core') directly.
  // sandbox:false — required to allow Node.js / require() in the renderer.
  // contextIsolation:false — consistent with nodeIntegration:true (when nodeIntegration
  //   is true, contextIsolation:true adds isolated worlds but the bridge still cannot
  //   carry the SAB; false is the simpler consistent fallback).
  // preload: still set to catch the crossOriginIsolated check and log results.
  const preloadPath = app.isPackaged
    ? path.join(app.getAppPath(), '.vite', 'build', 'preload.js')
    : path.join(__dirname, 'preload.js');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // Path B fallback posture — see comment above.
      sandbox: false,
      nodeIntegration: true,
      contextIsolation: false,
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
