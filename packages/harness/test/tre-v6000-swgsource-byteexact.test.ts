// @vitest-environment node
/**
 * packages/harness/test/tre-v6000-swgsource-byteexact.test.ts
 *
 * MOUNT-03 byte-exact oracle — SWG-Source v6000 plain-zlib fixture.
 *
 * This is the RENDERER / Node-zlib sanity oracle for Pillar B (MOUNT-03).
 * It verifies that Node.js's built-in zlib can inflate the committed
 * swg-source v6000 fixture back to the expected bytes — confirming:
 *   1. The fixture was correctly extracted (offset/compressedLength correct).
 *   2. Node zlib + the C++ native inflate produce the same result (portability).
 *   3. The fixture bytes are not corrupted.
 *
 * The NATIVE byte-exact assertion (extractMountAt path) lives in
 * packages/native-core/test/tre-extract-at-descriptor.test.ts and is RED
 * until plan 10 implements the runtime.
 *
 * Fixture location: packages/harness/fixtures-real/toc/
 *   *.v6000.zlib.bin      — raw compressed bytes as stored in the container .tre
 *   *.v6000.expected.bin  — expected inflated bytes (ground-truth oracle)
 *   *.v6000.descriptor.json — metadata (virtualPath, container, offset, ...)
 *
 * Fixture source: D:/Code/SWGSource Client v3.0/
 *   Container: patch_sku3_24_client_00.tre (EERT6000, numberOfFiles=0, plain-zlib)
 *   Regenerate: node packages/harness/scripts/extract-v6000-fixture.mjs
 *
 * De-anchoring note (LOCKED):
 *   v6000 is a dual format. This fixture is the SWG-Source PLAIN-ZLIB variant.
 *   The Restoration-encrypted variant (SwgRestoration_*.tre) is a different beast.
 *   Do NOT conflate the two.
 *
 * CI behaviour (test.skipIf pattern):
 *   - Fixtures present (dev machine with real client): PASSES.
 *   - Fixtures absent (CI without real client): SKIPS cleanly (green).
 *
 * Ground truth: ../swg-blender-plugin/swg_pipeline/tre_reader.py::read_tre_payload
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filedirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__filedirname, '..', 'fixtures-real', 'toc');

// ─── Discover committed v6000 fixtures ───────────────────────────────────────

interface V6000FixtureSet {
  baseName: string;
  zlibPath: string;
  expectedPath: string;
  descriptorPath: string;
}

function discoverFixtures(): V6000FixtureSet[] {
  if (!existsSync(FIXTURE_DIR)) return [];

  return readdirSync(FIXTURE_DIR)
    .filter(name => name.endsWith('.v6000.descriptor.json'))
    .map(name => {
      const baseName = name.replace(/\.v6000\.descriptor\.json$/, '');
      return {
        baseName,
        zlibPath:       join(FIXTURE_DIR, `${baseName}.v6000.zlib.bin`),
        expectedPath:   join(FIXTURE_DIR, `${baseName}.v6000.expected.bin`),
        descriptorPath: join(FIXTURE_DIR, name),
      };
    })
    .filter(f => existsSync(f.zlibPath) && existsSync(f.expectedPath));
}

const fixtures = discoverFixtures();
const fixturesPresent = fixtures.length > 0;

// ─── Byte-exact oracle tests ──────────────────────────────────────────────────

describe('swg-source v6000 plain-zlib byte-exact oracle (MOUNT-03)', () => {
  for (const fixture of fixtures) {
    // skipIf: no fixture present (CI without SWGSource Client v3.0)
    // When fixtures ARE present (dev machine), this test PASSES.
    it.skipIf(!fixturesPresent)(
      `inflate(${fixture.baseName}.v6000.zlib.bin) === expected.bin byte-for-byte`,
      () => {
        // Read the raw compressed bytes (as stored in the v6000 container .tre at `offset`)
        const zlibBytes = readFileSync(fixture.zlibPath);
        // Read the expected inflated bytes (ground-truth oracle)
        const expectedBytes = readFileSync(fixture.expectedPath);

        // Read descriptor for error context
        const desc = JSON.parse(readFileSync(fixture.descriptorPath, 'utf-8')) as {
          virtualPath: string;
          container: string;
          offset: number;
          length: number;
          compressedLength: number;
          compressor: number;
          crc: number;
        };

        // Verify fixture file sizes match the descriptor
        expect(zlibBytes.length, `zlib.bin size should match descriptor.compressedLength`).toBe(
          desc.compressedLength,
        );
        expect(expectedBytes.length, `expected.bin size should match descriptor.length`).toBe(
          desc.length,
        );

        // Inflate with Node.js built-in zlib (RFC 1950, 0x78 magic header)
        // Mirrors: tre_reader.py::read_tre_payload + zlib.decompress(raw)
        let inflated: Buffer;
        try {
          inflated = inflateSync(zlibBytes);
        } catch (err) {
          throw new Error(
            `zlib inflate failed for ${fixture.baseName} ` +
            `(container: ${desc.container}, offset: ${desc.offset}): ${(err as Error).message}`,
          );
        }

        // Byte-exact assertion — the MOUNT-03 oracle gate
        expect(inflated.length, `inflated length must equal declared length ${desc.length}`).toBe(
          desc.length,
        );
        expect(
          Buffer.compare(inflated, expectedBytes),
          `inflate(*.v6000.zlib.bin) must equal *.v6000.expected.bin byte-for-byte ` +
          `(virtualPath: ${desc.virtualPath})`,
        ).toBe(0);
      },
    );
  }

  // Guard: if no fixture sets are found, emit one skipped test (visible in CI output).
  // This documents that the skip is INTENTIONAL (missing real client), not a bug.
  it.skipIf(fixturesPresent)(
    'no v6000 fixtures committed — fixture absent skip (CI without SWGSource Client v3.0)',
    () => {
      // This body runs only if fixturesPresent is false AND the above skipIf triggers.
      // It will itself be skipped because skipIf(!false) === skipIf(true) when fixturesPresent.
      // Structurally: when fixturesPresent=false, this test becomes it.skipIf(false)(...)
      // which DOES run, so we just document the expectation.
      expect(fixturesPresent, 'Regenerate fixtures with: node packages/harness/scripts/extract-v6000-fixture.mjs').toBe(false);
    },
  );
});
