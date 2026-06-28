/**
 * packages/renderer/src/services/projectList.ts
 * Enumerate known projects for the in-app "Open Project" dialog (slice 3).
 *
 * Projects are the umbrella folders under the app project store (…/swg-toolkit/projects/
 * <name>); each has tracking in …/swg-toolkit/studios/<name>/workspace.json. We read the
 * store directly (NOT recents) so every project shows, and the reopen key is the project
 * folder handed to openWorkspace().
 */

import path from 'path';
import { getDefaultProjectsDir, getStudioDir } from './workspaceService';
import type { WorkspaceBindingMeta } from '@swg/contracts';

// Path B fs (nodeIntegration:true) — never bundled by Vite.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as typeof import('fs');

export interface ProjectListEntry {
  /** Display name (umbrella). */
  projectName:   string;
  /** Absolute project folder — the reopen key passed to openWorkspace(). */
  projectFolder: string;
  /** Target kind: client (deployable) / tre-set (standalone) / mod-project (no target). */
  kind:          WorkspaceBindingMeta['kind'];
  /** Bound client label (when kind === 'client'). */
  clientName?:   string;
}

/** List every project in the app project store, sorted by name. Never throws. */
export function listProjects(): ProjectListEntry[] {
  try {
    const root = getDefaultProjectsDir();
    if (!fs.existsSync(root)) return [];
    const out: ProjectListEntry[] = [];
    for (const name of fs.readdirSync(root)) {
      const projectFolder = path.join(root, name);
      try {
        if (!fs.statSync(projectFolder).isDirectory()) continue;
        const wjson = path.join(getStudioDir(projectFolder), 'workspace.json');
        if (!fs.existsSync(wjson)) continue; // a folder without a studio is not a project
        const meta = JSON.parse(fs.readFileSync(wjson, 'utf8')) as WorkspaceBindingMeta;
        out.push({
          projectName:   meta.projectName ?? name,
          projectFolder,
          kind:          meta.kind,
          clientName:    meta.kind === 'client'
            ? (meta.pattern ?? (meta.clientPath ? path.basename(meta.clientPath) : undefined))
            : undefined,
        });
      } catch {
        // skip a malformed / unreadable project dir
      }
    }
    return out.sort((a, b) => a.projectName.localeCompare(b.projectName));
  } catch {
    return [];
  }
}
