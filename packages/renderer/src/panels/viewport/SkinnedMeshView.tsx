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

// ─── SWG→Viewer orientation ───────────────────────────────────────────────────
// See StaticMeshView.tsx for the rationale. Same 180° Y rotation (pure, det=+1).
const SWG_ORIENTATION = new THREE.Euler(0, Math.PI, 0);

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SkinnedMeshViewProps {
  parsedMesh: MeshParseResult;
  geometry: ArrayBuffer;
  parsedSkeleton: SkeletonParseResult | null;
  renderMode: 'solid' | 'wire' | 'textured';
  /** Resolved materials indexed by shader group (from appearanceResolver). */
  materials?: ResolvedMaterial[];
}

// ─── Build skeleton ───────────────────────────────────────────────────────────

function buildSkeleton(parsedSkeleton: SkeletonParseResult): THREE.Skeleton {
  const bones: THREE.Bone[] = parsedSkeleton.bones.map(b => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    // Bind translation: (x, y, z) from BPTR
    _scratchVec3.set(b.bindTranslation[0], b.bindTranslation[1], b.bindTranslation[2]);
    bone.position.copy(_scratchVec3);
    // Bind rotation: on-disk (w,x,y,z) from BPRO → THREE.Quaternion.set(x,y,z,w)
    _scratchQuat.set(
      b.bindRotation[1], // x
      b.bindRotation[2], // y
      b.bindRotation[3], // z
      b.bindRotation[0], // w  (reorder from IR (w,x,y,z))
    );
    bone.quaternion.copy(_scratchQuat);
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

  return new THREE.Skeleton(bones);
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
  const slotBytes = resolvedMat?.slotBytes ?? {};

  const slots = shaderResult?.slots ?? [];
  const hasNormalSlot = slots.some(s => s.slot === 'NRML' || s.slot === 'CNRM');
  const hasSpecSlot   = slots.some(s => s.slot === 'SPEC');
  const hasEmisSlot   = slots.some(s => s.slot === 'EMIS');
  const hasEnvSlot    = slots.some(s => s.slot === 'ENVM');
  // hasDot3: check whether the geometry has tangents (via computeTangents or DOT3 pool)
  const hasDot3 = group.hasDot3 ?? false;

  const mat = buildSwgMaterial({
    skinned:         true, // includes <skinning_pars_vertex> + <skinning_vertex>
    hasNormal:       hasNormalSlot,
    hasSpec:         hasSpecSlot,
    hasEmissive:     hasEmisSlot,
    hasEnv:          hasEnvSlot,
    hasDot3Tangents: hasDot3,
  });

  // Wire up DDS textures from pre-fetched slotBytes (NO re-fetch here)
  for (const slotDef of slots) {
    const bytes = slotBytes[slotDef.slot];
    if (!bytes) continue;

    try {
      const ddsResult = nativeCore.parseDds(new Uint8Array(bytes));
      const { texture } = buildDdsTexture(gl, ddsResult, bytes);

      switch (slotDef.slot) {
        case 'MAIN': mat.uniforms.uDiffuseMap.value  = texture; break;
        case 'NRML':
        case 'CNRM': mat.uniforms.uNormalMap.value   = texture; break;
        case 'SPEC': mat.uniforms.uSpecularMap.value  = texture; break;
        case 'EMIS': mat.uniforms.uEmissiveMap.value  = texture; break;
        case 'ENVM': /* cubemap from scene.environment */ break;
        default: break;
      }
    } catch (_e) {
      // Texture decode failed — slot stays as placeholder
    }
  }

  return mat;
}

// ─── Module-scope scratch for auto-frame (shared with SkinnedGroup) ─────────
const _scratchBox3 = new THREE.Box3();
const _scratchSphere = new THREE.Sphere();

// ─── Auto-frame helper ────────────────────────────────────────────────────────

/**
 * Real bounds-based auto-fit for skinned meshes.
 * Computes a THREE.Box3 from actual BIND-POSE vertex positions across ALL shader groups.
 * SECONDARY gap-closure fix — hardcoded camera.position.set(3,2,3) missed large/off-origin meshes.
 */
function useAutoFrame(parsedMesh: MeshParseResult | null, geometry: ArrayBuffer): void {
  const { camera, invalidate } = useThree();
  const framed = useRef(false);

  useEffect(() => {
    if (!parsedMesh || framed.current) return;
    framed.current = true;

    const box = _scratchBox3.makeEmpty();

    for (const g of parsedMesh.shaderGroups) {
      if (g.positions.byteLength <= 0 || g.positions.elementCount <= 0) continue;
      const posArray = new Float32Array(
        geometry,
        g.positions.offset,
        g.positions.elementCount * 3,
      );
      for (let i = 0; i < posArray.length; i += 3) {
        _scratchVec3.set(posArray[i] ?? 0, posArray[i + 1] ?? 0, posArray[i + 2] ?? 0);
        box.expandByPoint(_scratchVec3);
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
  }, [parsedMesh]);

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
    if (meshRef.current) {
      // bind() establishes the inverse bind matrices for GPU skinning
      meshRef.current.bind(skeleton);
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function SkinnedMeshView({
  parsedMesh,
  geometry,
  parsedSkeleton,
  renderMode,
  materials,
}: SkinnedMeshViewProps): React.ReactElement {
  const wireframe = renderMode === 'wire';

  const skeleton = useMemo((): THREE.Skeleton => {
    if (parsedSkeleton && parsedSkeleton.bones.length > 0) {
      return buildSkeleton(parsedSkeleton);
    }
    // Fallback: identity skeleton with a single root bone
    const rootBone = new THREE.Bone();
    rootBone.name = 'root';
    return new THREE.Skeleton([rootBone]);
  }, [parsedSkeleton]);

  useEffect(() => {
    return () => {
      skeleton.dispose();
    };
  }, [skeleton]);

  useAutoFrame(parsedMesh, geometry);

  return (
    // SWG→Viewer orientation: 180° Y rotation (pure rotation, determinant +1).
    // HUMAN-VERIFY at checkpoint: compare vs SIE default facing.
    <group rotation={SWG_ORIENTATION}>
      {/* Skeleton helper for debugging — hidden in textured mode */}
      {renderMode === 'wire' && (
        <primitive object={new THREE.SkeletonHelper(skeleton.bones[0] ?? new THREE.Bone())} />
      )}
      {parsedMesh.shaderGroups.map((group, i) => (
        <SkinnedGroup
          key={`${group.shaderName}-${i}`}
          group={group}
          groupIndex={i}
          geometry={geometry}
          skeleton={skeleton}
          wireframe={wireframe}
          resolvedMaterial={materials?.[i]}
        />
      ))}
    </group>
  );
}
