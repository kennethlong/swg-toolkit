/**
 * packages/renderer/src/panels/viewport/material/ddsTexture.ts
 *
 * buildDdsTexture — Convert a DdsParseResult + raw DDS bytes into a Three.js Texture.
 *
 * Two paths:
 *   A. S3TC present AND format ∈ {DXT1, DXT3, DXT5}:
 *      → THREE.CompressedTexture from block data (GPU-compressed upload, zero CPU decode).
 *      S3TC format enums:
 *        DXT1 → COMPRESSED_RGB_S3TC_DXT1_EXT   (0x83F0)
 *        DXT3 → COMPRESSED_RGBA_S3TC_DXT3_EXT  (0x83F2)
 *        DXT5 → COMPRESSED_RGBA_S3TC_DXT5_EXT  (0x83F3)
 *
 *   B. DXT2/DXT4 OR S3TC absent:
 *      → CPU-decode mip 0 via decodeDxt → THREE.DataTexture (RGBA8).
 *      Call viewportStore.getState().setS3tcWarning() once if S3TC is absent.
 *
 * Security (T-02-12): format enum validated against allowed whitelist before
 * mapping to a WEBGL constant. DXT2/DXT4 are never passed to the driver.
 *
 * Security (T-02-15): DdsParseResult.mips[i].byteLength validated by parseDds
 * (02-01 C++ parser). decodeDxt also bounds-checks blocks against slice length.
 *
 * Source: Microsoft DDS spec + Three.js r0.184.0 CompressedTexture API.
 *         WEBGL_compressed_texture_s3tc extension enums from WebGL spec.
 *         synthesis §2 (S3TC path + CPU-decode fallback decision).
 */

import * as THREE from 'three';
import type { DdsParseResult } from '@swg/contracts';
import { decodeDxt } from './dxtCpuDecode.js';
import { useViewportStore } from '../../../state/viewportStore.js';

// ─── S3TC WebGL extension enum values (constant — do not change) ─────────────
// Cast to THREE.CompressedPixelFormat to satisfy Three.js CompressedTexture constructor.

const COMPRESSED_RGB_S3TC_DXT1_EXT  = 0x83F0 as THREE.CompressedPixelFormat;
const COMPRESSED_RGBA_S3TC_DXT3_EXT = 0x83F2 as THREE.CompressedPixelFormat;
const COMPRESSED_RGBA_S3TC_DXT5_EXT = 0x83F3 as THREE.CompressedPixelFormat;

// Allowed formats for GPU upload (T-02-12 whitelist)
type S3tcFormat = 'DXT1' | 'DXT3' | 'DXT5';
const S3TC_FORMATS: ReadonlySet<string> = new Set(['DXT1', 'DXT3', 'DXT5']);

function toS3tcEnum(format: S3tcFormat): THREE.CompressedPixelFormat {
  switch (format) {
    case 'DXT1': return COMPRESSED_RGB_S3TC_DXT1_EXT;
    case 'DXT3': return COMPRESSED_RGBA_S3TC_DXT3_EXT;
    case 'DXT5': return COMPRESSED_RGBA_S3TC_DXT5_EXT;
  }
}

// ─── S3TC extension availability check (cached per context) ─────────────────

let s3tcAvailable: boolean | null = null; // null = unchecked

function checkS3tc(renderer: THREE.WebGLRenderer): boolean {
  if (s3tcAvailable !== null) return s3tcAvailable;
  // Access the underlying WebGL context via the renderer
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_compressed_texture_s3tc');
  s3tcAvailable = ext !== null;
  return s3tcAvailable;
}

// ─── Result type ─────────────────────────────────────────────────────────────

