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

// Extend nativeCore type to include Phase 02-02 parsers
const nc = nativeCore as typeof nativeCore & {
  parseSkeletalMesh: (
    iffResult: unknown,
    srcBytes: ArrayBuffer | Uint8Array,
    boneOrder?: string[]
  ) => SkeletalMeshResult;
  parseSkeleton: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => SkeletonResult;
  parseSkeletalAppearance: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => SkeletalAppearanceResult;
  parseStaticAppearance: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => StaticAppearanceResult;
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
