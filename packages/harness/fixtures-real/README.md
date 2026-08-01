# fixtures-real/

This directory holds real TRE archives copied from local SWG installs for the
field-order arbiter (CORE-05/D-12). Files here are NEVER committed to the repo
(see `.gitignore` and D-10 asset safety policy).

## How to populate

```
node scripts/copy-real-fixtures.js
```

The script copies a small sample of .tre files from each installed client:
- D:\SWG Infinity (v0005 files, e.g. appearance_n.tre, terrain.tre)
- D:\SWGEmu Client\SWGEmu (v0005 files)
- D:\SWG Restoration (v6000 files, if installed)

## Why this exists

The CI-BLOCKING field-order arbiter test (`pnpm vitest run -t "tre fieldorder arbiter"`)
confirms that `isCrcFirst(V0005)` returns false and `recordStride(V0005)` returns 24
by reading REAL archive TOC blocks and verifying CRC == crc32(name) per entry.

This MUST be run and MUST be green before Plan 01 is considered done (D-12).

See: `packages/harness/test/tre-fieldorder-arbiter.test.ts`

## `.ilf` interior-layout fixture (Phase 5.1 Plan 01 — CORE-05 gate)

```
node packages/harness/scripts/extract-ilf-fixtures.cjs
```

Extracts one real `.ilf` from an installed client's `interiorlayout/*.ilf` VFS prefix into
`fixtures-real/ilf/`. Client root resolution: `SWG_ILF_FIXTURE_CLIENT_ROOT` env override, else
`D:/SWG Infinity/SWG Infinity/Live`, else `D:/SWGEmu Client/SWGEmu` (fallback candidate only).

**This fixture is REQUIRED, not optional** (ROUND 3 — REVIEWS.md C5): `.ilf` is a
format-mutating change (`addNode`/`removeNode` append/delete), so per the project's ground-truth
mandate the real-asset round-trip lane in `packages/harness/test/ilf-roundtrip.test.ts` is a
plain, unconditional assertion — it FAILS (not skips) if `fixtures-real/ilf/*.ilf` is absent.
Re-run the extraction script above if that test fails.

See: `packages/harness/test/ilf-roundtrip.test.ts`, `packages/renderer/src/services/ilf.ts`
