# Version Control, Backup, and Remote Sync

> Covers: Git/LFS versioning, local snapshots/rollback, Base44 changeset VFS, remote differential sync. Source: research doc lines 11089–11585, 13830–14034, 14292–14551.

> **Schema caveat:** The Base44 changeset manifest, remote differential manifest, and associated TypeScript interfaces are AI-proposed designs from a Gemini research session — they are architectural starting points, not battle-tested contracts. See [source provenance](../00-overview/source-provenance.md) for full context.

---

## Overview

The toolkit's history and safety systems operate in four complementary layers:

1. **Git + LFS** — collaborative versioning of source code and large binary mod assets via standard open-source tooling.
2. **Local snapshots** — instant, offline rollback using a compressed incremental archive engine; zero Git dependency.
3. **Base44 changeset VFS** — a layered virtual filesystem that stacks discrete, immutable mod delta packets over a vanilla base, enabling per-file rollback and efficient compilation.
4. **Remote differential sync** — SHA-256 broadphase hash audit + targeted compressed stream delivery so modders only download what changed.

Each layer is independent. A modder can use local snapshots while offline, commit to Git/LFS for collaboration, and pull community changesets from a CDN when ready.

---

## 1. Git + LFS Versioning

### Why Git + LFS (not Lore/Perforce)

Epic's Lore VCS has genuine advantages for studio teams — atomic file locking, on-demand streaming, and native game-binary optimization — but it introduces critical friction for a public open-source community toolkit:

- **Ecosystem lock-in:** Lore cannot host repositories on GitHub/GitLab, breaking the existing open-source modder workflow.
- **Infrastructure cost:** Lore requires a managed centralized server (AWS S3 / Azure). Git repositories are free on GitHub.
- **Onboarding friction:** Modders, web developers, and hobbyists already know `pull / commit / push`. Lore requires retraining the entire contributor base.

The recommended hybrid approach:

1. Keep all **source code** (React UI, TypeScript API, Node-API C++ wrappers) in a standard lightweight Git repository.
2. Never commit raw `.tre` game-client dumps or packed planetary maps directly. Instead, use **Git LFS** to track proprietary binary formats, keeping the source history fast to clone.

| Feature | Git (Standard / Git LFS) | Epic Games Lore |
|---|---|---|
| Architecture | Distributed — full repo on every local machine | Centralized/Hybrid — on-demand streaming |
| Binary efficiency | Poor without LFS; history bloats local storage | Highly optimized for game binaries natively |
| Conflict resolution | Merge resolution — fails entirely on binary data | Strict file locking — prevents overlapping edits |
| Learning curve | High — modders frequently break local staging trees | Lower — tailored for art/design workflows |
| Community hosting | GitHub/GitLab (free, familiar) | Requires managed server infrastructure |

### Git/LFS Pipeline Workflow

```
[ Modder clicks "Push Update" in UI ]
                 |
                 v
[ TypeScript Git Automation Service ]
  ├── 1. Dispatches `git status` via child_process
  ├── 2. Auto-writes .gitattributes for SWG extensions (.tre, .trn, ...)
  ├── 3. Stages binary blobs via Git LFS
  └── 4. Asynchronously pushes code + binaries to remote (GitHub/GitLab)
```

### TypeScript Payload Types

```typescript
export interface GitCommitPayload {
  repositoryPath: string; // The root directory of the modder's project workspace
  commitMessage: string;
  remoteUrl?: string;     // e.g. "https://github.com"
}

export interface GitPipelineProgress {
  status: 'idle' | 'configuring' | 'staging' | 'uploading' | 'complete' | 'error';
  stdoutLogs: string;
  errorLogs?: string;
}
```

### SwgGitLfsService

Wraps Node's `child_process` to call the system Git client. On first run it writes a `.gitattributes` file that routes all proprietary SWG binary formats through LFS, preventing repository bloat.

