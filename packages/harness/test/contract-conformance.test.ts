/**
 * contract-conformance.test.ts — Native-binding ↔ @swg/contracts structural conformance.
 *
 * PURPOSE: Catch field-name / field-type / array-vs-object drift between the native N-API
 * bindings and the TypeScript contract types that the renderer consumes. Each binding is
 * called with a real asset and its return object is structurally validated against the
 * matching @swg/contracts interface.
 *
 * FIVE NAMED REGRESSION GUARDS (the bugs that shipped silently):
 *   R1 resolveEntry  — must have .winner/.tombstone; must NOT have .found
 *   R2 parseShader   — slots[*].slot (not .slotTag)
 *   R3 parseDds      — .format at top level (not per-mip); .isCubemap present; mips have no .format
 *   R4 parseMesh/parseSkeletalMesh — group.uvs IS an array; group.uvs[0].elementCount is a number
 *   R5 parseEffect   — .samplers is an array (KNOWN GAP: may be [] for PTXM-undecoded files)
 *
 * ASSET GATING:
 *   Real fixtures are gitignored and absent in CI. When absent the whole suite skips with a
 *   clear console message — no hard failure. When present (dev machine) it runs and is
 *   authoritative. Tests use the same fixtures-real/ directory as mesh-roundtrip.test.ts.
 *   Synthetic/committed fixtures (palette, lod) always run.
 *
 * BINDINGS COVERED:
 *   parseMesh, parseSkeletalMesh, parseSkeleton, parseShader, parseDds, parseMeshLod,
 *   parseDetailAppearance, parseEffect, parsePalette, resolveEntry, resolveChain,
 *   getMountEntriesColumnar (decoded shape), parseIff.
 *
 * Sources:
 *   @swg/contracts mesh.ts / material.ts / skeleton.ts / animation.ts / tre.ts / iff.ts
 *   packages/native-core/index.d.ts (binding declared shapes)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Native addon (CJS require — .node is CJS) ───────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as NativeCore;

interface NativeCore {
  parseIff: (bytes: ArrayBuffer | Uint8Array) => unknown;
  serializeIff: (result: unknown, srcBytes: ArrayBuffer | Uint8Array) => ArrayBuffer;
  parseMesh: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => unknown;
  parseSkeletalMesh: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array, boneOrder?: string[]) => unknown;
  parseSkeleton: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => unknown;
  parseShader: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => unknown;
  parseDds: (bytes: ArrayBuffer | Uint8Array) => unknown;
  parseMeshLod: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => unknown;
  parseDetailAppearance: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => unknown;
  parseEffect: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => unknown;
  parsePalette: (bytes: ArrayBuffer | Uint8Array) => unknown;
  mountTreMount: (paths: string[], priorities: number[]) => string;
  resolveEntry: (handle: string, name: string) => unknown;
  resolveChain: (handle: string, name: string) => unknown;
  getMountEntriesColumnar: (handle: string) => ArrayBuffer;
  disposeTreMount: (handle: string) => void;
  buildTre: (entries: { path: string; data?: ArrayBuffer | Uint8Array; tombstone?: boolean }[], version?: string) => ArrayBuffer;
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const REAL = join(__dirname, '..', 'fixtures-real');

function loadFixture(relPath: string): Uint8Array | null {
  const fullPath = join(REAL, relPath);
  if (!existsSync(fullPath)) return null;
  const buf = readFileSync(fullPath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ─── Runtime structural validator ─────────────────────────────────────────────
//
// Hand-rolled (no extra dependency). Given a sample object and a FieldSpec array,
// assert: each required field is PRESENT with the right type. Arrays-are-arrays,
// objects are-objects. Exact field names only — this is what catches slot/slotTag drift.

type FieldKind = 'number' | 'string' | 'boolean' | 'array' | 'object' | 'ArrayBuffer' | 'null-or-object' | 'array-or-null';

interface FieldSpec {
  name: string;
  kind: FieldKind;
  /** If true, field may be absent (optional on the contract). Default: false (required). */
  optional?: boolean;
  /** If true, field must NOT be present (catch renamed fields that were left in place). */
  banned?: boolean;
}

/**
 * Assert that `obj` conforms to the given FieldSpec array.
 *
 * @param obj    - The object to check (any unknown return from a binding call)
 * @param specs  - Field specification array derived from the @swg/contracts interface
 * @param label  - Human-readable label for error messages (e.g. "parseMesh result")
 */
function assertShape(obj: unknown, specs: FieldSpec[], label: string): void {
  if (obj === null || typeof obj !== 'object') {
    throw new Error(`${label}: expected object, got ${typeof obj}`);
  }
  const rec = obj as Record<string, unknown>;

  for (const spec of specs) {
    if (spec.banned) {
      // Regression guard: field must NOT exist
      if (Object.prototype.hasOwnProperty.call(rec, spec.name)) {
        throw new Error(
          `${label}: BANNED field '${spec.name}' is present — this field was renamed ` +
          `but the old name was left in the output (regression guard).`,
        );
      }
      continue;
    }

    const hasField = Object.prototype.hasOwnProperty.call(rec, spec.name);
    if (!hasField) {
      if (spec.optional) continue;
      throw new Error(`${label}: required field '${spec.name}' is MISSING`);
    }

    const val = rec[spec.name];

    switch (spec.kind) {
      case 'number':
        if (typeof val !== 'number') {
          throw new Error(`${label}: field '${spec.name}' expected number, got ${typeof val} (value: ${JSON.stringify(val)})`);
        }
        break;
      case 'string':
        if (typeof val !== 'string') {
          throw new Error(`${label}: field '${spec.name}' expected string, got ${typeof val} (value: ${JSON.stringify(val)})`);
        }
        break;
      case 'boolean':
        if (typeof val !== 'boolean') {
          throw new Error(`${label}: field '${spec.name}' expected boolean, got ${typeof val} (value: ${JSON.stringify(val)})`);
        }
        break;
      case 'array':
        if (!Array.isArray(val)) {
          throw new Error(`${label}: field '${spec.name}' expected Array, got ${typeof val} — ` +
            `if this is an object, it may be a regression (e.g. uvs as single object instead of array)`);
        }
        break;
      case 'array-or-null':
        if (val !== null && !Array.isArray(val)) {
          throw new Error(`${label}: field '${spec.name}' expected Array|null, got ${typeof val}`);
        }
        break;
      case 'object':
        if (typeof val !== 'object' || val === null || Array.isArray(val)) {
          throw new Error(`${label}: field '${spec.name}' expected plain object, got ${Array.isArray(val) ? 'Array' : typeof val}`);
        }
        break;
      case 'ArrayBuffer':
        if (!(val instanceof ArrayBuffer)) {
          throw new Error(`${label}: field '${spec.name}' expected ArrayBuffer, got ${typeof val}`);
        }
        break;
      case 'null-or-object':
        if (val !== null && (typeof val !== 'object' || Array.isArray(val))) {
          throw new Error(`${label}: field '${spec.name}' expected null|object, got ${typeof val}`);
        }
        break;
    }
  }
}

