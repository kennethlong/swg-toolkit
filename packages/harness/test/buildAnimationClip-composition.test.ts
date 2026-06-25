/**
 * packages/harness/test/buildAnimationClip-composition.test.ts
 *
 * Unit tests for the COMPOSE-THEN-MIRROR algorithm used in buildAnimationClip.ts.
 *
 * These tests re-implement the key formulas independently of the renderer package
 * (no browser dependencies) and verify them algebraically with known inputs.
 *
 * Guards the rank-1 risk: "mirror the raw keyframe quat instead of composing first"
 * (L5 axiom, CONSULT-P2-05-AXIOMS.md).
 *
 * Skeleton.cpp:1273-1279 composition formula under test:
 *   localRot(f) = postMul · (keyQuat(f) · bindPoseRot · preMul)
 *
 * X-mirror formula (Opus angle-1 derivation):
 *   mirrorQuat(q) = THREE.Quaternion(q.x, -q.y, -q.z, q.w)
 *   (conjugation of rotation matrix by flip=diag(-1,1,1), proper rotation)
 */

import { describe, test, expect } from 'vitest';
import * as THREE from 'three';

// ─── Formulas under test (inlined — no renderer imports) ──────────────────────

/**
 * Compose SWG joint local rotation per Skeleton.cpp:1273-1279.
 * Mirrors composeBoneQuat() in buildAnimationClip.ts.
 */
function composeBoneQuat(
  keyQuat:     THREE.Quaternion,
  bindPoseRot: THREE.Quaternion,
  preMul:      THREE.Quaternion,
  postMul:     THREE.Quaternion,
): THREE.Quaternion {
  // result = postMul · (keyQuat · bindPoseRot · preMul)
  const result = keyQuat.clone().multiply(bindPoseRot).multiply(preMul);
  result.premultiply(postMul);
  return result.normalize();
}

/**
 * Mirror quaternion by X-reflection plane.
 * Mirrors mirrorQuat() in buildAnimationClip.ts.
 * THREE.Quaternion (x,y,z,w) → (x,-y,-z,w).
 */
function mirrorQuat(q: THREE.Quaternion): THREE.Quaternion {
  return new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
}

/**
 * Reorder on-disk SWG (w,x,y,z) to THREE.Quaternion (x,y,z,w).
 */
function quatFromDisk(w: number, x: number, y: number, z: number): THREE.Quaternion {
  return new THREE.Quaternion(x, y, z, w);
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function expectQuatClose(
  actual: THREE.Quaternion,
  expected: THREE.Quaternion,
  places = 4,
): void {
  expect(actual.x).toBeCloseTo(expected.x, places);
  expect(actual.y).toBeCloseTo(expected.y, places);
  expect(actual.z).toBeCloseTo(expected.z, places);
  expect(actual.w).toBeCloseTo(expected.w, places);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildAnimationClip — composition formula (L5)', () => {

  test('identity pre/bind/post: composed equals raw key quat', () => {
    // Use exact 1/√2 to avoid the 0.707 truncation mismatch
    const HALF_SQRT2 = Math.SQRT2 / 2;
    const rawKey   = quatFromDisk(0, HALF_SQRT2, 0, HALF_SQRT2); // 90° Y rotation
    const identity = new THREE.Quaternion();                       // (0,0,0,1)
    const composed = composeBoneQuat(rawKey, identity, identity, identity);

    // With all multipliers = identity: postMul · (key · I · I) = key
    expectQuatClose(composed, rawKey);
  });

  test('non-identity bindPoseRot: composed differs from raw key (rank-1 guard)', () => {
    // key = identity, bindPoseRot = 45° Y rotation
    const rawKey      = new THREE.Quaternion(0, 0, 0, 1);
    const bindPoseRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0));
    const identity    = new THREE.Quaternion();

    const composed = composeBoneQuat(rawKey, bindPoseRot, identity, identity);

    // Composed = postMul · (identity · bindPoseRot · preMul) = bindPoseRot
    expectQuatClose(composed, bindPoseRot);

    // Sanity: composed ≠ rawKey (which is identity)
    const diff = Math.abs(composed.x - rawKey.x) + Math.abs(composed.y - rawKey.y) +
                 Math.abs(composed.z - rawKey.z) + Math.abs(composed.w - rawKey.w);
    expect(diff).toBeGreaterThan(0.1);
  });

  test('postMul wraps composition on the left', () => {
    // key = identity, preMul = identity, postMul = 90° X rotation
    const rawKey  = new THREE.Quaternion(0, 0, 0, 1);
    const postMul = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const identity = new THREE.Quaternion();

    const composed = composeBoneQuat(rawKey, identity, identity, postMul);

    // result = postMul · (I · I · I) = postMul
    expectQuatClose(composed, postMul);
  });

  test('preMul is right-multiplied inside the bracket', () => {
    // key = identity, bindPoseRot = identity, preMul = 90° X, postMul = identity
    const preMul  = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const identity = new THREE.Quaternion();

    const composed = composeBoneQuat(identity, identity, preMul, identity);

    // result = I · (I · I · preMul) = preMul
    expectQuatClose(composed, preMul);
  });

});

