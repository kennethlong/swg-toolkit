/**
 * packages/renderer/src/panels/viewport/SkinnedMeshView.tsx
 *
 * Skinned render path (VIEW-01 skinned).
 * Builds THREE.SkinnedMesh + THREE.Skeleton from parsed SKMG + SKTM data.
 *
 * Three.js r0.184.0 skinning rules (LOCKED):
 *   - Skinning auto-enables from skinIndex + skinWeight BufferAttributes + a bound Skeleton.
 *   - DO NOT set material.skinning — it was REMOVED in r140. Setting it is a no-op/throw.
 *   - Bone quaternion IR is (w,x,y,z) on disk; THREE.Quaternion.set(x,y,z,w) reorders.
 *
 * Material: buildSwgMaterial (skinned:true) replaces the 02-02 placeholder.
 * Textures: buildDdsTexture from resolution.materials[i].slotBytes (already plumbed by 02-02).
 *
 * Orientation: same SWG→viewer 180° Y rotation as StaticMeshView (pure rotation, det=+1).
 *   HUMAN-VERIFY at checkpoint vs SIE.
 *
 * Multi-PSDT: renders ALL shader groups as SkinnedMesh instances sharing one Skeleton.
 *
 * DOT3 tangents: when group.hasDot3=true, reads the tangent attribute pool from the
 * SKMG v0004 data and passes it as 'tangent' BufferAttribute.
 *
 * Module-scope scratch objects declared at module level — NEVER re-created in useFrame.
 * (GC contract D-09: zero allocation in hot render path.)
 *
 * Source: 02-PATTERNS.md § SkinnedMeshView.tsx (module-scope scratch, GC-safe)
 *         + synthesis §2 (GPU skinning, name-keyed bone bind, Pitfall 5/6)
 *         + swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (XFNM→bone remap)
 *         + 02-03-PLAN.md Task 1 (material swap, DDS textures, DOT3, orientation)
 */

import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useViewportStore } from '../../state/viewportStore.js';
import type { MeshParseResult, SkeletonParseResult } from '@swg/contracts';
import type { ResolvedMaterial } from './resolver/appearanceResolver.js';
import { buildSwgMaterial } from './material/swgMaterial.js';
import { buildDdsTexture } from './material/ddsTexture.js';

// ─── Animation sampler constants ──────────────────────────────────────────────
// Throttle the store flush to avoid per-frame Zustand churn (D-09 / RESEARCH anti-pattern).
const FLUSH_INTERVAL_MS = 100; // flush at most ~10×/s

// ─── nativeCore for parseDds ─────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-require-imports */
const nativeCore = require('@swg/native-core') as {
  parseDds: (bytes: ArrayBuffer | Uint8Array) => import('@swg/contracts').DdsParseResult;
  parsePalette: (bytes: ArrayBuffer | Uint8Array) => import('@swg/contracts').PaletteParseResult;
};
/* eslint-enable @typescript-eslint/no-require-imports */

// ─── Module-scope scratch (NEVER re-allocated in useFrame or render) ──────────
const _scratchQuat  = new THREE.Quaternion();
const _scratchVec3  = new THREE.Vector3();
const _scratchMat4  = new THREE.Matrix4();
// Slerp bracket endpoints — two additional scratch quats for the animation sampler.
// Declared here to avoid any allocation in useFrame (D-09 GC-safe contract).
const _scratchQuatA = new THREE.Quaternion();
const _scratchQuatB = new THREE.Quaternion();
// Lerp bracket endpoints for translation.
const _scratchVecA  = new THREE.Vector3();
const _scratchVecB  = new THREE.Vector3();

// ─── SWG animation channel-flag bits (SATCCF) ────────────────────────────────
// Source: swg-client-v2 KeyframeSkeletalAnimationTemplateDef.h
//   SATCCF_xTranslation = 0b0000_1000 (bit 3), y = bit 4, z = bit 5.
// Translation animate-flags live at bits 3/4/5 — NOT 0/1/2 (those are Euler-rotation
// flags, unused by the quaternion CKAT/KFAT-0003 path). `SATCCF_X_TRANS << ax` selects
// the x/y/z translation bit. Both CKAT and KFAT use these same flag values.
const SATCCF_X_TRANS = 0x08;

// ─── SWG→Viewer orientation ───────────────────────────────────────────────────
// See StaticMeshView.tsx: identity. 180° Y showed the model's back; residual facing vs SIE
// is a default camera-azimuth preference (viewport-default-facing-axis.md), not a mesh rotation.
const SWG_ORIENTATION = new THREE.Euler(0, 0, 0);

// ─── Props ────────────────────────────────────────────────────────────────────

/** One renderable part at the selected LOD (multi-part skinned .sat). */
export interface SkinnedPart {
  parsedMesh: MeshParseResult;
  geometry: ArrayBuffer;
  /** Resolved materials indexed by THIS part's shader group. */
  materials?: ResolvedMaterial[];
}

export interface SkinnedMeshViewProps {
  /**
   * Multi-part path. When present, all parts render at the selected LOD sharing ONE
   * merged skeleton. When absent, the legacy single-mesh props below are used.
   */
  parts?: SkinnedPart[];
  /** Legacy single-part props (used when `parts` is absent). */
  parsedMesh?: MeshParseResult;
  geometry?: ArrayBuffer;
  /** Resolved materials indexed by shader group (legacy single-part path). */
  materials?: ResolvedMaterial[];