// ─── MeshAttributeSlice field spec ───────────────────────────────────────────
// Source: @swg/contracts mesh.ts MeshAttributeSlice

const MESH_ATTRIBUTE_SLICE_SPEC: FieldSpec[] = [
  { name: 'offset',         kind: 'number' },
  { name: 'byteLength',     kind: 'number' },
  { name: 'componentCount', kind: 'number' },
  { name: 'elementCount',   kind: 'number' },
];

// ─── Helpers for real-asset guards ───────────────────────────────────────────

let anyRealFixtureMissing = false;

function requireFixture(relPath: string, testName: string): Uint8Array | null {
  const bytes = loadFixture(relPath);
  if (!bytes) {
    anyRealFixtureMissing = true;
    return null;
  }
  return bytes;
}

// ─── Track real-asset availability at suite load time ─────────────────────────

// Fixtures used across multiple describe blocks — check once
const FIXTURE_PATHS = {
  mesh:            'mesh/arc170_body_l2.msh',
  skeletalMesh:    'mesh/ackbar_arms_l0.mgn',
  skeleton:        'skeleton/at_at.skt',
  shader:          'shader/2d_distort.sht',
  ddsFlat:         'texture/128gray_n.dds',
  lmg:             'mesh/apron_s01_f.lmg',
  lod:             'lod/wb_02_09e_00000000000000000000.lod',
  palette:         'palette/synthetic_2color.pal',  // synthetic, always committed
};

// Check real fixture availability synchronously at module level
const fixturePresence: Record<string, boolean> = {};
for (const [key, relPath] of Object.entries(FIXTURE_PATHS)) {
  fixturePresence[key] = existsSync(join(REAL, relPath));
}
const anyRealPresent = Object.entries(fixturePresence)
  .filter(([k]) => k !== 'palette') // palette is synthetic
  .some(([, present]) => present);

// ─── CRC-32 helper for building minimal TRE archives ─────────────────────────
// (Mirrors tre-override.test.ts — forward CRC-32 matching swg-client-v2 Crc.cpp)

function crc32(name: string): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = (i << 24) >>> 0;
    for (let k = 0; k < 8; k++) {
      c = ((c & 0x80000000) !== 0) ? (((c << 1) ^ 0x04C11DB7) >>> 0) : ((c << 1) >>> 0);
    }
    table[i] = c;
  }
  let crcVal = 0xFFFFFFFF;
  for (let i = 0; i < name.length; i++) {
    const b = name.charCodeAt(i);
    crcVal = ((crcVal << 8) ^ table[((crcVal >>> 24) ^ b) & 0xFF]!) >>> 0;
  }
  return (crcVal ^ 0xFFFFFFFF) >>> 0;
}

/** Build a minimal v0005 TRE for mount-API conformance tests. */
function buildMinimalTre(entries: { name: string; payload: Uint8Array }[]): Uint8Array {
  // Build names block
  let namesBlock = '';
  const nameOffsets: number[] = [];
  for (const e of entries) {
    nameOffsets.push(namesBlock.length);
    namesBlock += e.name + '\0';
  }
  const nameBytes = new TextEncoder().encode(namesBlock);

  // Calculate payload offsets (payloads start at offset 36)
  const payloadOffset0 = 36;
  const payloadOffsets: number[] = [];
  let cursor = payloadOffset0;
  for (const e of entries) {
    payloadOffsets.push(cursor);
    cursor += e.payload.length;
  }

  // TOC: 24 bytes per entry
  const tocOffset = cursor;
  const tocSize   = entries.length * 24;
  const namesOffset = tocOffset + tocSize;
  const totalSize   = namesOffset + nameBytes.length;

  const ab  = new ArrayBuffer(totalSize);
  const dv  = new DataView(ab);
  const u8  = new Uint8Array(ab);

  // Header (36 bytes LE):
  // magic[4]='EERT', version[4]='5000' (stored as ASCII '5','0','0','0')
  // numberOfFiles, tocOffset, tocCompressor=0, sizeOfTOC, blockCompressor=0,
  // sizeOfNameBlock, uncompSizeOfNameBlock
  const enc = new TextEncoder();
  u8.set(enc.encode('EERT'), 0);
  u8.set(enc.encode('5000'), 4); // v0005 version tag
  dv.setUint32(8,  entries.length, true);
  dv.setUint32(12, tocOffset,      true);
  dv.setUint32(16, 0,              true); // tocCompressor=none
  dv.setUint32(20, tocSize,        true);
  dv.setUint32(24, 0,              true); // blockCompressor=none
  dv.setUint32(28, nameBytes.length, true);
  dv.setUint32(32, nameBytes.length, true); // uncompressed = compressed (no compression)

  // Payloads
  for (let i = 0; i < entries.length; i++) {
    u8.set(entries[i]!.payload, payloadOffsets[i]!);
  }

  // TOC records (24 bytes, crc-first)
  for (let i = 0; i < entries.length; i++) {
    const base = tocOffset + i * 24;
    dv.setUint32(base + 0,  crc32(entries[i]!.name), true);        // crc
    dv.setInt32( base + 4,  entries[i]!.payload.length, true);     // uncompressedLength
    dv.setInt32( base + 8,  payloadOffsets[i]!,          true);    // offset
    dv.setInt32( base + 12, 0,                            true);    // compressor=none
    dv.setInt32( base + 16, entries[i]!.payload.length,  true);    // compressedLength
    dv.setInt32( base + 20, nameOffsets[i]!,              true);    // fileNameOffset
  }

  // Names block
  u8.set(nameBytes, namesOffset);

  return u8;
}

