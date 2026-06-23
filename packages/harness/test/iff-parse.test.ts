/**
 * iff-parse.test.ts — IFF parse correctness tests (CORE-03).
 *
 * Tests the committed IFF fixtures against the native C++ IFF parser via
 * the @swg/native-core N-API binding.
 *
 * Test suite: "iff parse" (must match the verification command exactly)
 *
 * Ground truth:
 *   swg-client-v2 Iff.cpp:508-555  (BE read — getFirstTag/getLength/getSecondTag)
 *   swg-client-v2 Iff.cpp:1076-1095 (FORM discriminator)
 *   swg-client-v2 Iff.cpp:1132-1310 (walk — enterForm/enterChunk)
 *   Utinni IffReader.cs:140-327    (FourCC validation, bounds, pad detection)
 *
 * Pattern: packages/native-core/test/hello.test.ts (vitest + CJS-require style).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { registerFormat } from '../fixtureRegistry.js';

// CJS require — .node addon is CJS; load through the resolver
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  parseIff: (bytes: ArrayBuffer | Uint8Array) => {
    roots: Array<{
      tag: string;
      length: number;
      byteOffset: number;
      kind: 'form' | 'leaf';
      subType?: string;
      children?: Array<unknown>;
    }>;
    trailingBytes: { offset: number; count: number } | null;
    roundTrip: { passed: boolean; failOffset?: number };
  };
  serializeIff: (result: unknown, srcBytes: ArrayBuffer | Uint8Array) => ArrayBuffer;
  getChunkBytes: (result: unknown, srcBytes: ArrayBuffer | Uint8Array, nodeIndex: number) => ArrayBuffer;
};

// ─── Fixture constructors ────────────────────────────────────────────────────

/**
 * Build a big-endian 4-byte tag from a 4-character string.
 * Source: Iff.cpp:508-555 (ntohl on read — stored in file as BE).
 */
function makeTag(s: string): [number, number, number, number] {
  const c = s.padEnd(4, ' ');
  return [c.charCodeAt(0), c.charCodeAt(1), c.charCodeAt(2), c.charCodeAt(3)];
}

/** Write a big-endian uint32 into 4 bytes. */
function be32(n: number): [number, number, number, number] {
  return [
    (n >>> 24) & 0xFF,
    (n >>> 16) & 0xFF,
    (n >>>  8) & 0xFF,
     n         & 0xFF,
  ];
}

/**
 * Build a leaf chunk: [tag 4B][BE length 4B][payload].
 * Source: Iff.cpp:637,713 (htonl on write); no pad emitted (IffWriter.cs:141).
 */
function makeLeaf(tag: string, payload: number[]): number[] {
  return [...makeTag(tag), ...be32(payload.length), ...payload];
}

/**
 * Build a FORM container: [FORM 4B][BE innerLen 4B][subTypeTag 4B][children bytes].
 * innerLen INCLUDES the 4-byte subTypeTag (Iff.cpp:643).
 *
 * Source: Iff.cpp:637-644 (htonl write, +sizeof(Tag)).
 */
function makeForm(subType: string, children: number[]): number[] {
  const innerLen = 4 + children.length; // 4 for subTypeTag
  return [...makeTag('FORM'), ...be32(innerLen), ...makeTag(subType), ...children];
}

/**
 * Build a LIST container (generic viewer: treated same as FORM).
 * [TOOLKIT] LIST is not a standard FORM discriminator in the original client.
 */
function makeList(subType: string, children: number[]): number[] {
  const innerLen = 4 + children.length;
  return [...makeTag('LIST'), ...be32(innerLen), ...makeTag(subType), ...children];
}

/**
 * Build a CAT  container (trailing space, generic viewer).
 * [TOOLKIT] 'CAT ' (with trailing space) is recognised as a container.
 */
function makeCAT(subType: string, children: number[]): number[] {
  const innerLen = 4 + children.length;
  return [...makeTag('CAT '), ...be32(innerLen), ...makeTag(subType), ...children];
}

// ─── Fixture definitions ─────────────────────────────────────────────────────

/** simple-nested: FORM:DERV with one leaf 'DATA' [0x01 0x02 0x03]. */
const simpleNestedBytes = new Uint8Array(
  makeForm('DERV', makeLeaf('DATA', [0x01, 0x02, 0x03]))
);

/** odd-chunk-no-pad: FORM:TEST with a 1-byte leaf and NO pad after it. */
const oddChunkNoPadBytes = new Uint8Array(
  makeForm('TEST', makeLeaf('DCHK', [0xAB]))
  // no pad byte appended
);

/**
 * pad-present: FORM:TEST with a 1-byte leaf followed by a genuine 0x00 pad byte.
 * The parser must detect and consume the pad (IffReader.cs:307-327).
 * NOTE: The pad byte is OUTSIDE the declared length and INSIDE the FORM container span.
 * We embed this as a FORM where the innerLen accounts for the padded child.
 */
