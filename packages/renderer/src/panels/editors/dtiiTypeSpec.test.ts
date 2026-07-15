/**
 * packages/renderer/src/panels/editors/dtiiTypeSpec.test.ts
 * Fixture coverage for the pure DTII type-spec grammar interpreter (05-06-PLAN.md Task 2).
 *
 * Ported semantics verified against ground truth:
 *   D:/Code/swg-client-v2/src/engine/shared/library/sharedUtility/src/shared/DataTableColumnType.cpp
 *   (lines 84-232 — chomp/getDelimStr dispatch, enum/bitvector label-map parsing, bracket-suffix
 *   convention).
 *
 * TDD RED phase: this file is written BEFORE dtiiTypeSpec.ts exists / is complete, so it fails
 * first (either as an import error or as failing assertions), per the plan's tdd="true" gate.
 */

import { describe, it, expect } from 'vitest';
import { parseTypeSpec, bitVectorFlagToMask } from './dtiiTypeSpec';

describe('parseTypeSpec — single-char physical types', () => {
  it("'i' -> int", () => {
    expect(parseTypeSpec('i')).toEqual({ kind: 'int' });
  });
  it("'f' -> float", () => {
    expect(parseTypeSpec('f')).toEqual({ kind: 'float' });
  });
  it("'s' -> string", () => {
    expect(parseTypeSpec('s')).toEqual({ kind: 'string' });
  });
  it("'h' -> hashstring", () => {
    expect(parseTypeSpec('h')).toEqual({ kind: 'hashstring' });
  });
  it("'b' -> bool", () => {
    expect(parseTypeSpec('b')).toEqual({ kind: 'bool' });
  });
  it("'p' -> packedObjVars", () => {
    expect(parseTypeSpec('p')).toEqual({ kind: 'packedObjVars' });
  });
});

describe('parseTypeSpec — enum e(...)', () => {
  it('parses a multi-entry label=value map exactly', () => {
    const info = parseTypeSpec('e(a=0,b=1,c=2)');
    expect(info.kind).toBe('enum');
    if (info.kind === 'enum') {
      expect(info.labels).toEqual({ a: 0, b: 1, c: 2 });
    }
  });
});

describe('parseTypeSpec — bitvector v(...)', () => {
  it('parses a multi-entry label=bitIndex map exactly and bitVectorFlagToMask ORs correctly', () => {
    const info = parseTypeSpec('v(a=1,b=2,d=4)');
    expect(info.kind).toBe('bitvector');
    if (info.kind === 'bitvector') {
      expect(info.flags).toEqual({ a: 1, b: 2, d: 4 });
    }
    // Reproduces the OR'd-flags wire encoding from RESEARCH.md's dispatch table:
    // bit 1 -> 1<<0 = 1, bit 2 -> 1<<1 = 2, bit 3 -> 1<<2 = 4.
    expect(bitVectorFlagToMask(1)).toBe(1);
    expect(bitVectorFlagToMask(2)).toBe(2);
    expect(bitVectorFlagToMask(3)).toBe(4);
  });
});

describe('parseTypeSpec — z(...) enum-table special case (REVIEWS.md MEDIUM fix)', () => {
  it('z(faction_table.iff) returns enum-table, NEVER enum', () => {
    const info = parseTypeSpec('z(faction_table.iff)');
    expect(info).toEqual({ kind: 'enum-table', tableName: 'faction_table.iff' });
    expect(info.kind).not.toBe('enum');
  });

  it('does not throw and does not attempt the e(...) key=value grammar on z(...)', () => {
    expect(() => parseTypeSpec('z(faction_table.iff)')).not.toThrow();
  });
});

describe('parseTypeSpec — malformed/empty input degrades to unknown, never throws', () => {
  it("'' -> unknown", () => {
    expect(() => parseTypeSpec('')).not.toThrow();
    expect(parseTypeSpec('').kind).toBe('unknown');
  });

  it("'e(malformed' (no closing paren) -> unknown", () => {
    expect(() => parseTypeSpec('e(malformed')).not.toThrow();
    expect(parseTypeSpec('e(malformed').kind).toBe('unknown');
  });
});

describe('parseTypeSpec — bracket-suffix default marker', () => {
  it("'s[required]' -> string with defaultLabel 'required'", () => {
    const info = parseTypeSpec('s[required]');
    expect(info.kind).toBe('string');
    expect((info as { defaultLabel?: string }).defaultLabel).toBe('required');
  });

  it("'e(a=0,b=1)[a]' -> enum with defaultLabel 'a', labels unaffected", () => {
    const info = parseTypeSpec('e(a=0,b=1)[a]');
    expect(info.kind).toBe('enum');
    if (info.kind === 'enum') {
      expect(info.labels).toEqual({ a: 0, b: 1 });
    }
    expect((info as { defaultLabel?: string }).defaultLabel).toBe('a');
  });
});