/** Write a Uint8Array to a temp file and return its path. */
const TMPDIR = join(tmpdir(), 'swg-conform-test');
mkdirSync(TMPDIR, { recursive: true });

function writeTempTre(name: string, bytes: Uint8Array): string {
  const p = join(TMPDIR, name);
  writeFileSync(p, bytes);
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT CONFORMANCE TESTS
// ─────────────────────────────────────────────────────────────────────────────

// ─── parseIff — IffParseResult contract ──────────────────────────────────────
//
// Contract: IffParseResult { roots: IffNode[], trailingBytes: null|{count,offset}, roundTrip: {passed} }
// Tested with a minimal synthetic IFF (FORM MESH outer shell) so it always runs.

describe('parseIff — contract conformance (IffParseResult)', () => {
  it('returns roots[], trailingBytes, roundTrip fields', () => {
    // Build a minimal IFF: FORM MESH (empty body)
    const ab  = new ArrayBuffer(12); // 8-byte header + 4-byte subType
    const dv  = new DataView(ab);
    const u8  = new Uint8Array(ab);
    // FORM header BE
    dv.setUint32(0, 0x464f524d, false); // 'FORM'
    dv.setUint32(4, 4,           false); // body = 4 bytes (subType only)
    u8[8]  = 0x4d; u8[9]  = 0x45; u8[10] = 0x53; u8[11] = 0x48; // 'MESH'

    const result = nativeCore.parseIff(u8) as Record<string, unknown>;

    assertShape(result, [
      { name: 'roots',        kind: 'array'  },
      { name: 'roundTrip',    kind: 'object' },
    ], 'parseIff result');

    // roundTrip sub-shape
    assertShape(result['roundTrip'], [
      { name: 'passed', kind: 'boolean' },
    ], 'parseIff result.roundTrip');

    // roots[0] must be a form node
    const root0 = (result['roots'] as unknown[])[0] as Record<string, unknown>;
    assertShape(root0, [
      { name: 'tag',       kind: 'string' },
      { name: 'length',    kind: 'number' },
      { name: 'byteOffset',kind: 'number' },
      { name: 'kind',      kind: 'string' },
    ], 'parseIff result.roots[0]');
    expect(root0['kind']).toBe('form');
    expect(root0['subType']).toBe('MESH');
  });
});

// ─── parseMesh — MeshParseResult contract ────────────────────────────────────
//
// Contract: MeshParseResult {
//   formatTag: string, version: string,
//   shaderGroups: MeshShaderGroup[], roundTrip: {passed}
// }
// MeshShaderGroup: { shaderName, vertexCount, indexCount, positions, normals, uvs: MeshAttributeSlice[],
//                    indices, skinIndices, skinWeights, hasDot3 }
//
// REGRESSION R4: uvs MUST be an array (not a single object — original bug emitted object).

describe('parseMesh — MeshParseResult contract (REGRESSION R4: uvs is array)', () => {
  const FIXTURE = FIXTURE_PATHS.mesh;

  it('[R4-parseMesh] group.uvs is an Array (not a single object)', () => {
    const bytes = loadFixture(FIXTURE);
    if (!bytes) {
      console.log(`  SKIP: ${FIXTURE} not present (real fixture)`);
      return;
    }

    const iff    = nativeCore.parseIff(bytes);
    const result = nativeCore.parseMesh(iff, bytes) as Record<string, unknown>;

    // Top-level shape
    assertShape(result, [
      { name: 'formatTag',    kind: 'string' },
      { name: 'version',      kind: 'string' },
      { name: 'shaderGroups', kind: 'array'  },
    ], 'parseMesh result');

    expect(result['formatTag']).toBe('MESH');

    const groups = result['shaderGroups'] as unknown[];
    expect(groups.length).toBeGreaterThan(0);

    const g0 = groups[0] as Record<string, unknown>;

    // MeshShaderGroup required fields
    assertShape(g0, [
      { name: 'shaderName',  kind: 'string'  },
      { name: 'vertexCount', kind: 'number'  },
      { name: 'indexCount',  kind: 'number'  },
      { name: 'positions',   kind: 'object'  },
      { name: 'indices',     kind: 'object'  },
      { name: 'hasDot3',     kind: 'boolean' },
      // R4: uvs must be an ARRAY
      { name: 'uvs',         kind: 'array'   },
    ], 'parseMesh group[0]');

    // R4 named regression guard: uvs[0] must exist and have elementCount
    const uvs = g0['uvs'] as unknown[];
    // REGRESSION R4: if uvs is a plain object (not array), Array.isArray returns false
    // and the assertShape above would have already thrown. Belt-and-suspenders:
    expect(Array.isArray(uvs)).toBe(true);
    if (uvs.length > 0) {
      assertShape(uvs[0], MESH_ATTRIBUTE_SLICE_SPEC, 'parseMesh group[0].uvs[0]');
      expect(typeof (uvs[0] as Record<string, unknown>)['elementCount']).toBe('number');
    }

    // positions, indices are MeshAttributeSlice objects
    assertShape(g0['positions'], MESH_ATTRIBUTE_SLICE_SPEC, 'parseMesh group[0].positions');
    assertShape(g0['indices'],   MESH_ATTRIBUTE_SLICE_SPEC, 'parseMesh group[0].indices');
  });
});

// ─── parseSkeletalMesh — MeshParseResult (SKMG) contract ────────────────────
//
// Same uvs-is-array regression as parseMesh, plus boneNames/sktmNames arrays.
// REGRESSION R4 (skeletal mesh variant).

describe('parseSkeletalMesh — SkeletalMeshParseResult contract (REGRESSION R4: uvs is array)', () => {
  const FIXTURE = FIXTURE_PATHS.skeletalMesh;

  it('[R4-parseSkeletalMesh] group.uvs is an Array (not a single object)', () => {
    const bytes = loadFixture(FIXTURE);
    if (!bytes) {
      console.log(`  SKIP: ${FIXTURE} not present (real fixture)`);
      return;
    }

    const iff    = nativeCore.parseIff(bytes);
    const result = nativeCore.parseSkeletalMesh(iff, bytes) as Record<string, unknown>;

    assertShape(result, [
      { name: 'formatTag',    kind: 'string' },
      { name: 'version',      kind: 'string' },
      { name: 'shaderGroups', kind: 'array'  },
      { name: 'boneNames',    kind: 'array'  },
    ], 'parseSkeletalMesh result');

    expect(result['formatTag']).toBe('SKMG');

    const groups = result['shaderGroups'] as unknown[];
    expect(groups.length).toBeGreaterThan(0);

    // Find first group with vertices
    const populated = groups.filter((g) => (g as Record<string, unknown>)['vertexCount'] as number > 0);
    expect(populated.length).toBeGreaterThan(0);

    const g0 = populated[0] as Record<string, unknown>;

    assertShape(g0, [
      { name: 'shaderName',  kind: 'string'  },
      { name: 'vertexCount', kind: 'number'  },
      { name: 'indexCount',  kind: 'number'  },
      { name: 'positions',   kind: 'object'  },
      { name: 'indices',     kind: 'object'  },
      { name: 'hasDot3',     kind: 'boolean' },
      // R4: uvs must be an ARRAY
      { name: 'uvs',         kind: 'array'   },
    ], 'parseSkeletalMesh group[0]');

    const uvs = g0['uvs'] as unknown[];
    expect(Array.isArray(uvs)).toBe(true);
    if (uvs.length > 0) {
      assertShape(uvs[0], MESH_ATTRIBUTE_SLICE_SPEC, 'parseSkeletalMesh group[0].uvs[0]');
      expect(typeof (uvs[0] as Record<string, unknown>)['elementCount']).toBe('number');
    }
  });
});

// ─── parseSkeleton — SkeletonParseResult contract ────────────────────────────
//
// Contract: SkeletonParseResult { version: string, bones: BoneNode[], roundTrip: {passed} }
// Native BoneInfo shape: { name, parentIndex, preRot[4], postRot[4], bindPos[3], bindPoseRot[4] }.
// BPRO (bindPoseRot) MUST be a 4-float quaternion (w,x,y,z) — reading it as 3 floats was a real
// bug that dropped bind-pose rotation and misaligned every joint. This test guards the widths.

describe('parseSkeleton — SkeletonParseResult contract', () => {
  const FIXTURE = FIXTURE_PATHS.skeleton;

  it('result has formatTag, version, bones[], boneNames[]', () => {
    const bytes = loadFixture(FIXTURE);
    if (!bytes) {
      console.log(`  SKIP: ${FIXTURE} not present (real fixture)`);
      return;
    }

    const iff    = nativeCore.parseIff(bytes);
    const result = nativeCore.parseSkeleton(iff, bytes) as Record<string, unknown>;

    assertShape(result, [
      { name: 'formatTag', kind: 'string' },
      { name: 'version',   kind: 'string' },
      { name: 'bones',     kind: 'array'  },
      { name: 'boneNames', kind: 'array'  },
    ], 'parseSkeleton result');

    expect(result['formatTag']).toBe('SKTM');

    const bones = result['bones'] as unknown[];
    expect(bones.length).toBeGreaterThan(0);

    // Validate first bone has required structural fields
    const b0 = bones[0] as Record<string, unknown>;
    assertShape(b0, [
      { name: 'name',        kind: 'string' },
      { name: 'parentIndex', kind: 'number' },
      { name: 'preRot',      kind: 'array'  },
      { name: 'postRot',     kind: 'array'  },
      { name: 'bindPos',     kind: 'array'  },
      { name: 'bindPoseRot', kind: 'array'  },
    ], 'parseSkeleton bones[0]');

    // Quaternion arrays are 4 floats (w,x,y,z); bind translation is 3 floats.
    // BPRO=4 is the regression guard for the 3-float mis-read.
    expect((b0['preRot']      as unknown[]).length).toBe(4);
    expect((b0['postRot']     as unknown[]).length).toBe(4);
    expect((b0['bindPos']     as unknown[]).length).toBe(3);
    expect((b0['bindPoseRot'] as unknown[]).length).toBe(4);
  });
});

// ─── parseShader — ShaderParseResult contract ────────────────────────────────
//
// Contract: ShaderParseResult {
//   variant: 'SSHT'|'CSHD', effectPath: string, slots: ShaderSlot[], customizationVars: []
// }
// ShaderSlot: { slot: ShaderSlotName, texturePath: string|null, uvSet: number }
//
// REGRESSION R2: slots[*].slot (NOT .slotTag) — the original bug used 'slotTag' as the key.
// The renderer's material system reads `.slot` to map textures to Three.js uniforms.

describe('parseShader — ShaderParseResult contract (REGRESSION R2: .slot not .slotTag)', () => {
  const FIXTURE = FIXTURE_PATHS.shader;

  it('[R2] slots[*].slot field exists; NO .slotTag', () => {
    const bytes = loadFixture(FIXTURE);
    if (!bytes) {
      console.log(`  SKIP: ${FIXTURE} not present (real fixture)`);
      return;
    }

    const iff    = nativeCore.parseIff(bytes);
    const result = nativeCore.parseShader(iff, bytes) as Record<string, unknown>;

    assertShape(result, [
      { name: 'variant',           kind: 'string' },
      { name: 'effectPath',        kind: 'string' },
      { name: 'slots',             kind: 'array'  },
      { name: 'customizationVars', kind: 'array'  },
    ], 'parseShader result');

    const slots = result['slots'] as unknown[];
    // 2d_distort.sht has at least 2 texture slots
    expect(slots.length).toBeGreaterThan(0);

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] as Record<string, unknown>;

      // R2 regression guard: 'slot' must be present
      assertShape(slot, [
        { name: 'slot',        kind: 'string' },    // R2: was 'slotTag' — caught the white-textures bug
        { name: 'uvSet',       kind: 'number' },
      ], `parseShader slots[${i}]`);

      // R2 regression guard: 'slotTag' must NOT be present (the old wrong name)
      assertShape(slot, [
        { name: 'slotTag', kind: 'string', banned: true },  // R2: banned — was the wrong field name
      ], `parseShader slots[${i}] (banned fields)`);

      // slot value must be a recognizable tag (uppercase ASCII)
      expect(slot['slot']).toMatch(/^[A-Z0-9]+$/);
    }
  });

  // R6: MATL material colors (specular drives the spec-temper fix; CSHD recursion surfaces MAIN).
  it('[R6] material (MATL) is absent OR a {ambient,diffuse,emissive,specular[3],specularPower}', () => {
    const bytes = loadFixture(FIXTURE);
    if (!bytes) {
      console.log(`  SKIP: ${FIXTURE} not present (real fixture)`);
      return;
    }
    const iff    = nativeCore.parseIff(bytes);
    const result = nativeCore.parseShader(iff, bytes) as Record<string, unknown>;
    const material = result['material'];
    if (material === undefined || material === null) return; // optional — identity fallback

    const m = material as Record<string, unknown>;
    for (const key of ['ambient', 'diffuse', 'emissive', 'specular'] as const) {
      const c = m[key];
      expect(Array.isArray(c), `material.${key} is an array`).toBe(true);
      expect((c as unknown[]).length, `material.${key} is rgb (len 3)`).toBe(3);
      for (const v of c as unknown[]) expect(typeof v).toBe('number');
    }
    expect(typeof m['specularPower']).toBe('number');
  });
});

