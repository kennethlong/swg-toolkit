/**
 * stf-roundtrip.test.ts — CORE-05 byte-exact round-trip tests for the `.stf` localized-string-table
 * parser (Phase 5 Plan 05-05).
 *
 * Covers:
 *   - `.stf` (PARSER-NATIVE, not IFF) — native pair: parseStf / serializeStf
 *   - The magic-bytes check is the 4-byte LITTLE-ENDIAN INTEGER 0xABCD (bytes CD AB 00 00), never
 *     an ASCII "STF " tag (D-11 erratum vs the original UI-SPEC assumption)
 *   - TWO independently-ordered sections (D-11): an id-ascending string table and a separate
 *     name-ascending key-to-id map — proven via a fixture whose id-order and name-order permutations
 *     genuinely differ (Pitfall 4: a fixture where both orders coincidentally match would not catch
 *     a regression where the implementation collapsed to one shared order)
 *   - sourceCrc preserved byte-identical on a no-edit round-trip, never recomputed from the text
 *     (D-10 — this is the default-save contract for a future translation-staleness UI)
 *   - A real-asset fixture lane (Task 4) — gitignored, local/opt-in, skips cleanly when absent
 *
 * Fixture strategy (D-09 — synthesize from a byte recipe, never hand-copy an external golden):
 *   The synthetic fixture below is hand-built directly as raw bytes via small array-builder
 *   helpers (mirrors dtii-roundtrip.test.ts's buildDtiiFixture convention) — it is NOT produced by
 *   calling our own serializeStf, so the round-trip assertion is a genuine independent-oracle proof.
 *
 * DEVIATION NOTE (Rule 1 — plan's illustrative example was internally inconsistent): 05-05-PLAN.md's
 * Task 3 action text suggested "id=3 name=zebra, id=1 name=apple, id=2 name=mango" as an
 * order-differing example, but sorting id=1/apple, id=2/mango, id=3/zebra by NAME ascending
 * (apple, mango, zebra) visits ids in the SAME sequence (1, 2, 3) as sorting by ID ascending — the
 * two orderings do NOT actually differ under that assignment, contradicting the task's own
 * "these two orderings visit entries in different sequences" requirement and its acceptance
 * criterion ("id-order and name-order are NOT the same permutation"). This file instead assigns
 * id=1/"zebra", id=2/"apple", id=3/"mango" — id-ascending visits [zebra, apple, mango] while
 * name-ascending visits ids [2, 3, 1] — a genuinely differing permutation, which is what the task's
 * acceptance criterion actually requires.
 *
 * Ground truth (verified against real swg-client-v2 source, see StringTable.h's header doc for
 * full citations):
 *   swg-client-v2 LocalizedStringTable.cpp:72,77,227-308,368-405 (magic/version, load_0001, openLoadFile)
 *   swg-client-v2 LocalizedString.cpp:20-95,178-329 (per-string id/sourceCrc/buflen/text, CRC table)
 *   swg-client-v2 LocalizedStringTableReaderWriter.cpp:107-203 (str_write/write, both sections)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerFormat } from '../fixtureRegistry.js';
import { assertRoundTrip } from '../assertRoundTrip.js';

// CJS require — .node addon is CJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  parseStf: (bytes: ArrayBuffer | Uint8Array) => StfResult;
  serializeStf: (table: StfResult) => ArrayBuffer;
};

// ─── Return type stub (structural, not exhaustive) ─────────────────────────────

interface StfEntryJs {
  id: number;
  sourceCrc: number;
  text: string;
}

interface StfNameEntryJs {
  id: number;
  name: string;
}

interface StfResult {
  nextUniqueId: number;
  entries: StfEntryJs[];
  nameMap: StfNameEntryJs[];
  roundTripBytes?: ArrayBuffer;
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

/**
 * extract-stf-fixtures.cjs writes to fixtures-real/stf/<basename>.stf. Since the basename is not
 * known ahead of time (it depends on which real .stf the extraction script found), this picks the
 * first *.stf file present in that directory rather than a hardcoded name.
 */
function loadRealStfFixture(): Uint8Array | null {
  const dir = join(REAL, 'stf');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.stf'));
  if (files.length === 0) return null;
  return loadFixture(join('stf', files[0]!));
}

// ─── Byte-recipe `.stf` builder (hand-rolled, mirrors dtii-roundtrip.test.ts's convention) ──

function le32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function utf16le(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    bytes.push(code & 0xff, (code >> 8) & 0xff);
  }
  return bytes;
}
function ascii(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
  return bytes;
}