  /** The (possibly merged) skeleton shared by all parts. */
  parsedSkeleton: SkeletonParseResult | null;
  renderMode: 'solid' | 'wire' | 'textured';
}

// ─── Per-joint transform data (parallel to skeleton.bones) ────────────────────
// Persistent THREE objects (built once per skeleton, NOT per frame). The sampler
// reuses these to compose the SWG joint transform each frame.
interface JointTransform {
  preMul: THREE.Quaternion;       // RPRE  (already reordered to x,y,z,w)
  postMul: THREE.Quaternion;      // RPST
  bindPoseRot: THREE.Quaternion;  // BPRO
  bindTranslation: THREE.Vector3; // BPTR
}

/** Reorder an on-disk (w,x,y,z) quaternion array into a THREE.Quaternion (x,y,z,w). */
function quatFromDisk(q: readonly number[]): THREE.Quaternion {
  return new THREE.Quaternion(q[1] ?? 0, q[2] ?? 0, q[3] ?? 0, q[0] ?? 1);
}

// ─── Build skeleton ───────────────────────────────────────────────────────────
//
// SWG joint local (jointToParent) transform — Skeleton.cpp:1273-1285:
//   animatedRotation = animResolverRot · bindPoseRot
//   localRotation    = postMul · (animatedRotation · preMul)
//   localTranslation = bindTranslation + animResolverTranslation
// The REST pose (what buildSkeleton sets, and what bind() snapshots for inverse-bind)
// is that with animResolverRot = identity / animResolverTranslation = 0:
//   restRotation    = postMul · bindPoseRot · preMul
//   restTranslation = bindTranslation
// (Verified vs swg-client-v2; the prior code used RPRE alone, which mismatched the
// authored skin weights → stiff legs / collapsed head.)

function buildSkeleton(
  parsedSkeleton: SkeletonParseResult,
): { skeleton: THREE.Skeleton; jointData: JointTransform[] } {
  const jointData: JointTransform[] = [];

  const bones: THREE.Bone[] = parsedSkeleton.bones.map(b => {
    const bone = new THREE.Bone();
    bone.name = b.name;

    const preMul      = quatFromDisk(b.preMultiplyRotation);
    const postMul     = quatFromDisk(b.postMultiplyRotation);
    const bindPoseRot = quatFromDisk(b.bindPoseRotation);
    const bindTranslation = new THREE.Vector3(
      b.bindTranslation[0], b.bindTranslation[1], b.bindTranslation[2],
    );
    jointData.push({ preMul, postMul, bindPoseRot, bindTranslation });

    // Rest pose: postMul · bindPoseRot · preMul  (THREE: copy→multiply→multiply).
    _scratchQuat.copy(postMul);
    _scratchQuat.multiply(bindPoseRot);
    _scratchQuat.multiply(preMul);
    _scratchQuat.normalize();
    bone.quaternion.copy(_scratchQuat);
    bone.position.copy(bindTranslation);
    return bone;
  });

  // Build parent hierarchy from parentIndex
  for (let i = 0; i < parsedSkeleton.bones.length; i++) {
    const bone = bones[i];
    const parentIdx = parsedSkeleton.bones[i]?.parentIndex ?? -1;
    if (bone && parentIdx >= 0 && parentIdx < bones.length) {
      const parentBone = bones[parentIdx];
      if (parentBone) parentBone.add(bone);
    }
  }

  return { skeleton: new THREE.Skeleton(bones), jointData };
}

// ─── Build BufferGeometry for one shader group ────────────────────────────────

function buildSkinnedGroupGeometry(
  group: MeshParseResult['shaderGroups'][number],
  geometry: ArrayBuffer,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  // Positions
  if (group.positions.byteLength > 0) {
    const posArray = new Float32Array(geometry, group.positions.offset, group.positions.elementCount * 3);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
  }

  // Normals
  if (group.normals && group.normals.byteLength > 0) {
    const normArray = new Float32Array(geometry, group.normals.offset, group.normals.elementCount * 3);
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArray, 3));
  }

  // UVs — first set only for MVP
  if (group.uvs.length > 0) {
    const uv0 = group.uvs[0];
    if (uv0 && uv0.byteLength > 0) {
      const uvArray = new Float32Array(geometry, uv0.offset, uv0.elementCount * 2);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArray, 2));
    }
  }

  // Indices (Uint32)
  if (group.indices.byteLength > 0) {
    const idxArray = new Uint32Array(geometry, group.indices.offset, group.indices.elementCount);
    geo.setIndex(new THREE.BufferAttribute(idxArray, 1));
  }

  // Skin indices (Int32 vec4) — required for SkinnedMesh GPU skinning
  // Skinning auto-enables from these attributes + bound Skeleton.
  // DO NOT set material.skinning (removed in r140).
  if (group.skinIndices && group.skinIndices.byteLength > 0) {
    const siArray = new Int32Array(geometry, group.skinIndices.offset, group.skinIndices.elementCount * 4);
    // THREE.js expects Uint16 for skinIndex by default, but accepts Int32 via Uint16Array conversion.
    // Use Uint16BufferAttribute with manually created buffer (safe: skinIndex values are non-negative).
    const siUint16 = new Uint16Array(siArray.length);
    for (let i = 0; i < siArray.length; i++) {
      siUint16[i] = Math.max(0, siArray[i] ?? 0);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(siUint16, 4));
  }

  // Skin weights (Float32 vec4, normalized to sum 1.0 by C++ normalizeSkinWeightsInto)
  if (group.skinWeights && group.skinWeights.byteLength > 0) {
    const swArray = new Float32Array(geometry, group.skinWeights.offset, group.skinWeights.elementCount * 4);
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(swArray, 4));
  }

  // DOT3 tangents (SKMG v0004) — when hasDot3=true, pass as 'tangent' BufferAttribute (vec4)
  // The tangent pool is not yet exposed directly from the C++ bridge geometry buffer;
  // we compute tangents via computeTangents() when UVs are present.
  // Full DOT3 buffer exposure would require a bridge change (deferred to a follow-up).
  if (group.hasDot3 && geo.attributes['uv'] && geo.attributes['position'] && geo.attributes['normal']) {
    try {
      geo.computeTangents();
    } catch (_e) {
      // computeTangents() requires indexed geometry + UVs — swallow if unavailable
    }
  }

  if (!group.normals || group.normals.byteLength === 0) {
    geo.computeVertexNormals();
  }

  return geo;
}

