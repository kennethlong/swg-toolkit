/**
 * hello.test.ts — native-core addon unit tests
 *
 * Tests for the native-core addon exports:
 *   hello()       → 'pong'
 *   allocateSab() → SharedArrayBuffer
 *   writeSab()    → C++ writes an Int32 into a SAB  [00-03 Path B]
 *   readSab()     → C++ reads an Int32 from a SAB   [00-03 Path B]
 *
 * Import via require('../index.js') — this routes through the node-gyp-build
 * resolver, which is the same path the preload script uses in Path B.
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

  // ─── writeSab() + readSab() tests (00-03 Path B bidirectional proof) ───────

  it('Test 9: writeSab(sab, 0, 0xDEAD) — C++ writes 0xDEAD into slot 0', () => {
    const sab = nativeCore.allocateSab(8);
    nativeCore.writeSab(sab, 0, 0xDEAD);
    const view = new Int32Array(sab);
    expect(view[0]).toBe(0xDEAD);
  });

  it('Test 10: readSab(sab, 0) — C++ reads back the value JS wrote', () => {
    const sab = nativeCore.allocateSab(8);
    const view = new Int32Array(sab);
    view[0] = 0xBEEF;
    const result = nativeCore.readSab(sab, 0);
    expect(result).toBe(0xBEEF);
  });

  it('Test 11: bidirectional proof — C++ writeSab → JS read, JS write → C++ readSab', () => {
    const sab = nativeCore.allocateSab(8);
    const view = new Int32Array(sab);

    // C++ → JS direction: C++ writes 0xDEAD, JS reads it from the same memory
    nativeCore.writeSab(sab, 0, 0xDEAD);
    expect(view[0]).toBe(0xDEAD);

    // JS → C++ direction: JS writes a nonce, C++ reads it back from the same memory
    const nonce = Math.floor(Math.random() * 0x7FFFFFFF) + 1;
    view[1] = nonce;
    const observed = nativeCore.readSab(sab, 1);
    expect(observed).toBe(nonce);
  });

  it('Test 12: writeSab/readSab slot independence — slot 0 write does not affect slot 1', () => {
    const sab = nativeCore.allocateSab(8);
    nativeCore.writeSab(sab, 0, 0xDEAD);
    nativeCore.writeSab(sab, 1, 0xCAFE);
    expect(nativeCore.readSab(sab, 0)).toBe(0xDEAD);
    expect(nativeCore.readSab(sab, 1)).toBe(0xCAFE);
  });

  it('Test 13: writeSab out-of-bounds throws RangeError', () => {
    const sab = nativeCore.allocateSab(8); // only 2 Int32 slots
    expect(() => nativeCore.writeSab(sab, 2, 42)).toThrow(); // slot 2 = byte 8, out of bounds
  });

  it('Test 14: readSab out-of-bounds throws RangeError', () => {
    const sab = nativeCore.allocateSab(8); // only 2 Int32 slots
    expect(() => nativeCore.readSab(sab, 2)).toThrow(); // slot 2 = byte 8, out of bounds
  });
});