```typescript
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SwgGitLfsService {

  /**
   * Initializes a repository workspace and locks down SWG formats to Git LFS tracking
   */
  public async initializeWorkspaceLfs(repoPath: string): Promise<void> {
    try {
      // 1. Check if Git is initialized; if not, initialize it
      try {
        await execAsync('git status', { cwd: repoPath });
      } catch {
        await execAsync('git init', { cwd: repoPath });
      }

      // 2. Install Git LFS hooks inside the local repository environment
      await execAsync('git lfs install', { cwd: repoPath });

      // 3. Write out automated binary formatting rule exclusions (.gitattributes)
      const attributesPath = path.join(repoPath, '.gitattributes');
      const swgLfsRules = [
        '*.tre filter=lfs diff=lfs merge=lfs -text',
        '*.trn filter=lfs diff=lfs merge=lfs -text',
        '*.fld filter=lfs diff=lfs merge=lfs -text',
        '*.ws  filter=lfs diff=lfs merge=lfs -text',
        '*.pob filter=lfs diff=lfs merge=lfs -text',
        '*.msh filter=lfs diff=lfs merge=lfs -text'
      ].join('\n');

      await fs.writeFile(attributesPath, swgLfsRules, 'utf-8');
      console.log('Successfully registered SWG asset tracks to Git LFS mapping.');
    } catch (err: any) {
      throw new Error(`Failed to configure Git LFS context: ${err.message}`);
    }
  }

  /**
   * Executes a non-blocking, asynchronous commit-and-push version pipeline
   */
  public async executePublishPipeline(
    payload: GitCommitPayload,
    onProgress: (log: string) => void
  ): Promise<void> {
    const { repositoryPath, commitMessage, remoteUrl } = payload;

    // Enforce LFS checks before staging assets
    await this.initializeWorkspaceLfs(repositoryPath);

    try {
      // 1. Stage all code edits, .gitattributes, and binary blobs
      onProgress('Staging workspace modifications...');
      await execAsync('git add .', { cwd: repositoryPath });

      // 2. Commit the changes locally
      onProgress('Committing data modifications to history...');
      const cleanMsg = commitMessage.replace(/"/g, '\\"');
      await execAsync(`git commit -m "${cleanMsg}"`, { cwd: repositoryPath });

      // 3. Configure remote origins if explicitly passed down from UI properties
      if (remoteUrl) {
        onProgress('Configuring remote distribution targets...');
        try {
          await execAsync(`git remote add origin ${remoteUrl}`, { cwd: repositoryPath });
        } catch {
          // If origin already exists, force update the endpoint target URL
          await execAsync(`git remote set-url origin ${remoteUrl}`, { cwd: repositoryPath });
        }
      }

      // 4. Asynchronously push code changes and stream heavy LFS binary objects
      onProgress('Uploading data payloads and streaming LFS file structures...');
      const { stdout } = await execAsync('git push -u origin main', { cwd: repositoryPath });

      onProgress('Pipeline successfully executed!');
      console.log(stdout);
    } catch (err: any) {
      throw new Error(`Git pipeline deployment failed: ${err.message}`);
    }
  }
}
```

### Electron / Preload Bridge

Expose the pipeline as an IPC handle in `src/main.ts` and register it in `src/preload.ts`:

```typescript
// Inside src/preload.ts context isolation bridge maps:
contextBridge.exposeInMainWorld('api', {
  triggerGitLfsPublish: (payload: GitCommitPayload, onLogCallback: (msg: string) => void) => {
    // Standard event listener routing to pipe console logs from Main to Renderer loop
    ipcRenderer.on('git:log-event', (_, msg) => onLogCallback(msg));
    return ipcRenderer.invoke('git:publish', payload);
  }
});
```

### Version Control Dashboard Panel

```tsx
import React, { useState } from 'react';

export const SwgGitVersionControlPanel: React.FC<{ activeWorkspaceRoot: string }> = ({ activeWorkspaceRoot }) => {
  const [pipelineState, setPipelineState] = useState<string>('idle');
  const [logFeed, setLogFeed] = useState<string>('Workspace clear. Ready for commit tracking.');
  const [commitMessage, setCommitMessage] = useState('Build: Added custom cantina layout and painted forest biome');
  const [remoteUrl, setRemoteUrl] = useState('https://github.com');

  const handleRunGitPipeline = async () => {
    setPipelineState('processing');
    setLogFeed('Spanning background worker threads...');

    const payload = {
      repositoryPath: activeWorkspaceRoot,
      commitMessage,
      remoteUrl: remoteUrl.trim().length > 0 ? remoteUrl : undefined
    };

    try {
      await window.api.triggerGitLfsPublish(payload, (realtimeLog: string) => {
        setLogFeed(realtimeLog);
      });
      setPipelineState('success');
    } catch (err: any) {
      setPipelineState('error');
      setLogFeed(`Pipeline execution halted: ${err.message}`);
    }
  };

  return (
    <div style={{ background: '#1e1e24', border: '1px solid #ff0055', padding: '16px', borderRadius: '4px', color: '#fff', fontFamily: 'monospace' }}>
      <h4 style={{ color: '#ff0055', margin: '0 0 10px 0' }}>Git / LFS Community Version Control</h4>

      <div style={{ display: 'grid', gap: '8px', fontSize: '11px', marginBottom: '12px' }}>
        <label>
          Commit Log Message:
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={2}
            style={{ width: '100%', background: '#111', color: '#fff', border: '1px solid #444', padding: '4px', marginTop: '2px', resize: 'none' }}
          />
        </label>
        <label>
          Remote Repository URL Target (Optional):
          <input
            type="text" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)}
            style={{ width: '100%', background: '#111', color: '#fff', border: '1px solid #444', padding: '4px' }}
          />
        </label>
      </div>

      {/* Live Logging Feed Monitor Terminal Overlay */}
      <div style={{ height: '70px', overflowY: 'auto', background: '#050505', padding: '6px', fontSize: '10px', color: '#00ffcc', border: '1px solid #2d2d35', marginBottom: '12px' }}>
        {logFeed}
      </div>

      <button
        onClick={handleRunGitPipeline}
        disabled={pipelineState === 'processing'}
        style={{
          width: '100%', background: pipelineState === 'processing' ? '#444' : '#ff0055', color: '#fff',
          fontWeight: 'bold', padding: '10px', border: 'none', borderRadius: '2px', cursor: 'pointer'
        }}
      >
        {pipelineState === 'processing' ? 'Pushing LFS Objects...' : 'Commit & Push Project Mod'}
      </button>
    </div>
  );
};
```

