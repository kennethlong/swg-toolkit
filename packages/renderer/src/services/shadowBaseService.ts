/**
 * packages/renderer/src/services/shadowBaseService.ts
 * Shadow-base deploy model backend (D-04-10).
 *
 * Exports:
 *   ShadowDeployRecord                           — type returned by deployShadowBase
 *   estimateTreSize(liveDir)                     — sum *.tre file sizes in liveDir
 *   checkFreeDisk(targetDir, neededBytes)        — pre-flight disk space guard (T-04-SB-01)
 *   deployShadowBase(client, studioDir, patchPath, onProgress?) — async copy + cfg activation
 *   resetShadow(record, cleanup?)               — R2-W2 line-surgery cfg reset
 *   diffShadow(client, studioDir)               — compare Live/ vs shadow/ *.tre sets
 *
 * Fixes implemented (all cross-AI review items):
 *   B4  — deployShadowBase accepts patchPath; mounts patch at HIGHEST slot above all shadow
 *          entries (prior plan copied base TREs but never applied edits — zero mod coverage)
 *   B7  — async fs.promises.copyFile throughout (no sync I/O in the TRE copy loop)
 *          (prior plan used synchronous copy which blocks the renderer main thread for multi-GB copies)
 *   W4  — containment check uses path.relative(workspaceRoot, shadowDir).startsWith('..')
 *          NOT process.cwd().startsWith() which is wrong on Windows (mixed drive letters, case)
 *   W8  — catch block runs fs.rmSync(tmpShadowDir, {recursive:true, force:true}) to prevent
 *          orphaned partial dirs when deployShadowBase throws mid-copy
 *   R2-W1 — scanSharedFile(client.cfgRootPath) called ONCE at start; occupiedSlots maintained
 *             LOCALLY after each insert (never rescanning swgtoolkitCfgPath which lacks retail slots)
 *   R2-W2 — resetShadow removes ONLY the specific keyName= lines it inserted via line-surgery;
 *             NEVER restores from .shadow.bak wholesale (would drop unrelated keys)
 *
 * Security (STRIDE threat register — 04-06b-PLAN.md):
 *   T-04-SB-01 — disk exhaustion: checkFreeDisk aborts with clear message before any copy
 *   T-04-SB-02 — path escape: W4 guard throws before any mkdir
 *   T-04-SB-03 — partial copy: W8 catch block cleans up tmpShadowDir
 *   T-04-SB-04 — wrong backup restore: backupPath recorded from the cfg backup taken before shadow writes
 *
 * UAT NOTE — absolute paths in searchTree values (UNVERIFIED):
 *   The searchTree cfg values written here use ABSOLUTE PATHS to shadow TREs in .studio/shadow/.
 *   Whether TreeFile.cpp:115-149 accepts absolute paths is UNVERIFIED (absolute path UAT item —
 *   not confirmed from ground-truth source reading). If the client rejects them, Step 5/6 of the
 *   in-client UAT will surface 'could not open archive' errors referencing the shadow paths.
 *   A gap-closure plan would then add copy-to-client-subdir logic instead of absolute paths.
 *
 * Path B renderer: nodeIntegration:true, contextIsolation:false — fs/path usable directly.
 *
 * Source:
 *   04-06b-PLAN.md Task 1; 04-CONTEXT.md §D-04-10/12/15; 04-REVIEWS.md §B4/B7/W4/W8.
 *   swg-client-v2 TreeFile.cpp:90-191 (searchTree_<sku>_<priority>= key format).
 *   swg-client-v2 TreeFile.cpp:115-149 (absolute path UAT item — unverified for absolute paths).
 */

import * as fs from 'fs';
import * as path from 'path';

import { scanSharedFile, type SharedFileScan } from './clientLocator';
import { activatePatch } from './cfgActivator';
import type { DetectedClient } from '@swg/contracts';

// ─── ShadowDeployRecord ───────────────────────────────────────────────────────

/**
 * Record of a shadow-base deployment — returned by deployShadowBase().
 * Used by resetShadow() to remove ONLY the inserted cfg keys (R2-W2 line-surgery).
 *
 * DEFERRED (post-MVP): cross-session reset requires deserializing this type from
 * manifest.json. Within-session reset works since the live in-memory record is used.
 * Fix path: make SwgChangeset.deployRecord a discriminated union
 * (CfgDeployRecord | ShadowDeployRecord). See 04-CONTEXT.md §Deferred.
 */
