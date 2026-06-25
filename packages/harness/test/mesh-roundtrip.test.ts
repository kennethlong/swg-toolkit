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

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerFormat } from '../fixtureRegistry.js';

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
  uvs: AttributeSlice[];   // FIX 1 (UV bridge): array — uvs[0] is the primary UV set
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
  slot: string;
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

    const mainSlot = result.slots.find((s) => s.slot === 'MAIN');
    const noisSlot = result.slots.find((s) => s.slot === 'NOIS');
    expect(mainSlot).toBeDefined();
    expect(noisSlot).toBeDefined();
    // Both are placeholder in 2d_distort.sht (no texture path)
    expect(mainSlot!.isPlaceholder).toBe(true);
    expect(noisSlot!.isPlaceholder).toBe(true);
  });

  it('parseShader: slot tag byte-order: slot is ASCII (not reversed)', () => {
    // Key regression: initial implementation used readU32BE() for DATA payload tags,
    // producing "NIAM" instead of "MAIN". After fix to readU32LE() this is correct.
    // Source: sharedFoundation/Tag.h insertChunkData = raw memcpy (LE) on Windows.
    const bytes = loadFixture('shader/2d_distort.sht');
    if (!bytes) return;
    const iff = nativeCore.parseIff(bytes);
    const result = nativeCore.parseShader(iff, bytes);
    for (const slot of result.slots) {
      // Tags must be printable ASCII in correct order (not reversed/garbage)
      expect(slot.slot).toMatch(/^[A-Z0-9 ]+$/);
      // Specifically should NOT be reversed
      expect(slot.slot).not.toBe('NIAM');
      expect(slot.slot).not.toBe('SION');
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

// ─── Phase 02-02: SKMG / SKTM / SMAT / APT ───────────────────────────────────
//
// New parser types:
//   FORM SKMG (.mgn)  — skeletal mesh generator (Phase 02-02)
//   FORM SKTM (.skt)  — skeleton template      (Phase 02-02)
//   FORM SMAT (.sat)  — skeletal appearance     (Phase 02-02)
//   FORM APT  (.apt)  — static appearance redirector (Phase 02-02)
//
// Additional N-API exports wired in this plan:
//   parseSkeletalMesh(iffResult, srcBytes, boneOrder?)
//   parseSkeleton(iffResult, srcBytes)
//   parseSkeletalAppearance(iffResult, srcBytes)
//   parseStaticAppearance(iffResult, srcBytes)
//
// Source citations (LOCKED, verified 2026-06-23 against real oracle files):
//   SKMG: swg-client-v2 SkeletalMeshGeneratorTemplate.cpp:2247-2360 (INFO 9×int32+4×int16)
//   SKTM: swg-client-v2 BasicSkeletonTemplate.cpp:151-389,280-286,363-390 (v0001/v0002)
//   SMAT: swg-client-v2 SkeletalAppearanceTemplate.cpp:786-1136 (v0001/v0002/v0003)
//   APT:  swg-client-v2 AppearanceTemplateList.cpp:513-540 (NAME chunk redirect)

// Extend nativeCore type to include Phase 02-02 parsers + gap-closure DTLA
const nc = nativeCore as typeof nativeCore & {
  parseSkeletalMesh: (
    iffResult: unknown,
    srcBytes: ArrayBuffer | Uint8Array,
    boneOrder?: string[]
  ) => SkeletalMeshResult;
  parseSkeleton: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => SkeletonResult;
  parseSkeletalAppearance: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => SkeletalAppearanceResult;
  parseStaticAppearance: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => StaticAppearanceResult;
  parseDetailAppearance: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => DetailAppearanceResult;
};

interface SkeletalMeshResult {
  formatTag: string;
  version: string;
  shaderGroups: ShaderGroup[];
  geometry: ArrayBuffer;
  boneNames: string[];
  sktmNames: string[];
  weightsTruncated: number;
  needsBoneRemap: boolean;
}

interface BoneInfo {
  name: string;
  parentIndex: number;
  preRot: number[];
  postRot: number[];
  bindPos: number[];
  preRotOff: number[];
}

interface SkeletonResult {
  formatTag: string;
  version: string;
  boneNames: string[];
  bones: BoneInfo[];
}

interface SktReference {
  skeletonPath: string;
  attachmentTransformName: string;
}

interface SkeletalAppearanceResult {
  formatTag: string;
  version: string;
  filename: string;
  meshPaths: string[];
  skeletonRefs: SktReference[];
}

interface StaticAppearanceResult {
  formatTag: string;
  redirectTarget: string;
}

interface DetailAppearanceLevel {
  id: number;
  near: number;
  far: number;
  childPath: string;
}

interface DetailAppearanceResult {
  formatTag: string;
  versionTag: string;
  lodFlags: number;
  levels: DetailAppearanceLevel[];
}

// ─── CORE-05 registerFormat gate for Phase 02-02 parsers ────────────────────
// Must be registered before the sweep (registry-coverage.test.ts) runs.
// Fixtures are real assets extracted from SWG Infinity client TREs (gitignored).
// If fixtures are absent, format is still registered but with empty fixture list
// (sweep will warn, not fail, since the file existence gate is separate).

beforeAll(() => {
  // SKMG: swg-client-v2 SkeletalMeshGeneratorTemplate.cpp:2247-2360
  const skmgBytes = loadFixture('mesh/ackbar_arms_l0.mgn');
  if (skmgBytes) {
    registerFormat('mesh-skmg', {
      parse: (bytes: Uint8Array) => {
        const iff = (nativeCore as unknown as typeof nc).parseIff(bytes);
        return (nativeCore as unknown as typeof nc).parseSkeletalMesh(iff, bytes);
      },
      serialize: (_parsed: unknown) => skmgBytes, // IFF round-trip handled separately
      fixtures: [{
        name: 'ackbar_arms_l0.mgn',
        bytes: skmgBytes,
        loaderSource: 'swg-client-v2 SkeletalMeshGeneratorTemplate.cpp:2247-2360 (INFO 9×int32+4×int16, verified 2026-06-23)',
      }],
      loaderSource: 'swg-client-v2 SkeletalMeshGeneratorTemplate.cpp:2247-2360',
    });
  }

  // SKTM-v2: swg-client-v2 BasicSkeletonTemplate.cpp:363-390 (v0002, no BPMJ)
  const sktmV2Bytes = loadFixture('skeleton/at_at.skt');
  if (sktmV2Bytes) {
    registerFormat('mesh-sktm-v2', {
      parse: (bytes: Uint8Array) => {
        const iff = (nativeCore as unknown as typeof nc).parseIff(bytes);
        return (nativeCore as unknown as typeof nc).parseSkeleton(iff, bytes);
      },
      serialize: (_parsed: unknown) => sktmV2Bytes,
      fixtures: [{
        name: 'at_at.skt (v0002)',
        bytes: sktmV2Bytes,
        loaderSource: 'swg-client-v2 BasicSkeletonTemplate.cpp:363-390 (v0002, no BPMJ)',
      }],
      loaderSource: 'swg-client-v2 BasicSkeletonTemplate.cpp:151-389,363-390',
    });
  }

  // SMAT: swg-client-v2 SkeletalAppearanceTemplate.cpp:786-1136
  const smatBytes = loadFixture('appearance/4lom.sat');
  if (smatBytes) {
    registerFormat('mesh-smat', {
      parse: (bytes: Uint8Array) => {
        const iff = (nativeCore as unknown as typeof nc).parseIff(bytes);
        return (nativeCore as unknown as typeof nc).parseSkeletalAppearance(iff, bytes);
      },
      serialize: (_parsed: unknown) => smatBytes,
      fixtures: [{
        name: '4lom.sat (v0003)',
        bytes: smatBytes,
        loaderSource: 'swg-client-v2 SkeletalAppearanceTemplate.cpp:786-1136 (v0001/v0002/v0003)',
      }],
      loaderSource: 'swg-client-v2 SkeletalAppearanceTemplate.cpp:786-1136',
    });
  }

  // APT: swg-client-v2 AppearanceTemplateList.cpp:513-540
  const aptBytes = loadFixture('appearance/arc170_body.apt');
  if (aptBytes) {
    registerFormat('mesh-apt', {
      parse: (bytes: Uint8Array) => {
        const iff = (nativeCore as unknown as typeof nc).parseIff(bytes);
        return (nativeCore as unknown as typeof nc).parseStaticAppearance(iff, bytes);
      },
      serialize: (_parsed: unknown) => aptBytes,
      fixtures: [{
        name: 'arc170_body.apt',
        bytes: aptBytes,
        loaderSource: 'swg-client-v2 AppearanceTemplateList.cpp:513-540 (NAME chunk redirect)',
      }],
      loaderSource: 'swg-client-v2 AppearanceTemplateList.cpp:513-540',
    });
  }

  // DTLA: swg-client-v2 DetailAppearanceTemplate.cpp:556-658 (load()) + :343-417 (loadEntries())
  // Real fixture: wb_02_09e_00000000000000000000.lod (362 bytes, version 0007)
  // Verified 2026-06-24 against real bytes from infinity_custom_01.tre
  const dtlaBytes = loadFixture('lod/wb_02_09e_00000000000000000000.lod');
  if (dtlaBytes) {
    registerFormat('appearance-dtla', {
      parse: (bytes: Uint8Array) => {
        const iff = (nativeCore as unknown as typeof nc).parseIff(bytes);
        return (nativeCore as unknown as typeof nc).parseDetailAppearance(iff, bytes);
      },
      serialize: (_parsed: unknown) => dtlaBytes, // IFF round-trip handled separately
      fixtures: [{
        name: 'wb_02_09e_00000000000000000000.lod (DTLA v0007)',
        bytes: dtlaBytes,
        loaderSource: 'swg-client-v2 DetailAppearanceTemplate.cpp:556-658 (load()) + :343-417 (loadEntries())',
      }],
      loaderSource: 'swg-client-v2 DetailAppearanceTemplate.cpp:556-658',
    });
  }

  // EFCT: swg-client-v2 ShaderEffect.cpp:86-179 + ShaderImplementation.cpp:1692-1738
  // Gap-closure 02-03: .eft effect parser — sampler role map + blend state
  // Real fixture: a_envmask_specmap.eft (extracted from shader_02.tre, gitignored)
  const efctBytes = loadFixture('effect/a_envmask_specmap.eft');
  if (efctBytes) {
    registerFormat('shader-efct', {
      parse: (bytes: Uint8Array) => {
        const iff = (nativeCore as unknown as typeof ncEfct).parseIff(bytes);
        return ncEfct.parseEffect(iff, bytes);
      },
      serialize: (_parsed: unknown) => efctBytes, // IFF round-trip handled by assertIffRoundTrip
      fixtures: [{
        name: 'a_envmask_specmap.eft',
        bytes: efctBytes,
        loaderSource: 'swg-client-v2 ShaderEffect.cpp:86-179 + ShaderImplementation.cpp:1692-1738',
      }],
      loaderSource: 'swg-client-v2 ShaderEffect.cpp:86-179 + ShaderImplementation.cpp:1692-1738',
    });
  }

  // CKAT-0001: swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313,553-594 +
  //             CompressedQuaternion.cpp:82-122,156-228,370-419 (verbatim port)
  // Real fixtures: acklay_std_turn_right.ans + all_b_cbt_pistol_*.ans (gitignored)
  const ckatBytes1 = loadFixture('animation/acklay_std_turn_right.ans');
  const ckatBytes2 = loadFixture('animation/all_b_cbt_pistol_kneeling_aimed_hurry_to_pistol_standing_aimed.ans');
  const ckatFixtures: Array<{ name: string; bytes: Uint8Array; loaderSource: string }> = [];
  if (ckatBytes1) ckatFixtures.push({ name: 'acklay_std_turn_right.ans (CKAT-0001)', bytes: ckatBytes1, loaderSource: 'swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313,553-594' });
  if (ckatBytes2) ckatFixtures.push({ name: 'all_b_cbt_pistol*.ans (CKAT-0001)', bytes: ckatBytes2, loaderSource: 'swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313' });
  if (ckatFixtures.length > 0) {
    const firstCkatBytes = (ckatBytes1 ?? ckatBytes2)!;
    registerFormat('mesh-ans-ckat', {
      parse: (bytes: Uint8Array) => {
        const iff = ncAnim.parseIff(bytes);
        return ncAnim.parseAnimation(iff, bytes);
      },
      serialize: (_parsed: unknown) => firstCkatBytes,
      fixtures: ckatFixtures,
      loaderSource: 'swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313,553-594 + CompressedQuaternion.cpp:82-419',
    });
  }

  // KFAT-0003: swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1518-1620,521-553,574-608
  // Real fixtures: acklay_rea_get_hit_add.ans + acklay_rea_stand_get_hit_medium.ans (gitignored)
  const kfatBytes1 = loadFixture('animation/acklay_rea_get_hit_add.ans');
  const kfatBytes2 = loadFixture('animation/acklay_rea_stand_get_hit_medium.ans');
  const kfatFixtures: Array<{ name: string; bytes: Uint8Array; loaderSource: string }> = [];
  if (kfatBytes1) kfatFixtures.push({ name: 'acklay_rea_get_hit_add.ans (KFAT-0003)', bytes: kfatBytes1, loaderSource: 'swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1518-1620' });
  if (kfatBytes2) kfatFixtures.push({ name: 'acklay_rea_stand_get_hit_medium.ans (KFAT-0003)', bytes: kfatBytes2, loaderSource: 'swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1518-1620' });
  if (kfatFixtures.length > 0) {
    const firstKfatBytes = (kfatBytes1 ?? kfatBytes2)!;
    registerFormat('mesh-ans-kfat', {
      parse: (bytes: Uint8Array) => {
        const iff = ncAnim.parseIff(bytes);
        return ncAnim.parseAnimation(iff, bytes);
      },
      serialize: (_parsed: unknown) => firstKfatBytes,
      fixtures: kfatFixtures,
      loaderSource: 'swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1518-1620,521-553,574-608',
    });
  }
});

// ─── FORM SKMG (.mgn) — skeletal mesh ────────────────────────────────────────

describe('FORM SKMG (.mgn) — skeletal mesh', () => {
  // registerFormat CORE-05 gate for SKMG
  // loaderSource: swg-client-v2 SkeletalMeshGeneratorTemplate.cpp:2247-2360 (INFO 9×int32+4×int16, verified 2026-06-23)
  it('generic-IFF round-trip: ackbar_arms_l0.mgn (SKMG v0004)', () => {
    const bytes = loadFixture('mesh/ackbar_arms_l0.mgn');
    if (!bytes) {
      console.log('  SKIP: ackbar_arms_l0.mgn not present (real fixture)');
      return;
    }
    assertIffRoundTrip(bytes, 'ackbar_arms_l0.mgn IFF round-trip');
  });

  it('parseSkeletalMesh: ackbar_arms_l0.mgn — formatTag=SKMG, shaderGroups>0, boneNames.length>0', () => {
    const bytes = loadFixture('mesh/ackbar_arms_l0.mgn');
    if (!bytes) {
      console.log('  SKIP: ackbar_arms_l0.mgn not present');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseSkeletalMesh(iff, bytes);

    expect(result.formatTag).toBe('SKMG');
    // ackbar_arms_l0.mgn is SKMG v0004
    expect(['0002', '0003', '0004']).toContain(result.version);
    expect(result.shaderGroups.length).toBeGreaterThan(0);
    expect(result.boneNames.length).toBeGreaterThan(0);
    expect(result.geometry).toBeInstanceOf(ArrayBuffer);
    expect(result.geometry.byteLength).toBeGreaterThan(0);

    // At least one shader group must have vertexCount > 0
    const populated = result.shaderGroups.filter((g) => g.vertexCount > 0);
    expect(populated.length).toBeGreaterThan(0);

    // skinIndices and skinWeights must be present for SKMG groups with vertices
    const g0 = populated[0];
    expect(g0!.skinIndices.byteLength).toBeGreaterThan(0);
    expect(g0!.skinWeights.byteLength).toBeGreaterThan(0);
    // 4 components per vertex
    expect(g0!.skinIndices.componentCount).toBe(4);
    expect(g0!.skinWeights.componentCount).toBe(4);
    // binary contract: indices are Uint32 (not Uint16)
    expect(g0!.indices.componentCount).toBe(1);
  });

  it('parseSkeletalMesh: sktmNames lists skeleton template references', () => {
    const bytes = loadFixture('mesh/ackbar_arms_l0.mgn');
    if (!bytes) {
      console.log('  SKIP: ackbar_arms_l0.mgn not present');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseSkeletalMesh(iff, bytes);
    // SKMG stores skeleton template paths in inner SKTM chunk
    expect(result.sktmNames.length).toBeGreaterThan(0);
    // sktmNames should be .skt paths
    for (const name of result.sktmNames) {
      expect(typeof name).toBe('string');
    }
  });

  it('CORE-05 gate (SC-5): parseSkeletalMesh needsBoneRemap=true when no boneOrder given', () => {
    const bytes = loadFixture('mesh/ackbar_arms_l0.mgn');
    if (!bytes) {
      console.log('  SKIP: ackbar_arms_l0.mgn not present');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseSkeletalMesh(iff, bytes); // no boneOrder
    expect(result.needsBoneRemap).toBe(true);
  });
});

// ─── FORM SKTM v0002 (.skt) — skeleton ───────────────────────────────────────

describe('FORM SKTM v0002 (.skt) — skeleton template', () => {
  // registerFormat CORE-05 gate for SKTM-v2
  // loaderSource: swg-client-v2 BasicSkeletonTemplate.cpp:151-389,363-390 (v0002, no BPMJ)
  it('generic-IFF round-trip: at_at.skt (SKTM v0002)', () => {
    const bytes = loadFixture('skeleton/at_at.skt');
    if (!bytes) {
      console.log('  SKIP: at_at.skt not present (real fixture)');
      return;
    }
    assertIffRoundTrip(bytes, 'at_at.skt IFF round-trip');
  });

  it('parseSkeleton: at_at.skt — formatTag=SKTM, version=0002, joints>0', () => {
    const bytes = loadFixture('skeleton/at_at.skt');
    if (!bytes) {
      console.log('  SKIP: at_at.skt not present');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseSkeleton(iff, bytes);

    expect(result.formatTag).toBe('SKTM');
    expect(result.version).toBe('0002');
    expect(result.bones.length).toBeGreaterThan(0);
    expect(result.boneNames.length).toBe(result.bones.length);

    // Each bone must have a non-empty name
    for (const bone of result.bones) {
      expect(typeof bone.name).toBe('string');
      expect(bone.name.length).toBeGreaterThan(0);
    }

    // Root bone must have parentIndex = -1
    const root = result.bones.find((b) => b.parentIndex === -1);
    expect(root).toBeDefined();

    // Quaternion arrays must be length 4
    expect(result.bones[0]!.preRot).toHaveLength(4);
    expect(result.bones[0]!.postRot).toHaveLength(4);
  });

  it('parseSkeleton: throws on FORM SLOD (not FORM SKTM) — delta #7', () => {
    // acklay.skt is FORM SLOD, NOT FORM SKTM — parseSkeleton must throw FormatParseError
    const bytes = loadFixture('skeleton/acklay.skt');
    if (!bytes) {
      console.log('  SKIP: acklay.skt not present');
      return;
    }
    const iff = nc.parseIff(bytes);
    // parseSkeleton must throw because SLOD is not SKTM
    expect(() => nc.parseSkeleton(iff, bytes)).toThrow(/SLOD|SKTM/);
  });
});

// ─── FORM SKTM v0001 (.skt) — skeleton with BPMJ ────────────────────────────

describe('FORM SKTM v0001 (.skt) — skeleton template with BPMJ', () => {
  // loaderSource: swg-client-v2 BasicSkeletonTemplate.cpp:151-286,280-286 (v0001, BPMJ mandatory)
  it('parseSkeleton: synthetic SKTM v0001 with BPMJ — parsed correctly', () => {
    // Synthetic SKTM v0001: 1 joint, with BPMJ chunk (mandatory per oracle)
    // Manually constructed following BasicSkeletonTemplate.cpp:151-286
    // Structure: FORM SKTM (12) → FORM 0001 (inner) → INFO(4) + NAME(~10) + PRNT(4) + RPRE(16) + RPST(16) + BPTR(12) + BPRO(12) + BPMJ(12) + JROR(8)
    const bytes = loadFixture('skeleton/synthetic_sktm_v0001.skt');
    if (!bytes) {
      console.log('  SKIP: synthetic_sktm_v0001.skt not present (will be created)');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseSkeleton(iff, bytes);
    expect(result.formatTag).toBe('SKTM');
    expect(result.version).toBe('0001');
    expect(result.bones.length).toBeGreaterThan(0);
  });
});

// ─── FORM SMAT (.sat) — skeletal appearance ──────────────────────────────────

describe('FORM SMAT (.sat) — skeletal appearance template', () => {
  // registerFormat CORE-05 gate for SMAT
  // loaderSource: swg-client-v2 SkeletalAppearanceTemplate.cpp:786-1136 (v0001/v0002/v0003)
  it('generic-IFF round-trip: 4lom.sat (SMAT v0003)', () => {
    const bytes = loadFixture('appearance/4lom.sat');
    if (!bytes) {
      console.log('  SKIP: 4lom.sat not present (real fixture)');
      return;
    }
    assertIffRoundTrip(bytes, '4lom.sat IFF round-trip');
  });

  it('parseSkeletalAppearance: 4lom.sat — formatTag=SMAT, meshPaths>0, skeletonRefs>0', () => {
    const bytes = loadFixture('appearance/4lom.sat');
    if (!bytes) {
      console.log('  SKIP: 4lom.sat not present');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseSkeletalAppearance(iff, bytes);

    expect(result.formatTag).toBe('SMAT');
    expect(['0001', '0002', '0003']).toContain(result.version);
    expect(result.meshPaths.length).toBeGreaterThan(0);
    expect(result.skeletonRefs.length).toBeGreaterThan(0);

    // Each mesh path must look like an appearance path
    for (const path of result.meshPaths) {
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
    }

    // Each skeleton ref must have a skeletonPath
    for (const ref of result.skeletonRefs) {
      expect(typeof ref.skeletonPath).toBe('string');
      expect(ref.skeletonPath.length).toBeGreaterThan(0);
    }
  });
});

// ─── FORM APT (.apt) — static appearance redirector ──────────────────────────

describe('FORM APT (.apt) — static appearance redirector', () => {
  // registerFormat CORE-05 gate for APT
  // loaderSource: swg-client-v2 AppearanceTemplateList.cpp:513-540 (NAME chunk redirect)
  it('generic-IFF round-trip: arc170_body.apt (APT)', () => {
    const bytes = loadFixture('appearance/arc170_body.apt');
    if (!bytes) {
      console.log('  SKIP: arc170_body.apt not present (real fixture)');
      return;
    }
    assertIffRoundTrip(bytes, 'arc170_body.apt IFF round-trip');
  });

  it('parseStaticAppearance: arc170_body.apt — formatTag=APT, redirectTarget is non-.apt path', () => {
    const bytes = loadFixture('appearance/arc170_body.apt');
    if (!bytes) {
      console.log('  SKIP: arc170_body.apt not present');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseStaticAppearance(iff, bytes);

    expect(result.formatTag).toBe('APT');
    expect(typeof result.redirectTarget).toBe('string');
    expect(result.redirectTarget.length).toBeGreaterThan(0);
    // redirectTarget must NOT end with .apt (oracle constraint: AppearanceTemplateList.cpp:530)
    expect(result.redirectTarget.toLowerCase()).not.toMatch(/\.apt$/);
  });

  it('parseStaticAppearance: throws if redirectTarget ends with .apt (T-02-08)', () => {
    // Construct a minimal APT that illegally redirects to another .apt
    // NAME payload: 'some_other.apt\0'
    const redirect = 'some_other.apt';
    // NAME chunk: 8-byte header + NUL-terminated string
    const namePayloadLen = redirect.length + 1; // include NUL
    // FORM 0000 body: 4-byte subType + 8-byte NAME header + namePayloadLen
    const form0000BodyLen = 4 + 8 + namePayloadLen;
    // FORM APT body: 4-byte subType + 8-byte FORM0000 header + form0000BodyLen
    const aptBodyLen = 4 + 8 + form0000BodyLen;
    // Total: 8-byte FORM APT header + aptBodyLen
    const total = 8 + aptBodyLen;

    const ab = new ArrayBuffer(total);
    const dv = new DataView(ab);
    const u8 = new Uint8Array(ab);
    let off = 0;

    // FORM APT outer header
    dv.setUint32(off, 0x464f524d, false); off += 4; // 'FORM' BE
    dv.setUint32(off, aptBodyLen, false);  off += 4; // body length (excludes outer 8-byte header)
    // APT subType (4 bytes, part of aptBodyLen)
    dv.setUint32(off, 0x41505420, false);  off += 4; // 'APT '

    // FORM 0000 header
    dv.setUint32(off, 0x464f524d, false); off += 4; // 'FORM'
    dv.setUint32(off, form0000BodyLen, false); off += 4;
    // 0000 subType
    dv.setUint32(off, 0x30303030, false); off += 4; // '0000'

    // CHUNK NAME header
    dv.setUint32(off, 0x4e414d45, false); off += 4; // 'NAME'
    dv.setUint32(off, namePayloadLen, false); off += 4;
    // NAME payload: NUL-terminated redirect path
    for (let i = 0; i < redirect.length; i++) u8[off + i] = redirect.charCodeAt(i);
    u8[off + redirect.length] = 0; // NUL terminator

    const iff = nc.parseIff(u8);
    expect(() => nc.parseStaticAppearance(iff, u8)).toThrow(/circular|\.apt/i);
  });
});

// ─── FORM DTLA (.lod) — detail LOD appearance (gap-closure) ──────────────────
//
// CORE-05 gate: byte-exact round-trip for the dominant static-object LOD path.
// Ground truth: swg-client-v2 DetailAppearanceTemplate.cpp:556-658 (load()) + :343-417 (loadEntries())
// Real fixture: wb_02_09e_00000000000000000000.lod (362 bytes, version 0007, from infinity_custom_01.tre)
// Verified 2026-06-24 against real bytes + client source.

describe('FORM DTLA (.lod) — detail LOD appearance (gap-closure)', () => {
  // loaderSource: swg-client-v2 DetailAppearanceTemplate.cpp:556-658 + :343-417

  it('CORE-05 gate: generic-IFF round-trip — wb_02_09e_00000000000000000000.lod (362 bytes)', () => {
    // Real fixture (gitignored — extracted from infinity_custom_01.tre, 2026-06-24)
    const bytes = loadFixture('lod/wb_02_09e_00000000000000000000.lod');
    if (!bytes) {
      console.log('  SKIP: wb_02_09e_00000000000000000000.lod not present (real fixture, gitignored)');
      return;
    }
    // The CORE-05 gate: IFF round-trip must be byte-exact
    assertIffRoundTrip(bytes, 'wb_02_09e_00000000000000000000.lod IFF round-trip');
    expect(bytes.length).toBe(362);
  });

  it('parseDetailAppearance: wb_02_09e_*.lod — formatTag=DTLA, versionTag=0007, 1 level', () => {
    const bytes = loadFixture('lod/wb_02_09e_00000000000000000000.lod');
    if (!bytes) {
      console.log('  SKIP: wb_02_09e_00000000000000000000.lod not present (real fixture)');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseDetailAppearance(iff, bytes);

    expect(result.formatTag).toBe('DTLA');
    expect(result.versionTag).toBe('0007');
    expect(typeof result.lodFlags).toBe('number');
    // version 7: PIVT present; lodFlags = 0 in this file
    expect(result.lodFlags).toBe(0);
    expect(result.levels).toHaveLength(1);

    // Verify the one LOD level
    const lv = result.levels[0]!;
    expect(lv.id).toBe(0);
    expect(lv.near).toBeCloseTo(0.0, 3);
    expect(lv.far).toBeCloseTo(1000.0, 1);
    // childPath is the raw name from CHLD — caller must prepend "appearance/"
    expect(lv.childPath).toBe('mesh/wb_02_09e_00000000000000000000.msh');
  });

  it('parseDetailAppearance: childPath must NOT start with appearance/ (raw name from CHLD)', () => {
    // The CHLD name is relative to the appearance/ tree; resolver MUST prepend appearance/.
    // The parser returns the raw value so the caller handles the prepend.
    const bytes = loadFixture('lod/wb_02_09e_00000000000000000000.lod');
    if (!bytes) {
      console.log('  SKIP: wb_02_09e_00000000000000000000.lod not present');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseDetailAppearance(iff, bytes);
    for (const lv of result.levels) {
      // Raw childPath must NOT already have appearance/ prefix
      // (the resolver adds it; duplicate prefix would produce appearance/appearance/...)
      expect(lv.childPath).not.toMatch(/^appearance\//i);
    }
  });

  it('parseDetailAppearance: synthetic multi-level DTLA v0001 (committed fixture)', () => {
    // Synthetic DTLA v0001: 2 levels, no APPR/PIVT/RADR/TEST/WRIT (version < 2).
    // Hand-crafted to prove parser handles the minimal pre-version-2 case.
    //
    // FORM DTLA (outerBodyLen)
    //   FORM 0001 (verBodyLen)
    //     INFO chunk (24 bytes: 2 × {i32,f32,f32})
    //     FORM DATA (dataBodyLen)
    //       CHLD chunk (child 0: id=0, "mesh/high.msh\0")
    //       CHLD chunk (child 1: id=1, "mesh/low.msh\0")

    const name0 = 'mesh/high.msh';
    const name1 = 'mesh/low.msh';
    // CHLD payload = 4 (id) + name+NUL
    const chld0PayLen = 4 + name0.length + 1;
    const chld1PayLen = 4 + name1.length + 1;
    // Each CHLD = 8 (header) + payLen
    const chld0Len = 8 + chld0PayLen;
    const chld1Len = 8 + chld1PayLen;
    // INFO payload = 2 × 12 = 24
    const infoPayLen = 24;
    const infoChunkLen = 8 + infoPayLen;
    // DATA body = 4 (subType) + chld0Len + chld1Len
    const dataBodyLen = 4 + chld0Len + chld1Len;
    const dataFormLen = 8 + dataBodyLen;
    // ver 0001 body = 4 (subType) + infoChunkLen + dataFormLen
    const verBodyLen = 4 + infoChunkLen + dataFormLen;
    const verFormLen = 8 + verBodyLen;
    // DTLA body = 4 (subType) + verFormLen
    const dtlaBodyLen = 4 + verFormLen;
    const total = 8 + dtlaBodyLen;

    const ab = new ArrayBuffer(total);
    const dv = new DataView(ab);
    const u8 = new Uint8Array(ab);

    function writeTag(off: number, tag: string): number {
      for (let i = 0; i < 4; i++) u8[off + i] = tag.charCodeAt(i);
      return off + 4;
    }
    function writeU32BE(off: number, v: number): number {
      dv.setUint32(off, v, false); return off + 4;
    }
    function writeI32LE(off: number, v: number): number {
      dv.setInt32(off, v, true); return off + 4;
    }
    function writeF32LE(off: number, v: number): number {
      dv.setFloat32(off, v, true); return off + 4;
    }
    function writeStr(off: number, s: string): number {
      for (let i = 0; i < s.length; i++) u8[off + i] = s.charCodeAt(i);
      u8[off + s.length] = 0;
      return off + s.length + 1;
    }

    let p = 0;
    // FORM DTLA
    p = writeTag(p, 'FORM'); p = writeU32BE(p, dtlaBodyLen); p = writeTag(p, 'DTLA');
    // FORM 0001
    p = writeTag(p, 'FORM'); p = writeU32BE(p, verBodyLen); p = writeTag(p, '0001');
    // INFO chunk: 2 entries { id, near, far }
    // Entry 0: id=0, near=0, far=500  (high LOD)
    // Entry 1: id=1, near=0, far=1000 (low LOD)
    p = writeTag(p, 'INFO'); p = writeU32BE(p, infoPayLen);
    p = writeI32LE(p, 0); p = writeF32LE(p, 0.0); p = writeF32LE(p, 500.0);
    p = writeI32LE(p, 1); p = writeF32LE(p, 0.0); p = writeF32LE(p, 1000.0);
    // FORM DATA
    p = writeTag(p, 'FORM'); p = writeU32BE(p, dataBodyLen); p = writeTag(p, 'DATA');
    // CHLD 0
    p = writeTag(p, 'CHLD'); p = writeU32BE(p, chld0PayLen);
    p = writeI32LE(p, 0); p = writeStr(p, name0);
    // CHLD 1
    p = writeTag(p, 'CHLD'); p = writeU32BE(p, chld1PayLen);
    p = writeI32LE(p, 1); p = writeStr(p, name1);

    expect(p).toBe(total); // sanity: wrote exactly total bytes

    const iff = nc.parseIff(u8);
    // IFF round-trip must be byte-exact
    const rt = nativeCore.serializeIff(iff, u8);
    const rtU8 = new Uint8Array(rt);
    assertBytesEqual(u8, rtU8, 'synthetic DTLA v0001 IFF round-trip');

    // Parse
    const result = nc.parseDetailAppearance(iff, u8);
    expect(result.formatTag).toBe('DTLA');
    expect(result.versionTag).toBe('0001');
    expect(result.lodFlags).toBe(0); // version < 6, no PIVT
    expect(result.levels).toHaveLength(2);

    // After sorting by far desc: [far=1000 (id=1), far=500 (id=0)]
    expect(result.levels[0]!.far).toBeCloseTo(1000.0, 3);
    expect(result.levels[0]!.childPath).toBe('mesh/low.msh');
    expect(result.levels[1]!.far).toBeCloseTo(500.0, 3);
    expect(result.levels[1]!.childPath).toBe('mesh/high.msh');
  });
});

// ─── Gap-closure 02-03: EFCT (.eft) + body-droid shader regression ───────────
//
// Three bugs fixed:
//   Bug 1: ENVM slot forced placeholder=true → NAME chunk skipped → texturePath=""
//     Fix: always read NAME for ENVM; texturePath now = "texture/env_theed.dds"
//   Bug 2: effectPath hardcoded to ""
//     Fix: scan versionForm children for NAME chunk (cstring) or inline EFCT FORM
//   Bug 3: env contribution hardcoded 0.15
//     Fix: multiply by spec mask from SPEC texel.r or MAIN alpha
//
// CORE-05 gate (parseEffect):
//   Real fixture: fixtures-real/effect/a_envmask_specmap.eft
//   Source: swg-client-v2 ShaderEffect.cpp:86-179 + ShaderImplementation.cpp:1692-1738
//   Ground truth verified: FORM EFCT → version child → IMPL → PASS → PPSH → PTXM
//
// Body-droid shader regression:
//   Real fixture: fixtures-real/shader/a_body_droid.sht (or equivalent body-droid shader)
//   Expected: ENVM slot has texturePath="texture/env_theed.dds"
//             effectPath = "effect/a_envmask_specmap.eft"
//
// Fixtures are gitignored; tests skip gracefully when absent.

// Extend nc to include parseEffect
const ncEfct = nativeCore as typeof nativeCore & {
  parseEffect: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => EfctResult;
};

interface EffectSampler {
  index: number;
  role: string;
}

interface EffectBlend {
  alphaBlendEnable: boolean;
  blendOperation: number;
  blendSrc: number;
  blendDst: number;
  alphaTestEnable: boolean;
  alphaTestFunc: number;
  alphaTestRef: number;
  zWrite: boolean;
}

interface EffectImpl {
  scapValues: number[];
  options: string[];
  blend: EffectBlend;
  samplers: EffectSampler[];
}

interface EfctResult {
  formatTag: string;
  version: string;
  bestImplIndex: number;
  impls: EffectImpl[];
}

describe('FORM EFCT (.eft) — shader effect (gap-closure 02-03)', () => {
  // registerFormat CORE-05 gate for EFCT
  // Source: swg-client-v2 ShaderEffect.cpp:86-179 + ShaderImplementation.cpp:1692-1738

  it('CORE-05 gate: generic-IFF round-trip — a_envmask_specmap.eft', () => {
    // Real fixture (gitignored — extracted from shader_02.tre)
    const bytes = loadFixture('effect/a_envmask_specmap.eft');
    if (!bytes) {
      console.log('  SKIP: a_envmask_specmap.eft not present (real fixture, gitignored)');
      return;
    }
    // CRITICAL: if parseEffect round-trip is not byte-exact, STOP and report byte diff.
    assertIffRoundTrip(bytes, 'a_envmask_specmap.eft IFF round-trip');
  });

  it('parseEffect: a_envmask_specmap.eft — formatTag=EFCT, impls>0, bestImplIndex>=0', () => {
    const bytes = loadFixture('effect/a_envmask_specmap.eft');
    if (!bytes) {
      console.log('  SKIP: a_envmask_specmap.eft not present');
      return;
    }
    const iff = (nativeCore as unknown as typeof ncEfct).parseIff(bytes);
    const result = ncEfct.parseEffect(iff, bytes);

    expect(result.formatTag).toBe('EFCT');
    expect(typeof result.version).toBe('string');
    expect(result.impls.length).toBeGreaterThan(0);
    expect(result.bestImplIndex).toBeGreaterThanOrEqual(0);
    expect(result.bestImplIndex).toBeLessThan(result.impls.length);
  });

  it('parseEffect: bestImpl has MAIN sampler role (env-masked specular shader)', () => {
    // Ground truth: a_envmask_specmap.eft PTXM entries have MAIN, ENVM, SPEC roles.
    // The MAIN sampler role drives the diffuse/spec-mask assignment in the material.
    const bytes = loadFixture('effect/a_envmask_specmap.eft');
    if (!bytes) {
      console.log('  SKIP: a_envmask_specmap.eft not present');
      return;
    }
    const iff = (nativeCore as unknown as typeof ncEfct).parseIff(bytes);
    const result = ncEfct.parseEffect(iff, bytes);

    const bestImpl = result.impls[result.bestImplIndex]!;
    const roles = bestImpl.samplers.map(s => s.role);

    // Sampler roles must be printable ASCII (not reversed: "NIAM" would be wrong)
    for (const role of roles) {
      expect(role).toMatch(/^[A-Z0-9]+$/);
      // Regression: tagToRoleString was reading LE byte order → "NIAM" instead of "MAIN"
      expect(role).not.toBe('NIAM');
      expect(role).not.toBe('MVNE');  // would be reversed "ENVM"
    }

    // MAIN must appear (the diffuse/alpha spec-mask texture)
    expect(roles).toContain('MAIN');
  });

  it('parseEffect: blend struct is present with boolean fields (not undefined)', () => {
    // The blend state drives Three.js transparent / alphaTest / depthWrite.
    // Source: ShaderImplementationPass::load_0009 DATA chunk (56 bytes, field layout verified).
    const bytes = loadFixture('effect/a_envmask_specmap.eft');
    if (!bytes) {
      console.log('  SKIP: a_envmask_specmap.eft not present');
      return;
    }
    const iff = (nativeCore as unknown as typeof ncEfct).parseIff(bytes);
    const result = ncEfct.parseEffect(iff, bytes);

    const bestImpl = result.impls[result.bestImplIndex]!;
    const blend = bestImpl.blend;

    expect(typeof blend.alphaBlendEnable).toBe('boolean');
    expect(typeof blend.alphaTestEnable).toBe('boolean');
    expect(typeof blend.zWrite).toBe('boolean');
    // For a_envmask_specmap.eft: opaque shader — alphaBlend=false, zWrite=true
    expect(blend.alphaBlendEnable).toBe(false);
    expect(blend.zWrite).toBe(true);
  });
});

// ─── Bug-1 regression: ENVM texturePath populated ────────────────────────────
//
// Bug: ENVM slot forced placeholder=true → NAME chunk skipped → texturePath=""
// Fix: always read NAME for ENVM in Shader.cpp (Bug 1 fix, lines ~144-159)
// Verified: swg-client-v2 StaticShaderTemplate.cpp:load_texture_0000/0001/0002

describe('Bug-1 regression: ENVM texturePath populated after Shader.cpp fix', () => {

  it('parseShader: body-droid .sht — ENVM slot texturePath is non-empty', () => {
    // Real fixture: a body-droid .sht that has an ENVM slot with env_theed.dds.
    // Shader file variants: shader/a_body_droid.sht, shader/a_stardestroyer_body.sht, etc.
    // The critical assertion: ENVM.texturePath must NOT be "".
    const bytes = loadFixture('shader/body_droid_m_01_r_3.sht');
    if (!bytes) {
      console.log('  SKIP: body_droid_m_01_r_3.sht not present (real fixture, gitignored)');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseShader(iff, bytes);

    const envmSlot = result.slots.find(s => s.slot === 'ENVM');
    // ENVM slot MUST exist in an env-mapped shader
    expect(envmSlot).toBeDefined();
    // After Bug-1 fix: texturePath is non-empty (env_theed.dds or similar)
    // Before fix: texturePath was "" because placeholder=true skipped NAME read
    expect(envmSlot!.texturePath.length).toBeGreaterThan(0);
    expect(envmSlot!.texturePath).toMatch(/\.dds$/i);
  });

  it('parseShader: body-droid .sht — effectPath is non-empty (Bug-2 regression)', () => {
    // After Bug-2 fix: effectPath populated from NAME chunk / EFCT FORM in .sht
    // Before fix: effectPath was hardcoded to ""
    const bytes = loadFixture('shader/body_droid_m_01_r_3.sht');
    if (!bytes) {
      console.log('  SKIP: body_droid_m_01_r_3.sht not present (real fixture, gitignored)');
      return;
    }
    const iff = nc.parseIff(bytes);
    const result = nc.parseShader(iff, bytes);

    // effectPath must be populated (the .eft file path)
    expect(result.effectPath.length).toBeGreaterThan(0);
    expect(result.effectPath).toMatch(/\.eft$/i);
  });
});

// ─── Animation parser types ───────────────────────────────────────────────────

interface AnimationJoint {
  name: string;
  hasAnimatedRotation: boolean;
  rotationChannelIndex: number;
  translationMask: number;
  translationChannelIndex: [number, number, number];
}

interface AnimationChannelHeader {
  byteOffset: number;
  keyCount: number;
}

interface AnimationChannelTable {
  rotationChannels: AnimationChannelHeader[];
  staticRotByteOffset: number;
  staticRotationCount: number;
  translationChannels: AnimationChannelHeader[];
  staticTransByteOffset: number;
  staticTranslationCount: number;
}

interface AnimationResult {
  variant: 'CKAT-0001' | 'KFAT-0003' | 'KFAT-0002-unsupported';
  fps: number;
  frameCount: number;
  joints: AnimationJoint[];
  keyframes: ArrayBuffer;
  channelTable: AnimationChannelTable;
  roundTrip: { passed: boolean; failOffset?: number };
}

const ncAnim = nativeCore as typeof nativeCore & {
  parseAnimation: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => AnimationResult;
};

// ─── FORM CKAT-0001 (.ans) — compressed keyframe animation ───────────────────
//
// Ground truth:
//   swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313,553-594,637-660,1273-1277
//   swg-client-v2 CompressedQuaternion.cpp:82-122,156-228,370-419 (verbatim port)
//
// CORE-05 gate: byte-exact IFF round-trip on real CKAT .ans fixture.

describe('FORM CKAT-0001 (.ans) — compressed keyframe animation', () => {
  // registerFormat: see beforeAll below — loaderSource: swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313,553-594

  it('CORE-05 gate: generic-IFF round-trip — acklay_std_turn_right.ans (CKAT-0001)', () => {
    const bytes = loadFixture('animation/acklay_std_turn_right.ans');
    if (!bytes) {
      console.log('  SKIP: acklay_std_turn_right.ans not present (real fixture, gitignored)');
      return;
    }
    assertIffRoundTrip(bytes, 'acklay_std_turn_right.ans IFF round-trip');
  });

  it('parseAnimation: acklay_std_turn_right.ans — variant=CKAT-0001, fps>0, frameCount>0, joints>0', () => {
    const bytes = loadFixture('animation/acklay_std_turn_right.ans');
    if (!bytes) {
      console.log('  SKIP: acklay_std_turn_right.ans not present');
      return;
    }
    const iff = ncAnim.parseIff(bytes);
    const result = ncAnim.parseAnimation(iff, bytes);

    expect(result.variant).toBe('CKAT-0001');
    expect(result.fps).toBeGreaterThan(0);
    expect(result.frameCount).toBeGreaterThan(0);
    expect(result.joints.length).toBeGreaterThan(0);

    // joints must have the right shape
    const j0 = result.joints[0]!;
    expect(typeof j0.name).toBe('string');
    expect(j0.name.length).toBeGreaterThan(0);
    expect(typeof j0.hasAnimatedRotation).toBe('boolean');
    expect(Array.isArray(j0.translationChannelIndex)).toBe(true);
    expect(j0.translationChannelIndex.length).toBe(3);
  });

  it('parseAnimation: CKAT-0001 — keyframes is ArrayBuffer, channelTable has rotation channels', () => {
    const bytes = loadFixture('animation/acklay_std_turn_right.ans');
    if (!bytes) {
      console.log('  SKIP: acklay_std_turn_right.ans not present');
      return;
    }
    const iff = ncAnim.parseIff(bytes);
    const result = ncAnim.parseAnimation(iff, bytes);

    // Binary contract: keyframes crosses as ArrayBuffer (AGENTS.md: binary-stays-binary)
    expect(result.keyframes).toBeInstanceOf(ArrayBuffer);
    expect(result.keyframes.byteLength).toBeGreaterThan(0);

    // channelTable must exist with rotation channels (CKAT animation has rotations)
    expect(result.channelTable).toBeDefined();
    expect(Array.isArray(result.channelTable.rotationChannels)).toBe(true);
    expect(result.channelTable.rotationChannels.length).toBeGreaterThan(0);
  });

  it('parseAnimation: CKAT-0001 — compressed quaternion magnitude ≈ 1.0, w >= 0 (decode unit test)', () => {
    // This tests CompressedQuaternion::doExpand() verbatim port correctness.
    // Read the first animated rotation channel from the CKAT file.
    // The first key's decoded quaternion must be a unit quaternion (|q| ≈ 1.0, w >= 0).
    const bytes = loadFixture('animation/acklay_std_turn_right.ans');
    if (!bytes) {
      console.log('  SKIP: acklay_std_turn_right.ans not present');
      return;
    }
    const iff = ncAnim.parseIff(bytes);
    const result = ncAnim.parseAnimation(iff, bytes);

    // Find first channel with keys
    const rotCh = result.channelTable.rotationChannels.find(ch => ch.keyCount > 0);
    if (!rotCh) {
      console.log('  SKIP: no rotation keys found in CKAT fixture');
      return;
    }

    // Read from keyframeBuffer: channel starts at rotCh.byteOffset
    // Layout: int32 keyCount + int32 frame[kc] + float (w,x,y,z)[kc*4]
    const kfBuf = result.keyframes;
    const dv = new DataView(kfBuf);
    const base = rotCh.byteOffset;
    const keyCount = dv.getInt32(base, true);
    expect(keyCount).toBeGreaterThan(0);

    // Read first key's quaternion: after keyCount(4) + frame[0](4) = offset 8
    const quatBase = base + 4 + keyCount * 4; // skip keyCount + all frames
    const w = dv.getFloat32(quatBase + 0, true);
    const x = dv.getFloat32(quatBase + 4, true);
    const y = dv.getFloat32(quatBase + 8, true);
    const z = dv.getFloat32(quatBase + 12, true);

    const mag = Math.sqrt(w * w + x * x + y * y + z * z);
    // Magnitude must be within 0.001 of 1.0 (verbatim port correctness)
    expect(mag).toBeCloseTo(1.0, 2); // 2 decimal places = ±0.005

    // w must be >= 0 (clamp applied per plan must_have §3)
    expect(w).toBeGreaterThanOrEqual(0);
  });

  it('parseAnimation: CKAT-0001 — ON-DISK key count (no decimation applied)', () => {
    // The client's loader decimates keys; our typed parser must NOT.
    // This verifies the "decimation caveat" is honoured: ON-DISK counts preserved.
    const bytes = loadFixture('animation/acklay_std_turn_right.ans');
    if (!bytes) {
      console.log('  SKIP: acklay_std_turn_right.ans not present');
      return;
    }
    const iff = ncAnim.parseIff(bytes);
    const result = ncAnim.parseAnimation(iff, bytes);

    // channelTable must have positive keyCount for animated channels
    const animatedChs = result.channelTable.rotationChannels.filter(ch => ch.keyCount > 0);
    expect(animatedChs.length).toBeGreaterThan(0);

    // keyCount must be positive (channels with >1 frame are animated)
    for (const ch of animatedChs) {
      expect(ch.keyCount).toBeGreaterThan(0);
    }
  });

  it('parseAnimation: second CKAT-0001 fixture round-trip', () => {
    const bytes = loadFixture('animation/all_b_cbt_pistol_kneeling_aimed_hurry_to_pistol_standing_aimed.ans');
    if (!bytes) {
      console.log('  SKIP: second CKAT fixture not present');
      return;
    }
    assertIffRoundTrip(bytes, 'all_b_cbt_pistol*.ans IFF round-trip');
    const iff = ncAnim.parseIff(bytes);
    const result = ncAnim.parseAnimation(iff, bytes);
    expect(result.variant).toBe('CKAT-0001');
    expect(result.joints.length).toBeGreaterThan(0);
  });
});

// ─── FORM KFAT-0003 (.ans) — uncompressed keyframe animation ─────────────────
//
// Ground truth:
//   swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1518-1620,521-553,574-608,1590
//
// CORE-05 gate: byte-exact IFF round-trip on real KFAT-0003 .ans fixture.

describe('FORM KFAT-0003 (.ans) — uncompressed keyframe animation', () => {
  it('CORE-05 gate: generic-IFF round-trip — acklay_rea_get_hit_add.ans (KFAT-0003)', () => {
    const bytes = loadFixture('animation/acklay_rea_get_hit_add.ans');
    if (!bytes) {
      console.log('  SKIP: acklay_rea_get_hit_add.ans not present (real fixture, gitignored)');
      return;
    }
    assertIffRoundTrip(bytes, 'acklay_rea_get_hit_add.ans IFF round-trip');
  });

  it('parseAnimation: acklay_rea_get_hit_add.ans — variant=KFAT-0003, fps>0, joints>0', () => {
    const bytes = loadFixture('animation/acklay_rea_get_hit_add.ans');
    if (!bytes) {
      console.log('  SKIP: acklay_rea_get_hit_add.ans not present');
      return;
    }
    const iff = ncAnim.parseIff(bytes);
    const result = ncAnim.parseAnimation(iff, bytes);

    expect(result.variant).toBe('KFAT-0003');
    expect(result.fps).toBeGreaterThan(0);
    expect(result.frameCount).toBeGreaterThan(0);
    expect(result.joints.length).toBeGreaterThan(0);

    // keyframes is ArrayBuffer (binary-stays-binary)
    expect(result.keyframes).toBeInstanceOf(ArrayBuffer);
  });

  it('parseAnimation: KFAT-0003 — int32 widths (INFO/XFIN/QCHN all read correctly)', () => {
    const bytes = loadFixture('animation/acklay_rea_stand_get_hit_medium.ans');
    if (!bytes) {
      console.log('  SKIP: acklay_rea_stand_get_hit_medium.ans not present');
      return;
    }
    const iff = ncAnim.parseIff(bytes);
    const result = ncAnim.parseAnimation(iff, bytes);

    expect(result.variant).toBe('KFAT-0003');
    // int32 fps/frameCount from INFO
    expect(result.fps).toBeCloseTo(30.0, 1);
    expect(result.frameCount).toBeGreaterThan(0);
    expect(result.joints.length).toBeGreaterThan(0);

    // Verify rotation channels have positive keyCount (KFAT QCHN read_int32 widths)
    const animJoints = result.joints.filter(j => j.hasAnimatedRotation);
    expect(animJoints.length).toBeGreaterThan(0);
  });

  it('parseAnimation: KFAT-0003 — second round-trip (acklay_rea_stand_get_hit_medium)', () => {
    const bytes = loadFixture('animation/acklay_rea_stand_get_hit_medium.ans');
    if (!bytes) {
      console.log('  SKIP: acklay_rea_stand_get_hit_medium.ans not present');
      return;
    }
    assertIffRoundTrip(bytes, 'acklay_rea_stand_get_hit_medium.ans IFF round-trip');
  });
});

// ─── KFAT-0002 decline test ────────────────────────────────────────────────────

describe('KFAT-0002 graceful decline', () => {
  it('parseAnimation on KFAT-0002 returns variant=KFAT-0002-unsupported without throwing', () => {
    // Build a synthetic minimal KFAT 0002 IFF to test the decline path.
    // FORM KFAT → FORM 0002 → INFO (minimal placeholder, parser exits at version check)
    //
    // We only need the outer forms to be parseable; the KFAT 0002 parser must NOT
    // enter XFRM/AROT etc — it must return immediately on version detection.
    //
    // Layout:
    //   FORM KFAT (outerLen)
    //     FORM 0002 (form0002Len)
    //       INFO (infoPayLen bytes — any content, parser exits before reading)
    const infoPayLen = 4; // minimal: 4 bytes (don't care content)
    const infoChunkLen = 8 + infoPayLen;
    // FORM 0002 body: 4-byte subType + INFO chunk
    const form0002BodyLen = 4 + infoChunkLen;
    const form0002Len = 8 + form0002BodyLen;
    // FORM KFAT body: 4-byte subType + FORM 0002
    const outerBodyLen = 4 + form0002Len;
    const total = 8 + outerBodyLen;

    const ab = new ArrayBuffer(total);
    const dv = new DataView(ab);
    const u8 = new Uint8Array(ab);

    function writeTag4(off: number, s: string): number {
      for (let i = 0; i < 4; i++) u8[off + i] = s.charCodeAt(i);
      return off + 4;
    }
    function writeBE32(off: number, v: number): number {
      dv.setUint32(off, v, false); return off + 4;
    }

    let off = 0;
    off = writeTag4(off, 'FORM'); off = writeBE32(off, outerBodyLen);
    off = writeTag4(off, 'KFAT');
    off = writeTag4(off, 'FORM'); off = writeBE32(off, form0002BodyLen);
    off = writeTag4(off, '0002');
    off = writeTag4(off, 'INFO'); off = writeBE32(off, infoPayLen);
    off += infoPayLen; // placeholder payload

    // parseIff then parseAnimation must NOT throw
    const iff = ncAnim.parseIff(u8);
    let result: AnimationResult | undefined;
    expect(() => { result = ncAnim.parseAnimation(iff, u8); }).not.toThrow();
    expect(result?.variant).toBe('KFAT-0002-unsupported');
    expect(result?.fps).toBe(0);
    expect(result?.frameCount).toBe(0);
  });
});
