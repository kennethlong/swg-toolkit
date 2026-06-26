# Phase 04: Edit & Deploy Loop — Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 26 (new/modified)
**Analogs found:** 22 / 26

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/renderer/src/services/workspaceService.ts` | service | file-I/O | `packages/renderer/src/hooks/useLiveService.ts` | role-match |
| `packages/renderer/src/services/changesetService.ts` | service | file-I/O | `packages/renderer/src/hooks/useLiveService.ts` | role-match |
| `packages/renderer/src/services/cfgActivator.ts` | service | file-I/O | `packages/renderer/src/hooks/useLiveService.ts` | role-match |
| `packages/renderer/src/services/clientLocator.ts` | service | request-response | `packages/renderer/src/hooks/useLiveService.ts` (path probe pattern) | partial |
| `packages/renderer/src/services/gitLfsService.ts` | service | event-driven | `packages/renderer/src/hooks/useLiveService.ts` | partial |
| `packages/renderer/src/services/packPatch.ts` | service | transform | `packages/renderer/src/hooks/useLiveService.ts` + `packages/native-core/index.d.ts` | role-match |
| `packages/renderer/src/state/stagingStore.ts` | store | CRUD | `packages/renderer/src/state/liveStore.ts` | exact |
| `packages/renderer/src/panels/deploy/StagingPanel.tsx` | component | CRUD | `packages/renderer/src/panels/tre/VfsTree.tsx` | exact |
| `packages/renderer/src/panels/deploy/ChangesetTimelinePanel.tsx` | component | CRUD | `packages/renderer/src/panels/tre/VfsTree.tsx` | exact |
| `packages/renderer/src/panels/deploy/DeployDialog.tsx` | component | request-response | `packages/renderer/src/panels/viewport/ExportDialog.tsx` | exact |
| `packages/renderer/src/panels/deploy/VcsPanel.tsx` | component | event-driven | `packages/renderer/src/panels/LiveInspectorPanel.tsx` + `ExportDialog.tsx` | role-match |
| `packages/renderer/src/panels/deploy/WorkspaceEntry.tsx` | component | request-response | `packages/renderer/src/panels/tre/VfsTree.tsx` (empty state) | partial |
| `packages/renderer/src/panels/deploy/ActionBadge.tsx` | utility | transform | `packages/renderer/src/shared/VerificationStatus.tsx` | role-match |
| `packages/renderer/src/shell/StatusBar.tsx` (extend) | component | event-driven | self (add store selectors) | exact |
| `packages/renderer/src/workspace/WorkspaceShell.tsx` (extend) | config | request-response | self (add panelComponents entries) | exact |
| `packages/contracts/src/workspace.ts` | model | CRUD | `packages/contracts/src/live-inject.ts` | exact |
| `packages/contracts/src/staging.ts` | model | CRUD | `packages/contracts/src/tre.ts` | exact |
| `packages/contracts/src/changeset.ts` | model | CRUD | `packages/contracts/src/tre.ts` | exact |
| `packages/contracts/src/deploy.ts` | model | CRUD | `packages/contracts/src/live-inject.ts` | exact |
| `packages/contracts/src/index.ts` (extend) | config | — | self | exact |
| `packages/native-core/test/packPatch.test.ts` | test | transform | `packages/harness/test/tre-builder-roundtrip.test.ts` | exact |
| `packages/native-core/test/patch-shadow.test.ts` | test | CRUD | `packages/harness/test/tre-override.test.ts` | exact |
| `packages/renderer/test/cfgScan.test.ts` | test | file-I/O | `packages/harness/test/contract-conformance.test.ts` (describe/it/fixture) | role-match |
| `packages/renderer/test/cfgActivator.test.ts` | test | file-I/O | `packages/harness/test/contract-conformance.test.ts` | role-match |
| `packages/renderer/test/changeset.test.ts` | test | CRUD | `packages/harness/test/tre-override.test.ts` (state + roundtrip) | role-match |
| `packages/renderer/test/gitLfs.test.ts` | test | event-driven | none — new child_process + temp-git-repo pattern | no analog |

---

## Pattern Assignments

### `packages/renderer/src/services/workspaceService.ts` (service, file-I/O)

**Analog:** `packages/renderer/src/hooks/useLiveService.ts`

**Imports pattern** (useLiveService.ts lines 21-24):
```typescript
import path from 'path';
import fs from 'fs';
import os from 'os';
import { useLiveStore } from '../state/liveStore';
```
For workspaceService, replace `liveStore` with workspace/staging/changeset stores. Add `child_process` for `git init`.

**Service function shape** (useLiveService.ts lines 56-59, 106-122):
```typescript
// Plain async/sync functions — NOT a React hook.
// Path B renderer: fs, path, os, child_process usable directly (nodeIntegration:true).
export function getAgentDllPath(): string { ... }
export function prepareAgentDllForInject(): string {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(canonical, dest);
    return dest;
  } catch {
    return canonical;  // fallback on error — never throw
  }
}
```

**Filesystem write pattern** (useLiveService.ts lines 107-122):
```typescript
// Atomic: mkdirSync + copyFileSync + unlinkSync inside try/catch blocks
// workspaceService will use writeFileSync (BOM-free) + renameSync (atomic) for .cfg
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) {
  try { fs.unlinkSync(path.join(dir, f)); } catch { /* still mapped — leave it */ }
}
```

**Error handling pattern** (useLiveService.ts lines 157-163):
```typescript
try {
  const result = await addon.launchAndInject(clientExe, agentDll, mappingName);
  useLiveStore.getState().attachComplete(result.pid, mappingName);
} catch (err) {
  const reason = String((err as Error)?.message ?? err);
  useLiveStore.getState().attachError(reason);
}
```
For workspaceService, route errors to workspaceStore actions analogous to `attachError`.

---

### `packages/renderer/src/services/changesetService.ts` (service, file-I/O)

**Analog:** `packages/renderer/src/hooks/useLiveService.ts`

**Core pattern — JSON manifest read/write:**
```typescript
// JSON manifests are small text files — use readFileSync/writeFileSync directly.
// Path B renderer: fs available without IPC.
// Mirror the useLiveService fs.copyFileSync pattern but for JSON.
import fs from 'fs';
import path from 'path';

