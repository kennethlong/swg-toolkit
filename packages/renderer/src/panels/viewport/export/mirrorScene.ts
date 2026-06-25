/**
 * packages/renderer/src/panels/viewport/export/mirrorScene.ts
 *
 * applyXMirror — bake the SWG→DCC X-reflection into a deep-cloned export scene.
 *
 * SWG geometry is left-handed Y-up (X-negated vs DCC/glTF right-handed Y-up).
 * The live viewport stores SWG-disk coords verbatim (identity orientation, L3 axiom).
 * We apply a SINGLE X-reflection (flip = diag(-1,1,1)) to the CLONE only — never to the
 * live scene. The transform is baked per-vertex and per-matrix, not as a root scale(-1,1,1)
 * node (which GLTFExporter ignores and which leaves normals/tangents un-mirrored).
 *
 * WHAT IS MIRRORED
 * ─────────────────
 * Geometry (per-vertex):
 *   positions:  x → -x
 *   normals:    nx → -nx
 *   tangents:   (-tx, ty, tz, -w)  — BOTH tx AND handedness w flip (det = -1)
 *   winding:    swap 2nd/3rd index per triangle (preserves CCW front-face after reflection)
 *
 * Skeleton:
 *   Bone local TRS: M' = flip · M · flip  (conjugation by the reflection plane)
 *     Decompose M' → new position/quaternion/scale.
 *     This is equivalent to: position.x → -position.x;
 *       quat (w,x,y,z)_SWG → (w,x,-y,-z)_SWG → THREE.Quaternion (x,-y,-z,w).
 *
 *   Inverse bind matrices (per SkinnedMesh.skeleton.boneInverses):
 *     (M')^{-1} = flip · M^{-1} · flip  (flip is self-inverse: flip^2 = I)
 *
 * WHAT IS NOT TOUCHED
 * ────────────────────
 *   - Root scale(-1,1,1) node:  never added (GLTFExporter silently drops it)
 *   - +90° facing rotation:     not applied (that is a Blender Z-up artifact, irrelevant for
 *                                glTF Y-up — confirmed L3 axiom + Opus angle-1 derivation)
 *   - Normal-map green channel: NOT inverted (handedness is already handled by tangent.w flip)
 *
 * Source: swg-client-v2 MayaUtility.cpp (engine_x = -maya_x); swg-blender-plugin coords.py;
 *         Opus math derivation (CONSULT-P2-05-01-opus-mirror-math.md §1–4).
 *         CONSULT-P2-05-AXIOMS.md L1–L4.
 */

import * as THREE from 'three';

// Reusable scratch objects (never re-allocated inside applyXMirror itself)
const _flipMat   = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
const _scratch   = new THREE.Matrix4();
const _pos       = new THREE.Vector3();
const _quat      = new THREE.Quaternion();
const _scale     = new THREE.Vector3();

/**
 * Apply the SWG→glTF X-mirror transform to `root` IN PLACE.
 *
 * MUST be called on a DEEP CLONE of the live scene, never on the live scene itself.
 * (The live scene holds SWG-disk coordinates verbatim — mutation would corrupt the viewport.)
 *
 * @param root  Root of the export clone (returned by buildExportScene before mirroring).
 */
export function applyXMirror(root: THREE.Object3D): void {
  root.traverse((obj) => {
    // ── Geometry attributes (SkinnedMesh and plain Mesh) ──────────────────────
    if ((obj instanceof THREE.SkinnedMesh || obj instanceof THREE.Mesh) && obj.geometry) {
      const geo = obj.geometry;

      // Positions: x → -x
      const pos = geo.getAttribute('position');
      if (pos) {
        for (let i = 0; i < pos.count; i++) {
          pos.setX(i, -pos.getX(i));
        }
        (pos as THREE.BufferAttribute).needsUpdate = true;
      }

      // Normals: nx → -nx
      const norm = geo.getAttribute('normal');
      if (norm) {
        for (let i = 0; i < norm.count; i++) {
          norm.setX(i, -norm.getX(i));
        }
        (norm as THREE.BufferAttribute).needsUpdate = true;
      }

      // Tangents: (-tx, ty, tz, -w)
      // The w component is the handedness sign; it also flips under a reflection (det = -1).
      // NOT inverting the green channel of the normal map — tangent.w already encodes that.
      const tan = geo.getAttribute('tangent');
      if (tan) {
        for (let i = 0; i < tan.count; i++) {
          tan.setX(i, -tan.getX(i));
          (tan as THREE.BufferAttribute).setW(i, -(tan as THREE.BufferAttribute).getW(i));
        }
        (tan as THREE.BufferAttribute).needsUpdate = true;
      }

      // Triangle winding: swap 2nd and 3rd index of every triangle.
      // Under a det=-1 transform, CCW front-face becomes CW → swap to restore CCW.
      const index = geo.index;
      if (index) {
        const arr = index.array as Uint32Array | Uint16Array | Int32Array;
        for (let i = 0; i < arr.length; i += 3) {
          const tmp = arr[i + 1]!;
          arr[i + 1] = arr[i + 2]!;
          arr[i + 2] = tmp;
        }
        index.needsUpdate = true;
      }
    }

    // ── Inverse bind matrices (per-SkinnedMesh.skeleton) ─────────────────────
    // Each boneInverse[i] = inverse world matrix of bone[i] at bind time.
    // Under the reflection: (M')^{-1} = flip · M^{-1} · flip.
    if (obj instanceof THREE.SkinnedMesh && obj.skeleton) {
      const invs = obj.skeleton.boneInverses;
      for (let i = 0; i < invs.length; i++) {
        const inv = invs[i];
        if (inv) {
          _scratch.copy(_flipMat).multiply(inv).multiply(_flipMat);
          inv.copy(_scratch);
        }
      }
    }

    // ── Bone local transform: M' = flip · M · flip ───────────────────────────
    // Only applies to THREE.Bone objects (not general Object3D, not SkinnedMesh).
    if (obj instanceof THREE.Bone) {
      obj.updateMatrix();
      _scratch.copy(_flipMat).multiply(obj.matrix).multiply(_flipMat);
      _scratch.decompose(_pos, _quat, _scale);
      obj.position.copy(_pos);
      obj.quaternion.copy(_quat);
      obj.scale.copy(_scale);
      obj.updateMatrix();
    }
  });
}