export interface ShadowDeployRecord {
  /** Absolute path to the shadow dir (.studio/shadow/ inside the workspace). */
  shadowDir: string;
  /** Absolute path to the toolkit-owned cfg (swgtoolkit.cfg) that was modified. */
  cfgPath: string;
  /** Absolute path to the client root cfg (swgemu.cfg) — the .include chain root. */
  includeTargetPath: string;
  /** One entry per shadow TRE file copied and registered in the cfg. */
  shadowEntries: Array<{
    /** The searchTree key name inserted, e.g. "searchTree_00_55". */
    keyName: string;
    /** The numeric priority slot used. */
    slot: number;
    /** Absolute path to the shadow copy of the TRE in .studio/shadow/. */
    shadowTrePath: string;
    /** Original filename in Live/ (basename only). */
    originalTreName: string;
  }>;
  /**
   * B4: the patch entry mounted ABOVE all shadow entries (highest priority).
   * The patch .tre was built via packPatch(flatten(activeVersionId)) by DeployDialog
   * before calling deployShadowBase — this record simply tracks what was registered.
   */
  patchEntry: {
    /** The searchTree key name inserted for the patch .tre. */
    keyName: string;
    /** The numeric priority slot used (highest — above all shadow entries). */
    slot: number;
    /** Absolute path to the built patch .tre file. */
    patchPath: string;
  };
  /** Absolute path to client's Live/ dir (originals — never modified). */
  originalLiveDir: string;
  /** Absolute path to the .shadow.bak backup taken before shadow cfg writes (safety net only). */
  backupPath: string;
}

// ─── estimateTreSize ─────────────────────────────────────────────────────────

/**
 * Sum the sizes of all *.tre files in liveDir (in bytes).
 *
 * Used for the pre-flight disk space check before the TRE copy begins.
 * Throws a clear error if liveDir is unreadable.
 *
 * @param liveDir  Absolute path to the client's Live/ directory.
 * @returns        Total byte count of all *.tre files.
 */
export function estimateTreSize(liveDir: string): number {
  let files: string[];
  try {
    files = fs.readdirSync(liveDir).filter((f) => f.endsWith('.tre'));
  } catch {
    throw new Error('Cannot read client Live/ dir: ' + liveDir);
  }

  let total = 0;
  for (const f of files) {
    total += fs.statSync(path.join(liveDir, f)).size;
  }
  return total;
}

// ─── checkFreeDisk ────────────────────────────────────────────────────────────

/**
 * Assert sufficient free disk space at targetDir before the TRE copy begins.
 *
 * T-04-SB-01 mitigation: aborts with 'Not enough disk space: need Xmb, have Ymb'
 * before any file I/O if available bytes < neededBytes.
 *
 * Uses fs.statfsSync (Node 18+). Non-fatal if stats cannot be read — logs a warning
 * and continues (the copy attempt may still succeed or fail with a clearer OS error).
 *
 * @param targetDir    Directory to check free space for (must exist or be creatable).
 * @param neededBytes  Minimum required free bytes.
 */
export function checkFreeDisk(targetDir: string, neededBytes: number): void {
  try {
    // fs.statfsSync is available in Node 18+ (LTS baseline for this project).
    // Dynamic lookup via index access avoids type errors on older @types/node versions.
    const statfs = (fs as unknown as Record<string, unknown>)['statfsSync'] as
      | ((p: string) => { bavail: number; bsize: number })
      | undefined;

    if (typeof statfs !== 'function') {
      console.warn(
        '[shadowBaseService] checkFreeDisk: fs.statfsSync not available (requires Node 18+); skipping disk space check',
      );
      return;
    }

    // Resolve to the closest ancestor that exists (targetDir may not exist yet)
    let checkPath = targetDir;
    while (checkPath && !fs.existsSync(checkPath)) {
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;  // reached root
      checkPath = parent;
    }

    const stats = statfs(checkPath);
    const availableBytes = stats.bavail * stats.bsize;

    if (availableBytes < neededBytes) {
      throw new Error(
        'Not enough disk space: need ' +
          Math.ceil(neededBytes / 1048576) +
          'mb, have ' +
          Math.ceil(availableBytes / 1048576) +
          'mb',
      );
    }
  } catch (e) {
    // Re-throw our own disk-space error; swallow all others (non-fatal check failure)
    if ((e as Error).message?.startsWith('Not enough disk space')) {
      throw e;
    }
    console.warn('[shadowBaseService] checkFreeDisk: could not verify disk space (non-fatal):', e);
  }
}

// ─── deployShadowBase ─────────────────────────────────────────────────────────

