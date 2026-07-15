---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 05
subsystem: format-parsers
tags: [stf, localized-strings, iff, native-core, n-api, cpp20, core-05, byte-exact-roundtrip]

# Dependency graph
requires:
  - phase: 01-core-engine-iff-tre-verification-harness
    provides: CORE-05 fixture registry + assertRoundTrip harness, TreMount priority resolver
provides:
  - Native C++20 PARSER-NATIVE `.stf` parser + serializer (parseStf/serializeStf) — NOT IFF-tree-based
  - N-API binding (parseStf/serializeStf exports) with direct UTF-16 <-> JS-string conversion
  - CORE-05 'stf' format registration (synthetic order-differing fixture + real-asset fixture,
    byte-exact round-trip gate, dedicated sourceCrc-preservation gate)
  - Real-asset extraction script (extract-stf-fixtures.cjs) — DATA-02's standing "done" gate
affects: [05-09 (`.stf` strings editor UI — consumes entries/nameMap/sourceCrc shape directly)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PARSER-NATIVE format with TWO independently-ordered sections (string table + name map), each
      order-preserved (not re-sorted) at parse/serialize time — a new variant of the Palette.h
      PARSER-NATIVE pattern (Palette has only one flat section)"
    - "Direct UTF-16 native<->JS bridging via node-addon-api's Napi::String::New(env, std::u16string)
      / .Utf16Value() — no UTF-8 re-encode round-trip (avoids corrupting non-BMP text)"
    - "Per-TU CRC-32 table re-generation (same polynomial/algorithm as tre/Crc.cpp, byte-identical
      table) rather than cross-TU symbol sharing, for an opt-in (not default-path) CRC recompute
      helper — mirrors Crc.cpp's own documented 'each TU gets its own crcTable instance' convention"

key-files:
  created:
    - packages/native-core/modules/core/formats/StringTable.h
    - packages/native-core/modules/core/formats/StringTable.cpp
    - packages/native-core/src/stf_binding.cpp
    - packages/harness/test/stf-roundtrip.test.ts
    - packages/harness/scripts/extract-stf-fixtures.cjs
  modified:
    - packages/native-core/modules/core/CMakeLists.txt
    - packages/native-core/src/addon.cpp
    - .gitignore

key-decisions:
  - "Magic is checked as the 4-byte little-endian integer 0xABCD (not ASCII \"STF \") — this plan's
    ground-truth research (LocalizedStringTable.h:49-50, ms_MAGIC=0xabcd, magic_type=long) confirmed
    the already-corrected D-11 UI-SPEC erratum; no new falsification found in this plan (unlike 05-02's
    two DTII corrections)."
  - "recomputeSourceCrcFromText re-generates its own CRC-32 table in StringTable.cpp (same
    polynomial/algorithm as tre/Crc.cpp, byte-identical values) rather than calling across the TU
    boundary, since Crc.cpp's table is file-static — this mirrors Crc.cpp's own documented
    'each TU gets its own crcTable instance; that is acceptable and avoids an ODR issue' convention,
    not a second independently-derived implementation."
  - "recomputeSourceCrcFromText is declared/defined but has ZERO call sites in this plan (not bound
    via N-API, not called by serializeStf) — stronger than the plan's literal acceptance-criteria
    phrasing of 'exactly one call site' (Task 1), since the future opt-in 'mark re-synced to source'
    UI action (05-09) is out of this plan's scope. Verified via grep: only the .h declaration and
    .cpp definition exist, no invocation anywhere in native-core."
  - "VFS prefix for real .stf assets is 'string/<locale>/' (e.g. 'string/en/aprilfools.stf') —
    confirmed by an interactive mount+listMountEntries pass against the real installed client before
    writing the extraction script, per the plan's own instruction to inspect real hits first."

patterns-established:
  - "Pattern: PARSER-NATIVE format with independently-ordered dual sections, order-preserving (not
    order-enforcing) parse/serialize — StringTable.cpp is the first native-core format with two
    on-disk sections that are NOT synchronized (unlike DTII's single COLS/TYPE/ROWS-per-column
    alignment)."

requirements-completed: [DATA-02]

# Metrics
duration: ~20min
completed: 2026-07-15
---

# Phase 5 Plan 05: .stf Localized String Table Native Parser Summary

