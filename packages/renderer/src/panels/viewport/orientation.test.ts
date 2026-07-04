/**
 * packages/renderer/src/panels/viewport/orientation.test.ts
 *
 * Determinant gate for the shared SWG_ORIENTATION constant (04.4-04, D-16/T-04.4-08).
 * Proves the SWG→viewer facing rotation is ALWAYS a pure rotation (determinant +1),
 * never a mirror/scale — this must stay green across identity (pre-fix) AND whatever
 * candidate Task 2 commits, so an accidental reflection can never silently flip
 * winding/normals.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SWG_ORIENTATION } from './orientation';

describe('SWG_ORIENTATION', () => {
  it('is a pure rotation (determinant +1) — never a mirror/scale', () => {
    const m = new THREE.Matrix4().makeRotationFromEuler(SWG_ORIENTATION);
    expect(m.determinant()).toBeCloseTo(1, 10);
  });

  it('is not the already-falsified 180 degree Y rotation', () => {
    // rotateY(Math.PI) was tried in Phase 02-03, showed the mesh's BACK, and was
    // reverted to identity. That hypothesis is closed — do not repeat it.
    const isFalsified180Y =
      Math.abs(SWG_ORIENTATION.x) < 1e-9 &&
      Math.abs(Math.abs(SWG_ORIENTATION.y) - Math.PI) < 1e-9 &&
      Math.abs(SWG_ORIENTATION.z) < 1e-9;
    expect(isFalsified180Y).toBe(false);
  });
});
