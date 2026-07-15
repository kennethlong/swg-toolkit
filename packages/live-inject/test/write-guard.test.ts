// write-guard.test.ts — Tests for the pure read-verify write guard comparator.
//
// The guard predicate is implemented in C++ (agent/write.cpp). This file tests
// a TypeScript-equivalent port to avoid requiring a native addon compile cycle
// for vitest — the TS port mirrors the C++ logic exactly (same exactness rule,
// same independent transform/scale gating, same failReason strings). This is
// the SAME convention sentinels.test.ts already establishes for this project.
//
// Reference: PLAN 05-01 Task 2 <behavior> block.

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// TypeScript port of agent/write.cpp checkWriteGuard (pure / Win32-free)
// ---------------------------------------------------------------------------
//
// RED STUB — intentionally wrong (always reports "not implemented" via a
// thrown error) so this file's tests fail before Task 2's implementation
// step. Made GREEN in the same task's implementation commit.

interface GuardResult {
  transformPassed: boolean;
  scalePassed: boolean;
  failReason: string | null;
}

function checkWriteGuard(
  _live: Float32Array,
  _expected: Float32Array,
  _liveScale: Float32Array,
  _expectedScale: Float32Array,
): GuardResult {
  throw new Error('checkWriteGuard not implemented (RED stub)');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkWriteGuard', () => {
  it('both transform and scale match -> both pass', () => {
    const xform = new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]);
    const scale = new Float32Array([1, 1, 1]);
    const result = checkWriteGuard(xform, xform.slice(), scale, scale.slice());
    expect(result.transformPassed).toBe(true);
    expect(result.scalePassed).toBe(true);
    expect(result.failReason).toBeNull();
  });

  it('transform-only mismatch -> transformPassed:false, scalePassed:true', () => {
    const live = new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]);
    const expected = new Float32Array([1, 0, 0, 11, 0, 1, 0, 20, 0, 0, 1, 30]); // translation X differs
    const scale = new Float32Array([1, 1, 1]);
    const result = checkWriteGuard(live, expected, scale, scale.slice());
    expect(result.transformPassed).toBe(false);
    expect(result.scalePassed).toBe(true);
    expect(result.failReason).toContain('transform');
    expect(result.failReason).not.toContain('scale');
  });

  it('scale-only mismatch -> transformPassed:true, scalePassed:false', () => {
    const xform = new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]);
    const liveScale = new Float32Array([1, 1, 1]);
    const expectedScale = new Float32Array([1, 2, 1]); // Y scale differs
    const result = checkWriteGuard(xform, xform.slice(), liveScale, expectedScale);
    expect(result.transformPassed).toBe(true);
    expect(result.scalePassed).toBe(false);
    expect(result.failReason).toContain('scale');
    expect(result.failReason).not.toContain('transform');
  });

  it('both transform and scale mismatch -> both fail, failReason names both channels', () => {
    const live = new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]);
    const expected = new Float32Array([1, 0, 0, 99, 0, 1, 0, 20, 0, 0, 1, 30]);
    const liveScale = new Float32Array([1, 1, 1]);
    const expectedScale = new Float32Array([2, 1, 1]);
    const result = checkWriteGuard(live, expected, liveScale, expectedScale);
    expect(result.transformPassed).toBe(false);
    expect(result.scalePassed).toBe(false);
    expect(result.failReason).toContain('transform');
    expect(result.failReason).toContain('scale');
  });

  it('per-element transform mismatch coverage: every one of the 12 elements is checked', () => {
    const base = [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30];
    for (let i = 0; i < 12; i++) {
      const live = new Float32Array(base);
      const expected = new Float32Array(base);
      expected[i] = expected[i]! + 0.5; // perturb exactly one element
      const scale = new Float32Array([1, 1, 1]);
      const result = checkWriteGuard(live, expected, scale, scale.slice());
      expect(result.transformPassed).toBe(false);
      expect(result.scalePassed).toBe(true);
    }
  });

  it('exactness (not tolerance): a tiny externally-driven delta must still be caught', () => {
    // ANY difference means "not ours" — even a physics-engine-scale nudge.
    const live = new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]);
    const expected = new Float32Array(live);
    expected[3] = expected[3]! + Math.fround(0.0001); // tiny delta, still a float32 difference
    const scale = new Float32Array([1, 1, 1]);
    const result = checkWriteGuard(live, expected, scale, scale.slice());
    expect(result.transformPassed).toBe(false);
  });
});
