/**
 * addon.cpp — NODE_API_MODULE registration for swg_native_core.
 *
 * Wires hello(), allocateSab(), writeSab(), and readSab() into the addon's export object.
 * Exports exactly match the TypeScript surface in index.d.ts.
 *
 * Path B (native-in-renderer) additions (00-03):
 *   writeSab(sab, int32Index, value) — C++ writes an Int32 into the SAB (C++ → JS proof)
 *   readSab(sab, int32Index)         — C++ reads an Int32 from the SAB  (JS → C++ proof)
 *
 * Phase 1 Plan 01-01 TRE exports:
 *   mountArchive(paths)             — synchronous mount (Plan 01-01)
 *   listEntries(archiveIdx)         — list TOC entries
 *   readEntry(archiveIdx, entryIdx) — extract payload as ArrayBuffer
 *
 * Phase 1 Plan 01-02 TreMount exports (CORE-01, CORE-02, CORE-06):
 *   mountTreMount(paths, priorities)    — priority-based virtual filesystem mount
 *   resolveEntry(handle, name)          — first-match-wins override resolution
 *   resolveChain(handle, name)          — full shadow chain (OUR algorithm)
 *   searchMount(handle, query)          — case-insensitive substring/glob search (CORE-02)
 *   readMountEntry(handle, ai, ei)      — extract entry payload as ArrayBuffer
 *   disposeTreMount(handle)             — release mount resources
 *   mountArchiveAsync(path, priority)      — off-thread Napi::AsyncWorker mount (CORE-06)
 *   mountSearchableAsync(paths, prios)     — off-thread multi-archive mount (CORE-06)
 *   getMountEntriesColumnar(handle)        — zero-copy columnar VFS blob (perf fix, 2026-06-24)
 *
 * Phase 1 Plan 01-03 IFF exports (CORE-03, CORE-04):
 *   parseIff(bytes)                     — parse IFF buffer -> { roots, trailingBytes, roundTrip }
 *   serializeIff(parseResult, srcBytes) — byte-exact serialize back to ArrayBuffer
 *   getChunkBytes(parseResult, srcBytes, nodeIndex) — zero-copy chunk bytes
 *
 * Phase 1 Plan 01-04 TRE builder exports (D-04, CORE-04 write side):
 *   buildTre(entries, version?)         — build a fresh .tre archive (ArrayBuffer)
 *   repackTre(sourcePath, edits?, v?)   — repack an archive, untouched entries verbatim
 *
 * Source: RESEARCH.md Pattern 3 (corrected); node-addon-api ^8.8.0.
 */

#include <napi.h>

// Forward declarations (implemented in hello.cpp, sab.cpp, and sab-rw.cpp)
Napi::Value Hello(const Napi::CallbackInfo& info);
Napi::Value AllocateSab(const Napi::CallbackInfo& info);
Napi::Value WriteSab(const Napi::CallbackInfo& info);
Napi::Value ReadSab(const Napi::CallbackInfo& info);

// Forward declarations for Phase 1 TRE binding (implemented in tre_binding.cpp)
// Plan 01-01 (synchronous):
// Source: swg-client-v2 TreeFile_SearchNode.cpp:226-408 (logic in modules/core/tre/);
//         PATTERNS.md § "src/addon.cpp (MODIFY — binding registry)"
Napi::Value MountArchive(const Napi::CallbackInfo& info);
Napi::Value ListEntries(const Napi::CallbackInfo& info);
Napi::Value ReadEntry(const Napi::CallbackInfo& info);

// Plan 01-02 (TreMount priority resolver + AsyncWorker):
// Source: swg-client-v2 TreeFile.cpp:285-461 (priority list + first-match-wins);
//         RESEARCH.md § "Async Worker Model" (Napi::AsyncWorker, CORE-06).
Napi::Value MountTreMount(const Napi::CallbackInfo& info);
Napi::Value ResolveEntry(const Napi::CallbackInfo& info);
Napi::Value ResolveChain(const Napi::CallbackInfo& info);
Napi::Value SearchMount(const Napi::CallbackInfo& info);
Napi::Value GetMountArchives(const Napi::CallbackInfo& info);
Napi::Value ListMountEntries(const Napi::CallbackInfo& info);
Napi::Value GetMountEntriesColumnar(const Napi::CallbackInfo& info);
Napi::Value ReadMountEntry(const Napi::CallbackInfo& info);
Napi::Value DisposeTreMount(const Napi::CallbackInfo& info);
Napi::Value MountArchiveAsyncFixed(const Napi::CallbackInfo& info);
Napi::Value MountSearchableAsync(const Napi::CallbackInfo& info);

