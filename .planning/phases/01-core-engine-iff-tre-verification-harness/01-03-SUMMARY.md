---
phase: 01-core-engine-iff-tre-verification-harness
plan: 03
subsystem: iff-parser
tags: [iff, binary-format, big-endian, c++20, n-api, react, zustand, hex-inspector, virtualized]

requires:
  - phase: 01-core-engine-iff-tre-verification-harness/01-01
    provides: cmake-js build pipeline, N-API binding pattern (sab-rw.cpp), harness assertRoundTrip + fixtureRegistry
  - phase: 01-core-engine-iff-tre-verification-harness/01-02
    provides: TRE VFS browser + VfsTree file-select, Zustand treStore pattern, DataPanel chrome

provides:
  - Engine-free C++20 IFF FORM/chunk parser + byte-exact serializer (Iff.h/Iff.cpp)
  - N-API binding: parseIff / serializeIff / getChunkBytes (iff_binding.cpp)
  - contracts/iff.ts: IffNode, IffTrailingBytes, IffRoundTripStatus, IffParseResult
  - Zustand 5 iffStore: parseResult, sourceBytes, selectedNode, hoveredByteIndex, parseStatus
  - VerificationStatus.tsx: triple-encoded glyph+color+caption status pill
  - IffStructureTree.tsx: recursive FORM/chunk tree with expand/collapse, trailing-bytes node, round-trip footer (Surface 2)
  - HexInspector.tsx: virtualized offset|hex|ascii grid; only visible rows in DOM; selected-range highlight; hover cross-highlight (Surface 3)
  - DataPanel.tsx: Structure + Hex + Datatable + Console + Log tabs; auto-switches to Hex on node select
  - TreVfsBrowser.tsx: wired to trigger parseIff on VFS file-select and populate iffStore
  - 75 harness tests passing (IFF parse + byte-exact round-trip suite incl. gapped-FORM, trailing-bytes, pad-detect)

affects:
  - 01-04-PLAN (format browsing / tree viewer extensions will build on IffStructureTree)
  - All future format parsers follow the same hybrid-DOM verbatim re-emit contract
  - fixtureRegistry now has 2 registered formats (tre + iff) — CORE-05 sweep covers both

tech-stack:
  added: []
  patterns:
    - "Engine-free C++20 big-endian IFF parse + hybrid-DOM byte-exact serialize (clean span verbatim)"
    - "IFF pad detection: write NO pad; READ TOLERATES a single 0x00 only when present (IffReader.cs:307-327)"
    - "Trailing-bytes toolkit invention: bytes after last top-level block surfaced as IffTrailingInfo, not silently dropped"
    - "Virtualized scroll list (ResizeObserver + manual scroll state + overscan) — established in HexInspector"
    - "Zustand 5 store for viewer state (iffStore pattern); multiple panels read the same store"

key-files:
  created:
    - packages/native-core/modules/core/iff/Iff.h
    - packages/native-core/modules/core/iff/Iff.cpp
    - packages/native-core/src/iff_binding.cpp
    - packages/contracts/src/iff.ts
    - packages/harness/test/iff-parse.test.ts
    - packages/harness/test/iff-roundtrip.test.ts
    - packages/harness/fixtures/iff/README.md
    - packages/renderer/src/state/iffStore.ts
    - packages/renderer/src/shared/VerificationStatus.tsx
    - packages/renderer/src/panels/iff/IffStructureTree.tsx
    - packages/renderer/src/panels/iff/HexInspector.tsx
  modified:
    - packages/native-core/modules/core/CMakeLists.txt (added iff/Iff.cpp to CORE_SOURCES)
    - packages/native-core/src/addon.cpp (added parseIff / serializeIff / getChunkBytes exports)
    - packages/native-core/index.d.ts (added IffNodeNative, IffParseResultNative, parse/serialize/getChunkBytes)
    - packages/contracts/src/index.ts (added export * from './iff.js')
    - packages/renderer/src/panels/DataPanel.tsx (added Structure + Hex tabs wired to iffStore)
    - packages/renderer/src/panels/tre/TreVfsBrowser.tsx (triggers parseIff on file-select)

