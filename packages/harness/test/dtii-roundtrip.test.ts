/**
 * dtii-roundtrip.test.ts — CORE-05 byte-exact round-trip tests for the FORM DTII datatable parser
 * (Phase 5 Plan 05-02).
 *
 * Covers:
 *   - FORM DTII (.iff datatable) — native pair: parseDataTable / serializeDataTable
 *   - All 9 non-Comment DataType type-spec letters (D-12/Pitfall-2: they collapse to 3 physical
 *     wire encodings — int32/float32/NUL-terminated string — this test proves the dispatch, not
 *     10 physical decoders)
 *   - Per-cell byteOffset/byteLength contiguity (REVIEWS.md MEDIUM — the field 05-08's Hex-view
 *     highlight consumes directly)
 *   - DT_Comment rejection (DataTableWriter.cpp:821-856,898-901 — never appears in a compiled .iff)
 *   - A real-asset fixture lane (Task 4) — gitignored, local/opt-in, skips cleanly when absent
 *
 * Fixture strategy (D-09 — synthesize from byte recipes, never hand-copy an external golden):
 *   The synthetic fixture below is hand-built directly as raw IFF bytes via small array-builder
 *   helpers (mirrors mesh-roundtrip.test.ts's "throws if redirectTarget ends with .apt" DataView
 *   buffer, lines 988-1027) — it is NOT produced by calling our own serializeDataTable, so the
 *   round-trip assertion is a genuine independent-oracle proof, not a tautology.
 *
 * Ground truth (verified against real swg-client-v2 source, see DataTable.h's header doc for full
 * citations):
 *   swg-client-v2 DataTable.cpp:400-476,480-555 (_readCell, load_0000/load_0001)
 *   swg-client-v2 DataTableWriter.cpp:650-664,723-748,821-912 (_saveTableToIff, Comment-strip)
 *   swg-client-v2 DataTableColumnType.cpp:84-232 (type-spec dispatch)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerFormat } from '../fixtureRegistry.js';
import { assertRoundTrip } from '../assertRoundTrip.js';

// CJS require — .node addon is CJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  parseIff: (bytes: ArrayBuffer | Uint8Array) => unknown;
  parseDataTable: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => DataTableResult;
  serializeDataTable: (table: DataTableResult) => ArrayBuffer;
};

// ─── Return type stub (structural, not exhaustive) ─────────────────────────────

interface DataTableColumnJs {
  name: string;
  typeSpec: string;
}

interface DataTableCellJs {
  type: 'int' | 'float' | 'string';
  value: number | string;
  byteOffset: number;
  byteLength: number;
}

interface DataTableResult {
  formatTag: string;
  version: string;
  columns: DataTableColumnJs[];
  rows: DataTableCellJs[][];
}

// ─── Fixture helpers ────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL = join(__dirname, '..', 'fixtures-real');

/**
 * Load a fixture file as a Uint8Array. Returns null if the file doesn't exist.
 * Real fixtures are gitignored; tests gracefully skip when absent.
 */
function loadFixture(relPath: string): Uint8Array | null {
  const fullPath = join(REAL, relPath);
  if (!existsSync(fullPath)) return null;
  const buf = readFileSync(fullPath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ─── Byte-recipe IFF builder (hand-rolled, mirrors DataTable.cpp's write convention) ──

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function le32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function tagBytes(s: string): number[] {
  return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
}
function cstr(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
  bytes.push(0);
  return bytes;
}
function floatLE(f: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, f, true);
  return Array.from(new Uint8Array(buf));
}
function leafChunk(tag: string, payload: number[]): number[] {
  return [...tagBytes(tag), ...be32(payload.length), ...payload];
}
function formNode(subType: string, childBytes: number[]): number[] {
  const innerLen = 4 + childBytes.length;
  return [...tagBytes('FORM'), ...be32(innerLen), ...tagBytes(subType), ...childBytes];
}

interface ColSpec {
  name: string;
  typeSpec: string;
  physical: 'int' | 'float' | 'string';
}
type CellValue = number | string;

/** Build a FORM DTII > FORM 0001 IFF buffer from a column spec + row-major cell values. */
function buildDtiiFixture(columns: ColSpec[], rows: CellValue[][]): Uint8Array {
  const colsPayload: number[] = [...le32(columns.length)];
  for (const c of columns) colsPayload.push(...cstr(c.name));

  const typePayload: number[] = [];
  for (const c of columns) typePayload.push(...cstr(c.typeSpec));

  const rowsPayload: number[] = [...le32(rows.length)];
  for (const row of rows) {
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c]!;
      const val = row[c]!;
      if (col.physical === 'int') rowsPayload.push(...le32(val as number));
      else if (col.physical === 'float') rowsPayload.push(...floatLE(val as number));
      else rowsPayload.push(...cstr(val as string));
    }
  }

  const form0001Body = [
    ...leafChunk('COLS', colsPayload),
    ...leafChunk('TYPE', typePayload),
    ...leafChunk('ROWS', rowsPayload),
  ];
  const form0001 = formNode('0001', form0001Body);
  const dtii = formNode('DTII', form0001);
  return new Uint8Array(dtii);
}

