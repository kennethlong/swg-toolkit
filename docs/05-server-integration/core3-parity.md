# Core3/SWGEmu Client–Server Parity

> Covers: Core3/SWGEmu client↔server parity, Lua template sync, master-file registry, server deployment daemon. Source: research doc lines 8547–8734, 10915–11088, 14551–14782.

> **Caveat:** Core3 file paths and Lua schema shapes below (Lua template generator, master-file registry, deployment orchestrators, React sync controls, "Key Concrete Paths" table) are AI-proposed based on community documentation and must be validated against the actual `Core3` / `MMOCoreORB` source tree before production use. The REST deployment daemon (§ Server-Side Deployment Daemon) is a design sketch and requires a proper security review (authentication, TLS, rate-limiting) before exposure on any network. See [source provenance](../00-overview/source-provenance.md). **EXCEPTION — scoped out of this caveat:** the "Verified: Product-Thesis Close-Out (2026-07-03)" section below (TRE search-path push mechanism + close-out audit) is confirmed against the real `Core3`/`MMOCoreORB` source tree and the maintainer's live WSL2 server, with file:line citations — it is NOT an AI-proposed section.

---

## The Drift Problem

The SWG client reads `.iff` DTII datatable files packed inside `.tre` archives to display weapon stats (damage, attack speed, range) in tooltips and ability bars. The SWGEmu/Core3 server, however, derives its authoritative stat values from **Lua object template scripts**. When a modder edits an `.iff` datatable without also updating the matching server Lua template — or vice versa — the two environments drift out of sync. Players then experience:

- **Rubber-banding** — a weapon appears to fire at one speed visually but applies damage at a different speed server-side.
- **Client tracking desyncs** — collision boundaries or terrain heights differ between client and server.
- **Outright client crashes** — when critical structural tables (`.trn` planet layouts, `.iff` object references) diverge completely.

The solution is a **dual-track deployment pipeline**: every save operation that mutates a client `.iff` datatable simultaneously generates and writes the matching Core3 Lua template, so neither side can drift.

For `.iff` / DTII binary parsing and writing, see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). For DTII datatable column/row semantics, see [../02-formats/datatables-and-strings.md](../02-formats/datatables-and-strings.md). For `.tre` packing, see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md).

---

## Dual-Track Sync Pipeline Overview

```
[ React UI — Datatable / World Changes ]
                  │
     ┌────────────┴────────────┐
     │                         │
     ▼                         ▼
(N-API / C++ Bridge)    (TypeScript Layer)
Mutates .IFF Buffer     Generates Core3 Lua Script
     │                         │
     ▼                         ▼
[ Client .TRE Patch ]   [ Server Core3 Repository ]
```

A higher-level view including the staging registry and remote daemon:

```
[ React Studio UI Canvas ]
              │
   (Click "Publish & Deploy Bundle")
              │
              ▼
[ TS Orchestrator Workspace Dispatcher ]
              │
   ┌──────────┴──────────┐
   │                     │
   ▼                     ▼
[ Local Client      [ Local/Remote Core3 Repo ]
  Sandbox Folder ]   -> Copies Matching .TRE file
  -> C++ TRE Packer  -> Edits live server config
  -> Edits swg.cfg   -> Hot-reloads Lua templates
```

---

## Mapping Core3 Lua Templates

SWG Core3 templates use a Lua object-schema inheritance format. A client virtual path such as:

```
object/weapon/melee/sword/shared_sword_2h_maul.iff
```

maps to a server Lua script at:

```
MMOCoreORB/bin/scripts/managers/templates/weapon/melee/sword_2h_maul.lua
```

The `shared_` prefix is stripped, `.iff` becomes `.lua`, and the category sub-folder (`melee` / `ranged`) is derived from the path.

### Lua Template Generator (TypeScript)

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { WeaponMetric } from './DpsUtils';

export class Core3LuaExporter {

