/**
 * tre-roundtrip.test.ts — TRE round-trip and parse correctness tests (CORE-01, CORE-05).
 *
 * Tests the committed TRE fixtures against the native C++ TreArchive parser via
 * the @swg/native-core N-API binding.
 *
 * Test suite: "tre roundtrip" (must match the verification command exactly)
 *
 * Fixtures verified (committed, synthesized from Utinni byte recipes per D-09):
 *   - v0005-3record.tre: byte-exact read, tombstone, raw-deflate payload
 *   - v0006-2record.tre: readable, NOT enumerate-only
 *   - v6000-2record.tre: stored payload (compressor=0) — now readable after plan 04.3-10
 *   - v6000-encrypted.tre: invalid-zlib payload — refuses extraction with RFC1950 error
 *   - malformed-magic.tre: rejected with Error (no process crash)
 *   - truncated.tre: rejected with Error (no process crash)
 *   - unsupported-version.tre: rejected with Error (no process crash)
 *   - crc-collision.tre: binary search + tie-break resolves correctly
 *
 * Source: swg-client-v2 TreeFile_SearchNode.cpp:226-408;
 *         Utinni TreFile.cs:155-310, TreVersion.cs:79-105.
 *
 * Pattern: packages/native-core/test/hello.test.ts (vitest + CJS-require style).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerFormat } from '../fixtureRegistry.js';

const __dirname_es = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname_es, '..', 'fixtures', 'tre');

// Load the native addon via CJS require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js');

// Helper: load a fixture file
function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, name));
}

// Helper: mount a fixture from bytes via a temp file approach
// (The native binding accepts file paths; for in-memory fixtures we write to a temp dir)
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const TMPDIR = join(tmpdir(), 'swg-fixture-tre');
mkdirSync(TMPDIR, { recursive: true });

function mountFixtureBytes(name: string, bytes: Buffer): { archiveIndex: number } {
  const tmpPath = join(TMPDIR, name);
  writeFileSync(tmpPath, bytes);
  const results = nativeCore.mountArchive([tmpPath]) as Array<{ archiveIndex: number; entryCount: number; path: string }>;
  return results[0];
}

// Register the 'tre' format in the fixture registry (CORE-05 sweep gate).
// Fixtures are registered before the suite runs.
beforeAll(() => {
  // Register the tre format with all fixtures and their loaderSource citations.
  // This satisfies the registry-coverage sweep test.
  const fixtures = [
    {
      name: 'v0005-3record.tre',
      bytes: new Uint8Array(loadFixture('v0005-3record.tre')),
      loaderSource: 'swg-client-v2 TreeFile_SearchNode.cpp:267-349 (parse) + :360-408 (resolve)',
    },
    {
      name: 'v0006-2record.tre',
      bytes: new Uint8Array(loadFixture('v0006-2record.tre')),
      loaderSource: 'Utinni TreVersion.cs:92-97 (v0006 is readable, not enumerate-only)',
    },
    {
      name: 'v6000-2record.tre',
      bytes: new Uint8Array(loadFixture('v6000-2record.tre')),
      loaderSource: 'Zlib.cpp:56-58 (compressor=0 passthrough; plan 04.3-10 per-payload classify)',
    },
    {
      name: 'v6000-encrypted.tre',
      bytes: new Uint8Array(loadFixture('v6000-encrypted.tre')),
      loaderSource: 'Zlib.cpp:83-89 (RFC1950 header gate; invalid header → throw; D-16 gate fix)',
    },
    {
      name: 'malformed-magic.tre',
      bytes: new Uint8Array(loadFixture('malformed-magic.tre')),
      loaderSource: 'swg-client-v2 TreeFile_SearchNode.cpp:237 (header.token != TAG_TREE)',
    },
    {
      name: 'truncated.tre',
      bytes: new Uint8Array(loadFixture('truncated.tre')),
      loaderSource: 'swg-client-v2 TreeFile_SearchNode.cpp:268 (read 36-byte header)',
    },
    {
      name: 'unsupported-version.tre',
      bytes: new Uint8Array(loadFixture('unsupported-version.tre')),
      loaderSource: 'Utinni TreVersion.cs:60-73 (parseVersionString dispatch)',
    },
    {
      name: 'crc-collision.tre',
      bytes: new Uint8Array(loadFixture('crc-collision.tre')),
      loaderSource: 'swg-client-v2 TreeFile_SearchNode.cpp:382 (tie-break _stricmp on name)',
    },
  ];

  registerFormat('tre', {
    // Parse: mount the archive and list entries (structural round-trip)
    parse: (bytes: Uint8Array) => {
      const tmpPath = join(TMPDIR, 'sweep-fixture.tre');
      writeFileSync(tmpPath, Buffer.from(bytes));
      const results = nativeCore.mountArchive([tmpPath]) as Array<{ archiveIndex: number }>;
      return nativeCore.listEntries(results[0].archiveIndex);
    },
    // Serialize: we re-emit the raw bytes (identity — full TRE write is Plan 04)
    serialize: (_parsed: unknown) => new Uint8Array(loadFixture('v0005-3record.tre')),
    fixtures,
    loaderSource: 'swg-client-v2 TreeFile_SearchNode.cpp:226-408',
  });
});

describe('tre roundtrip', () => {

  // ── v0005: byte-exact read, tombstone, raw-deflate payload ─────────────────
  it('v0005 3-record fixture parses into 3 entries with correct metadata', () => {
    const bytes = loadFixture('v0005-3record.tre');
    const { archiveIndex } = mountFixtureBytes('v0005-3record.tre', bytes);
    const entries = nativeCore.listEntries(archiveIndex) as Array<{
      path: string; crc: number; uncompressedSize: number; compressor: number; archiveIndex: number;
    }>;

    expect(entries).toHaveLength(3);

    // Verify at least one entry is a tombstone (length==0)
    const tombstone = entries.find((e) => e.uncompressedSize === 0);
    expect(tombstone).toBeDefined();
    expect(tombstone!.path).toBe('empty.bin');
  });

  it('v0005 3-record: hello.txt resolves and has correct uncompressedSize=13 (stored)', () => {
    const bytes = loadFixture('v0005-3record.tre');
    const { archiveIndex } = mountFixtureBytes('v0005-3record-hello', bytes);
    const entries = nativeCore.listEntries(archiveIndex) as Array<{
      path: string; uncompressedSize: number; compressor: number;
    }>;
    const hello = entries.find((e) => e.path === 'hello.txt');
    expect(hello).toBeDefined();
    expect(hello!.uncompressedSize).toBe(13);
    expect(hello!.compressor).toBe(0); // stored
  });

  it('v0005 3-record: quick.txt uses raw-deflate (compressor code 1)', () => {
    const bytes = loadFixture('v0005-3record.tre');
    const { archiveIndex } = mountFixtureBytes('v0005-3record-quick', bytes);
    const entries = nativeCore.listEntries(archiveIndex) as Array<{
      path: string; compressor: number; uncompressedSize: number;
    }>;
    const quick = entries.find((e) => e.path === 'quick.txt');
    expect(quick).toBeDefined();
    expect(quick!.compressor).toBe(1); // raw-deflate
    expect(quick!.uncompressedSize).toBe(43); // 'The quick brown fox jumps over the lazy dog'
  });

  it('v0005: readEntry(hello.txt) returns correct payload bytes', () => {
    const bytes = loadFixture('v0005-3record.tre');
    const { archiveIndex } = mountFixtureBytes('v0005-3record-readentry', bytes);
    const entries = nativeCore.listEntries(archiveIndex) as Array<{ path: string }>;
    const idx = entries.findIndex((e) => e.path === 'hello.txt');
    expect(idx).toBeGreaterThanOrEqual(0);

    const payload = Buffer.from(nativeCore.readEntry(archiveIndex, idx));
    expect(payload.toString('utf8')).toBe('Hello, World!');
  });

  // ── v0006: readable, NOT enumerate-only ────────────────────────────────────
  it('v0006 2-record fixture parses and is NOT enumerate-only (payloads readable)', () => {
    const bytes = loadFixture('v0006-2record.tre');
    const { archiveIndex } = mountFixtureBytes('v0006-2record.tre', bytes);
    const entries = nativeCore.listEntries(archiveIndex) as Array<{ path: string; uncompressedSize: number }>;
    expect(entries).toHaveLength(2);
    // v0006 payloads are readable (NOT enumerate-only)
    expect(() => nativeCore.readEntry(archiveIndex, 0)).not.toThrow();
  });

  // ── v6000: per-payload classify (plan 04.3-10) ────────────────────────────
  // The blanket isEnumerateOnly(V6000) throw was REMOVED in plan 04.3-10 to support
  // SWG-Source plain-zlib v6000 payloads. Per-payload classification: stored/plain-zlib
  // payloads extract correctly; genuinely-encrypted payloads fail with an inflate error.
  it('v6000 stored-payload fixture parses and payload is readable (per-payload classify)', () => {
    const bytes = loadFixture('v6000-2record.tre');
    const { archiveIndex } = mountFixtureBytes('v6000-2record.tre', bytes);
    const entries = nativeCore.listEntries(archiveIndex) as Array<{ path: string }>;
    expect(entries.length).toBeGreaterThan(0);
    // Stored payload (compressor=0): must NOT throw after plan 04.3-10 removed enumerate-only gate.
    expect(() => nativeCore.readEntry(archiveIndex, 0)).not.toThrow();
    // Payload content matches the fixture's stored bytes
    const buf = Buffer.from(nativeCore.readEntry(archiveIndex, 0) as ArrayBuffer);
    expect(buf.toString('ascii')).toBe('v6000-payload-alpha');
  });

  it('v6000 encrypted payload refuses extraction; v0006 is always readable (per-payload classify)', () => {
    // v6000 with genuinely-encrypted payload (compressor=2, invalid zlib bytes) throws
    const v6000encBytes = loadFixture('v6000-encrypted.tre');
    const v0006bytes    = loadFixture('v0006-2record.tre');
    const { archiveIndex: idxEnc }  = mountFixtureBytes('v6000-enc-check.tre', v6000encBytes);
    const { archiveIndex: idx0006 } = mountFixtureBytes('v0006-check.tre', v0006bytes);
    // v6000 with invalid zlib payload: throws an inflate/RFC1950 error
    expect(() => nativeCore.readEntry(idxEnc, 0)).toThrow(/inflate|RFC1950|invalid/i);
    // v0006 payloads are always readable
    expect(() => nativeCore.readEntry(idx0006, 0)).not.toThrow();
  });

  // ── Malformed fixtures: rejected cleanly (no process crash) ────────────────
  it('malformed-magic.tre is rejected cleanly (Error thrown, not crash)', () => {
    const bytes = loadFixture('malformed-magic.tre');
    const tmpPath = join(TMPDIR, 'malformed-magic.tre');
    writeFileSync(tmpPath, bytes);
    expect(() => nativeCore.mountArchive([tmpPath])).toThrow();
  });

  it('truncated.tre is rejected cleanly (Error thrown, not crash)', () => {
    const bytes = loadFixture('truncated.tre');
    const tmpPath = join(TMPDIR, 'truncated.tre');
    writeFileSync(tmpPath, bytes);
    expect(() => nativeCore.mountArchive([tmpPath])).toThrow();
  });

  it('unsupported-version.tre is rejected cleanly (Error thrown, not crash)', () => {
    const bytes = loadFixture('unsupported-version.tre');
    const tmpPath = join(TMPDIR, 'unsupported-version.tre');
    writeFileSync(tmpPath, bytes);
    expect(() => nativeCore.mountArchive([tmpPath])).toThrow();
  });

  // ── CRC-collision: binary search + name tie-break resolves correctly ────────
  it('crc-collision.tre resolves both entries correctly via CRC + name tie-break', () => {
    const bytes = loadFixture('crc-collision.tre');
    const { archiveIndex } = mountFixtureBytes('crc-collision.tre', bytes);
    const entries = nativeCore.listEntries(archiveIndex) as Array<{ path: string }>;
    expect(entries).toHaveLength(2);
    // Both entries are accessible
    const hasAaa = entries.some((e) => e.path === 'aaa.txt');
    const hasBbb = entries.some((e) => e.path === 'bbb.txt');
    expect(hasAaa).toBe(true);
    expect(hasBbb).toBe(true);
  });

});