// ─── Synthetic fixture: all 9 non-Comment DataType type-spec letters ──────────
//
// Dispatch table (verified DataTableColumnType.cpp:84-232 — see DataTable.h header doc):
//   s -> String, i -> Int, f -> Float, h/b/e/v/z -> Int (semantic layers), p -> String.

const SYNTHETIC_COLUMNS: ColSpec[] = [
  { name: 'name', typeSpec: 's', physical: 'string' },
  { name: 'hp', typeSpec: 'i', physical: 'int' },
  { name: 'speedFactor', typeSpec: 'f', physical: 'float' },
  { name: 'guildTitle', typeSpec: 'h', physical: 'int' },
  { name: 'isElite', typeSpec: 'b', physical: 'int' },
  { name: 'rank', typeSpec: 'e(a=0,b=1,c=2)', physical: 'int' },
  { name: 'flags', typeSpec: 'v(a=1,b=2,d=4)', physical: 'int' },
  { name: 'objVars', typeSpec: 'p', physical: 'string' },
  { name: 'factionTable', typeSpec: 'z(faction_table.iff)', physical: 'int' },
];

const SYNTHETIC_ROWS: CellValue[][] = [
  ['Trandoshan', 120, 1.25, 999, 1, 2, 5, 'key:0=val', 7],
  ['Wookiee', 200, 0.9, 42, 0, 0, 2, '', 3],
];

const syntheticDtiiBytes = buildDtiiFixture(SYNTHETIC_COLUMNS, SYNTHETIC_ROWS);

// ─── DT_Comment rejection fixture: 1-column table with a 'c' type-spec ────────

const commentDtiiBytes = buildDtiiFixture(
  [{ name: 'note', typeSpec: 'c', physical: 'string' }],
  [['this column should never appear in a compiled .iff']],
);

// ─── registerFormat (CORE-05 gate) ─────────────────────────────────────────────

function parseDtii(bytes: Uint8Array): DataTableResult {
  const iff = nativeCore.parseIff(bytes);
  return nativeCore.parseDataTable(iff, bytes);
}
function serializeDtii(parsed: unknown): Uint8Array {
  return new Uint8Array(nativeCore.serializeDataTable(parsed as DataTableResult));
}

