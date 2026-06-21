# Packaging and Distribution

> Covers: Electron Forge app shell, secure preload, installer build, dual-track auto-updates. Source: research doc lines 5043–5237, 5420–5635 (5238–5419 deduped).

> **Caveat:** All configuration snippets below are AI-proposed scaffolding. Validate each option against current Electron Forge, Squirrel.Windows, and Electron `autoUpdater` documentation before use. See [source provenance](../00-overview/source-provenance.md).

This document covers packaging the **SWG-Toolkit application itself** into a redistributable installer and keeping it up to date. It is explicitly not about packaging `.tre` mod archives or IFF/TRE file writing — those belong in [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md).

---

## Contents

1. [Shell Choice: Electron Forge vs Tauri](#1-shell-choice-electron-forge-vs-tauri)
2. [Electron Forge Configuration](#2-electron-forge-configuration)
3. [Main Entry File](#3-main-entry-file)
4. [Secure Preload / Context Isolation](#4-secure-preload--context-isolation)
5. [Build and Redistribute](#5-build-and-redistribute)
6. [Auto-Updates: Dual-Track Architecture](#6-auto-updates-dual-track-architecture)
   - [Track 1 – App Binaries via Squirrel.Windows](#track-1--app-binaries-via-squirrelwindows)
   - [Track 2 – Live Asset-Template Streaming](#track-2--live-asset-template-streaming)
   - [React Update Dashboard Component](#react-update-dashboard-component)
   - [Automated Release Publishing](#automated-release-publishing)

---

## 1. Shell Choice: Electron Forge vs Tauri

To distribute an application that blends high-speed native C++ code with a React web frontend, you need a shell that can load Node-API (N-API) native addons (`.node` binaries) on end-user machines. Two pathways exist:

| Feature | Electron Forge (Recommended) | Tauri |
|---|---|---|
| Native C++ Binding Support | Direct via native Node-API (`.node`) files | Requires custom Rust FFI pipelines |
| V8 Memory Operations | Direct access to low-overhead `SharedArrayBuffer` slots | Copies payloads across JSON IPC boundaries |
| System Footprint | Larger installation package (~80 MB base) | Highly lightweight (~10 MB base) |

**Electron Forge is the recommended choice for SWG-Toolkit.** Its built-in Node.js runtime executes the compiled Recast Navigation and fractal-terrain `.node` binaries directly. Tauri would require bridging all C++ data through a Rust middleware layer, adding significant complexity with no benefit for this use case.

---

## 2. Electron Forge Configuration

Install the required toolchains in the repository root:

```bash
npm install --save-dev @electron-forge/cli @electron-forge/plugin-vite
npx electron-forge import
```

Then configure `forge.config.ts`. The critical requirement is that native `.node` binaries are **unpacked outside the ASAR virtual archive** so the Windows kernel can resolve their addresses:

```typescript
import { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'SWG-Studio',
    executableName: 'swg-studio',
    asar: {
      // CRITICAL: Unpack compiled native binaries outside the ASAR virtual storage envelope.
      // Without this, the Windows OS kernel cannot resolve the C++ library addresses.
      unpack: '*.node'
    },
    icon: './assets/icons/swg_studio'
  },
  reconstructable: true,
  makers: [
    {
      name: '@electron-forge/maker-squirrel', // Standard Windows Installer format target
      config: {
        name: 'swg_studio',
        setupIcon: './assets/icons/swg_studio.ico'
      }
    }
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.mjs'
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mjs'
        }
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs'
        }
      ]
    })
  ]
};

export default config;
```

---

## 3. Main Entry File

`src/main.ts` establishes secure IPC channels between the sandboxed renderer (React/Three.js) and the native C++ engine. The path to the `.node` binary must be resolved differently depending on whether the app is packaged or running in development:

```typescript
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';

// Require the compiled native binary.
// Electron Forge auto-manages path layout shifts between dev and packaged builds.
// node-gyp builds this file inside /build/Release/
const nativeEngine = require(
  app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'swg_native_core.node')
    : path.join(__dirname, '..', 'build', 'Release', 'swg_native_core.node')
);

function createModdingWorkspaceWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Star Wars Galaxies Modding Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,          // Retain strict security layout sandboxing
      contextIsolation: true
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

// --- IPC BRIDGE HANDLERS ---

ipcMain.handle('native:getHeight', async (event, x, z) => {
  return nativeEngine.getHeightAtCoordinate(x, z);
});

ipcMain.handle('fs:saveFile', async (event, filename, uint8ArrayPayload) => {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: filename,
    filters: [{ name: 'SWG Assets', extensions: ['trn', 'fld', 'tre', 'ws', 'nav'] }]
  });

  if (filePath) {
    await fs.writeFile(filePath, Buffer.from(uint8ArrayPayload));
    return true;
  }
  return false;
});

app.whenReady().then(createModdingWorkspaceWindow);
```

---

## 4. Secure Preload / Context Isolation

`src/preload.ts` defines the explicit API surface exposed to the renderer. All calls from the React canvas pass through this bridge, sanitizing them before they reach OS-level hooks.

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Expose the optimized height evaluator to the React Three Fiber canvas
  getTerrainHeight: (x: number, z: number): Promise<number> =>
    ipcRenderer.invoke('native:getHeight', x, z),

  // File system saving proxy
  saveFileToDisk: (filename: string, payload: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke('fs:saveFile', filename, payload),

  // Configuration editing hooks
  registerPatchInClientConfig: (clientDir: string, patchName: string): Promise<void> =>
    ipcRenderer.invoke('cfg:registerPatch', clientDir, patchName)
});
```

To prevent TypeScript type errors in renderer code, declare global types in `src/global.d.ts`:

```typescript
export interface IElectronSwgBridge {
  getTerrainHeight(x: number, z: number): Promise<number>;
  saveFileToDisk(filename: string, payload: Uint8Array): Promise<boolean>;
  registerPatchInClientConfig(clientDir: string, patchName: string): Promise<void>;
}

declare global {
  interface Window {
    api: IElectronSwgBridge;
  }
}
```

---

## 5. Build and Redistribute

Add production scripts to the root `package.json`:

```json
{
  "name": "swg-studio",
  "version": "1.0.0",
  "main": "build/main.js",
  "scripts": {
    "start": "electron-forge start",
    "package": "electron-forge package",
    "make": "electron-forge make"
  }
}
```

To produce the redistributable installer:

```bash
npm run make
```

Electron Forge executes the pipeline in sequence:

1. Runs `node-gyp rebuild` to cross-compile the Recast Navigation and fractal-terrain processing cores into a unified native architecture `.node` file.
2. Minifies the React Three Fiber, Three.js, and TypeScript layers using the Vite compilation profiles.
3. Bundles everything into a standalone container — extracting native `.node` references outside the ASAR wrapper — and outputs a single `.exe` setup installer to `/out/make/`.

**Distribution properties for end users:**

- **Zero setup requirements:** The installer carries pre-compiled copies of all background asset processors and graphics loaders needed to unpack SWG files.
- **Native performance isolation:** The bundled app abstracts complex system configuration. Users can load world maps, execute multi-layer painting brushes, and write patched game payload archives through a unified interface without any developer toolchain installed.

---

## 6. Auto-Updates: Dual-Track Architecture

To avoid forcing a full 80 MB application re-download every time a new 10 KB asset template or definition profile is published, use a **dual-track update system**:

```
[ Modder App Startup ]
         |
         +----> Track 1: Squirrel Update Loop -----> Checks Remote Hazel/GitHub API ---> Performs Full App Update
         |
         +----> Track 2: Asset Template Loader ---> Syncs Remote Content CDN URL    ---> Downloads Metadata Patches
```

- **Track 1 (Application Updates):** Handles core engine updates, C++ Node-API binary rebuilds, and React UI changes. Delivered via Squirrel.Windows.
- **Track 2 (Asset Template Streams):** Downloads lightweight asset definition JSON files from a remote server directly to the modder's local workspace cache. No app rebuild required.

Recommended hosting options for Track 1: [Hazel](https://github.com/vercel/hazel) on Vercel, GitHub Releases, Amazon S3, or DigitalOcean Spaces.

---

### Track 1 – App Binaries via Squirrel.Windows

Squirrel passes hidden command-line flags to the app during install, update, and uninstall events. These **must** be intercepted at the very top of `src/main.ts`, before any window is created, to prevent double-launch loops.

```typescript
import { app, BrowserWindow, autoUpdater } from 'electron';
import handleSquirrelEvent from './squirrelEvents';

// 1. CRITICAL: Handle Squirrel startup event flags immediately
if (handleSquirrelEvent(app)) {
  // If a Squirrel lifecycle flag was intercepted, exit immediately
  process.exit(0);
}

// 2. Configure the auto-updater release server channel
// Point this to your Hazel server or static release storage
const serverFeedUrl = `https://your-hazel-server.vercel.app/${app.getVersion()}`;

function initializeAutoUpdater() {
  if (!app.isPackaged) return; // Skip update loops during local development

  autoUpdater.setFeedURL({ url: serverFeedUrl });

  // Check for updates every 2 hours in the background
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 1000 * 60 * 60 * 2);

  autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
    // Notify the modder or silently restart to apply critical C++ engine patches
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (message) => {
    console.error('Application updater encountered a connection fault:', message);
  });
}

app.whenReady().then(() => {
  initializeAutoUpdater();
  // createModdingWorkspaceWindow() here...
});
```

Create `src/squirrelEvents.ts` to handle each Squirrel lifecycle event:

```typescript
import { App } from 'electron';
import { execSync } from 'child_process';
import * as path from 'path';

export default function handleSquirrelEvent(app: App): boolean {
  if (process.argv.length === 1) return false;

  const squirrelEvent = process.argv[1];
  const updateDotExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const targetExeName = path.basename(process.execPath);

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Create desktop and Start Menu shortcuts via the Squirrel engine
      try {
        execSync(`"${updateDotExe}" --createShortcut="${targetExeName}"`);
      } catch (err) {
        console.error('Failed to create system desktop shortcuts:', err);
      }
      return true;

    case '--squirrel-uninstall':
      // Clean up shortcuts and local config cache on removal
      try {
        execSync(`"${updateDotExe}" --removeShortcut="${targetExeName}"`);
      } catch (err) {
        console.error('Failed to remove app system shortcuts:', err);
      }
      return true;

    case '--squirrel-obsolete':
      return true;
  }

  return false;
}
```

---

### Track 2 – Live Asset-Template Streaming

This TypeScript service streams asset definition JSON from a community-hosted remote URL to the user's local cache, independently of the application binary. It uses incremental version checks to avoid re-downloading unchanged files.

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

export class SwgTemplateSyncService {
  private localCacheDir: string;
  private remoteManifestUrl = 'https://yourmoddingcommunity.org/templates/manifest.json';

  constructor(appUserDataPath: string) {
    this.localCacheDir = path.join(appUserDataPath, 'asset_templates');
  }

  /**
   * Synchronizes newly published structural templates from the community repo.
   * Manifest schema: { version: number, files: string[] }
   */
  public async syncLatestTemplates(): Promise<void> {
    try {
      await fs.mkdir(this.localCacheDir, { recursive: true });

      // 1. Fetch the master version manifest from the remote server
      const response = await fetch(this.remoteManifestUrl);
      const remoteManifest = await response.json();

      const localManifestPath = path.join(this.localCacheDir, 'manifest.json');
      let localVersion = 0;

      try {
        const localManifest = JSON.parse(await fs.readFile(localManifestPath, 'utf-8'));
        localVersion = localManifest.version;
      } catch {
        // First-run initialization: no local manifest yet
      }

      // 2. Fetch new template files incrementally if versions diverge
      if (remoteManifest.version > localVersion) {
        console.log(`Syncing SWG templates (v${localVersion} -> v${remoteManifest.version})`);

        for (const filename of remoteManifest.files) {
          const fileResponse = await fetch(`https://yourmoddingcommunity.org/templates/${filename}`);
          const templateData = await fileResponse.json();

          await fs.writeFile(
            path.join(this.localCacheDir, filename),
            JSON.stringify(templateData, null, 2),
            'utf-8'
          );
        }

        // Persist the updated manifest
        await fs.writeFile(localManifestPath, JSON.stringify(remoteManifest), 'utf-8');
      }
    } catch (err) {
      console.error('Asset template stream synchronization halted:', err);
    }
  }
}
```

Wire `syncLatestTemplates()` into the IPC layer in `src/main.ts` and expose `triggerAssetTemplateSync` through the preload bridge so the renderer can call it.

---

### React Update Dashboard Component

A settings-sidebar card gives modders visibility into template version status and a manual sync trigger:

```typescript
import React, { useState } from 'react';

export const SwgTemplateSyncDashboardCard: React.FC = () => {
  const [syncStatus, setSyncStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');
  const [templateVersion, setTemplateVersion] = useState('1.0.4');

  const handleManualForceSync = async () => {
    setSyncStatus('checking');
    try {
      // Dispatch sync command through context-isolation preload layer
      await window.api.triggerAssetTemplateSync();
      setSyncStatus('success');
    } catch {
      setSyncStatus('error');
    }
  };

  return (
    <div style={{ background: '#252526', padding: '14px', borderRadius: '4px', border: '1px solid #3c3c3c' }}>
      <h4 style={{ color: '#fff', margin: '0 0 6px 0' }}>Asset Template Definitions Channel</h4>
      <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '10px' }}>
        Active Database Version:{' '}
        <span style={{ color: '#00ffcc', float: 'right' }}>v{templateVersion}</span>
      </div>

      <button
        onClick={handleManualForceSync}
        disabled={syncStatus === 'checking'}
        style={{
          width: '100%',
          background: syncStatus === 'checking' ? '#444' : '#ff0055',
          color: '#fff',
          fontWeight: 'bold',
          padding: '8px',
          border: 'none',
          borderRadius: '4px',
          cursor: syncStatus === 'checking' ? 'not-allowed' : 'pointer'
        }}
      >
        {syncStatus === 'checking' ? 'Synchronizing CDN Blocks...' : 'Sync Latest Definitions'}
      </button>

      {syncStatus === 'success' && (
        <div style={{ color: '#00ff55', fontSize: '11px', marginTop: '6px' }}>
          Structures verified against cloud repository.
        </div>
      )}
      {syncStatus === 'error' && (
        <div style={{ color: '#ff0033', fontSize: '11px', marginTop: '6px' }}>
          Sync failed. Check network settings.
        </div>
      )}
    </div>
  );
};
```

Note: `triggerAssetTemplateSync` must be added to the `IElectronSwgBridge` interface in `src/global.d.ts` and exposed in `src/preload.ts`.

---

### Automated Release Publishing

To compile and upload a new application release in one command, add a `publish-release` script to `package.json`:

```json
"scripts": {
  "publish-release": "electron-forge publish"
}
```

Add a `publishers` section to `forge.config.ts` pointing at your GitHub Releases (or S3/DigitalOcean) endpoint with appropriate authentication tokens. Running `npm run publish-release` will then:

1. Re-compile all native `.node` logic blocks via `node-gyp`.
2. Package the optimized components into platform-specific production installers.
3. Upload the setup archives directly to the configured hosting endpoint.

**Operational benefits of the dual-track approach:**

- **Minimal maintenance friction:** The application binary stays stable and large updates are rare. Newly discovered object parameters, creature bounds, or custom planetary texture indexes scale dynamically through independent JSON definition downloads.
- **Instant community bug fixes:** If a structural bug is reported in a `.trn` node description, you can update a single hosted JSON profile. The fix reaches all users the next time they launch the toolkit — no installer re-download required.
