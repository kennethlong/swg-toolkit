// @vitest-environment node
/**
 * packages/renderer/src/services/projectBinding.test.ts
 * Unit tests for projectBinding.ts — folder detection, JSON persistence, auto-mount.
 *
 * PROJ-01 requirement tests (04.1-VALIDATION.md §Requirement→Test Map):
 *   Test 1 — detectFolderKind: 'client' for cfg+TRE dir, 'tre-set' for TRE-only, 'mod-project' for empty
 *   Test 2 — writeWorkspaceJson / readWorkspaceJson: atomic round-trip (kind+clientPath+cfgPath+treDir)
 *   Test 3 — initProject(clientFolder): mountSearchableAsync called, treStore + workspaceStore populated
 *   Test 4 — initProject(emptyFolder): clientPath:null, kind:'mod-project', no mountSearchableAsync
 *
 * TDD RED phase: this file fails on import because './projectBinding' does not exist yet.
 * TDD GREEN phase (Task 3): all tests pass after projectBinding.ts + treMount.ts are created.
 *
 * @swg/native-core is mocked — the binary native addon cannot load in the vitest node environment.
 * Uses real temp-dir fixtures via buildFakeClientDir (no mock-fs).
 *
 * Source: 04.1-02-PLAN.md Task 1; 04.1-PATTERNS.md §Wave 0 Test Files; 04.1-VALIDATION.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { buildFakeClientDir } from '../../test/fixtures/fakeClientDir';
import { useTreStore } from '../state/treStore';
import { useWorkspaceStore } from '../state/workspaceStore';

// ─── Mock @swg/native-core ────────────────────────────────────────────────────
// vi.hoisted ensures mock variables are initialized before the vi.mock factory runs.
// This is required for variables used inside the vi.mock() factory callback.
const nativeMocks = vi.hoisted(() => ({
  mountSearchableAsync:    vi.fn().mockResolvedValue('mock-handle-01'),
  getMountArchives:        vi.fn().mockReturnValue([]),
  getMountEntriesColumnar: vi.fn().mockReturnValue(new ArrayBuffer(8)),
  resolveChain:            vi.fn(),
  readMountEntry:          vi.fn(),
  disposeTreMount:         vi.fn(),
  parseIff:                vi.fn(),
  parseAnimation:          vi.fn(),
  searchMount:             vi.fn(),
  listMountEntries:        vi.fn(),
}));

vi.mock('@swg/native-core', () => nativeMocks);
// treMount reaches the addon through the ./nativeTre require() seam (a direct native-core
// import would crash the real renderer at startup — see nativeTre.ts). vitest cannot mock
// the externalized native require(), so mock the local seam: nativeCore IS nativeMocks.
vi.mock('./nativeTre', () => ({ nativeCore: nativeMocks }));

// Import AFTER vi.mock — vitest hoists vi.mock to the top of the file, so the mock
// is guaranteed active before the imports below resolve.
import { detectFolderKind, readWorkspaceJson, writeWorkspaceJson, updateWorkspaceMeta, initProject } from './projectBinding';
import { getStudioDir } from './workspaceService';

// ─── Temp-dir lifecycle ───────────────────────────────────────────────────────

let testIdx = 0;
let tmpBase: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpBase = path.join(os.tmpdir(), `swg-pb-test-${Date.now()}-${testIdx++}`);
  fs.mkdirSync(tmpBase, { recursive: true });
  // Reset Zustand stores to known-empty state between tests
  useTreStore.getState().reset();
  useWorkspaceStore.getState().close();
});

afterEach(() => {
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore cleanup error */ }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('detectFolderKind', () => {
  it('Test 1a: returns "client" for a folder with a cfg file and a TRE subdir', () => {
    // buildFakeClientDir creates: swgemu.cfg + Live/sample_patch_0{0,1,2}.tre
    buildFakeClientDir(tmpBase, { treSubdir: 'Live', cfgFile: 'swgemu.cfg' });
    expect(detectFolderKind(tmpBase)).toBe('client');
  });

  it('Test 1b: returns "tre-set" for a folder with .tre files but no cfg', () => {
    // Write a single .tre file directly in tmpBase with no cfg present
    fs.writeFileSync(path.join(tmpBase, 'test.tre'), Buffer.from('EERT5000'));
    expect(detectFolderKind(tmpBase)).toBe('tre-set');
  });

  it('Test 1c: returns "mod-project" for an empty folder (no cfg, no .tre)', () => {
    // tmpBase is freshly created and empty
    expect(detectFolderKind(tmpBase)).toBe('mod-project');
  });
});