// ─── Build material for one skinned shader group ──────────────────────────────

function buildSkinnedGroupMaterial(
  group: MeshParseResult['shaderGroups'][number],
  resolvedMat: ResolvedMaterial | undefined,
  gl: THREE.WebGLRenderer,
  wireframe: boolean,
): THREE.ShaderMaterial | THREE.MeshStandardMaterial {
  if (wireframe) {
    return new THREE.MeshStandardMaterial({
      wireframe: true,
      color: '#888888',
    });
  }

  const shaderResult = resolvedMat?.shaderResult;
  const slotBytes    = resolvedMat?.slotBytes ?? {};
  const effectResult = resolvedMat?.effectResult ?? null;

  const slots = shaderResult?.slots ?? [];
  const hasNormalSlot = slots.some(s => s.slot === 'NRML' || s.slot === 'CNRM');
  const hasSpecSlot   = slots.some(s => s.slot === 'SPEC');
  const hasEmisSlot   = slots.some(s => s.slot === 'EMIS');
  // Gap-closure 02-03: ENVM is "active" only when cube bytes are present.
  const envBytes   = slotBytes['ENVM'];
  const hasEnvSlot = slots.some(s => s.slot === 'ENVM') && !!envBytes;
  // hasDot3: check whether the geometry has tangents (via computeTangents or DOT3 pool)
  const hasDot3 = group.hasDot3 ?? false;

  // Extract blend state from the best .eft implementation (gap-closure 02-03).
  const bestImpl = effectResult?.impls?.[effectResult.bestImplIndex] ?? null;
  const effectBlend = bestImpl?.blend
    ? {
        alphaBlendEnable: bestImpl.blend.alphaBlendEnable,
        blendSrc:         bestImpl.blend.blendSrc,
        blendDst:         bestImpl.blend.blendDst,
        alphaTestEnable:  bestImpl.blend.alphaTestEnable,
        alphaTestRef:     bestImpl.blend.alphaTestRef,
        zWrite:           bestImpl.blend.zWrite,
      }
    : null;

  const mat = buildSwgMaterial({
    skinned:         true, // includes <skinning_pars_vertex> + <skinning_vertex>
    hasNormal:       hasNormalSlot,
    hasSpec:         hasSpecSlot,
    hasEmissive:     hasEmisSlot,
    hasEnv:          hasEnvSlot,
    hasDot3Tangents: hasDot3,
    effectBlend,
  });

  // Wire up DDS textures from pre-fetched slotBytes (NO re-fetch here)
  // FAIL-SAFE: gate bHasEnv on a real bound cube (null samplerCube blacks out the fragment).
  let envBound = false;
  for (const slotDef of slots) {
    const bytes = slotBytes[slotDef.slot];
    if (!bytes) continue;

    try {
      const ddsResult = nativeCore.parseDds(new Uint8Array(bytes));
      const { texture } = buildDdsTexture(gl, ddsResult, bytes);

      switch (slotDef.slot) {
        case 'MAIN':
          // FIX 2 (sRGB): MAIN (diffuse) is a colour map — mark sRGB so GPU linearises on sample.
          // Lighting runs in linear space; Three.js output is sRGB.
          // ENVM/SPEC/NRML stay at NoColorSpace (linear data maps).
          texture.colorSpace = THREE.SRGBColorSpace;
          mat.uniforms.uDiffuseMap.value = texture;
          break;
        case 'NRML':
        case 'CNRM': mat.uniforms.uNormalMap.value   = texture; break; // linear
        case 'SPEC': mat.uniforms.uSpecularMap.value  = texture; break; // linear (gloss mask)
        case 'EMIS':
          // FIX 2 (sRGB): EMIS is also a colour map → sRGB decode.
          texture.colorSpace = THREE.SRGBColorSpace;
          mat.uniforms.uEmissiveMap.value = texture;
          break;
        case 'ENVM':
          // Gap-closure 02-03: wire the cube map texture from ENVM DDS bytes.
          // buildDdsTexture returns CompressedCubeTexture when ddsResult.isCubemap is true.
          // Cube stays linear (NoColorSpace) — env sampling is in linear space.
          if (ddsResult.isCubemap) {
            mat.uniforms.uEnvMap.value = texture;
            envBound = true;
          }
          break;
        default: break;
      }
    } catch (_e) {
      // Texture decode failed — slot stays as placeholder
    }
  }

  // FAIL-SAFE gate: only sample the env cube when one actually bound (else diffuse-only).
  mat.uniforms.bHasEnv.value = envBound;

  return mat;
}

