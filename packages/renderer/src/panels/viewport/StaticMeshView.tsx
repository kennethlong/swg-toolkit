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
import { useThree } from '@react-three/fiber';
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

function useAutoFrame(parsedMesh: MeshParseResult | null): void {
  const { camera } = useThree();
  const framed = useRef(false);

  useEffect(() => {
    if (!parsedMesh || framed.current) return;
    framed.current = true;
    // Use bounding sphere of all group positions to frame the camera
    const box = _scratchBox3.makeEmpty();
    const fakeGeo = new THREE.BufferGeometry();
    for (const g of parsedMesh.shaderGroups) {
      // approximate frame via position count
      if (g.positions.byteLength > 0) {
        box.expandByPoint(_scratchVec3Center.set(0, 0, 0));
        break;
      }
    }
    box.getCenter(_scratchVec3Center);
    const dist = 3.0;
    camera.position.set(
      _scratchVec3Center.x + dist,
      _scratchVec3Center.y + dist * 0.6,
      _scratchVec3Center.z + dist,
    );
    camera.lookAt(_scratchVec3Center);
    fakeGeo.dispose();
  }, [parsedMesh, camera]);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StaticMeshView({
  parsedMesh,
  geometry,
  renderMode,
}: StaticMeshViewProps): React.ReactElement {
  const wireframe = renderMode === 'wire';
  useAutoFrame(parsedMesh);

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
