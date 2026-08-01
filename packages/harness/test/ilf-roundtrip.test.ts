/**
 * ilf-roundtrip.test.ts — CORE-05 byte-exact round-trip tests for the `.ilf` interior-layout
 * parser (Phase 5.1 Plan 01, Task 4).
 *
 * Covers:
 *   - `.ilf` (FORM 'INLY' / FORM '0000' / CHUNK 'NODE' x N) — parseIlf/serializeIlf pair from
 *     packages/renderer/src/services/ilf.ts (verified against swg-client-v2
 *     InteriorLayoutReaderWriter.cpp:331-378 — see that module's own docstring citation)
 *   - addNode/removeNode (Task 2) proven byte-exact against BOTH an independently-encoded
 *     byte-recipe fixture AND a REQUIRED real client-extracted fixture (ROUND 3 — REVIEWS.md C5:
 *     the real-asset lane is mandatory, not skip-on-absent, for this format-mutating change)
 *
 * Fixture strategy (D-09 — synthesize from a byte recipe, never hand-copy an external golden):
 *   The byte-recipe fixture below is hand-built directly as raw bytes via small buffer-builder
 *   helpers (mirrors stf-roundtrip.test.ts's buildStfFixture convention) — it is NOT produced by
 *   calling our own serializeIlf, so the round-trip assertion is a genuine independent-oracle proof.
 *
 * Real-asset fixture (D-10 — gitignored, extracted from an installed client via
 * extract-ilf-fixtures.cjs): registered into fixtures-real/ilf/ from
 * 'D:/SWG Infinity/SWG Infinity/Live' (confirmed present, 27 real .tre archives). Per C5, the
 * nested "real .ilf" describe block below runs UNCONDITIONALLY — it fails loudly (not a skip) if
 * the fixture is absent, closing the ground-truth-mandate gap the checker flagged: every other
 * binary format this project ships (tre/iff/dtii/stf/mesh) already has this discipline; `.ilf` had
 * never been registered in the CORE-05 standing gate until this task.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerFormat, type FixtureEntry } from '../fixtureRegistry.js';
import { assertRoundTrip } from '../assertRoundTrip.js';
import { parseIlf, serializeIlf, addNode, removeNode, resolveRowIndex, type IlfNode } from '../../renderer/src/services/ilf.js';

// ─── Fixture helpers ────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL = join(__dirname, '..', 'fixtures-real');

function loadFixture(relPath: string): Uint8Array | null {
  const fullPath = join(REAL, relPath);
  if (!existsSync(fullPath)) return null;
  const buf = readFileSync(fullPath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * extract-ilf-fixtures.cjs writes to fixtures-real/ilf/<basename>.ilf. Since the basename is not
 * known ahead of time (depends on which real .ilf the extraction script found), this picks the
 * first *.ilf file present in that directory rather than a hardcoded name.
 */
function loadRealIlfFixture(): Uint8Array | null {
  const dir = join(REAL, 'ilf');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.ilf'));
  if (files.length === 0) return null;
  return loadFixture(join('ilf', files[0]!));
}

// ─── Byte-recipe `.ilf` builder (hand-rolled, mirrors stf-roundtrip.test.ts's convention —
//     NOT a call into serializeIlf, an independent encoding of the SAME verified format) ────────

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function tag(s: string): number[] {
  return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
}
function asciiz(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
  bytes.push(0);
  return bytes;
}
function le32f(n: number): number[] {
  const buf = Buffer.alloc(4);
  buf.writeFloatLE(n, 0);
  return [buf[0]!, buf[1]!, buf[2]!, buf[3]!];
}
function transformBytes(t: number[]): number[] {
  return t.flatMap((v) => le32f(v));
}

interface RecipeNode {
  objectTemplateName: string;
  cellName: string;
  transform: number[];
}

function buildNodeChunk(n: RecipeNode): number[] {
  const payload = [...asciiz(n.objectTemplateName), ...asciiz(n.cellName), ...transformBytes(n.transform)];
  return [...tag('NODE'), ...be32(payload.length), ...payload];
}

