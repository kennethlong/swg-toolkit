/**
 * packages/renderer/src/services/decorationPersistOrchestrator.test.ts
 * 05.1-06 Task 1: per-project mirrorToStockIlf threading, transactional reconcileMirrorMode
 * (D-08/D-09), capture.kind branching (add / arm-failed), and the resolved-value return (C7).
 *
 * Mocking strategy for the native addon: `vi.mock('@swg/live-inject', ...)` does NOT intercept
 * a bare `require('@swg/live-inject')` (vi.mock hooks ESM import resolution, not CJS require —
 * established pattern, see useCommandWriter.test.ts). Instead: require the REAL (singleton,
 * process-cached) addon object directly in THIS file and monkey-patch `writeRebind` with a
 * vi.fn() BEFORE decorationPersistOrchestrator.ts is ever loaded (via a dynamic import() inside
 * beforeAll), so its own top-level `require('@swg/live-inject')` resolves to the SAME patched
 * object.
 *
 * `./clientLocator` and `./looseOverrideDeploy` ARE real ES modules (not native addons) — vi.mock
 * works normally for those, redirecting resolveRunningClientOverrideDir to a real temp dir
 * without touching the filesystem-scanning client detector.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { DecorationCapture } from '@swg/contracts';

import { serializeIffTree, type IffChunk } from './iffTree';
import { serializeIlf, parseIlf, type IlfNode } from './ilf';
import { readInteriorLayoutFileName } from './buildingTemplate';
import { writeWorkspaceJson, readWorkspaceJson } from './projectBinding';
import { useWorldEditorStore } from '../state/worldEditorStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as { writeRebind: ReturnType<typeof vi.fn> };
addon.writeRebind = vi.fn();

const CLIENT_EXE = 'C:/TestClient/SwgClient_r.exe';
const CLIENT_INSTALL = 'C:/TestClient';

vi.mock('./clientLocator', () => ({
  detectClients: vi.fn(() => [
    { name: 'Test Client', installPath: CLIENT_INSTALL, cfgRootPath: 'C:/TestClient/swgemu.cfg', treVersion: 'v0005' },
  ]),
}));

let OVERRIDE_DIR = '';
vi.mock('./looseOverrideDeploy', () => ({
  resolveOverrideDir: vi.fn(() => OVERRIDE_DIR),
}));

let handleDecorationCapture: typeof import('./decorationPersistOrchestrator').handleDecorationCapture;
let reconcileMirrorMode: typeof import('./decorationPersistOrchestrator').reconcileMirrorMode;
let makeReadVfs: typeof import('./decorationPersistOrchestrator').makeReadVfs;
let _clearOverrideDirCache: typeof import('./decorationPersistOrchestrator')._clearOverrideDirCache;

beforeAll(async () => {
  const mod = await import('./decorationPersistOrchestrator');
  handleDecorationCapture = mod.handleDecorationCapture;
  reconcileMirrorMode = mod.reconcileMirrorMode;
  makeReadVfs = mod.makeReadVfs;
  _clearOverrideDirCache = mod._clearOverrideDirCache;
});

// ── Synthetic stock building template (SBOT → DERV + interiorLayoutFileName param) ─────────────
function synthSbot(ilfVfsPath: string, baseVfsPath = 'object/building/base/shared_base.iff'): Buffer {
  const pcnt = (n: number): IffChunk => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n, 0);
    return { kind: 'leaf', tag: 'PCNT', payload: b };
  };
  const derv: IffChunk = {
    kind: 'form', tag: 'FORM', subType: 'DERV',
    children: [{ kind: 'leaf', tag: 'XXXX', payload: Buffer.from(`${baseVfsPath}\0`, 'ascii') }],
  };
  const ilfParam: IffChunk = {
    kind: 'leaf', tag: 'XXXX',
    payload: Buffer.concat([Buffer.from('interiorLayoutFileName\0', 'ascii'), Buffer.from([0x01]), Buffer.from(`${ilfVfsPath}\0`, 'ascii')]),
  };
  const f0001: IffChunk = { kind: 'form', tag: 'FORM', subType: '0001', children: [pcnt(1), ilfParam] };
  const stot: IffChunk = { kind: 'form', tag: 'FORM', subType: 'STOT', children: [pcnt(0)] };
  return serializeIffTree([{ kind: 'form', tag: 'FORM', subType: 'SBOT', children: [derv, f0001, stot] }]);
}

const CELL = 'cell1';
const TABLE = 'object/tangible/furniture/shared_frn_table.iff';
const origTable = [1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7];
const newTable = [1, 0, 0, 50, 0, 1, 0, 60, 0, 0, 1, 70];

function makeStockIlf(): Buffer {
  const nodes: IlfNode[] = [{ objectTemplateName: TABLE, cellName: CELL, transform: origTable }];
  return serializeIlf(nodes);
}

// ── Real fs fixture: places the stock building template as a LOOSE file in overrideDir so
//    makeReadVfs's override-dir-first check resolves it without needing treStore at all. ──────
function seedStockBuilding(overrideDir: string, buildingVfs: string, ilfVfsPath: string, baseVfsPath?: string): void {
  const stockIff = synthSbot(ilfVfsPath, baseVfsPath);
  const abs = path.join(overrideDir, ...buildingVfs.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, stockIff);
  const ilfAbs = path.join(overrideDir, ...ilfVfsPath.split('/'));
  fs.mkdirSync(path.dirname(ilfAbs), { recursive: true });
  fs.writeFileSync(ilfAbs, makeStockIlf());
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-toolkit-orch-test-'));
  OVERRIDE_DIR = path.join(tmpRoot, 'override');
  fs.mkdirSync(OVERRIDE_DIR, { recursive: true });
  _clearOverrideDirCache();
  (addon.writeRebind as ReturnType<typeof vi.fn>).mockClear();
  useWorldEditorStore.setState({ history: [], hasFailureBadge: false });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const BUILDING_ID = '1082878';
const BUILDING_VFS = 'object/building/tatooine/shared_cantina_tatooine.iff';
const STOCK_ILF_VFS = 'interiorlayout/shared_cantina_mos_eisley_tatooine.ilf';

const baseCapture: DecorationCapture = {
  buildingInstanceId: BUILDING_ID,
  buildingTemplateVfsPath: BUILDING_VFS,
  decorationTemplateName: TABLE,
  originalO2p: origTable,
  newO2p: newTable,
};

describe('handleDecorationCapture — mirrorToStockIlf resolution (D-08, C7)', () => {
  it('resolves to true when studioDir is null (no bound project) — no regression', () => {
    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    const r = handleDecorationCapture(1, baseCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir: null });
    expect(r.mirrorToStockIlf).toBe(true);
    expect(addon.writeRebind).toHaveBeenCalledWith('m', 1, BUILDING_ID, expect.any(String), 0x1); // APPLY only
  });

  it('ROUND 3/R1: a ctx object that OMITS studioDir entirely behaves identically to null', () => {
    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    const r = handleDecorationCapture(1, baseCapture, { mappingName: 'm', clientExe: CLIENT_EXE });
    expect(r.mirrorToStockIlf).toBe(true);
  });

  it('resolves to true when studioDir is set but workspace.json has no explicit setting (default)', () => {
    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    const studioDir = path.join(tmpRoot, 'studio');
    writeWorkspaceJson(studioDir, { kind: 'mod-project', clientPath: null });
    const r = handleDecorationCapture(1, baseCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir });
    expect(r.mirrorToStockIlf).toBe(true);
  });

  it('resolves to the explicit per-project override (false) and sends the D-10 MIRROR_OFF bit', () => {
    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    const studioDir = path.join(tmpRoot, 'studio');
    writeWorkspaceJson(studioDir, { kind: 'mod-project', clientPath: null, mirrorToStockIlf: false });
    const r = handleDecorationCapture(1, baseCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir });
    expect(r.mirrorToStockIlf).toBe(false);
    const flags = (addon.writeRebind as ReturnType<typeof vi.fn>).mock.calls[0][4] as number;
    expect(flags & 0x1).toBe(0x1); // APPLY
    expect(flags & 0x4).toBe(0x4); // MIRROR_OFF
  });

  it('mirrorToStockIlf=true asserts APPLY set and MIRROR_OFF NOT set (bitwise, not just truthy)', () => {
    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    handleDecorationCapture(1, baseCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir: null });
    const flags = (addon.writeRebind as ReturnType<typeof vi.fn>).mock.calls[0][4] as number;
    expect(flags & 0x1).toBe(0x1);
    expect(flags & 0x4).toBe(0);
  });

  it('C7: the resolved value is IDENTICAL for both the success path and a forced-throw path', () => {
    const studioDir = path.join(tmpRoot, 'studio');
    writeWorkspaceJson(studioDir, { kind: 'mod-project', clientPath: null, mirrorToStockIlf: false });

    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    const okResult = handleDecorationCapture(1, baseCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir });
    expect(okResult.mirrorToStockIlf).toBe(false);

    // Force assembleDecorationEdit to throw: an unresolvable decoration (no matching row).
    const failCapture: DecorationCapture = { ...baseCapture, decorationTemplateName: 'object/tangible/nope.iff' };
    const failResult = handleDecorationCapture(2, failCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir });
    expect(failResult.mirrorToStockIlf).toBe(false); // SAME resolved value — not re-derived per exit
    expect(failResult.cellName).toBeUndefined();
    expect(failResult.rowIndex).toBeUndefined();
    // ABORT sent for the failed capture.
    const lastCall = (addon.writeRebind as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(lastCall[4]).toBe(0x2); // ABORT
  });
});

describe('handleDecorationCapture — capture.kind branching (D-01/C8/MED-10)', () => {
  it("C8: kind='arm-failed' calls recordArmFailure with the exact reason string and touches nothing else", () => {
    const spy = vi.fn();
    useWorldEditorStore.setState({ recordArmFailure: spy });
    const armFailedCapture: DecorationCapture = {
      ...baseCapture,
      kind: 'arm-failed',
      cellName: 'no building id — hover a decoration...',
    };
    const r = handleDecorationCapture(1, armFailedCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir: null });
    expect(spy).toHaveBeenCalledWith('no building id — hover a decoration...');
    expect(addon.writeRebind).not.toHaveBeenCalled();
    expect(r).toEqual({ mirrorToStockIlf: true });
    useWorldEditorStore.setState({ recordArmFailure: useWorldEditorStore.getState().recordArmFailure });
  });

  // (C7) The arm-failed short-circuit is one of the three exit paths C7 names explicitly; it must
  // return the RESOLVED per-project value, not a literal. Plan 08 stashes this value and reuses it
  // at RESULT time instead of re-reading settings, so a literal here would reintroduce exactly the
  // "resolved twice, can disagree" gap C7 exists to close.
  it('arm-failed returns the RESOLVED mirrorToStockIlf (false) when the project setting is false', () => {
    const studioDir = path.join(tmpRoot, 'studio');
    writeWorkspaceJson(studioDir, { kind: 'mod-project', clientPath: null, mirrorToStockIlf: false });
    const spy = vi.fn();
    useWorldEditorStore.setState({ recordArmFailure: spy });
    const r = handleDecorationCapture(1, { ...baseCapture, kind: 'arm-failed', cellName: 'reason' }, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir });
    expect(r).toEqual({ mirrorToStockIlf: false });
  });

  it("arm-failed uses the fallback reason string when cellName is absent", () => {
    const spy = vi.fn();
    useWorldEditorStore.setState({ recordArmFailure: spy });
    handleDecorationCapture(1, { ...baseCapture, kind: 'arm-failed', cellName: undefined }, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir: null });
    expect(spy).toHaveBeenCalledWith('(unknown arm failure)');
  });

  it("kind='add' with a cellName reaches assembleDecorationEdit's kind='add' path (appends a row)", () => {
    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    const RUG = 'object/tangible/furniture/shared_frn_rug.iff';
    const newRug = [1, 0, 0, 15, 0, 1, 0, 16, 0, 0, 1, 17];
    const addCapture: DecorationCapture = { ...baseCapture, kind: 'add', cellName: CELL, decorationTemplateName: RUG, newO2p: newRug };
    const r = handleDecorationCapture(1, addCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir: null });
    expect(r.rowIndex).toBe(1); // stock ilf already has the table at row 0
    expect(r.cellName).toBe(CELL);
    const editedPath = path.join(OVERRIDE_DIR, 'interiorlayout', 'toolkit', `edit_${BUILDING_ID}.ilf`);
    const editedIlf = parseIlf(fs.readFileSync(editedPath));
    expect(editedIlf).toHaveLength(2);
    expect(editedIlf[0].transform).toEqual(origTable); // untouched
    expect(editedIlf[1]).toEqual({ objectTemplateName: RUG, cellName: CELL, transform: newRug });
  });

  it("ROUND 3/MED-10: an EDIT capture (kind omitted) with a stray cellName still resolves via resolveNode (never pinned)", () => {
    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    // A stale/leftover cellName pointing at a cell that doesn't exist — if it were threaded
    // through unconditionally, assembleDecorationEdit's resolveRowIndex(pinned) lookup would
    // fail and this capture would ABORT instead of succeeding via resolveNode.
    const staleCellCapture: DecorationCapture = { ...baseCapture, cellName: 'totally_wrong_cell' };
    const r = handleDecorationCapture(1, staleCellCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir: null });
    expect(r.cellName).toBe(CELL); // resolved via resolveNode, not the stale hint
    expect(addon.writeRebind).toHaveBeenCalledWith('m', 1, BUILDING_ID, expect.any(String), 0x1); // APPLY, not ABORT
  });

  it('ROUND 3/R5: a successful edit capture returns the exact cellName/rowIndex assembleDecorationEdit resolved', () => {
    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    const r = handleDecorationCapture(1, baseCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir: null });
    expect(r.cellName).toBe(CELL);
    expect(r.rowIndex).toBe(0);
  });
});

describe('handleDecorationCapture — ROUND 3/R3: durable worldEditorBuildingTemplates map', () => {
  it('a successful capture with a bound studioDir merges buildingTemplateVfsPath into the durable map, preserving prior entries', () => {
    seedStockBuilding(OVERRIDE_DIR, BUILDING_VFS, STOCK_ILF_VFS);
    const studioDir = path.join(tmpRoot, 'studio');
    writeWorkspaceJson(studioDir, {
      kind: 'mod-project',
      clientPath: null,
      worldEditorBuildingTemplates: { some_other_building: 'object/building/other.iff' },
    });
    handleDecorationCapture(1, baseCapture, { mappingName: 'm', clientExe: CLIENT_EXE, studioDir });
    const map = readWorkspaceJson(studioDir).worldEditorBuildingTemplates;
    expect(map).toEqual({
      some_other_building: 'object/building/other.iff',
      [BUILDING_ID]: BUILDING_VFS,
    });
  });
});

describe('makeReadVfs — ROUND 3/R4 export', () => {
  it('is importable from outside this module', () => {
    expect(typeof makeReadVfs).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reconcileMirrorMode (D-09, ROUND 4/W1, ROUND 5/V4/V7/V8)
// ─────────────────────────────────────────────────────────────────────────────

const STOCK_A_VFS = 'object/building/test/shared_bldg_a.iff';
const STOCK_B_VFS = 'object/building/test/shared_bldg_b.iff';
const ILF_A_VFS = 'interiorlayout/shared_layout_a.ilf';
const ILF_B_VFS = 'interiorlayout/shared_layout_b.ilf';

/** Places a "worked" building in overrideDir (edit_<id>.ilf + edit_<id>.iff — the SAME on-disk
 *  layout scanWorldEditorState expects) and returns the stock building bytes for a readVfs map. */