key-decisions:
  - "Gapped-FORM (declared length > children span) round-trips verbatim via clean-span-verbatim guarantee — capturedSlice spans full declared length; explicitly proven by gapped-form fixture"
  - "Trailing-bytes node is a toolkit invention (NOT ported from client) — client calculateRawDataSize assumes trailing data is zeroed; we surface it explicitly as IffTrailingInfo"
  - "Pad rule corrected from prior docs: write NO pad (IffWriter.cs:141); read DETECTS/TOLERATES a single 0x00 only when present (IffReader.cs:307-327) — the oddChunkNoPad fixture proves no phantom second child"
  - "HexInspector is fully virtualized: only visible rows (+ overscan) in DOM; ResizeObserver tracks container height; scrollTop state drives row window"
  - "VFS file-select triggers parseIff in TreVfsBrowser (not DataPanel) — DataPanel reads iffStore reactively; auto-switches to Hex tab when node selected"
  - "TypeScript typecheck passes zero errors: npx tsc --noEmit -p packages/renderer/tsconfig.json (no lint script exists in renderer)"

patterns-established:
  - "Hybrid-DOM verbatim re-emit: clean node writes capturedSlice; dirty node reserializes — established for all future format serializers"
  - "readBe32/writeBe32 inline big-endian helpers (engine-free, no platform ntohl/htonl dependency)"
  - "isContainerTag: FORM + LIST + CAT  are containers; PROP is leaf — OPEN-3 RESOLVED in this plan"
  - "Security caps inline in parseBlock: per-chunk 64 MB limit + childEnd>parentEnd rejection + non-printable FourCC rejection"

requirements-completed: [CORE-03, CORE-04]
duration: ~2 sessions (spanning 2026-06-22 to 2026-06-23)
completed: 2026-06-23
---

# Phase 01 Plan 03: IFF Read + Write + Structure Tree + Hex Inspector Summary

**Engine-free C++20 IFF FORM/chunk parser with byte-exact hybrid-DOM serialize, N-API binding, Zustand viewer state, recursive structure tree, and virtualized hex/ASCII inspector — closing CORE-03 and CORE-04.**

## Performance

- **Duration:** ~2 sessions (2026-06-22 to 2026-06-23)
- **Started:** 2026-06-22
- **Completed:** 2026-06-23
- **Tasks:** 3 of 3 complete (Task 3 human-verify passed 2026-06-23)
- **Files modified:** 17

## Accomplishments

- C++20 IFF parser correctly reads big-endian FORM/chunk structures from real SWG asset bytes; the gapped-FORM fixture proves interior gaps survive verbatim via clean-span-verbatim guarantee
- Byte-exact round-trip harness gate: serialize(parse(bytes)) == original bytes; proven on 7 synthetic fixtures covering simpleNested, oddChunkNoPad, padPresent, gappedForm, trailingBytes, listContainer, catContainer
- IFF structure tree (Surface 2) and virtualized hex/ASCII inspector (Surface 3) wired to the Zustand iffStore and triggered on VFS file-select — the SIE-successor baseline (D-07) is live
- CORE-05 sweep now covers 2 registered formats (tre + iff); both have loaderSource citations against swg-client-v2

## Task Commits

1. **Task 1: Engine-free C++20 IFF parse + byte-exact serialize + binding + contracts** - `1c882b9` (feat)
2. **Task 2: IFF structure tree + virtualized hex inspector + DataPanel tabs** - `bbb33dc` (feat)

**Task 3:** ✅ VERIFIED 2026-06-23. Human confirmed the Structure tree + Hex inspector on real SWG `.iff` assets. Orchestrator independently round-tripped **61/61 real `.iff` files byte-exact** (extracted from real `.tre`s across 4 archives) through native `parseIff` before handoff — the byte-exact gate (CORE-04) holds on real assets, not just synthetic fixtures. One cosmetic fix during verify: removed a doubled footer checkmark (commit `6a3a617`).

## Files Created/Modified

**Native core:**
- `packages/native-core/modules/core/iff/Iff.h` - IffNode/IffTrailingInfo/IffParseResult structs + function declarations
- `packages/native-core/modules/core/iff/Iff.cpp` - Big-endian FORM/chunk parse + hybrid-DOM byte-exact serialize + trailing-bytes detection
- `packages/native-core/src/iff_binding.cpp` - N-API binding: ParseIff / SerializeIff / GetChunkBytes with inline round-trip check
- `packages/native-core/modules/core/CMakeLists.txt` - Added iff/Iff.cpp to CORE_SOURCES
- `packages/native-core/src/addon.cpp` - Added parseIff / serializeIff / getChunkBytes exports
- `packages/native-core/index.d.ts` - Added IffNodeNative / IffParseResultNative / parse + serialize + getChunkBytes types