export function readManifest(studioDir: string): WorkspaceChangesetManifest {
  const p = path.join(studioDir, 'changesets', 'manifest.json');
  if (!fs.existsSync(p)) return { activeVersionIndex: -1, changesets: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8')) as WorkspaceChangesetManifest;
}

export function writeManifest(studioDir: string, manifest: WorkspaceChangesetManifest): void {
  const p   = path.join(studioDir, 'changesets', 'manifest.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmp, p);  // atomic — mirrors cfgActivator.ts pattern
}

// Rollback = JSON pointer write only (D-04-08): no native delete, no fs::remove_all
export function setActiveVersion(studioDir: string, index: number): void {
  const manifest = readManifest(studioDir);
  manifest.activeVersionIndex = index;
  writeManifest(studioDir, manifest);
}
```

**Store integration pattern** (useLiveService.ts line 45-48):
```typescript
// getState() for imperative calls outside React render cycle
function closeActiveChannel(): void {
  const status = useLiveStore.getState().status;
  if (status.kind === 'attached') { ... }
}
```

---

### `packages/renderer/src/services/cfgActivator.ts` (service, file-I/O)

**Analog:** `packages/renderer/src/hooks/useLiveService.ts` (fs write pattern)

**Atomic BOM-free write with backup** (from RESEARCH.md code example + useLiveService.ts fs pattern):
```typescript
import fs from 'fs';
import path from 'path';

export function activatePatch(cfgPath: string, patchName: string, scan: SharedFileScan): CfgInsertionRecord {
  // 1. Backup before ANY edit
  const backupPath = cfgPath + '.swgtoolkit.bak';
  fs.copyFileSync(cfgPath, backupPath);  // mirrors useLiveService.ts line 114 pattern

  // 2. Preserve existing EOL — never mix
  const existing = fs.readFileSync(cfgPath, 'utf8');  // utf8 → no BOM on read
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';

  // 3. Compose new content (no BOM — fs.writeFileSync with 'utf8' emits no BOM)
  const slot = chooseSlot(scan);
  const key  = `searchTree${scan.skuSuffix}${slot}`;
  const line = `[SharedFile]${eol}\t${key}=${patchName}${eol}`;
  const next = existing.trimEnd() + eol + line;

  // 4. Atomic: write temp + rename (same volume = atomic on Windows)
  const tmp = cfgPath + '.tmp';
  fs.writeFileSync(tmp, next, { encoding: 'utf8' });  // 'utf8' = NO BOM
  fs.renameSync(tmp, cfgPath);

  // 5. Return record for clean rollback (D-04-12)
  return { cfgPath, key, slot, backupPath, patchName };
}

export function deactivatePatch(record: CfgInsertionRecord): void {
  // Rollback: restore backup (simplest correct approach)
  fs.copyFileSync(record.backupPath, record.cfgPath);
}
```

---

### `packages/renderer/src/services/clientLocator.ts` (service, request-response)

**No close analog** — registry probe + known-path probe is new work. Closest pattern: `useLiveService.ts` lines 68-87 (path resolution with try/catch fallback).

**Fallback probe pattern** (useLiveService.ts lines 68-87):
```typescript
export function getAgentDllPath(): string {
  let isPackaged = false;
  try {
    const { app } = require('electron') as { app: { isPackaged: boolean } };
    isPackaged = app.isPackaged;
  } catch {
    isPackaged = false;  // fallback on error
  }
  if (isPackaged) { return path.join(process.resourcesPath, ...); }
  return path.join(__dirname, ...);
}
```

**clientLocator should follow same try/fallback pattern:**
```typescript
// Each probe method (registry, known-path) is wrapped in try/catch; failures fall
// through to the next probe; manual override is always the final fallback (D-04-09).
// Known paths to probe: 'D:\\SWG Infinity\\SWG Infinity', 'D:\\SWGEmu Client\\SWGEmu'
// Registry keys to try: HKCU\Software\SWGEmu, HKCU\Software\SWG Infinity (OQ-1 / A4)
```

---

### `packages/renderer/src/services/gitLfsService.ts` (service, event-driven)

**No close analog in repo** — execFile child_process is new. Closest pattern: `useLiveService.ts` (async function shape + try/catch + store update). The critical security constraint is D-04-16.

**execFile pattern (SECURITY — D-04-16):**
```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// CORRECT — argument array, never string interpolation
export async function gitCommit(repoPath: string, msg: string, stagePaths: string[]): Promise<string> {
  // Explicit-path staging only — never 'git add .' (D-04-15)
  await execFileAsync('git', ['add', '--', ...stagePaths], { cwd: repoPath });
  const { stdout } = await execFileAsync('git', ['commit', '-m', msg], { cwd: repoPath });
  return stdout.trim();
}

// BANNED — never do this (doc's pattern is an injection vector):
// exec(`git commit -m "${msg}"`, ...)  ← command injection via msg
```

**Error-to-store pattern** (useLiveService.ts lines 157-163):
```typescript
try {
  const { stdout } = await execFileAsync('git', [...], { cwd: repoPath });
  useVcsStore.getState().commitComplete(shortSha);
} catch (err) {
  const reason = String((err as Error)?.message ?? err);
  useVcsStore.getState().commitError(reason);
}
```

---

### `packages/renderer/src/services/packPatch.ts` (service, transform)

**Analog:** `packages/renderer/src/hooks/useLiveService.ts` (addon require pattern) + `packages/native-core/index.d.ts` lines 515-518 (buildTre API)

**Addon require pattern** (useLiveService.ts lines 29-35):
```typescript
// Path B: require the addon directly (nodeIntegration:true in the renderer).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as { ... };
```

**buildTre call pattern** (index.d.ts lines 515-518 + RESEARCH.md Pattern 1):
```typescript
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  buildTre: (entries: TreBuilderEntryNative[], version?: string) => ArrayBuffer;
};

import { readFileSync, writeFileSync } from 'fs';
import type { TreBuilderEntryNative } from '@swg/native-core';

export function packPatch(staged: StagingEntry[], outputPath: string): void {
  // Version '5000' = EERT5000 format used by live Infinity client (verified by hexdump)
  const entries: TreBuilderEntryNative[] = staged.map((s) =>
    s.action === 'delete'
      ? { path: s.virtualPath, tombstone: true }
      : { path: s.virtualPath, data: readFileSync(s.replacementFilePath) }
  );
  const patchBytes = nativeCore.buildTre(entries, '5000');
  writeFileSync(outputPath, Buffer.from(patchBytes));
}
```

---

### `packages/renderer/src/state/stagingStore.ts` (store, CRUD)

**Analog:** `packages/renderer/src/state/liveStore.ts` (exact pattern)

**Imports pattern** (liveStore.ts lines 1-4, 14-15):
```typescript
import { create } from 'zustand';
import type { VerifiedObjectState } from '@swg/contracts';
```
For stagingStore: `import type { StagingEntry, StagingAction } from '@swg/contracts';`

**Interface pattern** (liveStore.ts lines 31-59):
```typescript
export interface LiveStore {
  status:         ConnectionStatus;   // discriminated union
  mode:           InjectionMode;
  disabledReason: string | null;
  verifiedState:  VerifiedObjectState | null;
  regionBytes:    Uint8Array | null;

  // ─── Actions ───────────────────────────────────────────────────────────────
  beginAttach: (clientExe: string) => void;
  attachComplete: (pid: number, mappingName: string) => void;
  attachError: (reason: string) => void;
  setMode: (mode: InjectionMode, reason?: string) => void;
  updateState: (state: VerifiedObjectState | null) => void;
  updateRegion: (bytes: Uint8Array | null) => void;
  detach: () => void;
}
```

**Store implementation pattern** (liveStore.ts lines 63-96):
```typescript
export const useLiveStore = create<LiveStore>((set) => ({
  status:         { kind: 'idle' },
  mode:           'file-patch',
  disabledReason: null,
  verifiedState:  null,
  regionBytes:    null,

  beginAttach: (_clientExe: string) =>
    set({ status: { kind: 'connecting' }, disabledReason: null }),

  attachComplete: (pid: number, mappingName: string) =>
    set({ status: { kind: 'attached', pid, mappingName }, mode: 'live' }),

  attachError: (reason: string) =>
    set({ status: { kind: 'error', reason }, mode: 'file-patch', disabledReason: reason }),

  detach: () =>
    set({ status: { kind: 'idle' }, mode: 'file-patch', verifiedState: null, ... }),
}));
```
For stagingStore: `entries: StagingEntry[]`, `addEntry`, `removeEntry`, `clearAll` actions.

---

### `packages/renderer/src/panels/deploy/StagingPanel.tsx` (component, CRUD)

**Analog:** `packages/renderer/src/panels/tre/VfsTree.tsx` (exact virtualized list pattern)

**Imports pattern** (VfsTree.tsx lines 23-27):
```typescript
import React, { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import type { VfsEntry, ShadowChainDisplay } from '../../state/treStore.ts';
import type { MountedArchive } from '../../state/treStore.ts';
import ShadowChainDetail from './ShadowChainDetail.tsx';
```

**Virtualization constants** (VfsTree.tsx lines 42-45):
```typescript
const ROW_HEIGHT = 30;   // MANDATORY — matches all other panels; don't change
const OVERSCAN   = 8;    // rows above/below viewport to keep rendered
```

**Virtualization core** (VfsTree.tsx lines 67-113):
```typescript
const containerRef = useRef<HTMLDivElement>(null);
const [scrollTop,  setScrollTop]  = useState(0);
const [viewHeight, setViewHeight] = useState(400);

// ResizeObserver — mandatory for panels that resize
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const obs = new ResizeObserver((entries) => {
    const h = entries[0]?.contentRect.height ?? 400;
    setViewHeight(h);
  });
  obs.observe(el);
  return () => obs.disconnect();
}, []);

