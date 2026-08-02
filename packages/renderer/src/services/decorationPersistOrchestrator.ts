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

import type { DetectedClient } from '@swg/contracts';
import {
  assembleDecorationEdit,
  sanitizeId,
  writeStockMirror,
  removeStockMirror,
  type DecorationEdit,
} from './decorationPersist';
import { readInteriorLayoutFileName } from './buildingTemplate';
import { scanWorldEditorState } from './worldEditorScan';
import { readVfsEntryBytes } from './readVfsEntryBytes';
import { resolveOverrideDir } from './looseOverrideDeploy';
import { detectClients } from './clientLocator';
import { readWorkspaceJson, updateWorkspaceMeta } from './projectBinding';
import { useTreStore } from '../state/treStore';
import { useStagingStore } from '../state/stagingStore';
import { useWorldEditorStore } from '../state/worldEditorStore';
import { log } from './logService';

// Path B: the addon is require'd directly (nodeIntegration:true).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as {
  writeRebind: (name: string, epoch: number, buildingId: string, derivedTemplate: string, flags: number) => void;
};

// ─── Running-client → override dir (cached per exe; resolution is fs-heavy) ────

const overrideDirCache = new Map<string, string | null>();

// Debug trace — the orchestrator runs inside the poll loop and its logStore/console output is
// trapped in renderer memory; append key steps to a file so failures are inspectable off-app.
// Model-D signed off 2026-07-31 → gated OFF by default; set SWG_TOOLKIT_DECO_TRACE=1 to re-arm.
// (Failures still surface in the app via logService regardless of the gate.)
const DEBUG_LOG = path.join(os.tmpdir(), 'swg-toolkit-decoration-debug.log');
const TRACE_ENABLED = process.env.SWG_TOOLKIT_DECO_TRACE === '1';
function dbg(line: string): void {
  if (!TRACE_ENABLED) return;
  try { fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()}  ${line}\n`); } catch { /* ignore */ }
}

/**
 * Resolve the loose override dir of the client the exe belongs to. Uses detectClients() — the SAME
 * detector the DeployDialog uses — which handles decoupled dev clients (swg-client-v2 stage builds:
 * client.cfg + external TRE, no local .tre, so a bare resolveLayout walk misses them), then matches
 * the running exe by longest installPath prefix. Cached — the scan must never run per-frame.
 */
export function resolveRunningClientOverrideDir(clientExe: string): string | null {
  const cached = overrideDirCache.get(clientExe);
  if (cached !== undefined) return cached;

  let dir: string | null = null;
  const exeNorm = clientExe.replace(/\\/g, '/').toLowerCase();
  try {
    const clients = detectClients();
    dbg(`detectClients → ${clients.map((c) => c.installPath).join(' | ') || '(none)'}`);
    let best: { c: DetectedClient; len: number } | null = null;
    for (const c of clients) {
      const inst = c.installPath.replace(/\\/g, '/').toLowerCase();
      if ((exeNorm === inst || exeNorm.startsWith(`${inst}/`)) && (!best || inst.length > best.len)) {
        best = { c, len: inst.length };
      }
    }
    if (best) {
      dir = resolveOverrideDir(best.c.cfgRootPath, best.c.installPath);
      dbg(`matched ${best.c.installPath} (cfg ${best.c.cfgRootPath}) → overrideDir=${dir ?? 'null'}`);
    } else {
      dbg(`no client installPath is a prefix of exe ${exeNorm}`);
    }
  } catch (e) {
    dbg(`resolveRunningClientOverrideDir threw: ${(e as Error).message}`);
  }

  overrideDirCache.set(clientExe, dir);
  return dir;
}

/** Test/reset hook — clears the per-exe override-dir cache. */
export function _clearOverrideDirCache(): void {
  overrideDirCache.clear();
}

// ─── readVfs: override dir first (accumulation), then the mounted TRE ──────────

/** (ROUND 3, R4) Exported so Plan 10 (reconcileMirrorMode's caller) and Plan 13
 *  (removeDecorationRow's caller) can construct a readVfs the same way this file does. */
export function makeReadVfs(overrideDir: string): (vfsPath: string) => Buffer {
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
 *
 * (ROUND 3, R1) `ctx.studioDir` is OPTIONAL — a missing field is treated identically to an
 * explicit `null` (no bound project / not-yet-updated caller). Keeps this plan's own `tsc`
 * gate green at the Wave-1 boundary; useChannelReader.ts starts populating it in Plan 08.
 *
 * (C7) Returns the resolved `mirrorToStockIlf` value on EVERY exit path (success, arm-failed
 * short-circuit, caught error) so the caller can stash it and use the SAME value at RESULT
 * time (Plan 08) instead of re-reading settings independently.
 */
export function handleDecorationCapture(
  epoch: number,
  capture: DecorationCapture,
  ctx: { mappingName: string; clientExe: string | null; studioDir?: string | null },
): { mirrorToStockIlf: boolean; cellName?: string; rowIndex?: number } {
  const F = LIVE_DECORATION_REBIND_FLAGS;
  const studioDir = ctx.studioDir ?? null;
  // Resolved ONCE, early, before the try/catch — available on every exit path (C7). A missing
  // project (no studioDir) or an absent explicit setting both default to true (today's behavior).
  const mirrorToStockIlf = studioDir !== null ? (readWorkspaceJson(studioDir).mirrorToStockIlf ?? true) : true;

  dbg(`capture #${epoch}: clientExe=${ctx.clientExe ?? 'null'} bldg=${capture.buildingInstanceId} ` +
      `bldgTmpl=${capture.buildingTemplateVfsPath} deco=${capture.decorationTemplateName} kind=${capture.kind ?? 'edit'}`);

  // (C8) An arm-attempt failure never reached a successful arm — no override dir resolution, no
  // assembly, no REBIND (the agent isn't waiting on a rebind answer for this capture epoch).
  if (capture.kind === 'arm-failed') {
    useWorldEditorStore.getState().recordArmFailure(capture.cellName ?? '(unknown arm failure)');
    dbg(`capture #${epoch}: arm-failed — ${capture.cellName ?? '(unknown arm failure)'}`);
    return { mirrorToStockIlf: true };
  }

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
      kind: capture.kind === 'add' ? 'add' : 'edit',
      // (ROUND 3, MED-10) NEVER unconditional — an EDIT must always resolve via resolveNode
      // (template + position), never accidentally via a pinned resolveRowIndex lookup because a
      // stale/leftover capture.cellName happened to be non-empty.
      cellName: capture.kind === 'add' ? capture.cellName : undefined,
    };

    const result = assembleDecorationEdit(edit, {
      readVfs: makeReadVfs(overrideDir),
      overrideDir,
      log: (m) => dbg(`capture #${epoch}: ${m}`),
      // Per-template visibility (maintainer, 2026-07-31): hybrid servers re-stream static POBs from
      // the stock template, hiding the instance-scoped rebind — mirror the edited .ilf onto the stock
      // path so edits are visible in-game. Now a real per-project setting (D-08), resolved above.
      mirrorToStockIlf,
    });
    stageDurable(result.stagedEntries);

    // (ROUND 3, R3) Durably remember this building's stock template VFS path so Plan 13's
    // OFFLINE Remove (no live capture to read it from) can recover it later. Best-effort — a
    // failure to persist this bookkeeping map must never abort or fail the persist itself (the
    // .ilf write + REBIND have already succeeded by this point).
    if (studioDir !== null && capture.buildingTemplateVfsPath) {
      try {
        const prevMap = readWorkspaceJson(studioDir).worldEditorBuildingTemplates ?? {};
        updateWorkspaceMeta(studioDir, {
          worldEditorBuildingTemplates: {
            ...prevMap,
            [sanitizeId(capture.buildingInstanceId)]: capture.buildingTemplateVfsPath,
          },
        });
      } catch (e) {
        dbg(`capture #${epoch}: failed to persist worldEditorBuildingTemplates map: ${(e as Error).message}`);
      }
    }

    // (D-10) The agent reads MIRROR_OFF off this SAME REBIND request — no second write, no new
    // channel region. Uses the SAME mirrorToStockIlf resolved above (never re-resolved — C7).
    const flags = F.APPLY | (mirrorToStockIlf ? 0 : F.MIRROR_OFF);
    addon.writeRebind(ctx.mappingName, epoch, capture.buildingInstanceId, result.derivedTemplateVfsPath, flags);
    dbg(`capture #${epoch}: OK — row ${result.rowIndex}, derived ${result.derivedTemplateVfsPath}, ` +
        `APPLY sent (mirrorToStockIlf=${mirrorToStockIlf})`);
    log('info', 'log', `Decoration edit #${epoch}: assembled + rebind sent (row ${result.rowIndex}, ${result.derivedTemplateVfsPath}).`);
    return { mirrorToStockIlf, cellName: result.cellName, rowIndex: result.rowIndex };
  } catch (e) {
    dbg(`capture #${epoch}: ABORT — ${(e as Error).message}`);
    log('error', 'log', `Decoration edit #${epoch} failed: ${(e as Error).message}`);
    try { addon.writeRebind(ctx.mappingName, epoch, capture.buildingInstanceId, '', F.ABORT); } catch { /* channel gone */ }
    return { mirrorToStockIlf };
  }
}