// ─── parseDds — DdsParseResult contract ──────────────────────────────────────
//
// Contract: DdsParseResult {
//   width, height, mipCount: number, format: DdsFormat (TOP LEVEL),
//   isCubemap: boolean, mips: DdsMipEntry[]
// }
// DdsMipEntry: { offset, byteLength, width, height }  — NO .format per mip
//
// REGRESSION R3a: .format at TOP LEVEL (not on each mip) — all-magenta-textures bug.
// REGRESSION R3b: .isCubemap PRESENT — the field was missing from an earlier contract version.
// REGRESSION R3c: mips[*] must NOT have a .format field (that was the old wrong shape).

describe('parseDds — DdsParseResult contract (REGRESSION R3: top-level format + isCubemap)', () => {
  const FIXTURE = FIXTURE_PATHS.ddsFlat;

  it('[R3a] .format is at TOP LEVEL (not per-mip)', () => {
    const bytes = loadFixture(FIXTURE);
    if (!bytes) {
      console.log(`  SKIP: ${FIXTURE} not present (real fixture)`);
      return;
    }

    const result = nativeCore.parseDds(bytes) as Record<string, unknown>;

    // Top-level shape — format must be AT THE TOP
    assertShape(result, [
      { name: 'width',    kind: 'number'  },
      { name: 'height',   kind: 'number'  },
      { name: 'mipCount', kind: 'number'  },
      { name: 'format',   kind: 'string'  },   // R3a: top-level (was missing, was per-mip)
      { name: 'isCubemap',kind: 'boolean' },   // R3b: must be present
      { name: 'mips',     kind: 'array'   },
    ], 'parseDds result');

    // format must be a known DdsFormat string
    expect(['DXT1', 'DXT2', 'DXT3', 'DXT4', 'DXT5', 'RGBA8']).toContain(result['format']);

    // R3b: isCubemap must be a boolean (not undefined)
    expect(typeof result['isCubemap']).toBe('boolean');
    // 128gray_n.dds is a flat 2D texture
    expect(result['isCubemap']).toBe(false);

    const mips = result['mips'] as unknown[];
    expect(mips.length).toBeGreaterThan(0);

    // Each mip: { offset, byteLength, width, height } — NO .format
    for (let i = 0; i < mips.length; i++) {
      const mip = mips[i] as Record<string, unknown>;

      assertShape(mip, [
        { name: 'offset',     kind: 'number' },
        { name: 'byteLength', kind: 'number' },
        { name: 'width',      kind: 'number' },
        { name: 'height',     kind: 'number' },
      ], `parseDds mips[${i}]`);

      // R3c regression guard: mips must NOT have their own .format field
      // (old wrong shape put format on each mip — that was the bug)
      assertShape(mip, [
        { name: 'format', kind: 'string', banned: true },
      ], `parseDds mips[${i}] (banned fields)`);
    }
  });
});

