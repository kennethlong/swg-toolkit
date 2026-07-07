/**
 * packages/renderer/src/services/deleteProject.ts
 * Delete/restore/undo SERVICE layer for `delete-project-with-restore` (04.4-01 Task 2).
 *
 * deleteProject(projectFolder) restores the bound client to stock (via the SAME
 * resetDeploymentFromRecord dispatch DeployDialog.handleReset calls, with
 * { cleanupArtifacts: false } so studioDir's build artifacts travel into .trash intact —
 * round-2 fix), parks the project + full changeset history for session-scoped undo behind a
 * crash-safe completion-marker protocol (round-3), and NEVER hard-deletes anything.
 *
 * Store-independent: derives studioDir/manifest purely from projectFolder via
 * getStudioDir/readManifest — never via useWorkspaceStore.getState() (Pitfall 5). The ONLY
 * useWorkspaceStore reads are folderPath (to detect "is this the open project") and the
 * close() action (round-2: called BEFORE any filesystem rename, not after).
 *
 * Ordering (round-2 fix — the ordering itself is load-bearing, not incidental):
 *   1. Derive studioDir + manifest; find the carrier changeset's deployRecord.
 *   2. If a deployRecord exists, restore the client (non-fatal — collected into restoreErrors).
 *   3. If the deleted project IS the open workspace, close() it NOW — before any rename.
 *   4. Server-push orphan detection (read-only existence check; detection only, no remote I/O).
 *   5. Completion-marker park: move studioDir + umbrella folder into one entryDir; write
 *      `.complete.json` LAST, only if BOTH moves succeeded.
 *   6. removeRecentProject(projectFolder).
 *   7. Return { restoreErrors } for the UI (plan 10) to render the ⚠ toast variant.
 *
 * Source: 04.4-01-PLAN.md Task 2 Step 2 (round-1/2/3 revision notes).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { getStudioDir, getStudiosRoot, getDefaultProjectsDir } from './workspaceService';
import { readManifest } from './changesetService';
import { resetDeploymentFromRecord } from './deploymentReset';
import { isConfinedToRoot } from './pathSafety';
import { getRecentProjects, removeRecentProject } from './recentProjects';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useDeleteUndoStore, type TrashEntry } from '../state/deleteUndoStore';

/**
 * Delete a project: restore-first (client), then park (never hard-delete) for session-scoped
 * Undo.
 *
 * @param projectFolder  The umbrella project folder — the SAME value the caller already holds
 *                        (used verbatim; never reconstructed via basename + getDefaultProjectsDir,
 *                        which is the source of a prior verified bug — see plan revision notes).
 * @returns               `{ restoreErrors }` — non-fatal per-step failures, never thrown (D-05).
 */
