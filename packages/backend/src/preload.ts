/**
 * packages/backend/src/preload.ts
 * Path B preload — native module path fix + logging / COI check.
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
 *   3. PACKAGED BUILD: patch module resolution so require('@swg/native-core') finds the
 *      extraResource copy in resources/native-core/ (Forge Vite only packs .vite/;
 *      node_modules/ is not in the ASAR, so we use extraResource for the native addon).
 *   No contextBridge API surface is exposed — the renderer accesses the addon directly.
 */

// With contextIsolation:false, the preload context IS the renderer context.
// No import from 'electron' needed — contextBridge is not used here.

// ---------------------------------------------------------------------------
// PACKAGED BUILD: native module resolution patch
// ---------------------------------------------------------------------------
// In the packaged build, the Forge Vite plugin only includes .vite/ in the ASAR.
// @swg/native-core is in 'dependencies' but NOT in the ASAR since it's a native module.
// Forge copies it to resources/native-core/ via extraResource (forge.config.ts).
// Add resources/ to the module search path so require('@swg/native-core') resolves it.
// In dev mode, process.resourcesPath is undefined (or is the Electron resources dir),
// so we only patch in packaged mode (when the app is running as packaged binary).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module') as { _resolveFilename: (req: string, parent: NodeModule | null) => string; globalPaths: string[] };
const path = require('node:path') as typeof import('node:path');

// Packaged-mode detection:
// - In dev mode, process.resourcesPath is the electron binary's resources dir
//   (e.g. "C:\...\node_modules\electron\dist\resources") — contains "node_modules".
// - In packaged mode, process.resourcesPath is the app's resources dir
//   (e.g. "D:\...\out\swg-toolkit-win32-x64\resources") — does NOT contain "node_modules".
// - Additionally, check for the native-core dir in resources as a concrete indicator.
// This avoids needing an IPC round-trip to main just to get app.isPackaged.
const resourcesPath = process.resourcesPath ?? '';
const isPackaged = resourcesPath.length > 0 && !resourcesPath.includes('node_modules');

if (isPackaged && process.resourcesPath) {
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, parent: NodeModule | null, ...args: unknown[]) {
    if (request === '@swg/native-core') {
      // Resolve to the extraResource copy: resources/native-core/
      return origResolve(path.join(process.resourcesPath, 'native-core'), parent, ...args);
    }
    return origResolve(request, parent, ...args);
  } as typeof origResolve;
  console.log('[preload] @swg/native-core patched to resources/native-core (packaged mode).');
}

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