interface StfEntrySpec {
  id: number;
  sourceCrc: number;
  text: string;
}
interface StfNameSpec {
  name: string;
  id: number;
}

/** Build a `.stf` file from an explicit string-section order + name-map-section order. */
function buildStfFixture(
  nextUniqueId: number,
  stringSectionOrder: StfEntrySpec[],
  nameMapSectionOrder: StfNameSpec[],
): Uint8Array {
  const bytes: number[] = [
    ...le32(0xabcd), // magic (4 bytes LE: CD AB 00 00) — NOT ASCII "STF "
    1, // version (FILE_VERSION)
    ...le32(nextUniqueId),
    ...le32(stringSectionOrder.length),
  ];

  for (const e of stringSectionOrder) {
    bytes.push(...le32(e.id), ...le32(e.sourceCrc), ...le32(e.text.length), ...utf16le(e.text));
  }
  for (const n of nameMapSectionOrder) {
    bytes.push(...le32(n.id), ...le32(n.name.length), ...ascii(n.name));
  }

  return new Uint8Array(bytes);
}

// ─── Synthetic fixture: id-ascending order DIFFERS from name-ascending order ──────
//
// String section (on-disk, id-ascending 1,2,3): id=1/"zebra", id=2/"apple", id=3/"mango".
// Name-map section (on-disk, name-ascending): apple->2, mango->3, zebra->1.
// Walking the string section by position visits ids [1,2,3]; walking the name-map section by
// position visits ids [2,3,1] — a genuinely different permutation (see DEVIATION NOTE above).
// sourceCrc values are distinct, non-null-sentinel (not 0xFFFFFFFF) to prove arbitrary
// preservation, not just a default-value coincidence.

const SYNTHETIC_STRING_SECTION: StfEntrySpec[] = [
  { id: 1, sourceCrc: 0x0a0b0c0d, text: 'zebra' },
  { id: 2, sourceCrc: 0xdeadbeef, text: 'apple' },
  { id: 3, sourceCrc: 0x12345678, text: 'mango' },
];
const SYNTHETIC_NAME_SECTION: StfNameSpec[] = [
  { name: 'apple', id: 2 },
  { name: 'mango', id: 3 },
  { name: 'zebra', id: 1 },
];

const syntheticStfBytes = buildStfFixture(4, SYNTHETIC_STRING_SECTION, SYNTHETIC_NAME_SECTION);

// ─── registerFormat (CORE-05 gate) ─────────────────────────────────────────────

function parseStfFile(bytes: Uint8Array): StfResult {
  return nativeCore.parseStf(bytes);
}
function serializeStfFile(parsed: unknown): Uint8Array {
  return new Uint8Array(nativeCore.serializeStf(parsed as StfResult));
}

