/**
 * packages/contracts/src/deploy.ts
 * Type definitions for Phase 4 client detection and deploy result (DEPLOY-02).
 *
 * No runtime code — types and const objects only.
 *
 * Source: D-04-09/10/12; CfgInsertionRecord shape from cfgActivator.ts.
 */

import type { CfgDeployRecord } from './changeset.js';

// ---------------------------------------------------------------------------
// Client detection
// ---------------------------------------------------------------------------

/**
 * A detected SWG client installation.
 *
 * Source: D-04-09; clientLocator.ts (new component, not in live-inject).
 */
export interface DetectedClient {
  /** Human-readable install name, e.g. "SWG Infinity". */
  name: string;
  /** Absolute path to the client install root. */
  installPath: string;
  /** Absolute path to the root cfg file (swgemu.cfg) — .include chain root. */
  cfgRootPath: string;
  /** TRE version string confirmed from the first archive's header bytes. */
  treVersion: string;
}

// ---------------------------------------------------------------------------
// Deploy model
// ---------------------------------------------------------------------------

/**
 * The isolation model chosen for this workspace.
 *
 * absolute-path (default, D-05): write the absolute path to the built .tre in .studio/build/
 *   directly as the searchTree value — no copy to Live/ needed; retail files untouched.
 *   UAT item: whether TreeFile.cpp accepts absolute paths is unverified (client UAT step 5).
 * hardlink-shadow (opt-in): hardlink (NTFS fs.link) the full client TRE base to a local
 *   shadow dir; apply patches over the shadow; ~0 extra disk for same-volume hardlinks.
 *   Falls back to copyFile (EXDEV cross-device) and shows disk estimate when cross-volume.
 *
 * Legacy names (pre-04.1-07, preserved for backward compat):
 *   'patch-prepend' = absolute-path predecessor (relative patchName wrote to Live/)
 *   'shadow-base'   = hardlink-shadow predecessor (always used copyFile)
 *
 * Source: D-04-10, D-05 (absolute-path default), DEPLOY-06 (hardlink).
 */
export type DeployModel = 'absolute-path' | 'hardlink-shadow' | 'patch-prepend' | 'shadow-base';

// ---------------------------------------------------------------------------
// CfgInsertionRecord
// ---------------------------------------------------------------------------

/**
 * Record of a .cfg edit, returned by cfgActivator.activatePatch().
 * Used by deactivatePatch() and the Reset flow for clean rollback.
 * Also stored in SwgChangeset.deployRecord (via CfgDeployRecord) for
 * cross-session reset.
 *
 * Source: D-04-12; R2-B7 fix (patchPath required for fs.unlinkSync on reset).
 */
export interface CfgInsertionRecord {
  /** Absolute path to the toolkit-owned .cfg file written by activatePatch(). */
  cfgPath: string;
  /** Absolute path to the client root .cfg that .include's swgtoolkit.cfg. */
  includeTargetPath: string;
  /** Key name inserted, e.g. "searchTree_00_55". */
  keyName: string;
  /** Numeric priority slot used. */
  slot: number;
  /** Absolute path to the .swgtoolkit.bak backup made before editing. */
  backupPath: string;
  /** Human-readable patch archive name (e.g. "swgtoolkit_mymod.tre"). */
  patchName: string;
  /**
   * Absolute path to the deployed .tre file in the client Live/ dir.
   * Required for Reset to call fs.unlinkSync on the correct file (R2-B7 fix).
   */
  patchPath?: string;
}

// ---------------------------------------------------------------------------
// DeployResult
// ---------------------------------------------------------------------------

/**
 * Result of a deploy attempt (build + activate).
 *
 * ok: true  — both build and cfg activation succeeded; insertionRecord contains
 *             details for Reset/rollback (cfgPath, key, backup, patchPath).
 * ok: false — build or activation failed; cfgRestored indicates whether the
 *             original .cfg was restored from backup.
 *
 * Source: D-04-12; DeployResult discriminated union.
 */
export type DeployResult =
  | { ok: true; insertionRecord: CfgDeployRecord }
  | { ok: false; step: 'build' | 'activate'; reason: string; cfgRestored: boolean };