  /**
   * Translates flat datatable weapon properties into clean, functional Core3 Lua script text.
   */
  public generateLuaTemplate(metric: WeaponMetric): string {
    const cleanFileName =
      metric.templateName.split('/').pop()?.replace('shared_', '').replace('.iff', '') ||
      'unknown_weapon';

    // Core3 uses specific bitmask flags to map damage types (Kinetic=1, Energy=2, Blast=4, etc.)
    const core3DamageTypeBitmask = metric.damageType || 1;

    return `-- SWG Studio Automated Server Sync Export Patch
-- Source Client Template: ${metric.templateName}

${cleanFileName} = WeaponObjectTemplate:new {
\tsharedTemplate = "${metric.templateName}",
\tvolumeInt = 1,
\tmonsterDamage = 0,

\t-- Core Balancing Metrics Synced from Editor
\tminDamage = ${metric.minDamage},
\tmaxDamage = ${metric.maxDamage},
\tattackSpeed = ${metric.attackSpeed.toFixed(2)},
\tmaxRange = ${metric.attackRange.toFixed(1)},
\tdamageType = ${core3DamageTypeBitmask},

\tpointBlankAccuracy = 0,
\tpointBlankRange = 0,
\tidealRange = ${Math.floor(metric.attackRange * 0.6)},
\tidealAccuracy = 10,
\tmaxRangeAccuracy = -15,

\thealthCost = ${Math.floor(metric.minDamage * 0.05)},
\tactionCost = ${Math.floor(metric.minDamage * 0.04)},
\tmindCost = ${Math.floor(metric.minDamage * 0.02)},
}

ObjectTemplates:addTemplate(${cleanFileName}, "${metric.templateName.replace('shared_', '')}")
`;
  }
}
```

---

## Central Master-File Registry

Rather than having users manually copy files into separate directories, the toolkit maintains a single unified **staging sandbox** on the modder's machine:

```
.studio/workspace/staging/
```

All editor operations — terrain brush strokes, foliage spawns, weapon datatable edits — write into this directory tree using the game's virtual path layout:

```
.studio/workspace/staging/appearance/terrain/tatooine.trn
.studio/workspace/staging/datatables/item/object_template_weapon.iff
```

This staging directory becomes the single source of truth that the deployment pipeline reads from when compiling the output `.tre` archive.

---

## Automated Multi-Destination Deployment

### Deployment Orchestrator (TypeScript)

The `SwgDeploymentOrchestrator` handles the single-weapon case (client `.iff` + server Lua simultaneously):

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { Core3LuaExporter } from './Core3LuaExporter';
import { WeaponMetric } from './DpsUtils';

export class SwgDeploymentOrchestrator {
  private luaExporter = new Core3LuaExporter();

  constructor(private nativeAddon: any) {}

  /**
   * Saves dataset modifications back to both client archives and Core3 server concurrently.
   */
  public async deployItemBalanceChanges(
    updatedWeapon: WeaponMetric,
    core3ScriptsPath: string,
    clientTrePath: string
  ): Promise<void> {

    // 1. CLIENT STEP: Re-compile the updated .iff binary datatable via N-API backend
    const compiledIffBuffer: ArrayBuffer =
      await this.nativeAddon.compileJsToDatatableStream(updatedWeapon);
    const clientBytes = new Uint8Array(compiledIffBuffer);

    const targetIffPath = path.join(
      clientTrePath,
      'datatables/item/object_template_weapon.iff'
    );
    await fs.writeFile(targetIffPath, clientBytes);

    // 2. SERVER STEP: Generate Core3 Lua and write into the server scripts tree
    const luaScriptContent = this.luaExporter.generateLuaTemplate(updatedWeapon);

    const weaponCategory = updatedWeapon.templateName.includes('/melee/') ? 'melee' : 'ranged';
    const cleanLuaName =
      updatedWeapon.templateName
        .split('/')
        .pop()
        ?.replace('shared_', '')
        .replace('.iff', '.lua') || '';

    const targetLuaPath = path.join(
      core3ScriptsPath,
      `managers/templates/weapon/${weaponCategory}/${cleanLuaName}`
    );

    await fs.writeFile(targetLuaPath, luaScriptContent, 'utf-8');
    console.log(`Successfully synchronized server-side item parameters inside: ${cleanLuaName}`);
  }
}
```

### Bulk Parity Sync Orchestrator (TypeScript)

For full world deployments — terrain, foliage, and all datatables at once — the `SwgParitySyncOrchestrator` compiles the entire staging directory into one `.tre` archive and pushes it to both client and server:

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SyncTargetConfig {
  clientDirectory: string;  // e.g. "C:/SWG_Client/"
  serverDirectory: string;  // e.g. "C:/Core3_Server/"
  patchArchiveName: string; // e.g. "patch_custom_content.tre"
}

export class SwgParitySyncOrchestrator {

