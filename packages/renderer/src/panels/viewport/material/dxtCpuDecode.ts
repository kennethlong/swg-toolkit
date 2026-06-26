/**
 * packages/renderer/src/panels/viewport/material/dxtCpuDecode.ts
 *
 * Real CPU DXT1/DXT2/DXT3/DXT4/DXT5 block decoder → RGBA8 output.
 *
 * This is the genuine fallback path for:
 *   1. DXT2/DXT4 (premultiplied-alpha) — never supported by WEBGL_compressed_texture_s3tc.
 *   2. Any DXT format when WEBGL_compressed_texture_s3tc is absent (e.g. software renderers).
 *
 * Algorithm: standard S3TC 4×4 block layout per Microsoft DDS spec.
 *   - Color block (8 bytes, shared by all DXT variants):
 *       [2] color0_rgb565, [2] color1_rgb565, [4] 2-bit-per-pixel lookup table
 *     If color0 > color1 (as uint16): 4-color mode (DXT1 opaque).
 *     If color0 <= color1 (as uint16): 3-color + 1 transparent mode (DXT1 with alpha).
 *   - DXT1: 8 bytes total (no alpha block).
 *   - DXT2/DXT3: 8-byte explicit alpha block (4 bits/pixel nibbles, NOT premult-corrected) + 8-byte color.
 *   - DXT4/DXT5: 8-byte interpolated alpha block (2 endpoints + 3-bit-per-pixel table) + 8-byte color.
 *
 * DXT2 and DXT4 store premultiplied alpha on disk. We de-premultiply by dividing
 * RGB by (alpha/255) when alpha > 0, saturating to [0, 255].
 *
 * Output: flat Uint8Array of RGBA8 pixels, row-major, top-left origin.
 * Length = width * height * 4.
 *
 * Source: Microsoft DDS spec (block-compression format description).
 *         swg-client-v2 Texture.cpp:487-654 (format dispatch — ground truth for which
 *         DXT variants SWG actually uses).
 */

// ─── RGB565 ───────────────────────────────────────────────────────────────────

function rgb565ToRgb(v: number): [number, number, number] {
  const r = ((v >> 11) & 0x1f) * 255 / 31 | 0;
  const g = ((v >> 5)  & 0x3f) * 255 / 63 | 0;
  const b = (v & 0x1f) * 255 / 31 | 0;
  return [r, g, b];
}

// ─── Interpolated alpha (DXT5/DXT4) ─────────────────────────────────────────

function buildAlpha5Table(a0: number, a1: number): number[] {
  const t: number[] = [a0, a1];
  if (a0 > a1) {
    t.push(((6 * a0 + 1 * a1 + 3) / 7) | 0);
    t.push(((5 * a0 + 2 * a1 + 3) / 7) | 0);
    t.push(((4 * a0 + 3 * a1 + 3) / 7) | 0);
    t.push(((3 * a0 + 4 * a1 + 3) / 7) | 0);
    t.push(((2 * a0 + 5 * a1 + 3) / 7) | 0);
    t.push(((1 * a0 + 6 * a1 + 3) / 7) | 0);
  } else {
    t.push(((4 * a0 + 1 * a1 + 2) / 5) | 0);
    t.push(((3 * a0 + 2 * a1 + 2) / 5) | 0);
    t.push(((2 * a0 + 3 * a1 + 2) / 5) | 0);
    t.push(((1 * a0 + 4 * a1 + 2) / 5) | 0);
    t.push(0);
    t.push(255);
  }
  return t;
}

// ─── Decode one 4×4 color block (shared DXT1/DXT2/DXT3/DXT4/DXT5) ───────────
// Returns 16 entries of [r,g,b] tuples.
function decodeColorBlock(
  src: Uint8Array, offset: number
): Array<[number, number, number, number]> {
  // 2-byte c0, 2-byte c1, 4-byte table
  const c0 = src[offset]! | (src[offset + 1]! << 8);
  const c1 = src[offset + 2]! | (src[offset + 3]! << 8);

  const [r0, g0, b0] = rgb565ToRgb(c0);
  const [r1, g1, b1] = rgb565ToRgb(c1);

  // 4-color palette
  const colors: Array<[number, number, number, number]> = [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 0], // transparent (used in DXT1 1-bit alpha mode when c0<=c1)
  ];

  if (c0 > c1) {
    // 4-color mode (opaque)
    colors[2] = [((2 * r0 + r1) / 3) | 0, ((2 * g0 + g1) / 3) | 0, ((2 * b0 + b1) / 3) | 0, 255];
    colors[3] = [((r0 + 2 * r1) / 3) | 0, ((g0 + 2 * g1) / 3) | 0, ((b0 + 2 * b1) / 3) | 0, 255];
  } else {
    // 3-color + transparent mode
    colors[2] = [((r0 + r1) / 2) | 0, ((g0 + g1) / 2) | 0, ((b0 + b1) / 2) | 0, 255];
    // colors[3] stays [0,0,0,0] = fully transparent
  }

  // 4-byte lookup table: 16 pixels, 2 bits each
  const pixels: Array<[number, number, number, number]> = [];
  for (let row = 0; row < 4; row++) {
    const rowByte = src[offset + 4 + row]!;
    for (let col = 0; col < 4; col++) {
      const idx = (rowByte >> (col * 2)) & 0x3;
      pixels.push(colors[idx]!);
    }
  }
  return pixels;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type DxtFormat = 'DXT1' | 'DXT2' | 'DXT3' | 'DXT4' | 'DXT5';

