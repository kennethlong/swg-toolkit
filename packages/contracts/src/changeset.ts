/**
 * packages/contracts/src/changeset.ts
 * Type definitions for Phase 4 versioning — GRAPH MODEL (DEPLOY-03).
 *
 * REFINED 2026-06-26: changesets form a GRAPH (not a flat array) via parentId.
 * The manifest uses string-based activeVersionId/deployedVersionId (NOT index-based).
 * FileDelta stores the actual changed-file ref per version.
 *
 * Destructive rollback engine and parallel snapshot system are EXPLICITLY ABSENT
 * (banned per D-04-08/13).
 *
 * No runtime code — types and const objects only.
 *
 * Source: D-04-05/07/08, REFINED 2026-06-26.
 */

import type { StagingAction } from './staging.js';

// ---------------------------------------------------------------------------
// FileDelta
// ---------------------------------------------------------------------------

/**
 * One changed-file record within a sealed version.
 *
 * Represents a DIFF-VS-PARENT: only files that changed vs the parent version.
 * NOT cumulative and NOT a full snapshot. flatten() reconstructs the full state
 * by walking root→N via parentId chain (D-04-07, R2-W3).
 *
 * Source: D-04-05, REFINED 2026-06-26.
 */
export interface FileDelta {
  /** Normalized VFS virtual path (archive-relative, forward-slashes). */
  virtualPath: string;
  /** What was done to this file in this version. */
  action: StagingAction;
  /**
   * Relative path within this changeset's files/ dir.
   * Example: 'appearance/player.apt'
   * Absent for delete-tombstones (action === 'delete').
   */
  storedFileRef?: string;
  /**
   * SHA-256 hex digest of the stored bytes.
   * Absent for delete-tombstones.
   */
  sha?: string;
}

// ---------------------------------------------------------------------------
// CfgDeployRecord
// ---------------------------------------------------------------------------

/**
 * Record of a successful patch-prepend deployment.
 * Stored in SwgChangeset.deployRecord when the version was deployed.
 * Used by cfgActivator.deactivatePatch() for clean rollback/reset.
 *
 * Source: D-04-12.
 */
export interface CfgDeployRecord {
  /** Absolute path to the toolkit-owned .cfg file (swgtoolkit.cfg). */
  cfgPath: string;
  /** Absolute path to the client root cfg that .include's swgtoolkit.cfg. */
  includeTargetPath: string;
  /** Key name inserted, e.g. "searchTree_00_55". */
  keyName: string;
  /** Numeric priority slot used, e.g. 55. */
  slot: number;
  /** Absolute path to the backup (.swgtoolkit.bak) made before editing. */
  backupPath: string;
  /** Absolute path to the deployed .tre file in the client Live/ dir. */
  patchPath: string;
  /** TRE version string the patch was built with — '5000' for live Infinity. */
  patchVersion: string;
}

// ---------------------------------------------------------------------------
// SwgChangeset
// ---------------------------------------------------------------------------

/**
 * One version node in the changeset history graph.
 *
 * parentId is what makes history a GRAPH — each version points to its parent,
 * enabling flatten() to walk root→N. Branching occurs when two versions share
 * the same parentId (edit-after-rollback: maintainer chose "keep both — branch
 * the history"; nothing is lost).
 *
 * deltas = DIFF-VS-PARENT only (not cumulative). flatten() reconstructs the
 * full deployed state by chaining root→N deltas in canonical (sorted) order.
 *
 * Source: D-04-05/07, REFINED 2026-06-26.
 */
export interface SwgChangeset {
  /** UUID v4 — stable identifier for this version node. */
  id: string;
  /**
   * UUID of the parent version node; null for the root version of a branch.
   * Enables flatten() to walk root→N for deploy/compare.
   */
  parentId: string | null;
  /** Human-readable description of this changeset. */
  label: string;
  /** ISO 8601 creation timestamp. */
  timestamp: string;
  /** What triggered the seal: explicit user "commit" or automatic on pack/deploy. */
  sealedBy: 'manual' | 'pack';
  /**
   * DIFF-VS-PARENT file deltas for this version.
   * Only files that changed vs flatten(parentId). NOT cumulative.
   * flatten() reconstructs full state by walking the DAG — R2-W3/D-04-07.
   */
  deltas: FileDelta[];
  /**
   * Present when this version was deployed via patch-prepend.
   * Undefined until the version is deployed.
   */
  deployRecord?: CfgDeployRecord;
}

// ---------------------------------------------------------------------------
// WorkspaceChangesetManifest
// ---------------------------------------------------------------------------

/**
 * Top-level manifest stored at .studio/changesets/manifest.json.
 *
 * activeVersionId: the version currently being EDITED — where the next
 * sealVersion() will attach as parentId. null = no versions yet.
 *
 * deployedVersionId: the version currently live in the client. null = nothing
 * deployed yet.
 *
 * changesets: ALL nodes in the history graph, never deleted (D-04-08
 * non-destructive). The UI greys rolled-back nodes but keeps them for redo.
 *
 * NOTE: Prior designs used a number-based index field — that approach is REPLACED
 * by string UUID fields (activeVersionId, deployedVersionId). Destructive rollback
 * engine and parallel snapshot system are BANNED per D-04-08/13.
 *
 * Source: D-04-08, REFINED 2026-06-26.
 */
export interface WorkspaceChangesetManifest {
  /**
   * ID of the version currently being edited (the "current" branch tip).
   * null = no versions exist yet.
   */
  activeVersionId: string | null;
  /**
   * ID of the version currently deployed to the client.
   * null = nothing deployed.
   */
  deployedVersionId: string | null;
  /**
   * All version nodes in the history graph.
   * Never deleted — rolled-back nodes are greyed in the UI and re-activatable.
   */
  changesets: SwgChangeset[];
}
