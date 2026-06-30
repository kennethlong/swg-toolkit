// @vitest-environment node
/**
 * packages/renderer/src/services/syncLiveToVersion.test.ts
 * Wave-0 RED gate for syncLiveToVersion (Plan 04.3-02 Task 1).
 *
 * All 6 cases (a-f) call `syncLiveToVersion` which throws 'not implemented (W1-04)'.
 * Every case FAILS in RED — this proves the tests exercise the stub.
 * Wave-1 plan 04 implements the function; tests go GREEN.
 *
 * Test inventory (VER-02/VER-03):
 *   (a) forward/back/forward idempotent — flatEqual no-op → noop:true, no deploy writes
 *   (b) Baseline target + cfg model → restoreCfg called (full restore-to-stock)
 *   (c) loose model routes through deployLoose with priorRecord
 *   (d) cfg model routes through deactivatePatch + activatePatch
 *   (e) flatEqual fast path → result.noop === true (no filesystem writes)
 *   (f) loose-live → Baseline → resetLoose called (H4 revert-only, NOT restoreCfg)
 *
 * Spies: all filesystem primitives (deployLoose, resetLoose, cfgActivator) are mocked
 * so no disk is touched. Tests pin the routing contract for Wave-1 plan 04.
 *
 * Source: 04.3-02-PLAN.md Task 1; 04.3-RESEARCH.md §syncLiveToVersion pseudocode.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file by vitest — these run before any imports.
vi.mock('./changesetService', () => ({
  flatten: vi.fn(),
  flatEqual: vi.fn(),
  setLiveVersion: vi.fn(),
  selectVersion: vi.fn(),
  setDeployedVersion: vi.fn(),
}));

vi.mock('./looseOverrideDeploy', () => ({
  deployLoose: vi.fn(),
  resetLoose: vi.fn(),
  resolveOverrideDir: vi.fn().mockReturnValue('/tmp/override'),
}));

vi.mock('./cfgActivator', () => ({
  activatePatch: vi.fn(),
  deactivatePatch: vi.fn(),
  restoreCfg: vi.fn(),
  scanSharedFile: vi.fn(),
  chooseSlot: vi.fn(),
}));

import { syncLiveToVersion, deployModelOf } from './syncLiveToVersion';
import type { ReconcileCtx } from './syncLiveToVersion';
import * as changesetService from './changesetService';
import * as looseOverrideDeploy from './looseOverrideDeploy';
import * as cfgActivator from './cfgActivator';

import type {
  SwgChangeset,
  WorkspaceChangesetManifest,
  LooseDeployRecord,
  CfgDeployRecord,
} from '@swg/contracts';
import { BASELINE_ID } from '@swg/contracts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockEntry = {
  virtualPath: 'appearance/foo.sat',
  action: 'add' as const,
  sha256: 'abc123',
};

function makeManifest(
  changesets: SwgChangeset[],
  liveId: string | null = null,
): WorkspaceChangesetManifest {
  return {
    activeVersionId: liveId,
    deployedVersionId: liveId,
    changesets,
  };
}

function makeLooseChangeset(id: string, parentId: string | null = null): SwgChangeset {
  const record: LooseDeployRecord = {
    overrideDir: '/tmp/override',
    writtenFiles: [],
    skippedDeletes: [],
  };
  return {
    id,
    parentId,
    label: id,
    timestamp: new Date().toISOString(),
    sealedBy: 'manual',
    deltas: [],
    deployRecord: record,
  };
}

function makeCfgChangeset(id: string, parentId: string | null = null): SwgChangeset {
  const record: CfgDeployRecord = {
    cfgPath: '/studio/swgtoolkit.cfg',
    includeTargetPath: '/client/swgclient.cfg',
    keyName: 'searchTree_00_55',
    slot: 55,
    backupPath: '/studio/snapshots/swgclient.cfg.swgtoolkit.bak',
    patchPath: '/studio/build/patch.tre',
    patchVersion: '5000',
    snapshotPath: '/studio/snapshots/swgclient.cfg.snap',
  };
  return {
    id,
    parentId,
    label: id,
    timestamp: new Date().toISOString(),
    sealedBy: 'manual',
    deltas: [],
    deployRecord: record,
  };
}

function makeCtx(
  manifest: WorkspaceChangesetManifest,
  priorLoose?: LooseDeployRecord,
): ReconcileCtx {
  return {
    manifest,
    studioDir: '/studio',
    cfgPath: '/client/swgclient.cfg',
    installRoot: '/client',
    priorLiveLooseRecord: priorLoose,
  };
}

// ---------------------------------------------------------------------------
// syncLiveToVersion — Wave-0 RED tests (cases a–f)
// ---------------------------------------------------------------------------

describe('syncLiveToVersion — Wave-0 RED (stub throws "not implemented (W1-04)")', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mocks cleared by clearAllMocks
    vi.mocked(looseOverrideDeploy.resolveOverrideDir).mockReturnValue('/tmp/override');
  });

  it('(a) forward/back/forward idempotent — flatEqual true → noop:true, no deploy writes', async () => {
    const cs = makeLooseChangeset('v1');
    const manifest = makeManifest([cs], 'v1');
    const ctx = makeCtx(manifest);
    vi.mocked(changesetService.flatten).mockReturnValue([mockEntry]);
    vi.mocked(changesetService.flatEqual).mockReturnValue(true); // already equal → noop

    // RED: stub throws 'not implemented (W1-04)' — test fails here
    const result = await syncLiveToVersion('v1', ctx);
    expect(result.noop).toBe(true);
    expect(looseOverrideDeploy.deployLoose).not.toHaveBeenCalled();
    expect(cfgActivator.activatePatch).not.toHaveBeenCalled();
  });

  it('(b) Baseline target + cfg-live model → restoreCfg called (full restore-to-stock)', async () => {
    const cs = makeCfgChangeset('v1');
    const manifest = makeManifest([cs], 'v1');
    const ctx = makeCtx(manifest);
    vi.mocked(changesetService.flatten)
      .mockReturnValueOnce([mockEntry]) // live set = v1
      .mockReturnValueOnce([]);          // Baseline → [] = restore-to-stock
    vi.mocked(changesetService.flatEqual).mockReturnValue(false);

    // RED: stub throws
    await syncLiveToVersion(BASELINE_ID, ctx);
    expect(cfgActivator.restoreCfg).toHaveBeenCalled();
    expect(changesetService.setLiveVersion).toHaveBeenCalledWith(BASELINE_ID);
  });

  it('(c) loose model routes through deployLoose with priorRecord', async () => {
    const priorRecord: LooseDeployRecord = {
      overrideDir: '/tmp/override',
      writtenFiles: [],
      skippedDeletes: [],
    };
    const cs = makeLooseChangeset('v2');
    const manifest = makeManifest([cs], 'v1');
    const ctx = makeCtx(manifest, priorRecord);
    vi.mocked(changesetService.flatten).mockReturnValue([mockEntry]);
    vi.mocked(changesetService.flatEqual).mockReturnValue(false);
    vi.mocked(looseOverrideDeploy.deployLoose).mockReturnValue({
      overrideDir: '/tmp/override',
      writtenFiles: [],
      skippedDeletes: [],
    });

    // RED: stub throws
    const result = await syncLiveToVersion('v2', ctx);
    // Should route through deployLoose with priorRecord passed
    expect(looseOverrideDeploy.deployLoose).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({ priorRecord }),
    );
    expect(result.model).toBe('loose');
    expect(cfgActivator.activatePatch).not.toHaveBeenCalled();
  });

  it('(d) cfg model routes through deactivatePatch + activatePatch', async () => {
    const cs = makeCfgChangeset('v3');
    const manifest = makeManifest([cs], 'v1');
    const ctx = makeCtx(manifest);
    vi.mocked(changesetService.flatten).mockReturnValue([mockEntry]);
    vi.mocked(changesetService.flatEqual).mockReturnValue(false);

    // RED: stub throws
    const result = await syncLiveToVersion('v3', ctx);
    // Should deactivate prior then activate target
    expect(cfgActivator.deactivatePatch).toHaveBeenCalled();
    expect(cfgActivator.activatePatch).toHaveBeenCalled();
    expect(result.model).toBe('cfg');
    expect(looseOverrideDeploy.deployLoose).not.toHaveBeenCalled();
  });

  it('(e) flatEqual fast path → result.noop === true (no filesystem writes)', async () => {
    const cs = makeLooseChangeset('v1');
    const manifest = makeManifest([cs], 'v1');
    const ctx = makeCtx(manifest);
    vi.mocked(changesetService.flatten).mockReturnValue([mockEntry]);
    vi.mocked(changesetService.flatEqual).mockReturnValue(true); // identical → noop

    // RED: stub throws
    const result = await syncLiveToVersion('v1', ctx);
    expect(result.noop).toBe(true);
    // No filesystem writes when noop
    expect(looseOverrideDeploy.deployLoose).not.toHaveBeenCalled();
    expect(looseOverrideDeploy.resetLoose).not.toHaveBeenCalled();
    expect(cfgActivator.activatePatch).not.toHaveBeenCalled();
    expect(cfgActivator.restoreCfg).not.toHaveBeenCalled();
  });

  it('(f) loose-live → Baseline → resetLoose called; restoreCfg NOT called (H4 revert-only)', async () => {
    // The LIVE version was deployed as loose; navigating to Baseline = remove loose files only
    const priorRecord: LooseDeployRecord = {
      overrideDir: '/tmp/override',
      writtenFiles: [
        {
          virtualPath: 'appearance/foo.sat',
          destPath: '/tmp/override/appearance/foo.sat',
          preExisted: false,
        },
      ],
      skippedDeletes: [],
    };
    const liveCs = makeLooseChangeset('v1-loose');
    const manifest = makeManifest([liveCs], 'v1-loose');
    const ctx = makeCtx(manifest, priorRecord);
    vi.mocked(changesetService.flatten)
      .mockReturnValueOnce([mockEntry]) // live = v1-loose
      .mockReturnValueOnce([]);          // Baseline → []
    vi.mocked(changesetService.flatEqual).mockReturnValue(false);

    // RED: stub throws
    await syncLiveToVersion(BASELINE_ID, ctx);
    // H4: loose-live → Baseline MUST call resetLoose (remove override files)
    expect(looseOverrideDeploy.resetLoose).toHaveBeenCalledWith(priorRecord);
    // H4: must NOT call restoreCfg (live model was loose, not cfg)
    expect(cfgActivator.restoreCfg).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deployModelOf — fully implemented, GREEN in both RED and GREEN phases
// ---------------------------------------------------------------------------

describe('deployModelOf (fully implemented — always GREEN)', () => {
  it('returns "loose" for a changeset with a LooseDeployRecord (has overrideDir)', () => {
    const cs = makeLooseChangeset('v1');
    expect(deployModelOf(cs)).toBe('loose');
  });

  it('returns "cfg" for a changeset with a CfgDeployRecord (no overrideDir)', () => {
    const cs = makeCfgChangeset('v1');
    expect(deployModelOf(cs)).toBe('cfg');
  });

  it('returns "cfg" for a changeset with no deployRecord', () => {
    const cs: SwgChangeset = {
      id: 'v1',
      parentId: null,
      label: 'v1',
      timestamp: new Date().toISOString(),
      sealedBy: 'manual',
      deltas: [],
    };
    expect(deployModelOf(cs)).toBe('cfg');
  });
});
