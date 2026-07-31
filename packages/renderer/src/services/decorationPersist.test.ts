/**
 * packages/renderer/src/services/decorationPersist.test.ts
 * Toolkit-side model-D assembly — dependency-injected, no real TRE/fs.
 */

import { describe, it, expect } from 'vitest';

import { assembleDecorationEdit, type DecorationEdit } from './decorationPersist';
import { serializeIffTree, type IffChunk } from './iffTree';
import { serializeIlf, parseIlf, type IlfNode } from './ilf';
import { readInteriorLayoutFileName } from './buildingTemplate';

// ── synthetic stock building template (interiorLayoutFileName = stockIlfVfs) ──
function synthSbot(ilf: string): Buffer {
  const pcnt = (n: number): IffChunk => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n, 0);
    return { kind: 'leaf', tag: 'PCNT', payload: b };
  };
  const derv: IffChunk = { kind: 'form', tag: 'FORM', subType: 'DERV',
    children: [{ kind: 'leaf', tag: 'XXXX', payload: Buffer.from('object/building/base/shared_base.iff\0', 'ascii') }] };
  const ilfParam: IffChunk = { kind: 'leaf', tag: 'XXXX',
    payload: Buffer.concat([Buffer.from('interiorLayoutFileName\0', 'ascii'), Buffer.from([0x01]), Buffer.from(`${ilf}\0`, 'ascii')]) };
  const f0001: IffChunk = { kind: 'form', tag: 'FORM', subType: '0001', children: [pcnt(1), ilfParam] };
  const stot: IffChunk = { kind: 'form', tag: 'FORM', subType: 'STOT', children: [pcnt(0)] };
  return serializeIffTree([{ kind: 'form', tag: 'FORM', subType: 'SBOT', children: [derv, f0001, stot] }]);
}

const BUILDING_VFS = 'object/building/tatooine/shared_cantina_tatooine.iff';
const STOCK_ILF_VFS = 'interiorlayout/shared_cantina_mos_eisley_tatooine.ilf';
const CELL = 'cell1';
const TABLE = 'object/tangible/furniture/shared_frn_table.iff';
const CHAIR = 'object/tangible/furniture/shared_frn_chair.iff';
const origTable = [1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7];
const origChair = [1, 0, 0, 8, 0, 1, 0, 9, 0, 0, 1, 10];
const newTable = [1, 0, 0, 50, 0, 1, 0, 60, 0, 0, 1, 70];

function makeStockIlf(): Buffer {
  const nodes: IlfNode[] = [
    { objectTemplateName: TABLE, cellName: CELL, transform: origTable },
    { objectTemplateName: CHAIR, cellName: CELL, transform: origChair },
  ];
  return serializeIlf(nodes);
}

function makeDeps() {
  const written = new Map<string, Buffer>();
  const stockIff = synthSbot(STOCK_ILF_VFS);
  const stockIlf = makeStockIlf();
  const deps = {
    overrideDir: '/override',
    readVfs: (vfs: string): Buffer => {
      if (vfs === BUILDING_VFS) return stockIff;
      if (vfs === STOCK_ILF_VFS) return stockIlf;
      // loose override reads resolve by their on-disk path (repeat-edit accumulation).
      const abs = `/override/${vfs}`;
      if (written.has(abs)) return written.get(abs)!;
      throw new Error(`not found: ${vfs}`);
    },
    writeFile: (abs: string, bytes: Buffer) => { written.set(abs.replace(/\\/g, '/'), bytes); },
  };
  return { deps, written };
}

const baseEdit: DecorationEdit = {
  buildingInstanceId: '1082878',
  buildingTemplateVfsPath: BUILDING_VFS,
  cellName: CELL,
  decorationTemplateName: TABLE,
  originalO2p: origTable,
  newO2p: newTable,
};