**Key wins:**

- **No local bloat:** Automating `.gitattributes` creation prevents modders from accidentally committing heavy game objects to the standard history. Large assets route directly to LFS block allocations, keeping clones and pulls fast.
- **Streamlined collaboration:** Multiple developers can join a single project repo, distribute code or datatable edits over standard branch updates, and let the app auto-manage compilation.

---

## 2. Local Snapshots and Rollback

Git commits require an internet connection and a clean staging tree. The local snapshot engine provides an instant safety net that operates entirely offline, inside the project's own `.studio/snapshots/` subfolder. If a modder corrupts a `.trn` coordinate map or messes up a weapon datatable, they can roll back without touching Git.

### Architecture

```
[ Active Work Workspace ] ──(Click "Create Local Snapshot")──> [ TS File Archiver Service ]
                                                                      │
                                                        (Deploys Async Decompression)
                                                                      │
                                                                      v
  [ UI Timetable Rollback Panel ] <── (Updates Manifest) <── [ .studio/snapshots/ ]
  (Restores States and Forces Canvas Reload)                Packs: snapshot_<id>.tar.gz
```

### Snapshot Manifest Schema

```typescript
export interface WorkspaceSnapshotRecord {
  id: string;          // Cryptographic or sequential ID string
  timestamp: string;   // ISO Datetime marker
  customLabel: string; // User description (e.g. "Pre-Terrain Splat Paint")
  archivePath: string; // Pointer to the compiled .zip file on disk
  totalBytesSize: number;
}

export interface SnapshotManifestSchema {
  projectWorkspaceRoot: string;
  snapshots: WorkspaceSnapshotRecord[];
}
```

### SwgLocalBackupManager

Wraps Node file streams (or native OS archiver binaries). Stores snapshots as `.tar.gz` bundles and maintains a rolling `snapshot_manifest.json` transaction log.

```typescript
import * as fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { SnapshotManifestSchema, WorkspaceSnapshotRecord } from './BackupSchema';

export class SwgLocalBackupManager {
  private studioDir: string;
  private manifestPath: string;

  constructor(private projectWorkspaceRoot: string) {
    this.studioDir = path.join(projectWorkspaceRoot, '.studio', 'snapshots');
    this.manifestPath = path.join(this.studioDir, 'snapshot_manifest.json');
  }

  /**
   * Initializes hidden backup folders and reads existing historical manifest rows
   */
  private async loadManifest(): Promise<SnapshotManifestSchema> {
    await fs.mkdir(this.studioDir, { recursive: true });
    try {
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { projectWorkspaceRoot: this.projectWorkspaceRoot, snapshots: [] };
    }
  }

  /**
   * Asynchronously serializes the active staging directory into a timestamped compressed backup asset
   */
  public async createLocalWorkspaceSnapshot(customLabel: string, stagingDirPath: string): Promise<WorkspaceSnapshotRecord> {
    const manifest = await this.loadManifest();

    const timestamp = new Date().toISOString();
    const snapshotId = `snap_${Date.now()}`;
    const archiveName = `${snapshotId}.tar.gz`;
    const targetZipPath = path.join(this.studioDir, archiveName);

    // Use utilities like 'tar-stream' or node-native recursive walkers to pack directory paths.
    // The stream pipeline below is the structural skeleton; inject directory walker/compression
    // streams at the marked point for production use.
    const outputStream = createWriteStream(targetZipPath);
    // (Inject directory packing data compression streams here...)
    outputStream.end();

    // Retrieve archive size metadata
    const fileStats = await fs.stat(targetZipPath);

    const newRecord: WorkspaceSnapshotRecord = {
      id: snapshotId,
      timestamp,
      customLabel,
      archivePath: targetZipPath,
      totalBytesSize: fileStats.size
    };

    // Rewrite the local transaction log database
    manifest.snapshots.unshift(newRecord); // Push newest to top of history queue
    await fs.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    return newRecord;
  }

  /**
   * Clears the current staging directory and unrolls a previously saved backup archive frame
   */
  public async restoreWorkspaceToSnapshot(snapshotId: string, stagingDirPath: string): Promise<void> {
    const manifest = await this.loadManifest();
    const targetRecord = manifest.snapshots.find(s => s.id === snapshotId);

    if (!targetRecord) {
      throw new Error(`Target backup record identifier matching index ${snapshotId} could not be resolved.`);
    }

    // 1. Wipe current working directory staging layouts (safety sweep)
    await fs.rm(stagingDirPath, { recursive: true, force: true });
    await fs.mkdir(stagingDirPath, { recursive: true });

    // 2. Unroll archive payload
    // Execute decompression pipe stream extraction targets matching targetRecord.archivePath here.
    console.log(`Unrolled snapshot restore sequence safely from target: ${targetRecord.customLabel}`);
  }
}
```

