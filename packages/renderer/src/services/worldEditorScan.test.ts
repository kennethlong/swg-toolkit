/**
 * packages/renderer/src/services/worldEditorScan.test.ts
 * Disk-scan-as-truth building tree (D-05) — synthetic temp-dir fixture, real fs.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { serializeIffTree, type IffChunk } from './iffTree';
import { serializeIlf, removeNode, type IlfNode } from './ilf';
import { scanWorldEditorState, resolveScanRoot } from './worldEditorScan';

vi.mock('./clientLocator', () => ({ detectClients: vi.fn() }));
vi.mock('./looseOverrideDeploy', () => ({ resolveOverrideDir: vi.fn() }));

// ── Synthetic derived-template fixture (matches buildingTemplate.test.ts's style) ──
function synthDerivedTemplate(basePath: string): Buffer {
  const derv: IffChunk = {
    kind: 'form', tag: 'FORM', subType: 'DERV',
    children: [{ kind: 'leaf', tag: 'XXXX', payload: Buffer.from(`${basePath}\0`, 'ascii') }],
  };
  const form0001: IffChunk = { kind: 'form', tag: 'FORM', subType: '0001', children: [] };
  return serializeIffTree([{ kind: 'form', tag: 'FORM', subType: 'SBOT', children: [derv, form0001] }]);
}

const CELL = 'cell1';
const TABLE = 'object/tangible/furniture/shared_frn_table.iff';
const CHAIR = 'object/tangible/furniture/shared_frn_chair.iff';
const RUG = 'object/tangible/furniture/shared_frn_rug.iff';

function writeBuilding(
  overrideDir: string,
  id: string,
  nodes: IlfNode[],
  basePath: string | null,
): void {
  const ilfDir = path.join(overrideDir, 'interiorlayout', 'toolkit');
  fs.mkdirSync(ilfDir, { recursive: true });
  fs.writeFileSync(path.join(ilfDir, `edit_${id}.ilf`), serializeIlf(nodes));
  if (basePath !== null) {
    const tmplDir = path.join(overrideDir, 'object', 'building', 'toolkit');
    fs.mkdirSync(tmplDir, { recursive: true });
    fs.writeFileSync(path.join(tmplDir, `edit_${id}.iff`), synthDerivedTemplate(basePath));
  }
}

describe('scanWorldEditorState', () => {
  let overrideDir: string;

  beforeEach(() => {
    overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-world-scan-test-'));
  });
  afterEach(() => {
    fs.rmSync(overrideDir, { recursive: true, force: true });
  });

  it('scans a multi-building fixture with correct decoration counts', () => {
    writeBuilding(overrideDir, '1082874', [
      { objectTemplateName: TABLE, cellName: CELL, transform: Array(12).fill(0) },
      { objectTemplateName: CHAIR, cellName: CELL, transform: Array(12).fill(1) },
    ], 'object/building/base/shared_base_cantina.iff');
    writeBuilding(overrideDir, '2000001', [
      { objectTemplateName: RUG, cellName: 'cell2', transform: Array(12).fill(2) },
    ], 'object/building/base/shared_base_house.iff');

    const tree = scanWorldEditorState(overrideDir);
    expect(tree).toHaveLength(2);
    const b1 = tree.find((b) => b.buildingId === '1082874')!;
    const b2 = tree.find((b) => b.buildingId === '2000001')!;
    expect(b1.decorations).toHaveLength(2);
    expect(b1.decorations[0]).toEqual({ cellName: CELL, rowIndex: 0, objectTemplateName: TABLE, transform: Array(12).fill(0) });
    expect(b1.decorations[1]).toEqual({ cellName: CELL, rowIndex: 1, objectTemplateName: CHAIR, transform: Array(12).fill(1) });
    expect(b1.displayLabel).toBe('base_cantina');
    expect(b2.decorations).toHaveLength(1);
    expect(b2.displayLabel).toBe('base_house');
  });

  it('an orphaned .ilf (no paired .iff) still appears, with a numeric-id fallback label, never throws', () => {
    writeBuilding(overrideDir, '9999999', [
      { objectTemplateName: TABLE, cellName: CELL, transform: Array(12).fill(0) },
    ], null); // no paired template written

    const tree = scanWorldEditorState(overrideDir);
    expect(tree).toHaveLength(1);
    expect(tree[0].buildingId).toBe('9999999');
    expect(tree[0].displayLabel).toBe('9999999'); // fallback to raw id
    expect(tree[0].decorations).toHaveLength(1);
  });

  it('an empty/non-existent overrideDir returns an empty tree, not an error', () => {
    expect(scanWorldEditorState(overrideDir)).toEqual([]);
    expect(scanWorldEditorState(path.join(overrideDir, 'does-not-exist'))).toEqual([]);
  });

  it('rowIndex is recomputed fresh from the current parse pass, never cached (delete-then-rescan)', () => {
    writeBuilding(overrideDir, '1082874', [
      { objectTemplateName: TABLE, cellName: CELL, transform: Array(12).fill(0) },
      { objectTemplateName: CHAIR, cellName: CELL, transform: Array(12).fill(1) },
      { objectTemplateName: RUG, cellName: CELL, transform: Array(12).fill(2) },
    ], 'object/building/base/shared_base.iff');

    const before = scanWorldEditorState(overrideDir);
    expect(before[0].decorations.map((d) => d.rowIndex)).toEqual([0, 1, 2]);

    // Externally remove the middle row (table stays row 0, rug shifts from row 2 -> row 1).
    const ilfPath = path.join(overrideDir, 'interiorlayout', 'toolkit', 'edit_1082874.ilf');
    const before2 = scanWorldEditorState(overrideDir);
    void before2;
    const parsed = serializeIlf(
      removeNode(
        [
          { objectTemplateName: TABLE, cellName: CELL, transform: Array(12).fill(0) },
          { objectTemplateName: CHAIR, cellName: CELL, transform: Array(12).fill(1) },
          { objectTemplateName: RUG, cellName: CELL, transform: Array(12).fill(2) },
        ],
        CELL,
        1,
      ),
    );
    fs.writeFileSync(ilfPath, parsed);

    const after = scanWorldEditorState(overrideDir);
    expect(after[0].decorations).toHaveLength(2);
    expect(after[0].decorations.map((d) => d.objectTemplateName)).toEqual([TABLE, RUG]);
    expect(after[0].decorations.map((d) => d.rowIndex)).toEqual([0, 1]); // rug shifted down, not cached at 2
  });

  it('buildingTemplateVfsPath: seeded map returns the exact string; absent returns "" (ROUND 3, R3)', () => {
    writeBuilding(overrideDir, '1082874', [
      { objectTemplateName: TABLE, cellName: CELL, transform: Array(12).fill(0) },
    ], 'object/building/base/shared_base_cantina.iff');
    writeBuilding(overrideDir, '2000001', [
      { objectTemplateName: RUG, cellName: 'cell2', transform: Array(12).fill(2) },
    ], 'object/building/base/shared_base_house.iff');

    const tree = scanWorldEditorState(overrideDir, {
      '1082874': 'object/building/tatooine/shared_cantina_tatooine.iff',
    });
    const b1 = tree.find((b) => b.buildingId === '1082874')!;
    const b2 = tree.find((b) => b.buildingId === '2000001')!;
    expect(b1.buildingTemplateVfsPath).toBe('object/building/tatooine/shared_cantina_tatooine.iff');
    expect(b2.buildingTemplateVfsPath).toBe('');
  });

  it('defaults buildingTemplateVfsPath to "" for every building when the map param is omitted', () => {
    writeBuilding(overrideDir, '1082874', [
      { objectTemplateName: TABLE, cellName: CELL, transform: Array(12).fill(0) },
    ], 'object/building/base/shared_base_cantina.iff');
    const tree = scanWorldEditorState(overrideDir);
    expect(tree[0].buildingTemplateVfsPath).toBe('');
  });
});

describe('resolveScanRoot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null without throwing when offlineBinding is non-null but cfgPath is undefined (ROUND-3-REVIEW R9)', async () => {
    expect(resolveScanRoot(null, { cfgPath: undefined, clientPath: null })).toBeNull();
  });

  it('returns null when offlineBinding is null and no clientExe is given', () => {
    expect(resolveScanRoot(null, null)).toBeNull();
  });

  it('falls back to resolveOverrideDir(offlineBinding.cfgPath, offlineBinding.clientPath) when offline', async () => {
    const { resolveOverrideDir } = await import('./looseOverrideDeploy');
    vi.mocked(resolveOverrideDir).mockReturnValue('/resolved/override');
    const result = resolveScanRoot(null, { cfgPath: '/x/swgemu.cfg', clientPath: '/x' });
    expect(result).toBe('/resolved/override');
    expect(resolveOverrideDir).toHaveBeenCalledWith('/x/swgemu.cfg', '/x');
  });

  it('live-attached: matches the client by longest installPath prefix and resolves via its cfgRootPath', async () => {
    const { detectClients } = await import('./clientLocator');
    const { resolveOverrideDir } = await import('./looseOverrideDeploy');
    vi.mocked(detectClients).mockReturnValue([
      { name: 'A', installPath: 'D:/Games/SWG', cfgRootPath: 'D:/Games/SWG/swgemu.cfg', treVersion: 'v0005' },
    ]);
    vi.mocked(resolveOverrideDir).mockReturnValue('/live/override');

    const result = resolveScanRoot('D:/Games/SWG/SwgClient_r.exe', { cfgPath: '/offline/should-not-be-used.cfg', clientPath: null });
    expect(result).toBe('/live/override');
    expect(resolveOverrideDir).toHaveBeenCalledWith('D:/Games/SWG/swgemu.cfg', 'D:/Games/SWG');
  });

  it('live-attached: no client installPath matches the exe -> returns null (does not fall back to offline)', async () => {
    const { detectClients } = await import('./clientLocator');
    vi.mocked(detectClients).mockReturnValue([
      { name: 'A', installPath: 'D:/Other', cfgRootPath: 'D:/Other/swgemu.cfg', treVersion: 'v0005' },
    ]);
    const result = resolveScanRoot('D:/Games/SWG/SwgClient_r.exe', { cfgPath: '/x/swgemu.cfg', clientPath: '/x' });
    expect(result).toBeNull();
  });
});
