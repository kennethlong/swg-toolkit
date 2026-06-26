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

// ─── Emissive bake (SWG EMIS.alpha mask self-illuminating the DIFFUSE color) ──
// Live shader (swgMaterial.ts:234-256): emisMask = uEmissiveMap.a; the diffuse color is brightened
// by emisMask. The EMIS RGB is IGNORED. glTF emissive is additive emissiveFactor×emissiveMap, so we
// bake emissiveMap.rgb = diffuse.rgb × emis.a (in linear, re-encoded sRGB), emissiveFactor=[1,1,1].

const _bakeColor = new THREE.Color();

function srgbBytesToLinear(r: number, g: number, b: number): [number, number, number] {
  _bakeColor.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace).convertSRGBToLinear();
  return [_bakeColor.r, _bakeColor.g, _bakeColor.b];
}

function linearToSrgbBytes(r: number, g: number, b: number): [number, number, number] {
  _bakeColor.setRGB(r, g, b).convertLinearToSRGB();
  return [
    Math.round(THREE.MathUtils.clamp(_bakeColor.r, 0, 1) * 255),
    Math.round(THREE.MathUtils.clamp(_bakeColor.g, 0, 1) * 255),
    Math.round(THREE.MathUtils.clamp(_bakeColor.b, 0, 1) * 255),
  ];
}

/** Read a decoded RGBA DataTexture's raw pixels, or null if not pixel-backed. */
function rgbaPixels(tex: THREE.Texture | null): { data: Uint8Array; w: number; h: number } | null {
  const img = tex?.image as { data?: Uint8Array; width?: number; height?: number } | undefined;
  if (!img?.data || !img.width || !img.height) return null;
  return { data: img.data, w: img.width, h: img.height };
}

/** Nearest-texel RGBA sample at UV (top-left origin, clamp). */
function sampleNearest(p: { data: Uint8Array; w: number; h: number }, u: number, v: number): [number, number, number] {
  const x = THREE.MathUtils.clamp(Math.floor(u * p.w), 0, p.w - 1);
  const y = THREE.MathUtils.clamp(Math.floor(v * p.h), 0, p.h - 1);
  const i = (y * p.w + x) * 4;
  return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!];
}

/**
 * Bake a glTF emissive map = diffuse.rgb × emis.alpha (SWG EMIS semantics). Output at the emissive
 * map's resolution (preserves mask detail), sRGB-encoded. Returns null if pixels are unavailable.
 */
function bakeSwgEmissive(diffuse: THREE.Texture, emissive: THREE.Texture): THREE.DataTexture | null {
  const d = rgbaPixels(diffuse);
  const e = rgbaPixels(emissive);
  if (!d || !e) {
    console.warn('[exportMaterial] bakeSwgEmissive: missing pixel data — emissive skipped');
    return null;
  }
  const out = new Uint8Array(e.w * e.h * 4);
  for (let y = 0; y < e.h; y++) {
    const v = (y + 0.5) / e.h;
    for (let x = 0; x < e.w; x++) {
      const u = (x + 0.5) / e.w;
      const a = e.data[(y * e.w + x) * 4 + 3]! / 255; // EMIS mask = alpha
      const [dr, dg, db] = sampleNearest(d, u, v);
      const [lr, lg, lb] = srgbBytesToLinear(dr, dg, db);
      const [sr, sg, sb] = linearToSrgbBytes(lr * a, lg * a, lb * a);
      const o = (y * e.w + x) * 4;
      out[o] = sr; out[o + 1] = sg; out[o + 2] = sb; out[o + 3] = 255;
    }
  }
  const baked = new THREE.DataTexture(out, e.w, e.h, THREE.RGBAFormat);
  baked.wrapS = emissive.wrapS;
  baked.wrapT = emissive.wrapT;
  baked.flipY = false;
  baked.colorSpace = THREE.SRGBColorSpace;
  baked.needsUpdate = true;
  return baked;
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

  // The SWG shader ALWAYS populates uNormalMap / uEmissiveMap — with a 1×1 placeholder (white/black)
  // when the material has no real slot. Reading them unconditionally exports bogus placeholder normals
  // AND full-white emissive on EVERY material (the placeholder is white → emissiveFactor[1,1,1]×white
  // = whole part glows white). Gate on the shader's own bHasNormal / bHasEmissive flags so ONLY real
  // maps survive. This keeps legitimate emissive (e.g. a droid head's glowing eyes) while dropping the
  // bogus body glow — do NOT drop emissive wholesale, that kills the eyes ("cat face").
  const hasNormal   = u['bHasNormal']?.value   === true;
  const hasEmissive = u['bHasEmissive']?.value === true;

  const diffuseTex  = u['uDiffuseMap']?.value as THREE.Texture | null | undefined;
  const normalTex   = hasNormal   ? (u['uNormalMap']?.value   as THREE.Texture | null | undefined) : null;
  const emissiveTex = hasEmissive ? (u['uEmissiveMap']?.value as THREE.Texture | null | undefined) : null;

  const map        = prepareTexture(diffuseTex, /* isSRGB */ true);
  const normalMap  = prepareTexture(normalTex,  /* isSRGB */ false);

  // EMIS = alpha mask self-illuminating the DIFFUSE color (NOT the raw emissive RGB, which is
  // mostly-white and would blow the part to a white blob). Bake diffuse.rgb × emis.a.
  let emissiveMap: THREE.Texture | null = null;
  if (hasEmissive && emissiveTex && map) {
    const emisSrc = prepareTexture(emissiveTex, /* isSRGB */ true);
    if (emisSrc) emissiveMap = bakeSwgEmissive(map, emisSrc);
  }

  const stdMat = new THREE.MeshStandardMaterial({
    map:         map ?? undefined,
    normalMap:   normalMap ?? undefined,
    emissive:    emissiveMap ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0),
    emissiveMap: emissiveMap ?? undefined,
    // SWG specular (gloss mask) + env reflection have no clean glTF-PBR slot — deferred (VIEW-MAT-FIDELITY).
    roughness: 0.7,
    metalness: 0.0,
  });

  return stdMat;
}
