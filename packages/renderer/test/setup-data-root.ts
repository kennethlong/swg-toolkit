/**
 * packages/renderer/test/setup-data-root.ts
 * Vitest setup — isolate toolkit data into a per-run temp dir.
 *
 * workspaceService resolves its studios/projects roots from SWG_TOOLKIT_DATA_ROOT (or
 * %LOCALAPPDATA%\swg-toolkit by default). Without this, unit tests that create/open
 * workspaces write real studio dirs into the user's actual %LOCALAPPDATA% store and
 * pollute it on every `npm test`. Pointing the root at an OS temp dir keeps tests
 * hermetic. appDataRoot() reads the env per-call, so this takes effect immediately.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';

if (!process.env['SWG_TOOLKIT_DATA_ROOT']) {
  process.env['SWG_TOOLKIT_DATA_ROOT'] = fs.mkdtempSync(
    path.join(os.tmpdir(), 'swg-toolkit-test-data-'),
  );
}