function seedEditedBuilding(overrideDir: string, buildingId: string, stockIlfVfs: string, transform: number[]): void {
  const nodes: IlfNode[] = [{ objectTemplateName: TABLE, cellName: CELL, transform }];
  const editedIlfAbs = path.join(overrideDir, 'interiorlayout', 'toolkit', `edit_${buildingId}.ilf`);
  fs.mkdirSync(path.dirname(editedIlfAbs), { recursive: true });
  fs.writeFileSync(editedIlfAbs, serializeIlf(nodes));

  const derivedAbs = path.join(overrideDir, 'object', 'building', 'toolkit', `edit_${buildingId}.iff`);
  fs.mkdirSync(path.dirname(derivedAbs), { recursive: true });
  fs.writeFileSync(derivedAbs, synthSbot(`interiorlayout/toolkit/edit_${buildingId}.ilf`));
  void stockIlfVfs;
}

function makeReadVfsMap(map: Record<string, Buffer>): (vfsPath: string) => Buffer {
  return (vfsPath: string): Buffer => {
    if (map[vfsPath]) return map[vfsPath];
    throw new Error(`readVfs: not found: ${vfsPath}`);
  };
}

describe('reconcileMirrorMode — ROUND-3-REVIEW R1 (two-arg scan; unknown blocks ALL, incl. known)', () => {
  it('a building missing from worldEditorBuildingTemplates blocks the WHOLE pass, including a KNOWN sibling', () => {
    const studioDir = path.join(tmpRoot, 'studio');
    // Only 'known' is in the durable map — 'unknown' is not.
    writeWorkspaceJson(studioDir, { kind: 'mod-project', clientPath: null, worldEditorBuildingTemplates: { known: STOCK_A_VFS } });

    seedEditedBuilding(OVERRIDE_DIR, 'known', ILF_A_VFS, newTable);
    seedEditedBuilding(OVERRIDE_DIR, 'unknown', ILF_B_VFS, newTable);

    const readVfs = makeReadVfsMap({ [STOCK_A_VFS]: synthSbot(ILF_A_VFS) });
    const { failures } = reconcileMirrorMode(studioDir, OVERRIDE_DIR, readVfs, true);

    expect(failures).toHaveLength(1);
    expect(failures[0].buildingId).toBe('unknown');
    expect(failures[0].diskState).toBe('unchanged');
    // ROUND 5/V8: both remedies present.
    expect(failures[0].error).toContain('arm/persist a decoration in it once to populate it');
    expect(failures[0].error).toContain('to unblock the toggle for the rest of the project');

    // 'known' building's mirror was NEVER written this call, despite its path being known.
    const knownMirrorAbs = path.join(OVERRIDE_DIR, ILF_A_VFS);
    expect(fs.existsSync(knownMirrorAbs)).toBe(false);

    // The flag was never persisted.
    expect(readWorkspaceJson(studioDir).mirrorToStockIlf).toBeUndefined();
  });
});

