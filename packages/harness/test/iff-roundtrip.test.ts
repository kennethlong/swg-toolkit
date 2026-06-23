/**
 * iff-roundtrip.test.ts — IFF byte-exact round-trip tests (CORE-04, CORE-05).
 *
 * Tests that serialize(parse(fixtureBytes)) === fixtureBytes for every committed
 * IFF fixture, using the harness assertRoundTrip gate.
 *
 * Test suite: "iff roundtrip" (must match the verification command exactly)
 *
 * Key fixtures proven:
 *   - simple-nested: basic FORM+leaf round-trip
 *   - odd-chunk-no-pad: odd-length leaf, NO pad inserted on write (IffWriter.cs:141)
 *   - gapped-FORM: FORM with interior gap bytes — clean-span verbatim re-emit preserves
 *     the gap (the load-bearing fidelity guarantee, MUST-PASS criterion)
 *   - trailing-bytes: bytes after last top-level block re-emitted verbatim
 *   - list-container: LIST container round-trips
 *   - cat-container: CAT  container round-trips
 *
 * Ground truth:
 *   swg-client-v2 Iff.cpp:419-429 (verbatim write — dump buffer verbatim)
 *   Utinni IffWriter.cs:98-187   (hybrid-DOM verbatim re-emit)
 *   Utinni IffWriter.cs:141      (NO pad byte on write)
 *
 * Pattern: packages/harness/test/tre-roundtrip.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { assertRoundTrip } from '../assertRoundTrip.js';

// CJS require — .node addon is CJS; load through the resolver
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  parseIff: (bytes: ArrayBuffer | Uint8Array) => unknown;
  serializeIff: (result: unknown, srcBytes: ArrayBuffer | Uint8Array) => ArrayBuffer;
};

// ─── Parse/serialize wrappers for assertRoundTrip ─────────────────────────────

function parseIff(bytes: Uint8Array): { result: unknown; srcBytes: Uint8Array } {
  return { result: nativeCore.parseIff(bytes), srcBytes: bytes };
}

function serializeIff(parsed: unknown): Uint8Array {
  const { result, srcBytes } = parsed as { result: unknown; srcBytes: Uint8Array };
  const ab = nativeCore.serializeIff(result, srcBytes);
  return new Uint8Array(ab);
}

// ─── Fixture helpers (same logic as iff-parse.test.ts) ───────────────────────

function makeTag(s: string): [number, number, number, number] {
  const c = s.padEnd(4, ' ');
  return [c.charCodeAt(0), c.charCodeAt(1), c.charCodeAt(2), c.charCodeAt(3)];
}

function be32(n: number): [number, number, number, number] {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
}

function makeLeaf(tag: string, payload: number[]): number[] {
  return [...makeTag(tag), ...be32(payload.length), ...payload];
}

function makeForm(subType: string, children: number[]): number[] {
  const innerLen = 4 + children.length;
  return [...makeTag('FORM'), ...be32(innerLen), ...makeTag(subType), ...children];
}

function makeList(subType: string, children: number[]): number[] {
  const innerLen = 4 + children.length;
  return [...makeTag('LIST'), ...be32(innerLen), ...makeTag(subType), ...children];
}

function makeCAT(subType: string, children: number[]): number[] {
  const innerLen = 4 + children.length;
  return [...makeTag('CAT '), ...be32(innerLen), ...makeTag(subType), ...children];
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const simpleNestedBytes = new Uint8Array(
  makeForm('DERV', makeLeaf('DATA', [0x01, 0x02, 0x03]))
);

const oddChunkNoPadBytes = new Uint8Array(
  makeForm('TEST', makeLeaf('DCHK', [0xAB]))
);

const gappedFormBytes = new Uint8Array(
  makeForm('GAPF', [
    ...makeLeaf('CHLD', [0x11, 0x22, 0x33]),
    0xEE, 0xEE, 0xEE, 0xEE, // interior gap
  ])
);

const trailingBytesBytes = new Uint8Array([
  ...makeForm('TRAIL', makeLeaf('DATA', [0x55])),
  0xDE, 0xAD, 0xBE,
]);

const listContainerBytes = new Uint8Array(
  makeList('LCHD', makeLeaf('ITEM', [0x42]))
);

const catContainerBytes = new Uint8Array(
  makeCAT('CCHD', makeLeaf('ITEM', [0x42]))
);

// Multi-child FORM
const multiChildBytes = new Uint8Array(
  makeForm('MCHS', [
    ...makeLeaf('AAA ', [0x01, 0x02]),
    ...makeLeaf('BBB ', [0x03, 0x04, 0x05]),
    ...makeLeaf('CCC ', []),
  ])
);

// Deep nesting: FORM:OUTER > FORM:INNER > leaf DEEP
const deepNestedBytes = new Uint8Array(
  makeForm('OUTR', makeForm('INNR', makeLeaf('DEEP', [0xFF, 0xFE])))
);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('iff roundtrip', () => {
  it('simple-nested: byte-exact round-trip', () => {
    assertRoundTrip(parseIff, serializeIff, simpleNestedBytes);
  });

  it('odd-chunk-no-pad: byte-exact round-trip (no pad byte inserted on write)', () => {
    // This is the core WRITE-NO-PAD invariant: IffWriter.cs:141.
    assertRoundTrip(parseIff, serializeIff, oddChunkNoPadBytes);
  });

  it('gapped-FORM: byte-exact round-trip (interior gap preserved — LOAD-BEARING)', () => {
    // This is the CLEAN-SPAN-VERBATIM load-bearing fidelity guarantee.
    // The FORM's declared innerLen > children span; the extra bytes are an interior gap.
    // The serializer MUST re-emit the full declared span verbatim, preserving the gap.
    // Source: Utinni IffWriter.cs:98-110 (capturedSlice verbatim re-emit).
    assertRoundTrip(parseIff, serializeIff, gappedFormBytes);
  });

  it('trailing-bytes: byte-exact round-trip (trailing bytes appended verbatim)', () => {
    // [TOOLKIT] Trailing bytes after the last top-level block are re-emitted verbatim.
    assertRoundTrip(parseIff, serializeIff, trailingBytesBytes);
  });

  it('list-container: byte-exact round-trip', () => {
    assertRoundTrip(parseIff, serializeIff, listContainerBytes);
  });

  it('cat-container: byte-exact round-trip', () => {
    assertRoundTrip(parseIff, serializeIff, catContainerBytes);
  });

  it('multi-child FORM: byte-exact round-trip', () => {
    assertRoundTrip(parseIff, serializeIff, multiChildBytes);
  });

  it('deep-nested: byte-exact round-trip', () => {
    assertRoundTrip(parseIff, serializeIff, deepNestedBytes);
  });

  it('inline roundTrip.passed flag is true for all clean fixtures', () => {
    // The parseIff result includes a roundTrip field; it should be true for all clean fixtures.
    const fixtures: Uint8Array[] = [
      simpleNestedBytes,
      oddChunkNoPadBytes,
      gappedFormBytes,
      listContainerBytes,
      catContainerBytes,
      multiChildBytes,
      deepNestedBytes,
    ];
    for (const fixture of fixtures) {
      const result = nativeCore.parseIff(fixture) as { roundTrip: { passed: boolean } };
      expect(result.roundTrip.passed).toBe(true);
    }
  });
});