// ─── reconcileMirrorMode (D-09) ─────────────────────────────────────────────────

export interface ReconcileMirrorModeFailure {
  buildingId: string;
  error: string;
  /** (ROUND 5, V7) 'unchanged' — disk is provably untouched or provably restored. 'uncertain' —
   *  the disclosed T-05.1-06d rollback-double-fault residual: a rollback step itself threw, so
   *  this function cannot prove disk was left/restored to its pre-call state. */
  diskState: 'unchanged' | 'uncertain';
}

interface MirrorGroup {
  mirrorPath: string;
  buildingIds: string[];
  /** The LAST building's edited .ilf bytes in this group, by scan order — the content source for
   *  a 'wrote' action (same pre-existing "last writer wins for a shared template" behavior
   *  assembleDecorationEdit's own live mirror write already has). */
  sourceBytes: Buffer;
}

interface AppliedEntry {
  mirrorPath: string;
  buildingIds: string[];
  action: 'wrote' | 'deleted';
  /** Captured BEFORE unlinking, for a 'deleted' action only (ROUND 5, V4) — a 'wrote' action's
   *  inverse is an unconditional delete, so it needs no remembered bytes. */
  preBytes?: Buffer;
}

/**
 * Flip the per-project mirror-mode setting and reconcile disk to match — D-09's "flipping the
 * toggle must immediately re-run the mirror-only add/remove step over EVERY building already
 * edited, not just the next persist" requirement.
 *
 * Two-phase, transactional (ROUND 4/W1): Phase 1 validates every building's
 * `buildingTemplateVfsPath` (and resolves its stock mirror path) with ZERO writes; if ANY
 * building fails, returns immediately without touching ANY building's mirror — including
 * buildings whose path IS known. Phase 2 (entered only on a clean Phase 1) writes/deletes,
 * grouped by the RESOLVED STOCK MIRROR PATH (ROUND 5, V4 — never by buildingId, so two buildings
 * sharing a template's mirror file are reconciled/rolled-back exactly once), rolling back every
 * already-applied path the instant any write/delete throws. The persisted flag
 * (`updateWorkspaceMeta`) only ever moves on a fully clean pass (ROUND-3-REVIEW R6).
 */
