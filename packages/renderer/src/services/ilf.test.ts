/**
 * packages/renderer/src/services/ilf.test.ts
 * Round-trip + edit coverage for the .ilf reader/writer (model D consumer half).
 */

import { describe, it, expect } from 'vitest';

import { parseIlf, serializeIlf, editNodeTransform, resolveRowIndex, resolveNode, addNode, removeNode, type IlfNode } from './ilf';

const identity: number[] = [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]; // rot=I, pos=(10,20,30)

const sample: IlfNode[] = [
  { objectTemplateName: 'object/tangible/furniture/tatooine/shared_frn_tatt_table_cantina_table_3.iff',
    cellName: 'cell1', transform: identity },
  // float32-exact values so a round-trip through the format's f32 storage is value-exact
  { objectTemplateName: 'object/tangible/furniture/shared_frn_chair.iff',
    cellName: 'cell1', transform: [0.5, 0, 0.25, 1.5, 0, 1, 0, 2.5, -0.75, 0, 0.5, 3.5] },
  { objectTemplateName: 'object/tangible/furniture/shared_frn_lamp.iff',
    cellName: 'cell2', transform: [1, 0, 0, -4, 0, 1, 0, -5, 0, 0, 1, -6] },
];

describe('ilf parse/serialize round-trip', () => {
  it('serialize → parse returns identical nodes', () => {
    const buf = serializeIlf(sample);
    const parsed = parseIlf(buf);
    expect(parsed).toEqual(sample);
  });

  it('is byte-stable (parse → serialize → parse)', () => {
    const buf1 = serializeIlf(sample);
    const buf2 = serializeIlf(parseIlf(buf1));
    expect(buf2.equals(buf1)).toBe(true);
  });

  it('preserves node/order across cells (within-cell identity)', () => {
    const parsed = parseIlf(serializeIlf(sample));
    expect(parsed.map((n) => n.cellName)).toEqual(['cell1', 'cell1', 'cell2']);
    expect(parsed[1].objectTemplateName).toContain('shared_frn_chair');
  });
});

describe('ilf byte layout', () => {
  it('writes BE IFF headers, LE floats, and the INLY/0000/NODE structure', () => {
    const buf = serializeIlf([{ objectTemplateName: 'a', cellName: 'b', transform: identity }]);
    expect(buf.toString('ascii', 0, 4)).toBe('FORM');
    expect(buf.toString('ascii', 8, 12)).toBe('INLY');
    expect(buf.toString('ascii', 12, 16)).toBe('FORM');
    expect(buf.toString('ascii', 20, 24)).toBe('0000');
    expect(buf.toString('ascii', 24, 28)).toBe('NODE');
    // Outer FORM length is big-endian and equals total - 8 (header).
    expect(buf.readUInt32BE(4)).toBe(buf.length - 8);
    // NODE payload: "a\0" "b\0" then 12 LE floats — the first float (m00) = 1.0.
    const payloadStart = 28 + 4; // after NODE tag(4)+len(4) is at 28..; payload at 32
    const floatsStart = payloadStart + 2 + 2; // "a\0"(2) + "b\0"(2)
    expect(buf.readFloatLE(floatsStart)).toBeCloseTo(1.0);
  });
});

describe('editNodeTransform', () => {
  const moved = [0, 0, -1, 99, 0, 1, 0, 88, 1, 0, 0, 77];

  it('edits the Nth node in a cell, preserves everything else', () => {
    const out = editNodeTransform(sample, 'cell1', 1, moved); // the chair (2nd in cell1)
    expect(out[1].transform).toEqual(moved);
    expect(out[0]).toEqual(sample[0]);       // table untouched
    expect(out[2]).toEqual(sample[2]);       // lamp untouched
    expect(out).not.toBe(sample);            // new array
    expect(sample[1].transform).not.toEqual(moved); // input not mutated
  });

  it('resolves rowIndex 0 as the first node in that cell', () => {
    const out = editNodeTransform(sample, 'cell2', 0, moved); // the lamp (only node in cell2)
    expect(out[2].transform).toEqual(moved);
  });

  it('throws when (cell, rowIndex) does not resolve', () => {
    expect(() => editNodeTransform(sample, 'cell1', 5, moved)).toThrow();
    expect(() => editNodeTransform(sample, 'nope', 0, moved)).toThrow();
  });
});

