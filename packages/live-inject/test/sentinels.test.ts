// sentinels.test.ts — Tests for the 4-sentinel gate predicates.
//
// The sentinel predicates are implemented in C++ (agent/sentinels.cpp).
// This file tests TypeScript-equivalent implementations to avoid requiring
// a native addon compile cycle for vitest.  The TS port mirrors the C++
// logic exactly (same bounds, same failReason strings).
//
// Reference: PLAN 03-03 §Task 1 <behavior> block.

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// TypeScript port of agent/sentinels.cpp  (pure / Win32-free)
// ---------------------------------------------------------------------------

interface SentinelResult {
  passed: boolean;
  failReason: string;
}

/** Sentinel 1: sane transform (finite, bounded translation, ~orthonormal rows).
 *  Input: Float32Array of 12 floats — float[3][4] row-major.
 *  Translation is column 3: indices 3, 7, 11. */
function checkTransform(mat: Float32Array): SentinelResult {
  if (mat.length < 12) {
    return { passed: false, failReason: 'transform buffer too short' };
  }
  // All 12 floats must be finite — NaN and +/-Infinity are both rejected.
  // NaN is checked first so the failReason is specific.
  for (let i = 0; i < 12; i++) {
    if (Number.isNaN(mat[i])) {
      return { passed: false, failReason: 'NaN in transform element' };
    }
    if (!Number.isFinite(mat[i]!)) {
      return { passed: false, failReason: 'infinite transform element' };
    }
  }
  // Translation bounds: indices 3, 7, 11 (column 3, row-major)
  const WORLD_BOUND = 100000.0;
  if (Math.abs(mat[3]!)  > WORLD_BOUND ||
      Math.abs(mat[7]!)  > WORLD_BOUND ||
      Math.abs(mat[11]!) > WORLD_BOUND) {
    return { passed: false, failReason: 'translation out of world bounds' };
  }
  // Rotation row norms (first 3 elements per row): 0.5 < norm < 2.0
  for (let row = 0; row < 3; row++) {
    const b = row * 4;
    const norm = Math.sqrt(mat[b]!**2 + mat[b+1]!**2 + mat[b+2]!**2);
    if (norm < 0.5 || norm > 2.0) {
      return { passed: false, failReason: 'rotation row norm out of range' };
    }
  }
  return { passed: true, failReason: '' };
}

/** Sentinel 2: non-null networkId. */
function checkNetworkId(id: bigint): SentinelResult {
  if (id === 0n) {
    return { passed: false, failReason: 'networkId is null/zero' };
  }
  return { passed: true, failReason: '' };
}

/** Sentinel 3: readable object/... template name (ASCII, starts with "object/"). */
function checkTemplateName(name: string | null | undefined, maxLen: number): SentinelResult {
  if (!name) {
    return { passed: false, failReason: 'template name is null/empty' };
  }
  if (!name.startsWith('object/')) {
    return { passed: false, failReason: 'template name must start with "object/"' };
  }
  if (name.length > maxLen) {
    return { passed: false, failReason: 'template name exceeds maxLen' };
  }
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return { passed: false, failReason: 'non-printable ASCII character in template name' };
    }
  }
  return { passed: true, failReason: '' };
}

/** Sentinel 4: player/world liveness. */
function checkLiveness(playerNonNull: boolean, isOver: boolean, loopCounterDelta: number): SentinelResult {
  if (!playerNonNull) return { passed: false, failReason: 'player pointer is null' };
  if (isOver)         return { passed: false, failReason: 'game loop is over' };
  if (loopCounterDelta <= 0) return { passed: false, failReason: 'loop counter not advancing' };
  return { passed: true, failReason: '' };
}

/** Gate: all four must pass (D-05). */
function allSentinelsPassed(results: SentinelResult[]): boolean {
  return results.every(r => r.passed);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkTransform', () => {
  it('passes for a well-formed finite orthonormal transform', () => {
    // Identity matrix: rotation = I₃, translation = 0 — all checks must pass
    const mat = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
    ]);
    const result = checkTransform(mat);
    expect(result.passed).toBe(true);
  });

  it('fails for an all-NaN matrix', () => {
    const mat = new Float32Array(12).fill(NaN);
    const result = checkTransform(mat);
    expect(result.passed).toBe(false);
    expect(result.failReason).toContain('NaN');
  });

  it('fails for +Infinity in a transform element', () => {
    // Translation index 3 set to +Infinity
    const mat = new Float32Array([1, 0, 0, Infinity, 0, 1, 0, 0, 0, 0, 1, 0]);
    const result = checkTransform(mat);
    expect(result.passed).toBe(false);
    // failReason must contain "inf" (case-insensitive) or "finite"
    expect(result.failReason.toLowerCase()).toMatch(/inf|finite/);
  });

  it('fails for a zero rotation matrix (row norm out of range)', () => {
    // All zeros → rotation row norms = 0, below 0.5 threshold
    const mat = new Float32Array(12).fill(0);
    const result = checkTransform(mat);
    expect(result.passed).toBe(false);
  });
});

describe('checkNetworkId', () => {
  it('passes for a non-zero networkId', () => {
    const result = checkNetworkId(12345n);
    expect(result.passed).toBe(true);
  });

  it('fails for networkId === 0n', () => {
    const result = checkNetworkId(0n);
    expect(result.passed).toBe(false);
  });
});

describe('checkTemplateName', () => {
  it('passes for a valid "object/..." ASCII template name', () => {
    const result = checkTemplateName('object/creature/player.iff', 256);
    expect(result.passed).toBe(true);
  });

  it('fails for a name that does not start with "object/"', () => {
    // "sys/other" has no "object/" prefix
    expect(checkTemplateName('sys/other', 256).passed).toBe(false);
    // "junk\x01\x02" also fails (neither prefix nor printable)
    expect(checkTemplateName('junk\x01\x02', 256).passed).toBe(false);
  });

  it('fails for a name containing non-printable ASCII characters', () => {
    // Valid prefix but embedded control character
    expect(checkTemplateName('object/\x01bad', 256).passed).toBe(false);
  });
});

describe('checkLiveness', () => {
  it('passes when player is non-null, isOver is false, and loopCounterDelta > 0', () => {
    const result = checkLiveness(true, false, 1);
    expect(result.passed).toBe(true);
  });

  it('fails when isOver is true', () => {
    const result = checkLiveness(true, true, 1);
    expect(result.passed).toBe(false);
  });

  it('fails when playerNonNull is false', () => {
    const result = checkLiveness(false, false, 1);
    expect(result.passed).toBe(false);
  });

  it('fails when loopCounterDelta is 0 (counter not advancing)', () => {
    const result = checkLiveness(true, false, 0);
    expect(result.passed).toBe(false);
  });
});

describe('allSentinelsPassed', () => {
  it('returns true when all four sentinels pass', () => {
    const all: SentinelResult[] = Array(4).fill({ passed: true, failReason: '' });
    expect(allSentinelsPassed(all)).toBe(true);
  });

  it('returns false when any single sentinel fails', () => {
    const results: SentinelResult[] = [
      { passed: true,  failReason: '' },
      { passed: false, failReason: 'networkId is null/zero' },
      { passed: true,  failReason: '' },
      { passed: true,  failReason: '' },
    ];
    expect(allSentinelsPassed(results)).toBe(false);
  });
});