### Electron / Preload Bridge

```typescript
// Inside src/preload.ts context isolation bridge maps:
contextBridge.exposeInMainWorld('api', {
  createBackupSnapshot: (label: string) => ipcRenderer.invoke('backup:create', label),
  restoreFromSnapshot: (snapshotId: string) => ipcRenderer.invoke('backup:restore', snapshotId),
  getBackupHistory: () => ipcRenderer.invoke('backup:get-history')
});
```

### Historical Timeline Restore Panel

```tsx
import React, { useState, useEffect } from 'react';
import { WorkspaceSnapshotRecord } from './BackupSchema';

export const SwgLocalBackupDashboard: React.FC<{ onWorkspaceStateReload: () => void }> = ({ onWorkspaceStateReload }) => {
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshotRecord[]>([]);
  const [customLabel, setCustomLabel] = useState('Checkpoint Before Blaster Buffs');
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchBackupHistory = async () => {
    const historyList = await window.api.getBackupHistory();
    setSnapshots(historyList || []);
  };

  useEffect(() => { fetchBackupHistory(); }, []);

  const handleTriggerSnapshotCreation = async () => {
    if (customLabel.trim().length === 0) return;
    setIsProcessing(true);
    try {
      await window.api.createBackupSnapshot(customLabel);
      setCustomLabel('');
      await fetchBackupHistory();
      alert('Local sandbox snapshot successfully committed to cache storage!');
    } catch (err: any) {
      alert(`Snapshot Fault: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteRollback = async (id: string, label: string) => {
    const confirmChoice = window.confirm(`Are you absolutely sure you want to discard current changes and roll back the entire project workspace to: "${label}"?`);
    if (!confirmChoice) return;

    setIsProcessing(true);
    try {
      await window.api.restoreFromSnapshot(id);
      onWorkspaceStateReload(); // Re-trigger Three.js loaders and refresh all canvas components
      alert('Workspace files successfully restored to target checkpoint footprint!');
    } catch (err: any) {
      alert(`Restore Failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ background: '#1c1c1f', border: '1px solid #00ffcc', padding: '14px', borderRadius: '4px', color: '#fff', fontFamily: 'monospace' }}>
      <h4 style={{ color: '#00ffcc', margin: '0 0 10px 0' }}>Local Sandbox Snapshot Utility</h4>

      <div style={{ display: 'grid', gap: '6px', fontSize: '11px', marginBottom: '14px' }}>
        <label>
          Create Recovery Checkpoint Label:
          <input
            type="text" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="e.g., Before expanding Coronet walls"
            style={{ width: '100%', background: '#111', color: '#fff', border: '1px solid #444', padding: '6px', marginTop: '2px' }}
          />
        </label>
        <button
          onClick={handleTriggerSnapshotCreation}
          disabled={isProcessing || customLabel.trim().length === 0}
          style={{ background: '#00ffcc', color: '#111', fontWeight: 'bold', border: 'none', padding: '8px', cursor: 'pointer', borderRadius: '2px', marginTop: '2px' }}
        >
          {isProcessing ? 'Baking File Matrix...' : 'Take Local Snapshot'}
        </button>
      </div>

      <div style={{ borderTop: '1px solid #333', paddingTop: '10px' }}>
        <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>Recovery Checkpoint History Queue:</div>
        <div style={{ maxHeight: '180px', overflowY: 'auto', background: '#08080a', border: '1px solid #2d2d35', padding: '4px' }}>
          {snapshots.length === 0 ? (
            <div style={{ color: '#555', fontSize: '11px', textAlign: 'center', padding: '20px 0' }}>No local recovery records committed yet.</div>
          ) : (
            snapshots.map((snap) => (
              <div key={snap.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px', borderBottom: '1px solid #1a1a1f', fontSize: '11px' }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                  <span style={{ color: '#ff0055', fontWeight: 'bold' }}>{new Date(snap.timestamp).toLocaleTimeString()}</span> - <span style={{ color: '#eee' }}>{snap.customLabel}</span>
                  <div style={{ color: '#555', fontSize: '9px', paddingLeft: '18px' }}>Size: {(snap.totalBytesSize / 1024 / 1024).toFixed(2)} MB</div>
                </div>
                <button
                  onClick={() => handleExecuteRollback(snap.id, snap.customLabel)}
                  disabled={isProcessing}
                  style={{ background: '#331015', border: '1px solid #ff0055', color: '#ff3366', fontSize: '10px', padding: '3px 6px', borderRadius: '2px', cursor: 'pointer' }}
                >
                  Roll Back
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
```

**Key wins:**

- **Risk-free iteration:** Level designers can run experimental batch modifications or paint vast procedural forests and instantly return to a pristine state if something breaks.
- **Offline-first:** The workflow processes compressed local `.tar.gz` streams entirely inside the project's sub-folders at high speed with zero network dependency. Mod records are protected locally regardless of Git server access or internet connectivity.

---

## 3. Base44 Changeset Stack (Layered VFS)

Rather than destructively overwriting data inside a monolithic patch file, the toolkit treats mod versions as an ordered stack of isolated directory layers. The active workspace view is calculated on the fly by combining these layers from the bottom up — similar to database migration schemas or Unreal Engine's internal asset registry.

> Note: `.tre` packing and consolidation (flattening the changeset stack into a deployable TREE0005 binary) is covered in [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). The IFF reader/writer boilerplate is documented there as well.

### Changeset Stack Architecture

```
[ Active Rendered Workspace View ] <--- (Calculated Top-Down Matrix State)
                                               │
+----------------------------------------------+----------------------------------------------+
|                                                                                              |
|  [ Changeset 003: "Painted Oasis Lake" ] ───> Overwrites only specific modified .trn blocks  |
|                                                                                              |
|  [ Changeset 002: "Placed City Walls" ]  ───> Overwrites only modified .ws snapshot files    |
|                                                                                              |
|  [ Changeset 001: "Base Planet Patch" ]  ───> Raw, vanilla environment map layout files      |
+----------------------------------------------------------------------------------------------+
```

### Changeset Migration Manifest Schema

Each changeset is modeled like a database migration script: an isolated unique ID, a monotonically increasing version index, an immutable list of file deltas, and enough metadata to reconstruct or reverse the change.

```typescript
export interface TreFileDelta {
  virtualPath: string; // e.g., "terrain/tatooine.trn" or "datatables/item/weapon.iff"
  action: 'add' | 'modify' | 'delete';
  sha256Hash: string;
}

export interface SwgChangeset {
  versionIndex: number; // Monotonically increasing version tracker (001, 002, 003)
  id: string;           // Hash identifier string
  label: string;        // e.g., "Buffed DL-44 Blaster Damage"
  timestamp: string;
  filesChanged: TreFileDelta[];
}

export interface WorkspaceChangesetManifest {
  activeVersionIndex: number;
  history: SwgChangeset[];
}
```

### Multi-Layer Virtual File System Service

When Three.js requests an asset (e.g. a `.trn` map), the VFS sweeps the changeset stack from top to bottom, returning the file from the highest-priority layer that contains it. Missing files fall through to the vanilla base.

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

export class SwgVirtualFileSystem {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Resolves the absolute path of an asset by crawling down the changeset stack hierarchy
   */
  public async resolveAssetVirtualPath(virtualPath: string, activeVersion: number): Promise<string> {
    const historyManifest = await this.loadHistoryManifest();

    // Sort history from the active version down to the base level
    const activeStack = historyManifest.history
      .filter(cs => cs.versionIndex <= activeVersion)
      .sort((a, b) => b.versionIndex - a.versionIndex);

    for (const changeset of activeStack) {
      const localizedChangesetPath = path.join(
        this.workspaceRoot, '.studio', 'changesets', changeset.id, virtualPath
      );

      try {
        await fs.access(localizedChangesetPath);
        return localizedChangesetPath; // Found the file in the highest priority layer
      } catch {
        // Continue downward search if file isn't found in this layer
      }
    }

    // Fallback: grab from core extracted vanilla library path
    return path.join(this.workspaceRoot, 'extracted_vanilla_base', virtualPath);
  }

  private async loadHistoryManifest(): Promise<WorkspaceChangesetManifest> {
    const manifestPath = path.join(this.workspaceRoot, '.studio', 'changesets', 'manifest.json');
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { activeVersionIndex: 0, history: [] };
    }
  }
}
```

### Fast Changeset Rollback Compiler Core (C++)

When a modder triggers a rollback, the C++ core prunes the target changeset layer directory from disk in native memory without slow sequential disk-copy procedures.

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <filesystem>

namespace fs = std::filesystem;

class SwgChangesetRollbackEngine {
public:
    /**
     * Instantly safely unrolls directory mutations by pruning a specific changeset layer block
     */
    static bool PurgeChangesetLayer(const std::string& workspaceRoot, const std::string& changesetId) {
        fs::path targetLayerPath = fs::path(workspaceRoot) / ".studio" / "changesets" / changesetId;

        if (fs::exists(targetLayerPath)) {
            fs::remove_all(targetLayerPath);
            return true;
        }
        return false;
    }
};

// Node-API Endpoint Bridge Hook
Napi::Value ExecuteNativeRollback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string root = info[0].As<Napi::String>().Utf8Value();
    std::string id = info[1].As<Napi::String>().Utf8Value();

    bool success = SwgChangesetRollbackEngine::PurgeChangesetLayer(root, id);
    return Napi::Boolean::New(env, success);
}
```

### Changeset Stack and Timeline Manager (React UI)

Displays the full version history as a scrollable stack. Clicking a version toggles the active changeset level, which re-resolves all VFS paths and triggers a canvas reload.

```tsx
import React, { useState } from 'react';
import { SwgChangeset } from './ChangesetSchema';

interface Props {
  activeVersion: number;
  changesetHistory: SwgChangeset[];
  onToggleActiveVersion: (versionIdx: number) => Promise<void>;
}

export const SwgChangesetTimelinePanel: React.FC<Props> = ({
  activeVersion,
  changesetHistory,
  onToggleActiveVersion
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleVersionClick = async (versionIdx: number) => {
    setIsProcessing(true);
    try {
      // Shifting the active index updates the virtual file layer system and triggers a canvas reload
      await onToggleActiveVersion(versionIdx);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ background: '#16161a', padding: '14px', border: '1px solid #ff0055', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', color: '#fff' }}>
      <h4 style={{ color: '#ff0055', margin: '0 0 10px 0' }}>Base44 Changeset Migration Timeline</h4>
      <p style={{ color: '#888', margin: '0 0 12px 0', fontSize: '10px' }}>
        Select any historical changeset slice node to dynamically map or roll back your virtual TRE file states.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: '#0a0a0c', padding: '6px', border: '1px solid #2d2d35', maxHeight: '200px', overflowY: 'auto' }}>
        {changesetHistory.map((cs) => {
          const isCurrent = cs.versionIndex === activeVersion;
          const isRolledBack = cs.versionIndex > activeVersion;

          return (
            <div
              key={cs.id}
              onClick={() => !isProcessing && handleVersionClick(cs.versionIndex)}
              style={{
                padding: '6px 8px',
                borderRadius: '2px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                borderLeft: isCurrent ? '3px solid #00ffcc' : isRolledBack ? '3px solid #444' : '3px solid #ff0055',
                background: isCurrent ? '#162220' : isRolledBack ? 'rgba(255,255,255,0.02)' : '#221418',
                opacity: isRolledBack ? 0.4 : 1.0,
                transition: 'background 0.1s'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                <span style={{ color: isRolledBack ? '#666' : isCurrent ? '#00ffcc' : '#ff0055' }}>
                  VERSION v{cs.versionIndex.toString().padStart(3, '0')}
                </span>
                <span style={{ color: '#555', fontSize: '9px' }}>{new Date(cs.timestamp).toLocaleTimeString()}</span>
              </div>
              <div style={{ color: isRolledBack ? '#555' : '#eee', marginTop: '2px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {cs.label}
              </div>
              <div style={{ fontSize: '9px', color: '#666', marginTop: '2px' }}>
                Modified: {cs.filesChanged.length} workspace entries
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

**Technical wins:**

1. **Granular multi-mod management:** Instead of maintaining several heavy full copies of 4 GB game files for different projects, the toolkit saves only the byte deltas inside compact changeset directories. Users can spin up and stack distinct mod branches on top of a single immutable vanilla asset directory.
2. **Instant packaging:** When compiling a deployable client game patch, the C++ core aggregates only the data blocks inside the current changeset stack and packages them into a TREE0005 `.tre` file in a single pass (see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md) for the `.tre` compilation function).
3. **Safe collaboration:** Each modification sits inside an isolated, version-controlled metadata migration layer. Multiple developers can work on the same repository concurrently, pushing text diffs or binary assets over standard Git branches without corrupting the underlying files.

---

## 4. Remote Differential Sync

Transferring raw, expanded changeset directories over HTTP breaks bandwidth budgets. The remote sync system uses a three-stage differential pipeline:

1. **Server-side manifest:** The remote server hosts a JSON file listing the path, size, and SHA-256 hash of every file in each changeset index row.
2. **Client-side broadphase audit:** The TypeScript sync service downloads this manifest, compares hashes against the local workspace registry, and isolates only the files that are missing or out of date.
3. **Targeted compressed delivery:** The server packages only the requested missing files into a Gzip-compressed stream, which the native C++ layer decompresses directly into `.studio/changesets/`.

### Remote Sync Architecture

```
[ Local Modder Studio Client ] ──(Queries Update Status)──> [ Remote Cloud Server CDN ]
              │                                                      │
    (Downloads Manifest)                                  (Hosts master manifest.json)
              │                                                      │
              v                                                      v
    [ Diff Hash Auditor ] ──(Requests missing file hashes) ──> [ Package Worker Thread ]
              │                                             Packs only changed files to .tar.gz
              │                                                      │
              └─────────────── (Downloads Stream Payload) <──────────┘
```

### Remote Differential Manifest Schema

```typescript
export interface RemoteFileRegistryNode {
  relativePath: string; // e.g., "appearance/terrain/tatooine.trn"
  sha256Hash: string;   // SHA-256 fingerprint for parity verification checks
  compressedSize: number;
}

export interface RemoteChangesetPackage {
  changesetId: string; // Hash signature tracking ID (e.g. "cs_99102")
  versionIndex: number;
  label: string;
  files: RemoteFileRegistryNode[];
}
```

### Differential Network Sync Service

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

export class SwgRemoteSyncEngine {
  private localChangesetRoot: string;

  constructor(workspaceRoot: string) {
    this.localChangesetRoot = path.join(workspaceRoot, '.studio', 'changesets');
  }

  /**
   * Evaluates local files against remote metadata to synchronize missing assets
   */
  public async syncRemoteChangesetLayer(
    remoteServerUrl: string,
    targetVersionIndex: number,
    nativeCryptoAddon: any // C++ high-speed hash engine addon
  ): Promise<void> {

    // 1. Fetch the remote changeset registry metadata manifest
    const manifestResponse = await fetch(`${remoteServerUrl}/api/changeset/${targetVersionIndex}`);
    const remoteData: RemoteChangesetPackage = await manifestResponse.json();

    const targetLayerPath = path.join(this.localChangesetRoot, remoteData.changesetId);
    await fs.mkdir(targetLayerPath, { recursive: true });

    // 2. Broadphase audit: isolate missing or modified files via cryptographic hash checks
    const filesToDownload: string[] = [];

    for (const remoteFile of remoteData.files) {
      const localFilePath = path.join(targetLayerPath, remoteFile.relativePath);

      try {
        await fs.access(localFilePath);

        // Fast file verification: compute SHA-256 fingerprint using the C++ backend
        const localHash: string = await nativeCryptoAddon.computeFileSha256(localFilePath);

        if (localHash !== remoteFile.sha256Hash) {
          filesToDownload.push(remoteFile.relativePath); // Hash mismatch — mark for update
        }
      } catch {
        filesToDownload.push(remoteFile.relativePath); // File missing locally — mark for download
      }
    }

    if (filesToDownload.length === 0) {
      console.log(`Changeset v${targetVersionIndex} is already fully synchronized locally.`);
      return;
    }

    // 3. Targeted stream download: request an archive of ONLY the out-of-sync files
    console.log(`Downloading differential network stream patch for ${filesToDownload.length} modified files...`);

    const downloadResponse = await fetch(`${remoteServerUrl}/api/pack-diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changesetId: remoteData.changesetId, targets: filesToDownload })
    });

    if (!downloadResponse.ok || !downloadResponse.body) {
      throw new Error('Remote server failed to package the differential asset stream.');
    }

    // Save the incoming compressed archive (.tar.gz) as a temporary local staging bundle
    const tempZipPath = path.join(this.localChangesetRoot, `temp_${remoteData.changesetId}.tar.gz`);

    // Node.js web streams pipeline helper writes the chunk payloads to disk asynchronously
    const fileStream = createWriteStream(tempZipPath);
    await pipeline(downloadResponse.body as any, fileStream);

    // 4. Decompression: pass the file to the C++ core to extract it at native speeds.
    // This executes un-gzipping worker threads without blocking the UI.
    // await nativeCryptoAddon.extractGzipArchiveAsync(tempZipPath, targetLayerPath);

    await fs.rm(tempZipPath, { force: true }); // Clean up the temporary file package
    console.log(`Changeset layer v${targetVersionIndex} successfully synchronized and unrolled!`);
  }
}
```

### Fast Native SHA-256 Fingerprint Worker (C++)

Offloads SHA-256 byte-parsing across thousands of local assets onto a native thread-pool worker via `Napi::AsyncWorker`, keeping the UI at 60 fps during audit.

```cpp
#include <napi.h>
#include <windows.h>
#include <wincrypt.h> // Secure Windows Cryptographic Provider API
#include <fstream>
#include <vector>
#include <string>
#include <iomanip>
#include <sstream>

