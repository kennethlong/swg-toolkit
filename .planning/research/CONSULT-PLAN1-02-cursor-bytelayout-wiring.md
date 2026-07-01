# Consult task — Cursor — Phase 1 plan review (ANGLE: byte-layout truth + native wiring)

You are one of four independent reviewers. Review ONLY through your assigned lens below.

## Treat as given (locked facts — do NOT re-derive)
- Phase 1 builds an engine-free **C++20** static lib (`packages/native-core/modules/core/`) that
  ports IFF + TRE read/write, plus a thin N-API binding and a vitest round-trip harness.
- Phase 0 already shipped the app shell in THIS repo: a pnpm workspace, an Electron-Forge + Vite
  app, a cmake-js N-API addon (`packages/native-core/` with `addon.cpp`, `sab.cpp`, `sab-rw.cpp`,
  `CMakeLists.txt` currently `set(CMAKE_CXX_STANDARD 17)` at line 5), a `packages/contracts/` types
  package, and a SharedArrayBuffer/cross-origin-isolation proof. The plans bump that addon 17→20.
- Ground-truth sources you CAN read: `..\swg-client-v2` (`TreeFile*.cpp`, `Iff.cpp`),
  `..\Utinni` (`TreFile.cs`, `TreVersions.cs`, `IffReader/IffWriter.cs`), `..\swg-blender-plugin\swg_pipeline\tre_reader.py`.

## The plans under review (read in full)
- `.planning\phases\01-core-engine-iff-tre-verification-harness\01-01-PLAN.md` … `01-04-PLAN.md`

## YOUR ANGLE — byte-layout correctness + native/build wiring
The plans assert specific binary facts and a specific native architecture. Check them against the
REAL loader source and the REAL Phase-0 files in this repo:
1. **Byte layout:** TRE header is 36 bytes, magic on disk is `EERT` (reversed `TREE`), TOC records
   are CRC-first with stride 24 (v0004/0005/5000) / 32 (v0006/6000), name block is flat
   null-terminated, builder writes an MD5 trailer block; IFF is big-endian, FORM length INCLUDES the
   4-byte subtype, SWG omits the EA-IFF-85 odd-byte pad. Confirm each against the cited source; flag
   any that the source contradicts.
2. **Native wiring:** is the C++20 unification correct (does bumping the addon to C++20 risk the
   Phase-0 `sab`/`sab-rw`/cross-origin-isolation proof)? Is the `Napi::AsyncWorker` + `Napi::Reference`
   lifetime pattern (holding input ArrayBuffers across the async boundary) correct? Is zlib wiring
   (`find_package(ZLIB)` + miniz fallback) sound? Does "structure crosses as typed JSON, payload
   crosses as zero-copy ArrayBuffer" hold everywhere, or does any task leak payload bytes through JSON?
Do not evaluate plan scope, test sufficiency, or citation honesty — other reviewers own those.

## Output format (markdown)
1. **Summary** — are the byte-layout facts and native wiring correct?
2. **Strengths** — what's right
3. **Concerns** — bullets tagged HIGH / MEDIUM / LOW, each with the file/line evidence
4. **Suggestions** — concrete fixes
5. **Risk Assessment** — LOW / MEDIUM / HIGH with justification