describe('writeWorkspaceJson / readWorkspaceJson', () => {
  it('Test 2a: round-trips kind + clientPath + cfgPath + treDir atomically', () => {
    const studioDir = path.join(tmpBase, '.studio');
    fs.mkdirSync(studioDir, { recursive: true });

    const meta = {
      kind:       'client' as const,
      clientPath: '/some/client/path',
      cfgPath:    '/some/client/swgemu.cfg',
      treDir:     '/some/client/Live',
    };
    writeWorkspaceJson(studioDir, meta);

    const roundTripped = readWorkspaceJson(studioDir);
    expect(roundTripped.kind).toBe('client');
    expect(roundTripped.clientPath).toBe('/some/client/path');
    expect(roundTripped.cfgPath).toBe('/some/client/swgemu.cfg');
    expect(roundTripped.treDir).toBe('/some/client/Live');
  });

  it('Test 2b: readWorkspaceJson returns safe defaults when workspace.json is absent', () => {
    // .studio dir does not exist → defaults
    const result = readWorkspaceJson(path.join(tmpBase, '.studio-absent'));
    expect(result.kind).toBe('mod-project');
    expect(result.clientPath).toBeNull();
  });
});

describe('updateWorkspaceMeta — world editor fields (05.1-02)', () => {
  it('Test 5a: persists mirrorToStockIlf via updateWorkspaceMeta; readWorkspaceJson round-trips false', () => {
    const studioDir = path.join(tmpBase, '.studio');
    fs.mkdirSync(studioDir, { recursive: true });
    writeWorkspaceJson(studioDir, { kind: 'mod-project', clientPath: null });

    updateWorkspaceMeta(studioDir, { mirrorToStockIlf: false });

    expect(readWorkspaceJson(studioDir).mirrorToStockIlf).toBe(false);
  });

  it('Test 5b: persists worldEditorBookmarks array verbatim (name/scene/x/y/z, no precision loss)', () => {
    const studioDir = path.join(tmpBase, '.studio');
    fs.mkdirSync(studioDir, { recursive: true });
    writeWorkspaceJson(studioDir, { kind: 'mod-project', clientPath: null });

    const bookmarks = [
      { name: 'Cantina Entrance', scene: 'tatooine', x: 123.456, y: 12.0, z: -456.789 },
      { name: 'Coronet Bank', scene: 'corellia', x: -1024.25, y: 5.5, z: 2048.125 },
    ];
    updateWorkspaceMeta(studioDir, { worldEditorBookmarks: bookmarks });

    expect(readWorkspaceJson(studioDir).worldEditorBookmarks).toEqual(bookmarks);
  });

  it('Test 5c: persists worldEditorBuildingTemplates map; underlying read/write round-trips the whole object', () => {
    const studioDir = path.join(tmpBase, '.studio');
    fs.mkdirSync(studioDir, { recursive: true });
    writeWorkspaceJson(studioDir, { kind: 'mod-project', clientPath: null });

    updateWorkspaceMeta(studioDir, {
      worldEditorBuildingTemplates: {
        '1082874': 'object/building/tatooine/shared_cantina_tatooine.iff',
      },
    });
    expect(readWorkspaceJson(studioDir).worldEditorBuildingTemplates).toEqual({
      '1082874': 'object/building/tatooine/shared_cantina_tatooine.iff',
    });

    // A second call merges by spreading the PREVIOUS read before adding a key — proving
    // read/write round-trips the whole object (updateWorkspaceMeta itself is a shallow
    // patch, per its existing contract; the merge is the caller's job).
    const prev = readWorkspaceJson(studioDir).worldEditorBuildingTemplates ?? {};
    updateWorkspaceMeta(studioDir, {
      worldEditorBuildingTemplates: {
        ...prev,
        '1082875': 'object/building/naboo/shared_theed_starport.iff',
      },
    });

    expect(readWorkspaceJson(studioDir).worldEditorBuildingTemplates).toEqual({
      '1082874': 'object/building/tatooine/shared_cantina_tatooine.iff',
      '1082875': 'object/building/naboo/shared_theed_starport.iff',
    });
  });

  it('Test 5d: readWorkspaceJson on a pre-existing file without the new keys does not throw; fields are undefined', () => {
    const studioDir = path.join(tmpBase, '.studio');
    fs.mkdirSync(studioDir, { recursive: true });
    // Simulate a workspace.json written BEFORE this change — no new fields present.
    writeWorkspaceJson(studioDir, { kind: 'client', clientPath: '/some/client/path' });

    let result: ReturnType<typeof readWorkspaceJson> | undefined;
    expect(() => { result = readWorkspaceJson(studioDir); }).not.toThrow();
    expect(result!.mirrorToStockIlf).toBeUndefined();
    expect(result!.worldEditorBookmarks).toBeUndefined();
    expect(result!.worldEditorBuildingTemplates).toBeUndefined();
  });

  it('Test 5e: updateWorkspaceMeta write is atomic — no .tmp file survives after a successful call', () => {
    const studioDir = path.join(tmpBase, '.studio');
    fs.mkdirSync(studioDir, { recursive: true });
    writeWorkspaceJson(studioDir, { kind: 'mod-project', clientPath: null });

    updateWorkspaceMeta(studioDir, { mirrorToStockIlf: true });

    const remaining = fs.readdirSync(studioDir);
    expect(remaining.some((f) => f.endsWith('.tmp'))).toBe(false);
  });
});

