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

  it('pins the committed Task 2 candidate as identity, pending D-17 maintainer confirmation', () => {
    // 04.4-04 Task 2: up-axis already matches Three.js (no Y/Z remap needed, unlike
    // the Blender case), and 180deg Y is already falsified — so any remaining SIE
    // discrepancy is a residual azimuth offset, not a missing mesh rotation. This
    // executor pass had no visual-compare capability to iterate Y-only candidates
    // against SIE, so per the plan's explicit allowance the committed value stays
    // identity; the D-17 checkpoint (Task 3) makes the final visual call. If a
    // future pass changes this value, update this assertion deliberately alongside it.
    expect(SWG_ORIENTATION.x).toBe(0);
    expect(SWG_ORIENTATION.y).toBe(0);
    expect(SWG_ORIENTATION.z).toBe(0);
  });
});
