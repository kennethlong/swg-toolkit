/**
 * packages/renderer/src/services/recentProjects.ts
 * Recently-opened projects, persisted to localStorage. Powers the first-run Welcome
 * "Recent projects" list (sketch 007-B variant B). Renderer-only; no native dependency.
 *
 * The `folderPath` is the exact path handed to initProject/openWorkspace — always the
 * toolkit-owned umbrella project folder under getDefaultProjectsDir() (see projectBinding.ts's
 * DECOUPLE refactor — the bound CLIENT install path is a separate field, `clientPath`, never
 * the reopen key). Corrected 2026-07-03 (04.4-01 Task 2): the prior comment predated the
 * 04.1-02 decouple and was stale.
 */

import type { WorkspaceInfo } from '@swg/contracts';

const RECENTS_KEY  = 'swg-recent-projects';
const MAX_RECENTS  = 8;

export interface RecentProject {
  /** Path passed to initProject/openWorkspace — the reopen key. */
  folderPath:    string;
  /** Display name (workspace basename). */
  name:          string;
  /** client | tre-set | mod-project. */
  kind:          WorkspaceInfo['kind'];
  /** Bound client label (when kind === 'client'). */
  clientName?:   string;
  /** ISO timestamp of the most recent open. */
  lastOpenedISO: string;
}

/** Read recents, most-recent first, capped. Never throws. */
export function getRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return (list as RecentProject[])
      .filter((r) => r && typeof r.folderPath === 'string' && typeof r.name === 'string')
      .sort((a, b) => (b.lastOpenedISO ?? '').localeCompare(a.lastOpenedISO ?? ''))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/**
 * Drop recents that fail the caller's `keep` predicate (e.g. project whose studio dir
 * no longer exists after a cleanup), persist the pruned list, and return it. Never throws.
 * The predicate is supplied by the caller so this module stays free of fs/workspaceService
 * (avoids a circular import).
 */
export function pruneRecentProjects(keep: (r: RecentProject) => boolean): RecentProject[] {
  const kept = getRecentProjects().filter((r) => {
    try { return keep(r); } catch { return false; }
  });
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(kept)); } catch { /* ignore */ }
  return kept;
}

/** Upsert a project into recents (dedup by folderPath, newest first). Never throws. */
export function addRecentProject(
  entry: Omit<RecentProject, 'lastOpenedISO'> & { lastOpenedISO?: string },
): void {
  try {
    const lastOpenedISO = entry.lastOpenedISO ?? new Date().toISOString();
    const rest = getRecentProjects().filter((r) => r.folderPath !== entry.folderPath);
    const next: RecentProject[] = [{ ...entry, lastOpenedISO }, ...rest].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (e.g. node-env test) — non-fatal.
  }
}

/**
 * Remove a project from recents by folderPath (symmetric to addRecentProject). Never throws.
 *
 * Called by deleteProject.ts after a successful delete so a parked/removed project no longer
 * appears in the Welcome "Recent projects" list.
 */
export function removeRecentProject(folderPath: string): void {
  try {
    const rest = getRecentProjects().filter((r) => r.folderPath !== folderPath);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(rest));
  } catch {
    // localStorage unavailable (e.g. node-env test) — non-fatal.
  }
}
