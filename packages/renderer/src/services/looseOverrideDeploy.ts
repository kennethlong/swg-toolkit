/**
 * packages/renderer/src/services/looseOverrideDeploy.ts
 * Loose-file override deploy service (DEPLOY-08, Plan 04.2-04).
 *
 * Provides three exports:
 *   resolveOverrideDir — picks the max-priority searchPath from the cfg chain
 *   deployLoose        — writes staged entries atomically into the override dir
 *                        (B3 snapshot pre-existing, H2 prune prior record,
 *                         MED path-safety, skippedDeletes for delete-action)
 *   resetLoose         — restores (B3) or removes (non-preExisted) files written
 *                        by a prior deployLoose call
 *
 * Do NOT import other deploy services (the TRE/cfg pipeline modules).
 * This is a new, independent deploy branch that writes directly into the client's
 * highest-priority searchPath dir — no .cfg surgery, no TRE pack.
 *
 * Override-dir guard (looseDirPriorities[0] > maxPriority) lives in Plan 05
 * handleDeploy — deployLoose has no cfg context to perform this check.
 *
 * Source: 04.2-04-PLAN.md; 04.2-PATTERNS.md §looseOverrideDeploy.ts;
 *         04.2-RESEARCH.md §Capability 3; T-04.2-01 / T-04.2-02 / T-04.2-03.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { isVirtualPathSafe, isConfinedToRoot } from './pathSafety';
import { resolveClientMountOrder } from './clientSearchOrder';
import type { StagingEntry, LooseDeployRecord } from '@swg/contracts';

// ---------------------------------------------------------------------------
// resolveOverrideDir
// ---------------------------------------------------------------------------

/**
 * Returns the max-priority searchPath directory from the cfg chain, or null when
 * no searchPath entries are present.
 *
 * T-04.2-03: always picks looseDirs[0] (sorted priority DESC by Plan 02), so the
 * highest-priority dir is selected — deploying into a lower-priority dir would be
 * silently overridden by the client's file-system lookup order.
 *
 * @param cfgPath     Direct .cfg file path OR install directory.
 * @param installRoot Absolute install root for resolving relative searchTree values
 *                    (optional — defaults to the directory of cfgPath).
 */
export function resolveOverrideDir(cfgPath: string, installRoot?: string): string | null {
  const root = installRoot ?? path.dirname(path.resolve(cfgPath));
  const order = resolveClientMountOrder(cfgPath, root);
  return order?.looseDirs[0] ?? null;
}

// ---------------------------------------------------------------------------
// deployLoose
// ---------------------------------------------------------------------------

/**
 * Deploy staged entries atomically into the override directory.
 *
 * B3: pre-existing files are snapshotted before overwriting so resetLoose can
 *     RESTORE them (not delete them).
 * H2: when opts.priorRecord is present, resetLoose(priorRecord) is called BEFORE
 *     writing new files — prevents orphaned files from a prior deploy.
 * MED: 'delete' action entries are collected in skippedDeletes (cannot tombstone
 *     base-archive files via loose override); these are surfaced in DeployDialog.
 * T-04.2-01: virtualPath is validated by isVirtualPathSafe + isConfinedToRoot
 *     before any filesystem operation.
 *
 * @param entries     Staged file entries to deploy.
 * @param overrideDir Absolute path to the target override directory.
 * @param opts.studioDir   Toolkit studio dir — snapshot root is <studioDir>/snapshots/...
 *                         Defaults to os.tmpdir() when not supplied (e.g. in tests).
 * @param opts.priorRecord H2: if present, resetLoose(priorRecord) runs before writing.
 */
