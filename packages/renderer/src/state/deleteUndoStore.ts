/**
 * packages/renderer/src/state/deleteUndoStore.ts
 * Session-scoped Zustand store tracking pending trash entries for Undo (04.4-01 Task 2).
 *
 * A "trash entry" is created by deleteProject.ts's completion-marker park protocol (round-3):
 * BOTH the studioDir and the umbrella project folder are moved into ONE entry directory,
 * `<studiosRoot>/.trash/<entryId>/{studio,project}`, and a `.complete.json` marker is written
 * LAST — strictly after both renames succeed. This store holds one TrashEntry per delete for
 * the lifetime of the CURRENT session (never persisted — a marked entry found on disk at the
 * START of a new session is by definition from a PRIOR session and is purge-eligible).
 *
 * restore(id): moves the parked bytes back to their EXACT original paths. Per the locked undo
 * contract (04.4-01-PLAN.md objective — identical in 04.4-10/14), this performs NO client/cfg
 * mutation — it moves project bytes only. Guards against an occupied destination (round-2):
 * throws a clearly-named error, performs NO rename, and leaves the entry in `pending` so a
 * retry is possible once the conflict is resolved.
 *
 * purgeStaleTrash(): removes ONLY entries carrying `.complete.json` (round-3 crash-window fix).
 * An entry without the marker (a crash interrupted a prior session's park mid-way) is left on
 * disk untouched and surfaced via a returned warning string naming its path — never silently
 * destroyed, never silently accumulated forever undetected.
 *
 * Source: 04.4-01-PLAN.md Task 2 (round-2/round-3 revision notes); viewportStore.ts (create<T>()
 * pattern mirrored here).
 */

import { create } from 'zustand';
import fs from 'fs';
import path from 'path';

import { getStudiosRoot } from '../services/workspaceService';

// ─── TrashEntry ────────────────────────────────────────────────────────────────

/**
 * One parked delete, tracked for the lifetime of the session that created it.
 *
 * `umbrellaMoveSkipped` is retained even though today's deleteProject.ts never sets it true
 * on its own (round-2's `recognized` gate covers BOTH moves as one unit — when unrecognized,
 * no entryDir is created at all, per Test G) — kept in the type so restore()'s defensive
 * guards keep their shape for any future caller that DOES skip only the umbrella move.
 */
export interface TrashEntry {
  /** Stable id for this trash entry (matches the `<entryId>` dir name under .trash/). */
  id: string;
  /** Display name of the deleted project (path.basename of the original folder). */
  projectName: string;
  /** Absolute path to `<studiosRoot>/.trash/<entryId>`. */
  entryDir: string;
  /** Absolute path to `<entryDir>/studio` — where studioDir was moved. */
  trashStudioPath: string;
  /** Absolute path to `<entryDir>/project` — where the umbrella folder was moved. */
  trashProjectPath: string;
  /** The EXACT original studioDir path (verbatim — never reconstructed). */
  originalStudioDir: string;
  /** The EXACT original umbrella project folder path (verbatim — never reconstructed). */
  originalFolderPath: string;
  /** True when the umbrella-folder move was skipped (defense-in-depth path only). */
  umbrellaMoveSkipped: boolean;
  /** Any non-fatal errors collected during the delete (client restore / park failures). */
  restoreErrors: string[];
  /** ISO timestamp of when this entry was parked. */
  parkedAtISO: string;
}

// ─── Store interface ───────────────────────────────────────────────────────────

export interface DeleteUndoStore {
  /** Trash entries pending Undo for the current session. */
  pending: TrashEntry[];

  /** Record a newly-parked delete. */
  push: (entry: TrashEntry) => void;

  /**
   * Undo a parked delete — moves the parked bytes back to their original paths.
   *
   * Throws a clearly-named Error (and performs NO rename) if either destination path is
   * already occupied (round-2 fix) — the entry remains in `pending` for a retry.
   * Makes NO client/cfg-side calls (locked undo contract) — project bytes only.
   */
  restore: (id: string) => void;

  /**
   * Purge trash entries left over from a PRIOR session (round-3: only those carrying a
   * `.complete.json` completion marker). Returns warnings naming any UNMARKED entry found —
   * those are left on disk untouched, never rmSync'd.
   */
  purgeStaleTrash: () => { warnings: string[] };
}

// ─── Store implementation ──────────────────────────────────────────────────────

export const useDeleteUndoStore = create<DeleteUndoStore>((set, get) => ({
  pending: [],

  push: (entry: TrashEntry) =>
    set((state) => ({ pending: [...state.pending, entry] })),

  restore: (id: string) => {
    const entry = get().pending.find((e) => e.id === id);
    if (!entry) return;

    // Round-2: occupied-destination guard — check BOTH destinations before touching anything.
    if (fs.existsSync(entry.originalStudioDir)) {
      throw new Error(
        `Cannot restore "${entry.projectName}" — ${entry.originalStudioDir} already exists; ` +
        'move or remove it, then retry Undo.',
      );
    }
    if (!entry.umbrellaMoveSkipped && fs.existsSync(entry.originalFolderPath)) {
      throw new Error(
        `Cannot restore "${entry.projectName}" — ${entry.originalFolderPath} already exists; ` +
        'move or remove it, then retry Undo.',
      );
    }

    // Both destinations are free — perform the restore. Locked undo contract: bytes only,
    // no client/cfg mutation.
    fs.renameSync(entry.trashStudioPath, entry.originalStudioDir);
    if (!entry.umbrellaMoveSkipped) {
      fs.renameSync(entry.trashProjectPath, entry.originalFolderPath);
    }

    // Round-3: clean up the now-empty entryDir (including the marker file, if one was
    // written) once both moves back succeed — a completed Undo leaves no stray directory.
    try {
      fs.rmSync(entry.entryDir, { recursive: true, force: true });
    } catch {
      // Best-effort — a failed cleanup of an already-empty dir is non-fatal.
    }

    set((state) => ({ pending: state.pending.filter((e) => e.id !== id) }));
  },

  purgeStaleTrash: () => {
    const warnings: string[] = [];
    const trashRoot = path.join(getStudiosRoot(), '.trash');

    if (!fs.existsSync(trashRoot)) {
      return { warnings };
    }

    let entryNames: string[];
    try {
      entryNames = fs.readdirSync(trashRoot);
    } catch {
      return { warnings };
    }

    for (const entryName of entryNames) {
      const entryDir = path.join(trashRoot, entryName);
      let isDir = false;
      try {
        isDir = fs.statSync(entryDir).isDirectory();
      } catch {
        continue; // entry vanished between readdir and stat — skip
      }
      if (!isDir) continue;

      const markerPath = path.join(entryDir, '.complete.json');
      if (fs.existsSync(markerPath)) {
        // Round-3: MARKED entry — provably complete from a prior session. Safe to purge
        // unconditionally (pending is always empty at the start of a new session, since
        // TrashEntry objects are never persisted).
        try {
          fs.rmSync(entryDir, { recursive: true, force: true });
        } catch {
          // Best-effort — a failed rmSync here is not fatal to the purge pass.
        }
      } else {
        // Round-3: UNMARKED entry — a crash likely interrupted a prior session's park
        // mid-way. Leave it on disk untouched; surface a warning naming its path.
        warnings.push(
          `Incomplete delete found from a prior session: ${entryDir} — this project was NOT ` +
          'fully parked (a crash likely interrupted the delete); inspect it manually before deleting.',
        );
      }
    }

    return { warnings };
  },
}));