const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
  setScrollTop((e.currentTarget as HTMLDivElement).scrollTop);
}, []);

// Windowing math
const totalRows   = entries.length;
const totalHeight = totalRows * ROW_HEIGHT;
const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT);
const startRow     = Math.max(0, firstVisible - OVERSCAN);
const endRow       = Math.min(totalRows - 1, firstVisible + visibleCount + OVERSCAN);
const topPad       = startRow * ROW_HEIGHT;
const bottomPad    = Math.max(0, (totalRows - endRow - 1) * ROW_HEIGHT);
```

**Virtualized list JSX** (VfsTree.tsx lines 167-199):
```tsx
<div
  ref={containerRef}
  role="listbox"
  aria-label="Virtual filesystem entries"
  onScroll={handleScroll}
  style={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }}
>
  <div style={{ height: totalHeight, position: 'relative' }}>
    <div style={{ height: topPad }} />  {/* top spacer */}
    {visibleRows.map((rowIndex) => {
      const entry = entries[rowIndex];
      if (!entry) return null;
      return <VfsRow key={entry.path} entry={entry} ... />;
    })}
    <div style={{ height: bottomPad }} />  {/* bottom spacer */}
  </div>
</div>
```

**Row selection pattern** (VfsTree.tsx lines 280-310):
```tsx
<div
  role="option"
  aria-selected={isSelected}
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={handleKeyDown}
  style={{
    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
    height: ROW_HEIGHT,
    paddingLeft: 'var(--space-4)', paddingRight: 'var(--space-4)',
    cursor: 'pointer',
    borderLeft: isSelected ? '2px solid var(--color-accent)' : '2px solid transparent',
    background: isSelected ? 'var(--color-accent-dim)' : 'transparent',
    transition: 'background 0.1s ease',
    outline: 'none', boxSizing: 'border-box',
  }}
  onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-2)'; }}
  onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
  onFocus={(e)    => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--focus-ring)'; }}
  onBlur={(e)     => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
>
```

**Empty state pattern** (VfsTree.tsx lines 127-148):
```tsx
if (entries.length === 0) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 'var(--space-2)',
      color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)',
      textAlign: 'center', padding: 'var(--space-4)',
    }}>
      <span>Nothing staged</span>
      <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
        Extract a file and Add to patch, or drop in a replacement.
      </span>
    </div>
  );
}
```

---

### `packages/renderer/src/panels/deploy/ChangesetTimelinePanel.tsx` (component, CRUD)

**Analog:** `packages/renderer/src/panels/tre/VfsTree.tsx` (same virtualized list pattern)

All virtualization code (ROW_HEIGHT=30, OVERSCAN=8, ResizeObserver, scrollTop, topPad/bottomPad) is identical to StagingPanel above.

**Active vs rolled-back row differentiation** — extend the row selection pattern from VfsTree.tsx lines 294-302:
```tsx
// Active layer: accent border + accent-dim background
// Rolled-back layers: faint color + no accent (dimmed but VISIBLE and clickable for redo)
const isActive     = versionIndex === activeVersionIndex;
const isRolledBack = versionIndex > activeVersionIndex;

