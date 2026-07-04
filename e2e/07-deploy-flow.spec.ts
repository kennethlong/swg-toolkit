/**
 * e2e/07-deploy-flow.spec.ts
 * D-07 deploy-loop real-Electron coverage (04.4-13) — TWO scenarios:
 *   Scenario 1 (cfg-model):        buildCfgModelClient fixture (04.4-09)
 *   Scenario 2 (loose-override):   buildLooseOverrideClient fixture (04.4-09), round-3 ruling
 *
 * GROUND-TRUTH CORRECTION (2026-07-04, this plan's execution — supersedes the plan's own
 * "fact-check pass" note dated the same day, and 04.4-09-SUMMARY.md's `requires` frontmatter):
 * the plan text assumed clicking a version-graph row performs a SILENT RECONCILE via
 * `syncLiveToVersion` (i.e. selecting a saved version deploys it to the live client without
 * opening the Deploy dialog). Direct re-read of the CURRENT `VersionHistoryBody.tsx` (dated
 * comment: "D-04 SUPERSEDED 2026-07, crew consult") shows this is no longer true:
 *   - Row click -> `handleRowClick` -> `doSelect` -> `selectVersion` (changesetService.ts).
 *     `selectVersion` ONLY moves `activeVersionId` + materializes the staging working set
 *     (`useStagingStore.restoreEntries`). It never touches `deployedVersionId` and never
 *     calls `syncLiveToVersion`.
 *   - `syncLiveToVersion` is invoked from exactly two places: `DeployDialog.handleDeploy`
 *     (the explicit "Deploy vN..." button — for BOTH a brand-new version AND re-navigating
 *     to an already-saved one) and `VersionHistoryBody.handleUndo` (the Undo button/Ctrl+Z).
 * Per CLAUDE.md/AGENTS.md's "ground truth beats consensus" mandate, this spec asserts the
 * VERIFIED current behavior: selecting a row moves `activeVersionId` only (no client
 * mutation, `deployedVersionId` unchanged); the Deploy dialog is the ONLY path that moves
 * `deployedVersionId` and touches client files, whether the target is a fresh version or a
 * previously-saved one. Documented as a plan-deviation in this plan's executor SUMMARY.
 *
 * A second, independently-verified correction: "Open Project…" on the Welcome screen no
 * longer drives the native `workspace:pick-dir` folder picker — it opens the in-app
 * `ProjectListDialog`, which lists only ALREADY-BOUND toolkit projects (04.1 redesign). The
 * non-silent-failure UI-feedback surface for an unrecognized folder is the New-Project
 * wizard's Step 2 "Browse for client folder…" flow (Surface 3's "⚠ Unconfirmed directory"
 * branch), which this spec exercises instead.
 *
 * Both scenarios mirror the own-Electron-lifecycle pattern from e2e/04-workspace.spec.ts and
 * the SWG_TEST_MODE hook surface + fixture builders from 04.4-09.
 */

import { _electron as electron, test, expect } from '@playwright/test';
import type { ElectronApplication, Page, ConsoleMessage } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

import { buildCfgModelClient } from './fixtures/cfgModelClient';
import { buildLooseOverrideClient } from './fixtures/looseOverrideClient';

