---
phase: "01"
plan: "04"
subsystem: native-core/tre
tags: [tre, builder, repacker, zlib, d-04, core-04, core-05, determinism, raw-slice-identity]
dependency_graph:
  requires: [01-01, 01-02, 01-03]
  provides: [D-04-TreBuilder, CORE-04-write-side, CORE-05-sweep-fixtures]
  affects: [native-core-binding, harness-sweep-gate]
tech_stack:
  added:
    - "TreBuilder (C++20 static methods) — engine-free archive writer"
    - "Crc.{h,cpp} — standalone forward CRC-32 for builder TU"
  patterns:
    - "zlib RFC1950 compress2() pinned to Z_DEFAULT_COMPRESSION (level 6, wbits 15, memLevel 8)"
    - "Double header write (stub → payloads → TOC → names → MD5 → header rewrite)"
    - "Raw-slice identity repack (copy untouched slices verbatim, recompress only edits)"
key_files:
  created:
    - packages/native-core/modules/core/tre/Crc.h
    - packages/native-core/modules/core/tre/Crc.cpp
    - packages/native-core/modules/core/tre/TreBuilder.h
    - packages/native-core/modules/core/tre/TreBuilder.cpp
    - packages/harness/test/tre-builder-roundtrip.test.ts
    - packages/harness/test/tre-retail-repack.test.ts
  modified:
    - packages/native-core/modules/core/CMakeLists.txt
    - packages/native-core/src/tre_binding.cpp
    - packages/native-core/src/addon.cpp
    - packages/native-core/index.d.ts
    - packages/contracts/src/tre.ts
    - docs/01-core-engine/iff-and-tre.md
decisions:
  - "D-04: TreBuilder uses zlib RFC1950 (code 2) only — not miniz/raw-deflate. Compile-time guard: #ifdef MZ_VERSION → #error."
  - "Double header write pattern: header stub first, then payloads, then TOC/names/MD5, then seek-back rewrite (TreeFileBuilder.cpp:773-833)."
  - "MD5 block: numberOfFiles × 16 bytes zeroed (reader ignores it; present for determinism). Always uncompressed."
  - "Raw-slice identity repack: untouched entries copied verbatim via IInputStream::read(e.offset, ...). Never recompress untouched entries."
  - "v6000 build/repack refused (enumerate-only encrypted). Throws std::runtime_error."
  - "N-API bindings (buildTre/repackTre) are synchronous on the main thread for now; async worker upgrade deferred to future plan."
metrics:
  duration: "~2 hours (including prior session from compaction point)"
  completed: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 6
  tests_added: 27
  tests_passing: 27
---

# Phase 1 Plan 04: TRE Builder/Repacker (D-04) Summary

TRE archive writer primitive (D-04) implementing two hard byte-identity guarantees: (a) build-twice-SELF-DETERMINISM regression guard, and (b) repack RAW-SLICE-IDENTITY for untouched entries.

## Objective Achieved

All deliverables from the plan executed completely:

- `TreBuilder::build()` — fresh archive from scratch, block order EXACTLY matching TreeFileBuilder.cpp:773-833
- `TreBuilder::repack()` — repack with untouched entries verbatim (Utinni TreWriter.cs:166-174)
- `Crc.{h,cpp}` — standalone forward CRC-32 for the builder TU
- N-API exports `buildTre`/`repackTre` wired in `tre_binding.cpp` + `addon.cpp`
- TypeScript types in `index.d.ts` and contract types in `contracts/src/tre.ts`
- 12 determinism-gate tests (`tre-builder-roundtrip.test.ts`)
- Synthetic + real-asset lane tests (`tre-retail-repack.test.ts`) — real-asset lane verified 20 entries raw-slice identity against `stardust-mtg_patch_002_appearance_02.tre`
- Docs correction: §2 IFF big-endian fix + §8 TRE packing section rewrite with verified ground truth
- Build: native addon compiles cleanly (cmake-js + MSBuild, Visual Studio 17 2022)
- Tests: 27/27 pass; 37/37 TRE tests pass in full vitest run

## Tasks

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | TreBuilder C++ + binding + harness tests | 97a9bd6 | DONE |
| 2 | Docs correction (iff-and-tre.md §2 + §8) | 569825b | DONE |

## Key Implementation Notes

### Block Write Order (LOCKED — TreeFileBuilder.cpp:773-833)
1. 36-byte header stub (magic EERT + version ASCII + numberOfFiles, tocOffset=0/sizes=0)
2. File payloads in RESPONSE-FILE order (each tried for zlib compression)
3. TOC: CRC-FIRST 6-field 24B (or 32B for v6000) records in crc/name-sorted tocOrder
4. Name block: null-terminated paths in tocOrder
5. MD5 block: numberOfFiles × 16 bytes ALWAYS UNCOMPRESSED
6. Seek to offset 0: rewrite full 36-byte header with real tocOffset/compressors/sizes

### Compression Policy (LOCKED — ZlibCompressor.cpp:169)
- zlib RFC1950 (compressor code 2) ONLY; `compress2(..., Z_DEFAULT_COMPRESSION)` = level 6
- Only when: `input.size() > 1024` AND `compressed.size() < input.size()` (strict)
- FORBIDDEN on write path: miniz/mz_deflate/tdefl (compile-time #ifdef MZ_VERSION → #error guard)
- Vendored zlib 1.2.3 linked statically (prevents Electron zlib-symbol crash)

### Raw-Slice Identity Repack
- Untouched entries: `IInputStream::read(e.offset, rawBuf, readLen)` — verbatim copy
- Edited entries: recompress via `zlibCompress()` — zlib level 6 only
- This ensures unedited bytes in the repacked archive are bit-identical to the retail source

### v6000 Refused
- `isEnumerateOnly(V6000)` → both `build()` and `repack()` throw `std::runtime_error`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Real-asset lane test used v6000 archive from fixtures-real/**
- **Found during:** Test run (tre-retail-repack.test.ts real-asset lane)
- **Issue:** `fixtures-real/` contained `restoration-SwgRestoration_06.tre` (v6000, enumerate-only).
  Test's `findRealTrePath()` selected it and the `readEntry()` call threw "enumerate-only".
- **Fix:** Added probe logic in `findRealTrePath()`: attempts `readEntry` on first non-tombstone entry
  and skips archives that throw (v6000 detection). Found `stardust-mtg_patch_002_appearance_02.tre` as a valid non-v6000 alternative.
- **Files modified:** `packages/harness/test/tre-retail-repack.test.ts`
- **Commit:** Part of initial commit 97a9bd6

### CLAUDE.md / AGENTS.md Directives Applied

- Binary stays binary: `buildTre`/`repackTre` return `Napi::ArrayBuffer`, not JSON
- Vendored zlib 1.2.3 used exclusively for the write path (no host-zlib symbols)
- Commits made without `--no-verify` (trunk-based on main per plan's `sequential_execution` note)

## Known Stubs

None. All builder logic is fully implemented. The N-API bindings are synchronous (no AsyncWorker wrapper yet) — async upgrade is a future enhancement, not a correctness requirement for D-04.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: path-traversal | TreBuilder.cpp (fixUpFileName) | Builder normalizes paths (lowercase, forward-slash, strip `../`) — inline fixUpFileName prevents path traversal in built archives. Source: swg-client-v2 TreeFile.cpp:511-601. |

## Self-Check: PASSED

All 7 created files exist on disk. Both task commits (97a9bd6, 569825b) verified in git log. 27/27 tests pass.