/** Build a `.ilf` file (FORM INLY / FORM 0000 / NODE x N) from an explicit node list. */
function buildIlfFixture(nodes: RecipeNode[]): Uint8Array {
  const nodeBytes = nodes.flatMap(buildNodeChunk);
  const form0000Payload = [...tag('0000'), ...nodeBytes];
  const form0000 = [...tag('FORM'), ...be32(form0000Payload.length), ...form0000Payload];
  const inlyPayload = [...tag('INLY'), ...form0000];
  const bytes = [...tag('FORM'), ...be32(inlyPayload.length), ...inlyPayload];
  return new Uint8Array(bytes);
}

const identity = [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30];
const chairT = [1, 0, 0, 1.5, 0, 1, 0, 2.5, 0, 0, 1, 3.5];
const lampT = [1, 0, 0, -4, 0, 1, 0, -5, 0, 0, 1, -6];

// Two nodes share 'cell1' (exercises within-cell rowIndex), one node is in a second cell.
const RECIPE_NODES: RecipeNode[] = [
  { objectTemplateName: 'object/tangible/furniture/shared_frn_table.iff', cellName: 'cell1', transform: identity },
  { objectTemplateName: 'object/tangible/furniture/shared_frn_chair.iff', cellName: 'cell1', transform: chairT },
  { objectTemplateName: 'object/tangible/furniture/shared_frn_lamp.iff', cellName: 'cell2', transform: lampT },
];

const byteRecipeBytes = buildIlfFixture(RECIPE_NODES);

// ─── registerFormat wrappers (ROUND 3 — REVIEWS.md MED-8): FormatRegistryEntry.parse/serialize
//     are typed (bytes: Uint8Array) => unknown / (parsed: unknown) => Uint8Array, which
//     parseIlf(buf: Buffer): IlfNode[] / serializeIlf(nodes: IlfNode[]): Buffer do NOT satisfy
//     directly — registerFormat is called with these WRAPPERS, never the raw ilf.ts exports. ────