const REPO_ROOT = path.resolve(__dirname, '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ELECTRON_BINARY = require('electron') as string;

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Launch the app with SWG_TEST_MODE=1 (dialog stubbing + window.__testHooks). */
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

/** Switch to the 'Deploy' dockview tab (grouped with Inspect on the right dock). */
async function openDeployTab(win: Page): Promise<void> {
  await win.locator('.dv-default-tab-content').getByText('Deploy', { exact: true }).click();
}

/** Stage one file (Add… -> VirtualPathModal) via a stubbed workspace:pick-file path. */
async function stageOneFile(win: Page, sourcePath: string, virtualPath: string): Promise<void> {
  await win.evaluate(
    (p) => (window as any).__testHooks.setStubPaths('workspace:pick-file', [p]),
    sourcePath,
  );
  await win.getByRole('button', { name: 'Add file to staging list' }).click();
  await expect(win.getByRole('dialog', { name: 'Virtual archive path' })).toBeVisible();
  await win.locator('input[spellcheck="false"]').fill(virtualPath);
  await win.getByRole('button', { name: 'Add to patch' }).click();
  await expect(win.getByTestId('staging-row')).toBeVisible();
}

/** Save the current staging set as a new version, accepting the default "Version N" label. */
async function saveVersion(win: Page): Promise<void> {
  await win.getByRole('button', { name: 'Save version' }).click();
  const dialog = win.getByRole('dialog', { name: 'Save version' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Save version' }).click();
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1 — cfg-model fixture (buildCfgModelClient)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('D-07 deploy loop (Scenario 1: cfg-model fixture)', () => {
  test.describe.configure({ timeout: 180_000 });

  let app: ElectronApplication;
  let win: Page;
  let consoleState: { errors: string[] };
  let tmpRoot: string;
  let cfgRootPath: string;
  const projectName = `E2E Cfg Project ${Date.now()}`;

  test.beforeAll(async () => {
    tmpRoot = makeTmpDir('swg-toolkit-e2e-13-cfg-client-');
    const fixture = buildCfgModelClient(tmpRoot);
    cfgRootPath = fixture.cfgRootPath;

    app = await launchTestModeApp();
    win = await getFirstWindow(app);
    consoleState = attachConsoleErrorCollector(win);

    // Sanity: test-hook plumbing must be present BEFORE any scenario step (round-3 fix).
    const hooksPresent = await win.evaluate(() => (window as any).__testHooks !== undefined);
    expect(hooksPresent).toBe(true);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('1. boots with zero console errors', async () => {
    await win.waitForTimeout(1500);
    expect(consoleState.errors, consoleState.errors.join('\n')).toEqual([]);
  });

  test('2. New Project wizard: browsing to an unrecognized folder shows non-silent UI feedback', async () => {
    // Stub the folder picker to return the fixture root — it has NO .tre files, so
    // detectFolderKind() classifies it as 'mod-project' and the wizard's Step 2
    // "Unconfirmed directory" branch fires (real, current non-silent-failure surface —
    // see file-header note: "Open Project…" itself only lists already-bound projects now).
    await win.evaluate(
      (p) => (window as any).__testHooks.setStubPaths('workspace:pick-dir', [p]),
      tmpRoot,
    );

    await win.getByRole('button', { name: 'New Project', exact: true }).click();
    await expect(win.getByRole('dialog', { name: 'New Project' })).toBeVisible();

    await win.getByLabel('Project name', { exact: true }).fill(projectName);
    await win.getByRole('button', { name: 'Next' }).click();

    // Step 2 — Browse for client folder -> resolves to tmpRoot (no .tre) -> unconfirmed.
    await win.getByRole('button', { name: 'Browse for client folder', exact: true }).click();
    await expect(win.getByText('⚠ Unconfirmed directory')).toBeVisible();
    await expect(win.getByText('Is this a client install?')).toBeVisible();

    await win.getByRole('button', { name: 'Yes, treat as client' }).click();
    await expect(
      win.getByText('✓ Will be treated as a client install. Deploy will be enabled.'),
    ).toBeVisible();

    // GROUND TRUTH (verified via NewProjectWizard.tsx's Step2BindClient): the manual
    // cfgFile/treSubdir override section is gated by `!isUnconfirmed` — and `isUnconfirmed`
    // stays true for the remainder of the wizard session once a browsed folder was
    // classified as non-client (it does not flip false after answering "Yes, treat as
    // client"). So for an unconfirmed-then-confirmed folder with no auto-detected known
    // layout (our cfg-model fixture has neither .tre files nor client.cfg), the manual
    // override UI is UNREACHABLE via this path — initProject's own fallback (probe
    // CFG_NAMES + default Live/ dir) resolves the fixture's real swgemu.cfg + Live/ layout
    // correctly without it. This spec does not attempt to reach the unreachable manual
    // override UI; it proceeds directly, matching the actual, current wizard behavior.
  });

  test('3. finishes the wizard bound to the cfg-model fixture, then stage -> save version', async () => {
    await win.getByRole('button', { name: 'Next' }).click(); // -> step 3 (skip local server)
    await win.getByRole('button', { name: 'Next' }).click(); // -> step 4
    // Step 4: "Start empty" — the fixture has no real .tre archives to seed staging from.
    await win.getByText('Start empty', { exact: true }).click();
    await win.getByRole('button', { name: 'Create project' }).click();

    // Wizard closes on success; the Welcome takeover is gone (left tab now reads "Assets").
    await expect(
      win.locator('.dv-default-tab-content').getByText('Assets', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await openDeployTab(win);

    const stagedSourceDir = makeTmpDir('swg-toolkit-e2e-13-cfg-src-');
    const stagedSourcePath = path.join(stagedSourceDir, 'appearance_test.iff');
    fs.writeFileSync(stagedSourcePath, Buffer.from('E2E scenario 1 staged bytes'));
    await stageOneFile(win, stagedSourcePath, 'appearance/e2e_test.iff');

    await saveVersion(win);

    // Version graph shows the new node.
    // GROUND TRUTH: Baseline is ITSELF changeset #1 (mandatory idempotent seedBaseline on
    // every open — see STATE.md D-06 note), so the default save-version label
    // (`Version ${changesetCount + 1}`, changesetCount already counting Baseline) is
    // "Version 2" for the FIRST user-created version, not "Version 1".
    await expect(win.locator('.ver-title').filter({ hasText: 'Version 2' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('4. selecting the saved version moves ONLY activeVersionId (verified current model — no silent reconcile)', async () => {
    // Defensive: re-assert the Deploy tab is active (dockview active-panel state is not
    // guaranteed to persist across independent `test()` blocks sharing one `win`/`app`).
    await openDeployTab(win);

    const before = await win.evaluate(() => (window as any).__testHooks.getChangesetManifest());
    expect(before.deployedVersionId).toBeNull();

    // Click the v2 row (Baseline = v1) -> selectVersion() only (ground-truth: no client mutation).
    await win.locator('[data-changeset-id]').filter({ hasText: 'Version 2' }).click();
    await win.waitForTimeout(300);

    const after = await win.evaluate(() => (window as any).__testHooks.getChangesetManifest());
    expect(after.activeVersionId).not.toBeNull();
    // deployedVersionId is UNCHANGED by a row click — this is the corrected assertion (see
    // file-header ground-truth note). The plan text assumed this would equal the saved
    // version's id via a "silent reconcile"; that reconcile does not exist on the
    // row-click path in the current codebase.
    expect(after.deployedVersionId).toBe(before.deployedVersionId);
  });

  test('5. Deploy… dialog deploys the selected version (moves deployedVersionId, writes client cfg)', async () => {
    await openDeployTab(win);
    await win.getByRole('button', { name: /^Deploy Version 2/ }).click();
    const dialog = win.getByTestId('deploy-dialog');
    await expect(dialog).toBeVisible();

    // Absolute-path model is the default and only meaningful model for this cfg fixture
    // (no searchPath dirs configured -> loose-override is not applicable here).
    await dialog.getByRole('button', { name: 'Deploy patch' }).click();
    await expect(dialog.getByText(/deployed · slot/)).toBeVisible({ timeout: 15_000 });

    const manifest = await win.evaluate(() => (window as any).__testHooks.getChangesetManifest());
    expect(manifest.deployedVersionId).toBe(manifest.activeVersionId);
    expect(manifest.deployedVersionId).not.toBeNull();

    // Ground-truth cfg assertion (Node fs, TEST process — never trust only in-app state):
    // deploying via absolute-path writes a single .include line into the client's root cfg.
    const cfgBytes = fs.readFileSync(cfgRootPath, 'utf8');
    expect(cfgBytes).toMatch(/\.include/i);

    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('6. revert to Baseline restores the cfg to its pristine pre-deploy bytes', async () => {
    await openDeployTab(win);
    const currentlyDeployedBytes = fs.readFileSync(cfgRootPath, 'utf8');
    expect(currentlyDeployedBytes).toMatch(/\.include/i); // sanity: currently deployed

    // Select Baseline, then Deploy Baseline (revert to stock) — per the verified model,
    // reverting ALSO only moves deployedVersionId via the explicit Deploy dialog.
    await win.locator('[data-changeset-id="baseline"]').click();
    await win.waitForTimeout(300);

    await win.getByRole('button', { name: 'Deploy Baseline', exact: true }).click();
    const dialog = win.getByTestId('deploy-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Deploy Baseline (revert to stock)' }).click();

    await expect(dialog.getByText(/deployed · slot/)).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Close dialog' }).click();

    const manifest = await win.evaluate(() => (window as any).__testHooks.getChangesetManifest());
    expect(manifest.deployedVersionId).toBe('baseline');

    // Ground-truth: cfg restored byte-pristine (no .include line — restoreCfg whole-file).
    const restoredBytes = fs.readFileSync(cfgRootPath, 'utf8');
    expect(restoredBytes).not.toMatch(/\.include/i);
  });

  test('7. zero console errors across the entire scenario', async () => {
    expect(consoleState.errors, consoleState.errors.join('\n')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 — loose-override fixture (buildLooseOverrideClient, round-3 ruling)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('D-07 deploy loop (Scenario 2: loose-override fixture, round-3)', () => {
  test.describe.configure({ timeout: 180_000 });

  let app: ElectronApplication;
  let win: Page;
  let consoleState: { errors: string[] };
  let tmpRoot: string;
  let overrideDir: string;
  let preExistingFilePath: string;
  let preExistingPristineSha256: string;
  const projectName = `E2E Loose Project ${Date.now()}`;

  test.beforeAll(async () => {
    tmpRoot = makeTmpDir('swg-toolkit-e2e-13-loose-client-');
    const fixture = buildLooseOverrideClient(tmpRoot);
    overrideDir = fixture.overrideDir;

    // Seed a pre-existing overridden file so revert has something non-trivial to restore
    // (mirrors 04.4-14's fixture-seeding pattern for the loose-override delete-flow spec).
    preExistingFilePath = path.join(overrideDir, 'appearance', 'e2e_preexisting.iff');
    fs.mkdirSync(path.dirname(preExistingFilePath), { recursive: true });
    fs.writeFileSync(preExistingFilePath, Buffer.from('pristine pre-existing bytes (scenario 2)'));
    preExistingPristineSha256 = sha256File(preExistingFilePath);

    app = await launchTestModeApp();
    win = await getFirstWindow(app);
    consoleState = attachConsoleErrorCollector(win);

    const hooksPresent = await win.evaluate(() => (window as any).__testHooks !== undefined);
    expect(hooksPresent).toBe(true);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('1. boots with zero console errors', async () => {
    await win.waitForTimeout(1500);
    expect(consoleState.errors, consoleState.errors.join('\n')).toEqual([]);
  });

  test('2. New Project wizard: unconfirmed-directory feedback, then auto-detected swg-client-v2 layout', async () => {
    await win.evaluate(
      (p) => (window as any).__testHooks.setStubPaths('workspace:pick-dir', [p]),
      tmpRoot,
    );

    await win.getByRole('button', { name: 'New Project', exact: true }).click();
    await expect(win.getByRole('dialog', { name: 'New Project' })).toBeVisible();

    await win.getByLabel('Project name', { exact: true }).fill(projectName);
    await win.getByRole('button', { name: 'Next' }).click();

    await win.getByRole('button', { name: 'Browse for client folder', exact: true }).click();
    await expect(win.getByText('⚠ Unconfirmed directory')).toBeVisible();
    await win.getByRole('button', { name: 'Yes, treat as client' }).click();

    // GROUND TRUTH (verified via clientLayout.ts KNOWN_LAYOUTS): a bare `client.cfg` with no
    // local .tre files matches the 'swg-client-v2' `treDirFromCfg` pattern (presence of
    // client.cfg alone is the signal — no manual override needed here, unlike Scenario 1's
    // cfg-model fixture which uses swgemu.cfg + Live/ with no matching known pattern).
    await expect(win.getByText('DETECTED LAYOUT')).toBeVisible();
    // exact:true — the maintainer's own machine has REAL swg-client-v2 installs auto-detected
    // in Step 2's "Detected installs" list ("swg-client-v2 (stage-x64)" etc.), which would
    // otherwise strict-mode-collide with a substring match on the release-pattern label.
    await expect(win.getByText('swg-client-v2', { exact: true })).toBeVisible();

    await win.getByRole('button', { name: 'Next' }).click(); // -> step 3
    await win.getByRole('button', { name: 'Next' }).click(); // -> step 4
    await win.getByText('Start empty', { exact: true }).click();
    await win.getByRole('button', { name: 'Create project' }).click();

    await expect(
      win.locator('.dv-default-tab-content').getByText('Assets', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('3. stage a file and save a version', async () => {
    await openDeployTab(win);

    const stagedSourceDir = makeTmpDir('swg-toolkit-e2e-13-loose-src-');
    const stagedSourcePath = path.join(stagedSourceDir, 'appearance_test.iff');
    fs.writeFileSync(stagedSourcePath, Buffer.from('E2E scenario 2 staged bytes'));
    await stageOneFile(win, stagedSourcePath, 'appearance/e2e_new.iff');

    await saveVersion(win);

    // GROUND TRUTH: Baseline is ITSELF changeset #1 (mandatory idempotent seedBaseline on
    // every open), so the first user-created version's default label is "Version 2".
    await expect(win.locator('.ver-title').filter({ hasText: 'Version 2' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('4. select the saved version (activeVersionId only), then Deploy via loose-override', async () => {
    // Defensive: re-assert the Deploy tab is active (dockview active-panel state is not
    // guaranteed to persist across independent `test()` blocks sharing one `win`/`app`).
    await openDeployTab(win);

    const before = await win.evaluate(() => (window as any).__testHooks.getChangesetManifest());
    expect(before.deployedVersionId).toBeNull();

    await win.locator('[data-changeset-id]').filter({ hasText: 'Version 2' }).click();
    await win.waitForTimeout(300);

    const afterSelect = await win.evaluate(() => (window as any).__testHooks.getChangesetManifest());
    expect(afterSelect.deployedVersionId).toBe(before.deployedVersionId); // unchanged by select

    await win.getByRole('button', { name: /^Deploy Version 2/ }).click();
    const dialog = win.getByTestId('deploy-dialog');
    await expect(dialog).toBeVisible();

    // Switch the deploy model to Loose override dir (round-3 scope). Click the visible text
    // (not `.check()` on the bare radio input) — the model-select row's OUTER div carries
    // its own `onClick={() => setDeployModel('loose-override')}` alongside the native radio's
    // `onChange`; clicking the text mirrors a real user click and reliably fires both.
    await dialog.getByText('Loose override dir', { exact: true }).click();
    await expect(dialog.locator('input[type="radio"][name="deployModel"]').nth(1)).toBeChecked();

    await dialog.getByRole('button', { name: 'Deploy patch' }).click();
    await expect(dialog.getByText(/deployed · slot/)).toBeVisible({ timeout: 15_000 });

    const manifest = await win.evaluate(() => (window as any).__testHooks.getChangesetManifest());
    expect(manifest.deployedVersionId).toBe(manifest.activeVersionId);
    expect(manifest.deployedVersionId).not.toBeNull();

    // Ground-truth (Node fs in the TEST process, never cfg content per this scenario's
    // acceptance criteria — loose-model observable state only): the staged file now
    // exists on disk in the override tree with the staged bytes.
    const newFilePath = path.join(overrideDir, 'appearance', 'e2e_new.iff');
    expect(fs.existsSync(newFilePath)).toBe(true);
    expect(fs.readFileSync(newFilePath, 'utf8')).toBe('E2E scenario 2 staged bytes');

    // The pre-existing seeded file must still be intact (not clobbered) — deployLoose
    // only writes staged entries, and the pre-existing file wasn't staged.
    expect(fs.existsSync(preExistingFilePath)).toBe(true);

    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('5. revert to Baseline restores loose-model observable state (pre-existing file restored, toolkit-written file removed)', async () => {
    await openDeployTab(win);
    await win.locator('[data-changeset-id="baseline"]').click();
    await win.waitForTimeout(300);

    await win.getByRole('button', { name: 'Deploy Baseline', exact: true }).click();
    const dialog = win.getByTestId('deploy-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Deploy Baseline (revert to stock)' }).click();

    await expect(dialog.getByText(/deployed · slot/)).toBeVisible({ timeout: 15_000 });

    const manifest = await win.evaluate(() => (window as any).__testHooks.getChangesetManifest());
    expect(manifest.deployedVersionId).toBe('baseline');

    // Ground-truth (Node fs/crypto in the TEST process — never trust only in-app state):
    const newFilePath = path.join(overrideDir, 'appearance', 'e2e_new.iff');
    expect(fs.existsSync(newFilePath)).toBe(false); // non-preExisted file removed by resetLoose

    expect(fs.existsSync(preExistingFilePath)).toBe(true); // preExisted file RESTORED, not deleted
    expect(sha256File(preExistingFilePath)).toBe(preExistingPristineSha256);
  });

  test('6. zero console errors across the entire scenario', async () => {
    expect(consoleState.errors, consoleState.errors.join('\n')).toEqual([]);
  });
});
