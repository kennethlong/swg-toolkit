/**
 * packages/renderer/src/panels/viewport/export/exportMaterial.ts
 *
 * toStandardMaterial — convert a SWG custom ShaderMaterial to THREE.MeshStandardMaterial
 * for glTF (.glb) export.
 *
 * WHY THIS CONVERSION IS REQUIRED
 * ─────────────────────────────────
 * THREE.GLTFExporter silently returns null/warns for any THREE.ShaderMaterial — it cannot
 * serialize custom GLSL uniforms. We must convert to a standard PBR material first.
 *
 * THREE.CompressedTexture (DXT1/3/5 GPU-compressed) is also rejected by GLTFExporter.
 * We CPU-decode compressed textures to RGBA8 DataTexture so they export as PNG/embedded data.
 *
 * TEXTURE RULES
 * ─────────────
 *  - diffuseMap (uDiffuseMap):  sRGB colorspace, map
 *  - normalMap  (uNormalMap):   linear colorspace (data map), normalMap
 *  - emissiveMap (uEmissiveMap): sRGB colorspace, emissiveMap
 *  - SWG specular (uSpecularMap): dropped this phase (no standard glTF mapping for SWG gloss)
 *  - envMap (uEnvMap): dropped this phase (cube-map serialization not yet wired)
 *  - All exported textures: flipY = false (glTF UV origin convention)
 *
 * DXT DECOMPRESSION
 * ─────────────────
 * THREE.CompressedTexture.mipmaps[0].data is a Uint8Array sub-view of the raw DDS block data.
 * buildDdsTexture (ddsTexture.ts) creates the Uint8Array with the correct byteOffset from the
 * full DDS file bytes — we can pass (data.buffer, data.byteOffset, data.byteLength) directly
 * to decodeDxt without stripping the header here.
 *
 * Source: swg-client-v2 buildDdsTexture.ts, dxtCpuDecode.ts, swgMaterial.ts (uniform names).
 *         CONSULT-P2-05-AXIOMS.md L7 (ShaderMaterial not serialized).
 */

import * as THREE from 'three';
import { decodeDxt } from '../material/dxtCpuDecode.js';
import type { DxtFormat } from '../material/dxtCpuDecode.js';

// ─── DXT format enum → DxtFormat string ──────────────────────────────────────
// WebGL extension enum values (WEBGL_compressed_texture_s3tc).
const DXT_FORMAT_MAP: ReadonlyMap<number, DxtFormat> = new Map([
  [0x83F0, 'DXT1'],
  [0x83F2, 'DXT3'],
  [0x83F3, 'DXT5'],
]);

// THREE.CompressedTexture mip structure (not exported by @types/three directly)
interface CompressedMip {
  data:   Uint8Array;
  width:  number;
  height: number;
}

// ─── Texture conversion ───────────────────────────────────────────────────────

/**
 * Convert a CompressedTexture (DXT) to a DataTexture via CPU decode.
 * Returns null if the format is unknown or mip data is missing.
 */
function decompressTexture(
  tex: THREE.CompressedTexture,
): THREE.DataTexture | null {
  const fmt = DXT_FORMAT_MAP.get(tex.format);
  if (!fmt) {
    console.warn('[exportMaterial] Unknown CompressedTexture format:', tex.format, '— skipping');
    return null;
  }

  const mip0 = tex.mipmaps[0] as CompressedMip | undefined;
  if (!mip0?.data || mip0.width <= 0 || mip0.height <= 0) {
    console.warn('[exportMaterial] CompressedTexture has no mip0 data — skipping');
    return null;
  }

  let rgba: Uint8Array;
  try {
    // Cast buffer: TypedArray.buffer is ArrayBufferLike which includes SharedArrayBuffer,
    // but decodeDxt requires a plain ArrayBuffer. Mip data is always from a heap buffer.
    rgba = decodeDxt(
      mip0.data.buffer as ArrayBuffer,
      mip0.data.byteOffset,
      mip0.data.byteLength,
      mip0.width,
      mip0.height,
      fmt,
    );
  } catch (e) {
    console.warn('[exportMaterial] decodeDxt failed:', e);
    return null;
  }

  const out = new THREE.DataTexture(rgba, mip0.width, mip0.height, THREE.RGBAFormat);
  // Copy wrapping from source
  out.wrapS = tex.wrapS;
  out.wrapT = tex.wrapT;
  out.needsUpdate = true;
  return out;
}

/**
 * Prepare a texture for glTF export:
 *   - Decompress CompressedTexture → DataTexture
 *   - Set flipY = false (glTF UV origin is top-left; THREE default is bottom-left)
 *   - Set colorSpace
 *
 * Returns null if the input is null/undefined.
 */
function prepareTexture(
  src: THREE.Texture | null | undefined,
  isSRGB: boolean,
): THREE.DataTexture | THREE.Texture | null {
  if (!src) return null;

  let out: THREE.DataTexture | THREE.Texture;

  if (src instanceof THREE.CompressedTexture) {
    const decoded = decompressTexture(src);
    if (!decoded) return null;
    out = decoded;
  } else if (src instanceof THREE.DataTexture) {
    out = src.clone() as THREE.DataTexture;
  } else {
    out = src.clone();
  }

  out.flipY = false; // glTF UV convention: (0,0) = top-left
  out.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  out.needsUpdate = true;
  return out;
}

// ─── Main conversion ─────────────────────────────────────────────────────────

/**
 * Convert a THREE.Material to a THREE.MeshStandardMaterial suitable for glTF export.
 *
 * For SWG custom ShaderMaterials, reads the uniform values for diffuse/normal/emissive
 * and maps them to MeshStandardMaterial slots. SWG specular and env map are dropped.
 *
 * For any other material type, returns a grey MeshStandardMaterial (safe fallback).
 *
 * @param mat  The live scene material (ShaderMaterial or any THREE.Material).
 * @returns    A new MeshStandardMaterial ready for GLTFExporter.
 */
export function toStandardMaterial(mat: THREE.Material): THREE.MeshStandardMaterial {
  if (!(mat instanceof THREE.ShaderMaterial)) {
    // Non-ShaderMaterial (e.g. already MeshStandardMaterial from wireframe mode):
    // return a plain fallback. Do not attempt to re-wrap it.
    return new THREE.MeshStandardMaterial({ color: 0xcccccc });
  }

  const u = mat.uniforms;
  const diffuseTex  = u['uDiffuseMap']?.value  as THREE.Texture | null | undefined;
  const normalTex   = u['uNormalMap']?.value   as THREE.Texture | null | undefined;
  const emissiveTex = u['uEmissiveMap']?.value as THREE.Texture | null | undefined;

  const map        = prepareTexture(diffuseTex,  /* isSRGB */ true);
  const normalMap  = prepareTexture(normalTex,   /* isSRGB */ false);
  const emissiveMap = prepareTexture(emissiveTex, /* isSRGB */ true);

  const stdMat = new THREE.MeshStandardMaterial({
    map:          map ?? undefined,
    normalMap:    normalMap ?? undefined,
    emissive:     emissiveMap ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0),
    emissiveMap:  emissiveMap ?? undefined,
    // SWG specular is a gloss-mask texture; there is no direct glTF PBR equivalent
    // (metalness-roughness workflow). Dropped this phase — deferred to material-fidelity pass.
    roughness: 0.7,
    metalness: 0.0,
  });

  return stdMat;
}