describe('reconcileMirrorMode — clean pass (ON→OFF, OFF→ON) — R6 flag atomicity', () => {
  it('OFF→ON: two buildings both gain a stock-path mirror matching their edited .ilf bytes exactly; flag persists', () => {
    const studioDir = path.join(tmpRoot, 'studio');
    writeWorkspaceJson(studioDir, {
      kind: 'mod-project', clientPath: null,
      worldEditorBuildingTemplates: { bldgA: STOCK_A_VFS, bldgB: STOCK_B_VFS },
    });
    seedEditedBuilding(OVERRIDE_DIR, 'bldgA', ILF_A_VFS, newTable);
    seedEditedBuilding(OVERRIDE_DIR, 'bldgB', ILF_B_VFS, [1, 0, 0, 99, 0, 1, 0, 98, 0, 0, 1, 97]);

    const readVfs = makeReadVfsMap({ [STOCK_A_VFS]: synthSbot(ILF_A_VFS), [STOCK_B_VFS]: synthSbot(ILF_B_VFS) });
    const { failures } = reconcileMirrorMode(studioDir, OVERRIDE_DIR, readVfs, true);

    expect(failures).toHaveLength(0);
    const mirrorA = parseIlf(fs.readFileSync(path.join(OVERRIDE_DIR, ILF_A_VFS)));
    const mirrorB = parseIlf(fs.readFileSync(path.join(OVERRIDE_DIR, ILF_B_VFS)));
    expect(mirrorA[0].transform).toEqual(newTable);
    expect(mirrorB[0].transform).toEqual([1, 0, 0, 99, 0, 1, 0, 98, 0, 0, 1, 97]);
    expect(readWorkspaceJson(studioDir).mirrorToStockIlf).toBe(true);
  });

  it('ON→OFF: both mirror files are removed; flag persists false', () => {
    const studioDir = path.join(tmpRoot, 'studio');
    writeWorkspaceJson(studioDir, {
      kind: 'mod-project', clientPath: null, mirrorToStockIlf: true,
      worldEditorBuildingTemplates: { bldgA: STOCK_A_VFS, bldgB: STOCK_B_VFS },
    });
    seedEditedBuilding(OVERRIDE_DIR, 'bldgA', ILF_A_VFS, newTable);
    seedEditedBuilding(OVERRIDE_DIR, 'bldgB', ILF_B_VFS, newTable);
    fs.mkdirSync(path.dirname(path.join(OVERRIDE_DIR, ILF_A_VFS)), { recursive: true });
    fs.writeFileSync(path.join(OVERRIDE_DIR, ILF_A_VFS), serializeIlf([{ objectTemplateName: TABLE, cellName: CELL, transform: newTable }]));
    fs.mkdirSync(path.dirname(path.join(OVERRIDE_DIR, ILF_B_VFS)), { recursive: true });
    fs.writeFileSync(path.join(OVERRIDE_DIR, ILF_B_VFS), serializeIlf([{ objectTemplateName: TABLE, cellName: CELL, transform: newTable }]));

    const readVfs = makeReadVfsMap({ [STOCK_A_VFS]: synthSbot(ILF_A_VFS), [STOCK_B_VFS]: synthSbot(ILF_B_VFS) });
    const { failures } = reconcileMirrorMode(studioDir, OVERRIDE_DIR, readVfs, false);

    expect(failures).toHaveLength(0);
    expect(fs.existsSync(path.join(OVERRIDE_DIR, ILF_A_VFS))).toBe(false);
    expect(fs.existsSync(path.join(OVERRIDE_DIR, ILF_B_VFS))).toBe(false);
    expect(readWorkspaceJson(studioDir).mirrorToStockIlf).toBe(false);
  });
});