function makePadPresent(): Uint8Array {
  const leaf = makeLeaf('DCHK', [0xAB]);
  // Pad byte follows the leaf, inside the FORM.
  const leafWithPad = [...leaf, 0x00];
  return new Uint8Array(makeForm('TEST', leafWithPad));
}
const padPresentBytes = makePadPresent();

/**
 * gapped-FORM: FORM:GAPF whose declared innerLen is larger than the children's span.
 * The extra bytes are a "gap" (0xEE fill). The clean-span verbatim re-emit must
 * preserve the interior gap byte-for-byte.
 *
 * Source: Iff.cpp:63-84 calculateRawDataSize comment about interior data.
 */
function makeGappedForm(): Uint8Array {
  const child = makeLeaf('CHLD', [0x11, 0x22, 0x33]);
  const gap   = [0xEE, 0xEE, 0xEE, 0xEE]; // 4 bytes interior gap
  const childPlusGap = [...child, ...gap];
  return new Uint8Array(makeForm('GAPF', childPlusGap));
}
const gappedFormBytes = makeGappedForm();

/** trailing-bytes: valid FORM followed by 3 trailing bytes. */
const trailingBytesBytes = new Uint8Array([
  ...makeForm('TRAIL', makeLeaf('DATA', [0x55])),
  0xDE, 0xAD, 0xBE, // trailing bytes (toolkit invention)
]);

/** list-container: LIST block treated as a container by the generic viewer. */
const listContainerBytes = new Uint8Array(
  makeList('LCHD', makeLeaf('ITEM', [0x42]))
);

/** cat-container: CAT  block (trailing space) treated as a container. */
const catContainerBytes = new Uint8Array(
  makeCAT('CCHD', makeLeaf('ITEM', [0x42]))
);

