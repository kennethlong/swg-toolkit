// @vitest-environment node
/**
 * packages/native-core/test/tre-codec.test.ts
 *
 * RED scaffold — Task 1 (plan 04.4-06): TreCodec pluggable-codec seam, round-3 widened
 * scope (payload AND TOC/name-block compression dispatch, per the maintainer's D-21 ruling).
 *
 * This is a SEAM refactor: TreArchive/TreBuilder's public parse()/build() behavior does
 * NOT change (byte-identical output before/after). Because of that, the black-box parity
 * assertions below (Sections 1-3) are expected to ALREADY PASS on unmodified code — they
 * are regression guards, not the RED gate. Per this plan's own round-1 hedge ("this task
 * may find the black-box assertions already pass at the binding level — in that case, add
 * a more direct... test asserting codecForCompressor/codecForTreVersion/codecForBlockCompressor
 * are actually being invoked, not the direct free functions or the old bypass branches"),
 * Section 4 below is the actual RED/GREEN gate: it reads the real TreArchive.cpp/TreBuilder.cpp/
 * TreCodec.h source text and asserts the widened codec-dispatch seam is textually present
 * (and the old tocCompressor==0/blockCompressor==0 bypass branches are GONE, folded into
 * StoredCodec). Section 4 FAILS on unmodified code (TreCodec.h doesn't exist yet, call sites
 * are unchanged) and PASSES only after Task 2 implements the seam — this is the same check
 * as Task 2's acceptance_criteria grep commands, just run inside vitest for a genuine gate.
 *
 * Ground truth (VERIFIED 2026-07-03 by direct read; round-3 by Cursor CONSULT-R3-cursor.out):
 *   TreArchive.cpp:188-189/192-193  — TOC bypass + inflate (round-3 IN SCOPE)
 *   TreArchive.cpp:212-213/215-216  — name-block bypass + inflate (round-3 IN SCOPE)
 *   TreArchive.cpp:342, :397        — PAYLOAD inflate (round-2 scope, unchanged)
 *   TreBuilder.cpp:130 zlibCompress — extracted into Zlib.h/.cpp treDeflate (Task 2 Step 1)
 *   TreBuilder.cpp:267-274          — PAYLOAD deflate (round-2 scope, unchanged)
 *   TreBuilder.cpp:333, :357        — TOC/name-block deflate (round-3 IN SCOPE)
 *
 * Source: 04.4-06-PLAN.md <interfaces> + round-3 revision note.
 * Pattern: packages/native-core/test/packPatch.test.ts (buildTre/mountArchive black-box style).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname_es = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname_es, '..', '..', 'harness', 'fixtures', 'tre');

const TMP = join(tmpdir(), 'swg-tre-codec-test');
mkdirSync(TMP, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../index.js') as {
  mountArchive: (paths: string[]) => Array<{ archiveIndex: number; entryCount: number; path: string }>;
  listEntries: (idx: number) => Array<{
    path: string; crc: number; uncompressedSize: number; compressedSize: number;
    compressor: number; archiveIndex: number;
  }>;
  readEntry: (archiveIdx: number, entryIdx: number) => ArrayBuffer;
  buildTre: (
    entries: Array<{ path: string; data?: Uint8Array; tombstone?: boolean }>,
    version?: string,
  ) => ArrayBuffer;
  repackTre: (
    sourcePath: string,
    edits?: Array<{ index: number; data: Uint8Array }>,
    version?: string,
  ) => ArrayBuffer;
};

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, name));
}

function mountBytes(tmpName: string, bytes: Buffer | Uint8Array): { archiveIndex: number; path: string } {
  const tmpPath = join(TMP, tmpName);
  writeFileSync(tmpPath, Buffer.from(bytes));
  const results = nativeCore.mountArchive([tmpPath]);
  return { archiveIndex: results[0].archiveIndex, path: tmpPath };
}

// ─── Section 1: PAYLOAD inflate/deflate parity (round-2 scope, unchanged) ────────────

describe('TreCodec payload parity (codecForCompressor / codecForTreVersion)', () => {
  it('v0005 3-record fixture: stored payload (hello.txt) inflates to the exact original bytes', () => {
    const bytes = loadFixture('v0005-3record.tre');
    const { archiveIndex } = mountBytes('codec-payload-hello.tre', bytes);
    const entries = nativeCore.listEntries(archiveIndex);
    const idx = entries.findIndex((e) => e.path === 'hello.txt');
    expect(idx).toBeGreaterThanOrEqual(0);
    const payload = Buffer.from(nativeCore.readEntry(archiveIndex, idx));
    expect(payload.toString('utf8')).toBe('Hello, World!');
  });

  it('v0005 3-record fixture: raw-deflate payload (quick.txt, compressor=1) inflates correctly', () => {
    const bytes = loadFixture('v0005-3record.tre');
    const { archiveIndex } = mountBytes('codec-payload-quick.tre', bytes);
    const entries = nativeCore.listEntries(archiveIndex);
    const idx = entries.findIndex((e) => e.path === 'quick.txt');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(entries[idx].compressor).toBe(1);
    const payload = Buffer.from(nativeCore.readEntry(archiveIndex, idx));
    expect(payload.toString('utf8')).toBe('The quick brown fox jumps over the lazy dog');
  });

  it('buildTre payload deflate (codecForTreVersion -> shared treDeflate) is deterministic for a >1024-byte payload', () => {
    // Payload > 1024 bytes triggers the zlib compression branch (TreBuilder zlibCompress gate).
    const bigPayload = new Uint8Array(4096);
    for (let i = 0; i < bigPayload.length; i++) bigPayload[i] = (i * 7) % 251;
    const entries = [{ path: 'big/payload.bin', data: bigPayload }];

    const build1 = new Uint8Array(nativeCore.buildTre(entries, '0005'));
    const build2 = new Uint8Array(nativeCore.buildTre(entries, '0005'));

    expect(build1.length).toBe(build2.length);
    expect(build1.length).toBeGreaterThan(36); // more than just a bare header
    for (let i = 0; i < build1.length; i++) {
      expect(build1[i]).toBe(build2[i]);
    }

    // Round-trip: mount the freshly-built archive and confirm the payload inflates back correctly
    // (payload deflate -> inflate through the codec seam must be a perfect identity round-trip).
    const { archiveIndex } = mountBytes('codec-payload-deflate.tre', build1);
    const listed = nativeCore.listEntries(archiveIndex);
    expect(listed).toHaveLength(1);
    const roundTripped = Buffer.from(nativeCore.readEntry(archiveIndex, 0));
    expect(roundTripped.equals(Buffer.from(bigPayload))).toBe(true);
  });
});

// ─── Section 2: TOC/name-block inflate/deflate parity (round-3 widened scope) ───────

describe('TreCodec TOC/name-block parity (codecForBlockCompressor, round-3 widened seam)', () => {
  it('v0005 3-record fixture: TOC + name block parse correctly (StoredCodec/ZlibCodec dispatch via codecForBlockCompressor)', () => {
    const bytes = loadFixture('v0005-3record.tre');
    const { archiveIndex } = mountBytes('codec-toc-v0005.tre', bytes);
    const entries = nativeCore.listEntries(archiveIndex);
    expect(entries).toHaveLength(3);
    // All three names must have resolved through the (possibly-compressed) name block correctly.
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toEqual(['empty.bin', 'hello.txt', 'quick.txt']);
  });

  it('buildTre with many entries (TOC/name block large enough to exercise compression) mounts back structurally identical', () => {
    // 60 entries * stride 24 = 1440 bytes TOC (> 1024 zlibCompress gate) so both the
    // codecForBlockCompressor(StoredCodec) AND codecForBlockCompressor(ZlibCodec) dispatch
    // paths are exercised across a real build+mount, depending on which is smaller.
    const entries = Array.from({ length: 60 }, (_, i) => ({
      path: `dir/entry_${String(i).padStart(3, '0')}.txt`,
      data: new TextEncoder().encode(`payload contents for entry number ${i}`),
    }));

    const built = new Uint8Array(nativeCore.buildTre(entries, '0005'));
    const { archiveIndex } = mountBytes('codec-toc-manyentries.tre', built);
    const listed = nativeCore.listEntries(archiveIndex);
    expect(listed).toHaveLength(60);

    const gotPaths = listed.map((e) => e.path).sort();
    const wantPaths = entries.map((e) => e.path).sort();
    expect(gotPaths).toEqual(wantPaths);

    // Every payload must round-trip byte-exact through the (TOC-dispatched) codec.
    for (const e of entries) {
      const idx = listed.findIndex((l) => l.path === e.path);
      expect(idx).toBeGreaterThanOrEqual(0);
      const payload = Buffer.from(nativeCore.readEntry(archiveIndex, idx));
      expect(payload.equals(Buffer.from(e.data))).toBe(true);
    }
  });

  it('full-archive round-trip: buildTre -> write -> repackTre(no edits) reproduces byte-identical archive (single entry, trivial TOC order)', () => {
    // Single entry avoids response-file-order vs. crc-sorted-TOC-order divergence between
    // the original build and repack's re-derivation from TreArchive::entries() (crc order).
    // Payload is > 1024 bytes and compressible so BOTH the original build and the repack's
    // raw-slice-copy path land on compressor=2 with an identical compressedLength (avoids an
    // unrelated pre-existing TreBuilder quirk where compressor==0 entries record
    // compressedLength=0 on a fresh build vs. the raw-slice size on a repack of the same entry
    // — out of scope for this codec-seam refactor; not exercised by picking a compressible
    // payload that always takes the compressor=2 branch on both sides).
    const payload = new Uint8Array(2048);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 7;
    const entries = [{ path: 'solo/payload.bin', data: payload }];
    const built = new Uint8Array(nativeCore.buildTre(entries, '0005'));
    const tmpPath = join(TMP, 'codec-repack-identity.tre');
    writeFileSync(tmpPath, Buffer.from(built));

    const repacked = new Uint8Array(nativeCore.repackTre(tmpPath, []));

    expect(repacked.length).toBe(built.length);
    for (let i = 0; i < built.length; i++) {
      if (built[i] !== repacked[i]) {
        throw new Error(
          `full-archive round-trip byte mismatch @ offset 0x${i.toString(16)}: ` +
          `built=0x${built[i].toString(16)}, repacked=0x${repacked[i].toString(16)}`,
        );
      }
    }
  });
});

// ─── Section 3: No-regression — graceful classify + V6000 write-refusal ─────────────

describe('TreCodec no-regression: graceful classify + V6000 write-refusal (unchanged behavior)', () => {
  it('v6000 encrypted payload still refuses extraction with an inflate/RFC1950 error (MOUNT-05 classify preserved)', () => {
    const bytes = loadFixture('v6000-encrypted.tre');
    const { archiveIndex } = mountBytes('codec-v6000-encrypted.tre', bytes);
    expect(() => nativeCore.readEntry(archiveIndex, 0)).toThrow(/inflate|RFC1950|invalid/i);
  });

  it('v6000 stored-payload fixture (per-payload classify) is still readable — no blanket enumerate-only throw', () => {
    const bytes = loadFixture('v6000-2record.tre');
    const { archiveIndex } = mountBytes('codec-v6000-stored.tre', bytes);
    expect(() => nativeCore.readEntry(archiveIndex, 0)).not.toThrow();
  });

  it('TreBuilder::build still refuses V6000 (isEnumerateOnly blanket throw unchanged by the codec seam)', () => {
    const entries = [{ path: 'x.txt', data: new Uint8Array([1, 2, 3]) }];
    expect(() => nativeCore.buildTre(entries, '6000')).toThrow();
  });
});

// ─── Section 4: Source-level codec-seam wiring — the actual RED/GREEN gate ─────────
//
// The behaviors above are byte-identical before and after this refactor (by design — it
// is a pure internal call-site indirection). The genuine RED signal for this "seam" plan
// is that the dispatch actually goes through TreCodec's codecForCompressor/codecForTreVersion/
// codecForBlockCompressor lookups (and the old tocCompressor==0/blockCompressor==0 bypass
// branches are gone, folded into StoredCodec) — not the direct treInflate/zlibCompress calls.
// This mirrors Task 2's acceptance_criteria grep commands exactly, run here as a vitest gate
// so RED (missing seam) really fails and GREEN (Task 2 done) really passes.

const MODULES_DIR = join(__dirname_es, '..', 'modules', 'core');
const TRE_ARCHIVE_CPP = join(MODULES_DIR, 'tre', 'TreArchive.cpp');
const TRE_BUILDER_CPP = join(MODULES_DIR, 'tre', 'TreBuilder.cpp');
const TRE_CODEC_H = join(MODULES_DIR, 'compress', 'TreCodec.h');

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function readSourceOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // RED case: TreCodec.h does not exist yet before Task 2.
    return '';
  }
}

describe('TreCodec source-seam wiring (RED until Task 2 implements TreCodec.h/.cpp + call-site wiring)', () => {
  it('TreCodec.h exists and declares codecForCompressor/codecForTreVersion/codecForBlockCompressor', () => {
    const src = readSourceOrEmpty(TRE_CODEC_H);
    expect(src.length, 'TreCodec.h must exist (Task 2)').toBeGreaterThan(0);
    expect(countOccurrences(src, 'codecForCompressor')).toBeGreaterThanOrEqual(1);
    expect(countOccurrences(src, 'codecForTreVersion')).toBeGreaterThanOrEqual(1);
    // Round-3 widened scope: codecForBlockCompressor must exist too.
    expect(countOccurrences(src, 'codecForBlockCompressor')).toBeGreaterThanOrEqual(1);
  });

  it('TreArchive.cpp routes PAYLOAD reads through codecForCompressor (extractEntry + extractAt)', () => {
    const src = readSourceOrEmpty(TRE_ARCHIVE_CPP);
    expect(countOccurrences(src, 'codecForCompressor')).toBeGreaterThanOrEqual(1);
  });

  it('TreArchive.cpp routes TOC + name-block reads through codecForBlockCompressor (round-3 widened seam)', () => {
    const src = readSourceOrEmpty(TRE_ARCHIVE_CPP);
    // TOC inflate + name-block inflate = 2 call sites.
    expect(countOccurrences(src, 'codecForBlockCompressor')).toBeGreaterThanOrEqual(2);
  });

  it('TreArchive.cpp no longer has the old tocCompressor==0 bypass special-case (folded into StoredCodec)', () => {
    const src = readSourceOrEmpty(TRE_ARCHIVE_CPP);
    expect(countOccurrences(src, 'tocCompressor == 0')).toBe(0);
  });

  it('TreArchive.cpp no longer has the old blockCompressor==0 bypass special-case (folded into StoredCodec)', () => {
    const src = readSourceOrEmpty(TRE_ARCHIVE_CPP);
    expect(countOccurrences(src, 'blockCompressor == 0')).toBe(0);
  });

  it('TreBuilder.cpp routes the PAYLOAD deflate call through codecForTreVersion', () => {
    const src = readSourceOrEmpty(TRE_BUILDER_CPP);
    expect(countOccurrences(src, 'codecForTreVersion')).toBeGreaterThanOrEqual(1);
  });

  it('TreBuilder.cpp routes TOC + name-block deflate through codecForBlockCompressor (round-3 widened seam)', () => {
    const src = readSourceOrEmpty(TRE_BUILDER_CPP);
    // TOC deflate + name-block deflate = 2 call sites.
    expect(countOccurrences(src, 'codecForBlockCompressor')).toBeGreaterThanOrEqual(2);
  });

  it('TreCodec.h header comment documents the widened (payload + TOC/name-block) scope per the round-3 ruling', () => {
    const src = readSourceOrEmpty(TRE_CODEC_H);
    // Loose match: the header comment must mention the TOC/name-block axis explicitly,
    // not just the payload path, per 04.4-06's round-3 revision note.
    expect(/TOC\/name-block/i.test(src) || /TOC\s*\/\s*name-block/i.test(src)).toBe(true);
  });
});