describe('reconcileMirrorMode — ROUND 4/W1: transactional on DISK, not just the flag', () => {
  it('a mid-pass throw on the SECOND building rolls back the FIRST, never touches the THIRD, and never persists the flag', () => {
    // NTFS/Windows readdirSync returns directory-index (filename-sorted) order for a fresh dir —
    // relied on here for a deterministic aaa < bbb < ccc scan order.
    const studioDir = path.join(tmpRoot, 'studio');
    const STOCK_C_VFS = 'object/building/test/shared_bldg_c.iff';
    const ILF_C_VFS = 'interiorlayout/shared_layout_c.ilf';
    writeWorkspaceJson(studioDir, {
      kind: 'mod-project', clientPath: null,
      worldEditorBuildingTemplates: { aaa: STOCK_A_VFS, bbb: STOCK_B_VFS, ccc: STOCK_C_VFS },
    });
    seedEditedBuilding(OVERRIDE_DIR, 'aaa', ILF_A_VFS, newTable);
    seedEditedBuilding(OVERRIDE_DIR, 'bbb', ILF_B_VFS, newTable);
    seedEditedBuilding(OVERRIDE_DIR, 'ccc', ILF_C_VFS, newTable);

    // Force the SECOND building's (bbb) mirror write to throw — a real fs.writeFileSync spy that
    // throws only for bbb's resolved mirror path, calling through to the real implementation for
    // every other path (aaa, ccc — and every fs.writeFileSync call decorationPersist.ts/projectBinding.ts
    // make elsewhere in this test, e.g. seedEditedBuilding's own writes already ran before this spy).
    const bbbMirrorAbs = path.resolve(path.join(OVERRIDE_DIR, ILF_B_VFS));
    const realWrite = fs.writeFileSync;
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((p: fs.PathOrFileDescriptor, data: unknown, opts?: unknown) => {
      if (typeof p === 'string' && path.resolve(p) === bbbMirrorAbs) {
        throw new Error('simulated write failure (bbb mirror path)');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (realWrite as any)(p, data, opts);
    });

    const readVfs = makeReadVfsMap({
      [STOCK_A_VFS]: synthSbot(ILF_A_VFS),
      [STOCK_B_VFS]: synthSbot(ILF_B_VFS),
      [STOCK_C_VFS]: synthSbot(ILF_C_VFS),
    });
    const { failures } = reconcileMirrorMode(studioDir, OVERRIDE_DIR, readVfs, true);

    writeSpy.mockRestore();

    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures.some((f) => f.buildingId === 'bbb')).toBe(true);
    for (const f of failures) expect(f.diskState).toBe('unchanged');

    // aaa's mirror: either never written, or written-then-rolled-back — either way, ABSENT now.
    expect(fs.existsSync(path.join(OVERRIDE_DIR, ILF_A_VFS))).toBe(false);
    // ccc's write/delete was never attempted (phase 2 stopped at bbb's throw).
    expect(fs.existsSync(path.join(OVERRIDE_DIR, ILF_C_VFS))).toBe(false);

    expect(readWorkspaceJson(studioDir).mirrorToStockIlf).toBeUndefined();
  });
});

