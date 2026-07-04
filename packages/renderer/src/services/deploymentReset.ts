/**
 * packages/renderer/src/services/deploymentReset.ts
 * Shared restore + artifact-cleanup dispatch for a deployed record (04.4-01 Task 2).
 *
 * Extracted VERBATIM from DeployDialog.tsx's handleReset (lines 660-711 as of 2026-07-03) so
 * DeployDialog.handleReset and deleteProject.ts call the SAME dispatch — never two parallel
 * reimplementations of "how to undo a deploy" that can drift out of sync.
 *
 * Record-shape dispatch (NOT the deployModel radio — see original handleReset comment):
 *   'overrideDir' in rec         → resetLoose (no cfg surgery, no .tre deletion)
 *   snapshotPath + rootCfgPath   → restoreCfg PRIMARY (whole-file byte-pristine restore, D-07/H5)
 *   'shadowDir'/'patchEntry' in rec (no snapshot) → resetShadow fallback (line-surgery)
 *   else (no snapshot)           → deactivatePatch fallback (line-surgery)
 *
 * cleanupArtifacts opt-out (round-2 fix, 04.4-01-PLAN.md):
 *   DeployDialog.handleReset calls this with NO opts → defaults to true → UNCHANGED behavior
 *   (toolkit cfg unlink + shadow dir rm / patchPath unlink, exactly as before extraction).
 *   deleteProject.ts calls this with { cleanupArtifacts: false } — these artifact files live
 *   INSIDE studioDir and must NOT be deleted before studioDir is parked into .trash; they
 *   travel into .trash intact as part of the whole-studioDir move instead.
 *
 * ROUND 3 fix (Codex consult, CONSULT-R3-codex.out): resetShadow's second argument is ITS
 * cleanup flag (shadowBaseService.ts:483 deletes shadowDir recursively when true) — it MUST
 * thread opts.cleanupArtifacts, not a hardcoded `true`, or a no-snapshot shadow record deletes
 * studioDir/shadow BEFORE the park, breaking byte-complete trash for delete's use case.
 *
 * Does NOT include the "clear persisted deploy record" bookkeeping (DeployDialog.tsx:713-727)
 * — that stays inline in DeployDialog.tsx, called AFTER this function returns, exactly where
 * it runs today. deleteProject.ts doesn't need it — the whole manifest is about to be parked.
 *
 * Source: 04.4-01-PLAN.md Task 2 Step 1; DeployDialog.tsx handleReset (verbatim extraction).
 */

import fs from 'fs';

import type { CfgDeployRecord, CfgInsertionRecord, LooseDeployRecord } from '@swg/contracts';
import { resetLoose } from './looseOverrideDeploy';
import { restoreCfg, deactivatePatch } from './cfgActivator';
import { resetShadow, type ShadowDeployRecord } from './shadowBaseService';

/**
 * Reset (undo) a deployment from its stored/in-memory record.
 *
 * @param rec                  The deploy record (shape varies — dispatch is by shape, not a
 *                              passed-in model discriminant).
 * @param rootCfgPathOverride  Preferred root cfg path (e.g. selectedClient?.cfgRootPath in
 *                              DeployDialog's live-session context); falls back to
 *                              rec.includeTargetPath when absent (deleteProject.ts's case —
 *                              no selectedClient in scope for a possibly-closed workspace).
 * @param opts.cleanupArtifacts  Whether to also delete studioDir-internal build artifacts
 *                              (shadow dir, toolkit cfg, built .tre). Default true — matches
 *                              DeployDialog.handleReset's pre-extraction behavior exactly.
 */
export function resetDeploymentFromRecord(
  rec: CfgDeployRecord | ShadowDeployRecord | LooseDeployRecord | CfgInsertionRecord,
  rootCfgPathOverride?: string,
  opts?: { cleanupArtifacts?: boolean },
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = rec as any;

  const isLooseRec = 'overrideDir' in r;
  const isShadowRec = 'shadowDir' in r || r.patchEntry !== undefined;

  if (isLooseRec) {
    // ── Loose-override reset ─────────────────────────────────────────────────
    // No cfg surgery, no .tre deletion — resetLoose restores (B3) or removes
    // only the files written by the prior deployLoose call.
    resetLoose(r as LooseDeployRecord);
    return;
  }

  const rootCfgPath = rootCfgPathOverride ?? (r.includeTargetPath as string | undefined);
  const snapPath: string | undefined = r.snapshotPath;

  if (snapPath && rootCfgPath && fs.existsSync(snapPath)) {
    // H5 PRIMARY: whole-file restore from snapshot — byte-pristine (D-07).
    // Removes .include + any maxSearchPriority bumps; client returns to stock cfg.
    restoreCfg(rootCfgPath, snapPath);
  } else if (isShadowRec) {
    // Fallback for shadow model without snapshot: line-surgery via resetShadow.
    // ROUND 3: thread opts.cleanupArtifacts (not hardcoded true) — a no-snapshot shadow
    // record must not delete studioDir/shadow before deleteProject parks it.
    resetShadow(r as ShadowDeployRecord, opts?.cleanupArtifacts ?? true);
  } else {
    // Fallback for absolute-path model without snapshot: line-surgery via deactivatePatch
    deactivatePatch(r as CfgInsertionRecord);
  }

  // Artifact cleanup — model-specific. Gated by opts.cleanupArtifacts (default true,
  // matching DeployDialog.handleReset's pre-extraction behavior exactly). deleteProject.ts
  // passes { cleanupArtifacts: false } — these files live INSIDE studioDir and must NOT be
  // deleted before studioDir is parked into .trash (round-2 fix).
  if (opts?.cleanupArtifacts ?? true) {
    if (isShadowRec) {
      // Remove toolkit cfg (client no longer reads it after root cfg restore)
      const toolkitCfgPath = r.cfgPath as string | undefined;
      if (toolkitCfgPath) {
        try { fs.unlinkSync(toolkitCfgPath); } catch { /* ignore — may already be gone */ }
      }
      // Clean up shadow dir (hardlinks; ~0 bytes for same-volume)
      const shadowRec = r as ShadowDeployRecord;
      if (shadowRec.shadowDir && fs.existsSync(shadowRec.shadowDir)) {
        try { fs.rmSync(shadowRec.shadowDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    } else {
      // Absolute-path: delete the deployed .tre from .studio/build/ if still there
      // (the studio copy stays as history; patchPath IS the studioDir path for absolute-path)
      if (r.patchPath) {
        try { fs.unlinkSync(r.patchPath); } catch { /* file may already be gone */ }
      }
    }
  }
}