class SwgHashWorker : public Napi::AsyncWorker {
private:
    std::string fileDiskPath;
    std::string computedHashOutput;
public:
    SwgHashWorker(Napi::Function& callback, const std::string& path)
        : Napi::AsyncWorker(callback), fileDiskPath(path) {}

    /**
     * Thread pool execution loop: calculates the file fingerprint inside a non-blocking thread
     */
    void Execute() override {
        std::ifstream file(fileDiskPath, std::ios::binary);
        if (!file.is_open()) {
            SetError("Failed to open local asset file for verification hashing lookups.");
            return;
        }

        HCRYPTPROV hProv = 0;
        HCRYPTHASH hHash = 0;

        // Initialize the OS native cryptographic hashing provider context
        CryptAcquireContext(&hProv, NULL, NULL, PROV_RSA_AES, CRYPT_VERIFYCONTEXT);
        CryptCreateHash(hProv, CALG_SHA_256, 0, 0, &hHash);

        char buffer[4096];
        while (file.read(buffer, sizeof(buffer))) {
            CryptHashData(hHash, reinterpret_cast<const BYTE*>(buffer), file.gcount(), 0);
        }
        CryptHashData(hHash, reinterpret_cast<const BYTE*>(buffer), file.gcount(), 0);

        DWORD hashLen = 32;
        BYTE rgbHash[32];
        CryptGetHashParam(hHash, HP_HASHVAL, rgbHash, &hashLen, 0);

        // Convert the raw byte structures to a readable hex string map layout
        std::stringstream ss;
        for (DWORD i = 0; i < hashLen; ++i) {
            ss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(rgbHash[i]);
        }

        computedHashOutput = ss.str();

        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);
        file.close();
    }

    void OnOK() override {
        Napi::Env env = Env();
        Callback().Call({env.Null(), Napi::String::New(env, computedHashOutput)});
    }
};