/**
 * Copy the full client TRE base to .studio/shadow/ then mount the patch at the highest slot.
 *
 * B4 FIX: accepts patchPath (the already-built patch .tre from packPatch(flatten(activeVersionId))).
 * After writing all shadow TRE cfg entries, mounts the patch at the HIGHEST priority slot
 * (above all shadow entries) so mod edits take effect in the client. Without this, the
 * shadow-base mode only cloned the retail base — the user's edits were never applied.
 *
 * B7 FIX: all TRE copies use await fs.promises.copyFile (async). No sync copyFile in the
 * copy loop. The renderer main thread stays responsive during multi-GB TRE copies.
 *
 * W4 FIX: containment check uses path.relative(workspaceRoot, shadowDir).startsWith('..')
 * instead of process.cwd().startsWith() which fails on Windows with mixed drive letters
 * or case differences between the normalized and raw paths.
 *
 * W8 FIX: if the copy throws mid-way, the catch block removes the .tmp shadow dir so no
 * orphaned partial directories remain in the workspace.
 *
 * R2-W1 FIX: scanSharedFile(client.cfgRootPath) is called ONCE at the top.
 * After each activatePatch() call, the returned slot is appended to currentScan.occupiedSlots
 * LOCALLY — never rescanning swgtoolkitCfgPath (which lacks retail slots 30-54 and would
 * yield slot 1 — shadowed by retail, never loads).
 *
 * @param client       Detected SWG client (installPath, cfgRootPath etc.).
 * @param studioDir    Absolute path to the workspace's .studio/ directory.
 * @param patchPath    Absolute path to the already-built patch .tre (B4: required).
 * @param onProgress   Optional progress callback: 0.0→1.0 (copy=0-0.8, cfg=0.8-1.0).
 * @returns            ShadowDeployRecord for use by resetShadow() and cross-session audit.
 */
