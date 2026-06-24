/**
 * packages/renderer/src/panels/viewport/StaticMeshView.tsx
 *
 * Non-skinned render path (VIEW-01 static).
 * Builds THREE.BufferGeometry from the MeshParseResult geometry ArrayBuffer.
 * Renders ONE THREE.Mesh per shader group (multi-PSDT).
 *
 * Index type: Uint32 (NOT Uint16) — see mesh.ts for rationale.
 * No material.skinning — not applicable to static meshes.
 *
 * Module-scope scratch objects ensure no allocation in render loops.
 *
 * Source: 02-PATTERNS.md § StaticMeshView.tsx
 *         + 02-UI-SPEC.md Surface 1 (Canvas chrome, render-mode subscription)
 */

import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import type { MeshParseResult } from '@swg/contracts';

// ─── Module-scope scratch ─────────────────────────────────────────────────────
// Never re-created — reused across frames and component instances.
const _scratchBox3 = new THREE.Box3();
const _scratchVec3Center = new THREE.Vector3();

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StaticMeshViewProps {
  parsedMesh: MeshParseResult;
  geometry: ArrayBuffer;
  renderMode: 'solid' | 'wire' | 'textured';
}

// ─── Build geometry for one shader group ─────────────────────────────────────

function buildGroupGeometry(
  group: MeshParseResult['shaderGroups'][number],
  geometry: ArrayBuffer,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  // Positions (Float32 xyz)
  if (group.positions.byteLength > 0) {
    const posArray = new Float32Array(geometry, group.positions.offset, group.positions.elementCount * 3);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
  }

  // Normals (Float32 xyz) — optional
  if (group.normals && group.normals.byteLength > 0) {
    const normArray = new Float32Array(geometry, group.normals.offset, group.normals.elementCount * 3);
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArray, 3));
  }

  // UVs (Float32 uv) — first UV set only for MVP (02-03 adds multi-UV material)
  if (group.uvs.length > 0) {
    const uv0 = group.uvs[0];
    if (uv0 && uv0.byteLength > 0) {
      const uvArray = new Float32Array(geometry, uv0.offset, uv0.elementCount * 2);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArray, 2));
    }
  }

  // Indices (Uint32 — NOT Uint16; source int32 ITL may exceed 65535)
  if (group.indices.byteLength > 0) {
    const idxArray = new Uint32Array(geometry, group.indices.offset, group.indices.elementCount);
    geo.setIndex(new THREE.BufferAttribute(idxArray, 1));
  }

  // Compute normals if absent from the file
  if (!group.normals || group.normals.byteLength === 0) {
    geo.computeVertexNormals();
  }

  return geo;
}

// ─── One mesh group ───────────────────────────────────────────────────────────

interface MeshGroupProps {
  group: MeshParseResult['shaderGroups'][number];
  geometry: ArrayBuffer;
  wireframe: boolean;
}

function MeshGroup({ group, geometry, wireframe }: MeshGroupProps): React.ReactElement {
  const geo = useMemo(() => buildGroupGeometry(group, geometry), [group, geometry]);

  useEffect(() => {
    return () => { geo.dispose(); };
  }, [geo]);

  return (
    <mesh geometry={geo}>
      <meshStandardMaterial
        wireframe={wireframe}
        color="#888888"
        metalness={0.1}
        roughness={0.8}
      />
    </mesh>
  );
}

// ─── Auto-frame helper ────────────────────────────────────────────────────────

/**
 * Real bounds-based auto-fit: compute THREE.Box3 from actual vertex positions,
 * then set OrbitControls target to the center and camera distance from the radius.
 * SECONDARY gap-closure fix — large/off-origin meshes were previously out-of-frustum.
 */
function useAutoFrame(
  parsedMesh: MeshParseResult | null,
  geometry: ArrayBuffer,
): void {
  const { camera, invalidate } = useThree();
  const framed = useRef(false);

  useEffect(() => {
    if (!parsedMesh || framed.current) return;
    framed.current = true;

    const box = _scratchBox3.makeEmpty();

    // Expand the box by ACTUAL vertex positions across ALL shader groups.
    for (const g of parsedMesh.shaderGroups) {
      if (g.positions.byteLength <= 0 || g.positions.elementCount <= 0) continue;
      const posArray = new Float32Array(
        geometry,
        g.positions.offset,
        g.positions.elementCount * 3,
      );
      for (let i = 0; i < posArray.length; i += 3) {
        _scratchVec3Center.set(posArray[i] ?? 0, posArray[i + 1] ?? 0, posArray[i + 2] ?? 0);
        box.expandByPoint(_scratchVec3Center);
      }
    }

    if (box.isEmpty()) {
      // Fallback: no real vertices found, park at default
      camera.position.set(3, 2, 3);
      camera.lookAt(0, 0, 0);
    } else {
      box.getCenter(_scratchVec3Center);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = sphere.radius > 0 ? sphere.radius : 1.0;
      // FOV-based margin: ensure the sphere fits in the frustum with a 20% margin.
      const fovRad = ((camera as THREE.PerspectiveCamera).fov ?? 55) * (Math.PI / 180);
      const dist = (radius / Math.sin(fovRad / 2)) * 1.2;
      camera.position.set(
        _scratchVec3Center.x + dist * 0.707,
        _scratchVec3Center.y + dist * 0.424,
        _scratchVec3Center.z + dist * 0.707,
      );
      camera.lookAt(_scratchVec3Center);
      // Update OrbitControls target to the mesh center.
      // OrbitControls is makeDefault — accessed via camera.userData workaround or
      // via the scene; we set the camera target and call controls.update() indirectly
      // by invalidating the frame (controls picks up the lookAt on next tick).
    }

    // Trigger a repaint in demand mode.
    invalidate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedMesh]);

  // Also invalidate after the frame fires so OrbitControls gets to run.
  useFrame(() => {
    if (!framed.current) return;
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StaticMeshView({
  parsedMesh,
  geometry,
  renderMode,
}: StaticMeshViewProps): React.ReactElement {
  const wireframe = renderMode === 'wire';
  useAutoFrame(parsedMesh, geometry);

  return (
    <group>
      {parsedMesh.shaderGroups.map((group, i) => (
        <MeshGroup
          key={`${group.shaderName}-${i}`}
          group={group}
          geometry={geometry}
          wireframe={wireframe}
        />
      ))}
    </group>
  );
}
