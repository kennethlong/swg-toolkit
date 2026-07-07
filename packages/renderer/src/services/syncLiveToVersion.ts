/**
 * packages/renderer/src/services/syncLiveToVersion.ts
 * Version reconcile engine — Wave-1 implementation (VER-02/VER-03/VER-04/VER-06/VER-09).
 *
 * Exports the FINAL signature for `syncLiveToVersion`, plus `deployModelOf` (always live)
 * and the ReconcileCtx / LiveReconcileResult types (consumed by downstream plans 06/07/08/09).
 *
 * Design (H4 — dispatch on the RIGHT model):
 *   - revertModel is determined from the LIVE version's stored deployRecord (not the target's).
 *   - applyModel is determined from the TARGET version's stored deployRecord.
 *   - Keeping them SEPARATE prevents loose-live→Baseline from calling restoreCfg instead of
 *     resetLoose (Baseline has no deployRecord → 'cfg' fallback → wrong path without H4).
 *
 * Source: 04.3-04-PLAN.md Task 1; 04.3-RESEARCH.md § Pillar A pseudocode + D-01–D-08.
 */

import path from 'path';

import type {
  SwgChangeset,
  WorkspaceChangesetManifest,
  LooseDeployRecord,
  CfgDeployRecord,
  CfgInsertionRecord,
} from '@swg/contracts';
import { BASELINE_ID } from '@swg/contracts';

import {
  flatten,
  flatEqual,
  setLiveVersion,
  updateChangesetDeployRecord,
} from './changesetService';

import { deployLoose, resetLoose, resolveOverrideDir } from './looseOverrideDeploy';

import { activatePatch, deactivatePatch, restoreCfg, scanSharedFile } from './cfgActivator';

import { useUndoStore } from '../state/undoStore';
import { log } from './logService';

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
  /**
   * 260703-bpu Task 1: absolute path to a patch the CALLER just built for THIS deploy
   * (e.g. DeployDialog's freshly-packed .studio/build/<patch>.tre). Takes priority over
   * any stored deployRecord.patchPath — covers the "no prior deployRecord yet" scenario
   * for a version that has never been deployed before (targetChangeset.deployRecord is
   * absent, so patchName would otherwise fall back to the 'patch.tre' placeholder).
   */
  freshPatchPath?: string;
  /**
   * 260703-bpu Task 1: absolute path to a root-cfg snapshot the CALLER just took for THIS
   * deploy (e.g. DeployDialog's snapshotCfg() call taken before ensureInclude mutates the
   * root cfg). Takes priority over any stored deployRecord.snapshotPath — same "no prior
   * deployRecord yet" scenario as freshPatchPath.
   */
  freshSnapshotPath?: string;
  /**
   * 04.4-13 fix (Rule 1 — bug, blocking): explicit caller hint for which model to APPLY
   * when the TARGET version has no prior deployRecord yet (i.e. its FIRST deploy). Without
   * this, `applyModel` falls back to `'cfg'` unconditionally for a never-deployed target
   * (there is no record to inspect for `'overrideDir' in deployRecord`), so choosing
   * "Loose override dir" in DeployDialog for a brand-new version silently deployed via the
   * cfg/absolute-path pipeline instead — which then threw `ENOENT` opening a non-existent
   * `swgtoolkit.cfg` (verified via this plan's own e2e spec: Scenario 2's first deploy of a
   * freshly-saved version, DeployDialog model radio set to "Loose override dir", failed with
   * exactly this error). Only consulted when the target has NO existing deployRecord — an
   * already-deployed target's OWN record remains authoritative (H4 contract unchanged for
   * re-navigation/re-deploy).
   */
  intendedApplyModel?: 'loose' | 'cfg';
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
// syncLiveToVersion
// ---------------------------------------------------------------------------

