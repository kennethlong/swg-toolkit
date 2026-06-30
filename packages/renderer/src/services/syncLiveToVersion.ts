/**
 * packages/renderer/src/services/syncLiveToVersion.ts
 * Version reconcile service — Wave-0 contract stub (VER-02/VER-03).
 *
 * Exports the FINAL signature for the `syncLiveToVersion` engine; stub body
 * throws 'not implemented (W1-04)' until Wave-1 plan 04 implements it.
 *
 * Also exports `deployModelOf` — a fully-implemented discriminator that reads
 * the deploy model from a SwgChangeset.deployRecord shape.
 *
 * Downstream Wave-1 plans (06, 08, 09) import types from this module;
 * they can compile against it without the engine being live yet.
 *
 * Source: 04.3-02-PLAN.md Task 1; 04.3-RESEARCH.md § The new piece (syncLiveToVersion).
 */

import type {
  SwgChangeset,
  WorkspaceChangesetManifest,
  LooseDeployRecord,
  CfgDeployRecord,
} from '@swg/contracts';

// ---------------------------------------------------------------------------
// ReconcileCtx
// ---------------------------------------------------------------------------

/**
 * Context required to perform a live reconcile.
 *
 * cfgPath / installRoot are needed for the cfg-model path:
 *   resolveOverrideDir(cfgPath, installRoot) picks the loose dir (returns string|null —
 *   handle null at the call site: absent searchPath dirs are a no-client-configured state).
 */
export interface ReconcileCtx {
  /** Full workspace changeset manifest (all version nodes + live pointer). */
  manifest: WorkspaceChangesetManifest;
  /** Absolute path to the toolkit studio dir (studioDir). */
  studioDir: string;
  /**
   * Absolute path to the root client.cfg (needed by resolveOverrideDir and cfgActivator).
   */
  cfgPath: string;
  /** Absolute install root — resolveOverrideDir uses this for relative searchPath resolution. */
  installRoot: string;
  /**
   * Prior LooseDeployRecord to prune before writing new loose files.
   * deployLoose(entries, overrideDir, { priorRecord }) prunes this first (H2 invariant).
   * For a loose-live → Baseline revert, this is the record to call resetLoose on.
   */
  priorLiveLooseRecord?: LooseDeployRecord;
}

// ---------------------------------------------------------------------------
// LiveReconcileResult
// ---------------------------------------------------------------------------

/** Result returned by a successful syncLiveToVersion call. */
export interface LiveReconcileResult {
  /** The version ID now live after the reconcile (= targetId). */
  liveVersionId: string | null;
  /** Deploy model used for the reconcile operation. */
  model: 'loose' | 'cfg';
  /**
   * Deploy record written (absent when noop === true or for a Baseline restore
   * that only calls resetLoose without writing new files).
   */
  record?: LooseDeployRecord | CfgDeployRecord;
  /**
   * True when flatEqual detected no difference between the live set and the
   * target set — no filesystem writes were performed.
   */
  noop: boolean;
}

// ---------------------------------------------------------------------------
// deployModelOf
// ---------------------------------------------------------------------------

/**
 * Read the deploy model from a SwgChangeset.deployRecord shape.
 *
 * LooseDeployRecord carries `overrideDir` (string); CfgDeployRecord does not.
 * This duck-type discriminator is the single source of truth for route selection
 * inside syncLiveToVersion.
 *
 * Fully implemented — not a stub. deployRecord absent → 'cfg' (conservative fallback).
 */
export function deployModelOf(changeset: SwgChangeset): 'loose' | 'cfg' {
  if (changeset.deployRecord && 'overrideDir' in changeset.deployRecord) {
    return 'loose';
  }
  return 'cfg';
}

// ---------------------------------------------------------------------------
// syncLiveToVersion (STUB — Wave 0)
// ---------------------------------------------------------------------------

/**
 * Make the live client override set EQUAL to flatten(targetId).
 *
 * Covers forward-apply AND backward-revert in one diff-and-apply op:
 *   - Idempotent: flatEqual(live, target) → returns { noop: true }, no writes.
 *   - Baseline (targetId resolves to empty flatten) → full restore-to-stock:
 *       loose model → resetLoose(priorRecord) to remove override files (H4 revert-only).
 *       cfg model   → restoreCfg(rootCfgPath, snapshotPath).
 *   - Loose model: deployLoose(flatten(target), overrideDir, { priorRecord }).
 *   - Cfg model:   deactivatePatch(prior) then activatePatch(target build).
 *
 * STUB: throws 'not implemented (W1-04)' until Wave-1 plan 04 implements it.
 *
 * Source: 04.3-02-PLAN.md Task 1; 04.3-RESEARCH.md §syncLiveToVersion.
 */
export async function syncLiveToVersion(
  targetId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx: ReconcileCtx,
): Promise<LiveReconcileResult> {
  throw new Error('not implemented (W1-04)');
}