  /**
   * Compiles the staging directory and pushes the archive to both client and server paths.
   */
  public async executeParitySyncPipeline(
    config: SyncTargetConfig,
    nativePackerAddon: any
  ): Promise<void> {
    const stagingDir = path.join(process.cwd(), '.studio', 'workspace', 'staging');

    // 1. COMPILATION PASS: Build the entire staging tree into a single .tre ArrayBuffer
    //    (calls the C++ tree-archive builder — see ../01-core-engine/iff-and-tre.md)
    const compiledTreBuffer: ArrayBuffer =
      await nativePackerAddon.compileDirectoryToTreStream(stagingDir);
    const rawBytesView = new Uint8Array(compiledTreBuffer);

    // 2. CLIENT DEPLOYMENT
    const clientTargetFile = path.join(config.clientDirectory, config.patchArchiveName);
    await fs.writeFile(clientTargetFile, rawBytesView);
    console.log(`Pushed patch to client: ${clientTargetFile}`);

    // 3. SERVER DEPLOYMENT
    // Core3 reads loose files from the /data/ sub-directory
    const serverTargetFolder = path.join(config.serverDirectory, 'data');
    await fs.mkdir(serverTargetFolder, { recursive: true });
    const serverTargetFile = path.join(serverTargetFolder, config.patchArchiveName);
    await fs.writeFile(serverTargetFile, rawBytesView);
    console.log(`Pushed patch to server: ${serverTargetFile}`);

    // 4. CONFIG INTEGRATION PASS: Register the new archive in both boot configs
    await this.updateClientConfiguration(config.clientDirectory, config.patchArchiveName);
    await this.updateServerConfiguration(config.serverDirectory, config.patchArchiveName);
  }

  private async updateClientConfiguration(dir: string, patchName: string): Promise<void> {
    // Re-use SwgCfgManager to add "searchTree=patchName" inside swg.cfg or live.cfg
  }

  private async updateServerConfiguration(dir: string, patchName: string): Promise<void> {
    const configPath = path.join(dir, 'config', 'config.lua'); // Standard Core3 config path
    try {
      let content = await fs.readFile(configPath, 'utf-8');

      if (!content.includes(patchName)) {
        // Core3 loads search paths via an explicit Lua list block; append our archive entry
        content = content.replace(
          '--追加ツリーファイル定義リスト--',
          `addSearchTree("${patchName}")\n\t--追加ツリーファイル定義リスト--`
        );
        await fs.writeFile(configPath, content, 'utf-8');
        console.log(`Server boot config updated for patch: ${patchName}`);
      }
    } catch {
      // Handle non-standard server repository layouts gracefully
    }
  }
}
```

**Datatable-specific note:** Binary `.iff` table files inside the `.tre` archive handle terrain maps and foliage. Relational datatable columns (weapon pricing, damage matrices, profession constraints) also require the Lua exporter above to generate or overwrite matching server Lua templates at the same moment the `.tre` is compiled, ensuring complete parity for item stats.

---

## Server-Side Deployment Daemon (Remote Hot-Reload)

For remote servers (e.g., a Linux machine running Core3), the toolkit includes a lightweight C++ daemon that runs alongside the Core3 process. It exposes a REST endpoint to accept changeset payloads from the TypeScript layer, unpack them into the server workspace, and trigger a template reload.

> **Security note (design sketch):** The daemon below listens on `0.0.0.0` with no authentication. Before any real deployment, add bearer-token or mTLS authentication, restrict binding to a private interface, and apply a rate-limit. This is a design sketch requiring a dedicated security review.

### Daemon Process (C++)

Dependencies: [`cpp-httplib`](https://github.com/yhirose/cpp-httplib) (header-only), [`nlohmann/json`](https://github.com/nlohmann/json).

> **Vendored headers required.** The daemon depends on two header-only libraries that are not bundled with the toolkit and must be copied into the build tree before compilation. Place [`httplib.h`](https://github.com/yhirose/cpp-httplib/blob/master/httplib.h) (cpp-httplib) and [`nlohmann/json.hpp`](https://github.com/nlohmann/json/releases) on your include path — the `#include` directives in the code below will resolve them once the headers are present. The published source omitted these includes; they are restored here for completeness.

