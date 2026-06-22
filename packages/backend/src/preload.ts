/**
 * packages/backend/src/preload.ts
 * Path B preload — logging / COI check only (fallback posture).
 *
 * POSTURE (fallback B — contextIsolation:false, nodeIntegration:true):
 *   The preferred posture (contextIsolation:true + narrow contextBridge) was attempted
 *   and FAILED: contextBridge uses structured-clone, which throws "An object could not
 *   be cloned" when transferring a C++ SharedArrayBuffer across isolated-world boundaries.
 *   The fallback posture removes contextIsolation; the renderer main world has Node and
 *   requires('@swg/native-core') directly — no IPC, no bridge, no clone.
 *
 *   With contextIsolation:false, contextBridge.exposeInMainWorld() is NOT used here.
 *   The preload script and renderer share the same JavaScript world; the preload runs
 *   first (before DOM scripts) and is used only for initialization / logging.
 *
 * RESPONSIBILITIES of this preload (contextIsolation:false fallback):
 *   1. Check crossOriginIsolated and log status — early warning if COOP/COEP failed.
 *   2. Log the posture in effect for the SUMMARY proof evidence.
 *   No contextBridge API surface is exposed — the renderer accesses the addon directly.
 */

// With contextIsolation:false, the preload context IS the renderer context.
// No import from 'electron' needed — contextBridge is not used here.

// ---------------------------------------------------------------------------
// crossOriginIsolated guard — LOG-ONLY (do NOT throw; window still loads).
// Runs synchronously in the preload (before DOMContentLoaded DOM scripts).
// crossOriginIsolated === true is required for SharedArrayBuffer; it comes from
// the COOP/COEP headers registered in main.ts. Independent of posture.
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
  console.log('[preload] Path B fallback posture: nodeIntegration=true, contextIsolation=false');
  console.log('[preload] Renderer can require(\'@swg/native-core\') directly (no contextBridge needed).');
});
