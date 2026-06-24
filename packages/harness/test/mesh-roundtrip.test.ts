/**
 * mesh-roundtrip.test.ts — CORE-05 byte-exact round-trip tests for Phase-2 format parsers.
 *
 * Covers all six format parsers added in Plan 02-01:
 *   - FORM MESH  (.msh)  — generic-IFF pair: parseIff + serializeIff
 *   - FORM MLOD  (.lmg)  — generic-IFF pair: parseIff + serializeIff
 *   - FORM LDTB  (.ldt)  — generic-IFF pair: parseIff + serializeIff
 *   - FORM SSHT  (.sht)  — generic-IFF pair: parseIff + serializeIff
 *   - RIFF PAL   (.pal)  — PARSER-NATIVE pair: parsePalette → roundTripBytes
 *   - DDS        (.dds)  — PARSER-NATIVE pair: parseDds    → roundTripBytes
 *
 * Round-trip types:
 *   generic-IFF:    parseIff(bytes) → serializeIff(result, bytes) → bytes (lossless re-emit)
 *   PARSER-NATIVE:  parseFmt(bytes) → result.roundTripBytes       → bytes (serializer identity)
 *
 * Fixtures:
 *   Real assets (gitignored, extracted from client TREs):
 *     fixtures-real/mesh/arc170_body_l2.msh   — FORM MESH v0005, 2 shader groups, 61340 bytes
 *     fixtures-real/mesh/path_arrow.msh        — FORM MESH v0005, 1 shader group,  2109 bytes
 *     fixtures-real/mesh/apron_s01_f.lmg       — FORM MLOD v0000, 4 levels,         266 bytes
 *     fixtures-real/shader/2d_distort.sht      — FORM SSHT v0004, 2 texture slots,  707 bytes
 *     fixtures-real/texture/128gray_n.dds      — DXT5 128x128 8 mips,             22000 bytes
 *   Synthetic (hand-crafted to match byte-exact oracle layout):
 *     fixtures-real/palette/synthetic_2color.pal — RIFF PAL, 2 entries, 32 bytes
 *     fixtures-real/lod/synthetic_2level.ldt     — FORM LDTB v0000, 2 levels, 50 bytes
 *
 * Format ground truth (source files verified before implementing):
 *   Mesh:    swg-client-v2 MeshAppearanceTemplate.cpp + ShaderPrimitiveSetTemplate.cpp + VertexBuffer.cpp
 *   MeshLod: swg-client-v2 LodMeshGeneratorTemplate.cpp:210-254
 *   LodDT:   swg-client-v2 LodDistanceTable.cpp:140-175
 *   Shader:  swg-client-v2 StaticShaderTemplate.cpp:671-810
 *   Palette: swg-client-v2 PaletteArgb.cpp:450-607
 *   Dds:     swg-client-v2 Dds.h + Texture.cpp:487-654
 *
 * Binary-stays-binary rule: geometry crosses as ArrayBuffer, never JSON.
 * IFF tag byte-order rule: structural FORM/chunk headers = big-endian; DATA payload tags = little-endian.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// CJS require — .node addon is CJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  parseIff: (bytes: ArrayBuffer | Uint8Array) => unknown;
  serializeIff: (result: unknown, srcBytes: ArrayBuffer | Uint8Array) => ArrayBuffer;
  parseMesh: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => MeshResult;
  parseMeshLod: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => MeshLodResult;
  parseLodDistanceTable: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => LodDistanceTableResult;
  parseShader: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => ShaderResult;
  parsePalette: (bytes: ArrayBuffer | Uint8Array) => PaletteResult;
  parseDds: (bytes: ArrayBuffer | Uint8Array) => DdsResult;
};

// ─── Return type stubs (structural, not exhaustive) ────────────────────────────

interface AttributeSlice {
  offset: number;
  byteLength: number;
  componentCount: number;
  elementCount: number;
}

interface ShaderGroup {
  shaderName: string;
  vertexCount: number;
  indexCount: number;
  positions: AttributeSlice;
  normals: AttributeSlice;
  uvs: AttributeSlice;
  indices: AttributeSlice;
  skinIndices: AttributeSlice;
  skinWeights: AttributeSlice;
  hasDot3: boolean;
}

interface MeshResult {
  formatTag: string;
  version: string;
  shaderGroups: ShaderGroup[];
  geometry: ArrayBuffer;
  weightsTruncated: number;
}

interface LodLevel { path: string; }
interface MeshLodResult {
  formatTag: string;
  version: string;
  levelCount: number;
  levels: LodLevel[];
}

interface LodDistanceLevel { minDist: number; maxDist: number; }
interface LodDistanceTableResult {
  formatTag: string;
  version: string;
  levelCount: number;
  levels: LodDistanceLevel[];
}

interface ShaderSlot {
  slotTag: string;
  texturePath: string;
  uvSet: number;
  isPlaceholder: boolean;
}

interface ShaderResult {
  variant: string;
  version: string;
  effectPath: string;
  slots: ShaderSlot[];
  customizationVars: unknown[];
}

interface PaletteEntry { r: number; g: number; b: number; a: number; }
interface PaletteResult {
  entryCount: number;
  versionOrComponentCount: number;
  entries: PaletteEntry[];
  roundTripBytes: ArrayBuffer;
}

interface DdsMip { offset: number; byteLength: number; width: number; height: number; }
interface DdsResult {
  width: number;
  height: number;
  mipCount: number;
  format: string;
  mips: DdsMip[];
  roundTripBytes: ArrayBuffer;
}

// ─── Fixture helpers ────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL = join(__dirname, '..', 'fixtures-real');

/**
 * Load a fixture file as a Uint8Array. Returns null if the file doesn't exist.
 * Real fixtures are gitignored; tests gracefully skip when absent.
 */
