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
    // Empty/degenerate DDS — return 1×1 magenta placeholder
    return {
      texture: makeMagenta1x1(),
      cpuDecoded: true,
      formatLabel: `unknown · ${dds.width}×${dds.height} · 0 mips`,
    };
  }

  const formatStr = dds.format;
  const formatLabel = `${formatStr} · ${dds.width}×${dds.height} · ${dds.mipCount} mips`;

  // ─── GPU path: S3TC + DXT1/3/5 ──────────────────────────────────────────
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

  // ─── CPU decode fallback ─────────────────────────────────────────────────
  // Used for: DXT2/DXT4 (premultiplied-alpha, never in S3TC) OR S3TC absent.
  if (!s3tc) {
    // Warn once — read store state outside the render loop to avoid subscription
    const store = useViewportStore.getState();
    store.setS3tcWarning('WEBGL_compressed_texture_s3tc unavailable — using CPU decode');
  }

  const supported = ['DXT1', 'DXT2', 'DXT3', 'DXT4', 'DXT5'];
  if (!supported.includes(formatStr)) {
    // RGBA8 or unknown — can't CPU-decode DXT; return magenta
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
