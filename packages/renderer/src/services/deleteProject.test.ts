// @vitest-environment node
/**
 * packages/renderer/src/services/deleteProject.test.ts
 * RED gate for deleteProject / deploymentReset / deleteUndoStore (04.4-01 Task 1).
 *
 * All twelve cases (A-L) import from './deleteProject' and '../state/deleteUndoStore' —
 * neither module exists yet. Every case FAILS in RED ("Cannot find module").
 * Task 2 implements deploymentReset.ts + deleteProject.ts + deleteUndoStore.ts; tests go GREEN.
 *
 * Test inventory (see 04.4-01-PLAN.md Task 1 <behavior> for the full spec of each case):
 *   (A) cfg-model delete restores includeTargetPath to sha256-equal snapshot bytes
 *   (B) loose-model delete restores preExisted file, removes non-preExisted file
 *   (C) never-deployed delete performs zero client writes (resetDeploymentFromRecord never called)
 *   (D) missing snapshotPath is non-fatal — deleteProject does not throw, still parks
 *   (E) undo restores studio + project dirs byte-for-byte; entry removed from pending
 *   (F) deleteProject works when the target is NOT the currently-open workspace
 *   (G) unconfined + unrecognized projectFolder: BOTH moves skipped, no entryDir created
 *   (H) currently-open project: close() called BEFORE either rename attempt
 *   (I) undo destination occupied: restore() throws, no rename, entry retained (retryable)
 *   (J) server-push orphan warning — names core3/swg-main, detection-only (no remote I/O)
 *   (K) completion marker written LAST — fault-injected second rename leaves entry unmarked
 *   (L) purgeStaleTrash removes ONLY marked entries; unmarked entries survive with a warning
 *
 * Real tmp-dir fixtures throughout (mirrors looseOverrideDeploy.test.ts's isolation pattern) —
 * never touches a real client or the real %LOCALAPPDATA% studios root. SWG_TOOLKIT_DATA_ROOT is
 * redirected once for the whole vitest run (test/setup-data-root.ts); each fixture below uses a
 * fresh crypto.randomUUID()-suffixed name so tests never collide with each other.
 *
 * @swg/native-core is mocked via the ./nativeTre seam (workspaceService.ts pulls in
 * treAutoMount.ts → treMount.ts → nativeTre.ts transitively; the binary addon cannot load in
 * the vitest node environment) — mirrors projectBinding.test.ts's mocking pattern.
 *
 * Source: 04.4-01-PLAN.md Task 1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// ─── Mock the native-addon seam (workspaceService → treAutoMount → treMount → nativeTre) ──────
const nativeMocks = vi.hoisted(() => ({
  mountSearchableAsync:    vi.fn().mockResolvedValue('mock-handle-01'),
  mountTreMountWithToc:    vi.fn().mockReturnValue('mock-handle-01'),
  getMountArchives:        vi.fn().mockReturnValue([]),
  getMountEntriesColumnar: vi.fn().mockReturnValue(new ArrayBuffer(8)),
  extractMountAt:          vi.fn(),
  resolveChain:            vi.fn(),
  readMountEntry:          vi.fn(),
}));
vi.mock('@swg/native-core', () => nativeMocks);
vi.mock('./nativeTre', () => ({ nativeCore: nativeMocks }));

// ─── Hybrid mock: real behavior passthrough, but spy-visible (Test C) ──────────────────────────
vi.mock('./deploymentReset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./deploymentReset')>();
  return { ...actual, resetDeploymentFromRecord: vi.fn(actual.resetDeploymentFromRecord) };
});

// Import AFTER vi.mock — vitest hoists vi.mock to the top of the file.
import { deleteProject } from './deleteProject';
import { useDeleteUndoStore } from '../state/deleteUndoStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { getStudioDir, getStudiosRoot, getDefaultProjectsDir } from './workspaceService';
import { readManifest, writeManifest } from './changesetService';
import { resetDeploymentFromRecord } from './deploymentReset';

import type {
  CfgDeployRecord,
  LooseDeployRecord,
  SwgChangeset,
  WorkspaceChangesetManifest,
} from '@swg/contracts';

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

interface ProjectFixtureOpts {
  deployRecord?: CfgDeployRecord | LooseDeployRecord;
  changesetCount?: number;
  serverPushCore3?: boolean;
  serverPushSwgMain?: boolean;
}

/** Creates a project folder under getDefaultProjectsDir() (confined — recognized by default). */
function setupProject(opts: ProjectFixtureOpts = {}): { projectFolder: string; studioDir: string } {
  const projectFolder = path.join(getDefaultProjectsDir(), `proj-${crypto.randomUUID()}`);
  fs.mkdirSync(projectFolder, { recursive: true });

  const studioDir = getStudioDir(projectFolder);
  fs.mkdirSync(path.join(studioDir, 'changesets'), { recursive: true });

  const changesets: SwgChangeset[] = [];
  let prevId: string | null = null;
  const n = opts.changesetCount ?? 1;
  for (let i = 0; i < n; i++) {
    const id = `cs-${i}-${crypto.randomUUID().slice(0, 6)}`;
    const csFilesDir = path.join(studioDir, 'changesets', id, 'files');
    fs.mkdirSync(csFilesDir, { recursive: true });
    const storedFileRef = `dummy_${i}.txt`;
    fs.writeFileSync(path.join(csFilesDir, storedFileRef), `content-${i}-${crypto.randomUUID()}`);
    const isLast = i === n - 1;
    changesets.push({
      id,
      parentId: prevId,
      label: `v${i}`,
      timestamp: new Date().toISOString(),
      sealedBy: 'manual',
      deltas: [{ virtualPath: storedFileRef, action: 'add', storedFileRef, sha: 'deadbeef' }],
      deployRecord: isLast ? opts.deployRecord : undefined,
    });
    prevId = id;
  }

  const manifest: WorkspaceChangesetManifest = {
    activeVersionId: prevId,
    deployedVersionId: opts.deployRecord ? prevId : null,
    changesets,
  };
  writeManifest(studioDir, manifest);

  if (opts.serverPushCore3) {
    fs.writeFileSync(path.join(studioDir, 'serverPush.core3.json'), '{}');
  }
  if (opts.serverPushSwgMain) {
    fs.writeFileSync(path.join(studioDir, 'serverPush.swgmain.json'), '{}');
  }

  return { projectFolder, studioDir };
}