function loadFixture(relPath: string): Uint8Array | null {
  const fullPath = join(REAL, relPath);
  if (!existsSync(fullPath)) return null;
  const buf = readFileSync(fullPath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Assert byte-exact equality between expected and actual Uint8Arrays.
 * On failure: reports length mismatch or first differing offset with hex window.
 */
function assertBytesEqual(expected: Uint8Array, actual: Uint8Array, label: string): void {
  if (expected.length !== actual.length) {
    throw new Error(
      `${label}: length mismatch — expected ${expected.length} bytes, got ${actual.length} bytes`,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) {
      const start = Math.max(0, i - 8);
      const end = Math.min(expected.length, i + 8);
      const expHex = Array.from(expected.slice(start, end))
        .map((b) => b.toString(16).padStart(2, '0')).join(' ');
      const actHex = Array.from(actual.slice(start, end))
        .map((b) => b.toString(16).padStart(2, '0')).join(' ');
      throw new Error(
        `${label}: byte mismatch @ 0x${i.toString(16).toUpperCase().padStart(4, '0')}\n` +
        `  expected[0x${start.toString(16)}]: ${expHex}\n` +
        `  actual  [0x${start.toString(16)}]: ${actHex}`,
      );
    }
  }
}

// ─── Generic-IFF round-trip helper ────────────────────────────────────────────

/**
 * Assert parse→serialize IFF round-trip is byte-exact.
 * Uses the generic parseIff/serializeIff pair — no format knowledge needed.
 */
function assertIffRoundTrip(bytes: Uint8Array, label: string): void {
  const iffResult = nativeCore.parseIff(bytes);
  const rtAb = nativeCore.serializeIff(iffResult, bytes);
  assertBytesEqual(bytes, new Uint8Array(rtAb), label);
}

// ─── FORM MESH (.msh) ─────────────────────────────────────────────────────────

describe('FORM MESH (.msh) — static mesh', () => {
  it('generic-IFF round-trip: arc170_body_l2.msh (61340 bytes)', () => {
    const bytes = loadFixture('mesh/arc170_body_l2.msh');
    if (!bytes) {
      console.log('  SKIP: arc170_body_l2.msh not present (real fixture)');
      return;
    }
    assertIffRoundTrip(bytes, 'arc170_body_l2.msh IFF');
  });

  it('generic-IFF round-trip: path_arrow.msh (2109 bytes)', () => {
    const bytes = loadFixture('mesh/path_arrow.msh');
    if (!bytes) {
      console.log('  SKIP: path_arrow.msh not present (real fixture)');
      return;
    }
    assertIffRoundTrip(bytes, 'path_arrow.msh IFF');
  });

  it('parseMesh: arc170_body_l2.msh — formatTag=MESH, version=0005, 2 shader groups', () => {
    const bytes = loadFixture('mesh/arc170_body_l2.msh');
    if (!bytes) {
      console.log('  SKIP: arc170_body_l2.msh not present');
      return;
    }
    const iff = nativeCore.parseIff(bytes);
    const result = nativeCore.parseMesh(iff, bytes);

    expect(result.formatTag).toBe('MESH');
    expect(result.version).toBe('0005');
    expect(result.shaderGroups.length).toBe(2);
    expect(result.geometry.byteLength).toBeGreaterThan(0);
    expect(result.weightsTruncated).toBe(0);

    // Verify shader group structure
    const grp0 = result.shaderGroups[0];
    expect(grp0.shaderName).toContain('.sht');
    expect(grp0.vertexCount).toBeGreaterThan(0);
    expect(grp0.indexCount).toBeGreaterThan(0);
    // Positions slice must be non-empty (3 floats per vertex)
    expect(grp0.positions.elementCount).toBe(grp0.vertexCount);
    expect(grp0.positions.componentCount).toBe(3);
    // Indices slice must be Uint32 (4 bytes each) — binary stays binary
    expect(grp0.indices.elementCount).toBe(grp0.indexCount);
    expect(grp0.indices.componentCount).toBe(1);
    // geometry ArrayBuffer must cover the reported slice
    const sliceEnd = grp0.positions.offset + grp0.positions.byteLength;
    expect(result.geometry.byteLength).toBeGreaterThanOrEqual(sliceEnd);
  });

  it('parseMesh: path_arrow.msh — 1 shader group, vertices non-zero', () => {
    const bytes = loadFixture('mesh/path_arrow.msh');
    if (!bytes) {
      console.log('  SKIP: path_arrow.msh not present');
      return;
    }
    const iff = nativeCore.parseIff(bytes);
    const result = nativeCore.parseMesh(iff, bytes);

    expect(result.formatTag).toBe('MESH');
    expect(result.version).toBe('0005');
    expect(result.shaderGroups.length).toBe(1);
    expect(result.shaderGroups[0].vertexCount).toBeGreaterThan(0);
  });

  it('geometry ArrayBuffer: binary contract (not empty, ArrayBuffer type)', () => {
    const bytes = loadFixture('mesh/arc170_body_l2.msh');
    if (!bytes) {
      console.log('  SKIP: arc170_body_l2.msh not present');
      return;
    }
    const iff = nativeCore.parseIff(bytes);
    const result = nativeCore.parseMesh(iff, bytes);
    // geometry must cross as ArrayBuffer (binary-stays-binary rule)
    expect(result.geometry).toBeInstanceOf(ArrayBuffer);
    expect(result.geometry.byteLength).toBeGreaterThan(0);
  });
});

// ─── FORM MLOD (.lmg) ─────────────────────────────────────────────────────────

describe('FORM MLOD (.lmg) — LOD mesh generator', () => {
  it('generic-IFF round-trip: apron_s01_f.lmg (266 bytes)', () => {
    const bytes = loadFixture('mesh/apron_s01_f.lmg');
    if (!bytes) {
      console.log('  SKIP: apron_s01_f.lmg not present (real fixture)');
      return;
    }
    assertIffRoundTrip(bytes, 'apron_s01_f.lmg IFF');
  });

  it('parseMeshLod: apron_s01_f.lmg — formatTag=MLOD, levelCount=4', () => {
    const bytes = loadFixture('mesh/apron_s01_f.lmg');
    if (!bytes) {
      console.log('  SKIP: apron_s01_f.lmg not present');
      return;
    }
    const iff = nativeCore.parseIff(bytes);
    const result = nativeCore.parseMeshLod(iff, bytes);

    expect(result.formatTag).toBe('MLOD');
    expect(result.version).toBe('0000');
    expect(result.levelCount).toBe(4);
    expect(result.levels).toHaveLength(4);
    // Each level has a path string (could be .msh or .mgn)
    for (const level of result.levels) {
      expect(typeof level.path).toBe('string');
      expect(level.path.length).toBeGreaterThan(0);
    }
  });
});

// ─── FORM LDTB (.ldt) — synthetic fixture ────────────────────────────────────

describe('FORM LDTB (.ldt) — LOD distance table', () => {
  it('generic-IFF round-trip: synthetic_2level.ldt (50 bytes)', () => {
    // Synthetic fixture — always present (committed with tests)
    const bytes = loadFixture('lod/synthetic_2level.ldt');
    if (!bytes) {
      throw new Error('synthetic_2level.ldt is missing — fixture should be committed');
    }
    assertIffRoundTrip(bytes, 'synthetic_2level.ldt IFF');
  });

  it('parseLodDistanceTable: synthetic_2level.ldt — formatTag=LDTB, levelCount=2', () => {
    const bytes = loadFixture('lod/synthetic_2level.ldt');
    if (!bytes) {
      throw new Error('synthetic_2level.ldt is missing');
    }
    const iff = nativeCore.parseIff(bytes);
    const result = nativeCore.parseLodDistanceTable(iff, bytes);

    expect(result.formatTag).toBe('LDTB');
    expect(result.version).toBe('0000');
    expect(result.levelCount).toBe(2);
    expect(result.levels).toHaveLength(2);
    // Distances stored as-read (not pre-squared), unit floats
    expect(result.levels[0].minDist).toBeCloseTo(0.0, 3);
    expect(result.levels[0].maxDist).toBeCloseTo(50.0, 3);
    expect(result.levels[1].minDist).toBeCloseTo(50.0, 3);
    expect(result.levels[1].maxDist).toBeCloseTo(150.0, 3);
  });
});

// ─── FORM SSHT (.sht) ─────────────────────────────────────────────────────────

describe('FORM SSHT (.sht) — static shader template', () => {
  it('generic-IFF round-trip: 2d_distort.sht (707 bytes)', () => {
    const bytes = loadFixture('shader/2d_distort.sht');
    if (!bytes) {
      console.log('  SKIP: 2d_distort.sht not present (real fixture)');
      return;
    }
    assertIffRoundTrip(bytes, '2d_distort.sht IFF');
  });

  it('parseShader: 2d_distort.sht — variant=SSHT, >=2 texture slots', () => {
    const bytes = loadFixture('shader/2d_distort.sht');
    if (!bytes) {
      console.log('  SKIP: 2d_distort.sht not present');
      return;
    }
    const iff = nativeCore.parseIff(bytes);
    const result = nativeCore.parseShader(iff, bytes);

    expect(result.variant).toBe('SSHT');
    expect(typeof result.version).toBe('string');
    // 2d_distort.sht has MAIN and NOIS texture slots (verified from real file)
    expect(result.slots.length).toBeGreaterThanOrEqual(2);

    const mainSlot = result.slots.find((s) => s.slotTag === 'MAIN');
    const noisSlot = result.slots.find((s) => s.slotTag === 'NOIS');
    expect(mainSlot).toBeDefined();
    expect(noisSlot).toBeDefined();
    // Both are placeholder in 2d_distort.sht (no texture path)
    expect(mainSlot!.isPlaceholder).toBe(true);
    expect(noisSlot!.isPlaceholder).toBe(true);
  });

  it('parseShader: slot tag byte-order: slotTag is ASCII (not reversed)', () => {
    // Key regression: initial implementation used readU32BE() for DATA payload tags,
    // producing "NIAM" instead of "MAIN". After fix to readU32LE() this is correct.
    // Source: sharedFoundation/Tag.h insertChunkData = raw memcpy (LE) on Windows.
    const bytes = loadFixture('shader/2d_distort.sht');
    if (!bytes) return;
    const iff = nativeCore.parseIff(bytes);
    const result = nativeCore.parseShader(iff, bytes);
    for (const slot of result.slots) {
      // Tags must be printable ASCII in correct order (not reversed/garbage)
      expect(slot.slotTag).toMatch(/^[A-Z0-9 ]+$/);
      // Specifically should NOT be reversed
      expect(slot.slotTag).not.toBe('NIAM');
      expect(slot.slotTag).not.toBe('SION');
    }
  });
});

// ─── RIFF PAL (.pal) — synthetic fixture ──────────────────────────────────────

describe('RIFF PAL (.pal) — palette ARGB', () => {
  it('PARSER-NATIVE round-trip: synthetic_2color.pal (32 bytes)', () => {
    // Synthetic fixture — always present (committed with tests)
    const bytes = loadFixture('palette/synthetic_2color.pal');
    if (!bytes) {
      throw new Error('synthetic_2color.pal is missing — fixture should be committed');
    }
    const result = nativeCore.parsePalette(bytes);
    const rtBytes = new Uint8Array(result.roundTripBytes);
    assertBytesEqual(bytes, rtBytes, 'synthetic_2color.pal PARSER-NATIVE');
  });

  it('parsePalette: synthetic_2color.pal — 2 entries, vComp=3, alpha forced to 255', () => {
    const bytes = loadFixture('palette/synthetic_2color.pal');
    if (!bytes) throw new Error('synthetic_2color.pal is missing');
    const result = nativeCore.parsePalette(bytes);

    expect(result.entryCount).toBe(2);
    // versionOrComponentCount=3 → alpha forced to 255 (engine rule: only 4 = RGBA with alpha)
    expect(result.versionOrComponentCount).toBe(3);
    expect(result.entries).toHaveLength(2);

    // Entry 0: red (255, 0, 0, 255)
    expect(result.entries[0].r).toBe(255);
    expect(result.entries[0].g).toBe(0);
    expect(result.entries[0].b).toBe(0);
    expect(result.entries[0].a).toBe(255);

    // Entry 1: green (0, 255, 0, 255)
    expect(result.entries[1].r).toBe(0);
    expect(result.entries[1].g).toBe(255);
    expect(result.entries[1].b).toBe(0);
    expect(result.entries[1].a).toBe(255);
  });

  it('parsePalette: roundTripBytes is ArrayBuffer (binary-stays-binary)', () => {
    const bytes = loadFixture('palette/synthetic_2color.pal');
    if (!bytes) throw new Error('synthetic_2color.pal is missing');
    const result = nativeCore.parsePalette(bytes);
    expect(result.roundTripBytes).toBeInstanceOf(ArrayBuffer);
    expect(result.roundTripBytes.byteLength).toBe(32);
  });
});

// ─── Microsoft DDS (.dds) ─────────────────────────────────────────────────────

describe('Microsoft DDS (.dds) — texture', () => {
  it('PARSER-NATIVE round-trip: 128gray_n.dds (22000 bytes)', () => {
    const bytes = loadFixture('texture/128gray_n.dds');
    if (!bytes) {
      console.log('  SKIP: 128gray_n.dds not present (real fixture)');
      return;
    }
    const result = nativeCore.parseDds(bytes);
    const rtBytes = new Uint8Array(result.roundTripBytes);
    assertBytesEqual(bytes, rtBytes, '128gray_n.dds PARSER-NATIVE');
  });

  it('parseDds: 128gray_n.dds — DXT5 128x128, 8 mips', () => {
    const bytes = loadFixture('texture/128gray_n.dds');
    if (!bytes) {
      console.log('  SKIP: 128gray_n.dds not present');
      return;
    }
    const result = nativeCore.parseDds(bytes);

    expect(result.format).toBe('DXT5');
    expect(result.width).toBe(128);
    expect(result.height).toBe(128);
    expect(result.mipCount).toBe(8);
    expect(result.mips).toHaveLength(8);

    // Mip[0] starts at offset 128 (after 4-byte magic + 124-byte DDS_HEADER)
    expect(result.mips[0].offset).toBe(128);
    expect(result.mips[0].width).toBe(128);
    expect(result.mips[0].height).toBe(128);
    // DXT5 = 16 bytes per 4x4 block; ceil(128/4)*ceil(128/4)*16 = 32*32*16 = 16384
    expect(result.mips[0].byteLength).toBe(16384);

    // Mip[1]: 64x64 DXT5 = 16*16*16 = 4096
    expect(result.mips[1].width).toBe(64);
    expect(result.mips[1].height).toBe(64);
    expect(result.mips[1].byteLength).toBe(4096);
  });

  it('parseDds: roundTripBytes is ArrayBuffer (binary-stays-binary)', () => {
    const bytes = loadFixture('texture/128gray_n.dds');
    if (!bytes) {
      console.log('  SKIP: 128gray_n.dds not present');
      return;
    }
    const result = nativeCore.parseDds(bytes);
    expect(result.roundTripBytes).toBeInstanceOf(ArrayBuffer);
    expect(result.roundTripBytes.byteLength).toBe(22000);
  });
});