describe('reconcileMirrorMode — ROUND 5/V4: shared mirror path, correct rollback bytes, no double-act', () => {
  it('two buildings sharing ONE stock template: rollback restores the mirror\'s ACTUAL pre-call bytes (never re-derived), exactly once', () => {
    const studioDir = path.join(tmpRoot, 'studio');
    const STOCK_C_VFS = 'object/building/test/shared_bldg_c.iff';
    const ILF_C_VFS = 'interiorlayout/shared_layout_c.ilf';
    // aaa and bbb share the SAME stock template (and therefore the SAME resolved mirror path).
    writeWorkspaceJson(studioDir, {
      kind: 'mod-project', clientPath: null,
      worldEditorBuildingTemplates: { aaa: STOCK_A_VFS, bbb: STOCK_A_VFS, ccc: STOCK_C_VFS },
    });
    const aaaTransform = newTable;
    const bbbTransform = [1, 0, 0, 200, 0, 1, 0, 201, 0, 0, 1, 202];
    seedEditedBuilding(OVERRIDE_DIR, 'aaa', ILF_A_VFS, aaaTransform);
    seedEditedBuilding(OVERRIDE_DIR, 'bbb', ILF_A_VFS, bbbTransform);
    seedEditedBuilding(OVERRIDE_DIR, 'ccc', ILF_C_VFS, newTable);

    // Pre-existing shared mirror content DIFFERS from both aaa's and bbb's edited bytes — the
    // "wrong-derivation" bug (re-deriving from a building's editedIlfBytes) is detectable only
    // if the seeded bytes are distinct from either.
    const preCallTransform = [1, 0, 0, 555, 0, 1, 0, 556, 0, 0, 1, 557];
    const preCallBytes = serializeIlf([{ objectTemplateName: TABLE, cellName: CELL, transform: preCallTransform }]);
    const sharedMirrorAbs = path.join(OVERRIDE_DIR, ILF_A_VFS);
    fs.mkdirSync(path.dirname(sharedMirrorAbs), { recursive: true });
    fs.writeFileSync(sharedMirrorAbs, preCallBytes);

    // ccc's delete throws (directory in place of a file) — forces a mid-pass rollback.
    const cccMirrorAbs = path.join(OVERRIDE_DIR, ILF_C_VFS);
    fs.mkdirSync(cccMirrorAbs, { recursive: true });

    const readVfs = makeReadVfsMap({
      [STOCK_A_VFS]: synthSbot(ILF_A_VFS),
      [STOCK_C_VFS]: synthSbot(ILF_C_VFS),
    });

    const unlinkSpy = vi.spyOn(fs, 'unlinkSync');
    const writeSpy = vi.spyOn(fs, 'writeFileSync');

    const { failures } = reconcileMirrorMode(studioDir, OVERRIDE_DIR, readVfs, false); // OFF: delete direction

    // Capture call history BEFORE mockRestore() — mockRestore() also clears recorded calls.
    const sharedCallsUnlink = unlinkSpy.mock.calls.filter((c) => path.resolve(String(c[0])) === path.resolve(sharedMirrorAbs));
    const sharedCallsWrite = writeSpy.mock.calls.filter((c) => path.resolve(String(c[0])) === path.resolve(sharedMirrorAbs));
    unlinkSpy.mockRestore();
    writeSpy.mockRestore();

    expect(failures.length).toBeGreaterThanOrEqual(1);

    // The shared mirror is restored with the EXACT pre-call bytes (byte-equality against the
    // fixture, NOT against aaa's or bbb's editedIlfBytes).
    expect(fs.existsSync(sharedMirrorAbs)).toBe(true);
    const restored = parseIlf(fs.readFileSync(sharedMirrorAbs));
    expect(restored[0].transform).toEqual(preCallTransform);

    // Exactly one delete + one restore-write touched the shared path (never two of either).
    expect(sharedCallsUnlink).toHaveLength(1);
    expect(sharedCallsWrite).toHaveLength(1);
  });
});