style={{
  borderLeft: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
  background: isActive ? 'var(--color-accent-dim)' : 'transparent',
  color: isRolledBack ? 'var(--color-text-faint)' : 'var(--color-text)',
  // Rolled-back rows stay in DOM, stay clickable — never hidden (D-04-08)
}}
```

**Keyboard handler pattern** (VfsTree.tsx lines 276-282):
```tsx
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handleClick();  // activate this version (rollback or redo)
  }
};
```
Row `aria-label="Activate version v00N"` per UI-SPEC accessibility contract.

---

### `packages/renderer/src/panels/deploy/DeployDialog.tsx` (component, request-response)

**Analog:** `packages/renderer/src/panels/viewport/ExportDialog.tsx` (verbatim structural clone — UI-SPEC mandate)

**Imports pattern** (ExportDialog.tsx lines 40-48):
```typescript
import React, { useState, useCallback } from 'react';
import AsyncProgress from '../../shared/AsyncProgress.js';
import VerificationStatus from '../../shared/VerificationStatus.js';
// Plus stores for deploy state:
import { useStagingStore } from '../../state/stagingStore.js';
import { useWorkspaceStore } from '../../state/workspaceStore.js';
```

**Phase discriminated union** (ExportDialog.tsx lines 59-63):
```typescript
type DeployPhase =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'activating' }
  | { kind: 'done'; slot: string }
  | { kind: 'error'; step: 'build' | 'activate'; message: string };
```

**Modal overlay structure** (ExportDialog.tsx lines 172-306):
```tsx
return (
  <div role="dialog" aria-modal="true" aria-label="Deploy" style={overlayStyle}
       onClick={handleClose}>
    <div style={panelStyle} onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
          Deploy patch
        </span>
        <button aria-label="Close deploy dialog" title="Close" onClick={handleClose}
                style={closeBtnStyle}>×</button>
      </div>
      <div style={{ height: 1, background: 'var(--color-border)' }} />
      {/* Section A — client picker, Section B — deploy model, Section C — cfg slot preview */}
      <div style={sectionStyle}>...</div>
      ...
    </div>
  </div>
);
```

**Overlay and panel styles** (ExportDialog.tsx lines 401-421):
```typescript
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
};
const panelStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  width: 360,           // NOTE: 360px for DeployDialog vs 320px in ExportDialog (more fields)
  maxWidth: '90vw',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
