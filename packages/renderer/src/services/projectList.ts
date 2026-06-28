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
import { getStudiosRoot, getDefaultProjectFolder } from './workspaceService';
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

/**
 * List every project, sorted by name. Reads the STUDIO store (the authoritative record —
 * each studios/<name>/workspace.json is a project), so a project shows even if its umbrella
 * projects/<name> folder is missing/empty. The reopen key is reconstructed from the project
 * name via getDefaultProjectFolder (openWorkspace recreates the folder if absent). Never throws.
 */
export function listProjects(): ProjectListEntry[] {
  try {
    const root = getStudiosRoot();
    if (!fs.existsSync(root)) return [];
    const out: ProjectListEntry[] = [];
    for (const dirName of fs.readdirSync(root)) {
      try {
        const wjson = path.join(root, dirName, 'workspace.json');
        if (!fs.existsSync(wjson)) continue; // a studio without a binding is not a project
        const meta = JSON.parse(fs.readFileSync(wjson, 'utf8')) as WorkspaceBindingMeta;
        const projectName = meta.projectName ?? dirName;
        out.push({
          projectName,
          projectFolder: getDefaultProjectFolder(projectName), // reopen key (openWorkspace remkdirs)
          kind:          meta.kind,
          clientName:    meta.kind === 'client'
            ? (meta.pattern ?? (meta.clientPath ? path.basename(meta.clientPath) : undefined))
            : undefined,
        });
      } catch {
        // skip a malformed / unreadable studio dir
      }
    }
    return out.sort((a, b) => a.projectName.localeCompare(b.projectName));
  } catch {
    return [];
  }
}
