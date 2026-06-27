/**
 * packages/renderer/src/services/cfgActivator.ts
 * Safe .cfg patch activation and deactivation for the patch-prepend deploy model (DEPLOY-02).
 *
 * Exports:
 *   activatePatch(cfgPath, patchName, scan)  — inserts searchTree key at next free slot
 *   deactivatePatch(record)                  — W9 line surgery: removes ONLY the specific key
 *   ensureInclude(rootCfgPath, fileName)     — idempotent: adds .include to root cfg once
 *   + re-exports scanSharedFile, chooseSlot, SharedFileScan from clientLocator (CANONICAL)
 *
 * Fixes implemented:
 *   W9 — deactivatePatch uses TARGETED LINE SURGERY (replace the specific keyName= line)
 *         NOT a .bak file restore — restoring the backup would drop ALL keys written
 *         AFTER the backup was taken (including shadow-base keys from the other deploy model).
 *   Pitfall 4 — NEVER writes to launcher-managed cfg files; writes ONLY to toolkit-owned .cfg
 *   Pitfall 5 — BOM-free atomic writes (tmp + renameSync); preserve existing EOL
 *
 * N5 note: LAST-wins for maxSearchPriority is the responsibility of scanSharedFile
 * (canonical in clientLocator.ts, per ConfigFile.cpp:797). The caller passes the full-chain scan.
 *
 * IMPORTANT: cfgActivator.ts contains ZERO implementations of scanSharedFile or chooseSlot.
 * These are canonical in clientLocator.ts — re-exported here for convenience.
 *
 * Path B renderer: nodeIntegration:true, contextIsolation:false — fs/path usable directly.
 *
 * Source:
 *   04-03-PLAN.md Task 3; 04-CONTEXT.md §D-04-10/12; 04-RESEARCH.md §Pattern 2.
 *   swg-client-v2 ConfigFile.cpp:797 (LAST-wins maxSearchPriority — via scanSharedFile).
 *   swg-client-v2 TreeFile.cpp:90-191 (searchTree_<sku>_<priority>= key format).
 */

import fs from 'fs';
import path from 'path';

import type { CfgInsertionRecord } from '@swg/contracts';
import { chooseSlot as _chooseSlot } from './clientLocator';
import type { SharedFileScan } from './clientLocator';

// ─── Re-exports ───────────────────────────────────────────────────────────────

// Re-export the CANONICAL scanSharedFile + chooseSlot from clientLocator.
// cfgActivator NEVER re-implements these — zero duplicate implementations.
// LAST-wins for maxSearchPriority is implemented in scanSharedFile (ConfigFile.cpp:797).
export { scanSharedFile, chooseSlot } from './clientLocator';
export type { SharedFileScan } from './clientLocator';

// ─── ensureInclude ────────────────────────────────────────────────────────────

/**
 * Ensure a .include "fileName" line exists in the root cfg (idempotent).
 *
 * If the root cfg already contains the include filename, returns immediately (no change).
 * If not, appends the .include line at the end of the file.
 * Preserves existing EOL style; atomic BOM-free write.
 *
 * @param rootCfgPath    Absolute path to the client root cfg (e.g. swgemu.cfg).
 * @param includeFileName  Filename to include (e.g. 'swgtoolkit.cfg').
 */
export function ensureInclude(rootCfgPath: string, includeFileName: string): void {
  const existing = fs.readFileSync(rootCfgPath, 'utf8');

  // Idempotency check — already includes this file
  if (existing.includes(includeFileName)) return;

  // Detect and preserve existing EOL style
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';

  // Append the .include line at the end
  const newContent = existing.trimEnd() + eol + '.include "' + includeFileName + '"' + eol;

  // Atomic BOM-free write (Pitfall 5)
  const tmp = rootCfgPath + '.tmp';
  fs.writeFileSync(tmp, newContent, { encoding: 'utf8' });  // 'utf8' = no BOM
  fs.renameSync(tmp, rootCfgPath);
}

// ─── snapshotCfg ─────────────────────────────────────────────────────────────