// ─── Module-scope scratch for auto-frame (shared with SkinnedGroup) ─────────
const _scratchBox3 = new THREE.Box3();
const _scratchSphere = new THREE.Sphere();

// ─── Animation channel pre-built data ────────────────────────────────────────

/**
 * Pre-built per-channel flat arrays for the sparse-key sampler.
 * Built once in useEffect when parsedAnimation changes (NOT in useFrame).
 * The RotationChannelData float32 array is already (w,x,y,z) order per C++ decode.
 */
interface RotationChannelData {
  frames: Int32Array;   // frame indices (keyCount)
  quats: Float32Array;  // (w,x,y,z)[keyCount * 4]
}

interface TranslationChannelData {
  frames: Int32Array;   // frame indices (keyCount)
  values: Float32Array; // float[keyCount]
}

interface PrebuiltAnimData {
  rotChannels: RotationChannelData[];          // index = rotationChannelIndex
  staticRotations: Float32Array;               // (w,x,y,z) × staticRotationCount
  transChannels: TranslationChannelData[];     // index = translationChannelIndex
  staticTranslations: Float32Array;            // float × staticTranslationCount
  /** name → bone index in THREE.Skeleton.bones[] (built from parsedSkeleton) */
  nameToBoneIndex: Map<string, number>;
}

/**
 * Binary-search the frames array for the largest frame index ≤ queryFrame.
 * Returns the index k such that frames[k] <= queryFrame < frames[k+1].
 * Returns 0 when queryFrame < frames[0], and keyCount-1 for overflow.
 */
function binarySearchBracket(frames: Int32Array, keyCount: number, queryFrame: number): number {
  if (keyCount === 0) return 0;
  if (queryFrame <= frames[0]!) return 0;
  if (queryFrame >= frames[keyCount - 1]!) return keyCount - 1;
  let lo = 0;
  let hi = keyCount - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]! <= queryFrame) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ─── Auto-frame helper ────────────────────────────────────────────────────────

/**
 * Real bounds-based auto-fit for skinned meshes.
 * Computes a THREE.Box3 from actual BIND-POSE vertex positions across ALL parts and
 * shader groups, so a multi-part character is framed as a whole (not just one part).
 * SECONDARY gap-closure fix — hardcoded camera.position.set(3,2,3) missed large/off-origin meshes.
 */
function useAutoFrame(parts: SkinnedPart[]): void {
  const { camera, invalidate } = useThree();
  const framed = useRef(false);

  useEffect(() => {
    if (parts.length === 0 || framed.current) return;
    framed.current = true;

    const box = _scratchBox3.makeEmpty();

    for (const part of parts) {
      for (const g of part.parsedMesh.shaderGroups) {
        if (g.positions.byteLength <= 0 || g.positions.elementCount <= 0) continue;
        const posArray = new Float32Array(
          part.geometry,
          g.positions.offset,
          g.positions.elementCount * 3,
        );
        for (let i = 0; i < posArray.length; i += 3) {
          _scratchVec3.set(posArray[i] ?? 0, posArray[i + 1] ?? 0, posArray[i + 2] ?? 0);
          box.expandByPoint(_scratchVec3);
        }
      }
    }

    if (box.isEmpty()) {
      camera.position.set(3, 2, 3);
      camera.lookAt(0, 0, 0);
    } else {
      box.getCenter(_scratchVec3);
      box.getBoundingSphere(_scratchSphere);
      const radius = _scratchSphere.radius > 0 ? _scratchSphere.radius : 1.0;
      const fovRad = ((camera as THREE.PerspectiveCamera).fov ?? 55) * (Math.PI / 180);
      const dist = (radius / Math.sin(fovRad / 2)) * 1.2;
      camera.position.set(
        _scratchVec3.x + dist * 0.707,
        _scratchVec3.y + dist * 0.424,
        _scratchVec3.z + dist * 0.707,
      );
      camera.lookAt(_scratchVec3);
    }

    invalidate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts]);

  // Suppress unused scratch var warnings — scratch objects are declared at module scope.
  useFrame(() => {
    if (!framed.current) return;
    void _scratchMat4;
  });
}

// ─── One skinned mesh group component ────────────────────────────────────────

interface SkinnedGroupProps {
  group: MeshParseResult['shaderGroups'][number];
  groupIndex: number;
  geometry: ArrayBuffer;
  skeleton: THREE.Skeleton;
  wireframe: boolean;
  resolvedMaterial: ResolvedMaterial | undefined;
}

