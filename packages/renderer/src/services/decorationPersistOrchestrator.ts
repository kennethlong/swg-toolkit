/**
 * packages/renderer/src/services/decorationPersistOrchestrator.ts
 * Renderer glue for the model-D decoration round trip. Called from useChannelReader's poll loop
 * when the agent publishes a NEW capture epoch:
 *
 *   parse CAPTURE → resolve the running client's loose override dir → assembleDecorationEdit
 *   (writes the edited .ilf + derived template into that dir — additive, instance-named, shadows
 *   nothing) → stage a temp copy for the durable deploy record → addon.writeRebind(APPLY) so the
 *   agent re-points the .ws node + saves. On any failure, writeRebind(ABORT) so the agent stops
 *   waiting and reports.
 *
 * Decision A (maintainer-approved): the two derived files are written straight into the LIVE
 * client override dir so the in-game rebind resolves the derived template immediately via
 * TreeFile. Safe because they are NEW paths under object/building/toolkit + interiorlayout/toolkit
 * (they overwrite nothing — the snapshot/restore tenet is about clobbering existing files/config).
 *
 * readVfs checks the override dir BEFORE the mounted TRE, so a repeat edit of the same building
 * reads back the accumulated edited .ilf (P1) instead of reverting to stock.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

import { LIVE_DECORATION_REBIND_FLAGS } from '@swg/contracts';
import type { DecorationCapture } from '@swg/contracts';

import { assembleDecorationEdit, type DecorationEdit } from './decorationPersist';
import { readVfsEntryBytes } from './readVfsEntryBytes';
import { resolveOverrideDir } from './looseOverrideDeploy';
import { scanForClients, addManualClient } from './clientLocator';
import { useTreStore } from '../state/treStore';
import { useStagingStore } from '../state/stagingStore';
import { log } from './logService';

// Path B: the addon is require'd directly (nodeIntegration:true).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as {
  writeRebind: (name: string, epoch: number, buildingId: string, derivedTemplate: string, flags: number) => void;
};

// ─── Running-client → override dir (cached per exe; resolution is fs-heavy) ────

const overrideDirCache = new Map<string, string | null>();

/**
 * Resolve the loose override dir of the client the exe belongs to. Tries a cheap walk up from the
 * exe directory (addManualClient finds a cfg beside the archives — standard installs), then falls
 * back to scanForClients() and an installPath-prefix match (decoupled dev clients, e.g. the
 * swg-client-v2 stage dirs). Cached — the drive scan must never run per-frame.
 */
export function resolveRunningClientOverrideDir(clientExe: string): string | null {
  const cached = overrideDirCache.get(clientExe);
  if (cached !== undefined) return cached;

  let dir: string | null = null;
  let d = path.dirname(clientExe);
  for (let i = 0; i < 4 && dir === null; i++) {
    const c = addManualClient(d);
    if (c) dir = resolveOverrideDir(c.cfgRootPath, c.installPath);
    d = path.dirname(d);
  }
  if (dir === null) {
    const exeNorm = clientExe.replace(/\\/g, '/').toLowerCase();
    try {
      for (const c of scanForClients()) {
        if (exeNorm.startsWith(c.installPath.replace(/\\/g, '/').toLowerCase())) {
          dir = resolveOverrideDir(c.cfgRootPath, c.installPath);
          break;
        }
      }
    } catch { /* scan failure → unresolved */ }
  }

  overrideDirCache.set(clientExe, dir);
  return dir;
}

/** Test/reset hook — clears the per-exe override-dir cache. */
export function _clearOverrideDirCache(): void {
  overrideDirCache.clear();
}

// ─── readVfs: override dir first (accumulation), then the mounted TRE ──────────

