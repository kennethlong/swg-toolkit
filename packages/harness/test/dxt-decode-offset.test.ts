/**
 * packages/harness/test/dxt-decode-offset.test.ts
 *
 * Regression test for the DXT CPU-decode byteOffset bug (CONSULT-P2-05B, Codex angle).
 *
 * dxtCpuDecode.decodeDxt builds `src = new Uint8Array(bytes, offset, byteLength)` (offset-relative),
 * so the color sub-block index (`colorOff`) is ALREADY 0-based within `src`. The buggy line passed
 * `colorOff - offset` to decodeColorBlock, which reads color blocks ~offset bytes too early whenever
 * offset != 0 — garbling color (alpha stayed correct). The live S3TC GPU path bypasses CPU decode, and
 * the only callers that hit it (the S3TC-absent fallback AND the glTF exporter, exportMaterial.ts:79)
 * pass a NONZERO offset (the DDS mip offset, ~128) → scrambled exported textures (the "cat face").
 *
 * This test pins offset-invariance: the same block must decode identically at offset 0 and offset 128.
 */

import { describe, test, expect } from 'vitest';
import { decodeDxt } from '../../renderer/src/panels/viewport/material/dxtCpuDecode.js';

/** Synthetic 4×4 DXT5 block: 8-byte alpha block + 8-byte color block, all texels = color0 (red). */
function makeDxt5RedBlock(): Uint8Array {
  const b = new Uint8Array(16);
  // Alpha block: a0=200, a1=50, all 3-bit indices = 0 → alpha = a0 = 200.
  b[0] = 200; b[1] = 50; // b[2..7] = 0
  // Color block: c0 = 0xF800 (RGB565 red), c1 = 0x001F (blue), little-endian; all indices 0 → color0.
  b[8] = 0x00; b[9] = 0xF8;   // c0 = 0xF800 (red)
  b[10] = 0x1F; b[11] = 0x00; // c1 = 0x001F (blue)
  // b[12..15] = 0 → every texel uses palette index 0 (red)
  return b;
}

describe('decodeDxt — byteOffset invariance (export scramble regression)', () => {
  const block = makeDxt5RedBlock();

  test('decodes the same color at offset 0 and offset 128', () => {
    const buf0 = new ArrayBuffer(16);
    new Uint8Array(buf0).set(block);
    const rgba0 = decodeDxt(buf0, 0, 16, 4, 4, 'DXT5');

    // Mimic a DDS mip living after the 128-byte header (what the live CompressedTexture + exporter pass).
    const buf128 = new ArrayBuffer(128 + 16);
    new Uint8Array(buf128, 128, 16).set(block);
    const rgba128 = decodeDxt(buf128, 128, 16, 4, 4, 'DXT5');

    // Color must be the red endpoint (proves the color block was actually read, not zeroed to black).
    expect(rgba0[0]).toBe(255); // R
    expect(rgba0[1]).toBe(0);   // G
    expect(rgba0[2]).toBe(0);   // B

    // The decode must NOT depend on where the block sits in the buffer.
    expect(Array.from(rgba128)).toEqual(Array.from(rgba0));
  });
});