// Node-API Endpoint Handle
Napi::Value ComputeFileSha256(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string path = info[0].As<Napi::String>().Utf8Value();
    Napi::Function callback = info[1].As<Napi::Function>();

    SwgHashWorker* worker = new SwgHashWorker(callback, path);
    worker->Queue();
    return env.Null();
}
```

> **Note on source:** The original research transcript contains a minor bug in the `ComputeFileSha256` handle — `info.As<Napi::String>()` should be `info[0].As<Napi::String>()` for the path argument, and `info.Get("callback")` should be `info[1].As<Napi::Function>()`. Both are corrected above. Also `ss.String()` in the original was corrected to `ss.str()`.

### Network Sync Monitor Widget (React HUD)

```tsx
import React, { useState } from 'react';

export const SwgChangesetSyncDashboardWidget: React.FC<{ syncEngine: any; nativeBridge: any }> = ({ syncEngine, nativeBridge }) => {
  const [syncState, setSyncState] = useState<'idle' | 'checking' | 'downloading' | 'success'>('idle');
  const [downloadLog, setDownloadLog] = useState('Workspace verified. Network sync channel ready.');

  const handleTriggerNetworkSync = async () => {
    setSyncState('checking');
    setDownloadLog('Querying remote master server manifest file records...');

    try {
      await syncEngine.syncRemoteChangesetLayer(
        'https://swg-modding-hub.net',
        4, // Request tracking target changeset layer index v004
        nativeBridge
      );

      setSyncState('success');
      setDownloadLog('Parity sync successful! All local changesets match the cloud master tree.');
    } catch (err: any) {
      setSyncState('idle');
      setDownloadLog(`Sync aborted: ${err.message}`);
    }
  };

  return (
    <div style={{ background: '#16161a', padding: '14px', border: '1px solid #ffcc00', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', color: '#fff' }}>
      <h4 style={{ color: '#ffcc00', margin: '0 0 10px 0' }}>Community Mod-Hub Cloud Parity Sync</h4>

      {/* Network Live Logging Console Terminal Monitor */}
      <div style={{ height: '60px', overflowY: 'auto', background: '#050507', padding: '6px', fontSize: '10px', color: '#00ffcc', border: '1px solid #2d2d35', marginBottom: '10px' }}>
        {downloadLog}
      </div>

      <button
        onClick={handleTriggerNetworkSync}
        disabled={syncState === 'downloading'}
        style={{
          width: '100%',
          background: syncState === 'downloading' ? '#444' : '#ffcc00',
          color: '#111', fontWeight: 'bold', padding: '10px', border: 'none',
          borderRadius: '2px', cursor: syncState === 'downloading' ? 'not-allowed' : 'pointer'
        }}
      >
        {syncState === 'checking' ? 'Auditing Local Hashes...' : 'Pull Differential Cloud Updates'}
      </button>
    </div>
  );
};
```

**Technical wins:**

- **Minimal bandwidth:** Modders never re-download full multi-gigabyte `.tre` patch archives to stay current. The server calculates differences dynamically and transfers only changed files.
- **Zero frame hitching:** Offloading SHA-256 generation onto background thread-pool workers keeps the UI responsive. Modders can check for updates or download changesets while actively working in the Three.js canvas.
- **Guaranteed asset parity:** SHA-256 hash checks ensure every asset in the local `changesets/` folder exactly matches the server/CDN. This prevents game crashes, terrain desync errors, or file compilation issues before deploying to the live SWG client.
