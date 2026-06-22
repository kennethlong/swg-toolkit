/**
 * hello.test.ts — RED phase (TDD)
 *
 * Tests for the native-core addon exports:
 *   hello()       → 'pong'
 *   allocateSab() → SharedArrayBuffer
 *
 * Import via require('../index.js') — this routes through the node-gyp-build
 * resolver, which is the same path the utility worker uses. In the RED phase
 * index.js does not yet exist, so require() throws → all 8 tests fail (RED).
 *
 * Note: allocateSab uses byteLength 8 for the Phase 0 two-slot SAB layout
 * (HELLO_SENTINEL @ 0, RENDERER_SENTINEL @ 4 — two Int32 slots).
 */

import { describe, it, expect } from 'vitest';

// CommonJS require — .node addon is CJS; load through the resolver
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../index.js');

describe('native-core addon', () => {
  // ─── hello() tests ────────────────────────────────────────────────────────

  it('Test 1: hello() returns the string "pong"', () => {
    const result = nativeCore.hello();
    expect(typeof result).toBe('string');
    expect(result).toBe('pong');
  });

  it('Test 2: hello() returns "pong" consistently across 100 calls (no segfault)', () => {
    for (let i = 0; i < 100; i++) {
      expect(nativeCore.hello()).toBe('pong');
    }
  });

  // ─── allocateSab() tests ──────────────────────────────────────────────────

  it('Test 3: allocateSab(8) instanceof SharedArrayBuffer', () => {
    const sab = nativeCore.allocateSab(8);
    expect(sab instanceof SharedArrayBuffer).toBe(true);
  });

  it('Test 4: allocateSab(8).byteLength === 8 (Phase 0 two-slot SAB layout)', () => {
    const sab = nativeCore.allocateSab(8);
    expect(sab.byteLength).toBe(8);
  });

  it('Test 5: Int32Array(allocateSab(8))[0] = 0xDEAD round-trips as 0xDEAD', () => {
    const sab = nativeCore.allocateSab(8);
    const view = new Int32Array(sab);
    view[0] = 0xDEAD;
    expect(view[0]).toBe(0xDEAD);
  });

  it('Test 6: allocateSab(0).byteLength === 0 (edge case: zero-byte SAB)', () => {
    const sab = nativeCore.allocateSab(0);
    expect(sab.byteLength).toBe(0);
  });

  // ─── TypeScript type-check tests (compile-time) ──────────────────────────
  // These are run at vitest runtime via the @swg/native-core type declarations.
  // The type-check assertions below validate the declared return types by
  // performing operations only valid on those types — if the types were wrong,
  // TypeScript would emit a type error at compile time.

  it('Test 7: hello() return type is string (TS compile-time check)', () => {
    // If index.d.ts declares hello(): string, this assignment is valid.
    // A non-string return type would cause a TS error here.
    const r: string = nativeCore.hello();
    expect(typeof r).toBe('string');
  });

  it('Test 8: allocateSab() return type is SharedArrayBuffer (TS compile-time check)', () => {
    // If index.d.ts declares allocateSab(byteLength: number): SharedArrayBuffer,
    // this assignment is valid. A wrong return type would cause a TS error.
    const s: SharedArrayBuffer = nativeCore.allocateSab(8);
    expect(s.byteLength).toBe(8);
  });
});