function makeReadVfs(overrideDir: string): (vfsPath: string) => Buffer {
  return (vfsPath: string): Buffer => {
    // 1) Loose override dir — our just-written edited .ilf / derived template, or any deployed
    //    loose file. This is what makes repeat edits accumulate (P1) instead of reverting.
    const loosePath = path.join(overrideDir, ...vfsPath.replace(/\\/g, '/').split('/'));
    if (fs.existsSync(loosePath)) return fs.readFileSync(loosePath);

    // 2) The mounted TRE (stock asset). Resolve the VfsEntry from the store, mirroring
    //    TreVfsBrowser's descriptor logic for master-.toc clients.
    const st = useTreStore.getState();
    const norm = vfsPath.replace(/\\/g, '/').toLowerCase();
    const entry = st.vfsEntries.find((e) => e.path === norm);
    if (!entry) throw new Error(`readVfs: no VFS entry and no loose file for ${vfsPath}`);
    const winnerArc = st.archives.find((a) => a.archiveIndex === entry.winnerArchiveIndex);
    const isTocSourced = winnerArc ? winnerArc.entryCount === 0 : false;
    const descriptor = st.tocIndex && isTocSourced ? st.tocIndex.resolveFull(entry.path) ?? null : null;
    const ab = readVfsEntryBytes(entry, st.mountHandle, descriptor);
    if (!ab) throw new Error(`readVfs: readVfsEntryBytes returned null for ${vfsPath}`);
    return Buffer.from(ab);
  };
}

// ─── Durable staging (temp copy → avoids deploy-time self-copy) ────────────────

function stageDurable(entries: { virtualPath: string; filePath: string }[]): void {
  const tmpRoot = path.join(os.tmpdir(), 'swg-toolkit-decoration-stage');
  fs.mkdirSync(tmpRoot, { recursive: true });
  for (const e of entries) {
    const bytes = fs.readFileSync(e.filePath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const tmpPath = path.join(tmpRoot, `${sha256.slice(0, 16)}_${path.basename(e.virtualPath)}`);
    fs.writeFileSync(tmpPath, bytes);
    // New instance-named toolkit/ paths shadow nothing → 'add'.
    useStagingStore.getState().addEntry({ virtualPath: e.virtualPath, action: 'add', replacementFilePath: tmpPath, sha256 });
  }
}

// ─── Orchestrator entry point ──────────────────────────────────────────────────

/**
 * Handle one captured decoration move: assemble the loose files, stage them, and send the rebind.
 * Runs synchronously (all reads/writes are sync); called once per new capture epoch. Never throws
 * — on failure it sends ABORT so the agent releases its pending state.
 */
export function handleDecorationCapture(
  epoch: number,
  capture: DecorationCapture,
  ctx: { mappingName: string; clientExe: string | null },
): void {
  const F = LIVE_DECORATION_REBIND_FLAGS;
  try {
    if (!ctx.clientExe) throw new Error('no client exe on the live session');
    const overrideDir = resolveRunningClientOverrideDir(ctx.clientExe);
    if (!overrideDir) throw new Error("could not resolve the running client's loose override dir (no searchPath?)");

    const edit: DecorationEdit = {
      buildingInstanceId: capture.buildingInstanceId,
      buildingTemplateVfsPath: capture.buildingTemplateVfsPath,
      decorationTemplateName: capture.decorationTemplateName,
      originalO2p: capture.originalO2p,
      newO2p: capture.newO2p,
      // cellName omitted — derived by resolveNode from template + originalO2p.
    };

    const result = assembleDecorationEdit(edit, { readVfs: makeReadVfs(overrideDir), overrideDir });
    stageDurable(result.stagedEntries);
    addon.writeRebind(ctx.mappingName, epoch, capture.buildingInstanceId, result.derivedTemplateVfsPath, F.APPLY);
    log('info', 'log', `Decoration edit #${epoch}: assembled + rebind sent (row ${result.rowIndex}, ${result.derivedTemplateVfsPath}).`);
  } catch (e) {
    log('error', 'log', `Decoration edit #${epoch} failed: ${(e as Error).message}`);
    try { addon.writeRebind(ctx.mappingName, epoch, capture.buildingInstanceId, '', F.ABORT); } catch { /* channel gone */ }
  }
}