function SkinnedGroup({
  group,
  groupIndex,
  geometry,
  skeleton,
  wireframe,
  resolvedMaterial,
}: SkinnedGroupProps): React.ReactElement {
  const { gl } = useThree();
  const { customizationIndices } = useViewportStore();

  const geo = useMemo(
    () => buildSkinnedGroupGeometry(group, geometry),
    [group, geometry],
  );

  const mat = useMemo(
    () => buildSkinnedGroupMaterial(group, resolvedMaterial, gl as THREE.WebGLRenderer, wireframe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, resolvedMaterial, wireframe, gl],
  );

  const meshRef = useRef<THREE.SkinnedMesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (mesh) {
      // The bones must have valid WORLD matrices BEFORE bind() — bind() →
      // skeleton.calculateInverses() snapshots each bone.matrixWorld to build the
      // inverse-bind matrices. R3F has not run updateMatrixWorld on the bone tree
      // by the time this effect fires, so force it here. Without this the inverses
      // are captured as identity and GPU skinning collapses the mesh to the origin
      // (the "renders nothing" bug). The root bone is mounted into the scene graph
      // once at the group level (see <primitive> in the main component).
      const root = skeleton.bones[0];
      if (root) root.updateMatrixWorld(true);
      mesh.updateMatrixWorld(true);
      // bind() establishes the inverse bind matrices for GPU skinning
      mesh.bind(skeleton);
    }
    return () => {
      geo.dispose();
      if ((mat as THREE.Material).dispose) (mat as THREE.Material).dispose();
    };
  }, [geo, mat, skeleton]);

  // ─── Customization uniform mutation (zero-alloc in useFrame) ────────────
  const paletteCacheRef = useRef<Record<string, import('@swg/contracts').PaletteParseResult>>({});

  useFrame(() => {
    if (!resolvedMaterial?.shaderResult?.customizationVars?.length) return;
    const shaderMat = mat as THREE.ShaderMaterial;
    if (!shaderMat.uniforms) return;

    for (const cVar of resolvedMaterial.shaderResult.customizationVars) {
      const idx = customizationIndices[cVar.name] ?? cVar.defaultIndex;

      if (!paletteCacheRef.current[cVar.palettePath]) {
        // Palette not yet cached — skip this frame
        continue;
      }

      const palette = paletteCacheRef.current[cVar.palettePath]!;
      // T-02-13: clamp index to valid range
      const clampedIdx = Math.max(0, Math.min(idx, palette.entryCount - 1));
      const entry = palette.entries[clampedIdx];
      if (!entry) continue;

      const r = entry.r / 255;
      const g = entry.g / 255;
      const b = entry.b / 255;
      const a = entry.a / 255;

      if (cVar.pathway === 'palette-texture-factor') {
        // Pathway C → uTexFactor (zero-alloc)
        (shaderMat.uniforms.uTexFactor.value as THREE.Vector4).set(r, g, b, a);
      } else if (cVar.pathway === 'palette-material-color') {
        // Pathway A → uMaterialColor (zero-alloc, distinct from uTexFactor)
        (shaderMat.uniforms.uMaterialColor.value as THREE.Vector4).set(r, g, b, a);
      }
    }
  });

  const key = `${group.shaderName}-${groupIndex}`;
  return (
    <skinnedMesh
      key={key}
      ref={meshRef}
      geometry={geo}
      material={mat as THREE.Material}
      frustumCulled={false}
    />
  );
}

// ─── Sparse-key animation sampler hook ───────────────────────────────────────

/**
 * useAnimationSampler — extends useFrame with the ref-clock + sparse-key sampler.
 *
 * REF CLOCK: currentFrame lives in a ref (no Zustand write per frame). The ref is
 * advanced each useFrame by delta × fps × speed when playing. On loop: wraps to 0.
 * On end without loop: clamps to totalFrames-1 and sets playing=false.
 * Flush to Zustand store THROTTLED (at most ~10×/s) so the scrubber follows.
 *
 * PRE-BUILT DATA (useEffect on parsedAnimation): flat Float32Array + Int32Array per
 * channel, read from the sparse keyframe ArrayBuffer. Built ONCE, stored in a ref.
 * NOT built in useFrame — avoids a per-frame allocation (D-09).
 *
 * PER-FRAME SAMPLE: for each animated joint:
 *   - binary-search rotation frames for bracket [k0,k1] around frameRef.current
 *   - compute fraction t = (frame - frames[k0]) / (frames[k1] - frames[k0])
 *   - set _scratchQuatA from quats[k0*4..] and _scratchQuatB from quats[k1*4..]
 *     reordering (w,x,y,z) → THREE.Quaternion (x,y,z,w)
 *   - THREE.Quaternion.slerpQuaternions(_scratchQuatA, _scratchQuatB, t, _scratchQuat)
 *   - bone.quaternion.copy(_scratchQuat)
 * Same for translation. Static rotation/translation set bone in bind-pose override.
 *
 * ANTI-PATTERN CHECK: no `new THREE.*`, no arrays, no per-frame setTransportState.
 */