/**
 * Capture the ROOT cfg (the file `ensureInclude` mutates — e.g. swgemu.cfg) into
 * `.studio/snapshots/<basename>.bak` BEFORE the first mutation.
 *
 * D-06/D-07 compliance:
 *   - Snapshot written into `.studio` (whitespace-free LOCALAPPDATA path, never into
 *     the client dir).
 *   - Idempotent per-deploy: if a snapshot already exists at the target path, it is NOT
 *     overwritten. This preserves the PRE-MUTATION (pristine) content across multiple
 *     deploys. A second deploy would write an already-mutated root cfg if we overwrote.
 *
 * `restoreCfg` with this path makes the client byte-pristine (removes .include + bumps).
 *
 * @param rootCfgPath  Absolute path to the ROOT cfg that `ensureInclude` mutates.
 * @param studioDir    Absolute path to the workspace's .studio/ directory.
 * @returns            Absolute path to the snapshot file.
 */
export function snapshotCfg(rootCfgPath: string, studioDir: string): string {
  const snapshotDir = path.join(studioDir, 'snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });

  const snapshotPath = path.join(snapshotDir, path.basename(rootCfgPath) + '.bak');

  // Idempotent: if the snapshot already exists, return its path WITHOUT overwriting.
  // The first snapshot captures the pristine pre-mutation content; subsequent calls
  // (e.g. a second deploy) must NOT overwrite it or the pristine backup is lost.
  if (fs.existsSync(snapshotPath)) {
    return snapshotPath;
  }

  // Copy the current ROOT cfg content as the snapshot (BOM-free, copyFileSync = byte-exact)
  fs.copyFileSync(rootCfgPath, snapshotPath);
  return snapshotPath;
}

// ─── restoreCfg ──────────────────────────────────────────────────────────────

/**
 * Whole-file restore of the ROOT cfg from its snapshot.
 *
 * D-07 primary Reset path:
 *   - Atomic tmp+rename write (Pitfall 5 — same pattern as cfgActivator atomic writes).
 *   - Restores the ROOT cfg to the EXACT bytes captured by `snapshotCfg` before the
 *     first mutation. This removes the `.include "swgtoolkit.cfg"` line AND any
 *     maxSearchPriority bumps written by activatePatch — the client becomes byte-pristine.
 *   - Does NOT perform line-surgery — the whole file is replaced, which is the safest
 *     approach (no risk of residual lines).
 *
 * @param rootCfgPath   Absolute path to the ROOT cfg to restore.
 * @param snapshotPath  Absolute path to the snapshot (from snapshotCfg).
 */
export function restoreCfg(rootCfgPath: string, snapshotPath: string): void {
  // Atomic tmp+rename — never leaves the cfg in a partial-write state
  const tmp = rootCfgPath + '.tmp';
  fs.copyFileSync(snapshotPath, tmp);
  fs.renameSync(tmp, rootCfgPath);
}

// ─── activatePatch ────────────────────────────────────────────────────────────

/**
 * Insert a searchTree key for the patch .tre into the toolkit-owned cfg.
 *
 * Protocol:
 *   1. Backup the cfg (copyFileSync → .swgtoolkit.bak) before any edit.
 *   2. Read existing content; detect EOL; choose free slot from full-chain scan.
 *   3. If slot > maxSearchPriority, prepend a maxSearchPriority bump block.
 *   4. Append [SharedFile] + searchTree_<sku>_<slot>=patchName block.
 *   5. Atomic BOM-free write (tmp + renameSync).
 *   6. Return CfgInsertionRecord for deactivatePatch / cross-session rollback.
 *
 * IMPORTANT: scan MUST come from scanSharedFile(client.cfgRootPath) — the client ROOT
 * cfg, NOT scanSharedFile(swgtoolkit.cfg alone). The caller (DeployDialog) is responsible
 * for passing the full-chain scan. LAST-wins for maxSearchPriority is in scanSharedFile.
 *
 * Pitfall 4: NEVER writes to launcher-managed cfg files; writes only to toolkit-owned .cfg.
 *
 * @param cfgPath    Absolute path to the toolkit-owned cfg (e.g. swgtoolkit.cfg).
 * @param patchName  Archive filename (e.g. 'swgtoolkit_mymod_a3f7.tre').
 * @param scan       Full-chain SharedFileScan from scanSharedFile(client.cfgRootPath).
 * @returns CfgInsertionRecord for clean deactivation / cross-session rollback.
 */
export function activatePatch(
  cfgPath: string,
  patchName: string,
  scan: SharedFileScan,
  studioSnapshotDir?: string,
): CfgInsertionRecord {
  // 1. Backup before ANY edit (T-04-11)
  // Write backup as safety net — deactivatePatch does NOT use this to restore (W9).
  // D-06/D-07: if studioSnapshotDir is provided, write backup into .studio/snapshots;
  // otherwise (legacy callers / tests without studioDir), write next to the cfg.
  let backupPath: string;
  if (studioSnapshotDir) {
    const snapDir = path.join(studioSnapshotDir, 'snapshots');
    fs.mkdirSync(snapDir, { recursive: true });
    backupPath = path.join(snapDir, path.basename(cfgPath) + '.swgtoolkit.bak');
  } else {
    backupPath = cfgPath + '.swgtoolkit.bak';
  }
  fs.writeFileSync(backupPath, fs.readFileSync(cfgPath));

  // 2. Read existing content + detect EOL
  const existing = fs.readFileSync(cfgPath, 'utf8');
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';

  // 3. Choose the free slot (delegates to canonical clientLocator.chooseSlot — N5: LAST-wins)
  const slot = _chooseSlot(scan);
  const key = 'searchTree' + scan.skuSuffix + slot;

  // 4. Idempotent [SharedFile] header — Pitfall 4 fix.
  // Only add [SharedFile] if the cfg does NOT already contain one. When called twice
  // (e.g. two consecutive deploys, or shadow-base + patch-prepend), the second call
  // must NOT add a second header — that causes "[SharedFile]\n[SharedFile]" which
  // ConfigFile.cpp parses as two sections, confusing the engine.
  const needsHeader = !existing.includes('[SharedFile]');

  let block = '';

  // If slot > maxSearchPriority, bump the limit so the engine will read our key.
  // (For Infinity with maxSearchPriority=60 and slot 55 this is not needed.)
  if (slot > scan.maxSearchPriority) {
    if (needsHeader) block += '[SharedFile]' + eol;
    block += '\tmaxSearchPriority=' + (slot + 5) + eol;
  }

  // Append the searchTree key block (with header only if needed)
  if (needsHeader) block += '[SharedFile]' + eol;
  block += '\t' + key + '=' + patchName + eol;

  const newContent = existing.trimEnd() + eol + block;

  // 5. Atomic BOM-free write (Pitfall 5)
  const tmp = cfgPath + '.tmp';
  fs.writeFileSync(tmp, newContent, { encoding: 'utf8' });  // 'utf8' = no BOM
  fs.renameSync(tmp, cfgPath);

  // 6. Return record for deactivatePatch and cross-session rollback (D-04-12)
  return {
    cfgPath,
    includeTargetPath: '',
    keyName: key,
    slot,
    backupPath,
    patchName,
  };
}

// ─── deactivatePatch ─────────────────────────────────────────────────────────

/**
 * Remove the specific searchTree key previously inserted by activatePatch.
 *
 * W9 FIX — LINE SURGERY:
 *   Removes ONLY the specific keyName= line from the cfg file.
 *   Does NOT restore the .swgtoolkit.bak backup file.
 *
 * WHY THIS MATTERS (W9):
 *   The old approach (writing the backup file back over the cfg) would drop ALL keys written AFTER
 *   the backup was taken. In a session where both deploy models are used (patch-prepend
 *   and shadow-base), the patch-prepend backup is taken BEFORE the shadow-base key is
 *   written. Restoring that backup would silently delete the shadow-base key — a nasty
 *   cross-model clobber. Line surgery removes ONLY our key, leaving everything else intact.
 *
 * The .swgtoolkit.bak is kept as a safety net but NOT used for deactivation (W9).
 *
 * @param record  CfgInsertionRecord returned by activatePatch().
 */
export function deactivatePatch(record: CfgInsertionRecord): void {
  const content = fs.readFileSync(record.cfgPath, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';

  // Escape the key name for use in a regex (handles special chars like $ + ?)
  const escapedKey = record.keyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match the keyName= line (with optional leading whitespace/tabs), using gm flag for line surgery
  const keyLinePattern = new RegExp('^[\\t ]*' + escapedKey + '\\s*=.*$', 'gm');

  // Remove the matched line(s), then collapse any resulting triple+ newlines to double
  const newContent = content
    .replace(keyLinePattern, '')
    .replace(/(\r?\n){3,}/g, eol + eol);

  // Atomic BOM-free write (Pitfall 5)
  const tmp = record.cfgPath + '.tmp';
  fs.writeFileSync(tmp, newContent, { encoding: 'utf8' });
  fs.renameSync(tmp, record.cfgPath);

  // NOTE: .swgtoolkit.bak is intentionally kept as a safety net but NOT used here (W9).
}
