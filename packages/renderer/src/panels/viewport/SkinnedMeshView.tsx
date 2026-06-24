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
 * Multi-PSDT: renders ALL shader groups as SkinnedMesh instances sharing one Skeleton.
 *
 * Module-scope scratch objects declared at module level — NEVER re-created in useFrame.
 * (GC contract D-09: zero allocation in hot render path.)
 *
 * Source: 02-PATTERNS.md § SkinnedMeshView.tsx (module-scope scratch, GC-safe)
 *         + synthesis §2 (GPU skinning, name-keyed bone bind, Pitfall 5/6)
 *         + swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (XFNM→bone remap)
 */

import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import type { MeshParseResult, SkeletonParseResult } from '@swg/contracts';

// ─── Module-scope scratch (NEVER re-allocated in useFrame or render) ──────────
const _scratchQuat  = new THREE.Quaternion();
const _scratchVec3  = new THREE.Vector3();
const _scratchMat4  = new THREE.Matrix4();

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SkinnedMeshViewProps {
  parsedMesh: MeshParseResult;
  geometry: ArrayBuffer;
  parsedSkeleton: SkeletonParseResult | null;
  renderMode: 'solid' | 'wire' | 'textured';
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

  if (!group.normals || group.normals.byteLength === 0) {
    geo.computeVertexNormals();
  }

  return geo;
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
  geometry: ArrayBuffer;
  skeleton: THREE.Skeleton;
  wireframe: boolean;
}

function SkinnedGroup({ group, geometry, skeleton, wireframe }: SkinnedGroupProps): React.ReactElement {
  const geo = useMemo(
    () => buildSkinnedGroupGeometry(group, geometry),
    [group, geometry],
  );

  const meshRef = useRef<THREE.SkinnedMesh>(null);

  useEffect(() => {
    if (meshRef.current) {
      // bind() establishes the inverse bind matrices for GPU skinning
      meshRef.current.bind(skeleton);
    }
    return () => { geo.dispose(); };
  }, [geo, skeleton]);

  return (
    <skinnedMesh ref={meshRef} geometry={geo} frustumCulled={false}>
      <meshStandardMaterial
        wireframe={wireframe}
        color="#888888"
        metalness={0.1}
        roughness={0.8}
        // DO NOT set skinning — removed in r140; auto-enables from attributes + bound skeleton
      />
    </skinnedMesh>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SkinnedMeshView({
  parsedMesh,
  geometry,
  parsedSkeleton,
  renderMode,
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
    <group>
      {/* Skeleton helper for debugging — hidden in textured mode */}
      {renderMode === 'wire' && (
        <primitive object={new THREE.SkeletonHelper(skeleton.bones[0] ?? new THREE.Bone())} />
      )}
      {parsedMesh.shaderGroups.map((group, i) => (
        <SkinnedGroup
          key={`${group.shaderName}-${i}`}
          group={group}
          geometry={geometry}
          skeleton={skeleton}
          wireframe={wireframe}
        />
      ))}
    </group>
  );
}