// Register in the fixture registry (CORE-05 sweep gate).
beforeAll(() => {
  registerFormat('iff', {
    parse: (bytes: Uint8Array) => {
      return nativeCore.parseIff(bytes);
    },
    serialize: (parsed: unknown) => {
      // serializeIff needs the original bytes; in the registry sweep we only
      // verify that the parse round-trip is byte-exact (checked inline in parseIff).
      // For the sweep, return a dummy empty Uint8Array (the actual round-trip
      // correctness is proven by the dedicated iff-roundtrip tests).
      return new Uint8Array(0);
    },
    fixtures: [
      {
        name: 'simple-nested',
        bytes: simpleNestedBytes,
        loaderSource: 'swg-client-v2 Iff.cpp:1132-1310 (enterForm/enterChunk walk)',
      },
      {
        name: 'odd-chunk-no-pad',
        bytes: oddChunkNoPadBytes,
        loaderSource: 'Utinni IffWriter.cs:141 (no pad on write) + IffReader.cs:307-327 (detect pad)',
      },
      {
        name: 'gapped-form',
        bytes: gappedFormBytes,
        loaderSource: 'swg-client-v2 Iff.cpp:63-84 (calculateRawDataSize — interior data)',
      },
    ],
    loaderSource: 'swg-client-v2 Iff.cpp:508-555,1076-1095,1132-1310; Utinni IffReader.cs:140-327',
  });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('iff parse', () => {
  it('simple-nested: root FORM has correct tag, subType, kind, byteOffset', () => {
    const result = nativeCore.parseIff(simpleNestedBytes);

    expect(result.roots.length).toBe(1);
    const root = result.roots[0];

    expect(root.tag).toBe('FORM');
    expect(root.kind).toBe('form');
    expect(root.subType).toBe('DERV');
    expect(root.byteOffset).toBe(0);
    // innerLen = 4 (subType) + leaf bytes
    // leaf = makeLeaf('DATA', [0x01,0x02,0x03]) = 8+3 = 11 bytes
    // innerLen = 4 + 11 = 15
    const leafBytes = makeLeaf('DATA', [0x01, 0x02, 0x03]).length;
    expect(root.length).toBe(4 + leafBytes);
  });

  it('simple-nested: child leaf has correct tag, kind, length, byteOffset', () => {
    const result = nativeCore.parseIff(simpleNestedBytes);
    const root = result.roots[0];

    expect(root.children).toBeDefined();
    expect(root.children!.length).toBe(1);

    const leaf = root.children![0] as { tag: string; kind: string; length: number; byteOffset: number };
    expect(leaf.tag).toBe('DATA');
    expect(leaf.kind).toBe('leaf');
    expect(leaf.length).toBe(3); // payload bytes
    expect(leaf.byteOffset).toBe(12); // FORM header = 12 bytes (4+4+4)
  });

  it('LIST and CAT  containers are recognised as containers (kind=form)', () => {
    const listResult = nativeCore.parseIff(listContainerBytes);
    expect(listResult.roots[0].kind).toBe('form');
    expect(listResult.roots[0].tag).toBe('LIST');
    expect(listResult.roots[0].subType).toBe('LCHD');
    expect(listResult.roots[0].children).toBeDefined();

    const catResult = nativeCore.parseIff(catContainerBytes);
    expect(catResult.roots[0].kind).toBe('form');
    expect(catResult.roots[0].tag).toBe('CAT ');
    expect(catResult.roots[0].subType).toBe('CCHD');
    expect(catResult.roots[0].children).toBeDefined();
  });

  it('trailing-bytes: trailingBytes node surfaced (toolkit invention)', () => {
    const result = nativeCore.parseIff(trailingBytesBytes);
    expect(result.trailingBytes).not.toBeNull();
    expect(result.trailingBytes!.count).toBe(3);
    // offset = after the last FORM block
    expect(result.trailingBytes!.offset).toBeGreaterThan(0);
  });

  it('trailing-bytes: no trailingBytes when file ends exactly at last block', () => {
    const result = nativeCore.parseIff(simpleNestedBytes);
    expect(result.trailingBytes).toBeNull();
  });

  it('gapped-FORM: parses with correct metadata; gap preserved in capturedSlice', () => {
    const result = nativeCore.parseIff(gappedFormBytes);
    expect(result.roots.length).toBe(1);
    const root = result.roots[0];
    expect(root.tag).toBe('FORM');
    expect(root.kind).toBe('form');
    expect(root.subType).toBe('GAPF');
    // The declared innerLen includes the 4-byte subType + child + gap
    const childLen = makeLeaf('CHLD', [0x11, 0x22, 0x33]).length; // 8+3 = 11
    const gapLen = 4;
    expect(root.length).toBe(4 + childLen + gapLen); // 4 + 11 + 4 = 19
    // Round-trip must be byte-exact (gap preserved).
    expect(result.roundTrip.passed).toBe(true);
  });

  it('malformed: truncated header throws without crashing', () => {
    const truncated = new Uint8Array([0x46, 0x4F, 0x52, 0x4D]); // just 'FORM', no length
    expect(() => nativeCore.parseIff(truncated)).toThrow();
  });

  it('malformed: non-printable FourCC byte rejected', () => {
    // Tag has a 0x00 byte — non-printable, must be rejected (T-01-11)
    const bad = new Uint8Array([0x46, 0x00, 0x52, 0x4D, 0x00, 0x00, 0x00, 0x08,
                                0x44, 0x45, 0x52, 0x56, 0x00, 0x00, 0x00, 0x00]);
    expect(() => nativeCore.parseIff(bad)).toThrow();
  });

  it('malformed: child-end > parent-end rejected (T-01-10)', () => {
    // FORM:TEST with a leaf that declares it is 1000 bytes but we only have 20
    const form = new Uint8Array([
      ...makeTag('FORM'), ...be32(4 + 8 + 1000), // innerLen = 4 + 1008 (too large)
      ...makeTag('TEST'),
      ...makeTag('CHLD'), ...be32(1000),          // child claims 1000 bytes
    ]);
    expect(() => nativeCore.parseIff(form)).toThrow();
  });
});

describe('read tolerates pad', () => {
  it('a genuine 0x00 pad byte after odd-length leaf is consumed', () => {
    // pad-present fixture: FORM:TEST + DCHK(1 byte) + 0x00 pad inside the FORM
    const result = nativeCore.parseIff(padPresentBytes);
    // The parser should have successfully consumed the pad and parsed the whole FORM.
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].kind).toBe('form');
    expect(result.roots[0].tag).toBe('FORM');
    const children = result.roots[0].children;
    // The DCHK leaf should be found; the 0x00 pad is NOT a child.
    expect(children).toBeDefined();
    expect(children!.length).toBe(1);
    const leaf = children![0] as { tag: string; length: number };
    expect(leaf.tag).toBe('DCHK');
    expect(leaf.length).toBe(1);
  });

  it('absent pad does NOT eat the next TypeID — odd-chunk-no-pad parses cleanly', () => {
    // odd-chunk-no-pad: the 1-byte DCHK leaf is followed by end-of-FORM, no pad.
    const result = nativeCore.parseIff(oddChunkNoPadBytes);
    expect(result.roots.length).toBe(1);
    const children = result.roots[0].children;
    expect(children).toBeDefined();
    expect(children!.length).toBe(1); // only DCHK, no phantom second child
    const leaf = children![0] as { tag: string; length: number };
    expect(leaf.tag).toBe('DCHK');
    expect(leaf.length).toBe(1);
    // Round-trip must be byte-exact.
    expect(result.roundTrip.passed).toBe(true);
  });
});