export async function deleteProject(projectFolder: string): Promise<{ restoreErrors: string[] }> {
  const restoreErrors: string[] = [];

  // ── Step 1: derive studioDir + manifest (store-independent — Pitfall 5) ────────────────────
  const studioDir = getStudioDir(projectFolder);
  const manifest = readManifest(studioDir);
  const carrierId = manifest.deployedVersionId ?? manifest.activeVersionId;
  const carrier = carrierId ? manifest.changesets.find((c) => c.id === carrierId) : undefined;
  const deployRecord = carrier?.deployRecord;

  // ── Step 2: restore the client (cleanupArtifacts:false — round-2 fix) ──────────────────────
  if (deployRecord) {
    try {
      resetDeploymentFromRecord(deployRecord, undefined, { cleanupArtifacts: false });
    } catch (e) {
      restoreErrors.push(
        `Client restore failed: ${String((e as Error)?.message ?? e)}`,
      );
    }
  }

  // ── Step 3 (round-2 — moved earlier): release the workspace BEFORE any rename ──────────────
  if (useWorkspaceStore.getState().folderPath === projectFolder) {
    useWorkspaceStore.getState().close();
  }

  // ── Step 4 (round-2 — new): server-push orphan detection (read-only, no remote I/O) ─────────
  if (fs.existsSync(path.join(studioDir, 'serverPush.core3.json'))) {
    restoreErrors.push(
      'This project has a live Core3 server push — reset it in the Server Push panel before ' +
      'deleting, or the server will keep loading an orphaned override.',
    );
  }
  if (fs.existsSync(path.join(studioDir, 'serverPush.swgmain.json'))) {
    restoreErrors.push(
      'This project has a live swg-main server push — reset it in the Server Push panel before ' +
      'deleting, or the server will keep loading an orphaned override.',
    );
  }

  // ── Step 5 (round-3): completion-marker park ────────────────────────────────────────────────
  const sanitizedId = path.basename(projectFolder).replace(/[^A-Za-z0-9._-]/g, '_');
  const entryId = `${sanitizedId}-${crypto.randomUUID().slice(0, 8)}`;
  const entryDir = path.join(getStudiosRoot(), '.trash', entryId);

  // Round-2: confinement/recognition gate covers BOTH moves as one unit — an unrecognized,
  // unconfined projectFolder skips BOTH moves entirely (no entryDir created at all).
  const recognized =
    isConfinedToRoot(projectFolder, getDefaultProjectsDir()) ||
    getRecentProjects().some((r) => r.folderPath === projectFolder);

  if (!recognized) {
    restoreErrors.push(
      'Project folder is not confined to the toolkit project store and is not a recognized ' +
      `recent project — skipping park for safety: ${projectFolder}`,
    );
  } else {
    const trashStudioPath = path.join(entryDir, 'studio');
    const trashProjectPath = path.join(entryDir, 'project');

    let studioMoved = false;
    let projectMoved = false;

    try {
      fs.mkdirSync(entryDir, { recursive: true });
      fs.renameSync(studioDir, trashStudioPath);
      studioMoved = true;
    } catch (e) {
      restoreErrors.push(
        `Failed to park studio directory: ${String((e as Error)?.message ?? e)}`,
      );
    }

    try {
      fs.renameSync(projectFolder, trashProjectPath);
      projectMoved = true;
    } catch (e) {
      restoreErrors.push(
        `Failed to park project folder: ${String((e as Error)?.message ?? e)}`,
      );
    }

    if (studioMoved && projectMoved) {
      // ROUND 3: write the completion marker LAST, strictly after BOTH renames succeeded.
      // WR-04: the write itself is try/caught — a disk-full/permission error here must NOT
      // propagate (contract: non-fatal per-step failures, never thrown — D-05). On failure
      // we degrade to the same "no marker" state as a partial park: the entry is never
      // auto-purged and the delete still completes (undo entry pushed, recents row removed).
      const completeMarker = {
        deletedAt: new Date().toISOString(),
        projectName: path.basename(projectFolder),
        paths: { studio: trashStudioPath, project: trashProjectPath },
      };
      try {
        fs.writeFileSync(
          path.join(entryDir, '.complete.json'),
          JSON.stringify(completeMarker),
        );
      } catch (e) {
        restoreErrors.push(
          `Failed to write completion marker: ${String((e as Error)?.message ?? e)} — the ` +
          `entry at ${entryDir} will not be auto-purged and must be inspected manually.`,
        );
      }
    } else {
      restoreErrors.push(
        `Delete for "${path.basename(projectFolder)}" did not complete fully — the entry at ` +
        `${entryDir} was left WITHOUT a completion marker; it will not be auto-purged and ` +
        'must be inspected manually.',
      );
    }

    const trashEntry: TrashEntry = {
      id: entryId,
      projectName: path.basename(projectFolder),
      entryDir,
      trashStudioPath,
      trashProjectPath,
      originalStudioDir: studioDir,
      originalFolderPath: projectFolder,
      umbrellaMoveSkipped: false,
      restoreErrors: [...restoreErrors],
      parkedAtISO: new Date().toISOString(),
    };
    useDeleteUndoStore.getState().push(trashEntry);
  }

  // ── Step 6: symmetric to addRecentProject ───────────────────────────────────────────────────
  removeRecentProject(projectFolder);

  // ── Step 7 ───────────────────────────────────────────────────────────────────────────────────
  return { restoreErrors };
}