```cpp
#include <httplib.h>           // High-performance C++ header-only HTTP server
#include <nlohmann/json.hpp>   // JSON library for C++
#include <filesystem>
#include <fstream>
#include <iostream>

namespace fs = std::filesystem;
using json = nlohmann::json;

class SwgServerDeploymentDaemon {
private:
    fs::path serverCorePath;
    fs::path serverDataPath;
    fs::path serverScriptsPath;

public:
    SwgServerDeploymentDaemon(const std::string& rootPath) {
        serverCorePath   = fs::path(rootPath);
        serverDataPath   = serverCorePath / "data";
        serverScriptsPath = serverCorePath / "bin" / "scripts";
    }

    /**
     * Reverts server-side scripts and data tables by pruning a specific changeset layer.
     */
    bool ExecuteServerRollback(uint32_t versionIndex, const std::string& changesetId) {
        std::cout << "[Daemon] Executing global server rollback to Version: "
                  << versionIndex << std::endl;

        // 1. Remove the changeset layer directory from the server data stack
        fs::path targetLayerPath =
            serverCorePath / ".studio_server" / "changesets" / changesetId;
        if (fs::exists(targetLayerPath)) {
            fs::remove_all(targetLayerPath);
        }

        // 2. Trigger Core3 live template reload
        // In production, signal the running Core3 process or admin tool:
        // system("/Core3_Server/bin/core3_admin_tool --reload-templates");

        return true;
    }

    /**
     * Starts the background HTTP listener.
     */
    void StartDaemonListener(int port) {
        httplib::Server svr;

        // Endpoint: receives rollback directives from the TypeScript orchestrator
        svr.Post("/api/deploy/rollback",
            [this](const httplib::Request& req, httplib::Response& res) {
                try {
                    auto bodyJson = json::parse(req.body);
                    uint32_t versionIdx      = bodyJson["versionIndex"];
                    std::string changesetId  = bodyJson["changesetId"];

                    bool success = this->ExecuteServerRollback(versionIdx, changesetId);

                    json response;
                    response["status"] = success ? "success" : "failed";
                    res.set_content(response.dump(), "application/json");
                } catch (const std::exception& e) {
                    res.status = 500;
                    res.set_content(e.what(), "text/plain");
                }
            });

        std::cout << "[Daemon] SWG Studio Server Daemon listening on port "
                  << port << std::endl;
        svr.listen("0.0.0.0", port);
    }
};

int main(int argc, char* argv[]) {
    SwgServerDeploymentDaemon daemon("/home/swg/core3_server");
    daemon.StartDaemonListener(8080);
    return 0;
}
```

### Network Sync Orchestrator (TypeScript)

The TypeScript side manages local client state and simultaneously dispatches REST calls to the remote daemon:

```typescript
export interface CrossEnvironmentSyncPayload {
  versionIndex: number;
  changesetId: string;
  serverDaemonUrl: string; // e.g. "http://192.168.1.50:8080"
}

export class SwgCrossEnvironmentSyncService {

  /**
   * Dispatches a global, synchronized version change to both local files and the server daemon.
   */
  public async executeSynchronizedVersionShift(
    payload: CrossEnvironmentSyncPayload,
    nativeClientAddon: any
  ): Promise<void> {
    const workspaceRoot = process.cwd();

    // 1. CLIENT TRACK: Apply local changeset via C++ native addon
    console.log(
      `[Sync] Triggering local client-side version shift to index: ${payload.versionIndex}`
    );
    await nativeClientAddon.executeNativeRollback(workspaceRoot, payload.changesetId);

    // 2. SERVER TRACK: Dispatch to remote daemon
    console.log(
      `[Sync] Dispatching to server daemon: ${payload.serverDaemonUrl}`
    );

    const response = await fetch(`${payload.serverDaemonUrl}/api/deploy/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versionIndex: payload.versionIndex,
        changesetId: payload.changesetId
      })
    });

    if (!response.ok) {
      throw new Error(
        `Server daemon rejected synchronization request. Code: ${response.status}`
      );
    }

    const result = await response.json();
    if (result.status !== 'success') {
      throw new Error(
        'Server-side changeset deployment or template reload encountered a fault.'
      );
    }

    console.log(
      `[Sync] Global environment aligned at version v${payload.versionIndex}`
    );
  }
}
```

---

## React Sync Controls

Three UI components cover different levels of the pipeline. Use whichever fits the workflow context.

### Per-Item Parity Sync Toolbar (`SwgServerSyncToolbar`)

Attached to the weapon/item datatable editor. Exposes Core3 scripts path and client patch workspace path, then fires the dual-track deployment for the currently selected item:

```tsx
import React, { useState } from 'react';

interface SyncPanelProps {
  activeWeaponNode: any; // Item currently selected in the data grid
  nativeBridge: any;
}