```

**Primary/secondary button styles** (ExportDialog.tsx lines 483-506):
```typescript
function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background:   disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    border:       'none',
    color:        disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    borderRadius: 'var(--radius-sm)',
    padding:      '6px 16px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontSize:     'var(--text-sm)', fontWeight: 600,
    opacity:      disabled ? 0.6 : 1, transition: 'opacity 0.1s ease',
  };
}
const secondaryBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)', borderRadius: 'var(--radius-sm)',
  padding: '3px 10px', cursor: 'pointer', fontSize: 'var(--text-xs)',
};
```

**AsyncProgress + VerificationStatus usage** (ExportDialog.tsx lines 257-289):
```tsx
{phase.kind === 'building' && <AsyncProgress caption="Building patch (v5000)…" />}
{phase.kind === 'activating' && <AsyncProgress caption="Writing client config…" />}
{phase.kind === 'done' && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
    <VerificationStatus variant="pass" caption={`deployed · slot ${phase.slot}`} />
    <button aria-label="Reset deployment" onClick={handleReset} style={secondaryBtnStyle}>
      Reset deployment
    </button>
  </div>
)}
{phase.kind === 'error' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
    <VerificationStatus variant="fail"
      caption={phase.step === 'activate'
        ? `Could not write client config — ${phase.message}. The .cfg was restored from backup.`
        : `Could not build patch — ${phase.message}.`} />
    <button aria-label="Retry" onClick={handleRetry} style={secondaryBtnStyle}>Retry</button>
  </div>
)}
```

---

### `packages/renderer/src/panels/deploy/VcsPanel.tsx` (component, event-driven)

**Analog:** `packages/renderer/src/panels/LiveInspectorPanel.tsx` (panel head + dockview panel shape) + `ExportDialog.tsx` (VerificationStatus + async button pattern)

**Dockview panel head pattern** (LiveInspectorPanel.tsx lines 34, 61-80):
```tsx
export default function LiveInspectorPanel(_props: IDockviewPanelProps): React.ReactElement {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--color-surface)', color: 'var(--color-text)',
      fontFamily: 'var(--font-sans)', overflow: 'hidden',
    }}>
      {/* Panel head */}
      <div style={{
        display: 'flex', alignItems: 'center', height: 'var(--tabstrip-h)',
        background: 'var(--color-header)', borderBottom: '1px solid var(--color-border)',
        ...
      }}>
```

**Pre-commit guard surface** — reuse VerificationStatus (ExportDialog.tsx lines 275-289):
```tsx
// Guard pass:
<VerificationStatus variant="pass" caption="guard passed — mod outputs only" />
// Guard fail:
<VerificationStatus variant="fail"
  caption={`blocked: ${offendingFile} looks like retail/.tre bytes — never commit a patch or retail archive`}
  ariaLabel="Pre-commit guard failed" />
```

**LFS absent warning** — reuse VerificationStatus variant="warn":
```tsx
<VerificationStatus variant="warn" caption="git-lfs not found — large binaries will bloat history." />
```

**Commit textarea** — mirroring ExportDialog.tsx sectionStyle:
```tsx
<textarea
  placeholder="Describe this changeset…"
  style={{
    background: 'var(--color-bg)',        // NOTE: NOT --color-input (undefined token — UI-SPEC bug)
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-4)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-base)',
    color: 'var(--color-text)',
    resize: 'vertical', width: '100%',
  }}
/>
```

---

### `packages/renderer/src/panels/deploy/WorkspaceEntry.tsx` (component, request-response)

**Analog:** `packages/renderer/src/panels/tre/VfsTree.tsx` empty state pattern (lines 127-148)

**Empty state structure** (VfsTree.tsx lines 127-148):
```tsx
return (
  <div style={{
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 'var(--space-2)',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-sm)',
    textAlign: 'center', padding: 'var(--space-4)',
  }}>
    <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>No mod workspace open</span>
    <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-base)' }}>
      Open or create a project folder to start a mod.
    </span>
    {/* Buttons: primary "Open Project…", secondary "New Project…" */}
    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
      <button style={primaryBtnStyle(false)} onClick={handleOpen}>Open Project…</button>
      <button style={secondaryBtnStyle} onClick={handleNew}>New Project…</button>
    </div>
  </div>
);
```
Use `primaryBtnStyle`/`secondaryBtnStyle` verbatim from ExportDialog.tsx lines 483-506.

---

### `packages/renderer/src/panels/deploy/ActionBadge.tsx` (utility, transform)

**Analog:** `packages/renderer/src/shared/VerificationStatus.tsx` (glyph+color+label triple-encoding pattern)

**VARIANT_CONFIG pattern** (VerificationStatus.tsx lines 29-39):
```typescript
const VARIANT_CONFIG: Record<VerificationVariant, { glyph: string; colorVar: string }> = {
  'pass':        { glyph: '✓', colorVar: 'var(--color-accent)' },
  'fail':        { glyph: '✕', colorVar: 'var(--color-danger)' },
  'warn':        { glyph: '▴', colorVar: 'var(--color-warn)'   },
  'neutral':     { glyph: '·', colorVar: 'var(--color-text-muted)' },
};
```

**ActionBadge equivalent:**
```typescript
type StagingAction = 'add' | 'modify' | 'delete';
const ACTION_CONFIG: Record<StagingAction, { glyph: string; label: string; colorVar: string }> = {
  'add':    { glyph: '+', label: 'add',                 colorVar: 'var(--color-info)'      },
  'modify': { glyph: '~', label: 'modify',              colorVar: 'var(--color-text-muted)' },
  'delete': { glyph: '⊘', label: 'delete (tombstone)', colorVar: 'var(--color-warn)'       },
};
```

**Render pattern** (VerificationStatus.tsx lines 56-93):
```tsx
export default function ActionBadge({ action }: { action: StagingAction }): React.ReactElement {
  const { glyph, label, colorVar } = ACTION_CONFIG[action];
  return (
    <span aria-label={label} title={label}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
                   color: colorVar, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                   flexShrink: 0 }}>
      <span aria-hidden="true">{glyph}</span>
      <span>{label}</span>
    </span>
  );
}
```

---

### `packages/renderer/src/shell/StatusBar.tsx` (extend — add workspace/deploy indicators)

**Analog:** self — follow the existing `useLiveStore`/`useTreStore` selector pattern

**Existing store selector pattern** (StatusBar.tsx lines 69-74):
```typescript
const liveMode       = useLiveStore((s) => s.mode);
const treArchives    = useTreStore((s) => s.archives);
const treVfsEntries  = useTreStore((s) => s.vfsEntries);
const treMountStatus = useTreStore((s) => s.mountStatus);
```

**New selectors to add (mirror exactly):**
```typescript
const workspaceName    = useWorkspaceStore((s) => s.workspaceName);    // null = no workspace
const activeVersion    = useChangesetStore((s) => s.activeVersionIndex);  // -1 = no changesets
const clientDetected   = useWorkspaceStore((s) => s.clientPath !== null);
```

**Existing span+Dot pattern** (StatusBar.tsx lines 240-270):
```tsx
<span>
  vfs: <span style={{ color: treVfsEntries.length > 0 ? 'var(--color-accent)' : '...' }}>
    {treVfsEntries.length.toLocaleString()} files
  </span>
