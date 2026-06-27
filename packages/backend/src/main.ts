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

import { app, BrowserWindow, session, protocol, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// SharedArrayBuffer availability — Chromium 92+ requires crossOriginIsolated
// (COOP + COEP) to access SharedArrayBuffer. In the packaged renderer, serving
// via app:// with COOP/COEP headers establishes crossOriginIsolated=true.
//
// The --enable-features=SharedArrayBuffer flag (legacy bypass) is intentionally
// NOT used here because:
//   a) It bypasses the COOP/COEP requirement, making crossOriginIsolated=false
//      even when SAB is available — the 05-packaged E2E gate asserts COI=true.
//   b) The app:// scheme with COOP/COEP headers is the correct production approach.
//
// If the app:// scheme fails to establish COI (e.g. custom-scheme + COOP
// interaction bug in a future Electron), the preload's DOMContentLoaded log
// will say "crossOriginIsolated=false" — visible in ELECTRON_ENABLE_LOGGING.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PACKAGED FILE:// FALLBACK — app:// protocol scheme registration
// (Fallback rung 2: onHeadersReceived does NOT fire for file:// in packaged builds)
//
// Problem: In a packaged Electron app, the renderer is served via file://.
// Electron's webRequest.onHeadersReceived does NOT intercept file:// protocol
// responses (file:// has no HTTP headers). Therefore COOP/COEP headers set via
// onHeadersReceived take effect for the dev server (http://localhost:5173) but NOT
// for the packaged file:// renderer.
//
// Solution: Register a privileged 'app://' scheme BEFORE app.ready. After ready,
// handle 'app://' requests to serve the renderer's static files with COOP/COEP
// headers injected. Use loadURL('app://swg-toolkit/...') in packaged mode instead
// of loadFile(). The 'app://' scheme behaves like 'https://', so crossOriginIsolated
// is honored.
//
// RESEARCH Pattern 2 / 00-05 plan file:// fallback priority ladder rung 2.
// ---------------------------------------------------------------------------

// MUST be called synchronously BEFORE app.whenReady() — Electron requires scheme
// registration to happen before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,           // enables same-origin policy + URL parsing
      secure: true,             // treats the scheme as 'secure' (like https; required for COI)
      supportFetchAPI: true,    // enables fetch()
      corsEnabled: true,        // enables CORS for requests from this scheme
      stream: true,             // enables streaming responses
      allowServiceWorkers: true, // required for crossOriginIsolated in Electron 35+ (COI needs
                                //  the scheme to be fully privileged including SW support)
    },
  },
]);

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
  // Handles dev server (http://localhost:5173) responses.
  // For the packaged file:// renderer, COOP/COEP is delivered via the app:// handler below.
  setupCrossOriginIsolation();

  // ── STEP 1b: app:// PROTOCOL HANDLER (packaged builds only) ──────────────
  // Handles 'app://swg-toolkit/' requests in the packaged renderer (file:// fallback).
  // Serves the renderer's static files with COOP/COEP headers injected.
  // This is Fallback rung 2 (onHeadersReceived doesn't fire for file:// — see module comment).
  //
  // Implementation: uses the old callback-based registerBufferProtocol API (not the new
  // protocol.handle + Response API). The new protocol.handle with Response objects does NOT
  // properly trigger Chromium's COOP/COEP enforcement machinery for crossOriginIsolated —
  // the response headers are set but crossOriginIsolated remains false. The old
  // registerBufferProtocol API routes through Chromium's network stack which processes
  // COOP/COEP headers correctly.
  //
  // In dev mode, MAIN_WINDOW_VITE_DEV_SERVER_URL is set so this handler is never called.
  // In packaged mode, loadURL('app://swg-toolkit/...') triggers this handler.
  session.defaultSession.protocol.registerBufferProtocol('app', (request, callback) => {
    const url = new URL(request.url);
    // Serve files from the packaged renderer dir (.vite/renderer/main_window/)
    const rendererDir = path.join(app.getAppPath(), '.vite', 'renderer', MAIN_WINDOW_VITE_NAME);
    // Strip the leading slash; default to index.html for SPA routing
    const filePath = url.pathname === '/' || url.pathname === ''
      ? path.join(rendererDir, 'index.html')
      : path.join(rendererDir, url.pathname);

    // Determine MIME type for common web assets
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js':   'application/javascript',
      '.css':  'text/css',
      '.png':  'image/png',
      '.svg':  'image/svg+xml',
      '.ico':  'image/x-icon',
      '.woff2': 'font/woff2',
      '.woff':  'font/woff',
      '.ttf':   'font/ttf',
    };
    const mimeType = mimeTypes[ext] ?? 'application/octet-stream';

    try {
      const data = fs.readFileSync(filePath);
      callback({
        mimeType,
        data,
        // COOP/COEP injected — enables crossOriginIsolated in the packaged renderer.
        // The old registerBufferProtocol API routes through Chromium's network stack
        // which processes these headers correctly (protocol.handle + Response does NOT).
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
      });
    } catch {
      console.error('[main] app:// handler: file not found:', filePath);
      callback({ error: -6 }); // net::ERR_FILE_NOT_FOUND
    }
  });
  console.log('[main] app:// protocol handler registered (packaged COOP/COEP fallback, registerBufferProtocol).');

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

  // ── IPC: native OS file picker for .tre archives ─────────────────────────
  // The renderer has nodeIntegration (Path B) but `dialog` is a main-process-only
  // module. We expose it via ipcMain.handle rather than pulling in @electron/remote
  // — adding a new registry dependency is explicitly forbidden this phase (threat
  // T-01-SC). Note also that File.path was removed in Electron 32+, so a hidden
  // <input type=file> can no longer return a real filesystem path; the native OS
  // dialog is the correct source of truth for archive paths.
  ipcMain.handle('tre:pick-archives', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Mount Archive…',
      filters: [{ name: 'TRE Archives', extensions: ['tre'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // ── IPC: OS folder picker for workspace open/create (Plan 04-02) ─────────
  // WorkspaceEntry.tsx invokes this channel to pick a project folder.
  // Returns an array of one path (the selected folder), or [] if cancelled.
  ipcMain.handle('workspace:pick-dir', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Mod Project Folder…',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // ── IPC: OS file picker for staging panel "Add…" (Plan 04-02) ────────────
  // StagingPanel.tsx invokes this channel to pick a replacement file to stage.
  // Returns an array of one path (the selected file), or [] if cancelled.
  ipcMain.handle('workspace:pick-file', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Add Replacement File…',
      properties: ['openFile'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // ── STEP 3: loadURL LAST ──────────────────────────────────────────────────
  // RESEARCH Pitfall 1: loadURL must be the LAST step so that:
  //   1. onHeadersReceived is already registered when the browser fetches the page.
  //   2. The BrowserWindow (with sandbox:false) is created before the first navigation.
  // No utility process to fork — the addon lives in the renderer's process cluster.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // Dev mode: use the Vite dev server (COOP/COEP via onHeadersReceived)
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    // Packaged mode: use app:// scheme (COOP/COEP via protocol.handle)
    // This is fallback rung 2 replacing win.loadFile() which uses file:// (no COOP/COEP).
    win.loadURL(`app://swg-toolkit/index.html`);
  }
});