// Phase 1 Plan 01-03 IFF binding (implemented in iff_binding.cpp):
// Source: modules/core/iff/Iff.h parseIff/serializeIff/getNodeBytes
//         swg-client-v2 Iff.cpp:508-555 (parse), :419-429 (verbatim write)
//         Utinni IffReader.cs, IffWriter.cs (hybrid-DOM + pad handling)
Napi::Value ParseIff(const Napi::CallbackInfo& info);
Napi::Value SerializeIff(const Napi::CallbackInfo& info);
Napi::Value GetChunkBytes(const Napi::CallbackInfo& info);

// Phase 1 Plan 01-04 TRE builder exports (implemented in tre_binding.cpp):
// Source: modules/core/tre/TreBuilder.h TreBuilder::build() / ::repack()
//         swg-client-v2 TreeFileBuilder.cpp:773-833 (block order + double header write)
//         Utinni TreWriter.cs:166-174 (repack raw-slice identity)
//         ZlibCompressor.cpp:169 (zlib level 6, no miniz on write path)
Napi::Value BuildTre(const Napi::CallbackInfo& info);
Napi::Value RepackTre(const Napi::CallbackInfo& info);

// Phase 2 Plan 02-01 mesh + format parsers (implemented in mesh_binding.cpp):
// Source: modules/core/formats/Mesh.h, MeshLod.h, LodDistanceTable.h, Shader.h, Palette.h, Dds.h
//   Mesh:     swg-client-v2 MeshAppearanceTemplate.cpp + ShaderPrimitiveSetTemplate.cpp + VertexBuffer.cpp
//   MeshLod:  swg-client-v2 LodMeshGeneratorTemplate.cpp:210-254
//   LodDT:    swg-client-v2 LodDistanceTable.cpp:140-175
//   Shader:   swg-client-v2 StaticShaderTemplate.cpp:671-810
//   Palette:  swg-client-v2 PaletteArgb.cpp:450-607
//   Dds:      swg-client-v2 Dds.h + Texture.cpp:487-654
Napi::Value ParseMesh(const Napi::CallbackInfo& info);
Napi::Value ParseMeshLod(const Napi::CallbackInfo& info);
Napi::Value ParseLodDistanceTable(const Napi::CallbackInfo& info);
Napi::Value ParseShader(const Napi::CallbackInfo& info);
Napi::Value ParsePalette(const Napi::CallbackInfo& info);
Napi::Value ParseDds(const Napi::CallbackInfo& info);

// Phase 2 Plan 02-02 skeletal mesh + appearance parsers (implemented in mesh_binding.cpp):
// Source: modules/core/formats/SkeletalMeshGen.h, Skeleton.h, SkeletalAppearance.h, StaticAppearance.h
//   SkeletalMesh:      swg-client-v2 SkeletalMeshGeneratorTemplate.cpp:2247-2360 (INFO 9x int32+4xint16)
//   Skeleton:          swg-client-v2 BasicSkeletonTemplate.cpp:151-390 (v0001/v0002)
//   SkeletalAppearance:swg-client-v2 SkeletalAppearanceTemplate.cpp:786-1136 (SMAT v0001/v0002/v0003)
//   StaticAppearance:  swg-client-v2 AppearanceTemplateList.cpp:513-540 (APT redirect)
Napi::Value ParseSkeletalMesh(const Napi::CallbackInfo& info);
Napi::Value ParseSkeleton(const Napi::CallbackInfo& info);
Napi::Value ParseSkeletalAppearance(const Napi::CallbackInfo& info);
Napi::Value ParseStaticAppearance(const Napi::CallbackInfo& info);