</span>
<Dot />
// ADD after live mode indicator:
<span>
  workspace: <span style={{ color: workspaceName ? 'var(--color-info)' : 'var(--color-text-faint)',
                             fontFamily: 'var(--font-mono)' }}>
    {workspaceName ?? 'none'}
  </span>
</span>
<Dot />
<span>
  {clientDetected ? '● client' : '○ no client'}
</span>
```

---

### `packages/renderer/src/workspace/WorkspaceShell.tsx` (extend — register new panels)

**Analog:** self — add entries to `panelComponents` record following the Phase 3 pattern

**Existing registration pattern** (WorkspaceShell.tsx lines 24-31):
```typescript
const panelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = {
  sidebar:          SidebarPanel,
  viewport:         ViewportPanel,
  inspector:        InspectorPanel,
  data:             DataPanel,
  'live-inspector': LiveInspectorPanel,  // Phase 3: added here
};
```

**Phase 4 additions — extend the record:**
```typescript
import StagingPanel          from '../panels/deploy/StagingPanel';
import ChangesetTimelinePanel from '../panels/deploy/ChangesetTimelinePanel';
import VcsPanel               from '../panels/deploy/VcsPanel';

const panelComponents = {
  // ... existing ...
  'staging':    StagingPanel,
  'changesets': ChangesetTimelinePanel,
  'vcs':        VcsPanel,
  // WorkspaceEntry is NOT a dockable panel — it is the app-level empty state
};
```

**buildInitialLayout extension** (workspace-config.ts lines 56-90):
```typescript
// Add after existing panels:
api.addPanel({
  id: 'staging',
  component: 'staging',
  title: 'Staging',
  position: { direction: 'left', referencePanel: 'sidebar' },
  initialWidth: 260,
});
api.addPanel({
  id: 'changesets',
  component: 'changesets',
  title: 'Changesets',
  position: { direction: 'below', referencePanel: 'staging' },
  initialHeight: 200,
});
```

---

### `packages/contracts/src/workspace.ts` (model, CRUD)

**Analog:** `packages/contracts/src/live-inject.ts` (interface + const, no runtime code)

**File structure pattern** (live-inject.ts lines 1-11):
```typescript
/**
 * packages/contracts/src/workspace.ts
 * Type definitions for Phase 4 workspace + staging + changeset + deploy.
 * No runtime code — types and const objects only.
 */
```

**Interface pattern** (live-inject.ts lines 95-104):
```typescript
export interface VerifiedObjectState {
  networkId:    bigint;
  templateName: string;
  transform:    Float32Array;
  playerAlive:  boolean;
}
```

---

### `packages/contracts/src/staging.ts` (model, CRUD)

**Analog:** `packages/contracts/src/tre.ts` (typed interfaces with ground-truth citations)

**Citation pattern** (tre.ts lines 161-173):
```typescript
/**
 * One entry for the TRE builder.
 *
 * Source: swg-client-v2 TreeFileBuilder.cpp:558-597 (writeFile);
 *         TreBuilder.h TreBuilderEntry.
 */
export interface TreBuildEntry {
  path: string;
  data?: Uint8Array;
  tombstone?: boolean;
}
```

For staging.ts, mirror this for `StagingEntry`:
```typescript
/**
 * One explicitly staged entry (D-04-03).
 * Maps 1:1 onto TreBuilderEntryNative for buildTre (DEPLOY-01).
 */
export interface StagingEntry {
  /** Normalized VFS virtual path (e.g. "appearance/player.apt"). */
  virtualPath: string;
  /** 'add' | 'modify' = replace retail with replacementFilePath bytes */
  action: 'add' | 'modify' | 'delete';
  /** Absolute path to the on-disk replacement file. Required for add/modify. */
  replacementFilePath?: string;
  /** SHA-256 of replacement bytes at time of staging. For drift detection. */
  sha256?: string;
}
```

---

### `packages/contracts/src/changeset.ts` (model, CRUD)

**Analog:** `packages/contracts/src/tre.ts`

Key types (from RESEARCH.md OQ-3 and doc:530-607):
```typescript
export interface SwgChangeset {
  id:            string;    // UUID
  versionIndex:  number;    // 0-based, immutable after seal
  label:         string;
  timestamp:     string;    // ISO 8601
  sealedBy:      'manual' | 'pack';   // D-04-07 extension (OQ-3)
  deltas:        StagingEntry[];      // snapshot of staging list at seal time
  deployRecord?: CfgDeployRecord;     // D-04-12 extension (OQ-3) — present when this changeset was deployed
}

export interface CfgDeployRecord {
  cfgPath:    string;   // absolute path to the edited .cfg
  keyName:    string;   // e.g. "searchTree_00_55"
  slot:       number;   // numeric slot used
  backupPath: string;   // .swgtoolkit.bak path
  patchPath:  string;   // absolute path to the deployed patch.tre
  patchVersion: string; // '5000' — TRE version built
}