// ─── parseMeshLod — LodParseResult contract ──────────────────────────────────
//
// Contract (from native index.d.ts MeshLodParseResult):
//   { formatTag, version, levelCount, levels: Array<{path}> }

describe('parseMeshLod — MeshLodParseResult contract', () => {
  const FIXTURE = FIXTURE_PATHS.lmg;

  it('result has formatTag, version, levelCount, levels[]', () => {
    const bytes = loadFixture(FIXTURE);
    if (!bytes) {
      console.log(`  SKIP: ${FIXTURE} not present (real fixture)`);
      return;
    }

    const iff    = nativeCore.parseIff(bytes);
    const result = nativeCore.parseMeshLod(iff, bytes) as Record<string, unknown>;

    assertShape(result, [
      { name: 'formatTag',  kind: 'string' },
      { name: 'version',    kind: 'string' },
      { name: 'levelCount', kind: 'number' },
      { name: 'levels',     kind: 'array'  },
    ], 'parseMeshLod result');

    expect(result['formatTag']).toBe('MLOD');
    const levels = result['levels'] as unknown[];
    expect(levels.length).toBe(result['levelCount'] as number);

    // Each level has at least a path string
    for (let i = 0; i < levels.length; i++) {
      assertShape(levels[i], [
        { name: 'path', kind: 'string' },
      ], `parseMeshLod levels[${i}]`);
    }
  });
});

