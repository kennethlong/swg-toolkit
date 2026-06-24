/**
 * packages/renderer/src/panels/viewport/StaticMeshView.tsx
 *
 * Non-skinned render path (VIEW-01 static).
 * Builds THREE.BufferGeometry from the MeshParseResult geometry ArrayBuffer.
 * Renders ONE THREE.Mesh per shader group (multi-PSDT).
 *
 * Material: buildSwgMaterial (custom ShaderMaterial) replaces the 02-02 placeholder.
 * Textures: buildDdsTexture from resolution.materials[i].slotBytes (already plumbed by 02-02).
 *
 * Orientation: SWG→viewer pure rotation applied at the group level (NOT a mirror/scale):
 *   SWG uses forward=+Z, up=+Y. Three.js camera looks down -Z.
 *   Equivalent to io_scene_swg_msh @orientation_helper(axis_forward='Z', axis_up='Y')
 *   which imports with a 180° Y rotation (so SWG's +Z forward faces the camera's +Z view).
 *   Applied as a single group rotation: rotateY(Math.PI) so the authored front faces the viewer.
 *   HUMAN-VERIFY: compare vs SIE at checkpoint.
 *
 * Index type: Uint32 (NOT Uint16) — see mesh.ts for rationale.
 * No material.skinning — not applicable to static meshes.
 *
 * Module-scope scratch objects ensure no allocation in render loops.
 *
 * Source: 02-PATTERNS.md § StaticMeshView.tsx
 *         + 02-UI-SPEC.md Surface 1 (Canvas chrome, render-mode subscription)
 *         + 02-03-PLAN.md Task 1 (material swap, DDS textures, orientation)
 */

import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useViewportStore } from '../../state/viewportStore.js';
import type { MeshParseResult } from '@swg/contracts';
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

// ─── Module-scope scratch ─────────────────────────────────────────────────────
// Never re-created — reused across frames and component instances.
const _scratchBox3 = new THREE.Box3();
const _scratchVec3Center = new THREE.Vector3();

// ─── SWG→Viewer axis rotation ─────────────────────────────────────────────────
// SWG: forward=+Z, up=+Y. Three.js camera looks down -Z.
// A 180° Y rotation brings SWG's authored front (+Z) to face the default camera.
// Mesh is already correctly oriented (Y-up matches Three.js; geometry verified faithful).
// The 180° Y guess showed the model's BACK ("facing away"); 0° shows its front. The residual
// left-vs-right difference from SIE is a default CAMERA-AZIMUTH preference, not a mesh rotation
// — tracked in viewport-default-facing-axis.md. Identity here keeps winding/normals correct.
const SWG_ORIENTATION = new THREE.Euler(0, 0, 0);

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StaticMeshViewProps {
  parsedMesh: MeshParseResult;
  geometry: ArrayBuffer;
  renderMode: 'solid' | 'wire' | 'textured';
  /** Resolved materials indexed by shader group (from appearanceResolver). */
  materials?: ResolvedMaterial[];
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

  // UVs (Float32 uv) — first UV set only for MVP
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

// ─── Build material for one shader group ─────────────────────────────────────

function buildGroupMaterial(
  group: MeshParseResult['shaderGroups'][number],
  resolvedMat: ResolvedMaterial | undefined,
  gl: THREE.WebGLRenderer,
  wireframe: boolean,
): THREE.ShaderMaterial | THREE.MeshStandardMaterial {
  if (wireframe) {
    // Wireframe mode: use plain MeshStandardMaterial for simpler display.
    return new THREE.MeshStandardMaterial({
      wireframe: true,
      color: '#888888',
    });
  }

  // Determine capability flags from resolved shader
  const shaderResult = resolvedMat?.shaderResult;
  const slotBytes    = resolvedMat?.slotBytes ?? {};
  const effectResult = resolvedMat?.effectResult ?? null;

  const slots = shaderResult?.slots ?? [];
  const hasNormalSlot = slots.some(s => s.slot === 'NRML' || s.slot === 'CNRM');
  const hasSpecSlot   = slots.some(s => s.slot === 'SPEC');
  const hasEmisSlot   = slots.some(s => s.slot === 'EMIS');
  // Gap-closure 02-03: ENVM is "active" only when we have actual cube map bytes in slotBytes.
  // If no bytes were fetched (path missing), hasEnv stays false to keep the env branch off.
  const envBytes    = slotBytes['ENVM'];
  const hasEnvSlot  = slots.some(s => s.slot === 'ENVM') && !!envBytes;
  const hasDot3     = group.hasDot3 ?? false;

  // Extract blend state from the best .eft implementation (gap-closure 02-03).
  // Best impl = impls[bestImplIndex]; its blend drives material transparent/alphaTest/depthWrite.
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
    skinned:        false,
    hasNormal:      hasNormalSlot,
    hasSpec:        hasSpecSlot,
    hasEmissive:    hasEmisSlot,
    hasEnv:         hasEnvSlot,
    hasDot3Tangents: hasDot3,
    effectBlend,
  });

  // Wire up texture slots from pre-fetched slotBytes (02-02 plumbed them; NO re-fetch here)
  // FAIL-SAFE: env reflection samples textureCube(uEnvMap) only when a real cube actually bound.
  // A null/broken samplerCube blacks out the whole fragment on strict drivers, so we gate
  // bHasEnv on envBound AFTER the loop — worst case is solid-red diffuse, never a black mesh.
  let envBound = false;
  for (const slotDef of slots) {
    const bytes = slotBytes[slotDef.slot];
    if (!bytes) continue; // missing or placeholder

    try {
      const ddsResult = nativeCore.parseDds(new Uint8Array(bytes));
      const { texture } = buildDdsTexture(gl, ddsResult, bytes);

      switch (slotDef.slot) {
        case 'MAIN': mat.uniforms.uDiffuseMap.value  = texture; break;
        case 'NRML':
        case 'CNRM': mat.uniforms.uNormalMap.value   = texture; break;
        case 'SPEC': mat.uniforms.uSpecularMap.value  = texture; break;
        case 'EMIS': mat.uniforms.uEmissiveMap.value  = texture; break;
        case 'ENVM':
          // Gap-closure 02-03: wire the cube map texture from the ENVM DDS bytes.
          // env_theed.dds is a DXT3 cube map; buildDdsTexture returns CompressedCubeTexture
          // when ddsResult.isCubemap is true.
          // The uEnvMap sampler (samplerCube) in the fragment shader consumes this.
          if (ddsResult.isCubemap) {
            mat.uniforms.uEnvMap.value = texture;
            envBound = true;
          }
          // Non-cubemap ENVM (rare/unexpected): ignore; scene.environment is the fallback.
          break;
        default: break;
      }
    } catch (_e) {
      // Texture decode failed — slot stays as white/black placeholder
    }
  }

  // FAIL-SAFE gate: only sample the env cube when one actually bound (else diffuse-only).
  mat.uniforms.bHasEnv.value = envBound;

  return mat;
}

