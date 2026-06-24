---
phase: 02-3d-mesh-viewport-mvp-proof
plan: "01"
subsystem: native-core/formats
tags: [c++, n-api, mesh, shader, palette, dds, lod, contracts, vitest, core-05]
dependency_graph:
  requires:
    - "01-03 (IFF parseIff/serializeIff — CORE-03)"
    - "01-02 (TreMount/mountSearchableAsync — CORE-02)"
  provides:
    - "parseMesh (N-API) — consumed by 02-02 (skinned mesh)"
    - "parseMeshLod + parseLodDistanceTable (N-API) — consumed by 02-04 (LOD graph)"
    - "parseShader + parsePalette + parseDds (N-API) — consumed by 02-03 (material pipeline)"
    - "MeshParseResult / ShaderParseResult / PaletteParseResult / DdsParseResult / LodParseResult types"
  affects:
    - "packages/contracts/src (new type exports)"
    - "packages/harness/test (new CORE-05 tests)"
    - ".gitignore (real asset exclusions added)"
tech_stack:
  added:
    - "three@0.184.0, @react-three/fiber@9.6.1, @react-three/drei@10.7.7 (renderer)"
    - "@types/three@0.184.1 (dev)"
  patterns:
    - "Engine-free C++20 format parsers — no N-API, no SOE headers in parse logic"
    - "PARSER-NATIVE round-trip for non-IFF formats (.pal RIFF, .dds Microsoft DDS)"
    - "Generic-IFF round-trip for IFF formats (.msh, .lmg, .ldt, .sht)"
    - "Binary-stays-binary: geometry ArrayBuffer never crosses as JSON"
    - "De-index pre-bridge pass: global POSN pool → flat per-vertex attribute arrays + Uint32 indices"
key_files:
  created:
    - packages/contracts/src/mesh.ts
    - packages/contracts/src/skeleton.ts
    - packages/contracts/src/animation.ts
    - packages/contracts/src/material.ts
    - packages/native-core/modules/core/formats/Mesh.h
    - packages/native-core/modules/core/formats/Mesh.cpp
    - packages/native-core/modules/core/formats/MeshLod.h
    - packages/native-core/modules/core/formats/MeshLod.cpp
    - packages/native-core/modules/core/formats/LodDistanceTable.h
    - packages/native-core/modules/core/formats/LodDistanceTable.cpp
    - packages/native-core/modules/core/formats/Shader.h
    - packages/native-core/modules/core/formats/Shader.cpp
    - packages/native-core/modules/core/formats/Palette.h
    - packages/native-core/modules/core/formats/Palette.cpp
    - packages/native-core/modules/core/formats/Dds.h
    - packages/native-core/modules/core/formats/Dds.cpp
    - packages/native-core/modules/core/geometry/DeIndex.h
    - packages/native-core/modules/core/geometry/DeIndex.cpp
    - packages/native-core/src/mesh_binding.cpp
    - packages/harness/test/mesh-roundtrip.test.ts
    - packages/harness/fixtures-real/lod/synthetic_2level.ldt
    - packages/harness/fixtures-real/palette/synthetic_2color.pal
  modified:
    - packages/native-core/modules/core/CMakeLists.txt
    - packages/native-core/src/addon.cpp
    - packages/contracts/src/index.ts
    - packages/renderer/package.json
    - .gitignore
decisions:
  - "D-MESH-01: IFF DATA payload tags use raw LE memcpy (not BE htonl) on Windows — readU32LE not readU32BE for slot tags in Shader.cpp"
  - "D-MESH-02: LDTB distances stored as-read (sqrt values on disk); client squares at runtime — store floating-point as-is"
  - "D-MESH-03: LSPT v0001 = uint16 indices, LSPT v0000 = int32 indices (from loadStaticIndexBuffer16/32)"
  - "D-MESH-04: versionOrComponentCount in RIFF PAL is uint8 (1 byte), not a uint16 field; !=4 forces alpha=255"
  - "D-MESH-05: Synthetic .pal + .ldt fixtures for formats not extractable from unencrypted TREs; committed to repo; real .msh/.dds/.sht/.lmg remain gitignored"
metrics:
  duration: "~3 hours (spanning 2 sessions)"
  completed: "2026-06-24T04:28:34Z"
  tasks_completed: 3
  tests_added: 18
  files_created: 22
  files_modified: 5
---

# Phase 2 Plan 01: R3F Stack + Phase-2 Format Parsers + CORE-05 Gates Summary