// Phase 2 Plan 02-02 gap-closure: DetailAppearance parser (implemented in mesh_binding.cpp):
// Source: modules/core/formats/DetailAppearance.h
//   DetailAppearance: swg-client-v2 DetailAppearanceTemplate.cpp:556-658 (DTLA LOD appearance)
//   Verified 2026-06-24 against wb_02_09e_00000000000000000000.lod (362 bytes, version 0007)
Napi::Value ParseDetailAppearance(const Napi::CallbackInfo& info);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Phase 0 exports
    exports.Set("hello",       Napi::Function::New(env, Hello));
    exports.Set("allocateSab", Napi::Function::New(env, AllocateSab));
    // Path B bidirectional proof exports (00-03):
    exports.Set("writeSab",    Napi::Function::New(env, WriteSab));
    exports.Set("readSab",     Napi::Function::New(env, ReadSab));

    // Phase 1 Plan 01-01 TRE exports (synchronous):
    exports.Set("mountArchive", Napi::Function::New(env, MountArchive));
    exports.Set("listEntries",  Napi::Function::New(env, ListEntries));
    exports.Set("readEntry",    Napi::Function::New(env, ReadEntry));

    // Phase 1 Plan 01-02 TreMount exports (priority resolver + AsyncWorker):
    exports.Set("mountTreMount",       Napi::Function::New(env, MountTreMount));
    exports.Set("resolveEntry",        Napi::Function::New(env, ResolveEntry));
    exports.Set("resolveChain",        Napi::Function::New(env, ResolveChain));
    exports.Set("searchMount",         Napi::Function::New(env, SearchMount));
    exports.Set("getMountArchives",          Napi::Function::New(env, GetMountArchives));
    exports.Set("listMountEntries",          Napi::Function::New(env, ListMountEntries));
    exports.Set("getMountEntriesColumnar",   Napi::Function::New(env, GetMountEntriesColumnar));
    exports.Set("readMountEntry",            Napi::Function::New(env, ReadMountEntry));
    exports.Set("disposeTreMount",     Napi::Function::New(env, DisposeTreMount));
    exports.Set("mountArchiveAsync",   Napi::Function::New(env, MountArchiveAsyncFixed));
    exports.Set("mountSearchableAsync",Napi::Function::New(env, MountSearchableAsync));

    // Phase 1 Plan 01-03 IFF exports (CORE-03, CORE-04):
    exports.Set("parseIff",       Napi::Function::New(env, ParseIff));
    exports.Set("serializeIff",   Napi::Function::New(env, SerializeIff));
    exports.Set("getChunkBytes",  Napi::Function::New(env, GetChunkBytes));

    // Phase 1 Plan 01-04 TRE builder exports (D-04, CORE-04 write side):
    exports.Set("buildTre",   Napi::Function::New(env, BuildTre));
    exports.Set("repackTre",  Napi::Function::New(env, RepackTre));

    // Phase 2 Plan 02-01 mesh + format parsers:
    exports.Set("parseMesh",            Napi::Function::New(env, ParseMesh));
    exports.Set("parseMeshLod",         Napi::Function::New(env, ParseMeshLod));
    exports.Set("parseLodDistanceTable",Napi::Function::New(env, ParseLodDistanceTable));
    exports.Set("parseShader",          Napi::Function::New(env, ParseShader));
    exports.Set("parsePalette",         Napi::Function::New(env, ParsePalette));
    exports.Set("parseDds",             Napi::Function::New(env, ParseDds));

    // Phase 2 Plan 02-02 skeletal mesh + appearance parsers:
    exports.Set("parseSkeletalMesh",        Napi::Function::New(env, ParseSkeletalMesh));
    exports.Set("parseSkeleton",            Napi::Function::New(env, ParseSkeleton));
    exports.Set("parseSkeletalAppearance",  Napi::Function::New(env, ParseSkeletalAppearance));
    exports.Set("parseStaticAppearance",    Napi::Function::New(env, ParseStaticAppearance));

    // Phase 2 Plan 02-02 gap-closure: DetailAppearance (.lod / FORM DTLA):
    exports.Set("parseDetailAppearance",    Napi::Function::New(env, ParseDetailAppearance));

    return exports;
}

NODE_API_MODULE(swg_native_core, Init)