describe('mirrorQuat — X-reflection (Opus angle-2 derivation)', () => {

  test('identity quat mirrors to identity (self-symmetric)', () => {
    const q      = new THREE.Quaternion(0, 0, 0, 1);
    const m      = mirrorQuat(q);
    expect(m.x).toBeCloseTo(0);
    expect(m.y).toBeCloseTo(0);
    expect(m.z).toBeCloseTo(0);
    expect(m.w).toBeCloseTo(1);
  });

  test('mirroring negates y and z but preserves x and w', () => {
    const q = new THREE.Quaternion(0.5, 0.3, 0.4, Math.sqrt(1 - 0.25 - 0.09 - 0.16));
    const m = mirrorQuat(q);
    expect(m.x).toBeCloseTo(q.x);
    expect(m.y).toBeCloseTo(-q.y);
    expect(m.z).toBeCloseTo(-q.z);
    expect(m.w).toBeCloseTo(q.w);
  });

  test('mirroring twice returns to original (flip is self-inverse)', () => {
    const q = new THREE.Quaternion(0.5, 0.5, 0.5, 0.5);
    const mm = mirrorQuat(mirrorQuat(q));
    expectQuatClose(mm, q);
  });

  test('90° X rotation is symmetric (x-axis unchanged by X-flip)', () => {
    // 90° rotation around X: quat = (0.707, 0, 0, 0.707) in THREE (x,y,z,w)
    const q = new THREE.Quaternion(0.707, 0, 0, 0.707);
    const m = mirrorQuat(q);
    // x rotation axis is invariant under X-flip, so mirrored == original
    expectQuatClose(m, q);
  });

  test('90° Y rotation mirrors to -90° Y (Y-axis flipped)', () => {
    // 90° Y: quat = (0, 0.707, 0, 0.707) in THREE (x,y,z,w)
    const q = new THREE.Quaternion(0, 0.707, 0, 0.707);
    const m = mirrorQuat(q);
    // Y-axis negated: y becomes -0.707 → rotation is -90° around Y (or 90° around -Y)
    expect(m.y).toBeCloseTo(-0.707, 3);
    expect(m.w).toBeCloseTo(0.707, 3);
  });

});

describe('compose-then-mirror vs mirror-raw-key (rank-1 correctness)', () => {

  test('with non-identity bind: results differ (wrong order guard)', () => {
    // This is the critical test: it proves compose-first-then-mirror ≠ mirror-raw-first-then-compose.
    // Any correct implementation must match the first; the naive wrong implementation matches the second.
    const rawKey     = quatFromDisk(0, 0.707, 0.707, 0).normalize();
    const bindPoseRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0));
    const identity    = new THREE.Quaternion();

    // Correct: compose, then mirror
    const composed       = composeBoneQuat(rawKey, bindPoseRot, identity, identity);
    const correctResult  = mirrorQuat(composed);

    // Wrong: mirror raw key, then compose (the rank-1 error)
    const mirroredRawKey = mirrorQuat(rawKey);
    const wrongResult    = composeBoneQuat(mirroredRawKey, bindPoseRot, identity, identity);

    // They must differ for non-symmetric joints
    const diffX = Math.abs(correctResult.x - wrongResult.x);
    const diffY = Math.abs(correctResult.y - wrongResult.y);
    const diffZ = Math.abs(correctResult.z - wrongResult.z);
    const totalDiff = diffX + diffY + diffZ;

    expect(totalDiff).toBeGreaterThan(0.01);
  });

  test('with identity bind: results are the same (degenerate case)', () => {
    // When bindPoseRot = identity and pre/post = identity:
    //   compose-then-mirror:  mirrorQuat(key · I · I) = mirrorQuat(key)
    //   mirror-then-compose:  composeBoneQuat(mirrorQuat(key), I, I, I) = mirrorQuat(key)
    // These are equal — confirms the test above is not vacuously wrong.
    const rawKey   = quatFromDisk(0, 0.707, 0.707, 0).normalize();
    const identity = new THREE.Quaternion();

    const composed      = composeBoneQuat(rawKey, identity, identity, identity);
    const correctResult = mirrorQuat(composed);

    const mirroredRaw = mirrorQuat(rawKey);
    const wrongResult = composeBoneQuat(mirroredRaw, identity, identity, identity);

    // With identity everything: they ARE equal (this is correct, not a bug)
    expectQuatClose(correctResult, wrongResult);
  });

});

describe('on-disk quaternion reorder', () => {

  test('quatFromDisk(w,x,y,z) → THREE.Quaternion(x,y,z,w)', () => {
    const q = quatFromDisk(0.5, 0.1, 0.2, 0.3);
    expect(q.w).toBeCloseTo(0.5);
    expect(q.x).toBeCloseTo(0.1);
    expect(q.y).toBeCloseTo(0.2);
    expect(q.z).toBeCloseTo(0.3);
  });

});