export function reconcileMirrorMode(
  studioDir: string,
  overrideDir: string,
  readVfs: (vfsPath: string) => Buffer,
  nextValue: boolean,
): { failures: ReconcileMirrorModeFailure[] } {
  // (ROUND-3-REVIEW R1) The TWO-arg form — never the stale one-arg call. Without the map, every
  // building's buildingTemplateVfsPath resolves to '', silently no-op-ing D-09's reconcile-on-flip.
  const buildingTemplates = readWorkspaceJson(studioDir).worldEditorBuildingTemplates ?? {};
  const buildings = scanWorldEditorState(overrideDir, buildingTemplates);

  // ── Phase 1: validate — zero writes ───────────────────────────────────────
  const validationFailures: ReconcileMirrorModeFailure[] = [];
  for (const b of buildings) {
    if (b.buildingTemplateVfsPath === '') {
      validationFailures.push({
        buildingId: b.buildingId,
        diskState: 'unchanged',
        error:
          `buildingTemplateVfsPath unknown -- no live capture observed yet for this building; ` +
          `arm/persist a decoration in it once to populate it, or if it cannot be reached live, ` +
          `delete its orphaned edit_${b.buildingId}.ilf from override dir/interiorlayout/toolkit/ ` +
          `to unblock the toggle for the rest of the project`,
      });
    }
  }
  if (validationFailures.length > 0) return { failures: validationFailures };

  // ── Phase 2a: resolve + group by RESOLVED STOCK MIRROR PATH (still zero writes) ────────────
  const groups = new Map<string, MirrorGroup>();
  const resolveFailures: ReconcileMirrorModeFailure[] = [];
  for (const b of buildings) {
    try {
      const stockIff = readVfs(b.buildingTemplateVfsPath);
      const stockIlfVfs = readInteriorLayoutFileName(stockIff);
      if (!stockIlfVfs) {
        resolveFailures.push({
          buildingId: b.buildingId,
          diskState: 'unchanged',
          error: `decorationPersist: ${b.buildingTemplateVfsPath} has no interiorLayoutFileName`,
        });
        continue;
      }
      const sourceBytes = fs.readFileSync(b.editedIlfPath);
      const existing = groups.get(stockIlfVfs);
      if (existing) {
        existing.buildingIds.push(b.buildingId);
        existing.sourceBytes = sourceBytes; // last writer wins, by scan order
      } else {
        groups.set(stockIlfVfs, { mirrorPath: stockIlfVfs, buildingIds: [b.buildingId], sourceBytes });
      }
    } catch (e) {
      resolveFailures.push({ buildingId: b.buildingId, diskState: 'unchanged', error: (e as Error).message });
    }
  }
  if (resolveFailures.length > 0) return { failures: resolveFailures };

  // ── Phase 2b: apply — write/delete DISTINCT mirror paths, rollback on a mid-pass throw ─────
  const applied: AppliedEntry[] = [];
  let thrown: { mirrorPath: string; buildingIds: string[]; error: string } | null = null;

  for (const group of groups.values()) {
    const absPath = path.join(overrideDir, group.mirrorPath);
    try {
      const exists = fs.existsSync(absPath);
      if (nextValue === true && !exists) {
        writeStockMirror({ overrideDir }, group.mirrorPath, group.sourceBytes);
        applied.push({ mirrorPath: group.mirrorPath, buildingIds: group.buildingIds, action: 'wrote' });
      } else if (nextValue === false && exists) {
        // (ROUND 5, V4) Read the mirror's CURRENT bytes BEFORE unlinking — never derive them from
        // any building's editedIlfBytes (the file's actual content may belong to whichever
        // building in this group persisted LAST, which this call cannot assume).
        const preBytes = fs.readFileSync(absPath);
        removeStockMirror({ overrideDir }, group.mirrorPath);
        applied.push({ mirrorPath: group.mirrorPath, buildingIds: group.buildingIds, action: 'deleted', preBytes });
      }
      // else: already in the target state for this pass — nothing to do for this path.
    } catch (e) {
      thrown = { mirrorPath: group.mirrorPath, buildingIds: group.buildingIds, error: (e as Error).message };
      break; // STOP processing any further paths immediately.
    }
  }

  if (thrown !== null) {
    // Roll back every entry already in `applied`, by its INVERSE operation, best-effort (a
    // rollback step that itself throws does not stop rolling back the REMAINING entries).
    const doubleFaulted = new Set<string>();
    for (const entry of [...applied].reverse()) {
      try {
        if (entry.action === 'wrote') {
          removeStockMirror({ overrideDir }, entry.mirrorPath);
        } else {
          writeStockMirror({ overrideDir }, entry.mirrorPath, entry.preBytes!);
        }
      } catch {
        doubleFaulted.add(entry.mirrorPath); // T-05.1-06d — accepted, disclosed residual.
      }
    }

    const failures: ReconcileMirrorModeFailure[] = [];
    for (const id of thrown.buildingIds) {
      failures.push({ buildingId: id, diskState: 'unchanged', error: thrown.error });
    }
    for (const entry of applied) {
      const diskState: 'unchanged' | 'uncertain' = doubleFaulted.has(entry.mirrorPath) ? 'uncertain' : 'unchanged';
      const error = diskState === 'uncertain'
        ? `rollback failed after a sibling mirror-path reconcile threw (double-fault) — disk state for this mirror cannot be proven`
        : `rolled back — a sibling mirror-path reconcile threw during this pass`;
      for (const id of entry.buildingIds) {
        failures.push({ buildingId: id, diskState, error });
      }
    }
    return { failures };
  }

  // Only when both phases complete with ZERO throws does the flag move (ROUND-3-REVIEW R6).
  updateWorkspaceMeta(studioDir, { mirrorToStockIlf: nextValue });
  return { failures: [] };
}
