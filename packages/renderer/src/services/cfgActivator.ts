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
): CfgInsertionRecord {
  // 1. Backup before ANY edit (T-04-11)
  // Write backup as safety net — deactivatePatch does NOT use this to restore (W9).
  const backupPath = cfgPath + '.swgtoolkit.bak';
  fs.writeFileSync(backupPath, fs.readFileSync(cfgPath));

  // 2. Read existing content + detect EOL
  const existing = fs.readFileSync(cfgPath, 'utf8');
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';

  // 3. Choose the free slot (delegates to canonical clientLocator.chooseSlot — N5: LAST-wins)
  const slot = _chooseSlot(scan);
  const key = 'searchTree' + scan.skuSuffix + slot;

  // Build the new block to append
  let block = '';

  // If slot > maxSearchPriority, bump the limit so the engine will read our key.
  // (For Infinity with maxSearchPriority=60 and slot 55 this is not needed.)
  if (slot > scan.maxSearchPriority) {
    block += '[SharedFile]' + eol + '\tmaxSearchPriority=' + (slot + 5) + eol;
  }

  // Append the searchTree key block
  block += '[SharedFile]' + eol + '\t' + key + '=' + patchName + eol;

  const newContent = existing.trimEnd() + eol + block;

  // 4. Atomic BOM-free write (Pitfall 5)
  const tmp = cfgPath + '.tmp';
  fs.writeFileSync(tmp, newContent, { encoding: 'utf8' });  // 'utf8' = no BOM
  fs.renameSync(tmp, cfgPath);

  // 5. Return record for deactivatePatch and cross-session rollback (D-04-12)
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
