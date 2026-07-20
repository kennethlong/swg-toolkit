/**
 * packages/renderer/src/services/ilf.test.ts
 * Round-trip + edit coverage for the .ilf reader/writer (model D consumer half).
 */

import { describe, it, expect } from 'vitest';

import { parseIlf, serializeIlf, editNodeTransform, type IlfNode } from './ilf';

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

describe('parseIlf validation', () => {
  it('rejects a non-INLY buffer', () => {
    expect(() => parseIlf(Buffer.from('not an ilf at all!!'))).toThrow();
  });
});