// ─── parseDetailAppearance — DetailAppearanceParseResult contract ─────────────
//
// Contract (index.d.ts DetailAppearanceParseResult):
//   { formatTag, versionTag, lodFlags, levels: DetailAppearanceLevel[] }
// DetailAppearanceLevel: { id, near, far, childPath }

describe('parseDetailAppearance — DetailAppearanceParseResult contract', () => {
  const FIXTURE = FIXTURE_PATHS.lod;

  it('result has formatTag, versionTag, lodFlags, levels[]', () => {
    const bytes = loadFixture(FIXTURE);
    if (!bytes) {
      console.log(`  SKIP: ${FIXTURE} not present (real fixture)`);
      return;
    }

    const iff    = nativeCore.parseIff(bytes);
    const result = nativeCore.parseDetailAppearance(iff, bytes) as Record<string, unknown>;

    assertShape(result, [
      { name: 'formatTag',  kind: 'string' },
      { name: 'versionTag', kind: 'string' },
      { name: 'lodFlags',   kind: 'number' },
      { name: 'levels',     kind: 'array'  },
    ], 'parseDetailAppearance result');

    expect(result['formatTag']).toBe('DTLA');
    const levels = result['levels'] as unknown[];
    expect(levels.length).toBeGreaterThan(0);

    for (let i = 0; i < levels.length; i++) {
      assertShape(levels[i], [
        { name: 'id',        kind: 'number' },
        { name: 'near',      kind: 'number' },
        { name: 'far',       kind: 'number' },
        { name: 'childPath', kind: 'string' },
      ], `parseDetailAppearance levels[${i}]`);
    }
  });
});

// ─── parseEffect — EffectParseResult contract ────────────────────────────────
//
// Contract (index.d.ts EffectParseResult):
//   { formatTag, version, bestImplIndex, impls: EffectImpl[] }
// EffectImpl: { scapValues: number[], options: string[], blend: EffectBlend, samplers: EffectSampler[] }
//
// REGRESSION R5 (KNOWN GAP): samplers is an array (shape validated), but may be [] when
// PTXM is not decoded. The test asserts shape correctness without requiring non-empty samplers.
// TODO(R5): when PTXM decoding is complete, assert samplers.length > 0 for real .eft files.

describe('parseEffect — EffectParseResult contract (REGRESSION R5: samplers is array, KNOWN GAP)', () => {
  // We need an effect fixture — use effect/a_envmask_specmap.eft if present
  const EFFECT_FIXTURE = 'effect/a_envmask_specmap.eft';

  it('[R5] impls[*].samplers is an Array (shape validated; may be [] — KNOWN GAP for PTXM)', () => {
    const bytes = loadFixture(EFFECT_FIXTURE);
    if (!bytes) {
      console.log(`  SKIP: ${EFFECT_FIXTURE} not present (real fixture, gitignored)`);
      console.log('  TODO(R5): when PTXM decoding is complete, assert samplers.length > 0');
      return;
    }

    const iff    = nativeCore.parseIff(bytes);
    const result = nativeCore.parseEffect(iff, bytes) as Record<string, unknown>;

    assertShape(result, [
      { name: 'formatTag',     kind: 'string' },
      { name: 'version',       kind: 'string' },
      { name: 'bestImplIndex', kind: 'number' },
      { name: 'impls',         kind: 'array'  },
    ], 'parseEffect result');

    expect(result['formatTag']).toBe('EFCT');
    const impls = result['impls'] as unknown[];
    expect(impls.length).toBeGreaterThan(0);

    for (let i = 0; i < impls.length; i++) {
      const impl = impls[i] as Record<string, unknown>;

      assertShape(impl, [
        { name: 'scapValues', kind: 'array'  },
        { name: 'options',    kind: 'array'  },
        { name: 'blend',      kind: 'object' },
        // R5: samplers MUST be an array (not undefined, not object)
        { name: 'samplers',   kind: 'array'  },
      ], `parseEffect impls[${i}]`);

      // blend sub-shape
      assertShape(impl['blend'], [
        { name: 'alphaBlendEnable', kind: 'boolean' },
        { name: 'blendOperation',   kind: 'number'  },
        { name: 'blendSrc',         kind: 'number'  },
        { name: 'blendDst',         kind: 'number'  },
        { name: 'alphaTestEnable',  kind: 'boolean' },
        { name: 'alphaTestFunc',    kind: 'number'  },
        { name: 'alphaTestRef',     kind: 'number'  },
        { name: 'zWrite',           kind: 'boolean' },
      ], `parseEffect impls[${i}].blend`);

      // samplers: validate each entry if non-empty
      const samplers = impl['samplers'] as unknown[];
      // TODO(R5-xfail): for now accept [] — will tighten once PTXM decoded
      // When fixed: expect(samplers.length).toBeGreaterThan(0);
      for (let j = 0; j < samplers.length; j++) {
        assertShape(samplers[j], [
          { name: 'index', kind: 'number' },
          { name: 'role',  kind: 'string' },
        ], `parseEffect impls[${i}].samplers[${j}]`);
      }
    }
  });
});

