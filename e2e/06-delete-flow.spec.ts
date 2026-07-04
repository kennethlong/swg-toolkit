/**
 * e2e/06-delete-flow.spec.ts
 * D-09 delete-flow real-Electron coverage (04.4-14) — dedicated spec (NOT folded into the
 * general deploy-flow spec): delete -> confirm -> client-pristine assert -> undo -> restored,
 * against the fixture client trees built in 04.4-09, exercising the sketch-017 UI built in
 * 04.4-10.
 *
 * LOCKED UNDO CONTRACT (identical wording in 04.4-01/10/14 — this spec asserts EXACTLY this):
 * after Undo, the parked PROJECT (studio dir + umbrella folder + every changeset version
 * folder) is restored byte-for-byte and re-appears via `listProjects()`. The CLIENT/cfg is
 * NOT touched by Undo — it remains in whatever state the DELETE's restore step left it
 * (byte-pristine cfg / reverted loose files). This spec does NOT assert a re-deployed/
 * post-deploy cfg state after Undo — that would require Undo to re-deploy, which is
 * explicitly out of scope (see 04.4-01's objective).
 *
 * SEEDING STRATEGY (preferred per plan text — keeps this spec focused on delete rather than
 * re-driving the whole New-Project-wizard -> stage -> save -> Deploy UI a second time, which
 * e2e/07-deploy-flow.spec.ts (04.4-13) already covers): before launching Electron, this spec
 * seeds a studio dir + manifest + a deployRecord directly on disk via Node `fs` calls, so each
 * scenario starts from an ALREADY-DEPLOYED state. The on-disk layout mirrors
 * packages/renderer/src/services/workspaceService.ts's real path formulas EXACTLY (ground
 * truth — reproduced verbatim below, not guessed) so the seeded project is indistinguishable
 * from one the real New Project wizard would have created:
 *   studiosRoot  = <LOCALAPPDATA>/swg-toolkit/studios
 *   projectsRoot = <LOCALAPPDATA>/swg-toolkit/projects
 *   getDefaultProjectFolder(name) = projectsRoot/<sanitized name>
 *   getStudioDir(folderPath)      = studiosRoot/<basename(folderPath) with spaces -> _>
 *
 * Both fixture builders (buildCfgModelClient / buildLooseOverrideClient) and the
 * window.__testHooks surface (getChangesetManifest/listProjects/setStubPaths) are from
 * 04.4-09; the SWG_TEST_MODE launch pattern (env + early hooksPresent sanity assertion) and
 * console-error collector mirror e2e/07-deploy-flow.spec.ts (04.4-13) verbatim, per that
 * plan's own SUMMARY note that its patterns are the working ground truth for this plan.
 */

import { _electron as electron, test, expect } from '@playwright/test';
import type { ElectronApplication, Page, ConsoleMessage } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

import { buildCfgModelClient } from './fixtures/cfgModelClient';
import { buildLooseOverrideClient } from './fixtures/looseOverrideClient';
import type { CfgDeployRecord, LooseDeployRecord } from '@swg/contracts';

const REPO_ROOT = path.resolve(__dirname, '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_BINARY = require('electron') as string;

const BASELINE_ID = 'baseline';

// ─────────────────────────────────────────────────────────────────────────────
// Path formulas — reproduced VERBATIM from workspaceService.ts (ground truth,
// not guessed). Duplicated here (rather than imported) because workspaceService.ts
// pulls in zustand-store-coupled modules not meant to run outside the Electron
// renderer; e2e specs seed fixtures from the plain Node/Playwright test process
// (same pattern as e2e/07-deploy-flow.spec.ts's sha256File/makeTmpDir helpers).
// ─────────────────────────────────────────────────────────────────────────────

function appDataRoot(): string {
  return (
    process.env['SWG_TOOLKIT_DATA_ROOT'] ??
    path.join(process.env['LOCALAPPDATA'] ?? process.env['HOME'] ?? '.', 'swg-toolkit')
  );
}

function getStudiosRoot(): string {
  return path.join(appDataRoot(), 'studios');
}

function getDefaultProjectsDir(): string {
  return path.join(appDataRoot(), 'projects');
}

function getDefaultProjectFolder(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'New Project';
  return path.join(getDefaultProjectsDir(), safe);
}

function getStudioDir(folderPath: string): string {
  const projectId = path.basename(folderPath).replace(/\s+/g, '_');
  return path.join(getStudiosRoot(), projectId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic helpers
// ─────────────────────────────────────────────────────────────────────────────

function sha256Buf(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath: string): string {
  return sha256Buf(fs.readFileSync(filePath));
}

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Launch the app with SWG_TEST_MODE=1 (dialog stubbing + window.__testHooks) — 04.4-13 pattern. */
async function launchTestModeApp(): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: ELECTRON_BINARY,
    args: [REPO_ROOT, '--disable-gpu'],
    env: { ...process.env, SWG_TEST_MODE: '1' },
  });
}

