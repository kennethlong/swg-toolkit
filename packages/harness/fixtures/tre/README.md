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
| `v0005-3record.tre` | v0005 | Primary byte-exact round-trip target (3 entries: stored, deflate, tombstone) | size-first, 24-byte | Regenerated from Utinni `synthesized-3record-v0005.tre` byte recipe; validated against `Utinni TreFile.cs:302-310` |
| `v0006-2record.tre` | v0006 | Readable v0006 (NOT encrypted, NOT enumerate-only) | size-first, 24-byte | Regenerated from Utinni `synthesized-2record-v0006.tre`; validated against `Utinni TreVersion.cs:92-105` |
| `v6000-2record.tre` | v6000 | Enumerate-only / encrypted payload | crc-first, 32-byte | Regenerated from Utinni `synthetic-v6000-2record.tre`; `isEnumerateOnly = true` (Utinni `TreVersion.cs:79-86`) |
| `malformed-magic.tre` | — | Rejects bad magic bytes cleanly | — | Regenerated from Utinni `malformed-magic.tre` |
| `truncated.tre` | — | Rejects truncated header cleanly | — | Regenerated from Utinni `truncated.tre` |
| `unsupported-version.tre` | — | Rejects unknown version string | — | Regenerated from Utinni `unsupported-version.tre` |
| `malformed-bad-adler.tre` | v0005 | Rejects bad zlib RFC1950 Adler checksum | size-first, 24-byte | Synthesized per Utinni `TreFile.cs:660-679` (T-01-04) |
| `crc-collision.tre` | v0005 | Proves collision-safe scan for equal-CRC entries | size-first, 24-byte | Synthesized per `TreeFile_SearchNode.cpp:382` (T-01-19) |

## Fixture Field Order Lock

**The committed fixtures' TOC field order is provisional until the `tre-fieldorder-arbiter.test.ts`
arbiter confirms it against real bytes.**

- Fixtures for v0005 use **size-first layout** (length, offset, compressor, compressedLength, crc, fileNameOffset) per Utinni `TreFile.cs:302-310` and the Utinni `synthesized-3record-v0005.tre` fixture bytes.
- Fixtures for v6000 use **crc-first layout, 32-byte stride** (crc, length, offset, compressor, compressedLength, fileNameOffset, pad, pad) per Utinni `TreFile.cs:284-298` and `TreVersion.cs:92-105`.
- The arbiter (`tre-fieldorder-arbiter.test.ts`) MUST be run locally with real Infinity/SWGEmu archives before Plan 01 is considered done. On a clean clone it emits a PENDING/MUST-RUN marker.

## Citation Rule (D-03)

Every fixture MUST have a `loaderSource` entry in the `fixtureRegistry.ts` citing the real source
(`swg-client-v2`, `Utinni`, or `tre_reader.py`) `file:line` that validates its byte layout.
The CORE-05 sweep test enforces this — missing citation = CI failure.

## Asset Safety (D-10)

These committed fixtures are **synthesized** (regenerated from Utinni's public byte recipes, NOT
copied from Utinni's `.expected.json` goldens). The real `.tre` archives from
`D:\SWG Infinity\...`, `D:\SWGEmu-Client\...`, etc. are NEVER committed — they live in the
gitignored `fixtures-real/` scratch directory and are populated via `copy-real-fixtures.js`.