// ─── parsePalette — PaletteParseResult contract ──────────────────────────────
//
// Contract: PaletteParseResult { entryCount, versionOrComponentCount, entries: PaletteEntry[] }
// PaletteEntry: { r, g, b, a }
// Synthetic fixture — always runs (committed to repo).

describe('parsePalette — PaletteParseResult contract (synthetic fixture, always runs)', () => {
  const FIXTURE = FIXTURE_PATHS.palette;

  it('result has entryCount, versionOrComponentCount, entries[]', () => {
    const bytes = loadFixture(FIXTURE);
    if (!bytes) {
      throw new Error(`FATAL: synthetic fixture ${FIXTURE} is MISSING — should be committed`);
    }

    const result = nativeCore.parsePalette(bytes) as Record<string, unknown>;

    assertShape(result, [
      { name: 'entryCount',              kind: 'number' },
      { name: 'versionOrComponentCount', kind: 'number' },
      { name: 'entries',                 kind: 'array'  },
    ], 'parsePalette result');

    const entries = result['entries'] as unknown[];
    expect(entries.length).toBe(result['entryCount'] as number);
    expect(entries.length).toBeGreaterThan(0);

    for (let i = 0; i < entries.length; i++) {
      assertShape(entries[i], [
        { name: 'r', kind: 'number' },
        { name: 'g', kind: 'number' },
        { name: 'b', kind: 'number' },
        { name: 'a', kind: 'number' },
      ], `parsePalette entries[${i}]`);
    }
  });
});

// ─── resolveEntry — TreMountResolveResult contract ───────────────────────────
//
// Contract: TreMountResolveResult { winner: string|null, tombstone: boolean, archiveIndex, entryIndex }
//
// REGRESSION R1: result has .winner and .tombstone; must NOT have .found.
// Original bug: resolver code read `.found` which was never emitted (it had `.winner`).
// Effect: every path resolution returned "not found" silently.

describe('resolveEntry — TreMountResolveResult contract (REGRESSION R1: .winner not .found)', () => {
  let handle = '';

  beforeAll(() => {
    const entries = [
      { name: 'appearance/player.apt', payload: new TextEncoder().encode('APT') },
    ];
    const treBytes = buildMinimalTre(entries);
    const trePath  = writeTempTre('conform-resolve-entry.tre', treBytes);
    handle = nativeCore.mountTreMount([trePath], [1]);
  });

  it('[R1] result has .winner, .tombstone, .archiveIndex, .entryIndex; NO .found', () => {
    const result = nativeCore.resolveEntry(handle, 'appearance/player.apt') as Record<string, unknown>;

    // R1: .winner must exist (the field that was present but never read by the resolver)
    assertShape(result, [
      { name: 'winner',       kind: 'string'  },
      { name: 'tombstone',    kind: 'boolean' },
      { name: 'archiveIndex', kind: 'number'  },
      { name: 'entryIndex',   kind: 'number'  },
    ], 'resolveEntry result');

    // R1 regression guard: .found must NOT be present (the field the renderer wrongly read)
    assertShape(result, [
      { name: 'found', kind: 'boolean', banned: true },
    ], 'resolveEntry result (banned fields)');

    // Verify the resolved path is non-null for a known file
    expect(result['winner']).toBeTruthy();
    expect(result['tombstone']).toBe(false);
    expect(result['archiveIndex']).toBeGreaterThanOrEqual(0);
    expect(result['entryIndex']).toBeGreaterThanOrEqual(0);
  });

  it('[R1] not-found path: winner is null, archiveIndex=-1, entryIndex=-1', () => {
    const result = nativeCore.resolveEntry(handle, 'nonexistent/file.bin') as Record<string, unknown>;

    // Shape must still be correct even for not-found
    assertShape(result, [
      { name: 'tombstone',    kind: 'boolean' },
      { name: 'archiveIndex', kind: 'number'  },
      { name: 'entryIndex',   kind: 'number'  },
    ], 'resolveEntry not-found result');

    // Not-found: winner is null, indices are -1
    expect(result['winner']).toBeNull();
    expect(result['archiveIndex']).toBe(-1);
    expect(result['entryIndex']).toBe(-1);
  });
});

// ─── resolveChain — TreShadowChainNative contract ────────────────────────────
//
// Contract: TreShadowChainNative { winner: string, shadows: string[], tombstone: boolean,
//                                   winnerArchiveIndex: number, winnerEntryIndex: number }