function useAnimationSampler(
  skeleton: THREE.Skeleton,
  parsedSkeleton: SkeletonParseResult | null,
  jointData: JointTransform[],
): void {
  const { parsedAnimation, transportState, setTransportState } = useViewportStore();

  // Pre-built channel data (rebuilt on parsedAnimation change)
  const prebuiltRef = useRef<PrebuiltAnimData | null>(null);

  // Ref clock — currentFrame as float (sub-frame precision for smooth playback)
  const frameRef = useRef<number>(0);

  // Throttle flush accumulator
  const flushAccRef = useRef<number>(0);

  // Sync frameRef with store on non-playing (scrub / step)
  // This is an EFFECT that only runs when the store changes externally.
  useEffect(() => {
    if (!transportState.playing) {
      frameRef.current = transportState.currentFrame;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportState.currentFrame, transportState.playing]);

  // Pre-build channel data from parsedAnimation (NOT in useFrame)
  useEffect(() => {
    if (!parsedAnimation || !parsedSkeleton) {
      prebuiltRef.current = null;
      return;
    }

    const ct = parsedAnimation.channelTable;
    const kfBuf = parsedAnimation.keyframes;
    const kfDv  = new DataView(kfBuf);

    // Build rotation channels
    const rotChannels: RotationChannelData[] = ct.rotationChannels.map(ch => {
      const base = ch.byteOffset;
      const keyCount = kfDv.getInt32(base, true);
      const safeKc = Math.min(keyCount, ch.keyCount); // defensive
      const frames = new Int32Array(safeKc);
      const quats  = new Float32Array(safeKc * 4);
      const framesBase = base + 4;
      const quatsBase  = base + 4 + safeKc * 4;
      for (let k = 0; k < safeKc; k++) {
        frames[k] = kfDv.getInt32(framesBase + k * 4, true);
      }
      for (let k = 0; k < safeKc; k++) {
        const qBase = quatsBase + k * 16;
        quats[k * 4 + 0] = kfDv.getFloat32(qBase + 0,  true); // w
        quats[k * 4 + 1] = kfDv.getFloat32(qBase + 4,  true); // x
        quats[k * 4 + 2] = kfDv.getFloat32(qBase + 8,  true); // y
        quats[k * 4 + 3] = kfDv.getFloat32(qBase + 12, true); // z
      }
      return { frames, quats };
    });

    // Build static rotations
    const staticRotCount = ct.staticRotationCount;
    const staticRotations = new Float32Array(staticRotCount * 4);
    for (let i = 0; i < staticRotCount; i++) {
      const base = ct.staticRotByteOffset + i * 16;
      staticRotations[i * 4 + 0] = kfDv.getFloat32(base + 0,  true); // w
      staticRotations[i * 4 + 1] = kfDv.getFloat32(base + 4,  true); // x
      staticRotations[i * 4 + 2] = kfDv.getFloat32(base + 8,  true); // y
      staticRotations[i * 4 + 3] = kfDv.getFloat32(base + 12, true); // z
    }

    // Build translation channels
    const transChannels: TranslationChannelData[] = ct.translationChannels.map(ch => {
      const base = ch.byteOffset;
      const keyCount = kfDv.getInt32(base, true);
      const safeKc = Math.min(keyCount, ch.keyCount);
      const frames = new Int32Array(safeKc);
      const values = new Float32Array(safeKc);
      const framesBase = base + 4;
      const valuesBase = base + 4 + safeKc * 4;
      for (let k = 0; k < safeKc; k++) {
        frames[k] = kfDv.getInt32(framesBase + k * 4, true);
        values[k] = kfDv.getFloat32(valuesBase + k * 4, true);
      }
      return { frames, values };
    });

    // Build static translations
    const staticTransCount = ct.staticTranslationCount;
    const staticTranslations = new Float32Array(staticTransCount);
    for (let i = 0; i < staticTransCount; i++) {
      staticTranslations[i] = kfDv.getFloat32(ct.staticTransByteOffset + i * 4, true);
    }

    // Build name→bone index map (name-keyed, T-02-17). LOWERCASED keys: SWG matches
    // transform names case-insensitively (CrcLowerString), and .ans joint names are often
    // lowercase (e.g. "lthigh") while the .skt is camelCase ("lThigh"). An exact match left
    // limb joints undriven (legs stiff). Lookups below also lowercase the joint name.
    const nameToBoneIndex = new Map<string, number>();
    for (let i = 0; i < skeleton.bones.length; i++) {
      nameToBoneIndex.set(skeleton.bones[i]!.name.toLowerCase(), i);
    }

    prebuiltRef.current = {
      rotChannels,
      staticRotations,
      transChannels,
      staticTranslations,
      nameToBoneIndex,
    };

    // Reset ref clock when animation changes
    frameRef.current = 0;
    flushAccRef.current = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedAnimation, parsedSkeleton]);

  // useFrame: ref clock + sparse sampler
  useFrame((state, delta) => {
    const data = prebuiltRef.current;
    const anim = parsedAnimation;
    if (!data || !anim) return;

    const { playing, speed, loop, totalFrames } = transportState;
    const fps = anim.fps > 0 ? anim.fps : 30;
    const maxFrame = totalFrames > 0 ? totalFrames - 1 : 0;

    // ── Keep the demand-frameloop alive during playback ─────────────────────
    // frameloop="demand" only renders on invalidate(). On its own a Play click is
    // a single store change → one re-render → ONE frame, then the loop goes idle and
    // the ref clock never advances. Request the next frame each tick while playing so
    // playback is continuous. When playing flips false (pause / end-of-anim), the
    // re-render runs this closure once more with playing=false and the loop stops.
    if (playing) {
      state.invalidate();
    }

    // ── Advance ref clock when playing ──────────────────────────────────────
    if (playing) {
      frameRef.current += delta * fps * speed;

      if (frameRef.current > maxFrame) {
        if (loop) {
          frameRef.current = frameRef.current % (maxFrame + 1);
        } else {
          frameRef.current = maxFrame;
          // Throttle this store call — it's a one-time event (end-of-anim), not per-frame.
          setTransportState({ playing: false, currentFrame: maxFrame });
        }
      }
    }

    const queryFrame = frameRef.current;

    // ── Throttled UI flush ───────────────────────────────────────────────────
    if (playing) {
      flushAccRef.current += delta * 1000;
      if (flushAccRef.current >= FLUSH_INTERVAL_MS) {
        flushAccRef.current = 0;
        setTransportState({ currentFrame: Math.round(queryFrame) });
      }
    }

    // ── Per-joint sample ─────────────────────────────────────────────────────
    const joints = anim.joints;

    for (let ji = 0; ji < joints.length; ji++) {
      const joint = joints[ji];
      if (!joint) continue;

      const boneIdx = data.nameToBoneIndex.get(joint.name.toLowerCase());
      if (boneIdx == null) continue; // T-02-17: unmatched joint skipped

      const bone = skeleton.bones[boneIdx];
      if (!bone) continue;

      const jd = jointData[boneIdx];

      // ── Rotation ────────────────────────────────────────────────────────
      // First resolve the ANIMATION rotation (animResolverRot) into _scratchQuat,
      // then compose the full SWG joint rotation: postMul · (animResolverRot · bindPoseRot · preMul).
      // Source: Skeleton.cpp:1273-1279. Animated joints slerp the keyframe channel; non-animated
      // joints read the static-rotation table (same rotationChannelIndex field — getStaticRotation,
      // CompressedKeyframeAnimation.cpp:1091); a joint with no resolvable rotation contributes identity.
      let haveRot = false;
      if (joint.hasAnimatedRotation && joint.rotationChannelIndex >= 0) {
        const ch = data.rotChannels[joint.rotationChannelIndex];
        if (ch && ch.frames.length > 0) {
          const kc = ch.frames.length;
          const k0 = binarySearchBracket(ch.frames, kc, Math.floor(queryFrame));
          const k1 = Math.min(k0 + 1, kc - 1);
          // Reorder on-disk (w,x,y,z) → THREE (x,y,z,w)
          _scratchQuatA.set(ch.quats[k0 * 4 + 1]!, ch.quats[k0 * 4 + 2]!, ch.quats[k0 * 4 + 3]!, ch.quats[k0 * 4 + 0]!);
          _scratchQuatB.set(ch.quats[k1 * 4 + 1]!, ch.quats[k1 * 4 + 2]!, ch.quats[k1 * 4 + 3]!, ch.quats[k1 * 4 + 0]!);
          const fA = ch.frames[k0]!;
          const fB = ch.frames[k1]!;
          const frac = fA === fB ? 0 : (queryFrame - fA) / (fB - fA);
          _scratchQuat.slerpQuaternions(_scratchQuatA, _scratchQuatB, Math.max(0, Math.min(1, frac)));
          haveRot = true;
        }
      } else if (joint.rotationChannelIndex >= 0) {
        const sidx = joint.rotationChannelIndex;
        if (sidx * 4 + 3 < data.staticRotations.length) {
          _scratchQuat.set(
            data.staticRotations[sidx * 4 + 1]!, data.staticRotations[sidx * 4 + 2]!,
            data.staticRotations[sidx * 4 + 3]!, data.staticRotations[sidx * 4 + 0]!,
          );
          haveRot = true;
        }
      }
      if (!haveRot) _scratchQuat.identity(); // identity delta → bone holds its rest pose

      if (jd) {
        // postMul · (animResolverRot · bindPoseRot · preMul)
        _scratchQuat.multiply(jd.bindPoseRot); // animResolverRot · bindPoseRot
        _scratchQuat.multiply(jd.preMul);      // · preMul
        _scratchQuat.premultiply(jd.postMul);  // postMul · (...)
      }
      _scratchQuat.normalize();
      bone.quaternion.copy(_scratchQuat);

      // ── Translation ─────────────────────────────────────────────────────
      // localTranslation = bindTranslation + animResolverTranslation (Skeleton.cpp:1275).
      // The resolver value (animated channel OR static table) is a DELTA added to the bind
      // translation — NOT a replacement. Overwriting bind collapsed joints onto their parent
      // (the head telescoped into the torso). Per axis: animated→channel, static→static table;
      // SATCCF translation flags are bits 3/4/5 (SATCCF_xTranslation=0x08).
      const mask = joint.translationMask;
      let dx = 0, dy = 0, dz = 0;
      for (let ax = 0; ax < 3; ax++) {
        const chIdx = joint.translationChannelIndex[ax];
        if (chIdx < 0) continue;
        const animatedAxis = (mask & (SATCCF_X_TRANS << ax)) !== 0;

        let delta: number;
        if (animatedAxis) {
          const ch = data.transChannels[chIdx];
          if (!ch || ch.frames.length === 0) continue;
          const kc = ch.frames.length;
          const k0 = binarySearchBracket(ch.frames, kc, Math.floor(queryFrame));
          const k1 = Math.min(k0 + 1, kc - 1);
          const fA = ch.frames[k0]!;
          const fB = ch.frames[k1]!;
          const frac = fA === fB ? 0 : (queryFrame - fA) / (fB - fA);
          delta = ch.values[k0]! + (ch.values[k1]! - ch.values[k0]!) * Math.max(0, Math.min(1, frac));
        } else {
          if (chIdx >= data.staticTranslations.length) continue;
          delta = data.staticTranslations[chIdx]!;
        }

        if (ax === 0) dx = delta;
        else if (ax === 1) dy = delta;
        else dz = delta;
      }
      if (jd) {
        bone.position.set(jd.bindTranslation.x + dx, jd.bindTranslation.y + dy, jd.bindTranslation.z + dz);
      } else {
        bone.position.set(dx, dy, dz);
      }
    }

    // Propagate the updated local transforms through the hierarchy ONCE, from the root,
    // so parents are resolved before children (Skeleton.cpp jointToRoot = parentToRoot · jointToParent).
    skeleton.bones[0]?.updateMatrixWorld(true);

    // Suppress scratch var unused lint (vectors used for potential future lerp endpoints)
    void _scratchVecA;
    void _scratchVecB;
    void _scratchMat4;
  });
}

// ─── Skeleton helper hook ─────────────────────────────────────────────────────

/**
 * useSkeletonHelper — mounts/unmounts THREE.SkeletonHelper when skeletonHelperVisible changes.
 * NEVER constructs the helper in useFrame — built once in useEffect.
 */
function useSkeletonHelper(
  skeleton: THREE.Skeleton,
  meshGroupRef: React.RefObject<THREE.Group | null>,
): void {
  const { skeletonHelperVisible } = useViewportStore();
  const helperRef = useRef<THREE.SkeletonHelper | null>(null);

  useEffect(() => {
    const group = meshGroupRef.current;
    if (!group) return;

    if (skeletonHelperVisible) {
      const helper = new THREE.SkeletonHelper(skeleton.bones[0] ?? new THREE.Bone());
      helperRef.current = helper;
      group.parent?.add(helper);
      return () => {
        group.parent?.remove(helper);
        helper.dispose?.();
        helperRef.current = null;
      };
    }
  }, [skeletonHelperVisible, skeleton, meshGroupRef]);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SkinnedMeshView(props: SkinnedMeshViewProps): React.ReactElement {
  const { parsedSkeleton, renderMode } = props;
  const wireframe = renderMode === 'wire';

  // Normalize legacy single-part props → a one-element parts array, so the body has
  // exactly ONE code path (multi-part). The .sat path always supplies `parts`; leaf
  // .mgn / static redirects use the legacy parsedMesh+geometry props.
  const parts: SkinnedPart[] = useMemo(() => {
    if (props.parts && props.parts.length > 0) return props.parts;
    if (props.parsedMesh && props.geometry) {
      return [{ parsedMesh: props.parsedMesh, geometry: props.geometry, materials: props.materials }];
    }
    return [];
  }, [props.parts, props.parsedMesh, props.geometry, props.materials]);

  // Build the (possibly merged) skeleton ONCE; all parts share it.
  const { skeleton, jointData } = useMemo((): { skeleton: THREE.Skeleton; jointData: JointTransform[] } => {
    if (parsedSkeleton && parsedSkeleton.bones.length > 0) {
      return buildSkeleton(parsedSkeleton);
    }
    // Fallback: identity skeleton with a single root bone
    const rootBone = new THREE.Bone();
    rootBone.name = 'root';
    return { skeleton: new THREE.Skeleton([rootBone]), jointData: [] };
  }, [parsedSkeleton]);

  useEffect(() => {
    return () => {
      skeleton.dispose();
    };
  }, [skeleton]);

  useAutoFrame(parts);

  // Animation sampler (VIEW-03): ref-clock + sparse-key per-frame sampling. ONE sampler
  // drives the shared skeleton; it animates all parts at once.
  useAnimationSampler(skeleton, parsedSkeleton, jointData);

  // Skeleton helper overlay (controlled by ⊹ chip in AnimationTransport)
  const meshGroupRef = useRef<THREE.Group | null>(null);
  useSkeletonHelper(skeleton, meshGroupRef);

  return (
    // SWG→Viewer orientation: 180° Y rotation (pure rotation, determinant +1).
    // HUMAN-VERIFY at checkpoint: compare vs SIE default facing.
    <group ref={meshGroupRef} rotation={SWG_ORIENTATION}>
      {/*
        Mount the skeleton's root bone (and its whole hierarchy) into the scene
        graph EXACTLY ONCE for the whole appearance. ALL parts' shader groups share
        this one skeleton, so a bone can have only one parent — adding it here (not
        per-group, not per-part) is required. Without the bones in the graph their
        world matrices are never computed, bind() captures identity inverses, and GPU
        skinning collapses to the origin. `object` is stable because `skeleton` is memoized.
      */}
      {skeleton.bones[0] && <primitive object={skeleton.bones[0]} />}
      {parts.flatMap((part, pi) =>
        part.parsedMesh.shaderGroups.map((group, gi) => (
          <SkinnedGroup
            key={`p${pi}-${group.shaderName}-${gi}`}
            group={group}
            groupIndex={gi}
            geometry={part.geometry}
            skeleton={skeleton}
            wireframe={wireframe}
            resolvedMaterial={part.materials?.[gi]}
          />
        )),
      )}
    </group>
  );
}
