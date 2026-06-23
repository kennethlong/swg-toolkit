# Phase 1: Core Engine — IFF + TRE + Verification Harness - Research

**Researched:** 2026-06-22
**Domain:** SWG binary container formats (IFF FORM/chunk, TRE archive), N-API zero-copy bridge, byte-exact round-trip verification
**Confidence:** HIGH for the on-disk layouts (read directly from the real client loader source AND cross-checked against Utinni's fixture-validated C# impl); MEDIUM for the byte-identical *full-archive* repack (the SWG builder's exact byte sequence is reconstructable from source but not yet validated against retail bytes in this repo).

> **Ground-truth discipline (project #1 constraint):** Every binary-layout claim below cites the real loader source `file:line` it was read from. The `docs/01-core-engine/iff-and-tre.md` design was distilled from an AI session and is **substantially WRONG** on the binary layouts — see the dedicated "Docs Corrections" section. Do NOT plan from the docs' struct layouts.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Port to clean, modern C++ using `swg-client-v2` `TreeFile.cpp` as the line-by-line spec. Do NOT compile the SOE engine `.cpp` as-is (it drags in `sharedFoundation` ConfigFile/ExitChain/Os/Production, `sharedSynchronization/Mutex`, `sharedDebug`, `FileStreamer`, `FileManifest`). Do NOT write docs-first.
- **D-02:** Structure the port as a **standalone, engine-free C++ static library** — no globals, injectable IO/streams, RAII, C++20-ish. The N-API addon is a **thin binding** over it. The harness links the lib **headless**; reusable later by MCP/CLI.
- **D-03:** **Two ground truths.** Primary = `swg-client-v2` `TreeFile.cpp` (+`TreeFile_SearchNode`) and the IFF loader; cross-check binary layouts against **Utinni C# `Formats/{Iff,Tre}`** when ambiguous. Every parser/serializer cites its `swg-client-v2` loader source (standing gate).
- **D-04:** **Full read + write for BOTH TRE and IFF in Phase 1.** Build the TRE builder/repacker now so the full archive round-trip (read→write→byte-identical `.tre`) is proven. ⚠ Pulls `.tre` patch-packaging forward from DEPLOY-01 (Phase 4) — flag for dedupe. Builder PRIMITIVE only; deploy workflow stays Phase 4.
- **D-05:** **Support ALL TRE format variants** (v0004/v0005/v0006/v5000/v6000 and all compressors), not just one client's flavor.
- **D-06:** Ship a functional read-focused UI in the Phase-0 dockview shell: TRE VFS browser (mount, override/shadow order, search) + generic IFF FORM/chunk tree viewer. No 3D.
- **D-07:** For IFF leaf chunks with no typed editor yet: show structure tree (tag/size/byte-offset) + raw hex/ASCII inspector pane. SIE-successor baseline. No per-format typed decode in Phase 1.
- **D-08:** **No in-UI IFF editing** in Phase 1 — byte-exact write path proven via harness/tests, not the UI.
- **D-09:** **Layered fixtures.** (a) Commit tiny synthesized/handcrafted fixtures (seed from Utinni `Fixtures/{iff,tre}`). (b) Gitignored local-real fixtures from real client assets for the "real asset byte-exact" gate.
- **D-10:** **Asset safety:** copy reference `.tre` from installed clients into a gitignored scratch dir; tests round-trip on COPIES only — never the reference installs.
- **D-11:** Seed the harness from Utinni fixtures AND `swg-client-v2` `tre-compare` verify configs.
- **D-12:** **Multi-client gate from the start** — gate mount + real-asset round-trip + override matrix against SWG Infinity AND SWGEmu equally.

### Claude's Discretion
- Harness enforcement mechanism (reusable + coverage-enforced + cites loader source per fixture).
- Async worker model for CORE-06 (resolve against Path-B renderer + zero-copy SAB) → **resolved below: C++ N-API `Napi::AsyncWorker` on the libuv threadpool.**
- TRE search semantics (substring/glob/regex) → **resolved below.**
- IFF endianness handling → **resolved below: IFF is big-endian, TRE is little-endian.**
- C++20 specifics, lib/binding file layout, cmake-js wiring.

### Deferred Ideas (OUT OF SCOPE)
- `.tre` patch-packaging / `.cfg` activation as a user workflow → Phase 4 (DEPLOY-01..04). Phase 1 ships the builder PRIMITIVE only.
- In-UI IFF chunk editing with save-back → past Phase 1 (D-08).
- Per-format typed decoders (datatables/STF/mesh/terrain/etc.) → Phases 2/5/7.
- MCP server / CLI reuse of the standalone lib → Phase 8.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | Mount one+ `.tre` as a VFS with correct load-order/override (shadow) resolution | Search-node priority list + per-archive binary-search exists() resolution proven in `TreeFile.cpp:285-461` and `TreeFile_SearchNode.cpp:360-408`; override semantics + numeric search order proven from `verify-swginfinity.cfg`. See "TRE Override Resolution". |
| CORE-02 | Browse + search the mounted VFS by path/name | Name block = flat null-terminated path strings (`TreeFile_SearchNode.cpp:329, 382`); search semantics resolved (substring default, optional glob). See "TRE Search Semantics". |
| CORE-03 | Parse arbitrary IFF (FORM/chunk) into a navigable tree | Full FORM/chunk walk + big-endian framing proven in `Iff.cpp:102-134, 508-555, 1132-1310`; container-vs-leaf discriminator (`getFirstTag == 'FORM'`) at `Iff.cpp:1076-1095`. See "IFF Format". |
| CORE-04 | Serialize edited IFF structure byte-exact | `Iff::write` dumps the in-memory buffer verbatim (`Iff.cpp:419-429`); byte-exactness = preserve buffer + hybrid-DOM verbatim-slice re-emit for clean nodes (Utinni `IffWriter.cs:98-187`). SWG no-pad quirk is the critical pitfall. See "IFF Byte-Exact Serialize". |
| CORE-05 | Reusable byte-exact round-trip harness wired into every format | Fixture registry + `assertRoundTrip` + sweep coverage test; layered fixtures (committed synth + gitignored real). See "Verification Harness". |
| CORE-06 | Zero-copy N-API + async worker (UI never blocks) | Path-B in-renderer addon + SAB zero-copy (Phase-0 FND-01..04); `Napi::AsyncWorker` for heavy parse/mount. See "Async Worker Model". |
</phase_requirements>

## Summary

The entire Phase-1 binary surface is **fully recoverable from real source** — this is the rare case where ground truth is unambiguous and a second independent implementation (Utinni) already cross-validated it against retail client bytes. There is **no need to trust any AI-proposed layout**.

Two container formats, two endiannesses (this is the single biggest correction to the docs):

- **The TRE magic on disk is `EERT`** — the raw little-endian dump of the in-memory Tag `TAG(T,R,E,E)`=`0x54524545` (bytes `45 45 52 54`). Utinni checks magic bytes `E,E,R,T` (`TreFile.cs:155-156`). The **version field reads forward as a plain ASCII string** `"0004"/"0005"/"0006"/"5000"/"6000"` (Utinni `GetString`, no reversal, `TreFile.cs:169`; `TreVersion.cs:60-73`). The docs' forward "TREE0005" magic is wrong (it is `EERT` on disk); the version digits, however, ARE forward.
- **IFF FORM/chunk tags and lengths are stored BIG-ENDIAN** (the loader byte-swaps with `ntohl`/`htonl`). `'FORM'` reads as readable ASCII `FORM`; the length `uint32` is MSB-first. (`Iff.cpp:522, 539, 637, 643`).

The primary oracle `swg-client-v2 TreeFile.cpp`/`TreeFile_SearchNode.cpp` reads **only v0004/v0005** (`TreeFile_SearchNode.cpp:278-280`) and its writer (`TreeFileBuilder.cpp:146, 778`) emits **only v0005**. Utinni — the second ground truth — extends this to **v0006, v5000, and v6000**, with the critical discovery that **v6000 payloads are encrypted (enumerate-only)** and **v6000 uses a 32-byte crc-first record stride** vs the 24-byte size-first stride of v0004/v0005/v0006. CONTEXT D-05 ("support ALL variants") is therefore satisfiable for READ on 0004/0005/0006/5000 and ENUMERATE-ONLY on 6000.

**Primary recommendation:** Port `TreeFile_SearchNode.cpp` + `Iff.cpp` into a clean engine-free C++20 static library with injectable IO (replacing `FileStreamer`/`ConfigFile`/`Mutex` with thin interfaces). Drive the per-record field-order and version dispatch from Utinni's verified table (`TreVersions`). Use `Napi::AsyncWorker` for heavy mount/parse, returning zero-copy `ArrayBuffer`/`SharedArrayBuffer`. Build the harness as a fixture-registry + `assertRoundTrip` whose sweep test fails CI if any registered format lacks a round-trip case, seeded from Utinni's fixtures and gitignored copies of Infinity/SWGEmu retail archives.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TRE archive parse/mount/repack | Native C++ lib | N-API binding | Heavy binary work; must be engine-free + reusable by MCP/CLI (D-02) |
| IFF FORM/chunk parse + byte-exact serialize | Native C++ lib | N-API binding | Same; the dependency root every later format inherits |
| zlib decompress / deflate | Native C++ lib | — | Per-record + per-block; belongs next to the parser, not JS |
| Async off-main-thread execution | Native C++ (`AsyncWorker`) | backend orchestration | CORE-06; libuv threadpool keeps the renderer responsive |
| Zero-copy payload transfer | N-API (`ArrayBuffer`/SAB) | contracts types | Binary stays binary across the bridge (AGENTS.md) |
| VFS browse-tree + search index | backend / renderer | native enumerate | Tree shape + search is a JS-side projection of the native TOC |
| Hex/ASCII inspector, FORM tree view | renderer (dockview) | contracts types | Pure presentation of native parse results (D-06/D-07) |
| Round-trip verification | harness (links C++ lib headless) | CI | Standing gate; bare-Node vitest against the same prebuild |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-addon-api | ^8.8.0 | N-API C++ bindings + `Napi::AsyncWorker` + `Napi::SharedArrayBuffer` | Already pinned & proven in Phase 0 (`native-core/CMakeLists.txt:43-47`); ABI-stable prebuild serves both bare Node (vitest) and Electron [VERIFIED: native-core/CMakeLists.txt] |
| cmake-js | (Phase-0 pinned) | Build the addon; generator pinned to `Visual Studio 17 2022` x64 | Reuses CMake; chosen in Phase 0 (STATE.md) [VERIFIED: STATE.md] |
| zlib | system / vendored | TRE per-record + TOC/name-block compression; deflate/inflate | The ONLY compressor the real format uses (`CT_zlib`, `TreeFile_SearchNode.cpp:13, 534`); see compressor codes below [VERIFIED: TreeFile_SearchNode.cpp] |
| vitest | (Phase-0 pinned) | Harness runner (bare-Node, links the prebuild) | Established in Phase 0; harness runs headless against the ABI-stable prebuild |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zustand 5 | (Phase-0) | VFS browser + IFF tree UI state | D-06 UI state |
| dockview | (Phase-0) | Host TRE browser sidebar + IFF tree/hex pane | D-06/D-07 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Napi::AsyncWorker` (libuv pool) | Node `worker_threads` | worker_threads needs a separate addon instance + SAB hand-off message; AsyncWorker runs the C++ off-thread and resolves a Promise on the JS thread with zero extra IPC. Under Path B (addon in-renderer) AsyncWorker is strictly simpler. |
| `Napi::AsyncWorker` | Web Worker | Web Worker can't call the native addon directly under Path B without re-loading it; SAB cross-worker sharing works but adds a hop. Use only if a pure-JS pre/post step needs parallelism. |
| Vendored zlib | miniz (single-header) | miniz is convenient for a standalone lib (no system dep), but zlib is what the client links and guarantees bit-identical deflate streams for the compressed-block path. Prefer zlib for parity; miniz acceptable for the *inflate* side only. **OPEN: validate deflate stream identity — see pitfalls.** |

**Installation:** No new npm packages required for the native core beyond the Phase-0 set. zlib is linked at the CMake level (vendor or find_package). The harness reuses the existing vitest install.

**Version verification:** node-addon-api ^8.8.0 and cmake-js are already installed & proven in Phase 0 (`native-core/package.json`, CMakeLists.txt). No registry lookup needed — these are inherited, not newly introduced.

## Package Legitimacy Audit

> Phase 1 introduces **no new external npm/PyPI/crates packages**. All native dependencies are inherited from Phase 0 (node-addon-api, cmake-js) or are C/C++ system libraries (zlib) linked at the CMake level, not via a package registry.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| node-addon-api | npm | mature (8.x) | very high | github.com/nodejs/node-addon-api | n/a (inherited) | Approved (Phase-0 proven) |
| cmake-js | npm | mature | high | github.com/cmake-js/cmake-js | n/a (inherited) | Approved (Phase-0 proven) |
| zlib | C lib | mature | n/a | github.com/madler/zlib | n/a (not a JS pkg) | Approved (client links it) |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.
*slopcheck was not run because no new registry packages are introduced this phase. If the planner adds a JS dependency (e.g. a glob-matching helper for search), gate it behind a `checkpoint:human-verify` and run the legitimacy gate then.*

## Architecture Patterns

### System Architecture Diagram

```
                       ┌─────────────────────────────────────────────┐
   .tre / .iff files   │            renderer (Path B, dockview)        │
   on disk             │  TRE browser  │  IFF FORM tree  │  hex/ASCII  │
        │              └───────┬───────────────┬─────────────┬─────────┘
        │                      │ mount/search   │ parse       │ getChunkBytes
        │                      ▼                ▼             ▼
        │              ┌───────────────────────────────────────────────┐
        │              │     backend services  (contracts-typed msgs)   │
        │              └───────────────────────┬───────────────────────┘
        │                                      │  Napi calls
        │                                      ▼
        │              ┌───────────────────────────────────────────────┐
        │              │   thin N-API binding  (Napi::AsyncWorker)       │
        │              │   - mountArchive(paths[])  → off-thread          │
        │              │   - listEntries() / search(query)               │
        │              │   - readEntry(idx) → zero-copy ArrayBuffer       │
        │              │   - parseIff(bytes) → tree (offsets, tags)       │
        │              │   - serializeIff(tree) → bytes  (byte-exact)     │
        │              │   - repackTre(archive, edits) → bytes            │
        │              └───────────────────────┬───────────────────────┘
        │                                      │  C++ calls (no Napi)
        ▼                                      ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  STANDALONE ENGINE-FREE C++ LIB  (links headless into the harness too) │
  │                                                                        │
  │   IInputStream / IOutputStream  (injectable IO — replaces FileStreamer)│
  │        │                                                               │
  │        ├── TreArchive   (port of TreeFile_SearchNode.cpp SearchTree)   │
  │        │     parse header → TOC → name block; binary-search resolve;   │
  │        │     per-record zlib inflate; version dispatch (Utinni table)  │
  │        │                                                               │
  │        ├── TreMount     (port of TreeFile.cpp search-node priority)    │
  │        │     ordered list of archives; first-match-wins shadow resolve │
  │        │                                                               │
  │        ├── TreBuilder   (port of TreeFileBuilder.cpp)                  │
  │        │     sort by crc/name; compress; write header twice (seek-back)│
  │        │                                                               │
  │        └── Iff          (port of Iff.cpp)                              │
  │              big-endian FORM/chunk walk; stack of (start,length,used); │
  │              hybrid-DOM verbatim re-emit for byte-exact serialize      │
  │                                                                        │
  │   zlib (inflate/deflate)                                               │
  └──────────────────────────────────────────────────────────────────────┘
```

A reader can trace the primary use case (mount Infinity, browse, open an `.iff`, view its FORM tree + hex) by following: file → AsyncWorker mount → native TreMount → enumerate TOC → backend → renderer browser → select entry → readEntry zero-copy → parseIff → FORM tree + hex pane.

### Recommended Project Structure
```
packages/native-core/
├── src/
│   ├── addon.cpp              # existing — register exports
│   ├── sab*.cpp / hello.cpp   # existing Phase-0 proof (keep)
│   ├── tre_binding.cpp        # NEW thin N-API binding over the lib
│   └── iff_binding.cpp        # NEW thin N-API binding over the lib
├── modules/core/             # NEW engine-free static lib (D-02)
│   ├── CMakeLists.txt        # add_subdirectory wired from root (line 50 stub)
│   ├── io/IInputStream.h     # injectable IO interface
│   ├── tre/TreArchive.{h,cpp}
│   ├── tre/TreMount.{h,cpp}
│   ├── tre/TreBuilder.{h,cpp}
│   ├── tre/TreVersion.h      # version dispatch table (from Utinni TreVersions)
│   └── iff/Iff.{h,cpp}
│   └── compress/Zlib.{h,cpp}
├── test/                     # existing
packages/contracts/src/
│   ├── tre.ts                # NEW: mount-config, TreEntry, search msg types
│   ├── iff.ts                # NEW: IffNode (tag, length, byteOffset, kind)
packages/harness/            # NEW (or under native-core/test)
│   ├── assertRoundTrip.ts
│   ├── fixtureRegistry.ts
│   ├── fixtures/             # committed tiny synth (from Utinni seeds)
│   └── fixtures-real/        # GITIGNORED real-asset copies (D-09/D-10)
```

### Pattern 1: Injectable IO (engine-free port, D-02)
**What:** The real loader reads through `FileStreamer::File::read(offset, buf, len, priority)`. Replace it with a minimal interface so the lib has no SOE-engine dependency and the harness can feed `MemoryFile`-style buffers.
**When to use:** Everywhere the port currently calls `FileStreamer` / `Os` / `ConfigFile`.
```cpp
// Source-derived from FileStreamer::File usage in TreeFile_SearchNode.cpp:227-330
struct IInputStream {
    virtual ~IInputStream() = default;
    // returns bytes read; reads `len` bytes at absolute `offset`
    virtual int read(int offset, void* dst, int len) = 0;
    virtual int length() const = 0;
};
// MemoryInputStream wraps a byte buffer (harness + zero-copy ArrayBuffer path);
// FileInputStream wraps std::ifstream (file path mount).
```

### Pattern 2: TRE version dispatch (from Utinni, fixture-validated)
**What:** Per-version record stride + field order. The primary C++ oracle only handles 0004/0005; Utinni extends to 0006/5000/6000 and is the authoritative dispatch source.
```cpp
// Source: Utinni TreVersion.cs:88-105 (cross-checked vs TreeFile_SearchNode.h:189-197)
enum class TreVersion { V0004, V0005, V0006, V5000, V6000 };
// recordStride: 24 for 0004/0005/0006/5000 ("size-first"); 32 for 6000 ("crc-first" + 8 pad)
// isCrcFirst:   true for 5000 & 6000; false for 0004/0005/0006
// enumerateOnly: true ONLY for 6000 (encrypted payloads)
```

### Pattern 3: Hybrid-DOM verbatim re-emit (byte-exact IFF serialize, CORE-04)
**What:** A clean (unedited) node re-emits its captured source-byte slice verbatim; only a dirty node reserializes. Ancestor invalidation guarantees a clean ancestor never overwrites a dirty subtree.
**When to use:** This is THE strategy that makes byte-exact serialize tractable despite the SWG no-pad quirk and any unknown trailing bytes.
```csharp
// Source: Utinni IffWriter.cs:98-121 — port this control flow to C++
if (!node.IsDirty && node.capturedSlice != null) { write(capturedSlice); return; }
// else reserialize: BE_u32(tag) · BE_u32(len) · [subType4 for container] · children/payload
// NO trailing pad byte (SWG no-pad quirk)
```

### Anti-Patterns to Avoid
- **Reading the docs' struct layouts as fact.** `docs/01-core-engine/iff-and-tre.md` §7 (`TreIndexEntry` 20-byte, fields in wrong order, "TREE0005" magic forward, little-endian IFF claim) is fabricated. Use only the real source.
- **Assuming IFF pads odd-length chunks.** EA-IFF-85 pads; real SWG datatables DO NOT (`IffReader.cs:307-327`). Assuming a pad corrupts byte-exactness and mis-parses real assets.
- **Recompressing untouched TRE entries on repack.** Deflate is not guaranteed bit-identical across zlib versions/levels; copy untouched entries' raw compressed slices verbatim (`TreWriter.cs:166-174`).
- **Treating TRE search node order as "last loaded wins" blindly.** It is a *priority-sorted* list; same-priority ties insert after the last match (`TreeFile.cpp:299-308`). See override section.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TRE header/TOC/name-block parse | A docs-derived 20-byte struct reader | Port `TreeFile_SearchNode.cpp:226-349` exactly | The docs' layout is wrong (field count, order, size); the real struct is 36-byte header + 24/32-byte records |
| TRE override/shadow resolution | A custom "newest file wins" map | Port the priority search-node list (`TreeFile.cpp:285-461`) | Real resolution is priority-ordered first-match across a sorted node list, not a flat map |
| IFF FORM/chunk walk | A fresh recursive descent from the docs | Port `Iff.cpp` stack walk (or mirror Utinni `IffReader.cs`) | Endianness (BE), the form-length-includes-subtype-tag rule, and no-pad quirk are all non-obvious |
| zlib inflate/deflate | A custom decompressor | zlib (link it) | The only compressor used; `ZlibCompressor().expand` in source |
| Byte-exact IFF serialize | A naive re-serialize-everything writer | Hybrid-DOM verbatim slice re-emit (`IffWriter.cs`) | Naive re-serialize loses unknown trailing bytes and pad-quirk fidelity |
| Multi-client verification fixtures | Hand-crafted test archives only | `tre-compare` verify-*.cfg + Utinni fixtures (D-11) | Ready-made multi-server byte-exact assets already exist |

**Key insight:** This phase is a **port, not an invention.** Two independent, mutually-validating implementations of every byte layout already exist in the sibling repos. The risk is not "can we figure out the format" — it's "will we accidentally trust the wrong (AI-distilled docs) layout instead of the real source." The standing gate (cite the loader source + round-trip on a real asset) is exactly the right control.

---

## TRE Archive Format (VERIFIED against real source + Utinni)

### Header (36 bytes) — `TreeFile_SearchNode.h:174-185` (struct `Header`), read in `TreeFile_SearchNode.cpp:267-275`
All fields little-endian `uint32` (raw struct dumped on LE host).

| Offset | Field | Type | Notes |
|--------|-------|------|-------|
| 0 | token (magic) | 4 bytes | On disk the four bytes are literally **`45 45 52 54` = `"EERT"`** (Utinni checks magic[0..3]==E,E,R,T, `TreFile.cs:155-156`). This equals the raw little-endian dump of the in-memory Tag `TAG(T,R,E,E)`=`0x54524545`. **Check magic == "EERT".** [VERIFIED: TreeFile_SearchNode.cpp:36, Tag.h:95; Utinni TreFile.cs:155] |
| 4 | version | 4 ASCII bytes | On disk, read **forward as a plain 4-char ASCII string**: `"0004"`, `"0005"`, `"0006"`, `"5000"`, or `"6000"` (Utinni `GetString(versionBytes)` with NO reversal, `TreFile.cs:169`, then `TreVersions.Parse`). The primary C++ oracle accepts only `TAG_0004`/`TAG_0005` (`TreeFile_SearchNode.cpp:278-280`); Utinni extends the set. **Dispatch on this exact string.** [VERIFIED: Utinni TreFile.cs:163-172, TreVersion.cs:60-73; TreeFile_SearchNode.cpp:278-280] |
| 8 | numberOfFiles | uint32 | record count [VERIFIED: TreeFile_SearchNode.cpp:272] |
| 12 | tocOffset | uint32 | file offset to the TOC/info block [VERIFIED: …cpp:274,306] |
| 16 | tocCompressor | uint32 | 0=none, 2=zlib (see compressor enum) [VERIFIED: …cpp:288] |
| 20 | sizeOfTOC | uint32 | compressed size of the TOC block on disk [VERIFIED: …cpp:291-294] |
| 24 | blockCompressor | uint32 | name-block compressor flag [VERIFIED: …cpp:311] |
| 28 | sizeOfNameBlock | uint32 | compressed size of the name block on disk [VERIFIED: …cpp:314-317] |
| 32 | uncompSizeOfNameBlock | uint32 | uncompressed name-block size [VERIFIED: …cpp:322,329] |

> Utinni names these fields slightly differently (`InfoOffset`, `InfoCompression`, …) but the byte layout is identical — see `TreHeader.cs` + `TreFile.cs:180-200`. **Header size = 36 bytes** is confirmed by `TreFile.cs:65`.

### Per-record TOC entry — TWO layouts (this is the key D-05 complexity)

**Size-first, 24 bytes (v0004/v0005/v0006/v5000)** — Utinni `TreFile.cs:302-310` (the field order the SWGEmu/synthesized goldens exercise):

| Offset | Field | Type |
|--------|-------|------|
| 0 | uncompressedSize (dataSize) | int32 |
| 4 | offset (dataOffset) | int32 |
| 8 | compressor (dataCompression) | int32 |
| 12 | compressedSize | int32 |
| 16 | checksum (crc) | int32 |
| 20 | fileNameOffset | int32 |

**Crc-first, 24 bytes (v5000) / 32 bytes (v6000, +8 pad)** — Utinni `TreFile.cs:284-298`:

| Offset | Field | Type |
|--------|-------|------|
| 0 | crc | int32 |
| 4 | length (uncompressedSize) | int32 |
| 8 | offset | int32 |
| 12 | compressor | int32 |
| 16 | compressedLength | int32 |
| 20 | fileNameOffset | int32 |
| 24 | (v6000 only) pad | int32 = 0 |
| 28 | (v6000 only) pad | int32 = 0 |

> ⚠ **DISCREPANCY between the two oracles — planner must resolve via fixtures.** The swg-client-v2 *header struct* `TableOfContentsEntry` is declared **crc-first** for ALL versions (`TreeFile_SearchNode.h:189-197`: `crc, length, offset, compressor, compressedLength, fileNameOffset`). Utinni instead reads **size-first** for 0004/0005/0006 and crc-first only for 5000/6000 (`TreFile.cs:284-310`), and its `synthesized-3record-v0005.tre` fixture passes that way. **These cannot both be right for the same byte stream.** Resolution path: the Phase-1 round-trip on a REAL Infinity/SWGEmu v0005 archive is the arbiter — whichever field order makes `crc == Crc::calculate(name)` and `offset` point at a valid zlib/IFF payload is correct. Do NOT lock the field order from either source alone; let the real-asset fixture decide. **(OPEN-1)**

### Block ordering on disk (from the builder write sequence, `TreeFileBuilder.cpp:773-833`)
The SWG `TreeFileBuilder` writes in this exact order:
1. **Header** (36 bytes) — written first with only token/version/numberOfFiles set (`:776-780`).
2. **File payloads** — in **response-file order** (`responseFileOrder`, NOT crc/name order), each compressed-or-raw (`:782-793`, `writeFile` `:558-597`).
3. **TOC** (`writeTableOfContents` `:601-634`) — entries in **crc/name-sorted `tocOrder`**, compressed if it helps.
4. **Name block** (`writeFileNameBlock` `:638-654`) — null-terminated names in `tocOrder`.
5. **MD5 block** (`writeMd5Block` `:658-672`) — `numberOfFiles × 16` bytes, ALWAYS uncompressed (`Md5::Value::cms_dataSize`).
6. **Header re-write** — seek back to offset 0, write the full header again with the now-known `tocOffset/tocCompressor/sizeOfTOC/blockCompressor/sizeOfNameBlock/uncompSizeOfNameBlock` (`:806-813`).

> 🔴 **CRITICAL for D-04 byte-identical repack:** The MD5 block (step 5) is **written by the builder but NEVER read back** by `SearchTree` (`TreeFile_SearchNode.cpp:267-349` stops after the name block). A naive repack that omits it will read back fine but will NOT be byte-identical to a builder-produced archive. **To produce a byte-identical `.tre` you must reproduce the MD5 block AND the response-file payload ordering AND the builder's zlib level.** Utinni's own writer explicitly does NOT attempt full-file identity (`TreWriter.cs:36-85` — it guarantees per-record raw-slice identity + logical identity, omits MD5, lays out in record order, writes TOC/names uncompressed). **(OPEN-2)** — see Open Questions.

### Compressor codes — `TreeFile_SearchNode.h:166-172` + Utinni `TreFile.cs:595-607`
| Value | Meaning | Source |
|-------|---------|--------|
| 0 | none (stored raw) | `CT_none` [VERIFIED: TreeFile_SearchNode.h:168] |
| 1 | (Utinni) raw deflate / (SOE) `CT_deprecated` — "no longer supported" | `CT_deprecated` [VERIFIED: TreeFile_SearchNode.h:169, :213]; Utinni treats 1 = raw-deflate [VERIFIED: TreFile.cs:599] |
| 2 | zlib (RFC1950 framed: `0x78` header, body, 4-byte Adler trailer) | `CT_zlib` [VERIFIED: TreeFile_SearchNode.cpp:534]; framing [VERIFIED: TreFile.cs:649-679] |

> The SWG builder only ever emits 0 or 2 (`compressAndWrite` tries only `CT_zlib`, `TreeFileBuilder.cpp:685-687`). Value 1 appears in some non-SWGEmu/synthesized archives as **raw deflate** (no zlib header/trailer) — Utinni handles both. **Inflate must branch on the code: 1 = raw deflate body; 2 = strip 2-byte header + 4-byte Adler, then inflate** (`TreFile.cs:649-679`).

> 🔴 **Patch-archive quirk (uncompressed record with `compressedSize == 0`):** Some real archives (e.g. `patch_*.tre`) store an UNCOMPRESSED record with `compressedLength = 0` as a "not compressed" marker, while the real bytes live at `offset` with length `uncompressedSize`. On-disk read length = `compressor==0 ? uncompressedSize : compressedLength` (`TreFile.cs:402, 501`). Missing this reads the record as empty.

### TRE Override Resolution (CORE-01) — VERIFIED
- A mount is an **ordered list of search nodes sorted by priority, highest first**; same-priority nodes insert **after** the last match (`TreeFile.cpp:285-308`, `searchNodePriorityOrder` = `a.priority > b.priority`).
- `find(fileName)` walks the list and returns the **first node that contains the file** — i.e. **highest-priority-wins / first-match-wins shadow resolution** (`TreeFile.cpp:437-461`).
- Within one archive, lookup is a **binary search over the crc-sorted TOC**, tie-broken by `_stricmp` on the name (`TreeFile_SearchNode.cpp:360-408`). A record with `length == 0` is treated as **deleted** (a tombstone that shadows lower archives) (`:397-401`).
- File names are normalized before lookup: lowercased, backslashes→forward slashes, repeated slashes collapsed, leading `./` `../` stripped (`TreeFile.cpp:511-601` `fixUpFileName`).
- **Search order in the real config** is the numeric suffix of `searchTree_NN_M` keys (e.g. `verify-swginfinity.cfg:5-31`), NOT file mtime. The cfg lists `bottom.tre` first then `infinity_custom_*`, `mtg_patch_*` — **later-numbered entries are higher-priority overrides** in tre-compare's resolution. (In the engine, `searchTree<priority>` config keys map directly to node priority, `TreeFile.cpp:131-138`.)

> **For CORE-01:** model a mount as an **ordered vector of `TreArchive`** plus a resolver that, given a normalized path, returns the **first archive (in mount order) whose binary search finds a non-tombstone record**. Expose the full shadow chain to the UI so the browser can show which archive wins and what it shadows (D-06).

### TRE Search Semantics (CORE-02) — RESOLVED
The real engine does NOT expose substring/glob/regex search — it only does exact normalized-path CRC lookup (`localExists`). `tre-compare` enumerates the full name block and diffs. **Therefore search is OUR design, not the client's.** Recommendation:
- **Default: case-insensitive substring** match over the flat null-terminated name list (matches user expectation for a file browser; cheap over an in-memory string list).
- **Optional: glob (`*`/`?`)** as a power-user toggle — trivial to add over the same list.
- **Do NOT do regex by default** (DoS surface on 100k-entry archives; offer behind an explicit toggle if at all).
- The name list is already materialized post-parse (`TreFile.cs:80` `_namesBytes`); search is an in-memory scan — keep it on the native side or stream the name list once to JS and search there. Given archives can hold 100k+ entries, prefer **native search returning matched indices** to avoid shipping the whole list every keystroke.

---

## IFF Format (CORE-03) — VERIFIED against `Iff.cpp` + Utinni `IffReader.cs`

### Block framing (BIG-ENDIAN)
Every block: `[4-byte Tag][4-byte uint32 length][payload]`. Tag and length are stored **big-endian** — the loader byte-swaps with `ntohl` on read (`Iff.cpp:522, 539`) and `htonl` on write (`Iff.cpp:637, 643, 713`). So `'FORM'` reads as readable ASCII and the length is MSB-first. (This is the EA-IFF-85 standard; the docs' "SWG uses little-endian" claim is **WRONG**.)

- **Leaf chunk:** `Tag · BE_u32(payloadLen) · payload`. The length is the payload byte count, NOT including the 8-byte header.
- **FORM container:** `'FORM' · BE_u32(innerLen) · subTypeTag · children…` where **`innerLen` INCLUDES the 4-byte sub-type tag** (`Iff.cpp:643` writes `length + sizeof(Tag)`; `Iff.cpp:1144` reads `getLength - sizeof(Tag)` to recover child span). A FORM header is **12 bytes** (tag + len + subtype). [VERIFIED: Iff.cpp:643,1143-1144,697,713]
- **Container discriminator:** a block is a FORM iff its first tag `== TAG_FORM` (`Iff.cpp:1076-1095`). The real SWG loader treats **only `FORM`** as a container.
- **EA-IFF-85 extension (Utinni):** Utinni's generic reader also treats `LIST` and `CAT ` (trailing space) as containers (`IffReader.cs:78-83`), since this is a generic IFF viewer. **Planner decision:** the real SWG loader only emits FORM, but the SIE-successor generic viewer (D-06/D-07) should recognize `{FORM, LIST, CAT }`. PROP is a **leaf**. **(OPEN-3)**

### Parse model (`Iff.cpp`)
The loader holds the whole file as one `data` buffer + a **stack of frames** `{start, length, used}` (`Iff.cpp:56-72`). Navigation advances `used` by `getLength + 8` per block (`Iff.cpp:1344, 1362`). Validation: `IffNamespace::isValid` recursively walks, rejecting negative or out-of-bounds lengths, and recursing into FORMs (`Iff.cpp:102-134`). For the navigable tree (CORE-03), record per node: **tag string, declared length, absolute byte-offset of the header, kind (form/leaf), sub-type (forms), child list**. Utinni's `IffReader.cs` builds exactly this (`IffChunk`/`IffContainerChunk`/`IffLeafChunk`) plus a flat preorder list for table views.

### IFF Byte-Exact Serialize (CORE-04) — VERIFIED
`Iff::write` is trivial: it dumps `data[0..stack[0].length]` verbatim to disk (`Iff.cpp:419-429`). **Byte-exactness is therefore automatic IF the in-memory buffer is preserved.** The hard part is editing a chunk without disturbing the rest. Two proven strategies:
1. **Preserve-and-patch (the real loader's model):** keep the original buffer; `adjustDataAsNeeded` memmoves and fixes enclosing length fields when a chunk grows/shrinks (`Iff.cpp:575-648`). Untouched bytes are bit-preserved.
2. **Hybrid-DOM verbatim re-emit (Utinni, recommended for our DOM):** each node captures its source byte slice; a **clean node re-emits its slice verbatim**, a **dirty node reserializes** (`IffWriter.cs:98-187`). This preserves unknown trailing bytes and the no-pad quirk for everything not edited.

> 🔴 **THE byte-exact pitfall — SWG no-pad quirk:** EA-IFF-85 pads odd-length chunks to even with a single uncounted `0x00`. **Real SWG datatables omit the pad** (`IffReader.cs:307-327` — the reader DETECTS a pad, never requires it; the writer emits NONE, `IffWriter.cs:141`). A serializer that adds the standard pad will fail byte-exact round-trip on real assets. **Detect-don't-assume** on read; **emit no pad** on write (matching SWG), but the verbatim-slice re-emit makes this moot for unedited nodes.

> **"Zero unexplained trailing bytes":** the loader's `calculateRawDataSize` walks blocks until `offset >= length || blockLength == 0` and assumes any trailing non-IFF bytes are zero-filled (`Iff.cpp:63-84`). For our viewer, surface any bytes after the last top-level block as an explicit "trailing bytes" node so they're never silently dropped — this is what guarantees byte-exact round-trip on odd real files.

---

## Async Worker Model (CORE-06) — RESOLVED: `Napi::AsyncWorker`

**Decision:** Use **C++ `Napi::AsyncWorker`** (runs on the libuv default threadpool) for every heavy operation — multi-GB archive mount, TOC/name-block inflate, large IFF parse, repack. It resolves a JS Promise on the main thread when done, with **zero extra IPC** under Path B (the addon is already in the renderer, FND-02).

Rationale vs the alternatives (see Stack table): under Path B the addon runs in-renderer, so `worker_threads`/Web Worker would require re-loading the addon in another context and hopping the SAB across an agent-cluster boundary — which Phase 0 proved is the exact thing that breaks (`00-CONTEXT.md` D-02: cross-process SAB throws "could not be cloned"). `AsyncWorker` sidesteps all of that: the C++ work happens off the JS thread, results come back as a zero-copy `ArrayBuffer` (or written into a pre-allocated `SharedArrayBuffer` for the large-payload path).

**Zero-copy contract (AGENTS.md + Phase-0 SAB proof):** binary payloads (extracted file bytes, IFF chunk slices) cross as `Napi::ArrayBuffer`/`SharedArrayBuffer`, never JSON. Only the *structure* (TOC entries, IFF tree node metadata: tag/length/offset/kind) crosses as contracts-typed JS objects. The SAB layout pattern from Phase 0 (`sab-layout.ts`) extends to a payload region for large files.

> **Lifetime caution (carried from Phase-0 research):** if C++ holds a pointer into an `ArrayBuffer.Data()` across an async boundary, GC lifetime matters — keep a `Napi::Reference` to the buffer for the duration of the worker, or copy into a C++-owned buffer before going off-thread.

---

## Verification Harness (CORE-05) — design

**Shape (Claude's discretion → recommended):**
- `assertRoundTrip(parse, serialize, fixtureBytes)` — parses, reserializes, asserts `serialized === fixtureBytes` byte-for-byte; on mismatch, dumps the first differing offset + a hex window (SIE-style) for fast diagnosis.
- `fixtureRegistry` — a manifest mapping each **format id** → `{ parse, serialize, fixtures[], loaderSource }`. Each fixture entry records the `swg-client-v2` `file:line` it was validated against (standing-gate enforcement, per-fixture).
- **Sweep/coverage test** — iterates the registry and **FAILS CI if any registered format has zero round-trip fixtures** OR if any fixture lacks a `loaderSource` citation. This is the mechanism that makes the gate "recur as a standing requirement every later phase inherits" (Phase 2/5/6/7 add their format to the registry and the sweep enforces coverage).
- For Phase 1 the registry has two entries: `tre` and `iff`.

**Layered fixtures (D-09/D-10/D-11):**
- **Committed (tiny, fast, CI-safe):** seed from Utinni `Utinni.Cli.Tests/Fixtures/{iff,tre}` — already includes `synthesized-3record-v0005.tre`, `synthesized-2record-v0006.tre`, `synthetic-v6000-2record.tre`, `zlib-framed-1record-v6000.tre`, malformed cases (`malformed-magic`, `truncated`, `unsupported-version`, `malformed-unknown-compressor`, `malformed-zlib-bad-adler`), and IFF `synthetic-nested.iff`, `odd-chunk-no-pad.iff`, `malformed-truncated.iff`. **Reuse the bytes (public-domain synth) but regenerate our own with documented provenance** — do not copy Utinni's `.expected.json` goldens verbatim (D-03 "cite, don't copy").
- **Gitignored real-asset gate (D-10/D-12):** a script copies a curated handful of archives from `D:\SWG Infinity\…` and `D:\SWGEmu Client\SWGEmu\…` into `fixtures-real/` (scratch, gitignored); the real-asset lane mounts copies, round-trips, and runs the override matrix. CI on a clean clone skips this lane (no retail bytes present) — it's an opt-in/local lane.
- **`tre-compare` configs (D-11):** the `verify-*.cfg` files (`swgemu`, `swginfinity`, `stardust`, `swglegends`, `swgsource`) are a ready-made multi-server override-matrix spec — drive the override-resolution test from them.

---

## Runtime State Inventory

> Phase 1 is greenfield C++/TS feature work (no rename/migration). The only "runtime state" concerns are about NOT mutating reference installs.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Real `.tre` archives in `D:\SWG Infinity\…` and `D:\SWGEmu Client\SWGEmu\…` are READ-ONLY reference truth | Tests must operate on **gitignored copies** (D-10), never the originals — enforce via a copy-to-scratch step |
| Live service config | None — Phase 1 touches no running service | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | Existing `packages/native-core/prebuilds/` + `build/` from Phase 0; adding the core lib changes the addon ABI surface | Rebuild the prebuild after adding tre/iff bindings; harness consumes the same prebuild (bare Node) |

**Nothing found in the live-config/OS-state/secrets categories** — verified: this phase adds a static lib + bindings + UI, with no service or OS registration.

## Common Pitfalls

### Pitfall 1: Trusting the docs' TRE/IFF layouts
**What goes wrong:** The docs say IFF is little-endian, TRE magic is forward "TREE0005", TOC entry is 20 bytes with `nameOffset` first. All three are wrong.
**Why it happens:** AI-distilled docs (source-provenance constraint).
**How to avoid:** Use only the real source `file:line` cited here; round-trip on a real asset.
**Warning signs:** A parser that "works" on a hand-crafted fixture but fails on a retail archive.

### Pitfall 2: Adding EA-IFF-85 pad bytes on serialize
**What goes wrong:** Odd-length chunk gets a `0x00` pad; byte-exact round-trip fails on real SWG datatables.
**Why it happens:** Following the IFF standard instead of the SWG dialect.
**How to avoid:** Detect-don't-assume on read (`IffReader.cs:307-327`); emit no pad on write; prefer verbatim-slice re-emit for unedited nodes.
**Warning signs:** Round-trip diff shows a 1-byte insertion after odd chunks.

### Pitfall 3: Recompressing untouched TRE entries
**What goes wrong:** Repacked archive's untouched payloads differ byte-for-byte from the source because deflate output isn't bit-stable.
**How to avoid:** Copy untouched entries' raw compressed slices verbatim (`TreWriter.cs:166-174`); recompress only edited entries.
**Warning signs:** Per-record raw-slice diff fails on entries you didn't touch.

### Pitfall 4: Wrong record field order across versions
**What goes wrong:** Reading a v0005 archive with the crc-first layout (or vice-versa) yields garbage offsets/CRCs.
**How to avoid:** Dispatch field order on version per Utinni's table; **validate against a REAL v0005 archive** to settle the oracle discrepancy (OPEN-1).
**Warning signs:** `crc != Crc::calculate(name)`, or `offset` points outside the file / at non-IFF bytes.

### Pitfall 5: The MD5 block / payload-order gap in full-archive repack
**What goes wrong:** A "byte-identical" repack isn't, because the builder writes an MD5 block the reader ignores and orders payloads by response-file order, not TOC order.
**How to avoid:** For D-04 byte-identical builder output, reproduce the MD5 block + response-file ordering + builder zlib level (OPEN-2). For a *functionally* identical repack, Utinni's per-record-slice-identity contract is sufficient and simpler.
**Warning signs:** Full-file SHA differs even though every record reads back identical.

### Pitfall 6: SAB lifetime across the async boundary
**What goes wrong:** C++ holds a pointer into a JS `ArrayBuffer` that gets GC'd mid-worker.
**How to avoid:** Hold a `Napi::Reference` to the buffer for the worker's lifetime, or copy into a C++-owned buffer before going off-thread.

## Code Examples

### TRE header read (port target)
```cpp
// Source: TreeFile_SearchNode.cpp:267-275 (+ struct Header at TreeFile_SearchNode.h:174-185)
struct TreHeader {            // 36 bytes, all uint32 little-endian
    uint32_t token;           // 'EERT' on disk
    uint32_t version;         // '0005'/'0006'/'5000'/'6000' as 4 ASCII bytes
    uint32_t numberOfFiles;
    uint32_t tocOffset, tocCompressor, sizeOfTOC;
    uint32_t blockCompressor, sizeOfNameBlock, uncompSizeOfNameBlock;
};
// read(0, &h, 36); assert(memcmp(&h.token,"EERT",4)==0);
```

### TRE entry resolution (binary search over crc-sorted TOC)
```cpp
// Source: TreeFile_SearchNode.cpp:360-408
// binary search on entry.crc == Crc::calculate(fixedName); tie-break _stricmp(name);
// entry.length==0 => deleted tombstone (shadows lower archives) => return not-found
```

### IFF big-endian read primitive
```cpp
// Source: Iff.cpp:539 (ntohl) + Utinni IffReader.cs:343-354
int32_t readBe32(const uint8_t* p){ return (p[0]<<24)|(p[1]<<16)|(p[2]<<8)|p[3]; }
// FORM innerLen INCLUDES the 4-byte sub-type tag (Iff.cpp:1143-1144)
```

### IFF byte-exact serialize (verbatim re-emit)
```csharp
// Source: Utinni IffWriter.cs:98-142 — port control flow to C++
if (!node.IsDirty && node.capturedSlice != null){ out.Write(node.capturedSlice); return; }
WriteFourCc(out, node.TypeId); WriteBe32(out, payloadLen); out.Write(payload); // NO pad
```

## State of the Art

| Old Approach (docs) | Current Approach (real source) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| IFF little-endian | IFF **big-endian** (`ntohl`/`htonl`) | always — docs were wrong | All length/tag reads must byte-swap |
| TRE magic "TREE0005" forward | magic on disk is **`EERT`**; version reads **forward** as `"0005"` etc. | always | Magic check is `EERT`; version is a forward 4-char ASCII string |
| TOC entry 20 bytes, nameOffset-first | **24-byte size-first OR 32-byte crc-first** per version | always | Two layouts; version dispatch required |
| One TRE flavor | 0004/0005/0006/5000 readable, **6000 enumerate-only (encrypted)** | Utinni discovery | D-05 satisfiable with documented degradation for 6000 |
| Repack = re-pack everything | Copy untouched raw slices; recompress only edits | Utinni `TreWriter` | Byte/slice fidelity + speed |

**Deprecated/outdated:**
- The entire `docs/01-core-engine/iff-and-tre.md` binary-layout sections (§2, §5, §7, §8, §12) — superseded by this research. See Docs Corrections below.

## Docs Corrections (per AGENTS.md "update docs when you verify/correct a layout")

The planner should schedule a docs-update task (or flag for the maintainer) for `docs/01-core-engine/iff-and-tre.md`:
1. **§2 IFF endianness** — "SWG's modified variant uses little-endian" is **FALSE**. SWG IFF is **big-endian** (EA-IFF-85 standard; `Iff.cpp:522,539`). The `ReadUint32`/`WriteUint32` `memcpy` helpers (§3, §5) are wrong for tags/lengths.
2. **§2 FORM size semantics** — the doc's "-4: sub-type tag is included in formSize" (§4 line 173) is actually CORRECT and matches `Iff.cpp:1144`. Keep.
3. **§7 TRE magic** — "TREE"(4) forward is **FALSE on disk**; the magic bytes are **`EERT`** (LE dump of the Tag). The version digits, by contrast, ARE stored forward and read as a plain ASCII string `"0005"`/`"0006"`/`"5000"`/`"6000"` (Utinni `TreFile.cs:155-169`).
4. **§7 TreIndexEntry** — the 20-byte struct with `nameOffset, compressedSize, uncompressedSize, dataOffset, compressionType` is **WRONG**: real entries are **24 or 32 bytes** with a 6-field layout (two variants) and the header is **36 bytes** (not 12). MD5 block and name/TOC compression flags are omitted entirely.
5. **§8/§12 packer** — header is 36 bytes not 12; entry serialization is wrong size/order; missing MD5 block, missing TOC/name-block compression, missing response-file payload ordering. The packer as written produces a non-loadable archive.
6. **Compression** — doc implies only zlib(2)/none(0); add raw-deflate(1) and the zlib RFC1950 framing detail.

(The `.cfg` loader section §11 and the override-priority description §7 intro are broadly correct and can stay, with the duplicate-key insight retained.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | zlib (not miniz) reproduces bit-identical deflate streams for the edited-entry repack path | Stack / Pitfall 3 | If deflate isn't bit-stable, only the verbatim-slice (untouched) path is byte-exact; edited entries can't claim full-file identity. Mitigated by copying untouched slices verbatim. |
| A2 | `Napi::AsyncWorker` is the right async primitive under Path B | Async Worker Model | If a future phase moves the addon out of the renderer, revisit; for Phase 1 (in-renderer) this is correct. |
| A3 | Substring is the right default search semantics for CORE-02 | TRE Search | Low risk — it's our UX choice, not a format constraint; easily changed. |
| A4 | The committed fixtures can be regenerated from Utinni's synth bytes without copyright issue (public-domain synthetic test data) | Harness | Mitigated by regenerating our own + citing provenance per D-03. |

**These assumptions need user/planner confirmation before becoming locked decisions** — especially A1 (affects what "byte-identical repack" can promise) and A2.

## Open Questions (RESOLVED)

> **All four resolved** — the authoritative answers live in the `Ground-Truth Reconciliation` section below (post-consult correction); the plans inherited the reconciled values. Summary:
> - **OPEN-1 — RESOLVED:** TRE record layout is **CRC-first for ALL versions** (stride 24 for 0004/0005/5000, 32 for 0006/6000). The Wave-0 real-Infinity/SWGEmu byte check below is retained as the *confirming gate*, not an open decision.
> - **OPEN-2 — RESOLVED:** self-built `.tre` is byte-identical; retail repack preserves untouched entries' raw compressed slices verbatim and recompresses only edits (see Reconciliation + Plan 01-04).
> - **OPEN-3 — RESOLVED:** treat `{FORM, LIST, CAT }` as containers, PROP as leaf (Plan 01-03).
> - **OPEN-4 — RESOLVED:** subsumed by CRC-first-for-all — v5000 is crc-first, stride 24.

1. **(OPEN-1) TRE record field order for v0004/0005/0006.** The two oracles disagree: swg-client-v2's struct is crc-first for all versions (`TreeFile_SearchNode.h:189-197`); Utinni reads size-first for 0004/0005/0006 (`TreFile.cs:302-310`) and that's what its v0005 fixture validates.
   - What we know: Utinni's size-first reading passes its synthesized v0005 fixture AND it claims real-client validation.
   - What's unclear: whether real **Infinity/SWGEmu** v0005 archives are size-first or crc-first (the SOE header struct suggests crc-first; SWGEmu may have diverged).
   - Recommendation: **Wave 0 of Phase 1 mounts a real Infinity AND a real SWGEmu v0005 archive and checks `crc == Crc::calculate(name)` + valid offsets under each field order; lock the answer from the bytes, not from either source.** This is the single highest-value early experiment.

2. **(OPEN-2) Scope of "byte-identical `.tre`" for D-04.** True full-file identity to a builder-produced archive requires reproducing the MD5 block, response-file payload ordering, and the exact zlib level — none of which Utinni's repacker does.
   - Recommendation: split D-04 into (a) **full read+write that round-trips a *self-built* archive byte-identically** (we control the writer, so trivially exact) and (b) **functional repack of a *retail* archive** with per-record raw-slice identity (Utinni's contract). Confirm with the maintainer whether "byte-identical `.tre`" means re-emitting OUR archive identically (achievable now) or reproducing SOE's builder bytes exactly (requires OPEN-2 work). Likely the former suffices for the CORE round-trip proof; the latter belongs to Phase-4 deploy.

3. **(OPEN-3) IFF container set for the generic viewer.** Real SWG only emits FORM; Utinni's generic reader also handles LIST/CAT.
   - Recommendation: recognize `{FORM, LIST, CAT }` as containers for the SIE-successor viewer (cheap, future-proof), PROP as leaf. Document that SWG assets in practice only use FORM.

4. **(OPEN-4) v5000 record field order.** Utinni marks 5000 as crc-first 24-byte (`TreVersions.IsCrcFirst` true for 5000) but a comment elsewhere says it flows through the size-first path. The two code paths in `TreFile.cs` are gated by `IsCrcFirst(version)` which returns true for 5000 → crc-first. Verify against a real `EERT5000` archive if one is present in the SWGEmu install.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| swg-client-v2 source (TreeFile/Iff) | Port spec (D-01) | ✓ | local sibling | — (hard requirement; present) |
| Utinni C# Formats + fixtures | Cross-check + seeds (D-03/D-09) | ✓ | local sibling | — (present) |
| `tre-compare` verify-*.cfg | Override matrix seed (D-11) | ✓ | local | — (present) |
| SWG Infinity install (`D:\SWG Infinity`) | Real-asset gate (D-12) | ✓ (per cfg paths) | — | SWGEmu only if absent |
| SWGEmu install (`D:\SWGEmu Client\SWGEmu`) | Real-asset gate (D-12) | ✓ (per CONTEXT) | — | Infinity only if absent |
| zlib | TRE (de)compression | needs CMake wiring | system or vendor | miniz for inflate side |
| Phase-0 prebuild (node-addon-api 8) | Harness + addon | ✓ | ^8.8.0 | — (present) |

**Missing dependencies with no fallback:** none identified.
**Missing dependencies with fallback:** zlib (vendor or `find_package`; miniz acceptable for inflate-only). The planner should add a CMake zlib-wiring task in Wave 0.

> **Verify in Wave 0:** confirm at least one real v0005 archive exists in BOTH installs (drives OPEN-1) and copy a curated set to the gitignored scratch dir.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (Phase-0 pinned) + native unit tests via the harness linking the C++ lib headless |
| Config file | inherited from Phase 0 (vitest); add a harness project/config |
| Quick run command | `pnpm vitest run --project native-core` (or harness project) |
| Full suite command | `pnpm vitest run` + the opt-in `real-asset` lane when `fixtures-real/` is populated |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-01 | Mount N archives; override/shadow resolution picks highest-priority non-tombstone | unit + integration | `pnpm vitest run -t "tre mount override"` | ❌ Wave 0 |
| CORE-01 | Override matrix across Infinity + SWGEmu (D-12) from tre-compare cfgs | integration (real-asset lane) | `pnpm vitest run -t "override matrix"` | ❌ Wave 0 |
| CORE-02 | Browse + substring/glob search returns expected entries | unit | `pnpm vitest run -t "tre search"` | ❌ Wave 0 |
| CORE-03 | Parse synth + real IFF into a tree with correct tag/length/offset/kind | unit | `pnpm vitest run -t "iff parse"` | ❌ Wave 0 |
| CORE-04 | `assertRoundTrip` byte-exact on every committed IFF fixture (incl odd-chunk-no-pad) | unit | `pnpm vitest run -t "iff roundtrip"` | ❌ Wave 0 |
| CORE-04 | TRE self-built archive round-trips byte-identical; retail repack = per-record slice identity | unit + real-asset | `pnpm vitest run -t "tre roundtrip"` | ❌ Wave 0 |
| CORE-05 | Fixture-registry sweep FAILS if a registered format lacks a round-trip case or loader-source citation | meta-test | `pnpm vitest run -t "registry coverage"` | ❌ Wave 0 |
| CORE-06 | Heavy mount/parse runs off-main-thread; UI thread stays responsive; payload is zero-copy | integration | `pnpm vitest run -t "async worker zero-copy"` | ❌ Wave 0 |

### Byte-exact + override coverage this phase must prove (Dimension 8)
- **Byte-exact round-trip** on: every committed IFF fixture (synth nested, odd-chunk-no-pad, malformed-rejected-cleanly), every committed TRE fixture (v0005/v0006/v5000 read; v6000 enumerate-only; malformed rejected), AND at least one **real** Infinity + one **real** SWGEmu archive (opt-in lane).
- **Override matrix:** a path present in ≥2 mounted archives resolves to the highest-priority one; a `length==0` tombstone shadows lower archives; the resolved chain is reported to the UI. Driven by the tre-compare `verify-*.cfg` order.
- **Standing-gate self-test:** the registry sweep proves the gate itself is enforced (a format added without a fixture fails CI).

### Sampling Rate
- **Per task commit:** quick vitest run on the touched project.
- **Per wave merge:** full committed-fixture suite green.
- **Phase gate:** full suite + (locally) the real-asset lane green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/harness/assertRoundTrip.ts` + `fixtureRegistry.ts` — CORE-05 mechanism
- [ ] `packages/harness/fixtures/` — regenerated committed synth fixtures (TRE v0005/0006/v6000 + IFF nested/odd-no-pad/malformed) with provenance notes
- [ ] `scripts/copy-real-fixtures` — gitignored copy of Infinity + SWGEmu archives to scratch (D-10)
- [ ] CMake zlib wiring in `modules/core/CMakeLists.txt`
- [ ] **OPEN-1 experiment:** real-asset field-order arbiter test (highest priority)
- [ ] contracts types: `tre.ts` (mount/entry/search), `iff.ts` (node tag/length/offset/kind)

## Security Domain

> `security_enforcement` config not located in this repo's `.planning/config.json` scope during research; defaulting to enabled. The threat surface here is **untrusted binary input parsing** (the dominant risk for a format toolkit).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | **yes** | Bounds-check every count/offset/length BEFORE allocation, in subtraction/division form (never `offset+len` which can overflow). Mirror Utinni's caps: per-record/block ≤ 256 MB (TRE), per-chunk ≤ 64 MB (IFF). [VERIFIED: TreFile.cs:223-265, IffReader.cs:174-195] |
| V6 Cryptography | partial | Do NOT attempt to decrypt v6000 payloads (encrypted/obfuscated; out of scope — enumerate-only). zlib only. |
| V2/V3/V4 Auth/Session/Access | no | Local desktop tool, no auth surface this phase |

### Known Threat Patterns for binary-format parsing
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious `recordCount`/`length` → huge alloc (DoS) | DoS | Division-form cap check before alloc (`recordCount > MaxBlockSize/stride`) [VERIFIED: TreFile.cs:223] |
| Offset+length integer overflow → OOB read | Tampering/Info-disclosure | Subtraction-form bound (`offset > streamLength - len`) [VERIFIED: TreFile.cs:328] |
| zlib decompression bomb | DoS | Cap inflate output at `min(declaredUncompressed, MaxBlockSize)`; reject over-expansion [VERIFIED: TreFile.cs:438] |
| Malformed zlib frame / bad Adler | Tampering | Validate RFC1950 header `%31==0`, detect inflate failure [VERIFIED: TreFile.cs:660-679] |
| IFF nested-chunk overflow (child end > parent end) | Tampering | Reject `declaredEnd > parentEnd` for nested chunks [VERIFIED: IffReader.cs:185-195] |
| Non-printable FourCC (corrupt/garbage) | Tampering | Reject non-`0x20–0x7E` tag bytes [VERIFIED: IffReader.cs:150-158] |

> The malformed fixtures already in Utinni (`malformed-*.tre`, `malformed-*.iff`) directly exercise these — reuse them to prove the parser rejects hostile input cleanly rather than crashing the renderer (which under Path B would take down the UI — FND-01 residual risk).

## Sources

### Primary (HIGH confidence — real loader source, read this session)
- `swg-client-v2/.../sharedFile/src/shared/TreeFile.cpp` (971 ln) — search-node priority list, find/open, fixUpFileName, override resolution
- `swg-client-v2/.../sharedFile/src/shared/TreeFile_SearchNode.cpp` (1185 ln) + `.h` — TRE Header & TableOfContentsEntry structs, parse, binary-search resolve, zlib, tombstones
- `swg-client-v2/.../sharedFile/application/TreeFileBuilder/.../TreeFileBuilder.cpp` (836 ln) — writer block order, MD5 block, double header write, compressor selection
- `swg-client-v2/.../sharedFile/src/shared/Iff.cpp` + `Iff.h` — FORM/chunk big-endian framing, stack walk, validate, write, adjustDataAsNeeded
- `swg-client-v2/.../sharedFoundation/src/shared/Tag.h` — Tag macro (proves LE-on-disk byte order for TRE, BE for IFF via ntohl)
- `tools/tre-compare/verify-swginfinity.cfg` (+ verify-swgemu/stardust/legends/swgsource) — real override search-order

### Secondary (HIGH — independent cross-validated impl)
- `Utinni/UtinniCoreDotNet/Formats/Tre/{TreFile,TreHeader,TreVersion,TreWriter}.cs` — fixture-validated v0006/v5000/v6000 dispatch, compressor framing, repack contract, patch-archive quirk
- `Utinni/UtinniCoreDotNet/Formats/Iff/{IffReader,IffWriter}.cs` — no-pad quirk, container set, hybrid-DOM verbatim re-emit, BE primitives, security caps
- `Utinni/Utinni.Cli.Tests/Fixtures/{iff,tre}` — committed-fixture seeds

### Tertiary (LOW — flagged WRONG, for correction only)
- `docs/01-core-engine/iff-and-tre.md` — AI-distilled; binary layouts fabricated (see Docs Corrections)

## Metadata

**Confidence breakdown:**
- TRE on-disk layout (header, TOC, name block, compressors, override): **HIGH** — read from real source AND cross-validated against Utinni's fixture-passing impl.
- IFF on-disk layout (BE framing, FORM rule, no-pad quirk): **HIGH** — same dual confirmation.
- Record field-order per version: **MEDIUM** — two oracles disagree for 0004/0005/0006 (OPEN-1); resolve from a real asset in Wave 0.
- Byte-identical *retail* repack: **MEDIUM** — reconstructable from the builder source but not yet validated against retail bytes (OPEN-2).
- Async/zero-copy approach: **HIGH** — direct continuation of the proven Phase-0 Path-B SAB pipeline.

**Research date:** 2026-06-22
**Valid until:** ~30 days for the format facts (the sibling source repos are stable, local, and authoritative — these layouts will not drift). Re-confirm OPEN-1/OPEN-2 by running the Wave-0 real-asset experiments, which supersede any remaining uncertainty.

---

## ⚠ GROUND-TRUTH RECONCILIATION — 2026-06-22 (supersedes OPEN-1 & OPEN-2 above)

Added after a 4-AI consult crew (Codex/Cursor/fresh-Opus/fresh-Sonnet) + a direct read of
`swg-client-v2/tools/tre-compare/src/tre_compare/parser/{tre_reader,tre_decrypt}.py`
(itself **vendored from the maintainer's `swg-blender-plugin`** — a THIRD, pragmatic oracle that
handles every TRE version *and* the master-index formats the C++ loader lacks). Real header bytes
were measured from installed clients (see `.planning/research/CONSULT-00-ground-truth-bytes.md`).

### OPEN-1 — RESOLVED: TOC records are **CRC-first**, stride is version-dependent
`tre_reader.py:36` `TOC_ENTRY_FMT = "<Iiiiii"` = `crc(u32) · length · offset · compressor ·
compressedLength · fileNameOffset`. This matches the C++ struct (`TreeFile_SearchNode.h:189-197`,
read by Codex) **and** Utinni's C# reader (`TreFile.cs:289-296`, read by fresh-Sonnet). The
"Utinni reads size-first" claim in OPEN-1 was an error — **all three oracles agree: CRC-first.**
- Stride (`tre_reader.py:143-150`): **24 bytes** for `0004 / 0005 / 5000` (retail); **32 bytes**
  for `0006 / 6000` (extended) — same 6 fields, +8 trailing bytes per record on the extended layout.
- Header is **36 bytes**, `"<4s4s7I"` (`tre_reader.py:33-34`) — confirmed by all oracles.

### OPEN-2 / v6000 — RESOLVED scope: Restoration payloads are **enumerate-only (encrypted)**
`tre_decrypt.py:5-11,27-43`: extended tags (`6000/0006`) carry **proprietary-encrypted payloads**;
tre-compare and the blender plugin **detect-and-flag, never decrypt** (decryption intentionally not
implemented). Header/TOC/name block are plaintext, so **listing works but payload
extraction/round-trip does not.**
- **Consequence for D-04/D-05/D-12:** the byte-exact *real-asset payload* round-trip gate (CORE-04/05)
  must run on **v0005** (Infinity / SWGEmu / Stardust). For **v0006 (Restoration)** the harness can
  only assert **structural/enumeration** round-trip (header+TOC+names), NOT payload bytes. "Support
  all variants" = parse+enumerate all; byte-exact-payload only where payloads are not encrypted.

### Measured client → version map (corrects CONTEXT canonical_refs)
| Client | Path (verified) | Version |
|---|---|---|
| SWG Infinity | `D:\SWG Infinity\SWG Infinity\Live\` | v0005 (`EERT5000`) |
| SWGEmu | `D:\SWGEmu-Client\` (and `\SWGEmu\`) — CONTEXT's `D:\SWGEmu Client\SWGEmu` path is WRONG | v0005 |
| Stardust | `D:\Stardust TREs\` (×23) | v0005 |
| SWG Restoration | `D:\SWG Restoration\` | **v0006** (`EERT6000`, encrypted payloads) |

### Master-index formats (relevant to CORE-01 mount/override) — new, from tre_reader.py
- **SearchTOC** — retail global index, magic `TAG_TOC`/`0001`, 24-byte entries `"<BBHIIIII>"`
  (`tre_reader.py:40-43, 340-418`).
- **COT2000** — Restoration global index, magic `" COT2000"`, 32-byte entries
  (`tre_reader.py:28-31, 269-337`).

### Cross-cutting byte-exact facts confirmed by the crew (lock these)
- **TRE writer emits an MD5 trailer block** the reader ignores (`TreeFileBuilder.cpp:773-813`,
  Cursor) — a byte-identical repack must reproduce it. Body bytes are in response-file/offset order;
  TOC+names+MD5 are **CRC-primary sorted**. zlib = level 6 (`78 9C`), only when it is *strictly*
  smaller and input > 1024 B.
- **Override resolution** = explicit integer priority (higher wins; ties by config index), with
  `length==0` **deletion tombstones** that shadow lower archives (`TreeFile.cpp:285-461`, Sonnet).
- **Compressor `1` divergence** — C++ `DEBUG_FATAL`s (`CT_deprecated`); Utinni inflates as raw
  deflate. The port should *handle* compressor 1, not crash.
- **IFF** = big-endian framing (tags + lengths via `ntohl`/`htonl`), payload scalars native LE,
  **no padding ever**, `FORM`-only container, FORM length **includes** the 4-byte groupType, tags
  stored **natural order** (opposite of the TRE `EERT` magic). Verified against real fixture bytes
  (`Iff.cpp`; fresh-Opus). Use Utinni's hybrid-DOM verbatim-slice re-emit for byte-exact writes.

### Net confidence change
OPEN-1 → **CLOSED (HIGH)**. v6000 payload round-trip → **CLOSED as out-of-scope (encrypted)**.
Remaining Wave-0 experiment: confirm v0005 byte-identical *retail repack* (MD5 + ordering + zlib
level) against a real archive — this is a build-verification task, not a layout unknown.