describe('resolveRowIndex (pick → cell/rowIndex)', () => {
  // cell1 has two nodes (table @row0, chair @row1); cell2 has the lamp @row0.
  it('matches by cell + template + original o2p, returning the within-cell row index', () => {
    // chair is index 1 within cell1
    expect(resolveRowIndex(sample, 'cell1', sample[1].objectTemplateName, sample[1].transform)).toBe(1);
    // table is index 0 within cell1
    expect(resolveRowIndex(sample, 'cell1', sample[0].objectTemplateName, sample[0].transform)).toBe(0);
    // lamp is index 0 within cell2
    expect(resolveRowIndex(sample, 'cell2', sample[2].objectTemplateName, sample[2].transform)).toBe(0);
  });

  it('tolerates tiny float drift within epsilon', () => {
    const nudged = sample[1].transform.map((v, i) => (i === 3 ? v + 5e-4 : v)); // 0.5mm off in x
    expect(resolveRowIndex(sample, 'cell1', sample[1].objectTemplateName, nudged)).toBe(1);
  });

  it('returns null on no template match, wrong cell, or a far transform', () => {
    expect(resolveRowIndex(sample, 'cell1', 'object/tangible/nope.iff', sample[1].transform)).toBeNull();
    expect(resolveRowIndex(sample, 'cell9', sample[0].objectTemplateName, sample[0].transform)).toBeNull();
    const far = sample[0].transform.map((v, i) => (i === 3 ? v + 100 : v));
    expect(resolveRowIndex(sample, 'cell1', sample[0].objectTemplateName, far)).toBeNull();
  });
});

describe('resolveNode (pick → cellName + rowIndex, cell UNKNOWN)', () => {
  it('finds the node across cells and returns its cellName + within-cell rowIndex', () => {
    // chair: cell1, row 1
    expect(resolveNode(sample, sample[1].objectTemplateName, sample[1].transform))
      .toEqual({ cellName: 'cell1', rowIndex: 1 });
    // lamp: cell2, row 0
    expect(resolveNode(sample, sample[2].objectTemplateName, sample[2].transform))
      .toEqual({ cellName: 'cell2', rowIndex: 0 });
  });

  it('tolerates tiny float drift within epsilon', () => {
    const nudged = sample[2].transform.map((v, i) => (i === 7 ? v + 5e-4 : v));
    expect(resolveNode(sample, sample[2].objectTemplateName, nudged))
      .toEqual({ cellName: 'cell2', rowIndex: 0 });
  });

  it('returns null on no template match or a far transform', () => {
    expect(resolveNode(sample, 'object/tangible/nope.iff', sample[1].transform)).toBeNull();
    const far = sample[0].transform.map((v, i) => (i === 3 ? v + 100 : v));
    expect(resolveNode(sample, sample[0].objectTemplateName, far)).toBeNull();
  });

  it('disambiguates same template in different cells by o2p', () => {
    const twoCells: IlfNode[] = [
      { objectTemplateName: 'object/tangible/pot.iff', cellName: 'cellA', transform: [1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3] },
      { objectTemplateName: 'object/tangible/pot.iff', cellName: 'cellB', transform: [1, 0, 0, 9, 0, 1, 0, 8, 0, 0, 1, 7] },
    ];
    expect(resolveNode(twoCells, 'object/tangible/pot.iff', twoCells[1].transform))
      .toEqual({ cellName: 'cellB', rowIndex: 0 });
  });
});

describe('parseIlf validation', () => {
  it('rejects a non-INLY buffer', () => {
    expect(() => parseIlf(Buffer.from('not an ilf at all!!'))).toThrow();
  });
});