export async function deployShadowBase(
  client: DetectedClient,
  studioDir: string,
  patchPath: string,
  onProgress?: (pct: number) => void,
): Promise<ShadowDeployRecord> {
  // ── W4: Path validation (before ANY filesystem operations) ───────────────────
  // W4 FIX: use path.relative for containment — NOT process.cwd().startsWith()
  // which is wrong on Windows (case-insensitive paths, different drive letters).
  if (!path.isAbsolute(studioDir)) {
    throw new Error('studioDir must be an absolute path: ' + studioDir);
  }
  if (!path.isAbsolute(client.installPath)) {
    throw new Error('client.installPath must be an absolute path: ' + client.installPath);
  }

  const shadowDir = path.join(studioDir, 'shadow');
  const workspaceRoot = path.dirname(studioDir);

  // W4 FIX: path.relative containment guard — relToWorkspace must NOT start with '..'
  // (that would mean shadowDir escaped outside the workspace root).
  const relToWorkspace = path.relative(workspaceRoot, shadowDir);
  if (relToWorkspace.startsWith('..') || path.isAbsolute(relToWorkspace)) {
    throw new Error('shadowDir escapes workspace root (W4): ' + shadowDir);
  }

  // ── Resolve liveDir ──────────────────────────────────────────────────────────
  const liveDir = path.join(client.installPath, 'Live');

  // ── Defensive .gitignore check ───────────────────────────────────────────────
  // workspaceService (04-01 T3) already writes '.studio/shadow/' to .gitignore.
  // This is a defensive fallback for workspaces that predate that change.
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gi = fs.readFileSync(gitignorePath, 'utf8');
    if (!gi.includes('.studio/shadow/')) {
      fs.appendFileSync(gitignorePath, '\n.studio/shadow/\n');
    }
  }

  // ── Pre-flight disk space check (T-04-SB-01) ─────────────────────────────────
  const neededBytes = estimateTreSize(liveDir);
  checkFreeDisk(studioDir, neededBytes);

  // ── Atomic async copy to .tmp (B7: async — W8: cleanup on error) ─────────────
  const tmpShadowDir = shadowDir + '.tmp';
  let tmpCreated = false;

  try {
    await fs.promises.mkdir(tmpShadowDir, { recursive: true });
    tmpCreated = true;

    const treFiles = (await fs.promises.readdir(liveDir)).filter((f) => f.endsWith('.tre'));
    const total = treFiles.length;

    for (let i = 0; i < treFiles.length; i++) {
      const src = path.join(liveDir, treFiles[i]);
      const dst = path.join(tmpShadowDir, treFiles[i]);
      // B7 FIX: await fs.promises.copyFile — never blocks the renderer main thread
      await fs.promises.copyFile(src, dst);
      // Progress: TRE copy phase = first 80%
      onProgress?.((i + 1) / total * 0.8);
    }

    // Atomic promotion: remove old shadow dir (if any) then rename .tmp → shadow
    if (fs.existsSync(shadowDir)) {
      fs.rmSync(shadowDir, { recursive: true, force: true });
    }
    await fs.promises.rename(tmpShadowDir, shadowDir);
  } catch (e) {
    // W8 FIX: clean up orphaned .tmp dir if copy was interrupted mid-way
    if (tmpCreated && fs.existsSync(tmpShadowDir)) {
      fs.rmSync(tmpShadowDir, { recursive: true, force: true });
    }
    throw e;
  }

  // ── Write shadow cfg entries + B4 patch entry ─────────────────────────────────
  const cfgDir = path.dirname(client.cfgRootPath);
  const swgtoolkitCfgPath = path.join(cfgDir, 'swgtoolkit.cfg');

  // Create swgtoolkit.cfg if it doesn't exist yet
  if (!fs.existsSync(swgtoolkitCfgPath)) {
    fs.writeFileSync(swgtoolkitCfgPath, '[SharedFile]\n', { encoding: 'utf8' });
  }

  // Backup before any edits (T-04-SB-04 — safety net, NOT used for auto-restore per R2-W2)
  const backupPath = swgtoolkitCfgPath + '.shadow.bak';
  fs.copyFileSync(swgtoolkitCfgPath, backupPath);

  // R2-W1 FIX: scan the FULL .include chain ONCE via client.cfgRootPath (swgemu.cfg).
  // This discovers all retail slots (e.g. 30-54) so chooseSlot() inside activatePatch
  // returns 55, not 1. NEVER scan the toolkit cfg alone — it lacks
  // the retail slots and causes slot collision (slot 1 is BELOW retail → shadowed, no-load).
  const initialScan = scanSharedFile(client.cfgRootPath);

  // R2-W1: maintain occupiedSlots LOCALLY — do NOT rescan swgtoolkitCfgPath in the loop
  // (local slot increment prevents slot collision with retail entries 30-54).
  let currentScan: SharedFileScan = {
    ...initialScan,
    occupiedSlots: [...initialScan.occupiedSlots],
  };

  const shadowEntries: ShadowDeployRecord['shadowEntries'] = [];

  // Read shadow dir to get TRE list (same files as copied above)
  const shadowTreFiles = (await fs.promises.readdir(shadowDir)).filter((f) =>
    f.endsWith('.tre'),
  );

  for (let j = 0; j < shadowTreFiles.length; j++) {
    const shadowTrePath = path.join(shadowDir, shadowTreFiles[j]);

    // UAT NOTE: absolute path support in searchTree values is UNVERIFIED (absolute path
    // UAT item — TreeFile.cpp:115-149 did not clearly confirm absolute path acceptance).
    // If the client rejects absolute paths, Steps 5-6 of the in-client UAT will surface
    // 'could not open archive' errors referencing the shadow paths; gap-closure would add
    // copy-to-client-subdir logic in place of absolute paths.
    const record = activatePatch(swgtoolkitCfgPath, shadowTrePath, currentScan);

    shadowEntries.push({
      keyName: record.keyName,
      slot: record.slot,
      shadowTrePath,
      originalTreName: shadowTreFiles[j],
    });

    // R2-W1: local slot increment — append record.slot to occupiedSlots in-place.
    // NEVER rescan swgtoolkitCfgPath (it lacks retail slots 30-54 → collision at slot 1).
    currentScan = {
      ...currentScan,
      occupiedSlots: [...currentScan.occupiedSlots, record.slot],
    };

    // Progress: cfg write phase = 80% → 95%
    onProgress?.(0.8 + (j + 1) / shadowTreFiles.length * 0.15);
  }

  // B4 FIX: mount the patch .tre at the HIGHEST slot (above ALL shadow TRE entries).
  // packPatch(flatten(activeVersionId)) was already called by DeployDialog before this function.
  // Here we register the already-built patchPath in the cfg at the next free slot above shadow.
  // R2-W1: currentScan includes all shadow slots inserted above — chooseSlot picks the next free.
  const patchRecord = activatePatch(swgtoolkitCfgPath, patchPath, currentScan);
  const patchEntry: ShadowDeployRecord['patchEntry'] = {
    keyName: patchRecord.keyName,
    slot: patchRecord.slot,   // patch at highest slot = patch edits take effect (B4)
    patchPath,
  };

  onProgress?.(1.0);

  return {
    shadowDir,
    cfgPath: swgtoolkitCfgPath,
    includeTargetPath: client.cfgRootPath,
    shadowEntries,
    patchEntry,
    originalLiveDir: liveDir,
    backupPath,
  };
}