/**
 * Decode the first mip level of a DXT-compressed texture to RGBA8.
 *
 * @param bytes   Raw DDS file bytes (including the 128-byte DDS header).
 * @param offset  Byte offset within `bytes` where the mip data starts.
 * @param byteLength  Byte length of this mip's compressed data.
 * @param width   Mip width in pixels.
 * @param height  Mip height in pixels.
 * @param format  DXT format tag.
 * @returns Flat Uint8Array of RGBA8 pixels (length = width × height × 4).
 */
export function decodeDxt(
  bytes: ArrayBuffer,
  offset: number,
  byteLength: number,
  width: number,
  height: number,
  format: DxtFormat,
): Uint8Array {
  const src = new Uint8Array(bytes, offset, byteLength);
  const out = new Uint8Array(width * height * 4);

  // Block dimensions
  const blockW = Math.max(1, Math.ceil(width / 4));
  const blockH = Math.max(1, Math.ceil(height / 4));
  const blockBytes = (format === 'DXT1') ? 8 : 16;

  let blockOffset = 0;

  for (let by = 0; by < blockH; by++) {
    for (let bx = 0; bx < blockW; bx++) {
      // Safety: bounds-check the block read (T-02-15)
      if (blockOffset + blockBytes > src.byteLength) break;

      // Alpha channels for this block (16 pixels)
      const alphas: number[] = new Array(16).fill(255);

      let colorOff = blockOffset;

      if (format === 'DXT1') {
        // No alpha block — color block starts at 0.
        colorOff = blockOffset;
      } else if (format === 'DXT3' || format === 'DXT2') {
        // Explicit alpha: 8 bytes of 4-bit nibbles (2 nibbles per byte → each pixel = 4 bits)
        for (let i = 0; i < 8; i++) {
          const b = src[blockOffset + i]!;
          const lo = (b & 0x0f);
          const hi = (b >> 4) & 0x0f;
          alphas[i * 2]     = lo | (lo << 4); // expand 4-bit → 8-bit
          alphas[i * 2 + 1] = hi | (hi << 4);
        }
        colorOff = blockOffset + 8;
      } else {
        // DXT5 / DXT4: interpolated alpha block (8 bytes)
        const a0 = src[blockOffset]!;
        const a1 = src[blockOffset + 1]!;
        const alphaTable = buildAlpha5Table(a0, a1);

        // 6 bytes of 3-bit-per-pixel alpha lookup table (48 bits = 16 pixels × 3 bits)
        // Packed as bytes 2..7, LSB first per pixel, row-major
        let bitBuf = 0;
        let bitCount = 0;
        let byteIdx = 2;
        for (let i = 0; i < 16; i++) {
          while (bitCount < 3 && byteIdx < 8) {
            bitBuf |= (src[blockOffset + byteIdx]!) << bitCount;
            bitCount += 8;
            byteIdx++;
          }
          const idx = bitBuf & 0x7;
          alphas[i] = alphaTable[idx] ?? 0;
          bitBuf >>= 3;
          bitCount -= 3;
        }
        colorOff = blockOffset + 8;
      }

      // Decode color block (always 8 bytes, starting at colorOff).
      // colorOff is already a 0-based index INTO `src` (which is new Uint8Array(bytes, offset, …)),
      // so it must NOT be offset-adjusted again. The old `colorOff - offset` read color blocks
      // ~offset bytes too early whenever offset != 0 (the exporter + S3TC-absent fallback both pass
      // a nonzero DDS mip offset), garbling color while alpha stayed correct → scrambled textures.
      const colorPixels = decodeColorBlock(src, colorOff);

      // Write the 4×4 block into the output image
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const ix = bx * 4 + px;
          const iy = by * 4 + py;
          if (ix >= width || iy >= height) continue;

          const pi = py * 4 + px;
          const [r, g, b, colorAlpha] = colorPixels[pi] ?? [0, 0, 0, 255];
          const a = (format === 'DXT1') ? colorAlpha : (alphas[pi] ?? 255);

          const outIdx = (iy * width + ix) * 4;
          if (format === 'DXT2' || format === 'DXT4') {
            // De-premultiply: stored as premultiplied ARGB
            if (a > 0) {
              out[outIdx]     = Math.min(255, (r * 255 / a)) | 0;
              out[outIdx + 1] = Math.min(255, (g * 255 / a)) | 0;
              out[outIdx + 2] = Math.min(255, (b * 255 / a)) | 0;
            } else {
              out[outIdx]     = 0;
              out[outIdx + 1] = 0;
              out[outIdx + 2] = 0;
            }
            out[outIdx + 3] = a;
          } else {
            out[outIdx]     = r;
            out[outIdx + 1] = g;
            out[outIdx + 2] = b;
            out[outIdx + 3] = a;
          }
        }
      }

      blockOffset += blockBytes;
    }
  }

  return out;
}