describe('reconcileMirrorMode — ROUND 5/V7: rollback double-fault → diskState uncertain', () => {
  it('a rollback step that itself throws is marked uncertain; sibling failures stay unchanged', () => {
    const studioDir = path.join(tmpRoot, 'studio');
    const STOCK_C_VFS = 'object/building/test/shared_bldg_c.iff';
    const ILF_C_VFS = 'interiorlayout/shared_layout_c.ilf';
    writeWorkspaceJson(studioDir, {
      kind: 'mod-project', clientPath: null,
      worldEditorBuildingTemplates: { aaa: STOCK_A_VFS, bbb: STOCK_B_VFS, ccc: STOCK_C_VFS },
    });
    seedEditedBuilding(OVERRIDE_DIR, 'aaa', ILF_A_VFS, newTable);
    seedEditedBuilding(OVERRIDE_DIR, 'bbb', ILF_B_VFS, newTable);
    seedEditedBuilding(OVERRIDE_DIR, 'ccc', ILF_C_VFS, newTable);

    const readVfs = makeReadVfsMap({
      [STOCK_A_VFS]: synthSbot(ILF_A_VFS),
      [STOCK_B_VFS]: synthSbot(ILF_B_VFS),
      [STOCK_C_VFS]: synthSbot(ILF_C_VFS),
    });

    // ccc's write throws (triggers rollback of aaa, already applied). aaa's OWN rollback (a
    // delete, since 'wrote' inverse = delete) ALSO throws — the double-fault (T-05.1-06d). Both
    // forced via a single fs spy, real fs.writeFileSync/unlinkSync used for everything else.
    const aaaMirrorAbs = path.resolve(path.join(OVERRIDE_DIR, ILF_A_VFS));
    const cccMirrorAbs = path.resolve(path.join(OVERRIDE_DIR, ILF_C_VFS));
    const realWrite = fs.writeFileSync;
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation((p: fs.PathOrFileDescriptor, data: unknown, opts?: unknown) => {
      if (typeof p === 'string' && path.resolve(p) === cccMirrorAbs) {
        throw new Error('simulated write failure (ccc mirror path)');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (realWrite as any)(p, data, opts);
    });
    const realUnlink = fs.unlinkSync;
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation((p: fs.PathLike) => {
      if (path.resolve(String(p)) === aaaMirrorAbs) {
        throw new Error('simulated double-fault: locked by the running client');
      }
      return realUnlink(p);
    });

    const { failures } = reconcileMirrorMode(studioDir, OVERRIDE_DIR, readVfs, true); // ON: write direction

    unlinkSpy.mockRestore();
    writeSpy.mockRestore();

    const aaaFailure = failures.find((f) => f.buildingId === 'aaa');
    const cccFailure = failures.find((f) => f.buildingId === 'ccc');
    expect(aaaFailure?.diskState).toBe('uncertain'); // the double-faulted rollback
    expect(cccFailure?.diskState).toBe('unchanged'); // the original throw — disk never touched for ccc
  });
});
