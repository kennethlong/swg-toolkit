// @vitest-environment node
/**
 * packages/native-core/test/tre-extract-at-descriptor.test.ts
 *
 * RED scaffold — native extractMountAt with externally-supplied entry descriptor.
 *
 * This test asserts the FUTURE native capability to extract a payload from a
 * master-.toc-sourced entry descriptor against a v6000 container whose internal
 * TOC is empty (numberOfFiles=0). It proves that extraction does NOT consult the
 * container's empty internal TOC — it uses the descriptor supplied by the caller
 * (which came from the master sku3_client.toc).
 *
 * STATUS: RED / skip until plan 10 (MOUNT-03/04) implements the runtime.
 *   - Skips when fixture or container file is absent (CI without SWGSource Client v3.0).
 *   - FAILS with "extractMountAt not implemented" when fixture+container are present but
 *     the native binding lacks extractMountAt — this is the expected RED signal.
 *   - Passes green after plan 10 wires the runtime.
 *
 * Fixture source: packages/harness/fixtures-real/toc/ (committed by plan 04.3-03)
 *   *.v6000.descriptor.json — container, offset, length, compressedLength, compressor, crc
 *   *.v6000.expected.bin    — expected decompressed bytes (ground-truth oracle)
 *
 * Container: D:/Code/SWGSource Client v3.0/{desc.container}
 *   patch_sku3_24_client_00.tre — EERT6000, numberOfFiles=0, plain-zlib payload at offset 36+
 *   The container's internal TOC is EMPTY; extraction MUST use the descriptor alone.
 *
 * Typing stub (DECLARATION ONLY — runtime in plan 10):
 *   extractMountAt(handle, archiveIndex, { offset, length, compressedLength, compressor })
 *   → ExtractAtResult: { bytes?: ArrayBuffer; encrypted?: boolean }
 *
 * Ground truth: ../swg-blender-plugin/swg_pipeline/tre_reader.py::read_tre_payload
 *
 * De-anchoring note (LOCKED):
 *   v6000 is dual-format. This test targets SWG-Source plain-zlib patch_sku3_* containers.
 *   Restoration v6000 (encrypted) should return { encrypted: true } — tested separately.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filedirname = dirname(fileURLToPath(import.meta.url));

// Fixture directory (committed by plan 04.3-03)
const FIXTURE_DIR   = join(__filedirname, '..', '..', 'harness', 'fixtures-real', 'toc');
// Real SWGSource client root (only exists on dev machines)
const CLIENT_ROOT   = 'D:/Code/SWGSource Client v3.0';

// ─── Native addon ──────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../index.js') as {
  mountTreMount:    (paths: string[], priorities: number[]) => string;
  disposeTreMount:  (handle: string) => void;
  extractMountAt?:  (handle: string, archiveIndex: number, descriptor: {
    offset: number; length: number; compressedLength: number; compressor: number;
  }) => { bytes?: ArrayBuffer; encrypted?: boolean };
};

// ─── Discover fixtures ─────────────────────────────────────────────────────────

interface FixtureSet {
  baseName:       string;
  expectedPath:   string;
  descriptorPath: string;
  descriptor:     {
    virtualPath:      string;
    container:        string;
    offset:           number;
    length:           number;
    compressedLength: number;
    compressor:       number;
    crc:              number;
  };
  containerPath: string;
}

function discoverFixtures(): FixtureSet[] {
  if (!existsSync(FIXTURE_DIR)) return [];

  return readdirSync(FIXTURE_DIR)
    .filter(name => name.endsWith('.v6000.descriptor.json'))
    .map(name => {
      const baseName       = name.replace(/\.v6000\.descriptor\.json$/, '');
      const descriptorPath = join(FIXTURE_DIR, name);
      const expectedPath   = join(FIXTURE_DIR, `${baseName}.v6000.expected.bin`);

      if (!existsSync(descriptorPath) || !existsSync(expectedPath)) return null;

      const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf-8')) as FixtureSet['descriptor'];
      const containerPath = join(CLIENT_ROOT, descriptor.container);

      return { baseName, expectedPath, descriptorPath, descriptor, containerPath };
    })
    .filter((f): f is FixtureSet => f !== null && existsSync(f.containerPath));
}

const fixtures = discoverFixtures();
const hasRunnable = fixtures.length > 0;

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('native extractMountAt — externally-supplied descriptor (RED until plan 10)', () => {
  for (const fixture of fixtures) {
    // Skip when container is absent (CI) or fixture files are absent.
    // FAILS (RED) when container present but extractMountAt not yet implemented.
    it.skipIf(!hasRunnable)(
      `extractMountAt extracts v6000 master-TOC payload: ${fixture.baseName}`,
      () => {
        const { descriptor, containerPath, expectedPath } = fixture;

        // ── RED GATE: extractMountAt must exist in the native binding ──────────
        // This expect FAILS until plan 10 implements the runtime.
        // When it fails, the test is RED (as intended). Plan 10 turns it green.
        expect(
          typeof nativeCore.extractMountAt,
          'extractMountAt binding not implemented — RED until plan 10 (MOUNT-03/04)',
        ).toBe('function');

        // ── Lines below only run after plan 10 wires the runtime ──────────────

        // Mount the v6000 container (numberOfFiles=0 — internal TOC is empty)
        // Priority 0 is sufficient for a single-archive mount.
        const handle = nativeCore.mountTreMount([containerPath], [0]);

        try {
          // archiveIndex=0: the only archive in this single-archive mount.
          // descriptor carries offset/length/compressedLength/compressor from master .toc.
          // extractMountAt MUST NOT consult the container's empty internal TOC (T-B-H1).
          const result = nativeCore.extractMountAt!(handle, 0, {
            offset:           descriptor.offset,
            length:           descriptor.length,
            compressedLength: descriptor.compressedLength,
            compressor:       descriptor.compressor,
          });

          // swg-source v6000 is plain-zlib — must NOT be classified as encrypted
          expect(
            result.encrypted,
            `plain-zlib v6000 payload must not be classified encrypted (virtualPath: ${descriptor.virtualPath})`,
          ).toBeFalsy();

          // bytes must be present and non-empty
          expect(result.bytes, 'ExtractAtResult.bytes must be defined on success').toBeDefined();

          // Byte-exact assertion against the committed ground-truth oracle
          const inflated = Buffer.from(result.bytes!);
          const expected = readFileSync(expectedPath);

          expect(
            inflated.length,
            `inflated length must equal declared uncompressed length ${descriptor.length}`,
          ).toBe(descriptor.length);

          expect(
            Buffer.compare(inflated, expected),
            `extractMountAt bytes must equal *.v6000.expected.bin byte-for-byte ` +
            `(virtualPath: ${descriptor.virtualPath})`,
          ).toBe(0);
        } finally {
          nativeCore.disposeTreMount(handle);
        }
      },
    );
  }

  // Guard: visible skip marker when no runnable fixture+container pair found.
  it.skipIf(hasRunnable)(
    'no runnable fixtures — fixture or SWGSource container absent (CI skip)',
    () => {
      // Runs only when hasRunnable=false; just documents the skip reason.
      expect(hasRunnable, 'regenerate with: node packages/harness/scripts/extract-v6000-fixture.mjs').toBe(false);
    },
  );
});
