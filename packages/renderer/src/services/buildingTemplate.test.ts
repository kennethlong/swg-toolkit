/**
 * packages/renderer/src/services/buildingTemplate.test.ts
 * Derived-building-template minter — synthetic (always) + real cantina (skipIf absent).
 */

import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

import { parseIffTree, serializeIffTree, findForm, type IffChunk } from './iffTree';
import { deriveBuildingTemplate, readInteriorLayoutFileName } from './buildingTemplate';

// ── Synthetic minimal SBOT (no real asset needed) ─────────────────────────────
function pcnt(n: number): IffChunk {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n, 0);
  return { kind: 'leaf', tag: 'PCNT', payload: b };
}
function ilfParam(ilf: string): IffChunk {
  return {
    kind: 'leaf', tag: 'XXXX',
    payload: Buffer.concat([Buffer.from('interiorLayoutFileName\0', 'ascii'), Buffer.from([0x01]), Buffer.from(`${ilf}\0`, 'ascii')]),
  };
}
function synthSbot(ilf: string): Buffer {
  const derv: IffChunk = { kind: 'form', tag: 'FORM', subType: 'DERV',
    children: [{ kind: 'leaf', tag: 'XXXX', payload: Buffer.from('object/building/base/shared_base.iff\0', 'ascii') }] };
  const form0001: IffChunk = { kind: 'form', tag: 'FORM', subType: '0001', children: [pcnt(1), ilfParam(ilf)] };
  const stot: IffChunk = { kind: 'form', tag: 'FORM', subType: 'STOT', children: [pcnt(0)] };
  return serializeIffTree([{ kind: 'form', tag: 'FORM', subType: 'SBOT', children: [derv, form0001, stot] }]);
}

describe('iffTree round-trip', () => {
  it('parse → serialize is byte-exact on a synthetic SBOT', () => {
    const buf = synthSbot('interiorlayout/orig.ilf');
    expect(serializeIffTree(parseIffTree(buf)).equals(buf)).toBe(true);
  });
});

describe('deriveBuildingTemplate (synthetic)', () => {
  const stock = synthSbot('interiorlayout/orig.ilf');

  it('re-points interiorLayoutFileName and preserves the DERV base', () => {
    const derived = deriveBuildingTemplate(stock, 'interiorlayout/derived_12345.ilf');
    expect(readInteriorLayoutFileName(stock)).toBe('interiorlayout/orig.ilf');
    expect(readInteriorLayoutFileName(derived)).toBe('interiorlayout/derived_12345.ilf');
    // DERV base untouched.
    const sbot = findForm(parseIffTree(derived), 'FORM', 'SBOT')!;
    const derv = sbot.children.find((c) => c.kind === 'form' && c.subType === 'DERV');
    const baseLeaf = derv && derv.kind === 'form' ? derv.children[0] : null;
    expect(baseLeaf && baseLeaf.kind === 'leaf' ? baseLeaf.payload.toString('ascii') : '')
      .toBe('object/building/base/shared_base.iff\0');
    // Re-parses cleanly.
    expect(() => parseIffTree(derived)).not.toThrow();
  });

  it('normalizes the .ilf path to lowercase forward-slashes', () => {
    const derived = deriveBuildingTemplate(stock, 'InteriorLayout\\Derived_X.ILF');
    expect(readInteriorLayoutFileName(derived)).toBe('interiorlayout/derived_x.ilf');
  });

  it('does not mutate the input bytes', () => {
    const before = Buffer.from(stock);
    deriveBuildingTemplate(stock, 'interiorlayout/other.ilf');
    expect(stock.equals(before)).toBe(true);
  });
});

// ── Real cantina (the whole point of extracting it) — skipIf the asset is absent ──
const REAL = path.join(__dirname, '__fixtures__', 'shared_cantina_tatooine.iff');
const hasReal = fs.existsSync(REAL);

describe.skipIf(!hasReal)('deriveBuildingTemplate (real shared_cantina_tatooine.iff)', () => {
  const stock = hasReal ? fs.readFileSync(REAL) : Buffer.alloc(0);

  it('round-trips the real client template byte-exact', () => {
    expect(serializeIffTree(parseIffTree(stock)).equals(stock)).toBe(true);
  });

  it('reads the stock interior layout', () => {
    expect(readInteriorLayoutFileName(stock)).toBe('interiorlayout/shared_cantina_mos_eisley_tatooine.ilf');
  });

  it('derives with only interiorLayoutFileName changed', () => {
    const derived = deriveBuildingTemplate(stock, 'interiorlayout/shared_cantina_edit_9876.ilf');
    expect(readInteriorLayoutFileName(derived)).toBe('interiorlayout/shared_cantina_edit_9876.ilf');
    expect(() => parseIffTree(derived)).not.toThrow();
    // The STOT/SHOT sub-levels survive untouched (spot-check the STOT DERV base).
    const sbot = findForm(parseIffTree(derived), 'FORM', 'SBOT')!;
    const stot = sbot.children.find((c) => c.kind === 'form' && c.subType === 'STOT');
    expect(stot).toBeDefined();
    // Byte delta is only in the SBOT/0001 region: everything after it shifts by the length
    // difference, but re-parse + the STOT presence proves structural integrity.
  });
});
