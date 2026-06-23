/**
 * assertRoundTrip.ts — CORE-05 byte-exact round-trip assertion
 *
 * Calls serialize(parse(fixtureBytes)) and asserts the result is byte-for-byte
 * identical to the original fixture bytes. On mismatch, throws an Error with a
 * SIE-style diagnostic: the first differing offset in 0x-prefixed hex plus a
 * 16-byte hex window of expected-vs-actual bytes.
 *
 * Used by: packages/harness/test/tre-roundtrip.test.ts
 *          Any future format test that registers in fixtureRegistry.ts
 *
 * Standing gate: every registered format's round-trip proof goes through here.
 * A mismatch is a hard failure — do not swallow it.
 *
 * Source: CORE-05 requirement; RESEARCH.md § "Verification Harness (CORE-05)".
 * Pattern: SIE-style diff diagnostics (hex window at first differing offset).
 */

/**
 * Assert that serialize(parse(fixtureBytes)) produces byte-for-byte identical
 * output to fixtureBytes.
 *
 * @param parse     - Parser function: Uint8Array -> parsed representation
 * @param serialize - Serializer function: parsed representation -> Uint8Array
 * @param fixtureBytes - The expected bytes (the fixture)
 * @throws Error if the round-trip output differs, with offset + hex window
 */
export function assertRoundTrip(
  parse: (bytes: Uint8Array) => unknown,
  serialize: (parsed: unknown) => Uint8Array,
  fixtureBytes: Uint8Array,
): void {
  const parsed = parse(fixtureBytes);
  const actual = serialize(parsed);

  // Length check first (fast path)
  if (actual.length !== fixtureBytes.length) {
    const window = buildHexWindow(fixtureBytes, actual, 0);
    throw new Error(
      `round-trip FAIL: length mismatch — expected ${fixtureBytes.length} bytes, ` +
      `got ${actual.length} bytes\n${window}`,
    );
  }

  // Byte-for-byte scan — find the first differing offset
  for (let i = 0; i < fixtureBytes.length; i++) {
    if (fixtureBytes[i] !== actual[i]) {
      const hexOffset = `0x${i.toString(16).toUpperCase().padStart(4, '0')}`;
      const window = buildHexWindow(fixtureBytes, actual, i);
      throw new Error(
        `round-trip FAIL @ ${hexOffset}\n${window}`,
      );
    }
  }
}

/**
 * Build a human-readable hex window around the first differing offset.
 * Shows up to 16 bytes of expected vs actual, highlighting the first diff.
 *
 * @param expected - Expected bytes (fixture)
 * @param actual   - Actual bytes (round-trip output)
 * @param offset   - The first differing offset
 * @returns Formatted diagnostic string
 */
function buildHexWindow(
  expected: Uint8Array,
  actual: Uint8Array,
  offset: number,
): string {
  const WINDOW = 16;
  const start = Math.max(0, offset - Math.floor(WINDOW / 2));
  const end = Math.min(
    Math.max(expected.length, actual.length),
    start + WINDOW,
  );

  const expectedSlice = Array.from({ length: end - start }, (_, i) => {
    const idx = start + i;
    return idx < expected.length
      ? expected[idx].toString(16).padStart(2, '0')
      : '--';
  }).join(' ');

  const actualSlice = Array.from({ length: end - start }, (_, i) => {
    const idx = start + i;
    return idx < actual.length
      ? actual[idx].toString(16).padStart(2, '0')
      : '--';
  }).join(' ');

  const offsetStr = `0x${start.toString(16).toUpperCase().padStart(4, '0')}`;
  return (
    `  expected[${offsetStr}]: ${expectedSlice}\n` +
    `  actual  [${offsetStr}]: ${actualSlice}`
  );
}