**Native C++20 PARSER-NATIVE `.stf` parser + serializer modeling two independently-ordered on-disk sections (id-ascending string table, name-ascending key-to-id map), with sourceCrc preserved byte-verbatim by default and a CORE-05 byte-exact round-trip gate verified against both an order-differentiating synthetic fixture and a real 4503-byte client asset (47 entries).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-15 (session start)
- **Completed:** 2026-07-15
- **Tasks:** 4/4 completed
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments
- Native `.stf` parser/serializer (`StringTable.h/.cpp`) modeling the verified two-section layout
  (D-11): an ascending-id string section (`id, sourceCrc, buflen, buflen*2 bytes UTF-16LE text`) and
  a separate ascending-name name-map section (`id, buflen, buflen ASCII bytes`) — every field size
  and ordering cross-checked against `swg-client-v2 LocalizedStringTable.h/.cpp`,
  `LocalizedString.h/.cpp`, and `LocalizedStringTableReaderWriter.cpp` (magic 0xABCD as `long`,
  `id_type`/`crc_type` as `unsigned long` = 4 bytes, `Unicode::unicode_char_t = char16_t`).
- `sourceCrc` preserved byte-verbatim by `serializeStf` (D-10) — a separate, never-called-by-default
  `recomputeSourceCrcFromText` helper exists for a future explicit "mark re-synced to source" action,
  re-using the SAME CRC-32 polynomial/algorithm already verified in `tre/Crc.cpp` (own per-TU table
  instance, matching that file's own documented convention).
- N-API binding (`stf_binding.cpp`) exporting `parseStf`/`serializeStf`, using node-addon-api's
  direct `Napi::String::New(env, std::u16string)` / `.Utf16Value()` for UTF-16 <-> JS-string
  conversion (no UTF-8 re-encode, avoiding corruption of non-BMP text).
- CORE-05 registration (`stf-roundtrip.test.ts`) with a hand-built synthetic fixture whose
  id-ascending and name-ascending orders visit entries in genuinely DIFFERENT sequences ([1,2,3] vs
  [2,3,1]), a dedicated magic-bytes test (`CD AB 00 00`, not an ASCII check), a differing-permutation
  guard test, and a dedicated D-10 sourceCrc byte-identity preservation test.
- Real-asset extraction script + a genuinely-extracted, byte-exact-round-tripping real fixture
  (`aprilfools.stf`, `string/en/` locale, 47 entries, 47 name-map rows, 4503 bytes) — the standing
  DATA-02 "done" gate per REQUIREMENTS.md, found under the real VFS prefix `string/<locale>/`
  confirmed via an interactive mount pass before writing the script.

## Task Commits

Each task was committed atomically:

1. **Task 1: Native .stf parser + serializer** - `2587ad1` (feat)
2. **Task 2: N-API binding + addon registration** - `82ad2d6` (feat)
3. **Task 3: CORE-05 synthetic round-trip fixture with differing orders + UI-SPEC confirmation** - `2159947` (test)
4. **Task 4: Real-asset round-trip fixture — DATA-02 done gate** - `2847c26` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/native-core/modules/core/formats/StringTable.h` - StfEntry/StfResult structs + parseStf/serializeStf/recomputeSourceCrcFromText declarations, full ground-truth citation header doc
- `packages/native-core/modules/core/formats/StringTable.cpp` - parseStf (bounds-checked before allocate, per T-05-12), serializeStf (verbatim sourceCrc), recomputeSourceCrcFromText (own CRC table)
- `packages/native-core/modules/core/CMakeLists.txt` - Added `formats/StringTable.cpp` to the explicit CORE_SOURCES list (not globbed — edit required, same as 05-02's DataTable.cpp finding)
- `packages/native-core/src/stf_binding.cpp` - N-API `ParseStf`/`SerializeStf` bindings, direct UTF-16 <-> JS-string helpers
- `packages/native-core/src/addon.cpp` - Forward declarations + `exports.Set` registration for the two new exports
- `packages/harness/test/stf-roundtrip.test.ts` - CORE-05 registration, order-differing synthetic fixture, magic/sourceCrc/permutation tests, real-asset lane
- `packages/harness/scripts/extract-stf-fixtures.cjs` - Real-asset extraction script (env-overridable client root, loud non-zero exit on not-found, `string/<locale>/*.stf` VFS pattern)
- `.gitignore` - Added `packages/harness/fixtures-real/stf/*.stf`

## Decisions Made
- Magic-bytes / two-section-order / sourceCrc-semantics interfaces in the plan were ALL verified
  correct against ground truth on first read — no falsification found this session (contrast with
  05-02's two DTII corrections). Full citation trail preserved in `StringTable.h`'s header doc.
- `recomputeSourceCrcFromText` regenerates its own CRC table per-TU rather than exposing/calling
  across `tre/Crc.cpp`'s translation unit boundary — same algorithm/polynomial, zero duplication of
  *logic*, matching the codebase's own established per-TU-table convention.
- Real `.stf` VFS prefix (`string/<locale>/`) was confirmed by an interactive mount+search pass
  against the real installed client BEFORE writing the extraction script, per the plan's explicit
  instruction — avoided guessing the prefix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's Task 3 illustrative order-differing fixture example was internally inconsistent**
- **Found during:** Task 3 (synthetic fixture construction)
- **Issue:** The plan's Task 3 action text proposed "id=3 name=zebra, id=1 name=apple, id=2 name=mango" as an example where id-ascending order and name-ascending order "visit the entries in different sequences." Sorting that assignment by id ascending (1,2,3) visits names [apple, mango, zebra]; sorting by name ascending (apple, mango, zebra) visits the SAME id sequence (1, 2, 3) — the two orderings are actually IDENTICAL under this assignment, contradicting the task's own stated intent and its acceptance criterion ("A test exists proving the fixture's id-order and name-order are NOT the same permutation").
- **Fix:** Substituted a genuinely order-differing assignment: id=1/"zebra", id=2/"apple", id=3/"mango". Walking the string section (id-ascending) visits ids [1,2,3]; walking the name-map section (name-ascending: apple->2, mango->3, zebra->1) visits ids [2,3,1] — a real permutation difference. Documented prominently in the test file's header comment (DEVIATION NOTE) so a future reader doesn't reintroduce the plan's flawed example.
- **Files modified:** `packages/harness/test/stf-roundtrip.test.ts`
- **Verification:** A dedicated test (`the fixture's id-order and name-order are NOT the same permutation`) explicitly asserts `idOrderIds !== nameOrderIds`; passes with the corrected assignment.
- **Committed in:** `2159947` (Task 3 commit)

**2. [Rule 3 - Blocking] CMake source list required an explicit edit (not auto-globbed)**
- **Found during:** Task 1 (build verification)
- **Issue:** `packages/native-core/modules/core/CMakeLists.txt`'s `CORE_SOURCES` is an explicit list, not a glob — a new format file (`StringTable.cpp`) needs an explicit line added or it silently doesn't compile. (Same finding as 05-02's DataTable.cpp.)
- **Fix:** Added `formats/StringTable.cpp` to `CORE_SOURCES`.
- **Files modified:** `packages/native-core/modules/core/CMakeLists.txt`
- **Verification:** `cmake --build build --config Release --target swg_native_core` succeeds.
- **Committed in:** `2587ad1` (Task 1 commit)

**3. [Rule 3 - Blocking] `src/*.cpp` glob required a CMake reconfigure to pick up the new `stf_binding.cpp` translation unit**
- **Found during:** Task 2 (build verification)
- **Issue:** `packages/native-core/CMakeLists.txt` globs `src/*.cpp` at configure time (`file(GLOB SOURCE_FILES "src/*.cpp")`), so a freshly-added `stf_binding.cpp` was not picked up by a `--build`-only invocation against a stale generated build tree, producing `LNK2019 unresolved external symbol ParseStf/SerializeStf`.
- **Fix:** Touched `packages/native-core/CMakeLists.txt` to force a CMake reconfigure (re-globs `src/*.cpp`), then rebuilt.
- **Files modified:** none (build-tree-only; no source changes)
- **Verification:** `require('../native-core/index.js').parseStf`/`.serializeStf` load as callable functions after rebuild.
- **Committed in:** N/A (build-artifact-only fix, not a source change)

---

**Total deviations:** 3 auto-fixed (1 Rule 1 correctness fix vs. the plan's own inconsistent example, 2 Rule 3 blocking build-config fixes)
**Impact on plan:** All three were necessary for the acceptance criteria to actually be satisfiable (the plan's own illustrative fixture would have FAILED its own acceptance test) or for the build to succeed at all. No scope creep.

## Issues Encountered
None beyond the deviations documented above. The real-asset extraction succeeded on the very first candidate tried (`string/en/aprilfools.stf`), unlike 05-02's DTII extraction which required trying several candidates.

## User Setup Required
None - no external service configuration required. (The real-asset fixture lane is opt-in and machine-local; it was populated and verified against the maintainer's installed `D:/SWG Infinity` client during this session, but the CI-blocking synthetic fixture requires no setup.)

## Next Phase Readiness
- DATA-02's format foundation is complete: native parse/serialize, N-API binding, byte-exact
  round-trip gate (both committed-synthetic and gitignored-real layers per Phase 1's two-layer
  pattern), and a stable `{ nextUniqueId, entries: [{id, sourceCrc, text}], nameMap: [{id, name}],
  roundTripBytes }` return shape ready for 05-09's `.stf` strings editor to consume directly.
- 05-UI-SPEC.md's D-10/D-11 Errata (magic/layout/sourceCrc semantics) were confirmed already
  consistent with the implemented parser — no doc edit was needed (9 D-10/D-11 citations found via
  grep, all accurate).
- No blockers for 05-09. `recomputeSourceCrcFromText` is implemented and ready for that plan's
  explicit "mark re-synced to source" UI action to call (currently zero call sites, as designed).

## Self-Check: PASSED

All created files verified present on disk; all 4 task commit hashes verified present in `git log`.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*
