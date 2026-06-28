/**
 * packages/renderer/src/services/recentProjects.ts
 * Recently-opened projects, persisted to localStorage. Powers the first-run Welcome
 * "Recent projects" list (sketch 007-B variant B). Renderer-only; no native dependency.
 *
 * The `folderPath` is the exact path handed to initProject/openWorkspace (a client
 * install path for client-bound projects, or the project folder for mod-projects), so
 * clicking a recent re-opens it via openWorkspace(folderPath).
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