function parseIlfFile(bytes: Uint8Array): IlfNode[] {
  return parseIlf(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}
function serializeIlfFile(parsed: unknown): Uint8Array {
  return new Uint8Array(serializeIlf(parsed as IlfNode[]));
}

// ─── registerFormat (CORE-05 gate) ─────────────────────────────────────────────

beforeAll(() => {
  const fixtures: FixtureEntry[] = [
    {
      name: 'byte-recipe (independently encoded, non-circular)',
      bytes: byteRecipeBytes,
      loaderSource: 'swg-client-v2 InteriorLayoutReaderWriter.cpp:331-378',
    },
  ];

  // Additional, independent-oracle safety net when present — matches every other format's
  // discipline. Does NOT substitute for the real-asset requirement asserted below (C5).
  const realBytes = loadRealIlfFixture();
  if (realBytes) {
    fixtures.push({
      name: 'real-asset (extracted from an installed client)',
      bytes: realBytes,
      loaderSource: 'swg-client-v2 InteriorLayoutReaderWriter.cpp:331-378 (real extracted .ilf asset)',
    });
  }

  registerFormat('ilf', {
    parse: (b: Uint8Array) => parseIlfFile(b),
    serialize: (parsed: unknown) => serializeIlfFile(parsed),
    fixtures,
    loaderSource: 'swg-client-v2 InteriorLayoutReaderWriter.cpp:331-378',
  });
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('.ilf interior-layout — parser', () => {
  it('CORE-05 gate: byte-exact round-trip — byte-recipe fixture', () => {
    assertRoundTrip(
      (b) => parseIlfFile(b as Uint8Array),
      (p) => serializeIlfFile(p),
      byteRecipeBytes,
    );
  });

  it('parseIlf: recovers the exact node set (template/cell/transform) from the byte-recipe fixture', () => {
    const parsed = parseIlfFile(byteRecipeBytes);
    expect(parsed.length).toBe(3);
    expect(parsed[0]).toEqual(RECIPE_NODES[0]);
    expect(parsed[1]).toEqual(RECIPE_NODES[1]);
    expect(parsed[2]).toEqual(RECIPE_NODES[2]);
  });

  describe('addNode/removeNode — byte-exact round-trip against the byte-recipe fixture', () => {
    const newNode: IlfNode = {
      objectTemplateName: 'object/tangible/furniture/shared_frn_stool.iff',
      cellName: 'cell1',
      transform: [1, 0, 0, 11, 0, 1, 0, 22, 0, 0, 1, 33],
    };

    it('addNode: appends, round-trips byte-stable, recovers at the correct within-cell rowIndex', () => {
      const baseNodes = parseIlfFile(byteRecipeBytes);
      const added = addNode(baseNodes, newNode);
      const buf1 = serializeIlf(added);
      const buf2 = serializeIlf(parseIlf(buf1));
      expect(buf2.equals(buf1)).toBe(true); // byte-stable on a second round-trip

      const reparsed = parseIlf(buf1);
      // cell1 already had 2 nodes (table@0, chair@1) — appended stool lands at rowIndex 2.
      expect(resolveRowIndex(reparsed, 'cell1', newNode.objectTemplateName, newNode.transform)).toBe(2);
    });

    it('removeNode: drops exactly the target row, siblings byte-identical, round-trips byte-stable', () => {
      const baseNodes = parseIlfFile(byteRecipeBytes);
      const removed = removeNode(baseNodes, 'cell1', 0); // remove the table
      const buf1 = serializeIlf(removed);
      const buf2 = serializeIlf(parseIlf(buf1));
      expect(buf2.equals(buf1)).toBe(true);

      const reparsed = parseIlf(buf1);
      expect(reparsed.length).toBe(2);
      expect(reparsed.some((n) => n.objectTemplateName === RECIPE_NODES[0]!.objectTemplateName)).toBe(false);
      // the chair (formerly rowIndex 1 in cell1) is now the only cell1 node, at rowIndex 0.
      expect(resolveRowIndex(reparsed, 'cell1', RECIPE_NODES[1]!.objectTemplateName, RECIPE_NODES[1]!.transform)).toBe(0);
      // cell2's lamp is untouched.
      expect(reparsed.find((n) => n.cellName === 'cell2')).toEqual(RECIPE_NODES[2]);
    });
  });

  // ─── Real-asset fixture lane (Task 4/C5) — REQUIRED, not skip-on-absent ─────────────────────
  describe('real-asset fixture (gitignored, extracted from an installed client — REQUIRED per C5)', () => {
    it('fixtures-real/ilf/*.ilf is present (run extract-ilf-fixtures.cjs if this fails)', () => {
      expect(loadRealIlfFixture()).not.toBeNull();
    });

    it('byte-exact round-trip — real extracted .ilf asset', () => {
      const bytes = loadRealIlfFixture();
      expect(bytes).not.toBeNull();
      assertRoundTrip(
        (b) => parseIlfFile(b as Uint8Array),
        (p) => serializeIlfFile(p),
        bytes!,
      );
    });

    it('addNode/removeNode: byte-exact round-trip against the real extracted .ilf asset', () => {
      const bytes = loadRealIlfFixture();
      expect(bytes).not.toBeNull();
      const baseNodes = parseIlfFile(bytes!);
      expect(baseNodes.length).toBeGreaterThan(0);

      // addNode: append, round-trip byte-stable, recover at the correct within-cell rowIndex.
      const firstCell = baseNodes[0]!.cellName;
      const priorCountInCell = baseNodes.filter((n) => n.cellName === firstCell).length;
      const added: IlfNode = {
        objectTemplateName: 'object/tangible/furniture/shared_frn_stool.iff',
        cellName: firstCell,
        transform: [1, 0, 0, 111, 0, 1, 0, 222, 0, 0, 1, 333],
      };
      const withAdded = addNode(baseNodes, added);
      const addedBuf1 = serializeIlf(withAdded);
      const addedBuf2 = serializeIlf(parseIlf(addedBuf1));
      expect(addedBuf2.equals(addedBuf1)).toBe(true);
      const addedReparsed = parseIlf(addedBuf1);
      expect(resolveRowIndex(addedReparsed, firstCell, added.objectTemplateName, added.transform)).toBe(priorCountInCell);

      // removeNode: drop the first node, every sibling byte-identical, round-trip byte-stable.
      const withRemoved = removeNode(baseNodes, firstCell, 0);
      const removedBuf1 = serializeIlf(withRemoved);
      const removedBuf2 = serializeIlf(parseIlf(removedBuf1));
      expect(removedBuf2.equals(removedBuf1)).toBe(true);
      const removedReparsed = parseIlf(removedBuf1);
      expect(removedReparsed.length).toBe(baseNodes.length - 1);
    });
  });
});
