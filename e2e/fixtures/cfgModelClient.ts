/**
 * e2e/fixtures/cfgModelClient.ts
 * Minimal cfg-model client tree fixture (04.4-09 Task 3, D-06).
 *
 * Writes a minimal client install tree under a caller-supplied tmpRoot: a root swgemu.cfg
 * with a [SharedFile] section (maxSearchPriority + one searchTree entry) and an empty Live/
 * subdirectory. No real .tre bytes are needed — D-07's e2e scenario scope (boot / non-
 * workspace-folder UI feedback / new-project / stage / save-version / select-reconcile /
 * deploy / revert) only needs a parseable cfg chain for scanSharedFile / resolveClientMountOrder,
 * not real archive contents.
 *
 * NEVER writes to a real install — always builds under the caller's tmpRoot (D-06).
 *
 * Source: 04.4-09-PLAN.md Task 3; clientLocator.ts scanSharedFile (SharedFile section +
 * maxSearchPriority parsing); clientSearchOrder.ts parseSearchNodes (searchTree key format).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface CfgModelClientPaths {
  /** Absolute path to the fixture client install root (== tmpRoot). */
  installPath: string;
  /** Absolute path to the root swgemu.cfg (the .include chain root scanSharedFile expects). */
  cfgRootPath: string;
}

/**
 * Build a minimal cfg-model (searchTree) client fixture tree under tmpRoot.
 *
 * @param tmpRoot Caller-supplied, isolated tmp directory (e.g. an os.tmpdir()-based path
 *                created fresh per test run). Never a real install path.
 */
export function buildCfgModelClient(tmpRoot: string): CfgModelClientPaths {
  fs.mkdirSync(tmpRoot, { recursive: true });

  const liveDir = path.join(tmpRoot, 'Live');
  fs.mkdirSync(liveDir, { recursive: true });

  const cfgRootPath = path.join(tmpRoot, 'swgemu.cfg');
  const cfgContents = [
    '[SharedFile]',
    'maxSearchPriority=60',
    'searchTree_00_10=some_base.tre',
    '',
  ].join('\r\n');
  fs.writeFileSync(cfgRootPath, cfgContents, 'utf8');

  return {
    installPath: tmpRoot,
    cfgRootPath,
  };
}