export function deployLoose(
  entries: StagingEntry[],
  overrideDir: string,
  opts?: {
    studioDir?: string;
    priorRecord?: LooseDeployRecord;
  },
): LooseDeployRecord {
  const studioDir = opts?.studioDir ?? os.tmpdir();

  // H2 prune: reset prior deploy before writing new files so no orphaned files remain.
  if (opts?.priorRecord) {
    resetLoose(opts.priorRecord);
  }

  const writtenFiles: LooseDeployRecord['writtenFiles'] = [];
  const skippedDeletes: string[] = [];

  for (const entry of entries) {
    // MED: 'delete' action — cannot tombstone base-archive files via loose override.
    // Record and skip; DeployDialog (Plan 05) renders a visible warning banner.
    if (entry.action === 'delete') {
      skippedDeletes.push(entry.virtualPath);
      continue;
    }

    // T-04.2-01: validate virtualPath before any fs operation.
    if (!isVirtualPathSafe(entry.virtualPath)) {
      throw new Error(
        'Invalid virtualPath: path traversal rejected — ' + entry.virtualPath,
      );
    }

    // Compute destination path using forward-slash normalization.
    const vpParts = entry.virtualPath.replace(/\\/g, '/').split('/');
    const destPath = path.join(overrideDir, ...vpParts);

    // T-04.2-01 (confinement): use trailing-sep form to prevent prefix-collision.
    // 'D:/override_evil/file' would pass a bare startsWith('D:/override') check.
    if (!isConfinedToRoot(destPath, overrideDir)) {
      throw new Error(
        'virtualPath escapes overrideDir: ' + entry.virtualPath,
      );
    }

    // Record whether the file pre-existed BEFORE any writes.
    const preExisted = fs.existsSync(destPath);

    // B3 snapshot: copy original bytes to snapshot location before overwriting.
    let snapshotPath: string | undefined;
    if (preExisted) {
      snapshotPath = path.join(studioDir, 'snapshots', ...vpParts);
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      fs.copyFileSync(destPath, snapshotPath);
    }

    // Read replacement bytes.
    if (!entry.replacementFilePath) {
      throw new Error(
        `Staged entry '${entry.virtualPath}' (${entry.action}) has no source file — replacementFilePath is required`,
      );
    }
    const data = fs.readFileSync(entry.replacementFilePath);

    // Atomic write: write to .tmp then rename (T-04.2-01, same pattern as deploy services).
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmp = destPath + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, destPath);

    writtenFiles.push({
      virtualPath: entry.virtualPath,
      destPath,
      preExisted,
      snapshotPath: preExisted ? snapshotPath : undefined,
    });
  }

  return { overrideDir, writtenFiles, skippedDeletes };
}

// ---------------------------------------------------------------------------
// resetLoose
// ---------------------------------------------------------------------------

/**
 * Undo a deployLoose operation.
 *
 * B3 restore: for files that pre-existed (preExisted===true), RESTORES the original
 *   bytes from snapshotPath (copyFileSync snapshot → destPath, then unlinkSync
 *   snapshot). Does NOT delete destPath for preExisted===true files.
 *
 * For non-pre-existing files (preExisted===false): deletes destPath. Best-effort
 * empty-dir cleanup with rmdirSync (non-fatal).
 *
 * Per-file errors are non-fatal (logged to console.error) for consistency with the
 * existing deploy-service error handling pattern.
 *
 * T-04.2-02: the preExisted===true branch MUST restore, not delete — sha256 of
 * the restored file must equal sha256 of the original bytes.
 */
export function resetLoose(record: LooseDeployRecord): void {
  for (const f of record.writtenFiles) {
    if (f.preExisted && f.snapshotPath) {
      // B3: RESTORE from snapshot — copy snapshot back to destPath, delete snapshot.
      try {
        fs.copyFileSync(f.snapshotPath, f.destPath);
        fs.unlinkSync(f.snapshotPath);
      } catch (e) {
        console.error('[resetLoose] restore failed:', f.destPath, e);
      }
    } else if (!f.preExisted) {
      // Non-pre-existing file: delete it.
      try {
        fs.unlinkSync(f.destPath);
      } catch {
        // Non-fatal — file may have already been removed.
      }
      // Best-effort: try to remove the now-empty parent directory.
      try {
        fs.rmdirSync(path.dirname(f.destPath));
      } catch {
        // Non-fatal — directory may not be empty or may not exist.
      }
    }
  }
}