beforeAll(() => {
  const fixtures: Array<{ name: string; bytes: Uint8Array; loaderSource: string }> = [
    {
      name: 'synthetic-differing-orders',
      bytes: syntheticStfBytes,
      loaderSource: 'swg-client-v2 LocalizedStringTableReaderWriter.cpp:107-203',
    },
  ];

  // Task 4: real-asset fixture lane — additional entry when present, absent otherwise
  // (never fails the sweep when the machine has no installed client).
  const realBytes = loadRealStfFixture();
  if (realBytes) {
    fixtures.push({
      name: 'real-asset (extracted from an installed client)',
      bytes: realBytes,
      loaderSource: 'swg-client-v2 LocalizedStringTable.cpp:227-308 (real extracted .stf asset)',
    });
  }

  registerFormat('stf', {
    parse: (b: Uint8Array) => parseStfFile(b),
    serialize: (parsed: unknown) => serializeStfFile(parsed),
    fixtures,
    loaderSource: 'swg-client-v2 LocalizedStringTable.cpp:72,77,227-308,368-405',
  });
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('.stf localized-string-table — parser', () => {
  it('CORE-05 gate: byte-exact round-trip — synthetic-differing-orders fixture', () => {
    assertRoundTrip(
      (b) => parseStfFile(b as Uint8Array),
      (p) => serializeStfFile(p),
      syntheticStfBytes,
    );
  });

  it('magic bytes at offset 0 are exactly CD AB 00 00 (4-byte integer, not ASCII "STF ")', () => {
    expect(syntheticStfBytes[0]).toBe(0xcd);
    expect(syntheticStfBytes[1]).toBe(0xab);
    expect(syntheticStfBytes[2]).toBe(0x00);
    expect(syntheticStfBytes[3]).toBe(0x00);
    // Explicitly NOT the ASCII bytes for "STF ":
    expect(syntheticStfBytes[0]).not.toBe('S'.charCodeAt(0));
  });

  it('parseStf: entries reflect the string section\'s on-disk id-ascending order (1,2,3)', () => {
    const parsed = parseStfFile(syntheticStfBytes);
    expect(parsed.entries.length).toBe(3);
    expect(parsed.entries[0]!.id).toBe(1);
    expect(parsed.entries[0]!.text).toBe('zebra');
    expect(parsed.entries[1]!.id).toBe(2);
    expect(parsed.entries[1]!.text).toBe('apple');
    expect(parsed.entries[2]!.id).toBe(3);
    expect(parsed.entries[2]!.text).toBe('mango');
  });

  it('parseStf: nameMap reflects the name-map section\'s on-disk name-ascending order (apple,mango,zebra)', () => {
    const parsed = parseStfFile(syntheticStfBytes);
    expect(parsed.nameMap.length).toBe(3);
    expect(parsed.nameMap[0]!.name).toBe('apple');
    expect(parsed.nameMap[0]!.id).toBe(2);
    expect(parsed.nameMap[1]!.name).toBe('mango');
    expect(parsed.nameMap[1]!.id).toBe(3);
    expect(parsed.nameMap[2]!.name).toBe('zebra');
    expect(parsed.nameMap[2]!.id).toBe(1);
  });

  it('the fixture\'s id-order and name-order are NOT the same permutation (guards a weakened fixture)', () => {
    const parsed = parseStfFile(syntheticStfBytes);
    const idOrderIds = parsed.entries.map((e) => e.id); // [1, 2, 3]
    const nameOrderIds = parsed.nameMap.map((n) => n.id); // [2, 3, 1]
    expect(idOrderIds).not.toEqual(nameOrderIds);
  });

  it('parseStf: each entry\'s sourceCrc matches exactly what was written (not recomputed)', () => {
    const parsed = parseStfFile(syntheticStfBytes);
    expect(parsed.entries[0]!.sourceCrc).toBe(0x0a0b0c0d);
    expect(parsed.entries[1]!.sourceCrc).toBe(0xdeadbeef);
    expect(parsed.entries[2]!.sourceCrc).toBe(0x12345678);
  });

  it('parseStf: nextUniqueId matches the header field', () => {
    const parsed = parseStfFile(syntheticStfBytes);
    expect(parsed.nextUniqueId).toBe(4);
  });

  it('D-10: sourceCrc is preserved byte-identical on a no-edit round-trip (default-save contract)', () => {
    const parsed = parseStfFile(syntheticStfBytes);
    const reserialized = new Uint8Array(nativeCore.serializeStf(parsed));

    const reparsed = parseStfFile(reserialized);
    expect(reparsed.entries.length).toBe(parsed.entries.length);
    for (let i = 0; i < parsed.entries.length; i++) {
      expect(reparsed.entries[i]!.sourceCrc).toBe(parsed.entries[i]!.sourceCrc);
    }

    // Also assert byte-for-byte identity of the full output (stronger than a value-level check —
    // this is the actual D-10 "preserved byte-identical" contract, not just logically-equal).
    expect(reserialized.length).toBe(syntheticStfBytes.length);
    expect(Array.from(reserialized)).toEqual(Array.from(syntheticStfBytes));
  });

  it('throws FormatParseError-derived Error on a bad magic (not exactly 0xABCD)', () => {
    const bad = new Uint8Array(syntheticStfBytes);
    bad[0] = 0x00; // corrupt the magic's low byte
    expect(() => parseStfFile(bad)).toThrow(/parseStf error:.*magic/i);
  });

  // ─── Real-asset fixture lane (Task 4) — local/opt-in, skips cleanly when absent ──
  describe('real-asset fixture (gitignored, extracted from an installed client)', () => {
    it('byte-exact round-trip + sourceCrc preservation — stf/*.stf (extract-stf-fixtures.cjs output)', () => {
      const bytes = loadRealStfFixture();
      if (!bytes) {
        console.log('  SKIP: fixtures-real/stf/*.stf not present — run scripts/extract-stf-fixtures.cjs');
        return;
      }
      assertRoundTrip(
        (b) => parseStfFile(b as Uint8Array),
        (p) => serializeStfFile(p),
        bytes,
      );

      const parsed = parseStfFile(bytes);
      const reserialized = new Uint8Array(nativeCore.serializeStf(parsed));
      const reparsed = parseStfFile(reserialized);
      for (let i = 0; i < parsed.entries.length; i++) {
        expect(reparsed.entries[i]!.sourceCrc).toBe(parsed.entries[i]!.sourceCrc);
      }
    });
  });
});