/** Fake client cfg fixture for the cfg-model deploy record (Test A). */
function makeFakeClientCfgFixture(): {
  cfgPath: string;
  snapshotPath: string;
  pristineBytes: Buffer;
  record: CfgDeployRecord;
} {
  const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-delete-client-'));
  const cfgPath = path.join(clientDir, 'swgemu.cfg');
  const pristineBytes = Buffer.from('PRISTINE_CFG_' + crypto.randomUUID());
  const snapshotPath = path.join(clientDir, 'swgemu.cfg.snap');
  fs.writeFileSync(snapshotPath, pristineBytes);
  fs.writeFileSync(cfgPath, Buffer.from('MUTATED_CFG_WITH_INCLUDE_LINE'));

  const record: CfgDeployRecord = {
    cfgPath: path.join(clientDir, 'swgtoolkit.cfg'),
    includeTargetPath: cfgPath,
    keyName: 'searchTree_00_55',
    slot: 55,
    backupPath: path.join(clientDir, 'swgtoolkit.cfg.bak'),
    patchPath: path.join(clientDir, 'patch.tre'),
    patchVersion: '5000',
    snapshotPath,
  };

  return { cfgPath, snapshotPath, pristineBytes, record };
}

/** Fake loose-override fixture for the loose-model deploy record (Test B). */
function makeFakeLooseFixture(): {
  preExistedPath: string;
  preExistedOriginalBytes: Buffer;
  nonPreExistedPath: string;
  record: LooseDeployRecord;
} {
  const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-delete-override-'));

  const preExistedPath = path.join(overrideDir, 'texture', 'existing.dds');
  fs.mkdirSync(path.dirname(preExistedPath), { recursive: true });
  const preExistedOriginalBytes = Buffer.from('ORIGINAL_' + crypto.randomUUID());
  const preExistedSnapshotPath = path.join(overrideDir, 'snap_existing.dds.bak');
  fs.writeFileSync(preExistedSnapshotPath, preExistedOriginalBytes);
  fs.writeFileSync(preExistedPath, Buffer.from('MODIFIED_BYTES'));

  const nonPreExistedPath = path.join(overrideDir, 'texture', 'added.dds');
  fs.writeFileSync(nonPreExistedPath, Buffer.from('ADDED_BYTES'));

  const record: LooseDeployRecord = {
    overrideDir,
    writtenFiles: [
      {
        virtualPath: 'texture/existing.dds',
        destPath: preExistedPath,
        preExisted: true,
        snapshotPath: preExistedSnapshotPath,
      },
      { virtualPath: 'texture/added.dds', destPath: nonPreExistedPath, preExisted: false },
    ],
    skippedDeletes: [],
  };

  return { preExistedPath, preExistedOriginalBytes, nonPreExistedPath, record };
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  useDeleteUndoStore.setState({ pending: [] });
  useWorkspaceStore.getState().close();
});