// ─── resetShadow ─────────────────────────────────────────────────────────────

/**
 * Remove ONLY the shadow TRE cfg entries and the patch entry added by deployShadowBase.
 *
 * R2-W2 FIX — TRUE LINE SURGERY:
 *   Reads the cfg, filters out ONLY the specific keyName= lines that were inserted
 *   at deploy time (shadowEntries[].keyName + patchEntry.keyName).
 *   Does NOT restore from .shadow.bak wholesale.
 *
 * WHY NOT RESTORE FROM BACKUP (R2-W2):
 *   The .shadow.bak was taken at the START of deployShadowBase, before any shadow keys
 *   were written. Restoring it would also DROP any other keys written to swgtoolkit.cfg
 *   AFTER the backup was taken (e.g. patch-prepend keys from the other deploy model,
 *   or keys the user manually added). Line surgery removes ONLY what we inserted.
 *
 * The .shadow.bak is retained as a safety net for manual recovery only — not auto-restored.
 *
 * @param record   ShadowDeployRecord returned by deployShadowBase().
 * @param cleanup  If true, also delete the shadow dir (default false — keep copies on disk).
 */
export function resetShadow(record: ShadowDeployRecord, cleanup = false): void {
  // R2-W2: collect the EXACT set of keyNames inserted at deploy time
  const keysToRemove = new Set<string>([
    ...record.shadowEntries.map((e) => e.keyName),
    record.patchEntry.keyName,
  ]);

  const cfgText = fs.readFileSync(record.cfgPath, 'utf8');

  // Detect and preserve existing EOL style
  const eol = cfgText.includes('\r\n') ? '\r\n' : '\n';

  // R2-W2: line-surgery — filter out ONLY lines whose trimmed start matches 'keyName='.
  // trimStart() handles leading tabs that cfgActivator.activatePatch writes before each key.
  // This is the same targeted-removal pattern as cfgActivator.deactivatePatch (W9), applied
  // in bulk to clear all shadow + patch entries in a single read-filter-write pass.
  const filtered = cfgText
    .split(/\r?\n/)
    .filter(
      (line) => ![...keysToRemove].some((key) => line.trimStart().startsWith(key + '=')),
    );

  // Atomic BOM-free write (Pitfall 5 — same convention as cfgActivator)
  const tmp = record.cfgPath + '.tmp';
  fs.writeFileSync(tmp, filtered.join(eol), { encoding: 'utf8' });
  fs.renameSync(tmp, record.cfgPath);

  // Optionally remove the shadow dir (cleanup=false by default — keep copies on disk)
  if (cleanup && fs.existsSync(record.shadowDir)) {
    fs.rmSync(record.shadowDir, { recursive: true, force: true });
  }

  // The .shadow.bak is intentionally retained as a safety net — NEVER auto-restored (R2-W2)
}

// ─── diffShadow ──────────────────────────────────────────────────────────────

/**
 * Compare *.tre files in the client's Live/ dir vs the shadow dir.
 *
 * Returns stale/missing arrays for UAT tooling to verify shadow completeness.
 * Does NOT throw on missing dirs — returns empty arrays if either dir is absent.
 *
 * @param client    Detected client (for installPath → Live/).
 * @param studioDir Absolute path to the workspace's .studio/ dir.
 * @returns         inShadow: files in shadow but not in Live/ (stale);
 *                  missingFromShadow: files in Live/ but not in shadow (needs re-copy).
 */
export function diffShadow(
  client: DetectedClient,
  studioDir: string,
): { inShadow: string[]; missingFromShadow: string[] } {
  const liveDir   = path.join(client.installPath, 'Live');
  const shadowDir = path.join(studioDir, 'shadow');

  const liveTres = new Set(
    fs.existsSync(liveDir)
      ? fs.readdirSync(liveDir).filter((f) => f.endsWith('.tre'))
      : [],
  );
  const shadowTres = new Set(
    fs.existsSync(shadowDir)
      ? fs.readdirSync(shadowDir).filter((f) => f.endsWith('.tre'))
      : [],
  );

  const inShadow          = [...shadowTres].filter((f) => !liveTres.has(f));
  const missingFromShadow = [...liveTres].filter((f) => !shadowTres.has(f));

  return { inShadow, missingFromShadow };
}
