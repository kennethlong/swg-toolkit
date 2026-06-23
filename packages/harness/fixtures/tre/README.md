# TRE Fixtures — Provenance and Usage

## Decision D-09: Layered Fixtures

Per `01-CONTEXT.md` decision D-09, fixtures are layered:

1. **Committed (this directory):** Tiny synthesized/handcrafted `.tre` fixtures — safe for CI on a
   clean clone (no retail bytes required). Each fixture documents its provenance below.

2. **Real-asset gate (gitignored):** Copies of real client archives in `fixtures-real/` — used by
   the CI-blocking field-order arbiter (`tre-fieldorder-arbiter.test.ts`). Run
   `node scripts/copy-real-fixtures.js` to populate on a developer machine.

## Fixture List

| File | Version | Purpose | Field Order | Provenance |
|------|---------|---------|-------------|-----------|
| `v0005-3record.tre` | v0005 | Primary byte-exact round-trip target (3 entries: stored, deflate, tombstone) | crc-first, 24-byte | Synthesized; validated against `swg-client-v2 TreeFile_SearchNode.h:189` |
| `v0006-2record.tre` | v0006 | Readable v0006 (NOT encrypted, NOT enumerate-only) | crc-first, 24-byte | Synthesized; validated against `swg-client-v2 TreeFile_SearchNode.h:189` |
| `v6000-2record.tre` | v6000 | Enumerate-only / encrypted payload | crc-first, 32-byte | Synthesized; `isEnumerateOnly = true` (Utinni `TreVersion.cs:79-86`) |
| `malformed-magic.tre` | — | Rejects bad magic bytes cleanly | — | Synthesized |
| `truncated.tre` | — | Rejects truncated header cleanly | — | Synthesized |
| `unsupported-version.tre` | — | Rejects unknown version string | — | Synthesized |
| `malformed-bad-adler.tre` | v0005 | Rejects bad zlib RFC1950 Adler checksum | crc-first, 24-byte | Synthesized (T-01-04) |
| `crc-collision.tre` | v0005 | Proves collision-safe scan for equal-CRC entries | crc-first, 24-byte | Synthesized per `TreeFile_SearchNode.cpp:382` (T-01-19) |

## Fixture Field Order Lock

**LOCKED — verified byte-exact against real archives** (`bottom.tre` ver "5000";
`SwgRestoration_00.tre` ver "6000") and against the client's on-disk struct.

- ALL versions use **crc-first layout** (crc, length, offset, compressor, compressedLength, fileNameOffset) per `swg-client-v2 TreeFile_SearchNode.h:189`. Stride 24 for v0004/v0005/v0006/v5000; **32** (crc-first + 8 pad) for v6000.
- The CRC is the **forward (MSB-first) CRC-32** (polynomial `0x04C11DB7`, init `0xFFFFFFFF`, final XOR `0xFFFFFFFF`) over the lowercased name, per `swg-client-v2 Crc.cpp`.
- The previously-documented "size-first" layout (length@0 … crc@16) from Utinni / AI-distilled docs is **FALSIFIED** — it matches no real archive.
- The arbiter (`tre-fieldorder-arbiter.test.ts`) confirms crc-first against real Infinity/SWGEmu bytes. On a clean clone it emits a PENDING/MUST-RUN marker.

## Citation Rule (D-03)

Every fixture MUST have a `loaderSource` entry in the `fixtureRegistry.ts` citing the real source
(`swg-client-v2`, `Utinni`, or `tre_reader.py`) `file:line` that validates its byte layout.
The CORE-05 sweep test enforces this — missing citation = CI failure.

## Plan 01-02 Fixture Notes

The Plan 01-02 tests (`tre-override.test.ts`, `tre-async-zerocopy.test.ts`) generate their
own synthesized fixtures at runtime via the temp directory (`os.tmpdir()/swg-override-test/`
and `swg-async-test/`). These are NOT committed — they are synthesized from known-good byte
recipes and are reproducible on every CI run without disk state.

- **Override/tombstone fixtures**: synthesized v0005 archives with 1–3 entries
  each, sorted by CRC-32 (required for binary-search correctness).
  Field order: crc-first, 24-byte stride (per swg-client-v2 TreeFile_SearchNode.h:189).
  CRC: forward CRC-32, polynomial 0x04C11DB7, init=0xFFFFFFFF, finalXOR=0xFFFFFFFF (per swg-client-v2 Crc.cpp).
- **100k-entry latency fixture**: synthesized in the search-latency test, written to temp.

## Asset Safety (D-10)

These committed fixtures are **synthesized** (regenerated from Utinni's public byte recipes, NOT
copied from Utinni's `.expected.json` goldens). The real `.tre` archives from
`D:\SWG Infinity\...`, `D:\SWGEmu-Client\...`, etc. are NEVER committed — they live in the
gitignored `fixtures-real/` scratch directory and are populated via `copy-real-fixtures.js`.