export interface WorkspaceChangesetManifest {
  activeVersionIndex: number;    // -1 = no changesets; pointer for non-destructive rollback
  changesets:         SwgChangeset[];
}
```

---

### `packages/contracts/src/deploy.ts` (model, CRUD)

**Analog:** `packages/contracts/src/live-inject.ts` (discriminated union + interface)

```typescript
export interface DetectedClient {
  name:         string;   // e.g. "SWG Infinity"
  installPath:  string;   // e.g. "D:\\SWG Infinity\\SWG Infinity"
  cfgRootPath:  string;   // path to swgemu.cfg (the .include chain root)
  treVersion:   string;   // e.g. '5000' (from hexdump of first archive)
}

export type DeployModel = 'patch-prepend' | 'shadow-base';

export type DeployResult =
  | { ok: true;  insertionRecord: CfgDeployRecord }
  | { ok: false; step: 'build' | 'activate'; reason: string; cfgRestored: boolean };
```

---

### `packages/contracts/src/index.ts` (extend)

**Analog:** self

**Existing pattern** (index.ts lines 1-14):
```typescript
export * from './ipc.js';
export * from './sab-layout.js';
// ... all existing exports ...
export * from './live-inject.js';
```

**Add after live-inject:**
```typescript
export * from './workspace.js';
export * from './staging.js';
export * from './changeset.js';
export * from './deploy.js';
```

**Critical gotcha (Phase 2 build note):** after editing any `contracts/src/*.ts` file, run:
```bash
pnpm --filter @swg/contracts build
```
or the renderer's import of `@swg/contracts` will use the stale `dist/` — no TypeScript error, but wrong types at runtime.

---

### `packages/native-core/test/packPatch.test.ts` (test, transform)

**Analog:** `packages/harness/test/tre-builder-roundtrip.test.ts` (exact pattern)

**Test file header pattern** (tre-builder-roundtrip.test.ts lines 1-45):
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname_es = dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  buildTre: (entries: Array<{path: string; data?: Uint8Array; tombstone?: boolean}>, version?: string) => ArrayBuffer;
  mountArchive: (paths: string[]) => Array<{archiveIndex: number; entryCount: number; path: string}>;
  listEntries: (idx: number) => Array<{path: string; crc: number; uncompressedSize: number; compressor: number}>;
};

const TMP = join(tmpdir(), 'swg-packpatch-test');
mkdirSync(TMP, { recursive: true });
```

**Version-5000 gate test:**
```typescript
describe('packPatch DEPLOY-01', () => {
  it('builds a v5000 patch (EERT5000 magic — matches live Infinity archives)', () => {
    const entries = [{ path: 'test/file.txt', data: new Uint8Array([1, 2, 3]) }];
    const bytes = new Uint8Array(nativeCore.buildTre(entries, '5000'));
    // Magic bytes 0-3: 'E','E','R','T'
    expect(bytes[0]).toBe(0x45); expect(bytes[1]).toBe(0x45);
    expect(bytes[2]).toBe(0x52); expect(bytes[3]).toBe(0x54);
    // Version bytes 4-7: '5','0','0','0'
    expect(bytes[4]).toBe(0x35); expect(bytes[5]).toBe(0x30);
    expect(bytes[6]).toBe(0x30); expect(bytes[7]).toBe(0x30);
  });

  it('tombstone entry has length-0 TOC (shadows retail via first-match-wins)', () => {
    const entries = [{ path: 'deleted/file.txt', tombstone: true }];
    const tmpPath = join(TMP, 'tombstone-check.tre');
    writeFileSync(tmpPath, Buffer.from(nativeCore.buildTre(entries, '5000')));
    const results = nativeCore.mountArchive([tmpPath]);
    const listed  = nativeCore.listEntries(results[0].archiveIndex);
    const tomb    = listed.find(e => e.path === 'deleted/file.txt');
    expect(tomb).toBeDefined();
    expect(tomb!.uncompressedSize).toBe(0);   // length-0 TOC = tombstone
  });
});
```

---

### `packages/native-core/test/patch-shadow.test.ts` (test, CRUD)

**Analog:** `packages/harness/test/tre-override.test.ts` (mountTreMount + resolveEntry pattern)

**Mount + resolve pattern** (tre-override.test.ts lines 29-49):
```typescript
const nativeCore = require('../../native-core/index.js') as {
  mountTreMount: (paths: string[], priorities: number[]) => string;
  resolveEntry:  (mountHandle: string, name: string) => { winner: string | null; tombstone: boolean; ... };
  disposeTreMount: (mountHandle: string) => void;
};

// Build a base TRE (lower priority) + a patch TRE (higher priority)
// then mount both and assert resolveEntry returns the patch's version:
const handle = nativeCore.mountTreMount([basePath, patchPath], [1, 55]);
try {
  const result = nativeCore.resolveEntry(handle, 'modified/asset.iff');
  expect(result.winner).toBeTruthy();  // patch wins
} finally {
  nativeCore.disposeTreMount(handle);
}
```

---

### `packages/renderer/test/cfgScan.test.ts` and `cfgActivator.test.ts` (test, file-I/O)

**Analog:** `packages/harness/test/contract-conformance.test.ts` (fixture pattern — describe/it/expect + real file fixtures)

**Fixture pattern** (contract-conformance.test.ts lines 66-73):
```typescript
const REAL = join(__dirname, '..', 'fixtures-real');

function loadFixture(relPath: string): Uint8Array | null {
  const fullPath = join(REAL, relPath);
  if (!existsSync(fullPath)) return null;
  const buf = readFileSync(fullPath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
```

**For cfgActivator tests — use text fixture files:**
```typescript
// Use COPIES of real Infinity .cfg files (names-only are fine; no retail bytes)
// as test fixtures under packages/renderer/test/fixtures/cfg/
// E.g. a minimal swgemu_live.cfg with [SharedFile] maxSearchPriority=60 + searchTree_00_30..54

import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const FIXTURE_CFG = `[SharedFile]\r\n\tmaxSearchPriority=60\r\n\tsearchTree_00_30=bottom.tre\r\n`;

describe('cfgActivator DEPLOY-02', () => {
  it('inserts a free higher slot without disturbing existing keys', () => {
    const dir = join(tmpdir(), 'cfg-test');
    mkdirSync(dir, { recursive: true });
    const cfgPath = join(dir, 'swgtoolkit.cfg');
    writeFileSync(cfgPath, FIXTURE_CFG, 'utf8');
    const result = activatePatch(cfgPath, 'patch.tre', scan);
    const content = readFileSync(cfgPath, 'utf8');
    expect(content).toContain('searchTree_00_30=bottom.tre');  // existing key preserved
    expect(content).toContain('searchTree_00_31=patch.tre');   // new key at slot 31 > 30
    expect(content).not.toMatch(/^﻿/);                   // no BOM
  });
});
```

---

### `packages/renderer/test/gitLfs.test.ts` (test, event-driven)

**No close analog** — requires spawning a temp git repo with `execFile('git', ['init'])` in a tmpdir. Closest test infrastructure: `tre-builder-roundtrip.test.ts` for tmpdir + describe/it structure.

---

## Shared Patterns

### Zustand Store Pattern
**Source:** `packages/renderer/src/state/liveStore.ts` (all stores)
**Apply to:** `stagingStore.ts`, and any new `workspaceStore.ts`, `changesetStore.ts`, `vcsStore.ts`
```typescript
import { create } from 'zustand';
// 1. Define discriminated union status types above the interface
// 2. Define interface with state fields + action methods as `(args) => void`
// 3. export const useXxxStore = create<XxxStore>((set) => ({ ...initialState, actionName: (args) => set({...}) }))
// 4. Imperative access outside React: useXxxStore.getState().action(...)
```

### Path B fs/addon Access
**Source:** `packages/renderer/src/hooks/useLiveService.ts` lines 21-35
**Apply to:** All service files under `packages/renderer/src/services/`
```typescript
// nodeIntegration:true, contextIsolation:false — renderer can use Node built-ins directly
import fs   from 'fs';
import path from 'path';
import os   from 'os';
// For native addons:
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/native-core') as { buildTre: ...; };
// For git:
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
// NEVER: exec(`git commit -m "${msg}"`) — command injection (D-04-16)
```

### Dockview Panel Registration
**Source:** `packages/renderer/src/workspace/WorkspaceShell.tsx` lines 24-31
**Apply to:** `WorkspaceShell.tsx` extension
```typescript
// All panel IDs registered in panelComponents BEFORE fromJSON is called (Pitfall 5)
const panelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = {
  'panel-id': ComponentFunction,
  ...
};
```

### Atomic fs Write (BOM-free)
**Source:** `packages/renderer/src/hooks/useLiveService.ts` lines 107-122
**Apply to:** `cfgActivator.ts`, `changesetService.ts`
```typescript
// Pattern: write temp → rename (atomic on same volume)
fs.writeFileSync(tmp, content, { encoding: 'utf8' }); // 'utf8' = no BOM
fs.renameSync(tmp, dest);
// Backup: fs.copyFileSync(src, src + '.swgtoolkit.bak') before any edit
```

### Token Conventions (all UI files)
**Source:** `packages/renderer/src/panels/viewport/ExportDialog.tsx` lines 401-506
**Apply to:** All `panels/deploy/*.tsx` files
- Panel background: `var(--color-surface)`, head: `var(--color-header)`
- Spacing: `var(--space-1)` (3px) through `var(--space-8)` (24px) — 3px DCC base grid
- Panel head height: `var(--tabstrip-h)` (30px)
- Do NOT use `var(--color-input)` — undefined token (latent bug noted in UI-SPEC)
- Use `background: var(--color-bg)` for input/textarea fields

### Vitest Test File Pattern
**Source:** `packages/harness/test/tre-builder-roundtrip.test.ts` lines 26-44
**Apply to:** All new `.test.ts` files
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const __dirname_es = dirname(fileURLToPath(import.meta.url));
const TMP = join(tmpdir(), 'swg-<test-name>-test');
mkdirSync(TMP, { recursive: true });
```

### Contract File Pattern
**Source:** `packages/contracts/src/live-inject.ts` + `packages/contracts/src/tre.ts`
**Apply to:** All new `packages/contracts/src/*.ts` files
```typescript
// No runtime code — types and const objects only.
// Each interface includes a Source: citation (swg-client-v2 + doc reference).
// Register in contracts/src/index.ts with:  export * from './newFile.js';
// Then rebuild:  pnpm --filter @swg/contracts build
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/renderer/test/gitLfs.test.ts` | test | event-driven | No existing test shells out to child_process git; requires a temporary git repo. Use the tmpdir pattern from tre-builder-roundtrip.test.ts + execFile('git', ['init'], {cwd}) — all new patterns. |

---

## Metadata

**Analog search scope:** `packages/renderer/src/` (all TS/TSX), `packages/harness/test/`, `packages/contracts/src/`, `packages/native-core/`
**Files scanned:** 40
**Pattern extraction date:** 2026-06-26