/**
 * Make the live client override set EQUAL to flatten(targetId).
 *
 * Covers forward-apply AND backward-revert in one diff-and-apply op (VER-02/03):
 *   - Idempotent: flatEqual(live, target) → returns { noop: true }, no writes.
 *   - Baseline (targetId resolves to empty flatten) → revert-only (restore-to-stock):
 *       loose live → resetLoose(priorRecord) removes the override files (H4).
 *       cfg live   → restoreCfg(cfgPath, snapshotPath) byte-pristine whole-file restore.
 *   - Loose apply: deployLoose(flatten(target), overrideDir, { priorRecord }).
 *     deployLoose internally calls resetLoose(priorRecord) (H2 prune), so the revert is
 *     embedded for the loose→loose case.
 *   - Cfg apply: deactivatePatch(live record) + deactivatePatch(target prior, idempotency)
 *     + activatePatch(target build).
 *
 * H4 contract: revertModel is dispatched from the LIVE version's deployRecord; applyModel
 * is dispatched from the TARGET version's deployRecord.  Conflating them breaks the
 * loose-live→Baseline path (Baseline has no record → 'cfg' → restoreCfg, but the live
 * files are loose → resetLoose is the correct call).
 *
 * Source: 04.3-04-PLAN.md Task 1; 04.3-RESEARCH.md § The new piece (syncLiveToVersion).
 */