// ─── Tests ──────────────────────────────────────────────────────────────────────────────────────

describe('deleteProject', () => {
  it('(A) cfg-model: restores includeTargetPath to sha256-equal snapshot bytes', async () => {
    const { cfgPath, pristineBytes, record } = makeFakeClientCfgFixture();
    const { projectFolder } = setupProject({ deployRecord: record });

    const result = await deleteProject(projectFolder);

    expect(sha256(cfgPath)).toBe(crypto.createHash('sha256').update(pristineBytes).digest('hex'));
    expect(result.restoreErrors).toEqual([]);
  });

  it('(B) loose-model: restores preExisted file bytes, removes non-preExisted file', async () => {
    const { preExistedPath, preExistedOriginalBytes, nonPreExistedPath, record } =
      makeFakeLooseFixture();
    const { projectFolder } = setupProject({ deployRecord: record });

    await deleteProject(projectFolder);

    expect(sha256(preExistedPath)).toBe(
      crypto.createHash('sha256').update(preExistedOriginalBytes).digest('hex'),
    );
    expect(fs.existsSync(nonPreExistedPath)).toBe(false);
  });

  it('(C) never-deployed: zero client writes — resetDeploymentFromRecord never invoked', async () => {
    const { projectFolder, studioDir } = setupProject({}); // no deployRecord on any changeset

    const result = await deleteProject(projectFolder);

    expect(resetDeploymentFromRecord).not.toHaveBeenCalled();
    expect(result.restoreErrors).toEqual([]);
    // Only parking happened — studioDir/projectFolder moved, nothing else touched.
    expect(fs.existsSync(projectFolder)).toBe(false);
    expect(fs.existsSync(studioDir)).toBe(false);
  });

  it('(D) missing snapshotPath is non-fatal — deleteProject does not throw, still parks', async () => {
    const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-delete-nosnap-'));
    const toolkitCfgPath = path.join(clientDir, 'swgtoolkit.cfg');
    fs.writeFileSync(toolkitCfgPath, '[SharedFile]\n\tsearchTree_00_55=patch.tre\n');
    const rootCfgPath = path.join(clientDir, 'swgemu.cfg');
    fs.writeFileSync(rootCfgPath, '.include "swgtoolkit.cfg"\n');

    const record: CfgDeployRecord = {
      cfgPath: toolkitCfgPath,
      includeTargetPath: rootCfgPath,
      keyName: 'searchTree_00_55',
      slot: 55,
      backupPath: toolkitCfgPath + '.bak',
      patchPath: path.join(clientDir, 'patch.tre'),
      patchVersion: '5000',
      snapshotPath: path.join(clientDir, 'this-snapshot-does-not-exist.bak'),
    };
    const { projectFolder } = setupProject({ deployRecord: record });

    await expect(deleteProject(projectFolder)).resolves.toBeTruthy();
    expect(fs.existsSync(projectFolder)).toBe(false); // continued on to parking
  });

  it('(E) undo restores studio + project dirs byte-for-byte; entry removed from pending', async () => {
    const { projectFolder, studioDir } = setupProject({ changesetCount: 2 });
    const manifestBefore = readManifest(studioDir);
    const hashesBefore = manifestBefore.changesets.map((cs) => {
      const ref = cs.deltas[0]?.storedFileRef;
      return ref ? sha256(path.join(studioDir, 'changesets', cs.id, 'files', ref)) : null;
    });

    await deleteProject(projectFolder);
    expect(fs.existsSync(projectFolder)).toBe(false);
    expect(fs.existsSync(studioDir)).toBe(false);

    const entry = useDeleteUndoStore
      .getState()
      .pending.find((e) => e.originalFolderPath === projectFolder);
    expect(entry).toBeDefined();

    useDeleteUndoStore.getState().restore(entry!.id);

    expect(fs.existsSync(projectFolder)).toBe(true);
    expect(fs.existsSync(studioDir)).toBe(true);
    const manifestAfter = readManifest(studioDir);
    manifestAfter.changesets.forEach((cs, i) => {
      const ref = cs.deltas[0]?.storedFileRef;
      if (!ref) return;
      expect(sha256(path.join(studioDir, 'changesets', cs.id, 'files', ref))).toBe(hashesBefore[i]);
    });
    expect(useDeleteUndoStore.getState().pending.some((e) => e.id === entry!.id)).toBe(false);
  });

  it('(F) works when the target is NOT the currently-open workspace', async () => {
    const { projectFolder } = setupProject({});
    // A DIFFERENT project is "open" — the deleted one is not it.
    useWorkspaceStore.setState({ folderPath: '/some/other/open/project' });

    const result = await deleteProject(projectFolder);

    expect(result.restoreErrors).toEqual([]);
    expect(fs.existsSync(projectFolder)).toBe(false);
  });

  it('(G) unconfined + unrecognized projectFolder: BOTH moves skipped, no entryDir created', async () => {
    const projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-delete-unconfined-'));
    const studioDir = getStudioDir(projectFolder);
    fs.mkdirSync(path.join(studioDir, 'changesets'), { recursive: true });
    writeManifest(studioDir, { activeVersionId: null, deployedVersionId: null, changesets: [] });

    const result = await deleteProject(projectFolder);

    expect(result.restoreErrors.some((e) => e.includes('skipping park'))).toBe(true);
    expect(fs.existsSync(projectFolder)).toBe(true);
    expect(fs.existsSync(studioDir)).toBe(true);

    const sanitizedId = path.basename(projectFolder).replace(/[^A-Za-z0-9._-]/g, '_');
    const trashRoot = path.join(getStudiosRoot(), '.trash');
    const entries = fs.existsSync(trashRoot) ? fs.readdirSync(trashRoot) : [];
    expect(entries.some((e) => e.startsWith(sanitizedId))).toBe(false);
    expect(useDeleteUndoStore.getState().pending.some((e) => e.originalFolderPath === projectFolder)).toBe(false);
  });

  it('(H) currently-open project: close() called BEFORE either rename attempt', async () => {
    const { projectFolder, studioDir } = setupProject({});
    useWorkspaceStore.setState({ folderPath: projectFolder });

    let studioDirExistedAtCloseTime: boolean | null = null;
    let projectFolderExistedAtCloseTime: boolean | null = null;
    const originalClose = useWorkspaceStore.getState().close;
    const closeSpy = vi.spyOn(useWorkspaceStore.getState(), 'close').mockImplementation(() => {
      studioDirExistedAtCloseTime = fs.existsSync(studioDir);
      projectFolderExistedAtCloseTime = fs.existsSync(projectFolder);
      originalClose();
    });

    await deleteProject(projectFolder);

    expect(closeSpy).toHaveBeenCalled();
    expect(studioDirExistedAtCloseTime).toBe(true);
    expect(projectFolderExistedAtCloseTime).toBe(true);
    expect(fs.existsSync(projectFolder)).toBe(false); // parked AFTER close()
  });

  it('(I) undo destination occupied: restore() throws, no rename, entry retained (retryable)', async () => {
    const { projectFolder } = setupProject({});
    const result = await deleteProject(projectFolder);
    expect(result.restoreErrors).toEqual([]);

    const entry = useDeleteUndoStore
      .getState()
      .pending.find((e) => e.originalFolderPath === projectFolder);
    expect(entry).toBeDefined();

    // Simulate the user recreating/reopening a project at the same studioDir path since delete.
    fs.mkdirSync(entry!.originalStudioDir, { recursive: true });
    fs.writeFileSync(path.join(entry!.originalStudioDir, 'occupant-marker.txt'), 'OCCUPANT');

    expect(() => useDeleteUndoStore.getState().restore(entry!.id)).toThrow();

    expect(fs.readFileSync(path.join(entry!.originalStudioDir, 'occupant-marker.txt'), 'utf8')).toBe(
      'OCCUPANT',
    );
    expect(fs.existsSync(entry!.trashStudioPath)).toBe(true);
    expect(fs.existsSync(entry!.trashProjectPath)).toBe(true);
    expect(useDeleteUndoStore.getState().pending.some((e) => e.id === entry!.id)).toBe(true);
  });

  it('(J) server-push orphan warning — names core3/swg-main, detection-only', async () => {
    const core3Fixture = setupProject({ serverPushCore3: true });
    const core3Result = await deleteProject(core3Fixture.projectFolder);
    expect(core3Result.restoreErrors.some((e) => /core3/i.test(e))).toBe(true);

    const swgMainFixture = setupProject({ serverPushSwgMain: true });
    const swgMainResult = await deleteProject(swgMainFixture.projectFolder);
    expect(swgMainResult.restoreErrors.some((e) => /swg-?main/i.test(e))).toBe(true);
  });

  it('(K) completion marker written LAST — fault-injected second rename leaves entry unmarked', async () => {
    const { projectFolder } = setupProject({});

    const originalRenameSync = fs.renameSync;
    let callCount = 0;
    const renameSpy = vi
      .spyOn(fs, 'renameSync')
      .mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('SIMULATED_CRASH_SECOND_RENAME');
        }
        return originalRenameSync(...args);
      });

    let result: { restoreErrors: string[] };
    try {
      result = await deleteProject(projectFolder);
    } finally {
      renameSpy.mockRestore();
    }

    expect(result.restoreErrors.some((e) => e.includes('Failed to park project folder'))).toBe(true);

    const entry = useDeleteUndoStore
      .getState()
      .pending.find((e) => e.originalFolderPath === projectFolder);
    expect(entry).toBeDefined();
    expect(fs.existsSync(path.join(entry!.entryDir, '.complete.json'))).toBe(false);
  });

  it('(L) purgeStaleTrash removes ONLY marked entries; unmarked entries survive with a warning', () => {
    const trashRoot = path.join(getStudiosRoot(), '.trash');
    fs.mkdirSync(trashRoot, { recursive: true });

    const markedDir = path.join(trashRoot, `marked-${crypto.randomUUID()}`);
    fs.mkdirSync(path.join(markedDir, 'studio'), { recursive: true });
    fs.writeFileSync(
      path.join(markedDir, '.complete.json'),
      JSON.stringify({ deletedAt: new Date().toISOString(), projectName: 'x', paths: {} }),
    );

    const unmarkedDir = path.join(trashRoot, `unmarked-${crypto.randomUUID()}`);
    fs.mkdirSync(path.join(unmarkedDir, 'studio'), { recursive: true });
    fs.writeFileSync(path.join(unmarkedDir, 'studio', 'marker.txt'), 'STILL_HERE');

    const { warnings } = useDeleteUndoStore.getState().purgeStaleTrash();

    expect(fs.existsSync(markedDir)).toBe(false);
    expect(fs.existsSync(unmarkedDir)).toBe(true);
    expect(fs.existsSync(path.join(unmarkedDir, 'studio', 'marker.txt'))).toBe(true);
    expect(warnings.some((w) => w.includes(unmarkedDir))).toBe(true);
  });
});