C++20 engine-free parsers for six SWG binary formats (MESH/MLOD/LDTB/SSHT/PAL/DDS) with N-API bindings, TypeScript contract types, and byte-exact CORE-05 round-trip harness.

## What Was Built

### Task 1: R3F Deps + Contract Types (commit `e17fc04`)

Installed `three@0.184.0`, `@react-three/fiber@9.6.1`, `@react-three/drei@10.7.7` in `packages/renderer`. Created four new contract type files in `packages/contracts/src/`:

- **mesh.ts**: `MeshAttributeSlice` (offset/byteLength/componentCount/elementCount), `MeshShaderGroup`, `MeshParseResult` — indices documented as Uint32, geometry as single ArrayBuffer
- **skeleton.ts**: `BoneNode` (w,x,y,z quat order per oracle), `SkeletonParseResult`
- **animation.ts**: `AnimationVariant`, `AnimationJoint` (sparse channel descriptor), `AnimationParseResult`
- **material.ts**: `ShaderSlot`, `ShaderParseResult`, `PaletteParseResult`, `DdsParseResult`, `LodParseResult`, `DdsMipEntry`, `PaletteEntry` — DDS/PAL explicitly documented as PARSER-NATIVE round-trip

### Task 2: C++ Format Parsers + N-API Binding (commit `7b41213`)

Six format parsers implemented and exposed via N-API, all engine-free, all verified against real swg-client-v2 oracle files:

| Format | File | Oracle | Key finding |
|--------|------|--------|-------------|
| FORM MESH | Mesh.h/cpp | MeshAppearanceTemplate.cpp + ShaderPrimitiveSetTemplate.cpp | SPS→CNT→per-shader FORM; LSPT v0001=uint16, v0000=int32 |
| FORM MLOD | MeshLod.h/cpp | LodMeshGeneratorTemplate.cpp:210-254 | levelCount is int16 NOT int32 |
| FORM LDTB | LodDistanceTable.h/cpp | LodDistanceTable.cpp:140-175 | Distances in INFO chunk, stored as-read (not pre-squared) |
| FORM SSHT/CSHD | Shader.h/cpp | StaticShaderTemplate.cpp:671-810 | DATA payload tags are LE uint32 (not BE) |
| RIFF PAL | Palette.h/cpp | PaletteArgb.cpp:450-607 | versionOrComponentCount is uint8 (1 byte) |
| MS DDS | Dds.h/cpp | Dds.h + Texture.cpp:487-654 | 128-byte header; mip data at offset 128 |

De-index utility (`DeIndex.h/cpp`): converts global POSN/NORM pools + per-shader PIDX/NIDX → flat per-vertex attribute arrays. Output indices are Uint32 (NOT Uint16; meshes exceed 65535 verts). `normalizeSkinWeightsInto()` pre-bridge pass for skinned mesh (02-02).

N-API exports added to `mesh_binding.cpp` and registered in `addon.cpp`: `parseMesh`, `parseMeshLod`, `parseLodDistanceTable`, `parseShader`, `parsePalette`, `parseDds`.

### Task 3: CORE-05 Round-Trip Gates (commit `6de29e7`)

18 tests in `packages/harness/test/mesh-roundtrip.test.ts` covering all six parsers:

- **Generic-IFF round-trip** (`.msh`, `.lmg`, `.ldt`, `.sht`): `serializeIff(parseIff(bytes)) === bytes`
- **PARSER-NATIVE round-trip** (`.pal`, `.dds`): `parseFmt(bytes).roundTripBytes === bytes`
- **Binary-ArrayBuffer assertions**: geometry and roundTripBytes are `instanceof ArrayBuffer`, never JSON
- **Semantic assertions**: shader slot tags, mip dimensions, palette entries, LDTB level distances

Synthetic fixtures committed for formats not available in unencrypted TREs:
- `fixtures-real/lod/synthetic_2level.ldt` — 50-byte FORM LDTB v0000, 2 levels
- `fixtures-real/palette/synthetic_2color.pal` — 32-byte RIFF PAL, 2 RGB entries