export async function syncLiveToVersion(
  targetId: string | null,
  ctx: ReconcileCtx,
): Promise<LiveReconcileResult> {
  const { manifest, studioDir, cfgPath, installRoot, priorLiveLooseRecord, freshPatchPath, freshSnapshotPath } = ctx;

  // ─── Live version info ────────────────────────────────────────────────────
  const liveId = manifest.deployedVersionId;
  const liveChangeset: SwgChangeset | null = liveId
    ? (manifest.changesets.find(c => c.id === liveId) ?? null)
    : null;
  const liveDeployRecord = liveChangeset?.deployRecord;

  // H4: determine liveModel from the LIVE version's stored record (NOT the target's).
  // Fallback chain: live record → ctx.priorLiveLooseRecord presence → 'cfg' default.
  const liveModel: 'loose' | 'cfg' =
    liveDeployRecord && 'overrideDir' in liveDeployRecord
      ? 'loose'
      : priorLiveLooseRecord
      ? 'loose'
      : 'cfg';

  // WR-06: the loose record to REVERT with. ctx.priorLiveLooseRecord keeps priority when
  // supplied (the caller may hold a FRESHER record than the manifest snapshot — pinned by
  // syncLiveToVersion.test.ts case (f)); when the caller omits it, fall back to the live
  // changeset's OWN stored record (already resolved above — the manifest carries it).
  // Previously the two resetLoose sites below ran ONLY off ctx.priorLiveLooseRecord, so a
  // caller supplying the manifest but omitting the ctx field silently skipped the revert —
  // the client kept stale loose overrides while deployedVersionId moved on.
  const liveLooseRecord: LooseDeployRecord | undefined =
    priorLiveLooseRecord ??
    (liveDeployRecord && 'overrideDir' in liveDeployRecord
      ? (liveDeployRecord as LooseDeployRecord)
      : undefined);

  // ─── Compute entry sets ──────────────────────────────────────────────────
  const liveEntries = flatten(liveId, manifest, studioDir);
  const desired = flatten(targetId, manifest, studioDir);

  // ─── Noop fast path (flatEqual) ──────────────────────────────────────────
  // No FILE changes are needed (the live client already matches the target bytes), but the
  // SELECTION must still move the live/active pointer to the target — otherwise selecting a
  // version whose flattened bytes already equal the live set (e.g. Baseline when nothing is
  // deployed, or a sibling version with identical files) leaves activeVersionId on the
  // previously-saved version. Since sealVersion parents the next Save to activeVersionId,
  // that produced the "new version attaches to the wrong parent / doesn't branch" bug.
  // D-08 invariant: selected ≡ live — so move BOTH pointers via setLiveVersion.
  if (flatEqual(desired, liveEntries)) {
    if (manifest.activeVersionId !== targetId || manifest.deployedVersionId !== targetId) {
      setLiveVersion(targetId);
    }
    log('info', 'log', `Reconciled to version ${targetId} (${liveModel}, noop)`);
    return { noop: true, liveVersionId: targetId, model: liveModel };
  }

  // ─── Undo snapshot — BEFORE any mutation (D-06/VER-04) ───────────────────
  useUndoStore.getState().push({
    priorLiveVersionId: liveId,
    priorDeployRecord: liveDeployRecord,
    takenAt: new Date().toISOString(),
  });

  // ─── Apply model — from TARGET version (H4) ──────────────────────────────
  const targetChangeset: SwgChangeset | null =
    targetId && targetId !== BASELINE_ID
      ? (manifest.changesets.find(c => c.id === targetId) ?? null)
      : null;

  // 04.4-13 fix: when the target has an EXISTING deployRecord, that record remains
  // authoritative (H4 — re-navigating to an already-deployed version must reconcile via
  // whatever model it was ORIGINALLY deployed with). Only when the target has no record
  // yet (its first-ever deploy) does the caller's `intendedApplyModel` hint apply — this
  // is what lets DeployDialog's "Loose override dir" model choice actually take effect for
  // a brand-new version (previously always silently fell back to 'cfg' here — see the
  // ReconcileCtx.intendedApplyModel doc comment for the verified failure this fixes).
  const applyModel: 'loose' | 'cfg' =
    targetChangeset?.deployRecord && 'overrideDir' in targetChangeset.deployRecord
      ? 'loose'
      : targetChangeset?.deployRecord
      ? 'cfg'
      : (ctx.intendedApplyModel ?? 'cfg');

  // Baseline = desired is empty → revert-only (full restore-to-stock).
  const isBaseline = desired.length === 0;

  let newRecord: LooseDeployRecord | CfgDeployRecord | undefined;

  if (isBaseline) {
    // ─── REVERT ONLY — dispatch on liveModel (H4) ───────────────────────
    if (liveModel === 'loose') {
      // Loose-live → Baseline: resetLoose removes override files (H4 revert-only).
      // WR-06: liveLooseRecord falls back to the live changeset's own stored record.
      if (liveLooseRecord) {
        resetLoose(liveLooseRecord);
      }
    } else {
      // Cfg-live → Baseline: byte-pristine whole-file restore via snapshotPath.
      const liveCfgRecord = liveDeployRecord as CfgDeployRecord | undefined;
      if (liveCfgRecord?.snapshotPath) {
        // Primary: full restore from snapshot (D-07).
        // 04.4-13 fix (Rule 1 — bug, blocking): `liveCfgRecord.cfgPath` is the
        // TOOLKIT-OWNED cfg path (swgtoolkit.cfg — see CfgDeployRecord/CfgInsertionRecord
        // docs: "Absolute path to the toolkit-owned .cfg file written by activatePatch()").
        // `snapshotCfg` (called by DeployDialog before any mutation) snapshots the CLIENT
        // ROOT cfg (`selectedClient.cfgRootPath`), which is stored on the record as
        // `includeTargetPath` ("Absolute path to the client root .cfg that .include's
        // swgtoolkit.cfg"). Restoring into `.cfgPath` copied the client-root snapshot INTO
        // the toolkit cfg — the wrong file — leaving the real client root cfg's `.include`
        // line in place forever after a "revert to Baseline". Verified via this plan's own
        // e2e spec: after Deploy Baseline (revert to stock), the client cfg still contained
        // the `.include` line and `swgtoolkit.cfg` had been overwritten with client-root
        // cfg content instead. Fix: restore into `includeTargetPath` (the actual client
        // root cfg the snapshot was taken from), matching `snapshotCfg`'s source.
        restoreCfg(liveCfgRecord.includeTargetPath, liveCfgRecord.snapshotPath);
      } else if (liveCfgRecord) {
        // Fallback (legacy pre-04.1-07 records without snapshotPath): line surgery.
        deactivatePatch(liveCfgRecord as unknown as CfgInsertionRecord);
      }
    }
  } else {
    // ─── NON-BASELINE: REVERT live, then APPLY target ────────────────────
    const liveCfgRecord = liveDeployRecord as CfgDeployRecord | undefined;
    const targetCfgRecord = targetChangeset?.deployRecord as CfgDeployRecord | undefined;

    if (applyModel === 'loose') {
      // Loose apply: deployLoose handles the priorRecord revert internally (H2 prune).
      // For cfg→loose cross-model: deactivate the live cfg entry first.
      if (liveModel === 'cfg' && liveCfgRecord) {
        deactivatePatch(liveCfgRecord as unknown as CfgInsertionRecord);
      }

      const overrideDir = resolveOverrideDir(cfgPath, installRoot);
      if (!overrideDir) {
        throw new Error(
          'syncLiveToVersion: no override dir — client has no searchPath dirs configured (resolveOverrideDir returned null)',
        );
      }

      newRecord = deployLoose(desired, overrideDir, {
        studioDir,
        priorRecord: priorLiveLooseRecord,
      });
    } else {
      // Cfg apply.

      // Step 1: Deactivate the live version's cfg key (revert).
      if (liveCfgRecord) {
        deactivatePatch(liveCfgRecord as unknown as CfgInsertionRecord);
      }

      // Step 2: Deactivate the target's existing cfg key if different from live
      // (idempotency guard — target may have been deployed before with its own slot).
      if (targetCfgRecord && targetCfgRecord.keyName !== liveCfgRecord?.keyName) {
        deactivatePatch(targetCfgRecord as unknown as CfgInsertionRecord);
      }

      // Step 3: For loose→cfg cross-model: resetLoose the prior loose override.
      // WR-06: liveLooseRecord falls back to the live changeset's own stored record.
      if (liveModel === 'loose' && liveLooseRecord) {
        resetLoose(liveLooseRecord);
      }

      // Step 4: Activate the target cfg entry.
      // 260703-bpu Task 1: patchName precedence — ctx.freshPatchPath (caller just built this
      // patch for a version with no prior deployRecord) > targetCfgRecord.patchPath used
      // VERBATIM (NEVER path.basename() — the searchTree value must be the FULL absolute
      // path per the D-05 absolute-path model) > 'patch.tre' fallback only when neither exists.
      const toolkitCfgPath =
        targetCfgRecord?.cfgPath ?? path.join(studioDir, 'swgtoolkit.cfg');
      const scan = scanSharedFile(cfgPath);
      const patchName = freshPatchPath ?? targetCfgRecord?.patchPath ?? 'patch.tre';
      const insertionRecord = activatePatch(toolkitCfgPath, patchName, scan, studioDir);

      if (insertionRecord) {
        newRecord = {
          cfgPath: insertionRecord.cfgPath,
          // insertionRecord.includeTargetPath is always '' from activatePatch — the real
          // value the record needs is the client root cfg path, already on ctx (260703-bpu).
          includeTargetPath: cfgPath,
          keyName: insertionRecord.keyName,
          slot: insertionRecord.slot,
          backupPath: insertionRecord.backupPath,
          patchPath: freshPatchPath ?? targetCfgRecord?.patchPath ?? '',
          patchVersion: targetCfgRecord?.patchVersion ?? '5000',
          snapshotPath: freshSnapshotPath ?? targetCfgRecord?.snapshotPath,
        } as CfgDeployRecord;
      }
    }
  }

  // ─── Persist new record for the target (orphaned-file guard) ─────────────
  // updateChangesetDeployRecord stores the record so the next reconcile's
  // priorRecord is not stale. Not called for Baseline (no record to store).
  if (targetId && targetId !== BASELINE_ID && newRecord) {
    updateChangesetDeployRecord(targetId, newRecord);
  }

  // ─── Move the single live pointer atomically (D-08/VER-06) ───────────────
  setLiveVersion(targetId);

  const resultModel = isBaseline ? liveModel : applyModel;
  const fileCount =
    newRecord && 'writtenFiles' in newRecord ? newRecord.writtenFiles.length : desired.length;
  log('info', 'log', `Reconciled to version ${targetId} (${resultModel}, ${fileCount} files)`);

  return {
    noop: false,
    liveVersionId: targetId,
    model: resultModel,
    record: newRecord,
  };
}