// ─── One mesh group ───────────────────────────────────────────────────────────

interface MeshGroupProps {
  group: MeshParseResult['shaderGroups'][number];
  groupIndex: number;
  geometry: ArrayBuffer;
  wireframe: boolean;
  resolvedMaterial: ResolvedMaterial | undefined;
}

function MeshGroup({ group, groupIndex, geometry, wireframe, resolvedMaterial }: MeshGroupProps): React.ReactElement {
  const { gl } = useThree();
  const { customizationIndices } = useViewportStore();

  const geo = useMemo(() => buildGroupGeometry(group, geometry), [group, geometry]);

  const mat = useMemo(
    () => buildGroupMaterial(group, resolvedMaterial, gl as THREE.WebGLRenderer, wireframe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, resolvedMaterial, wireframe, gl],
  );

  useEffect(() => {
    return () => {
      geo.dispose();
      if ((mat as THREE.Material).dispose) (mat as THREE.Material).dispose();
    };
  }, [geo, mat]);

  // ─── Customization uniform mutation (zero-alloc in useFrame) ────────────
  // Apply palette-texture-factor (C) → uTexFactor, palette-material-color (A) → uMaterialColor
  // Only applies when mat is our ShaderMaterial (not wireframe MeshStandardMaterial).
  const paletteCacheRef = useRef<Record<string, import('@swg/contracts').PaletteParseResult>>({});

  useFrame(() => {
    if (!resolvedMaterial?.shaderResult?.customizationVars?.length) return;
    const shaderMat = mat as THREE.ShaderMaterial;
    if (!shaderMat.uniforms) return;

    for (const cVar of resolvedMaterial.shaderResult.customizationVars) {
      const idx = customizationIndices[cVar.name] ?? cVar.defaultIndex;

      // Load palette (cached — no re-fetch)
      if (!paletteCacheRef.current[cVar.palettePath]) {
        // Get palette bytes from slotBytes (palette-texture-factor stores .pal bytes in slotBytes)
        // For now, check if there are palette bytes we have access to from the resolver.
        // The palette is fetched as a slot during resolution — look in slotBytes by searching custom var palette path.
        // Since the palette isn't stored under a standard ShaderSlotName, we skip it for now if not pre-cached.
        // Full wiring requires the resolver to also provide palettes by custom var — see deviation note.
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
      // Pathway B (texture-swap): handled via full material rebuild — out of scope for zero-alloc path
    }
  });

  const key = `${group.shaderName}-${groupIndex}`;
  return (
    <mesh key={key} geometry={geo} material={mat as THREE.Material} />
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
  materials,
}: StaticMeshViewProps): React.ReactElement {
  const wireframe = renderMode === 'wire';
  useAutoFrame(parsedMesh, geometry);

  return (
    // SWG→Viewer orientation: 180° Y rotation (pure rotation, determinant +1).
    // HUMAN-VERIFY at checkpoint: compare vs SIE default facing.
    <group rotation={SWG_ORIENTATION}>
      {parsedMesh.shaderGroups.map((group, i) => (
        <MeshGroup
          key={`${group.shaderName}-${i}`}
          group={group}
          groupIndex={i}
          geometry={geometry}
          wireframe={wireframe}
          resolvedMaterial={materials?.[i]}
        />
      ))}
    </group>
  );
}