describe('assembleDecorationEdit', () => {
  it('resolves the row, writes edited .ilf + derived template, returns the right VFS paths', () => {
    const { deps, written } = makeDeps();
    const r = assembleDecorationEdit(baseEdit, deps);

    expect(r.rowIndex).toBe(0); // table is index 0 in cell1
    expect(r.editedIlfVfsPath).toBe('interiorlayout/toolkit/edit_1082878.ilf');
    expect(r.derivedTemplateVfsPath).toBe('object/building/toolkit/edit_1082878.iff');
    expect(r.stagedEntries.map((e) => e.action)).toEqual(['add', 'add']);

    // Edited .ilf: the table moved, the chair untouched.
    const editedIlf = parseIlf(written.get(r.editedIlfFilePath.replace(/\\/g, '/'))!);
    expect(editedIlf[0].transform).toEqual(newTable);
    expect(editedIlf[1].transform).toEqual(origChair);

    // Derived template points at the edited .ilf.
    const derived = written.get(r.derivedTemplateFilePath.replace(/\\/g, '/'))!;
    expect(readInteriorLayoutFileName(derived)).toBe('interiorlayout/toolkit/edit_1082878.ilf');
  });

  it('derives cellName from template + originalO2p when the agent omits it', () => {
    const { deps, written } = makeDeps();
    const { cellName, ...noCell } = baseEdit; // agent has no cheap getCellName → omit it
    void cellName;
    const r = assembleDecorationEdit(noCell, deps);

    expect(r.rowIndex).toBe(0);
    const editedIlf = parseIlf(written.get(r.editedIlfFilePath.replace(/\\/g, '/'))!);
    expect(editedIlf[0].transform).toEqual(newTable); // resolved & moved the right node
    expect(editedIlf[1].transform).toEqual(origChair);
  });

  it('fails closed (derive path) when no cell contains the picked decoration', () => {
    const { deps } = makeDeps();
    const { cellName, ...noCell } = baseEdit;
    void cellName;
    expect(() => assembleDecorationEdit({ ...noCell, decorationTemplateName: 'object/tangible/nope.iff' }, deps)).toThrow();
  });

  it('fails closed when the picked decoration cannot be resolved', () => {
    const { deps } = makeDeps();
    expect(() => assembleDecorationEdit({ ...baseEdit, cellName: 'nope' }, deps)).toThrow();
    expect(() => assembleDecorationEdit({ ...baseEdit, originalO2p: origTable.map((v, i) => (i === 3 ? v + 999 : v)) }, deps)).toThrow();
  });

  it('recovers from an orphaned edited .ilf (prior rebind failed): re-resolves against stock', () => {
    // A prior persist wrote the edited .ilf but its wsSetNodeTemplateName never landed, so the
    // live world still spawns from STOCK — the next Arm captures the stock o2p, which is absent
    // from the accumulated copy. The assembler must fall back to stock, not fail closed.
    const { deps, written } = makeDeps();
    assembleDecorationEdit(baseEdit, deps); // orphan: table row now newTable in the accumulated copy
    const { cellName, ...noCell } = baseEdit;
    void cellName;
    // Live capture: table still at its STOCK position (the failed rebind never changed the world).
    const r = assembleDecorationEdit({ ...noCell, originalO2p: origTable, newO2p: newTable }, deps);
    expect(r.rowIndex).toBe(0);
    const editedIlf = parseIlf(written.get(r.editedIlfFilePath.replace(/\\/g, '/'))!);
    expect(editedIlf[0].transform).toEqual(newTable); // re-based on stock + this edit
    expect(editedIlf[1].transform).toEqual(origChair);
  });

  it('mirrorToStockIlf: also writes the edited .ilf at the STOCK path as a modify entry', () => {
    const { deps, written } = makeDeps();
    const r = assembleDecorationEdit(baseEdit, { ...deps, mirrorToStockIlf: true });

    const mirrorAbs = `/override/${STOCK_ILF_VFS}`;
    const mirrored = parseIlf(written.get(mirrorAbs)!);
    expect(mirrored[0].transform).toEqual(newTable); // same edited content at the stock path
    expect(r.stagedEntries).toContainEqual({ virtualPath: STOCK_ILF_VFS, filePath: expect.stringContaining(STOCK_ILF_VFS.split('/').pop()!), action: 'modify' });
    expect(r.stagedEntries).toHaveLength(3);
  });

  it('accumulates a second edit (of the chair) on top of the first (of the table)', () => {
    const { deps, written } = makeDeps();
    assembleDecorationEdit(baseEdit, deps); // move the table
    const newChair = [1, 0, 0, 80, 0, 1, 0, 90, 0, 0, 1, 100];
    const r2 = assembleDecorationEdit(
      { ...baseEdit, decorationTemplateName: CHAIR, originalO2p: origChair, newO2p: newChair },
      deps,
    );
    const editedIlf = parseIlf(written.get(r2.editedIlfFilePath.replace(/\\/g, '/'))!);
    expect(editedIlf[0].transform).toEqual(newTable); // first edit preserved
    expect(editedIlf[1].transform).toEqual(newChair); // second edit applied
  });
});