beforeAll(() => {
  const fixtures: Array<{ name: string; bytes: Uint8Array; loaderSource: string }> = [
    {
      name: 'synthetic-9-types',
      bytes: syntheticDtiiBytes,
      loaderSource: 'swg-client-v2 DataTableWriter.cpp:650-664,723-748,821-912',
    },
  ];

  // Task 4: real-asset fixture lane — additional entry when present, absent otherwise
  // (never fails the sweep when the machine has no installed client).
  const realBytes = loadFixture('datatable/creature_species.iff');
  if (realBytes) {
    fixtures.push({
      name: 'real-asset creature_species.iff',
      bytes: realBytes,
      loaderSource: 'swg-client-v2 DataTable.cpp:400-476 (real extracted FORM DTII asset)',
    });
  }

  registerFormat('dtii', {
    parse: (b: Uint8Array) => parseDtii(b),
    serialize: (parsed: unknown) => serializeDtii(parsed),
    fixtures,
    loaderSource: 'swg-client-v2 DataTable.cpp:400-476',
  });
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('FORM DTII (.iff) — datatable parser', () => {
  it('CORE-05 gate: byte-exact round-trip — synthetic-9-types fixture', () => {
    assertRoundTrip(
      (b) => parseDtii(b as Uint8Array),
      (p) => serializeDtii(p),
      syntheticDtiiBytes,
    );
  });

  it('parseDataTable: formatTag=DTII, version=0001, 9 columns with matching typeSpecs', () => {
    const parsed = parseDtii(syntheticDtiiBytes);

    expect(parsed.formatTag).toBe('DTII');
    expect(parsed.version).toBe('0001');
    expect(parsed.columns.length).toBe(9);

    for (let i = 0; i < SYNTHETIC_COLUMNS.length; i++) {
      expect(parsed.columns[i]!.name).toBe(SYNTHETIC_COLUMNS[i]!.name);
      expect(parsed.columns[i]!.typeSpec).toBe(SYNTHETIC_COLUMNS[i]!.typeSpec);
    }
  });

  it('parseDataTable: physical type dispatch — name=string, hp=int, speedFactor=float', () => {
    const parsed = parseDtii(syntheticDtiiBytes);
    const row0 = parsed.rows[0]!;

    expect(row0[0]!.type).toBe('string'); // name (s)
    expect(row0[0]!.value).toBe('Trandoshan');
    expect(row0[1]!.type).toBe('int'); // hp (i)
    expect(row0[1]!.value).toBe(120);
    expect(row0[2]!.type).toBe('float'); // speedFactor (f)
    expect(row0[2]!.value as number).toBeCloseTo(1.25, 5);

    // Semantic-Int specializations all physically decode as 'int' (D-12):
    expect(row0[3]!.type).toBe('int'); // guildTitle (h — HashString)
    expect(row0[4]!.type).toBe('int'); // isElite (b — Bool)
    expect(row0[5]!.type).toBe('int'); // rank (e — Enum)
    expect(row0[6]!.type).toBe('int'); // flags (v — BitVector)
    expect(row0[7]!.type).toBe('string'); // objVars (p — PackedObjVars, DT_String basicType)
    expect(row0[8]!.type).toBe('int'); // factionTable (z — table-sourced Enum)
  });

  it('parseDataTable: 2 rows parsed, row 1 values match the fixture recipe', () => {
    const parsed = parseDtii(syntheticDtiiBytes);
    expect(parsed.rows.length).toBe(2);

    const row1 = parsed.rows[1]!;
    expect(row1[0]!.value).toBe('Wookiee');
    expect(row1[1]!.value).toBe(200);
    expect(row1[2]!.value as number).toBeCloseTo(0.9, 5);
    expect(row1[7]!.value).toBe(''); // empty PackedObjVars string
  });

  it('byteOffset/byteLength: row 0 cells form a contiguous, zero-based map of the ROWS cell-data span', () => {
    const parsed = parseDtii(syntheticDtiiBytes);
    const row0 = parsed.rows[0]!;

    expect(row0[0]!.byteOffset).toBe(0);
    for (let i = 0; i + 1 < row0.length; i++) {
      const cell = row0[i]!;
      const next = row0[i + 1]!;
      expect(next.byteOffset).toBe(cell.byteOffset + cell.byteLength);
    }
    // Sanity: byteLength is 4 for every int/float cell in this fixture.
    expect(row0[1]!.byteLength).toBe(4); // hp (int)
    expect(row0[2]!.byteLength).toBe(4); // speedFactor (float)
    // String cell byteLength = content length + 1 (NUL terminator) — NOT a 4-byte length prefix.
    expect(row0[0]!.byteLength).toBe('Trandoshan'.length + 1);
  });

  it('DT_Comment is rejected — a "c" type-spec column throws FormatParseError', () => {
    expect(() => parseDtii(commentDtiiBytes)).toThrow(/parseDataTable error:.*Comment/i);
  });

  // ─── Real-asset fixture lane (Task 4) — local/opt-in, skips cleanly when absent ──
  describe('real-asset fixture (gitignored, extracted from an installed client)', () => {
    it('byte-exact round-trip — datatable/creature_species.iff (or first extracted DTII)', () => {
      const bytes = loadFixture('datatable/creature_species.iff');
      if (!bytes) {
        console.log('  SKIP: fixtures-real/datatable/creature_species.iff not present — run scripts/extract-dtii-fixtures.cjs');
        return;
      }
      assertRoundTrip(
        (b) => parseDtii(b as Uint8Array),
        (p) => serializeDtii(p),
        bytes,
      );
    });
  });
});
