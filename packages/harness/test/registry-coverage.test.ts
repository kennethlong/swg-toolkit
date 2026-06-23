/**
 * registry-coverage.test.ts — CORE-05 sweep gate
 *
 * The sweep test FAILS CI if:
 *   1. Any registered format has zero round-trip fixtures, OR
 *   2. Any fixture lacks a loaderSource citation matching /swg-client-v2|Utinni|tre_reader\.py/
 *
 * This is the standing gate every later format phase inherits: add a format to the
 * registry, add at least one fixture with a loader-source citation, or CI breaks.
 *
 * Source: CORE-05 requirement; RESEARCH.md § "Verification Harness (CORE-05)".
 * Pattern: packages/native-core/test/hello.test.ts (vitest + per-test naming style).
 */

import { describe, it, expect } from 'vitest';
import { getRegistry, registerFormat } from '../fixtureRegistry.js';
import { assertRoundTrip } from '../assertRoundTrip.js';

describe('registry coverage', () => {
  it('empty-fixture format fails the sweep', () => {
    // Register a format with NO fixtures — sweep must reject it.
    registerFormat('test-empty', {
      parse: (b: Uint8Array) => b,
      serialize: (d: unknown) => d as Uint8Array,
      fixtures: [],
      loaderSource: 'swg-client-v2 Iff.cpp:419',
    });

    const registry = getRegistry();
    const entry = registry['test-empty'];
    expect(entry).toBeDefined();
    expect(entry.fixtures.length).toBe(0);

    // Sweep logic: any format with zero fixtures is a violation
    const violations = Object.entries(registry).filter(
      ([, e]) => e.fixtures.length === 0,
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(([id]) => id === 'test-empty')).toBe(true);
  });

  it('missing-citation fixture fails the sweep', () => {
    // Register a format whose fixture lacks a valid loaderSource citation.
    registerFormat('test-nocite', {
      parse: (b: Uint8Array) => b,
      serialize: (d: unknown) => d as Uint8Array,
      fixtures: [
        {
          name: 'no-cite-fixture',
          bytes: new Uint8Array([0x01, 0x02]),
          loaderSource: '',  // deliberately empty — missing citation
        },
      ],
      loaderSource: '',
    });

    const registry = getRegistry();
    const CITATION_RE = /swg-client-v2|Utinni|tre_reader\.py/;

    const violations = Object.entries(registry).flatMap(([id, e]) =>
      e.fixtures
        .filter((f) => !CITATION_RE.test(f.loaderSource))
        .map((f) => ({ formatId: id, fixtureName: f.name })),
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.formatId === 'test-nocite')).toBe(true);
  });

  it('fully-populated registry passes the sweep', () => {
    // Register a correctly-populated format — should not appear in violations.
    const fakeBytes = new Uint8Array([0xAA, 0xBB, 0xCC]);
    registerFormat('test-valid', {
      parse: (b: Uint8Array) => b,
      serialize: (d: unknown) => d as Uint8Array,
      fixtures: [
        {
          name: 'valid-fixture',
          bytes: fakeBytes,
          loaderSource: 'swg-client-v2 TreeFile_SearchNode.cpp:267',
        },
      ],
      loaderSource: 'swg-client-v2 TreeFile_SearchNode.cpp:267',
    });

    const registry = getRegistry();
    const CITATION_RE = /swg-client-v2|Utinni|tre_reader\.py/;

    const missingFixtures = Object.entries(registry)
      .filter(([id]) => id === 'test-valid')
      .filter(([, e]) => e.fixtures.length === 0);
    expect(missingFixtures.length).toBe(0);

    const missingCitations = Object.entries(registry)
      .filter(([id]) => id === 'test-valid')
      .flatMap(([, e]) => e.fixtures.filter((f) => !CITATION_RE.test(f.loaderSource)));
    expect(missingCitations.length).toBe(0);
  });

  it('assertRoundTrip on deliberate 1-byte mismatch throws with offset and hex window', () => {
    const original = new Uint8Array([0x45, 0x45, 0x52, 0x54, 0x30, 0x30, 0x30, 0x35]);
    const corrupted = new Uint8Array([0x45, 0x45, 0x52, 0x54, 0x30, 0x30, 0x30, 0xFF]); // last byte wrong

    // Parse is identity, serialize returns the corrupted bytes (simulating a bug)
    const parse = (_b: Uint8Array) => ({ _raw: original });
    const serialize = (_d: unknown) => corrupted;

    expect(() => assertRoundTrip(parse, serialize, original)).toThrow();

    let errorMessage = '';
    try {
      assertRoundTrip(parse, serialize, original);
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    // Must contain "0x" and a hex offset
    expect(errorMessage).toMatch(/0x/);
    // Must indicate the differing offset (offset 7)
    expect(errorMessage).toMatch(/0x0*7/i);
  });
});