async function getFirstWindow(app: ElectronApplication): Promise<Page> {
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

/** Attach a console/pageerror collector. Call BEFORE any interaction (D-10). */
function attachConsoleErrorCollector(win: Page): { errors: string[] } {
  const state = { errors: [] as string[] };
  win.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') state.errors.push(`[console.error] ${msg.text()}`);
  });
  win.on('pageerror', (err: Error) => {
    state.errors.push(`[pageerror] ${err.message}`);
  });
  return state;
}

/** Best-effort recursive cleanup of a seeded project's real on-disk paths — never throws. */
function cleanupProjectPaths(projectFolder: string, studioDir: string): void {
  for (const p of [projectFolder, studioDir]) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* best-effort only */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1 — cfg-model fixture (buildCfgModelClient)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('D-09 delete flow (Scenario 1: cfg-model fixture)', () => {
  test.describe.configure({ timeout: 180_000 });

  let app: ElectronApplication;
  let win: Page;
  let consoleState: { errors: string[] };

  let cfgRootPath: string;
  let pristineSha256: string;
  let projectFolder: string;
  let studioDir: string;
  let stagedFileAbsPath: string;
  let stagedSha256: string;
  const projectName = `E2E Delete Cfg Project ${Date.now()}`;
  const stagedVirtualPath = 'appearance/e2e_delete_test.iff';

  test.beforeAll(async () => {
    const tmpRoot = makeTmpDir('swg-toolkit-e2e-14-cfg-client-');
    const fixture = buildCfgModelClient(tmpRoot);
    cfgRootPath = fixture.cfgRootPath;

    // KNOWN PRISTINE baseline — captured from the fixture BEFORE any simulated deploy mutation.
    const pristineBytes = fs.readFileSync(cfgRootPath);
    pristineSha256 = sha256Buf(pristineBytes);

    projectFolder = getDefaultProjectFolder(projectName);
    studioDir = getStudioDir(projectFolder);
    fs.mkdirSync(projectFolder, { recursive: true });
    fs.mkdirSync(path.join(studioDir, 'snapshots'), { recursive: true });

    // Snapshot = the PRISTINE bytes (matches what cfgActivator.snapshotCfg captures BEFORE
    // the first mutation — the exact bytes restoreCfg copies back on delete/reset).
    const snapshotPath = path.join(studioDir, 'snapshots', path.basename(cfgRootPath) + '.bak');
    fs.writeFileSync(snapshotPath, pristineBytes);

    // Simulate the deployed (post-.include) mutation (mirrors cfgActivator.ensureInclude).
    const eol = pristineBytes.toString('utf8').includes('\r\n') ? '\r\n' : '\n';
    const deployedContent =
      pristineBytes.toString('utf8').trimEnd() + eol + '.include "swgtoolkit.cfg"' + eol;
    fs.writeFileSync(cfgRootPath, deployedContent, 'utf8');

    // Staged file for the "deployed" changeset (Version 2 — Baseline is changeset #1, D-06).
    const stagedBytes = Buffer.from('E2E delete-flow staged bytes (cfg-model, 04.4-14)');
    stagedSha256 = sha256Buf(stagedBytes);
    const csId = crypto.randomUUID();
    const csFilesDir = path.join(studioDir, 'changesets', csId, 'files', 'appearance');
    fs.mkdirSync(csFilesDir, { recursive: true });
    stagedFileAbsPath = path.join(csFilesDir, 'e2e_delete_test.iff');
    fs.writeFileSync(stagedFileAbsPath, stagedBytes);

    const deployRecord: CfgDeployRecord = {
      cfgPath: path.join(studioDir, 'swgtoolkit.cfg'),
      includeTargetPath: cfgRootPath,
      keyName: 'searchTree_00_55',
      slot: 55,
      backupPath: path.join(studioDir, 'snapshots', 'swgtoolkit.cfg.swgtoolkit.bak'),
      patchPath: path.join(studioDir, 'build', 'swgtoolkit_e2e14.tre'),
      patchVersion: '5000',
      snapshotPath,
    };

    const nowIso = new Date().toISOString();
    const manifest = {
      activeVersionId: csId,
      deployedVersionId: csId,
      changesets: [
        {
          id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)',
          timestamp: nowIso, sealedBy: 'manual', deltas: [],
        },
        {
          id: csId, parentId: BASELINE_ID, label: 'Version 2',
          timestamp: nowIso, sealedBy: 'manual',
          deltas: [{ virtualPath: stagedVirtualPath, action: 'add', storedFileRef: stagedVirtualPath, sha: stagedSha256 }],
          deployRecord,
        },
      ],
    };
    fs.mkdirSync(path.join(studioDir, 'changesets'), { recursive: true });
    fs.writeFileSync(
      path.join(studioDir, 'changesets', 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );

    fs.writeFileSync(
      path.join(studioDir, 'workspace.json'),
      JSON.stringify({ projectName, kind: 'client', clientPath: fixture.installPath, cfgPath: cfgRootPath }),
    );

    app = await launchTestModeApp();
    win = await getFirstWindow(app);
    consoleState = attachConsoleErrorCollector(win);

    const hooksPresent = await win.evaluate(() => (window as any).__testHooks !== undefined);
    expect(hooksPresent).toBe(true);
  });

  test.afterAll(async () => {
    await app?.close();
    cleanupProjectPaths(projectFolder, studioDir);
  });

  test('1. boots with zero console errors', async () => {
    await win.waitForTimeout(1500);
    expect(consoleState.errors, consoleState.errors.join('\n')).toEqual([]);
  });

  test('2. sanity: seeded fixture cfg is currently in its DEPLOYED (non-pristine) state', async () => {
    const currentBytes = fs.readFileSync(cfgRootPath);
    expect(sha256Buf(currentBytes)).not.toBe(pristineSha256);
    expect(currentBytes.toString('utf8')).toMatch(/\.include/i);
  });

  test('3. Open Project -> kebab -> Delete project… -> confirm modal shows the cfg-model plan line', async () => {
    await win.getByRole('button', { name: 'Open Project', exact: true }).click();
    await expect(win.getByRole('dialog', { name: 'Open Project' })).toBeVisible();

    await win.getByRole('button', { name: `Project actions for ${projectName}` }).click();
    await win.getByRole('menuitem', { name: /Delete project/ }).click();

    const modal = win.getByRole('dialog', { name: 'Delete project?' });
    await expect(modal).toBeVisible();
    // cfg-model plan line (DeleteProjectConfirmModal.tsx: rec present, no 'overrideDir').
    await expect(modal.getByText(/byte-pristine/i)).toBeVisible();
    await expect(modal.getByText('swgemu.cfg')).toBeVisible();
  });

  test('4. Delete -> toast appears -> client cfg is restored to the KNOWN PRISTINE baseline', async () => {
    await win.getByRole('button', { name: 'Delete project', exact: true }).click();

    await expect(win.getByRole('dialog', { name: 'Delete project?' })).not.toBeVisible({ timeout: 10_000 });
    await expect(win.getByTestId('delete-undo-toast')).toBeVisible();
    await expect(win.getByText(`${projectName}`).first()).toBeVisible();

    // Ground-truth restore assertion — Node fs/crypto in the TEST process, never trusting
    // only in-app state (T-04.4-23 mitigation).
    const restoredBytes = fs.readFileSync(cfgRootPath);
    expect(sha256Buf(restoredBytes)).toBe(pristineSha256);
    expect(restoredBytes.toString('utf8')).not.toMatch(/\.include/i);
  });

  test('5. deleted project is ABSENT from window.__testHooks.listProjects(); dimmed row visible', async () => {
    const projects = await win.evaluate(
      () => (window as any).__testHooks.listProjects() as Array<{ projectFolder: string }>,
    );
    expect(projects.some((p) => p.projectFolder === projectFolder)).toBe(false);

    // Sketch 017 element #15 — reactive dimmed row, visible WITHOUT closing/reopening the
    // still-open Open Project dialog (round-2 fix).
    await expect(win.getByText('deleted just now', { exact: false })).toBeVisible();
  });

  test('6. Undo on the toast -> post-restore toast (byte-for-byte, no re-deploy language)', async () => {
    await win.getByRole('button', { name: 'Undo delete' }).click();

    const toast = win.getByTestId('delete-undo-toast');
    await expect(toast).toBeVisible();
    await expect(toast.getByText('restored', { exact: false })).toBeVisible();
    await expect(toast.getByText(/byte-for-byte/i)).toBeVisible();
    // Locked undo contract: the restored-toast copy never mentions a re-deploy.
    const toastText = await toast.innerText();
    expect(toastText.toLowerCase()).not.toContain('deploy');

    // Dimmed row is gone; the project's normal row reappears in the SAME open dialog.
    await expect(win.getByText('deleted just now', { exact: false })).not.toBeVisible();
  });

  test('7. project reappears via listProjects(); every changeset version folder round-trips byte-for-byte', async () => {
    const projects = await win.evaluate(
      () => (window as any).__testHooks.listProjects() as Array<{ projectFolder: string }>,
    );
    expect(projects.some((p) => p.projectFolder === projectFolder)).toBe(true);

    // Ground truth (Node fs, TEST process): the studio dir + manifest + changeset file
    // round-tripped back to their EXACT original paths and bytes.
    expect(fs.existsSync(studioDir)).toBe(true);
    expect(fs.existsSync(projectFolder)).toBe(true);
    const restoredManifest = JSON.parse(
      fs.readFileSync(path.join(studioDir, 'changesets', 'manifest.json'), 'utf8'),
    );
    expect(restoredManifest.changesets).toHaveLength(2);
    expect(fs.existsSync(stagedFileAbsPath)).toBe(true);
    expect(sha256File(stagedFileAbsPath)).toBe(stagedSha256);
  });

  test('8. Undo restores PROJECT bytes only — the client cfg STILL matches the pristine baseline (no re-deploy)', async () => {
    const bytes = fs.readFileSync(cfgRootPath);
    expect(sha256Buf(bytes)).toBe(pristineSha256);
    expect(bytes.toString('utf8')).not.toMatch(/\.include/i);
  });

  test('9. zero console errors across the entire scenario', async () => {
    expect(consoleState.errors, consoleState.errors.join('\n')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 — loose-override fixture (buildLooseOverrideClient), condensed pass
// ─────────────────────────────────────────────────────────────────────────────

test.describe('D-09 delete flow (Scenario 2: loose-override fixture, condensed)', () => {
  test.describe.configure({ timeout: 180_000 });

  let app: ElectronApplication;
  let win: Page;
  let consoleState: { errors: string[] };

  let overrideDir: string;
  let preExistingFilePath: string;
  let preExistingPristineSha256: string;
  let toolkitAddedFilePath: string;
  let projectFolder: string;
  let studioDir: string;
  const projectName = `E2E Delete Loose Project ${Date.now()}`;

  test.beforeAll(async () => {
    const tmpRoot = makeTmpDir('swg-toolkit-e2e-14-loose-client-');
    const fixture = buildLooseOverrideClient(tmpRoot);
    overrideDir = fixture.overrideDir;

    // Pre-existing overridden file — pristine bytes, snapshotted, THEN overwritten (simulating
    // deployLoose's B3 pre-existing-file handling).
    preExistingFilePath = path.join(overrideDir, 'appearance', 'e2e_preexisting.iff');
    fs.mkdirSync(path.dirname(preExistingFilePath), { recursive: true });
    const pristineBytes = Buffer.from('pristine pre-existing bytes (04.4-14 scenario 2)');
    fs.writeFileSync(preExistingFilePath, pristineBytes);
    preExistingPristineSha256 = sha256Buf(pristineBytes);

    projectFolder = getDefaultProjectFolder(projectName);
    studioDir = getStudioDir(projectFolder);
    fs.mkdirSync(projectFolder, { recursive: true });

    const preExistingSnapshotPath = path.join(studioDir, 'snapshots', 'appearance', 'e2e_preexisting.iff');
    fs.mkdirSync(path.dirname(preExistingSnapshotPath), { recursive: true });
    fs.copyFileSync(preExistingFilePath, preExistingSnapshotPath);

    // Simulate the deploy overwrite of the pre-existing file + write of a brand-new
    // toolkit-added file (not present before this "deploy").
    fs.writeFileSync(preExistingFilePath, Buffer.from('deployed bytes overwriting the pre-existing file'));
    toolkitAddedFilePath = path.join(overrideDir, 'appearance', 'e2e_new.iff');
    const newFileBytes = Buffer.from('E2E delete-flow toolkit-added bytes (loose-model, 04.4-14)');
    fs.writeFileSync(toolkitAddedFilePath, newFileBytes);

    const csId = crypto.randomUUID();
    const csFilesDir = path.join(studioDir, 'changesets', csId, 'files', 'appearance');
    fs.mkdirSync(csFilesDir, { recursive: true });
    fs.writeFileSync(path.join(csFilesDir, 'e2e_new.iff'), newFileBytes);

    const deployRecord: LooseDeployRecord = {
      overrideDir,
      writtenFiles: [
        {
          virtualPath: 'appearance/e2e_preexisting.iff',
          destPath: preExistingFilePath,
          preExisted: true,
          snapshotPath: preExistingSnapshotPath,
        },
        {
          virtualPath: 'appearance/e2e_new.iff',
          destPath: toolkitAddedFilePath,
          preExisted: false,
        },
      ],
      skippedDeletes: [],
    };

    const nowIso = new Date().toISOString();
    const manifest = {
      activeVersionId: csId,
      deployedVersionId: csId,
      changesets: [
        {
          id: BASELINE_ID, parentId: null, label: 'Baseline (pristine)',
          timestamp: nowIso, sealedBy: 'manual', deltas: [],
        },
        {
          id: csId, parentId: BASELINE_ID, label: 'Version 2',
          timestamp: nowIso, sealedBy: 'manual',
          deltas: [{ virtualPath: 'appearance/e2e_new.iff', action: 'add', storedFileRef: 'appearance/e2e_new.iff', sha: sha256Buf(newFileBytes) }],
          deployRecord,
        },
      ],
    };
    fs.mkdirSync(path.join(studioDir, 'changesets'), { recursive: true });
    fs.writeFileSync(
      path.join(studioDir, 'changesets', 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );

    fs.writeFileSync(
      path.join(studioDir, 'workspace.json'),
      JSON.stringify({ projectName, kind: 'client', clientPath: fixture.installPath, cfgPath: fixture.cfgPath }),
    );

    app = await launchTestModeApp();
    win = await getFirstWindow(app);
    consoleState = attachConsoleErrorCollector(win);

    const hooksPresent = await win.evaluate(() => (window as any).__testHooks !== undefined);
    expect(hooksPresent).toBe(true);
  });

  test.afterAll(async () => {
    await app?.close();
    cleanupProjectPaths(projectFolder, studioDir);
  });

  test('1. boots with zero console errors', async () => {
    await win.waitForTimeout(1500);
    expect(consoleState.errors, consoleState.errors.join('\n')).toEqual([]);
  });

  test('2. Open Project -> kebab -> Delete project… -> confirm modal shows the loose-model plan line', async () => {
    await win.getByRole('button', { name: 'Open Project', exact: true }).click();
    await expect(win.getByRole('dialog', { name: 'Open Project' })).toBeVisible();

    await win.getByRole('button', { name: `Project actions for ${projectName}` }).click();
    await win.getByRole('menuitem', { name: /Delete project/ }).click();

    const modal = win.getByRole('dialog', { name: 'Delete project?' });
    await expect(modal).toBeVisible();
    // loose-model plan line (DeleteProjectConfirmModal.tsx: 'overrideDir' in rec).
    await expect(modal.getByText(/Revert loose overrides/i)).toBeVisible();
  });

  test('3. Delete -> pre-existing file restored (sha256), toolkit-added file removed', async () => {
    await win.getByRole('button', { name: 'Delete project', exact: true }).click();

    await expect(win.getByRole('dialog', { name: 'Delete project?' })).not.toBeVisible({ timeout: 10_000 });
    await expect(win.getByTestId('delete-undo-toast')).toBeVisible();

    // Ground truth (Node fs/crypto, TEST process): resetLoose's B3 restore + non-preExisted delete.
    expect(fs.existsSync(preExistingFilePath)).toBe(true);
    expect(sha256File(preExistingFilePath)).toBe(preExistingPristineSha256);
    expect(fs.existsSync(toolkitAddedFilePath)).toBe(false);
  });

  test('4. Undo -> PROJECT restored via listProjects(); loose files remain in their delete-restored state (not re-written)', async () => {
    await win.getByRole('button', { name: 'Undo delete' }).click();

    const toast = win.getByTestId('delete-undo-toast');
    await expect(toast).toBeVisible();
    await expect(toast.getByText('restored', { exact: false })).toBeVisible();
    const toastText = await toast.innerText();
    expect(toastText.toLowerCase()).not.toContain('deploy');

    const projects = await win.evaluate(
      () => (window as any).__testHooks.listProjects() as Array<{ projectFolder: string }>,
    );
    expect(projects.some((p) => p.projectFolder === projectFolder)).toBe(true);
    expect(fs.existsSync(studioDir)).toBe(true);
    expect(fs.existsSync(projectFolder)).toBe(true);

    // Locked undo contract: Undo does NOT re-deploy — the loose files stay exactly as the
    // DELETE's restore step left them (pre-existing restored, toolkit-added file removed).
    expect(fs.existsSync(preExistingFilePath)).toBe(true);
    expect(sha256File(preExistingFilePath)).toBe(preExistingPristineSha256);
    expect(fs.existsSync(toolkitAddedFilePath)).toBe(false);
  });

  test('5. zero console errors across the entire scenario', async () => {
    expect(consoleState.errors, consoleState.errors.join('\n')).toEqual([]);
  });
});
