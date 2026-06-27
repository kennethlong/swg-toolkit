// @vitest-environment node
/**
 * src/services/shadowBaseService.test.ts
 * RED test — hardlink path + EXDEV fallback (DEPLOY-06).
 *
 * Tests:
 *   SBS-1: sameVolume() returns true for paths on the same filesystem volume
 *   SBS-2: deployShadowBase uses fs.promises.link (not copyFile) on same-volume; checkFreeDisk skipped
 *   SBS-3: EXDEV from link → falls back to fs.promises.copyFile
 *   SBS-4: checkFreeDisk NOT called on same-volume (hardlink) path; IS called on copy (different-volume) path
 *
 * RED contract:
 *   - sameVolume not yet exported → SBS-1 throws "not a function"
 *   - deployShadowBase always uses copyFile (no hardlink path) → SBS-2 fails (link not called)
 *   - SBS-3 requires link attempted first → fails (link not called before copyFile)
 *   - checkFreeDisk is called unconditionally in current code → SBS-4 fails (should not be called on hardlink path)
 *
 * Uses vi.hoisted + vi.mock('fs') to fully mock the fs module so we can control
 * statSync (for sameVolume dev comparison), statfsSync (for checkFreeDisk),
 * fs.promises.link, and fs.promises.copyFile — without hitting ESM namespace
 * configuration limits.
 *
 * Source: 04.1-07-PLAN.md Task 1; 04.1-RESEARCH.md §Pattern 1; 04.1-PATTERNS.md §shadowBaseService.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';

// ─── Hoisted mock fns — created before vi.mock factory runs ────────────────
const {
  mockExistsSync,
  mockReaddirSync,
  mockStatSync,
  mockStatfsSync,
  mockWriteFileSync,
  mockCopyFileSync,
  mockRmSync,
  mockMkdirPromise,
  mockReaddirPromise,
  mockLinkPromise,
  mockCopyFilePromise,
  mockRenamePromise,
} = vi.hoisted(() => {
  return {
    mockExistsSync:     vi.fn().mockReturnValue(false),
    mockReaddirSync:    vi.fn().mockReturnValue(['test.tre']),
    mockStatSync:       vi.fn().mockReturnValue({ dev: 100, size: 1024 }),
    mockStatfsSync:     vi.fn().mockReturnValue({ bavail: 1_000_000, bsize: 4096 }),
    mockWriteFileSync:  vi.fn(),
    mockCopyFileSync:   vi.fn(),
    mockRmSync:         vi.fn(),
    mockMkdirPromise:   vi.fn().mockResolvedValue(undefined),
    mockReaddirPromise: vi.fn().mockResolvedValue(['test.tre']),
    mockLinkPromise:    vi.fn().mockResolvedValue(undefined),
    mockCopyFilePromise:vi.fn().mockResolvedValue(undefined),
    mockRenamePromise:  vi.fn().mockResolvedValue(undefined),
  };
});

// ─── Full fs mock (must come before importing service) ─────────────────────
vi.mock('fs', () => {
  const fsMock = {
    existsSync:     mockExistsSync,
    readdirSync:    mockReaddirSync,
    statSync:       mockStatSync,
    statfsSync:     mockStatfsSync,
    writeFileSync:  mockWriteFileSync,
    copyFileSync:   mockCopyFileSync,
    appendFileSync: vi.fn(),
    readFileSync:   vi.fn().mockReturnValue(''),
    rmSync:         mockRmSync,
    mkdirSync:      vi.fn(),
    renameSync:     vi.fn(),
    promises: {
      mkdir:    mockMkdirPromise,
      readdir:  mockReaddirPromise,
      link:     mockLinkPromise,
      copyFile: mockCopyFilePromise,
      rename:   mockRenamePromise,
    },
  };
  return { ...fsMock, default: fsMock };
});

// ─── Mock dependent services ────────────────────────────────────────────────
vi.mock('./clientLocator', () => ({
  scanSharedFile: vi.fn(() => ({
    skuSuffix: '_00_',
    maxSearchPriority: 60,
    occupiedSlots: [],
  })),
}));

vi.mock('./cfgActivator', () => ({
  activatePatch: vi.fn(() => ({
    keyName: 'searchTree_00_55',
    slot: 55,
    backupPath: '',
    patchName: 'patch.tre',
    cfgPath: '',
    includeTargetPath: '',
  })),
  ensureInclude: vi.fn(),
}));

// ─── Import service after mocks ─────────────────────────────────────────────
// RED: sameVolume is not yet exported — destructured value is undefined → tests fail
import * as shadowBaseModule from './shadowBaseService';
const { sameVolume, deployShadowBase } = shadowBaseModule;
import type { DetectedClient } from '@swg/contracts';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const TMP_BASE = path.join(tmpdir(), 'swg-sbs-test');
let tmpDir: string;
let testCounter = 0;

function makeClientAndPaths() {
  testCounter++;
  tmpDir = path.join(TMP_BASE, `t${testCounter}`);
  const installDir = path.join(tmpDir, 'client');
  const liveDir    = path.join(installDir, 'Live');
  const studioDir  = path.join(tmpDir, 'studio');
  const cfgRootPath = path.join(installDir, 'swgemu.cfg');
  const patchPath  = path.join(studioDir, 'build', 'patch.tre');

  const client: DetectedClient = {
    name: 'Test SWG Client',
    installPath: installDir,
    cfgRootPath,
    treVersion: '5000',
  };

  return { installDir, liveDir, studioDir, cfgRootPath, patchPath, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset defaults after clearAllMocks
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue(['test.tre']);
  mockStatSync.mockReturnValue({ dev: 100, size: 1024 });
  mockStatfsSync.mockReturnValue({ bavail: 1_000_000, bsize: 4096 });
  mockMkdirPromise.mockResolvedValue(undefined);
  mockReaddirPromise.mockResolvedValue(['test.tre']);
  mockLinkPromise.mockResolvedValue(undefined);
  mockCopyFilePromise.mockResolvedValue(undefined);
  mockRenamePromise.mockResolvedValue(undefined);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('shadowBaseService DEPLOY-06 hardlink path', () => {

  it('SBS-1: sameVolume() returns true for paths with matching statSync().dev', () => {
    // RED: sameVolume is not yet exported — this throws "sameVolume is not a function"
    const { liveDir, studioDir } = makeClientAndPaths();
    // mockStatSync returns { dev: 100 } for all paths → sameVolume should return true
    expect(sameVolume(liveDir, studioDir)).toBe(true);
  });

  it('SBS-2: deployShadowBase uses fs.promises.link (not copyFile) on same-volume path', async () => {
    // RED: current code always uses copyFile — link is never called → assertion fails
    // statSync returns same dev (100) for all paths → canLink should be true
    const { client, studioDir, patchPath } = makeClientAndPaths();

    await deployShadowBase(client, studioDir, patchPath);

    // EXPECTED after Task 3: link called, copyFile NOT called
    expect(mockLinkPromise).toHaveBeenCalled();
    expect(mockCopyFilePromise).not.toHaveBeenCalled();
  });

  it('SBS-3: EXDEV from link → falls back to fs.promises.copyFile', async () => {
    // RED: current code never calls link → "link was attempted" assertion fails
    const exdevErr = Object.assign(new Error('EXDEV: cross-device link not permitted'), {
      code: 'EXDEV',
    });
    mockLinkPromise.mockRejectedValueOnce(exdevErr);

    const { client, studioDir, patchPath } = makeClientAndPaths();

    await deployShadowBase(client, studioDir, patchPath);

    // link was attempted then EXDEV triggered copyFile fallback
    expect(mockLinkPromise).toHaveBeenCalled();
    expect(mockCopyFilePromise).toHaveBeenCalled();
  });

  it('SBS-4: checkFreeDisk (statfsSync) NOT called on same-volume (canLink=true); IS called on copy path (canLink=false)', async () => {
    // Part A: same-volume (all statSync return dev=100) — checkFreeDisk must NOT run
    const { client: clientA, studioDir: studioA, patchPath: patchA } = makeClientAndPaths();
    await deployShadowBase(clientA, studioA, patchA);
    // RED: current code calls checkFreeDisk unconditionally → statfsSync IS called → assertion fails
    expect(mockStatfsSync).not.toHaveBeenCalled();

    vi.clearAllMocks();
    // Reset defaults
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue(['test.tre']);
    mockMkdirPromise.mockResolvedValue(undefined);
    mockReaddirPromise.mockResolvedValue(['test.tre']);
    mockCopyFilePromise.mockResolvedValue(undefined);
    mockRenamePromise.mockResolvedValue(undefined);

    // Part B: different-volume (statSync returns different dev values) — checkFreeDisk MUST run
    // First call (liveDir check) returns dev=100, second call (studioDir check) returns dev=200
    let devCallCount = 0;
    mockStatSync.mockImplementation(() => {
      devCallCount++;
      return { dev: devCallCount <= 1 ? 100 : 200, size: 1024 };
    });

    const { client: clientB, studioDir: studioB, patchPath: patchB } = makeClientAndPaths();
    await deployShadowBase(clientB, studioB, patchB);

    // EXPECTED after Task 3: statfsSync called when canLink=false (copy path)
    expect(mockStatfsSync).toHaveBeenCalled();
    // Also: copyFile used (not link) when different volume
    expect(mockCopyFilePromise).toHaveBeenCalled();
  });

});