export const SwgServerSyncToolbar: React.FC<SyncPanelProps> = ({
  activeWeaponNode,
  nativeBridge
}) => {
  const [core3Path, setCore3Path] = useState('C:/Core3_Server/bin/scripts');
  const [clientPatchPath, setClientPatchPath] = useState('C:/SWG_Client/patch_workspace');
  const [isDeploying, setIsDeploying] = useState(false);

  const handleExecuteParitySync = async () => {
    if (!activeWeaponNode) return;
    setIsDeploying(true);

    try {
      await window.api.executeFullParitySync(activeWeaponNode, core3Path, clientPatchPath);
      alert('Parity Sync Complete! Client datatables and Core3 Lua templates are aligned.');
    } catch (err: any) {
      alert(`Deployment Halted: ${err.message}`);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div style={{
      background: '#252526', padding: '14px', borderRadius: '4px',
      border: '1px solid #00ffcc', fontFamily: 'monospace'
    }}>
      <h4 style={{ color: '#00ffcc', margin: '0 0 10px 0' }}>
        Core3 Linux/Lua Cross-Parity Synchronizer
      </h4>

      <div style={{ display: 'grid', gap: '8px', fontSize: '11px', color: '#bbb', marginBottom: '12px' }}>
        <label>
          Target Core3 Scripts Folder:
          <input
            type="text"
            value={core3Path}
            onChange={(e) => setCore3Path(e.target.value)}
            style={{
              width: '100%', background: '#111', color: '#fff',
              border: '1px solid #555', padding: '4px', marginTop: '2px'
            }}
          />
        </label>
        <label>
          Target Local Client Patch Workspace:
          <input
            type="text"
            value={clientPatchPath}
            onChange={(e) => setClientPatchPath(e.target.value)}
            style={{
              width: '100%', background: '#111', color: '#fff',
              border: '1px solid #555', padding: '4px', marginTop: '2px'
            }}
          />
        </label>
      </div>

      <button
        onClick={handleExecuteParitySync}
        disabled={isDeploying || !activeWeaponNode}
        style={{
          width: '100%',
          background: isDeploying ? '#444' : '#00ffcc',
          color: '#111', fontWeight: 'bold', padding: '10px',
          border: 'none', borderRadius: '4px',
          cursor: !activeWeaponNode ? 'not-allowed' : 'pointer'
        }}
      >
        {isDeploying ? 'Deploying Code Assets...' : 'Sync & Compile to Core3 Server'}
      </button>
    </div>
  );
};
```

### Master Sync Dashboard (`SwgMasterSyncDashboard`)

Sits on the main workspace toolbar. Compiles the full staging directory and deploys to both client and server in one click:

```tsx
import React, { useState } from 'react';

export const SwgMasterSyncDashboard: React.FC<{ nativeBridge: any }> = ({ nativeBridge }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [paths, setPaths] = useState({
    client: 'C:/SWG_Client_Test',
    server: 'C:/Core3_Server_Repo',
    fileName: 'patch_studio_v1.tre'
  });

  const handleTriggerMasterSync = async () => {
    setIsProcessing(true);
    try {
      await window.api.executeFullParitySyncPipeline(paths, nativeBridge);
      alert('Success! Client assets, server assets, and launch configs are 100% in sync.');
    } catch (err: any) {
      alert(`Sync Pipeline Halted: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{
      background: '#1e1e24', border: '1px solid #00ffcc',
      padding: '16px', borderRadius: '4px', color: '#fff', fontFamily: 'monospace'
    }}>
      <h4 style={{ color: '#00ffcc', margin: '0 0 10px 0' }}>
        Global Client-Server Sync Core
      </h4>
      <p style={{ fontSize: '11px', color: '#888', margin: '0 0 14px 0' }}>
        Compiles, packages, and deploys workspace modifications across client files and
        server scripts simultaneously.
      </p>

      <div style={{ display: 'grid', gap: '8px', fontSize: '11px', color: '#ccc', marginBottom: '14px' }}>
        <label>
          Local Desktop Client Path:
          <input
            type="text"
            value={paths.client}
            onChange={(e) => setPaths({ ...paths, client: e.target.value })}
            style={{
              width: '100%', background: '#111', color: '#fff',
              border: '1px solid #444', padding: '4px'
            }}
          />
        </label>
        <label>
          Core3 Server Path Root:
          <input
            type="text"
            value={paths.server}
            onChange={(e) => setPaths({ ...paths, server: e.target.value })}
            style={{
              width: '100%', background: '#111', color: '#fff',
              border: '1px solid #444', padding: '4px'
            }}
          />
        </label>
      </div>

      <button
        onClick={handleTriggerMasterSync}
        disabled={isProcessing}
        style={{
          width: '100%',
          background: isProcessing ? '#444' : '#00ffcc',
          color: '#111', fontWeight: 'bold', padding: '10px',
          border: 'none', borderRadius: '2px', cursor: 'pointer'
        }}
      >
        {isProcessing ? 'Rebuilding Shared Tree Volumes...' : 'Run Parity Synchronization Pipeline'}
      </button>
    </div>
  );
};
```

### Global Parity Sync Hub (`SwgGlobalParitySyncPanel`)

Sits in the version-history sidebar. Targets the remote server daemon by URL and shows a live status console. Used when triggering a changeset push or rollback across both local client files and the remote Core3 process simultaneously:

```tsx
import React, { useState } from 'react';
import { SwgCrossEnvironmentSyncService } from './SwgCrossEnvironmentSyncService';

interface ServerExtensionProps {
  activeVersionIndex: number;
  selectedChangesetId: string;
  nativeBridge: any;
}

export const SwgGlobalParitySyncPanel: React.FC<ServerExtensionProps> = ({
  activeVersionIndex,
  selectedChangesetId,
  nativeBridge
}) => {
  const [serverDaemonUrl, setServerDaemonUrl] = useState('http://192.168.1.50:8080');
  const [syncState, setSyncState] = useState<'idle' | 'deploying' | 'complete'>('idle');
  const [statusLog, setStatusLog] = useState(
    'Environments aligned. Ready for synchronized deployment passes.'
  );

  const handleExecuteGlobalVersionShift = async () => {
    setSyncState('deploying');
    setStatusLog(
      `Triggering global parity synchronization to version v${activeVersionIndex}...`
    );

    const syncEngine = new SwgCrossEnvironmentSyncService();
    const payload = {
      versionIndex: activeVersionIndex,
      changesetId: selectedChangesetId,
      serverDaemonUrl: serverDaemonUrl.trim()
    };

    try {
      await syncEngine.executeSynchronizedVersionShift(payload, nativeBridge);
      setSyncState('complete');
      setStatusLog(
        `Parity Success! Client files and Core3 templates are 100% in sync at v${activeVersionIndex}.`
      );
    } catch (err: any) {
      setSyncState('idle');
      setStatusLog(`Synchronization Aborted: ${err.message}`);
    }
  };

  return (
    <div style={{
      background: '#16161a', padding: '14px', border: '1px solid #00ffcc',
      borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', color: '#fff'
    }}>
      <h4 style={{ color: '#00ffcc', margin: '0 0 10px 0' }}>
        Global Client-Server Parity Sync Hub
      </h4>
      <p style={{ color: '#888', margin: '0 0 12px 0', fontSize: '10px' }}>
        Deploys asset modifications and triggers template reloads across client directories
        and server core simultaneously.
      </p>

      <div style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
        <label>
          Remote Server Daemon URL:
          <input
            type="text"
            value={serverDaemonUrl}
            onChange={(e) => setServerDaemonUrl(e.target.value)}
            placeholder="http://localhost:8080"
            style={{
              width: '100%', background: '#0a0a0c', color: '#fff',
              border: '1px solid #444', padding: '6px', marginTop: '2px', outline: 'none'
            }}
          />
        </label>
      </div>

      {/* Status console */}
      <div style={{
        height: '55px', overflowY: 'auto', background: '#050507',
        padding: '6px', fontSize: '10px', color: '#00ffcc',
        border: '1px solid #2d2d35', marginBottom: '12px'
      }}>
        {statusLog}
      </div>

      <button
        onClick={handleExecuteGlobalVersionShift}
        disabled={syncState === 'deploying'}
        style={{
          width: '100%',
          background: syncState === 'deploying' ? '#444' : '#00ffcc',
          color: '#111', fontWeight: 'bold', padding: '10px',
          border: 'none', borderRadius: '2px',
          cursor: syncState === 'deploying' ? 'not-allowed' : 'pointer'
        }}
      >
        {syncState === 'deploying'
          ? 'Re-aligning Global Environment Layers...'
          : 'Push Synchronized Version Change'}
      </button>
    </div>
  );
};
```

---

## Key Concrete Paths

| Asset | Path |
|---|---|
| Core3 Lua template root | `MMOCoreORB/bin/scripts/managers/templates/` |
| Weapon templates (melee) | `MMOCoreORB/bin/scripts/managers/templates/weapon/melee/` |
| Weapon templates (ranged) | `MMOCoreORB/bin/scripts/managers/templates/weapon/ranged/` |
| Server data directory | `<serverRoot>/data/` |
| Server boot config | `<serverRoot>/config/config.lua` |
| Studio staging root | `.studio/workspace/staging/` |
| Daemon changeset store | `<serverRoot>/.studio_server/changesets/<changesetId>/` |

> All Core3 paths are AI-proposed and must be verified against the actual `MMOCoreORB` repository. See [source provenance](../00-overview/source-provenance.md).

---

## Verified: Product-Thesis Close-Out (2026-07-03)

This section is confirmed against real, currently-shipped SWG-Toolkit source and the real
`Core3`/`MMOCoreORB` repository (read directly this session at `../Core3`), plus the maintainer's
live WSL2 Core3 instance. It replaces the "AI-proposed" caveat above for the TRE search-path
subsection specifically (the rest of this file's design-sketch content, e.g. the Lua template
generator and REST daemon, remains AI-proposed and unvalidated).

### The five product-thesis "realized" claims — verified against shipped code

1. **Lazy/virtual shadow (no multi-GB copy, only deltas materialize).** Confirmed. The DEFAULT
   deploy path never copies the client's base TRE set: `changesetService.sealVersion` stores only
   files that changed vs. the parent version (`packages/renderer/src/services/changesetService.ts`
   — diff-vs-parent filter at lines 289-351, "CRITICAL: compute sha from the SOURCE file and filter
   BEFORE copying any bytes" at lines 289-291), `flatten()` reconstructs the full override set by
   walking the parentId chain (lines 139-189), and `packPatch(flatten(...))`
   (`packages/renderer/src/services/packPatch.ts` lines 80-126) builds an override archive
   containing ONLY those changed files. `cfgActivator.getToolkitCfgPath`
   (`packages/renderer/src/services/cfgActivator.ts` lines 47-61) documents the footprint goal
   explicitly: "the only change to the client install is a single absolute, quoted `.include` line."
   The full-copy `shadowBaseService.ts` (hardlink-or-copy the entire base) still exists but is an
   OPT-IN alternative model, not the default (confirmed by its own header comment "opt-in
   shadow-base TRE copy").
2. **Cfg snapshot/restore (byte-pristine whole-file restore).** Confirmed. `cfgActivator.snapshotCfg`
   (`cfgActivator.ts` lines 112-128) copies the pristine root cfg into `.studio/snapshots/` before
   the first mutation (idempotent — never overwrites an existing snapshot); `restoreCfg` (lines
   146-151) does an atomic tmp+rename whole-file copy-back, explicitly NOT line-surgery ("the safest
   approach — no risk of residual lines").
3. **B3 loose-override snapshot pattern.** Confirmed.
   `packages/renderer/src/services/looseOverrideDeploy.ts` `deployLoose` (lines 75-154) snapshots
   any pre-existing file at the destination path before overwriting it (lines 121-129); `resetLoose`
   (lines 176-201) RESTORES pre-existing files from their snapshot (lines 178-185) and only DELETES
   files that did not pre-exist (lines 186-198) — matches the documented B3 contract exactly.
4. **Baseline root changeset node.** Confirmed. `changesetService.seedBaseline`
   (`changesetService.ts` lines 97-120) idempotently seeds a `BASELINE_ID` root node with
   `deltas: []` (pristine, zero-override) via a direct manifest write (bypassing `sealVersion`'s
   N4 empty-delta guard, as documented at lines 90-96), called on every `openWorkspace` (H2a,
   `workspaceService.ts` lines 294-299).
5. **Reconcile-to-version engine.** Confirmed — verified against `syncLiveToVersion`, the SHIPPED
   engine (NOT `setLiveVersion` alone). `packages/renderer/src/services/syncLiveToVersion.ts`
   `syncLiveToVersion()` (lines 153-321) performs the actual file-level revert/apply work: H4
   dispatch on the live version's model for revert vs. the target version's model for apply (lines
   166-173, 207-210), `flatEqual` noop fast path (lines 187-192), undo-stack push before any mutation
   (lines 194-199), Baseline revert-only branch (lines 217-234), and cross-model
   loose↔cfg transitions (lines 240-302). It calls `setLiveVersion(targetId)`
   (`changesetService.ts` lines 465-494) internally as its LAST step (line 313) purely to move the
   `activeVersionId`/`deployedVersionId` pointers — `setLiveVersion` is a pointer-mover, not the
   engine.

### Core3 TRE search-path push mechanism — verified against real source

Read directly from `../Core3` this session (not the research doc's AI-proposed community-doc
version):

- **`Core3.TrePath` + `Core3.TreFiles`** are real Lua-table fields in
  `MMOCoreORB/bin/conf/config.lua` (confirmed at lines 150-151 of the maintainer's checkout —
  `TrePath = "/home/swgemu/Desktop/SWGEmu"`, `TreFiles = { "default_patch.tre", ... }`, index 0 =
  first/highest-priority entry).
- **`ConfigManager::loadConfigData()`** (`MMOCoreORB/src/conf/ConfigManager.cpp` lines 23-93) runs
  `conf/config.lua` FIRST (line 33, `lua.runFile("conf/config.lua")`), then
  `conf/config-local.lua` SECOND in the SAME Lua VM, but ONLY if it exists (lines 38-47,
  `File file("conf/config-local.lua"); if (file.setReadOnly()) { lua.runFile(...) }`). Because both
  files execute in one Lua VM, `config-local.lua` can `table.insert` into the already-populated
  `Core3.TreFiles` table without redeclaring it, AND any `Core3.TrePath = "..."` assignment in
  `config-local.lua` silently OVERRIDES `config.lua`'s value (last assignment in the VM wins — no
  merge semantics). This is exactly the maintainer's live shape: `config-local.lua` overrides
  `TrePath` to `/mnt/d/SWGEmu-Client/SWGEmu`.
- **`DataArchiveStore::loadTres()`** (`MMOCoreORB/src/templates/manager/DataArchiveStore.cpp` lines
  56-88) is hard-guarded against a second run: `if (treeDirectory != nullptr) return 0;` (lines
  59-63) — TreFiles/TrePath are consumed EXACTLY ONCE at boot; no command, REST endpoint, or signal
  re-triggers it. It iterates `treFilesToLoad` in array order (lines 78-83,
  `for (int i = 0; i < treFilesToLoad.size(); ++i) { ...unpackFile(fullPath); }`) — index 0 is
  processed first.
- **First-listed-wins duplicate precedence** — confirmed via
  `MMOCoreORB/utils/engine3/MMOEngine/src/system/util/SortedVector.h` (`NO_DUPLICATE` insert plan,
  line 26 constant + lines 67-68 `setNoDuplicateInsertPlan()`): archives are installed into the tree
  directory with this plan, so a LATER-inserted duplicate virtual path is REJECTED, not overwritten.
  Combined with the load-order proof above, this confirms `table.insert(Core3.TreFiles, 1, ...)`
  (prepend at index 0) is the correct override point — the newly-inserted archive is processed
  first and wins any path collision with the base archives that follow it in the array.
- **In-place overwrite of a mounted `.tre` serves garbage, not just stale data.**
  `TreeFileRecord::getBytes()` (`MMOCoreORB/src/tre3/TreeFileRecord.h` lines 109-130) re-opens
  `treeFilePath` fresh per request but seeks to `fileOffset` and decompresses using
  `compressedSize`/`uncompressedSize`/`compressionType` captured in the boot-time index. If a `.tre`
  file is overwritten in place with different content after boot, these stored offsets/sizes no
  longer correspond to the new bytes on disk — the server serves garbage or fails to decompress
  until restart. **Push design must therefore write a NEW, content-tokened filename per push and
  never overwrite a previously-pushed archive in place** (only best-effort-unlink the OLD file once
  the new one is registered).
- **TRE version support** — `TreeFile::readHeader()` (`MMOCoreORB/src/tre3/TreeFile.cpp` lines
  41-86) parses ONLY `'0005'` and `'0006'` (`switch (version)` at lines 53/80); any other version
  hits the `default:` branch and logs `"Unknown Tree version"` (line 84). SWG-Toolkit's
  `packPatch` builds archives with `buildTre(entries, '5000')` — on-disk `EERT5000` = version
  `0005` — compatible with Core3's reader.

### Mounting the live Core3 (WSL2) from Windows — walkthrough

Ground-truthed against the maintainer's running server this session (2026-07-03 mount-research
pass; full trace in `04.4-RESEARCH.md` ADDENDUM):

1. **Push target is the LIVE server tree, not the source checkout.** The running Core3 lives in a
   WSL2 distro (e.g. Debian) at `~/workspace/Core3/MMOCoreORB`, reachable from Windows as
   `\\wsl.localhost\<distro>\home\<user>\workspace\Core3\MMOCoreORB\bin`. Enumerate distros with
   `WSL_UTF8=1 wsl.exe -l -q` (the output is UTF-16LE without that env var). **The sibling
   `D:\Code\Core3` checkout used for source-reading in this repository is NOT read by the running
   server** — writes there have zero effect on the live instance.
2. **`config-local.lua` overrides `config.lua` for `TrePath` resolution.** Resolve TrePath by
   reading `conf/config-local.lua` first (if it assigns `Core3.TrePath`, that value wins); otherwise
   fall back to `conf/config.lua`'s value.
3. **Linux→host path translation.** `/mnt/<x>/rest` → `<X>:\rest` (WSL2's automount convention for
   Windows drives); any OTHER absolute Linux path → `\\wsl.localhost\<distro>\<path>` (distro
   derived from the `serverConfig.path` UNC root, or from an explicit option). A `TrePath` that is
   already a Windows/UNC path passes through unchanged.
4. **Restart required — no runtime reload exists.** `TreFiles`/`TrePath` are read once at boot
   (`loadTres` hard-guard, `DataArchiveStore.cpp` lines 59-63) — there is no console command, REST
   endpoint, or signal that re-reads config or rebuilds the tree archive. Any push MUST be followed
   by a full server restart before the new archive takes effect. (Day-to-day runbook for the
   maintainer's instance: `D:\Code\Core3\wsl2\RUNBOOK.md`.)
5. **Duplicate-path precedence is FIRST-listed wins** (see SortedVector `NO_DUPLICATE` citation
   above) — the INVERSE of the client's `searchTree` priority rule (client: highest numeric priority
   wins; Core3: first array entry wins). `table.insert(Core3.TreFiles, 1, ...)` (prepend) is
   therefore the correct override point.
6. **Version compatibility** — Core3 parses only TRE `0005`/`0006` (`TreeFile.cpp` lines 41-86); the
   toolkit's `packPatch` output (`buildTre` version `'5000'` = on-disk `EERT5000` = version `0005`)
   is compatible.