export interface BuildDdsTextureResult {
  texture: THREE.Texture;
  /** True when the texture was decoded on the CPU (S3TC absent or DXT2/4). */
  cpuDecoded: boolean;
  /** Format string for MaterialInspector display ("DXT5 · 512×512 · 9 mips") */
  formatLabel: string;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a Three.js Texture from parsed DDS data.
 *
 * Handles both 2D textures and cube maps (isCubemap flag from parseDds).
 * For cube maps (e.g. env_theed.dds): builds a THREE.CubeTexture (with S3TC GPU upload
 * per face) or a plain CubeTexture decoded on the CPU.
 *
 * @param renderer  Three.js WebGLRenderer (from useThree().gl).
 * @param dds       Parse result from the native parseDds binding.
 * @param bytes     Raw DDS file bytes (full ArrayBuffer including 128-byte header).
 * @returns         { texture, cpuDecoded, formatLabel }
 */
export function buildDdsTexture(
  renderer: THREE.WebGLRenderer,
  dds: DdsParseResult,
  bytes: ArrayBuffer,
): BuildDdsTextureResult {
  const mip0 = dds.mips[0];
  if (!mip0) {
    return {
      texture: makeMagenta1x1(),
      cpuDecoded: true,
      formatLabel: `unknown · ${dds.width}×${dds.height} · 0 mips`,
    };
  }

  const formatStr = dds.format;
  const formatLabel = `${formatStr} · ${dds.width}×${dds.height} · ${dds.mipCount} mips${dds.isCubemap ? ' [cube]' : ''}`;

  // ─── Cube map path ───────────────────────────────────────────────────────
  // env_theed.dds is a 128×128 DXT3 cube map (6 faces, caps2=0x200).
  // Ground truth: The 6 face images are stored in face-major order in the DDS data.
  // For each face, mips[face * mipCount + 0] gives the base level data.
  // We build a CompressedCubeTexture or fall back to a decoded CubeTexture.
  if (dds.isCubemap) {
    return buildCubeTexture(renderer, dds, bytes, formatStr, formatLabel);
  }

  // ─── 2D GPU path: S3TC + DXT1/3/5 ───────────────────────────────────────
  const s3tc = checkS3tc(renderer);
  if (s3tc && S3TC_FORMATS.has(formatStr)) {
    const gpuFormat = formatStr as S3tcFormat;
    const glFormat = toS3tcEnum(gpuFormat);

    const mipmaps = dds.mips.map(m => ({
      data: new Uint8Array(bytes, m.offset, m.byteLength),
      width: m.width,
      height: m.height,
    }));

    const tex = new THREE.CompressedTexture(
      mipmaps,
      dds.width,
      dds.height,
      glFormat,
    );
    tex.minFilter = dds.mipCount > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;

    return { texture: tex, cpuDecoded: false, formatLabel };
  }

  // ─── 2D uncompressed 32-bit path (RGBA8) — e.g. normal maps ────────────────
  // SWG ships normal/lookup maps as uncompressed 32-bit DDS. There was NO path for this:
  // they fell through to makeMagenta1x1(), so every uncompressed normal map rendered as a
  // 1×1 magenta texel → a constant bogus tangent normal (1,-1,1) → the distance-dependent
  // face artifacts. Fix: upload the real pixels, mipmapped, so they don't alias when minified.
  //
  // Byte order: D3D9 A8R8G8B8 stores BGRA on disk (verified: flat-normal Z is in byte[0]).
  // THREE RGBAFormat expects byte0=R, so swap B<->R. GPU-generated mips (generateMipmaps) +
  // trilinear + anisotropy give clean minification (the normal map is mostly flat so box-filter
  // mips are fine). All SWG uncompressed textures are A8R8G8B8 — if an A8B8G8R8 file ever appears
  // it would need mask-based handling (parser would have to expose the channel masks).
  if (formatStr === 'RGBA8') {
    const src = new Uint8Array(bytes, mip0.offset, mip0.byteLength);
    const rgba = new Uint8Array(src.length);
    for (let i = 0; i + 3 < src.length; i += 4) {
      rgba[i]     = src[i + 2]!; // R <- B
      rgba[i + 1] = src[i + 1]!; // G
      rgba[i + 2] = src[i]!;     // B <- R
      rgba[i + 3] = src[i + 3]!; // A
    }
    const tex = new THREE.DataTexture(rgba, dds.width, dds.height, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true; // GPU box-filter mip chain (NPOT ok in WebGL2)
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return { texture: tex, cpuDecoded: true, formatLabel };
  }

  // ─── CPU decode fallback ─────────────────────────────────────────────────
  if (!s3tc) {
    const store = useViewportStore.getState();
    store.setS3tcWarning('WEBGL_compressed_texture_s3tc unavailable — using CPU decode');
  }

  const supported = ['DXT1', 'DXT2', 'DXT3', 'DXT4', 'DXT5'];
  if (!supported.includes(formatStr)) {
    return {
      texture: makeMagenta1x1(),
      cpuDecoded: true,
      formatLabel,
    };
  }

  const rgba8 = decodeDxt(
    bytes,
    mip0.offset,
    mip0.byteLength,
    dds.width,
    dds.height,
    formatStr as 'DXT1' | 'DXT2' | 'DXT3' | 'DXT4' | 'DXT5',
  );

  const tex = new THREE.DataTexture(rgba8, dds.width, dds.height, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;

  return { texture: tex, cpuDecoded: true, formatLabel };
}

// ─── Cube map builder ─────────────────────────────────────────────────────────

/**
 * Build a THREE.CompressedCubeTexture (or CPU-decoded CubeTexture) from a cube map DDS.
 *
 * DDS cube map face order (+X, -X, +Y, -Y, +Z, -Z) matches THREE.CubeReflectionMapping.
 * For S3TC GPU path: each face gets its own CompressedTexture via mipmaps.
 * For CPU path: decode face 0 base mip per face → CubeTexture from DataTextures.
 *
 * Source: Microsoft DDS spec (face-major layout)
 *   + Three.js CubeTexture / CompressedCubeTexture API (r184).
 */
function buildCubeTexture(
  renderer: THREE.WebGLRenderer,
  dds: DdsParseResult,
  bytes: ArrayBuffer,
  formatStr: string,
  formatLabel: string,
): BuildDdsTextureResult {
  const mipCount = dds.mipCount;
  const s3tc = checkS3tc(renderer);

  if (s3tc && S3TC_FORMATS.has(formatStr)) {
    const glFormat = toS3tcEnum(formatStr as S3tcFormat);

    // Build per-face compressed mipmaps array (6 faces)
    // Three.js CompressedCubeTexture expects mipmaps as an array of 6 mipmaps arrays.
    // Each element is an array of { data, width, height } per mip level.
    const facesMipmaps: THREE.CompressedTextureMipmap[][] = [];
    for (let face = 0; face < 6; face++) {
      const faceMips: THREE.CompressedTextureMipmap[] = [];
      for (let level = 0; level < mipCount; level++) {
        const mipEntry = dds.mips[face * mipCount + level];
        if (!mipEntry) continue;
        faceMips.push({
          data: new Uint8Array(bytes, mipEntry.offset, mipEntry.byteLength),
          width:  mipEntry.width,
          height: mipEntry.height,
        });
      }
      facesMipmaps.push(faceMips);
    }

    // THREE.CompressedCubeTexture: constructor(images, format, type?)
    // images = array of 6 { data, width, height } for base mip (Three.js handles the rest)
    // Use the first mip of each face as the images array.
    // Three.js r0.184 reads cubeImage[i].mipmaps per face (WebGLTextures.js:1461) and uploads
    // every compressed level via compressedTexImage2D. Passing flat base-mip stubs (no .mipmaps)
    // uploads NO texels → incomplete cube → textureCube() blacks the whole fragment.
    // Cross-AI verified: Cursor cited THREE source; Opus byte-verified the per-face mip slicing.
    const faces = facesMipmaps.map(faceMips => ({
      mipmaps: faceMips,
      width:  dds.width,
      height: dds.height,
      format: glFormat,
    }));

    const cubeTexture = new THREE.CompressedCubeTexture(
      faces as unknown as THREE.CompressedTextureMipmap[],
      glFormat,
    );
    cubeTexture.minFilter = mipCount > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    cubeTexture.magFilter = THREE.LinearFilter;
    cubeTexture.wrapS = THREE.ClampToEdgeWrapping;
    cubeTexture.wrapT = THREE.ClampToEdgeWrapping;
    cubeTexture.colorSpace = THREE.NoColorSpace;
    cubeTexture.generateMipmaps = false;
    cubeTexture.needsUpdate = true;

    return { texture: cubeTexture, cpuDecoded: false, formatLabel };
  }

  // CPU fallback: decode each face's base mip → 6 DataTextures → CubeTexture
  if (!s3tc) {
    const store = useViewportStore.getState();
    store.setS3tcWarning('WEBGL_compressed_texture_s3tc unavailable — using CPU decode');
  }

  const dxtFormats = ['DXT1', 'DXT2', 'DXT3', 'DXT4', 'DXT5'];
  if (!dxtFormats.includes(formatStr)) {
    return { texture: makeMagenta1x1(), cpuDecoded: true, formatLabel };
  }

  // Decode each face's base mip into RGBA8 and build CubeTexture
  const faceDataTextures: THREE.DataTexture[] = [];
  for (let face = 0; face < 6; face++) {
    const baseMip = dds.mips[face * mipCount];
    if (!baseMip) {
      faceDataTextures.push(makeMagenta1x1());
      continue;
    }
    const rgba8 = decodeDxt(
      bytes,
      baseMip.offset,
      baseMip.byteLength,
      dds.width,
      dds.height,
      formatStr as 'DXT1' | 'DXT2' | 'DXT3' | 'DXT4' | 'DXT5',
    );
    const faceTex = new THREE.DataTexture(rgba8, dds.width, dds.height, THREE.RGBAFormat);
    faceTex.needsUpdate = true;
    faceDataTextures.push(faceTex);
  }

  // Pass DataTexture objects DIRECTLY — Three.js r0.184 detects data cubes via
  // image[0].isDataTexture (WebGLTextures.js:1418) and uploads each face's .image.
  // Unwrapping to a plain {data,width,height} breaks that detection → broken upload → black.
  // (Cross-AI verified vs THREE source.)
  const cubeTexture = new THREE.CubeTexture(faceDataTextures as unknown as HTMLImageElement[]);
  cubeTexture.format = THREE.RGBAFormat;
  cubeTexture.minFilter = THREE.LinearFilter;
  cubeTexture.magFilter = THREE.LinearFilter;
  cubeTexture.generateMipmaps = false;
  cubeTexture.needsUpdate = true;

  return { texture: cubeTexture, cpuDecoded: true, formatLabel };
}

// ─── 1×1 magenta fallback texture ─────────────────────────────────────────────

function makeMagenta1x1(): THREE.DataTexture {
  const data = new Uint8Array([255, 0, 255, 255]); // RGBA magenta
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Make a 1×1 white placeholder texture for uniforms with no DDS data.
 */
export function makeWhite1x1(): THREE.DataTexture {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}