**Contracts:**
- `packages/contracts/src/iff.ts` - IffNode, IffTrailingBytes, IffRoundTripStatus, IffParseResult types
- `packages/contracts/src/index.ts` - Added export * from './iff.js'

**Harness:**
- `packages/harness/test/iff-parse.test.ts` - 20+ IFF parse tests; 'iff' registered in fixtureRegistry with loaderSource citations
- `packages/harness/test/iff-roundtrip.test.ts` - 7 round-trip fixtures via assertRoundTrip; gapped-FORM load-bearing test
- `packages/harness/fixtures/iff/README.md` - Fixture inventory + layout reference

**Renderer:**
- `packages/renderer/src/state/iffStore.ts` - Zustand 5 store (parseResult, selectedNode, sourceBytes, hoveredByteIndex, parseStatus)
- `packages/renderer/src/shared/VerificationStatus.tsx` - Triple-encoded glyph+color+caption status pill
- `packages/renderer/src/panels/iff/IffStructureTree.tsx` - Recursive FORM/chunk tree with expand/collapse, trailing-bytes node, round-trip footer
- `packages/renderer/src/panels/iff/HexInspector.tsx` - Virtualized offset|hex|ascii grid; 18px rows; sticky ruler; selected-range highlight
- `packages/renderer/src/panels/DataPanel.tsx` - Added Structure + Hex tabs wired to iffStore; auto-switch to Hex on node select
- `packages/renderer/src/panels/tre/TreVfsBrowser.tsx` - Triggers parseIff on VFS file-select, populates iffStore

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected DataPanel.tsx variable redeclaration**
- **Found during:** Task 2 typecheck
- **Issue:** `const { mountHandle }` was destructured at the top of `handleSelectEntry`, then redeclared in the same scope block when adding IFF parse wiring
- **Fix:** Removed the redundant second destructure; reused the existing `mountHandle` variable
- **Files modified:** `packages/renderer/src/panels/tre/TreVfsBrowser.tsx`
- **Commit:** bbb33dc

### Ground Truth Verification

Before writing any C++ code, the IFF byte layout was verified against:
- `swg-client-v2/src/engine/shared/library/sharedFile/src/shared/Iff.cpp` — confirmed BE read (ntohl at :508-555), FORM innerLen includes sizeof(Tag) (:643), verbatim write (:419-429), FORM discriminator (:1076-1095)
- `Utinni/UtinniCoreDotNet/Formats/Iff/IffReader.cs` — confirmed FourCC validation (:150-158), nested overflow rejection (:185-195), pad DETECT rule (:307-327)
- `Utinni/UtinniCoreDotNet/Formats/Iff/IffWriter.cs` — confirmed no pad emit (:141), hybrid-DOM verbatim re-emit (:98-187)

**Pad rule correction (not a deviation — the plan's ground_truth block already reflected this):**
Prior AI-distilled docs incorrectly stated "no pad ever." The correct behavior from the real source is: WRITE emits no pad; READ DETECTS/TOLERATES a single 0x00 pad when present. The oddChunkNoPad fixture proves no phantom second child when pad is absent.

## Known Stubs

None. The IFF viewer is fully wired: VFS file-select → parseIff → iffStore → IffStructureTree + HexInspector. The remaining unverified gap is Task 3 (human-verify on a real SWG asset), which is the blocking checkpoint.

## Threat Flags

None. This plan introduces no new network endpoints, auth paths, or trust-boundary file access beyond what Plan 01-02 established. The security caps (64 MB per-chunk limit, FourCC validation, childEnd>parentEnd rejection) were applied inline during parse per the plan's threat model.

## Self-Check: PASSED

Files verified present:
- `packages/native-core/modules/core/iff/Iff.h` - FOUND
- `packages/native-core/modules/core/iff/Iff.cpp` - FOUND
- `packages/renderer/src/panels/iff/IffStructureTree.tsx` - FOUND
- `packages/renderer/src/panels/iff/HexInspector.tsx` - FOUND
- `packages/renderer/src/state/iffStore.ts` - FOUND

Commits verified: 1c882b9 + bbb33dc - FOUND in git log

All 75 harness tests passing at Task 2 commit.
