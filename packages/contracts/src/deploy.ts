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
 * patch-prepend (default): add patch.tre at a free higher searchTree priority slot;
 *   retail files untouched; reset = remove cfg key + delete patch.
 * shadow-base (opt-in): copy the full client TRE base to a local shadow dir;
 *   apply patches over the shadow; real install stays pristine.
 *
 * Source: D-04-10.
 */
export type DeployModel = 'patch-prepend' | 'shadow-base';

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
