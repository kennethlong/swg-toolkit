/**
 * packages/renderer/src/panels/viewport/export/buildExportScene.ts
 *
 * buildExportScene — assemble a clean, mirrored THREE.Object3D tree ready for GLTFExporter.
 *
 * STRATEGY
 * ─────────
 * The live R3F scene (the THREE.Scene returned by useThree().scene) holds SWG-disk geometry
 * verbatim (LIVE_SCENE_IS_SWG_NATIVE = true, L3 axiom). We must NOT mutate it.
 *
 * Instead:
 *   1. Collect live THREE.SkinnedMesh instances from the scene (geometry reference only).
 *   2. Reconstruct the skeleton from parsedSkeleton in REST/BIND POSE (same as buildSkeleton
 *      in SkinnedMeshView.tsx). This guarantees the export is always in bind pose regardless
 *      of what animation frame the live viewport is currently on.
 *   3. Clone each live mesh's geometry (geometry.clone() — deep copy of all BufferAttributes).
 *   4. Convert each material (ShaderMaterial → MeshStandardMaterial, DXT → RGBA DataTexture).
 *   5. Bind the cloned meshes to the reconstructed skeleton.
 *   6. Apply applyXMirror() to the export clone (NEVER to the live scene).
 *
 * The export root is a plain THREE.Object3D containing:
 *   - rootBone (and its entire hierarchy) when includeSkeleton = true
 *   - Cloned THREE.SkinnedMesh or THREE.Mesh instances (SkinnedMesh when includeSkeleton = true,
 *     plain Mesh with identity skinIndex/Weight stripped when includeSkeleton = false)
 *
 * GLTFExporter requirements met:
 *   - All skeleton bones are Object3D nodes in the export scene graph (required by exporter).
 *   - boneInverses are calculated from the reconstructed bind-pose skeleton.
 *   - Standard MeshStandardMaterial (no ShaderMaterial).
 *   - No root scale(-1,1,1) node.
 *
 * Source: swg-client-v2 Skeleton.cpp (rest pose = postMul·bindPoseRot·preMul).
 *         SkinnedMeshView.tsx buildSkeleton() — exact same bone-pose formula, reused here.
 *         applyXMirror (mirrorScene.ts); toStandardMaterial (exportMaterial.ts).
 *         CONSULT-P2-05-AXIOMS.md L2–L4, L6.
 */

import * as THREE from 'three';
import type { SkeletonParseResult } from '@swg/contracts';
import { applyXMirror } from './mirrorScene.js';
import { toStandardMaterial } from './exportMaterial.js';

// Sentinel constant documenting the live-scene invariant.
// If this is true, mutating the live scene for export would corrupt the viewport.
const LIVE_SCENE_IS_SWG_NATIVE = true;
void LIVE_SCENE_IS_SWG_NATIVE; // prevent unused-const lint

// ─── Bind-pose skeleton builder ───────────────────────────────────────────────

/**
 * Reorder on-disk (w,x,y,z) quaternion to THREE.Quaternion (x,y,z,w).
 * Same helper as SkinnedMeshView.tsx quatFromDisk.
 */
function quatFromDisk(arr: readonly number[]): THREE.Quaternion {
  return new THREE.Quaternion(arr[1] ?? 0, arr[2] ?? 0, arr[3] ?? 0, arr[0] ?? 1);
}

const _bsQ = new THREE.Quaternion(); // scratch (buildBindPoseSkeleton local)

/**
 * Reconstruct a THREE.Skeleton in REST/BIND POSE from a SkeletonParseResult.
 *
 * Mirrors the logic in SkinnedMeshView.tsx buildSkeleton():
 *   restRotation    = postMul · bindPoseRot · preMul
 *   restTranslation = bindTranslation
 *
 * The returned skeleton has NOT had calculateInverses() called yet — the caller
 * must update bone world matrices and call skeleton.calculateInverses() before binding.
 */
function buildBindPoseSkeleton(
  parsed: SkeletonParseResult,
): { skeleton: THREE.Skeleton; rootBone: THREE.Bone } {
  const bones: THREE.Bone[] = parsed.bones.map(b => {
    const bone = new THREE.Bone();
    bone.name = b.name;

    const preMul      = quatFromDisk(b.preMultiplyRotation);
    const postMul     = quatFromDisk(b.postMultiplyRotation);
    const bindPoseRot = quatFromDisk(b.bindPoseRotation);

    // rest = postMul · bindPoseRot · preMul  (Skeleton.cpp:1273-1285)
    _bsQ.copy(postMul).multiply(bindPoseRot).multiply(preMul).normalize();
    bone.quaternion.copy(_bsQ);
    bone.position.set(b.bindTranslation[0]!, b.bindTranslation[1]!, b.bindTranslation[2]!);

    return bone;
  });

  // Build parent-child hierarchy from parentIndex
  let rootBone: THREE.Bone | undefined;
  for (let i = 0; i < parsed.bones.length; i++) {
    const parentIdx = parsed.bones[i]?.parentIndex ?? -1;
    if (parentIdx >= 0 && parentIdx < bones.length) {
      bones[parentIdx]!.add(bones[i]!);
    } else {
      rootBone ??= bones[i]; // first bone with parentIndex = -1 is root
    }
  }

  const skeleton = new THREE.Skeleton(bones);
  return { skeleton, rootBone: rootBone ?? bones[0]! };
}

