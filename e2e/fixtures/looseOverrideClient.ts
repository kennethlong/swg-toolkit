/**
 * e2e/fixtures/looseOverrideClient.ts
 * Minimal loose-override (dev-client) client tree fixture (04.4-09 Task 3, D-06).
 *
 * Writes a minimal client.cfg with searchPath entries (mirroring the swg-client-v2
 * dev-client layout — a data/ loose dir referenced by the highest-priority searchPath line)
 * under a caller-supplied tmpRoot, with the override dir pre-created so
 * resolveOverrideDir/resolveClientMountOrder finds a real directory on disk.
 *
 * NEVER writes to a real install — always builds under the caller's tmpRoot (D-06).
 *
 * Source: 04.4-09-PLAN.md Task 3; clientSearchOrder.ts parseSearchNodes (searchPath key
 * format, quoted values); looseOverrideDeploy.ts resolveOverrideDir (picks looseDirs[0] —
 * the max-priority searchPath dir).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LooseOverrideClientPaths {
  /** Absolute path to the fixture client install root (== tmpRoot). */
  installPath: string;
  /** Absolute path to the fixture client.cfg. */
  cfgPath: string;
  /** Absolute path to the highest-priority searchPath dir (the loose-override deploy target). */
  overrideDir: string;
}

/**
 * Build a minimal loose-override (searchPath) dev-client fixture tree under tmpRoot.
 *
 * @param tmpRoot Caller-supplied, isolated tmp directory (e.g. an os.tmpdir()-based path
 *                created fresh per test run). Never a real install path.
 */
export function buildLooseOverrideClient(tmpRoot: string): LooseOverrideClientPaths {
  fs.mkdirSync(tmpRoot, { recursive: true });

  const overrideDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(overrideDir, { recursive: true });

  const cfgPath = path.join(tmpRoot, 'client.cfg');
  const cfgContents = [
    '[SharedFile]',
    'maxSearchPriority=60',
    `searchPath_00_10="${overrideDir}"`,
    '',
  ].join('\r\n');
  fs.writeFileSync(cfgPath, cfgContents, 'utf8');

  return {
    installPath: tmpRoot,
    cfgPath,
    overrideDir,
  };
}