describe('resolveChain — TreShadowChainNative contract', () => {
  let handle = '';

  beforeAll(() => {
    const entries = [
      { name: 'appearance/player.apt', payload: new TextEncoder().encode('APT') },
    ];
    const treBytes = buildMinimalTre(entries);
    const trePath  = writeTempTre('conform-resolve-chain.tre', treBytes);
    handle = nativeCore.mountTreMount([trePath], [1]);
  });

  it('result has winner, shadows[], tombstone, winnerArchiveIndex, winnerEntryIndex', () => {
    const result = nativeCore.resolveChain(handle, 'appearance/player.apt') as Record<string, unknown>;

    assertShape(result, [
      { name: 'winner',             kind: 'string'  },
      { name: 'shadows',            kind: 'array'   },
      { name: 'tombstone',          kind: 'boolean' },
      { name: 'winnerArchiveIndex', kind: 'number'  },
      { name: 'winnerEntryIndex',   kind: 'number'  },
    ], 'resolveChain result');

    expect(result['winner']).toBeTruthy();
    expect(result['tombstone']).toBe(false);
    // Single archive — no shadows
    expect((result['shadows'] as unknown[]).length).toBe(0);
    expect(result['winnerArchiveIndex']).toBeGreaterThanOrEqual(0);
    expect(result['winnerEntryIndex']).toBeGreaterThanOrEqual(0);
  });
});

// ─── getMountEntriesColumnar — decoded shape contract ────────────────────────
//
// Contract (decoded): NativeMountVfsEntry { path, winnerArchivePath, winnerArchiveIndex,
//                                           shadowCount, isOverride, isTombstone }
// The blob itself is binary (ArrayBuffer); the test also validates the DECODED shape.

describe('getMountEntriesColumnar — decoded VfsEntry contract', () => {
  /** Mirror of TreVfsBrowser.tsx::decodeMountEntriesColumnar() — minimal inline decode. */
  function decodeColumnar(blob: ArrayBuffer): Record<string, unknown>[] {
    const dv  = new DataView(blob);
    const u8  = new Uint8Array(blob);
    const dec = new TextDecoder('utf-8');

    const entryCount         = dv.getUint32(0,  true);
    const nameDataOffset     = dv.getUint32(4,  true);
    const archPathDataOffset = dv.getUint32(12, true);
    const arrayOffset        = dv.getUint32(20, true);

    if (entryCount === 0) return [];

    const nameOffBase  = arrayOffset;
    const archOffBase  = nameOffBase  + entryCount * 4;
    const winnerBase   = archOffBase  + entryCount * 4;
    const shadowBase   = winnerBase   + entryCount * 4;
    const flagsBase    = shadowBase   + entryCount * 4;

    function readCStr(dataOff: number, relOff: number): string {
      let end = dataOff + relOff;
      while (end < u8.length && u8[end] !== 0) end++;
      return dec.decode(u8.subarray(dataOff + relOff, end));
    }

    const result: Record<string, unknown>[] = [];
    for (let i = 0; i < entryCount; i++) {
      result.push({
        path:               readCStr(nameDataOffset,     dv.getUint32(nameOffBase + i * 4, true)),
        winnerArchivePath:  readCStr(archPathDataOffset, dv.getUint32(archOffBase + i * 4, true)),
        winnerArchiveIndex: dv.getInt32(winnerBase + i * 4, true),
        shadowCount:        dv.getInt32(shadowBase + i * 4, true),
        isOverride:         (u8[flagsBase + i]! & 0x01) !== 0,
        isTombstone:        (u8[flagsBase + i]! & 0x02) !== 0,
      });
    }
    return result;
  }

  it('blob is ArrayBuffer; decoded entries conform to NativeMountVfsEntry shape', () => {
    const entries = [
      { name: 'appearance/player.apt', payload: new TextEncoder().encode('APT') },
      { name: 'sound/ambient.snd',     payload: new TextEncoder().encode('SND') },
    ];
    const treBytes = buildMinimalTre(entries);
    const trePath  = writeTempTre('conform-columnar.tre', treBytes);
    const handle   = nativeCore.mountTreMount([trePath], [1]);

    try {
      const blob = nativeCore.getMountEntriesColumnar(handle);

      // blob is binary (ArrayBuffer)
      expect(blob).toBeInstanceOf(ArrayBuffer);

      const decoded = decodeColumnar(blob);
      expect(decoded.length).toBe(2);

      for (let i = 0; i < decoded.length; i++) {
        assertShape(decoded[i], [
          { name: 'path',               kind: 'string'  },
          { name: 'winnerArchivePath',  kind: 'string'  },
          { name: 'winnerArchiveIndex', kind: 'number'  },
          { name: 'shadowCount',        kind: 'number'  },
          { name: 'isOverride',         kind: 'boolean' },
          { name: 'isTombstone',        kind: 'boolean' },
        ], `getMountEntriesColumnar decoded[${i}]`);
      }

      // Verify paths are present
      const paths = decoded.map((e) => e['path'] as string);
      expect(paths).toContain('appearance/player.apt');
      expect(paths).toContain('sound/ambient.snd');
    } finally {
      nativeCore.disposeTreMount(handle);
    }
  });
});

// ─── Consolidated real-asset gating summary ───────────────────────────────────
//
// This is NOT a test — it logs a clear diagnostic when real assets are absent,
// so CI logs show a deliberate skip rather than silent test absence.

describe('contract-conformance: real-asset gating summary', () => {
  it('logs which real fixtures are present / absent', () => {
    const lines: string[] = ['Contract conformance fixture status:'];
    for (const [key, relPath] of Object.entries(FIXTURE_PATHS)) {
      const present = existsSync(join(REAL, relPath));
      lines.push(`  ${present ? 'PRESENT' : 'ABSENT '} [${key}] ${relPath}`);
    }
    if (!anyRealPresent) {
      lines.push('');
      lines.push('  All real fixtures absent — format-binding tests above were SKIPPED.');
      lines.push('  This is expected in CI. On a dev machine with fixtures-real/ populated,');
      lines.push('  all binding tests run and are authoritative.');
    }
    console.log(lines.join('\n'));
    // Always passes — this is a diagnostic test
    expect(true).toBe(true);
  });
});