describe('initProject', () => {
  it('Test 3: client folder → calls mountSearchableAsync, populates treStore + workspaceStore', async () => {
    const { trePaths } = buildFakeClientDir(tmpBase, { treSubdir: 'Live', cfgFile: 'swgemu.cfg' });

    await initProject(tmpBase);

    // treStore must be populated: mountTrePaths called mountComplete after mountSearchableAsync
    expect(useTreStore.getState().mountHandle).toBe('mock-handle-01');
    expect(useTreStore.getState().mountStatus).toEqual({ kind: 'done' });

    // workspaceStore must reflect the real bound client path (set via openWorkspace reading workspace.json)
    expect(useWorkspaceStore.getState().clientPath).toBe(path.resolve(tmpBase));

    // workspace.json must have been written with the correct binding meta
    // Use getStudioDir (not a hardcoded .studio path) — D-06 relocated studio to app-root
    const studioDir = getStudioDir(path.resolve(tmpBase));
    const written = readWorkspaceJson(studioDir);
    expect(written.kind).toBe('client');
    expect(written.clientPath).toBe(path.resolve(tmpBase));

    // mountSearchableAsync must have been called with the fixture's .tre paths
    expect(nativeMocks.mountSearchableAsync).toHaveBeenCalledOnce();
    const calls = nativeMocks.mountSearchableAsync.mock.calls;
    const [calledPaths, calledPriorities] = calls[0] as [string[], number[]];
    expect(calledPaths).toHaveLength(trePaths.length);
    expect(calledPaths.every((p: string) => p.endsWith('.tre'))).toBe(true);
    // Priorities are 1-based ascending (matching the manual Mount Archive… pattern)
    expect(calledPriorities).toHaveLength(trePaths.length);
    expect(calledPriorities[0]).toBeGreaterThanOrEqual(1);
  });

  it('Test 4: non-client (empty) folder → clientPath:null, kind:mod-project, no mountSearchableAsync', async () => {
    // tmpBase is empty — no cfg, no .tre files → mod-project
    await initProject(tmpBase);

    // mountSearchableAsync must NOT have been called
    expect(nativeMocks.mountSearchableAsync).not.toHaveBeenCalled();

    // treStore must remain idle (no mount occurred)
    expect(useTreStore.getState().mountHandle).toBeNull();
    expect(useTreStore.getState().mountStatus).toEqual({ kind: 'idle' });

    // workspace.json must record the non-client binding
    const studioDir = path.join(path.resolve(tmpBase), '.studio');
    const written = readWorkspaceJson(studioDir);
    expect(written.kind).toBe('mod-project');
    expect(written.clientPath).toBeNull();
  });
});
