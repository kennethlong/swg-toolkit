/**
 * packages/renderer/src/services/treAutoMount.ts
 * Shared auto-mount of a project's target TRE set — used by BOTH the initial bind
 * (initProject) and every reopen (openWorkspace), so the TRE browser is populated
 * whenever a project opens (not just when it's first created).
 *
 * Client targets mount in true client precedence (resolveClientMountOrder, verified vs
 * TreeFile.cpp); standalone targets fall back to a directory scan.
 */

import path from 'path';
import { resolveClientMountOrder } from './clientSearchOrder';
import { mountTrePaths } from './treMount';

// Path B fs (nodeIntegration:true) — never bundled by Vite.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as typeof import('fs');

export interface AutoMountParams {
  kind:     'client' | 'tre-set' | 'mod-project';
  /** Resolved client root cfg (for the searchTree order) — client only. */
  cfgPath?: string;
  /** Directory whose .tre files are mounted. */
  treDir?:  string;
  /** Install root that relative searchTree filenames resolve against (client only). */
  target:   string;
}

/**
 * Mount the project's target TRE set. Non-fatal: errors are logged, never thrown — a
 * workspace is still usable without a mount. No-op when there is no treDir.
 */
export async function autoMountTarget(params: AutoMountParams): Promise<void> {
  const { kind, cfgPath, treDir, target } = params;
  if (!treDir) return;
  try {
    let trePaths:   string[];
    let priorities: number[];

    // Client: mount the exact set + precedence the client loads (from the cfg searchTree).
    const order = kind === 'client' && cfgPath ? resolveClientMountOrder(cfgPath, target) : null;
    if (order) {
      ({ trePaths, priorities } = order);
    } else {
      // Standalone target (or a cfg with no searchTree): plain directory scan.
      // T-04.1-03: only .tre files directly in treDir (no sub-dirs / path injection).
      const treFiles = fs.readdirSync(treDir)
        .filter((f) => f.endsWith('.tre') && !f.includes('/') && !f.includes('\\'))
        .sort();  // ascending alphabetical = ascending priority
      if (treFiles.length === 0) return;
      trePaths   = treFiles.map((f) => path.join(treDir, f));
      priorities = treFiles.map((_, i) => i + 1);
    }

    await mountTrePaths(trePaths, priorities);
  } catch (err) {
    console.error('[autoMountTarget] mount failed:', err);
  }
}