// ─── Export options ───────────────────────────────────────────────────────────

export interface ExportSceneOptions {
  /** Include skeleton bones in the export scene (required for skinned mesh). */
  includeSkeleton: boolean;
  /** Reserved — animation clip is passed separately to GLTFExporter via parseAsync options. */
  includeAnimation: boolean;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a clean, mirrored export scene from the live R3F scene.
 *
 * @param liveScene       The THREE.Scene (or any Object3D root) from useThree().scene.
 *                        Used READ-ONLY to find SkinnedMesh geometry. Never mutated.
 * @param parsedSkeleton  Parsed skeleton data (SKTM). Used to reconstruct bind-pose bones.
 * @param opts            includeSkeleton / includeAnimation flags.
 * @returns               THREE.Object3D ready for GLTFExporter.parseAsync().
 *                        Returns an empty Object3D if no SkinnedMesh is found.
 */
export function buildExportScene(
  liveScene:       THREE.Object3D,
  parsedSkeleton:  SkeletonParseResult | null,
  opts:            ExportSceneOptions,
): THREE.Object3D {
  const exportRoot = new THREE.Object3D();
  exportRoot.name = 'SWGExport';

  // ── Collect live SkinnedMesh instances ─────────────────────────────────────
  const liveMeshes: THREE.SkinnedMesh[] = [];
  liveScene.traverse(obj => {
    if (obj instanceof THREE.SkinnedMesh) liveMeshes.push(obj);
  });

  if (liveMeshes.length === 0) {
    console.warn('[buildExportScene] No SkinnedMesh found in live scene — exporting empty scene.');
    return exportRoot;
  }

  // ── Build bind-pose skeleton ────────────────────────────────────────────────
  let skeleton: THREE.Skeleton | null = null;
  let identityBindMat: THREE.Matrix4 | null = null;

  if (opts.includeSkeleton && parsedSkeleton && parsedSkeleton.bones.length > 0) {
    const { skeleton: skel, rootBone } = buildBindPoseSkeleton(parsedSkeleton);

    // Update world matrices so calculateInverses() gets correct bone worldMatrices.
    rootBone.updateMatrixWorld(true);
    skel.calculateInverses(); // boneInverses[i] = inverse of bone[i].matrixWorld at bind pose

    skeleton = skel;
    identityBindMat = new THREE.Matrix4(); // identity: mesh at origin

    // Add bone hierarchy to export scene (required by GLTFExporter for joint nodes)
    exportRoot.add(rootBone);
  }

  // ── Clone meshes and bind to skeleton ──────────────────────────────────────
  for (const liveMesh of liveMeshes) {
    // Deep-clone the geometry (positions, normals, skinIndex, skinWeight, indices, …)
    const clonedGeo = liveMesh.geometry.clone();

    // Convert ShaderMaterial → MeshStandardMaterial + decompress DXT textures
    const srcMat = Array.isArray(liveMesh.material) ? liveMesh.material[0] : liveMesh.material;
    const clonedMat = toStandardMaterial(srcMat ?? new THREE.MeshStandardMaterial());

    if (skeleton && identityBindMat) {
      // Skinned export: SkinnedMesh bound to the reconstructed skeleton
      const clonedMesh = new THREE.SkinnedMesh(clonedGeo, clonedMat);
      clonedMesh.name = liveMesh.name || 'SWGMesh';
      // bind() with explicit matrix: uses pre-calculated boneInverses, no recalculation
      clonedMesh.bind(skeleton, identityBindMat);
      exportRoot.add(clonedMesh);
    } else {
      // Static export (no skeleton): plain Mesh
      const clonedMesh = new THREE.Mesh(clonedGeo, clonedMat);
      clonedMesh.name = liveMesh.name || 'SWGMesh';
      // Remove skinning attributes that reference a nonexistent skeleton
      clonedGeo.deleteAttribute('skinIndex');
      clonedGeo.deleteAttribute('skinWeight');
      exportRoot.add(clonedMesh);
    }
  }

  // ── Apply X-mirror to the CLONE (never to the live scene) ──────────────────
  // LIVE_SCENE_IS_SWG_NATIVE: the live scene is left untouched.
  // applyXMirror modifies geometry attributes + bone transforms IN-PLACE on the clone.
  applyXMirror(exportRoot);

  return exportRoot;
}