All 90 harness tests pass (10 test files).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Shader slot tag byte-order: readU32BE → readU32LE**
- **Found during:** Task 2 verification against real `2d_distort.sht` fixture
- **Issue:** Initial Shader.cpp used `readU32BE()` (manual bit-shift) for DATA chunk payload tags. On a little-endian Windows machine, `insertChunkData(TAG_MAIN)` stores bytes as raw memcpy (LE), so tags on disk are `[0x4E, 0x49, 0x41, 0x4D]` (= "NIAM" if read big-endian).
- **Root cause:** IFF structural tags (FORM/chunk headers) use `htonl`/`ntohl` (BE), BUT DATA payload tags written by `insertChunkData(uint32)` use raw `memcpy` (LE on Windows). This distinction is documented in `sharedFoundation/Tag.h`.
- **Fix:** Renamed `readU32BE()` to `readU32LE()`, changed shift-based read to `std::memcpy`. `tagToString()` was already correct (treats input as BE uint32 value `0x4D41494E` → "MAIN").
- **Verification:** Real `2d_distort.sht` parses as `slots=[{MAIN, placeholder}, {NOIS, placeholder}]` after fix.
- **Files modified:** `packages/native-core/modules/core/formats/Shader.cpp`
- **Commit:** `6de29e7` (bundled with Task 3 fixtures commit)

**2. [Rule 2 - Missing] Synthetic fixtures for formats in encrypted TREs**
- **Found during:** Task 3, fixture extraction step
- **Issue:** All `.pal` files in the SWG Infinity client are in `mtg_patch_013_configurable_02.tre` (v6000 encrypted, enumerate-only per memory context). No standalone `.ldt` files found in any TRE (they're embedded inside appearance templates).
- **Fix:** Created minimal synthetic fixtures matching the exact oracle byte layouts:
  - `synthetic_2level.ldt`: Built from FORM LDTB v0000 per `LodDistanceTable.cpp:140-175`
  - `synthetic_2color.pal`: Built from RIFF PAL per `PaletteArgb.cpp:450-607`
- **Verification:** Both parse correctly and produce byte-exact round-trips.
- **Files added:** `fixtures-real/lod/synthetic_2level.ldt`, `fixtures-real/palette/synthetic_2color.pal`

**3. [Rule 2 - Missing] .gitignore additions for real asset file types**
- **Found during:** Task 3, git status check before committing
- **Issue:** The existing `.gitignore` only blocked `.tre`/`.TRE` files in `fixtures-real/`. Real game assets (.msh, .lmg, .dds, .sht, .cshd) extracted from client TREs were untracked but committable.
- **Fix:** Added extension-based gitignore patterns for all real asset types under `fixtures-real/` subdirectories.
- **Files modified:** `.gitignore`

**4. [Rule 1 - Bug] arc170_body_l0.msh is FORM SKMG, not FORM MESH**
- **Found during:** Task 3, fixture extraction
- **Issue:** `arc170_body_l0.msh` (LOD level 0 = highest poly) is a skeletal mesh (FORM SKMG), not a static mesh. The "_l0" suffix doesn't imply format type.
- **Fix:** Scanned multiple .msh files to find static FORM MESH assets; extracted `arc170_body_l2.msh` (LOD level 2 = lower poly, FORM MESH, 61340 bytes, 2 shader groups).

## Known Stubs

- `ShaderResult.effectPath` returns `""` (empty) for MVP — the `.eft` reference inside SSHT was not parsed. Future plan 02-03 (material pipeline) will extract the actual shader effect path.
- `ShaderResult.customizationVars` returns `[]` for both SSHT and CSHD — CSHD customization variable parsing (pathway A/B/C) deferred to 02-03.
- `AnimationParseResult` type is defined in contracts but no C++ parser exists yet — deferred to 02-05 (animation plan).
- `SkeletonParseResult` type is defined in contracts but no C++ parser exists yet — deferred to 02-02 (skinned mesh plan).

## Self-Check

Files created/verified:
- `packages/harness/test/mesh-roundtrip.test.ts` — 18 tests, all passing
- `packages/harness/fixtures-real/lod/synthetic_2level.ldt` — 50 bytes, round-trip verified
- `packages/harness/fixtures-real/palette/synthetic_2color.pal` — 32 bytes, round-trip verified
- `packages/native-core/modules/core/formats/Shader.cpp` — bug fix committed

Commits verified:
- `e17fc04` — Task 1 (contracts + R3F deps)
- `7b41213` — Task 2 (C++ parsers + N-API binding)
- `6de29e7` — Task 3 (fixtures + test suite + shader bug fix)

Test suite: 90/90 passing (10 test files including 18 new mesh-roundtrip tests)

## Self-Check: PASSED
