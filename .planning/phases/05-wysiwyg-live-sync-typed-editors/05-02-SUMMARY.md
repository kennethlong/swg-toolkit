---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 02
subsystem: format-parsers
tags: [dtii, datatable, iff, native-core, n-api, cpp20, core-05, byte-exact-roundtrip]

# Dependency graph
requires:
  - phase: 01-core-engine-iff-tre-verification-harness
    provides: IFF FORM/chunk parser (Iff.h/.cpp), CORE-05 fixture registry + assertRoundTrip harness
provides:
  - Native C++20 FORM DTII parser + serializer (parseDataTable/serializeDataTable)
  - N-API binding (parseDataTable/serializeDataTable exports) with per-cell byteOffset/byteLength
  - CORE-05 'dtii' format registration (synthetic + real-asset fixtures, byte-exact round-trip gate)
  - Real-asset extraction script (extract-dtii-fixtures.cjs) — DATA-01's standing "done" gate
affects: [05-06 (DTII grid editor UI — consumes columns/rows/byteOffset shape), 05-08 (Hex-view toggle — consumes per-cell byteOffset/byteLength directly)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DTII physical dispatch: 3 wire types (int32/float32/NUL-terminated string) keyed by type-spec first-char, not 10 physical decoders (D-12)"
    - "Per-cell byteOffset/byteLength relative to ROWS chunk cell-data span, for Hex-view highlight consumers"
    - "Hand-rolled FORM/chunk byte-recipe serializer (writeBe32/writeLE32/writeCString/appendLeafChunk/appendForm) mirroring Iff.cpp's write convention, since DTII builds fresh IFF content rather than verbatim-re-emitting a parsed tree"

key-files:
  created:
    - packages/native-core/modules/core/formats/DataTable.h
    - packages/native-core/modules/core/formats/DataTable.cpp
    - packages/native-core/src/dtii_binding.cpp
    - packages/harness/test/dtii-roundtrip.test.ts
    - packages/harness/scripts/extract-dtii-fixtures.cjs
  modified:
    - packages/native-core/modules/core/CMakeLists.txt
    - packages/native-core/src/addon.cpp
    - .gitignore

key-decisions:
  - "String cells are NUL-terminated ASCII (Iff::read_string convention), NOT length-prefixed as the plan's Interfaces section claimed — verified against swg-client-v2 Iff.cpp:1539-1564 and the codebase's own ChunkView::readString precedent (Mesh.cpp/Effect.cpp)."
  - "Legacy FORM 0000's TYPE chunk is int32 DataType codes, a DIFFERENT wire shape than FORM 0001's string TYPE chunk — corrects the plan's 'same three-chunk shape' claim (DataTable.cpp:500-535). Implemented read support for both; serializeDataTable always emits canonical 0001."
  - "Real-asset extraction uses listMountEntries() (real paths) instead of searchMount() (archiveIndex/entryIndex only, no .path — T-01-06), then resolveEntry() to get archive/entry indices."
  - "Real-fixture selection version-gated to '0001' only, since serializeDataTable always emits canonical 0001 — picking a legacy 0000 asset would produce a misleading round-trip failure (format-version mismatch, not a parser bug), not a genuine gate failure."

patterns-established:
  - "Pattern: engine-free C++20 IFF-tree format parser + hand-built fresh-content serializer, mirroring Effect.h (parse) + Iff.cpp's writeBe32/serializeNode conventions (write) — the first native-core format needing BOTH an IFF-tree walk AND a from-scratch serializer (Effect.cpp is read-only; Palette.cpp's serializer is PARSER-NATIVE, not IFF)."

requirements-completed: [DATA-01]

# Metrics
duration: ~25min
completed: 2026-07-15
---

# Phase 5 Plan 02: DTII Datatable Native Parser Summary

**Native C++20 FORM DTII parser + serializer with 3 physical wire decoders (int32/float32/NUL-terminated string), per-cell byte offsets, and a CORE-05 byte-exact round-trip gate verified against both a synthetic 9-type fixture and a real 135KB client asset (989 rows).**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-15T15:55:00Z (approx, session start)
- **Completed:** 2026-07-15T16:08:00Z
- **Tasks:** 4/4 completed
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments
- Native DTII parser/serializer (`DataTable.h/.cpp`) implementing exactly 3 physical cell decoders keyed by type-spec dispatch, matching verified `swg-client-v2` ground truth — not the 10-way decoder the plan's naive framing might suggest (D-12).
- Every parsed cell carries `byteOffset`/`byteLength` relative to the ROWS chunk's cell-data span, resolving the field 05-08's Hex-view highlight needs (REVIEWS.md MEDIUM finding), end-to-end through the N-API binding.
- N-API binding (`dtii_binding.cpp`) exporting `parseDataTable`/`serializeDataTable`, registered in `addon.cpp` following the established two-tier-catch/extractBytes/extractRootNode idiom.
- CORE-05 registration (`dtii-roundtrip.test.ts`) with a hand-built synthetic fixture exercising all 9 non-Comment type-spec letters, a byteOffset-contiguity proof, a DT_Comment-rejection test, and a real-asset lane.
- Real-asset extraction script + a genuinely-extracted, byte-exact-round-tripping real fixture (`appearance_table.iff`, 21 columns, 989 rows, 135238 bytes) — the standing DATA-01 "done" gate per REQUIREMENTS.md.

## Task Commits

Each task was committed atomically:

1. **Task 1: Native DTII parser + serializer** - `6db17fe` (feat)
2. **Task 2: N-API binding + addon registration** - `2ed5913` (feat)
3. **Task 3: CORE-05 synthetic round-trip fixture + byteOffset assertion** - `6244dc9` (test)
4. **Task 4: Real-asset round-trip fixture — DATA-01 done gate** - `66c0a9f` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/native-core/modules/core/formats/DataTable.h` - PhysicalType/DataTableColumn/DataTableCell/DataTableResult structs + parseDataTable/serializeDataTable/physicalTypeForSpec declarations
- `packages/native-core/modules/core/formats/DataTable.cpp` - Full parse (FORM 0001 + legacy FORM 0000) and serialize implementation, bounds-checked (T-05-10), Comment-rejecting (T-05-11)
- `packages/native-core/modules/core/CMakeLists.txt` - Added `formats/DataTable.cpp` to the explicit CORE_SOURCES list (not globbed — edit was required)
- `packages/native-core/src/dtii_binding.cpp` - N-API `ParseDataTable`/`SerializeDataTable` bindings
- `packages/native-core/src/addon.cpp` - Forward declarations + `exports.Set` registration for the two new exports
- `packages/harness/test/dtii-roundtrip.test.ts` - CORE-05 registration, synthetic + real-asset fixtures, byteOffset/DT_Comment assertions
- `packages/harness/scripts/extract-dtii-fixtures.cjs` - Real-asset extraction script (env-overridable client root, loud non-zero exit on not-found)
- `.gitignore` - Added `packages/harness/fixtures-real/datatable/*.iff`

## Decisions Made
- String cells are NUL-terminated (not length-prefixed) — implemented per verified ground truth over the plan's literal (incorrect) description. See Deviations below.
- Legacy FORM 0000 support added (int32 TYPE codes) for read-completeness, even though it wasn't in the plan's explicit acceptance criteria — low-risk, ground-truth-verified, and prevents a future silent mis-parse of an older-format real asset.
- Real-fixture picker version-gates to '0001' only, since the serializer only ever emits canonical 0001 bytes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DTII string cell encoding corrected from "length-prefixed" to NUL-terminated**
- **Found during:** Task 1 (native parser implementation)
- **Issue:** The plan's `<interfaces>` section explicitly described DTII string cells as "length-prefixed ASCII (IFF read_string convention)" and instructed `byteLength = 4 + stringByteLength` for String cells. Ground-truth tracing of `swg-client-v2 Iff.cpp:1539-1564` (`Iff::read_string`) and `Iff.cpp:893-897` (`insertChunkString`) shows the real convention is a NUL-terminated scan — no 4-byte length prefix exists on disk. This also matches every other native-core format's own `ChunkView::readString`/`readCString` convention (Mesh.cpp, Effect.cpp) already established in this codebase.
- **Fix:** Implemented String cells as NUL-terminated; `byteLength` = bytes actually consumed by the read (content length + 1 in the normal case). Documented the correction prominently in `DataTable.h`'s header doc so downstream consumers (05-08) don't re-derive the wrong assumption.
- **Files modified:** `packages/native-core/modules/core/formats/DataTable.h`, `DataTable.cpp`
- **Verification:** `dtii-roundtrip.test.ts`'s byteOffset-contiguity test explicitly asserts `row0[0].byteLength === 'Trandoshan'.length + 1`, proving the NUL-terminated convention round-trips correctly; the full synthetic and real-asset (135KB, 989-row) fixtures round-trip byte-exact, which would be impossible under the incorrect length-prefixed assumption.
- **Committed in:** `6db17fe` (Task 1 commit)

**2. [Rule 1 - Bug] Legacy FORM 0000's TYPE chunk shape corrected from "same as 0001" to int32-coded**
- **Found during:** Task 1 (native parser implementation)
- **Issue:** The plan's Interfaces section states FORM 0000 support is "same three-chunk shape" as FORM 0001. Ground-truth tracing of `DataTable.cpp:500-535` (`load_0000`) shows FORM 0000's TYPE chunk is `numCols * int32` `DataType` enum codes (only 0/1/2 = Int/Float/String valid, else client-FATAL) — a genuinely different wire encoding than 0001's NUL-terminated type-spec strings. Blindly parsing 0000's TYPE chunk as strings would misinterpret the first 4 bytes of each int32 code as a truncated/garbage string.
- **Fix:** Branch parsing logic on version: FORM 0001 reads TYPE as NUL-terminated strings; FORM 0000 reads TYPE as int32 codes mapped through a small `legacyTypeCodeToSpec` helper (0→"i", 1→"f", 2→"s", else throws). Documented in `DataTable.h`'s header doc.
- **Files modified:** `packages/native-core/modules/core/formats/DataTable.h`, `DataTable.cpp`
- **Verification:** Compiles cleanly; not directly exercised by a committed fixture (no legacy-0000 real asset was encountered during this session's extraction pass — all real datatables found were version 0001, consistent with a modern client build), but the code path is isolated, bounds-checked, and throws cleanly rather than silently mis-decoding if ever hit.
- **Committed in:** `6db17fe` (Task 1 commit)

**3. [Rule 3 - Blocking] CMake source list required an explicit edit (not auto-globbed)**
- **Found during:** Task 1 (build verification)
- **Issue:** `packages/native-core/modules/core/CMakeLists.txt`'s `CORE_SOURCES` is an explicit list, not a glob — a new format file needs an explicit line added or it silently doesn't compile.
- **Fix:** Added `formats/DataTable.cpp` to `CORE_SOURCES`.
- **Files modified:** `packages/native-core/modules/core/CMakeLists.txt`
- **Verification:** `cmake --build build --config Release --target swg_native_core` succeeds; `require('./index.js').parseDataTable`/`.serializeDataTable` load as callable functions.
- **Committed in:** `6db17fe` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 correctness fixes vs. plan mis-descriptions of verified ground truth, 1 Rule 3 blocking build-config fix)
**Impact on plan:** All three were necessary for correctness (the byte-exact round-trip gate would have been unreachable under the plan's literal "length-prefixed" instruction) or for the build to succeed at all. No scope creep — legacy 0000 support was added defensively but stayed within the same file/task, cost minimal extra code, and is documented as read-completeness rather than a new deliverable.

## Issues Encountered
- `pnpm --filter @swg/harness test -- dtii-roundtrip` (per the plan's `<verification>` block) produces "No test files found" because the harness package has no per-package `vitest.config.ts` and the root `vitest.config.ts`'s `include` globs are relative to the repo root, not `packages/harness/` (where `pnpm --filter` sets cwd). Worked around by running `npx vitest run dtii-roundtrip registry-coverage` from the repo root instead — same effective test selection, no config changes needed. This is a pre-existing repo-wide quirk (not introduced by this plan), noted here for the next executor who hits the same "No test files found" symptom.

## User Setup Required
None - no external service configuration required. (The real-asset fixture lane is opt-in and machine-local; it was populated and verified against the maintainer's installed `D:/SWG Infinity` client during this session, but the CI-blocking synthetic fixture requires no setup.)

## Next Phase Readiness
- DATA-01's format foundation is complete: native parse/serialize, N-API binding, byte-exact round-trip gate (both committed-synthetic and gitignored-real layers per Phase 1's two-layer pattern), and per-cell byte offsets ready for 05-08's Hex-view toggle to consume directly without re-deriving offsets.
- 05-UI-SPEC.md's D-07 type-badge Errata (9-type dispatch) was confirmed already consistent with the implemented dispatch — no doc edit was needed.
- No blockers for downstream DTII grid-editor plans (05-06+); the `{ formatTag, version, columns: [{name, typeSpec}], rows: [[{type, value, byteOffset, byteLength}]] }` return shape is stable and documented in `dtii_binding.cpp`'s header comment.

## Self-Check: PASSED

All created files verified present on disk; all 4 task commit hashes verified present in `git log`.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*