describe('addNode', () => {
  const newNode: IlfNode = {
    objectTemplateName: 'object/tangible/furniture/shared_frn_stool.iff',
    cellName: 'cell1',
    transform: [1, 0, 0, 11, 0, 1, 0, 22, 0, 0, 1, 33],
  };

  it('appends a new node at the end, returns a NEW array, does not mutate input', () => {
    const out = addNode(sample, newNode);
    expect(out).not.toBe(sample);
    expect(out.length).toBe(sample.length + 1);
    expect(out[out.length - 1]).toEqual(newNode);
    expect(out[out.length - 1]).not.toBe(newNode); // cloned, not aliased
    expect(sample.length).toBe(3); // input not mutated
  });

  it('never mutates newNode.transform', () => {
    const transformCopy = [...newNode.transform];
    addNode(sample, newNode);
    expect(newNode.transform).toEqual(transformCopy);
  });

  it("appended node's within-cell rowIndex is the count of prior nodes sharing its cellName", () => {
    // cell1 already has 2 nodes (table@0, chair@1) — appended node should resolve to rowIndex 2.
    const out = addNode(sample, newNode);
    expect(resolveRowIndex(out, 'cell1', newNode.objectTemplateName, newNode.transform)).toBe(2);
    expect(resolveNode(out, newNode.objectTemplateName, newNode.transform)).toEqual({ cellName: 'cell1', rowIndex: 2 });
  });

  it('appending into a brand-new cell resolves to rowIndex 0', () => {
    const brandNew: IlfNode = { objectTemplateName: 'object/tangible/furniture/shared_frn_rug.iff', cellName: 'cell3', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] };
    const out = addNode(sample, brandNew);
    expect(resolveRowIndex(out, 'cell3', brandNew.objectTemplateName, brandNew.transform)).toBe(0);
  });

  it('never throws (append is always valid)', () => {
    expect(() => addNode([], newNode)).not.toThrow();
    expect(() => addNode(sample, newNode)).not.toThrow();
  });

  it('serializeIlf(addNode(...)) round-trips byte-stable through parseIlf -> serializeIlf', () => {
    const added = addNode(sample, newNode);
    const buf1 = serializeIlf(added);
    const buf2 = serializeIlf(parseIlf(buf1));
    expect(buf2.equals(buf1)).toBe(true);
    // and recovers the appended node at the correct rowIndex after a round-trip
    const reparsed = parseIlf(buf1);
    expect(resolveRowIndex(reparsed, 'cell1', newNode.objectTemplateName, newNode.transform)).toBe(2);
  });
});

describe('removeNode', () => {
  it('removes exactly the target (cellName, rowIndex) node, leaves siblings unchanged', () => {
    // remove the chair (cell1, rowIndex 1)
    const out = removeNode(sample, 'cell1', 1);
    expect(out.length).toBe(sample.length - 1);
    expect(out).not.toBe(sample);
    expect(out.map((n) => n.objectTemplateName)).toEqual([sample[0].objectTemplateName, sample[2].objectTemplateName]);
    expect(out[0]).toEqual(sample[0]); // table untouched
    expect(out[1]).toEqual(sample[2]); // lamp untouched
    expect(sample.length).toBe(3); // input not mutated
  });

  it("shifts LATER same-cell nodes' effective rowIndex down by one", () => {
    // cell1: table@0, chair@1 -- remove table@0, chair should now resolve at rowIndex 0
    const out = removeNode(sample, 'cell1', 0);
    expect(resolveRowIndex(out, 'cell1', sample[1].objectTemplateName, sample[1].transform)).toBe(0);
  });

  it('throws `ilf: no node at (cell="...", rowIndex=...)` on a missing target', () => {
    expect(() => removeNode(sample, 'cell1', 5)).toThrow(/ilf: no node at \(cell="cell1", rowIndex=5\)/);
    expect(() => removeNode(sample, 'nope', 0)).toThrow(/ilf: no node at \(cell="nope", rowIndex=0\)/);
  });

  it('serializeIlf(removeNode(...)) round-trips byte-stable and drops only the target row', () => {
    const removed = removeNode(sample, 'cell2', 0); // the lamp, only node in cell2
    const buf1 = serializeIlf(removed);
    const buf2 = serializeIlf(parseIlf(buf1));
    expect(buf2.equals(buf1)).toBe(true);
    const reparsed = parseIlf(buf1);
    expect(reparsed.length).toBe(2);
    expect(reparsed.some((n) => n.cellName === 'cell2')).toBe(false);
  });
});
