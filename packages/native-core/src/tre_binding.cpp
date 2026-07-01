/**
 * tre_binding.cpp — Thin N-API binding over the engine-free modules/core TRE lib.
 *
 * Exports (Plan 01-01, synchronous):
 *   mountArchive(paths: string[])  -> MountResult[]
 *   listEntries(archiveIdx: number) -> NativeTreEntry[]
 *   readEntry(archiveIdx: number, entryIdx: number) -> ArrayBuffer
 *
 * Exports (Plan 01-02, new):
 *   mountTreMount(paths: string[], priorities: number[]) -> string (opaque handle)
 *   resolveEntry(handle: string, name: string) -> TreMountResolveResult
 *   resolveChain(handle: string, name: string) -> TreShadowChain
 *   searchMount(handle: string, query: {text, mode}) -> TreSearchHit[]
 *   readMountEntry(handle: string, archiveIdx: number, entryIdx: number) -> ArrayBuffer
 *   disposeTreMount(handle: string) -> void
 *   mountArchiveAsync(path: string, priority: number) -> Promise<MountResult>
 *   mountSearchableAsync(paths: string[], priorities: number[]) -> Promise<string handle>
 *
 * Pattern: mirror sab-rw.cpp validate->bounds->extract->call-lib->return shape.
 * Source: swg-client-v2 TreeFile_SearchNode.cpp:226-408 (logic now in TreArchive.cpp);
 *         Utinni TreFile.cs:155-310 (version dispatch, field order).
 *
 * Zero-copy contract (AGENTS.md + RESEARCH.md § "Async Worker Model"):
 *   Payload bytes return as Napi::ArrayBuffer — NEVER JSON for binary data.
 *   Entry metadata (path, crc, sizes) returns as JS objects (structure-only).
 *
 * AsyncWorker lifetime note (RESEARCH Pitfall 6):
 *   Input string paths are copied before the AsyncWorker is dispatched.
 *   The worker holds its own copies; no reference to caller-owned memory.
 *   There are no input ArrayBuffers for mount (paths are strings), so no
 *   Napi::Reference is needed for mount input. readMountEntry is synchronous.
 */

#include <napi.h>
#include "../modules/core/tre/TreArchive.h"
#include "../modules/core/tre/TreMount.h"
#include "../modules/core/tre/TreBuilder.h"
#include "../modules/core/io/FileInputStream.h"
#include "../modules/core/io/MemoryInputStream.h"
#include "../modules/core/compress/Zlib.h"
#include <string>
#include <vector>
#include <memory>
#include <unordered_map>
#include <atomic>
#include <stdexcept>
#include <cstring>
#include <fstream>
#include <algorithm>
#include <cctype>

// ─── Plan 01-01 globals (backward-compat synchronous mount) ──────────────────
static std::vector<std::unique_ptr<swg::TreArchive>> g_archives;
static std::vector<std::string>                       g_archivePaths;

// ─── Plan 01-02 mount-handle store ───────────────────────────────────────────
// Each TreMount is identified by an opaque string handle (a numeric string).
// Handles are globally unique within the process lifetime.
static std::unordered_map<std::string, std::unique_ptr<swg::TreMount>> g_mounts;
static std::atomic<int> g_mountHandleCounter{0};

static std::string allocHandle() {
    return std::to_string(++g_mountHandleCounter);
}

// ─── Plan 01-01 exports (backward-compatible synchronous) ────────────────────

/**
 * mountArchive(paths: string[]) -> { archiveIndex, entryCount, path }[]
 * Plan 01-01 synchronous implementation (kept for backward compat with Plan-01 tests).
 */
Napi::Value MountArchive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "mountArchive: expected (paths: string[])").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array pathsArr = info[0].As<Napi::Array>();
    Napi::Array results = Napi::Array::New(env);
    uint32_t resultIdx = 0;

    for (uint32_t i = 0; i < pathsArr.Length(); ++i) {
        Napi::Value elem = pathsArr.Get(i);
        if (!elem.IsString()) {
            Napi::TypeError::New(env, "mountArchive: all elements must be strings").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        const std::string path = elem.As<Napi::String>().Utf8Value();

        try {
            swg::FileInputStream stream(path);
            auto arc = std::make_unique<swg::TreArchive>(swg::TreArchive::parse(stream));
            const int entryCount = arc->entryCount();
            const int archiveIndex = static_cast<int>(g_archives.size());

            g_archives.push_back(std::move(arc));
            g_archivePaths.push_back(path);

            Napi::Object result = Napi::Object::New(env);
            result.Set("archiveIndex", Napi::Number::New(env, archiveIndex));
            result.Set("entryCount",   Napi::Number::New(env, entryCount));
            result.Set("path",         Napi::String::New(env, path));
            results.Set(resultIdx++, result);
        } catch (const std::exception& ex) {
            Napi::Error::New(env, std::string("mountArchive: failed to mount '") + path + "': " + ex.what())
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    return results;
}

/**
 * listEntries(archiveIdx: number) -> NativeTreEntry[]
 * Plan 01-01 synchronous implementation.
 */
Napi::Value ListEntries(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "listEntries: expected (archiveIdx: number)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const int archiveIdx = info[0].As<Napi::Number>().Int32Value();
    if (archiveIdx < 0 || archiveIdx >= static_cast<int>(g_archives.size())) {
        Napi::RangeError::New(env, "listEntries: archiveIdx out of range").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const swg::TreArchive& arc = *g_archives[archiveIdx];
    const auto& entries = arc.entries();
    Napi::Array result = Napi::Array::New(env, entries.size());

    for (size_t i = 0; i < entries.size(); ++i) {
        const swg::TreEntry& e = entries[i];
        const char* namePtr = arc.nameAt(e.fileNameOffset).c_str();
        std::string path(namePtr);

        Napi::Object obj = Napi::Object::New(env);
        obj.Set("path",             Napi::String::New(env, path));
        obj.Set("crc",              Napi::Number::New(env, static_cast<double>(e.crc)));
        obj.Set("uncompressedSize", Napi::Number::New(env, e.length));
        obj.Set("compressedSize",   Napi::Number::New(env, (e.compressor != 0) ? e.compressedLength : e.length));
        obj.Set("offset",           Napi::Number::New(env, e.offset));
        obj.Set("compressor",       Napi::Number::New(env, e.compressor));
        obj.Set("archiveIndex",     Napi::Number::New(env, archiveIdx));
        result.Set(static_cast<uint32_t>(i), obj);
    }

    return result;
}

/**
 * readEntry(archiveIdx: number, entryIdx: number) -> ArrayBuffer
 * Plan 01-01 synchronous implementation.
 */
Napi::Value ReadEntry(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "readEntry: expected (archiveIdx: number, entryIdx: number)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const int archiveIdx = info[0].As<Napi::Number>().Int32Value();
    const int entryIdx   = info[1].As<Napi::Number>().Int32Value();

    if (archiveIdx < 0 || archiveIdx >= static_cast<int>(g_archives.size())) {
        Napi::RangeError::New(env, "readEntry: archiveIdx out of range").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const swg::TreArchive& arc = *g_archives[archiveIdx];
    const std::string& archivePath = g_archivePaths[archiveIdx];

    try {
        swg::FileInputStream stream(archivePath);
        std::vector<uint8_t> payload = arc.extractEntry(entryIdx, stream);

        const size_t byteLen = payload.size();
        uint8_t* rawPtr = payload.data();

        Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, byteLen);
        if (byteLen > 0) {
            std::memcpy(buf.Data(), rawPtr, byteLen);
        }
        return buf;
    } catch (const std::exception& ex) {
        Napi::Error::New(env, std::string("readEntry: ") + ex.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }
}

// ─── Plan 01-02 exports: TreMount-based override resolution ──────────────────

/**
 * mountTreMount(paths: string[], priorities: number[]) -> string (opaque handle)
 *
 * Creates a TreMount from the given archives at the given priorities.
 * Returns an opaque handle string for subsequent resolve/search/read calls.
 *
 * Source: swg-client-v2 TreeFile.cpp:285-308 (priority sort + addSearchNode).
 */
Napi::Value MountTreMount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsArray()) {
        Napi::TypeError::New(env, "mountTreMount: expected (paths: string[], priorities: number[])").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array pathsArr      = info[0].As<Napi::Array>();
    Napi::Array prioritiesArr = info[1].As<Napi::Array>();

    if (pathsArr.Length() != prioritiesArr.Length()) {
        Napi::TypeError::New(env, "mountTreMount: paths and priorities must have equal length").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto mount = std::make_unique<swg::TreMount>();

    for (uint32_t i = 0; i < pathsArr.Length(); ++i) {
        Napi::Value pathVal = pathsArr.Get(i);
        Napi::Value prioVal = prioritiesArr.Get(i);

        if (!pathVal.IsString() || !prioVal.IsNumber()) {
            Napi::TypeError::New(env, "mountTreMount: paths must be strings, priorities must be numbers").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        const std::string path     = pathVal.As<Napi::String>().Utf8Value();
        const int         priority = prioVal.As<Napi::Number>().Int32Value();

        try {
            swg::FileInputStream stream(path);
            auto arc = std::make_unique<swg::TreArchive>(swg::TreArchive::parse(stream));
            mount->addArchive(std::move(arc), path, priority);
        } catch (const std::exception& ex) {
            Napi::Error::New(env,
                std::string("mountTreMount: failed to parse '") + path + "': " + ex.what())
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    const std::string handle = allocHandle();
    g_mounts[handle] = std::move(mount);
    return Napi::String::New(env, handle);
}

/**
 * resolveEntry(handle: string, name: string) -> {winner, tombstone, archiveIndex, entryIndex}
 *
 * Resolve a path against the priority-ordered mount.
 * Source: swg-client-v2 TreeFile.cpp:437-461 (first-match-wins).
 */
Napi::Value ResolveEntry(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "resolveEntry: expected (handle: string, name: string)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle = info[0].As<Napi::String>().Utf8Value();
    const std::string name   = info[1].As<Napi::String>().Utf8Value();

    auto it = g_mounts.find(handle);
    if (it == g_mounts.end()) {
        Napi::RangeError::New(env, "resolveEntry: unknown mount handle").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const swg::TreMountResolveResult r = it->second->resolve(name);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("winner",       r.winner.empty() ? env.Null() : Napi::String::New(env, r.winner).As<Napi::Value>());
    obj.Set("tombstone",    Napi::Boolean::New(env, r.tombstone));
    obj.Set("archiveIndex", Napi::Number::New(env, r.archiveIndex));
    obj.Set("entryIndex",   Napi::Number::New(env, r.entryIndex));
    return obj;
}

/**
 * resolveChain(handle: string, name: string) -> {winner, shadows, tombstone, winnerArchiveIndex}
 *
 * Build the full shadow chain for a path.
 * Source: OUR algorithm — see TreMount.cpp resolveChain().
 */
Napi::Value ResolveChain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "resolveChain: expected (handle: string, name: string)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle = info[0].As<Napi::String>().Utf8Value();
    const std::string name   = info[1].As<Napi::String>().Utf8Value();

    auto it = g_mounts.find(handle);
    if (it == g_mounts.end()) {
        Napi::RangeError::New(env, "resolveChain: unknown mount handle").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const swg::TreShadowChain chain = it->second->resolveChain(name);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("winner",             Napi::String::New(env, chain.winner));
    obj.Set("tombstone",          Napi::Boolean::New(env, chain.tombstone));
    obj.Set("winnerArchiveIndex", Napi::Number::New(env, chain.winnerArchiveIndex));
    obj.Set("winnerEntryIndex",   Napi::Number::New(env, chain.winnerEntryIndex));

    Napi::Array shadows = Napi::Array::New(env, chain.shadows.size());
    for (size_t i = 0; i < chain.shadows.size(); ++i) {
        shadows.Set(static_cast<uint32_t>(i), Napi::String::New(env, chain.shadows[i]));
    }
    obj.Set("shadows", shadows);
    return obj;
}

/**
 * searchMount(handle: string, query: {text: string, mode: 'substring'|'glob'}) -> {entryIndex, archiveIndex}[]
 *
 * Search all mounted archives by path/name.
 * Returns matched INDICES only (T-01-06: never ship the full name list per keystroke).
 *
 * Source: OUR design (RESEARCH.md § "TRE Search Semantics"); T-01-06 disposition.
 */
Napi::Value SearchMount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
        Napi::TypeError::New(env, "searchMount: expected (handle: string, query: {text, mode})").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle = info[0].As<Napi::String>().Utf8Value();
    Napi::Object queryObj    = info[1].As<Napi::Object>();

    if (!queryObj.Has("text") || !queryObj.Has("mode")) {
        Napi::TypeError::New(env, "searchMount: query must have {text, mode}").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string text = queryObj.Get("text").As<Napi::String>().Utf8Value();
    const std::string mode = queryObj.Get("mode").As<Napi::String>().Utf8Value();
    const bool isGlob = (mode == "glob");

    auto it = g_mounts.find(handle);
    if (it == g_mounts.end()) {
        Napi::RangeError::New(env, "searchMount: unknown mount handle").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::vector<swg::TreSearchHitNative> hits = it->second->search(text, isGlob);

    Napi::Array result = Napi::Array::New(env, hits.size());
    for (size_t i = 0; i < hits.size(); ++i) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("entryIndex",   Napi::Number::New(env, hits[i].entryIndex));
        obj.Set("archiveIndex", Napi::Number::New(env, hits[i].archiveIndex));
        result.Set(static_cast<uint32_t>(i), obj);
    }
    return result;
}

/**
 * getMountArchives(handle: string) -> { path, version, enumerateOnly, entryCount, priority, archiveIndex }[]
 *
 * Per-archive metadata in the mount's priority-sorted index space (archiveIndex
 * matches search()/resolve()/resolveChain() hits). Exposes the native truth for
 * version + enumerate-only status so the UI no longer hardcodes them.
 *
 * Source: OUR design — 01-02-PLAN.md index-space-mismatch + version/enumerate fix.
 */
Napi::Value GetMountArchives(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "getMountArchives: expected (handle: string)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle = info[0].As<Napi::String>().Utf8Value();

    auto it = g_mounts.find(handle);
    if (it == g_mounts.end()) {
        Napi::RangeError::New(env, "getMountArchives: unknown mount handle").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::vector<swg::TreMountArchiveInfo> infos = it->second->archiveInfos();

    Napi::Array result = Napi::Array::New(env, infos.size());
    for (size_t i = 0; i < infos.size(); ++i) {
        const swg::TreMountArchiveInfo& a = infos[i];
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("path",          Napi::String::New(env, a.path));
        obj.Set("version",       Napi::String::New(env, a.version));
        obj.Set("enumerateOnly", Napi::Boolean::New(env, a.enumerateOnly));
        obj.Set("entryCount",    Napi::Number::New(env, a.entryCount));
        obj.Set("priority",      Napi::Number::New(env, a.priority));
        obj.Set("archiveIndex",  Napi::Number::New(env, a.archiveIndex));
        result.Set(static_cast<uint32_t>(i), obj);
    }
    return result;
}

/**
 * listMountEntries(handle: string) -> { path, winnerArchivePath, winnerArchiveIndex,
 *                                        shadowCount, isOverride, isTombstone }[]
 *
 * The deduplicated, shadow-resolved VFS for the whole mount. Computed ONCE in C++
 * (resolveChain logic over every unique path). winnerArchiveIndex is in the same
 * priority space as getMountArchives' archiveIndex. REPLACES the renderer's broken
 * JS index-juggling. Does NOT depend on the file-ordered mountArchive() state.
 *
 * Source: OUR design — 01-02-PLAN.md override-detection fix; T-01-06 intent
 * (full path list returned once at mount time, not per keystroke).
 */
Napi::Value ListMountEntries(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "listMountEntries: expected (handle: string)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle = info[0].As<Napi::String>().Utf8Value();

    auto it = g_mounts.find(handle);
    if (it == g_mounts.end()) {
        Napi::RangeError::New(env, "listMountEntries: unknown mount handle").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::vector<swg::TreMountVfsEntry> entries = it->second->vfsEntries();

    Napi::Array result = Napi::Array::New(env, entries.size());
    for (size_t i = 0; i < entries.size(); ++i) {
        const swg::TreMountVfsEntry& e = entries[i];
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("path",               Napi::String::New(env, e.path));
        obj.Set("winnerArchivePath",  Napi::String::New(env, e.winnerArchivePath));
        obj.Set("winnerArchiveIndex", Napi::Number::New(env, e.winnerArchiveIndex));
        obj.Set("shadowCount",        Napi::Number::New(env, e.shadowCount));
        obj.Set("isOverride",         Napi::Boolean::New(env, e.isOverride));
        obj.Set("isTombstone",        Napi::Boolean::New(env, e.isTombstone));
        result.Set(static_cast<uint32_t>(i), obj);
    }
    return result;
}

/**
 * getMountEntriesColumnar(handle: string) -> ArrayBuffer
 *
 * Returns the deduplicated, shadow-resolved VFS as a compact binary columnar blob
 * (see TreMountColumnar in TreMount.h for the binary layout). The blob was built
 * INSIDE MountSearchableAsyncWorker::Execute() — off the main thread — so the main
 * thread pays only ONE ArrayBuffer::New + memcpy here instead of ~1.5M Napi::Set()
 * calls. This eliminates the ~1-minute UI freeze during TRE mount (#1 issue).
 *
 * The renderer decodes this blob using JS TypedArray views into the ArrayBuffer,
 * constructing VfsEntry objects only for visible/requested rows (lazy decode).
 *
 * Falls back to a synchronous build if called on a mount handle that was created
 * via the synchronous mountTreMount() path (no cached payload).
 *
 * Source: perf fix — tre-mount-perf-marshalling.md issue #1 (2026-06-24).
 * Contract: binary layout documented in TreMount.h TreMountColumnar.
 */
Napi::Value GetMountEntriesColumnar(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "getMountEntriesColumnar: expected (handle: string)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle = info[0].As<Napi::String>().Utf8Value();

    auto it = g_mounts.find(handle);
    if (it == g_mounts.end()) {
        Napi::RangeError::New(env, "getMountEntriesColumnar: unknown mount handle").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    swg::TreMount& mount = *it->second;

    // Ensure we have a cached columnar payload (built off-thread by the async worker).
    // If called on a synchronously-created mount (mountTreMount), build it now as a
    // one-time synchronous cost (tests and small mounts only).
    if (!mount.hasColumnar()) {
        mount.setCachedColumnar(mount.vfsEntriesColumnar());
    }

    const swg::TreMountColumnar& col = mount.cachedColumnar();
    const size_t byteLen = col.blob.size();

    // ONE ArrayBuffer allocation + ONE memcpy — replaces ~1.5M Napi::Set() calls.
    Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, byteLen);
    if (byteLen > 0) {
        std::memcpy(buf.Data(), col.blob.data(), byteLen);
    }
    return buf;
}

/**
 * readMountEntry(handle: string, archiveIndex: number, entryIndex: number) -> ArrayBuffer
 *
 * Extract a payload from a specific archive in the mount by index.
 * Returns zero-copy ArrayBuffer (binary stays binary — AGENTS.md).
 * Throws for v6000 enumerate-only archives (T-01-20).
 *
 * Source: TreArchive.cpp extractEntry(); TreMount handles archive lookup.
 */
Napi::Value ReadMountEntry(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "readMountEntry: expected (handle: string, archiveIndex: number, entryIndex: number)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle      = info[0].As<Napi::String>().Utf8Value();
    const int         archiveIdx  = info[1].As<Napi::Number>().Int32Value();
    const int         entryIdx    = info[2].As<Napi::Number>().Int32Value();

    auto it = g_mounts.find(handle);
    if (it == g_mounts.end()) {
        Napi::RangeError::New(env, "readMountEntry: unknown mount handle").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const swg::TreMount& mount = *it->second;
    if (archiveIdx < 0 || archiveIdx >= mount.archiveCount()) {
        Napi::RangeError::New(env, "readMountEntry: archiveIndex out of range").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const swg::TreMountNode& node = mount.nodeAt(archiveIdx);

    try {
        swg::FileInputStream stream(node.path);
        std::vector<uint8_t> payload = node.archive->extractEntry(entryIdx, stream);

        const size_t byteLen = payload.size();
        Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, byteLen);
        if (byteLen > 0) {
            std::memcpy(buf.Data(), payload.data(), byteLen);
        }
        return buf;
    } catch (const std::exception& ex) {
        Napi::Error::New(env, std::string("readMountEntry: ") + ex.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }
}

/**
 * disposeTreMount(handle: string) -> void
 *
 * Release a mounted TreMount and free its resources.
 */
Napi::Value DisposeTreMount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "disposeTreMount: expected (handle: string)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle = info[0].As<Napi::String>().Utf8Value();
    g_mounts.erase(handle);
    return env.Undefined();
}

// ─── AsyncWorker: mountArchiveAsync ──────────────────────────────────────────

/**
 * MountArchiveAsyncWorker — Napi::AsyncWorker for off-main-thread TRE mounting.
 *
 * Runs TreArchive::parse() on the libuv threadpool. Resolves a Promise on the
 * main thread with the parsed archive result.
 *
 * Lifetime (RESEARCH Pitfall 6):
 *   Input `path` is a std::string copied before the worker is dispatched.
 *   `priority` is a plain int. Neither holds a reference to JS objects,
 *   so no Napi::Reference is needed.
 *
 * Source: RESEARCH.md § "Async Worker Model" (Napi::AsyncWorker on libuv pool);
 *         node-addon-api AsyncWorker documentation.
 */
class MountArchiveAsyncWorker : public Napi::AsyncWorker {
public:
    MountArchiveAsyncWorker(Napi::Env env,
                             std::string path,
                             int priority,
                             Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env)
        , m_path(std::move(path))
        , m_priority(priority)
        , m_deferred(std::move(deferred))
    {}

    // Runs on the libuv threadpool (NOT the main thread — no Napi calls allowed here)
    void Execute() override {
        try {
            swg::FileInputStream stream(m_path);
            m_archive     = std::make_unique<swg::TreArchive>(swg::TreArchive::parse(stream));
            m_entryCount  = m_archive->entryCount();
            m_versionStr  = versionToString(m_archive->version());
        } catch (const std::exception& ex) {
            SetError(ex.what());
        }
    }

    // Called on the main thread after Execute() completes
    void OnOK() override {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);

        // Store the parsed archive in the mount handle store
        const std::string handle = allocHandle();
        auto mount = std::make_unique<swg::TreMount>();
        mount->addArchive(std::move(m_archive), m_path, m_priority);
        g_mounts[handle] = std::move(mount);

        Napi::Object result = Napi::Object::New(env);
        result.Set("archiveIndex", Napi::Number::New(env, 0)); // first archive in the new mount
        result.Set("entryCount",   Napi::Number::New(env, m_entryCount));
        result.Set("path",         Napi::String::New(env, m_path));
        result.Set("version",      Napi::String::New(env, m_versionStr));
        result.Set("handle",       Napi::String::New(env, handle));

        m_deferred.Resolve(result);
    }

    void OnError(const Napi::Error& e) override {
        m_deferred.Reject(e.Value());
    }

private:
    std::string                        m_path;
    int                                m_priority;
    Napi::Promise::Deferred            m_deferred;
    std::unique_ptr<swg::TreArchive>   m_archive;
    int                                m_entryCount = 0;
    std::string                        m_versionStr;

    static std::string versionToString(swg::TreVersion v) {
        switch (v) {
            case swg::TreVersion::V0004: return "v0004";
            case swg::TreVersion::V0005: return "v0005";
            case swg::TreVersion::V0006: return "v0006";
            case swg::TreVersion::V5000: return "v5000";
            case swg::TreVersion::V6000: return "v6000";
        }
        return "unknown";
    }
};

/**
 * mountArchiveAsync(path: string, priority: number) -> Promise<result>
 * Correct implementation that returns the Promise from the Deferred.
 * Source: RESEARCH.md § "Async Worker Model"; T-01-08 mitigation.
 */
Napi::Value MountArchiveAsyncFixed(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "mountArchiveAsync: expected (path: string, priority: number)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string path     = info[0].As<Napi::String>().Utf8Value();
    const int         priority = info[1].As<Napi::Number>().Int32Value();

    auto deferred = Napi::Promise::Deferred::New(env);
    Napi::Promise promise = deferred.Promise();

    auto* worker = new MountArchiveAsyncWorker(env, path, priority, std::move(deferred));
    worker->Queue();

    return promise;
}

// ─── AsyncWorker: mountSearchableAsync ───────────────────────────────────────

/**
 * MountSearchableAsyncWorker — async variant of mountTreMount.
 * Parses multiple archives off-thread, resolves a Promise with the mount handle.
 */
class MountSearchableAsyncWorker : public Napi::AsyncWorker {
public:
    MountSearchableAsyncWorker(Napi::Env env,
                                std::vector<std::string> paths,
                                std::vector<int>         priorities,
                                Napi::Promise::Deferred  deferred)
        : Napi::AsyncWorker(env)
        , m_paths(std::move(paths))
        , m_priorities(std::move(priorities))
        , m_deferred(std::move(deferred))
    {}

    void Execute() override {
        try {
            m_mount = std::make_unique<swg::TreMount>();
            for (size_t i = 0; i < m_paths.size(); ++i) {
                swg::FileInputStream stream(m_paths[i]);
                auto arc = std::make_unique<swg::TreArchive>(swg::TreArchive::parse(stream));
                m_mount->addArchive(std::move(arc), m_paths[i], m_priorities[i]);
            }
            // Build the columnar VFS payload here, off the main thread, so the main
            // thread pays only ONE memcpy (inside getMountEntriesColumnar) instead of
            // ~1.5M Napi::Set() calls — the root cause of the ~1-minute UI freeze.
            // Source: perf fix, issue #1 in tre-mount-perf-marshalling.md (2026-06-24).
            m_mount->setCachedColumnar(m_mount->vfsEntriesColumnar());
        } catch (const std::exception& ex) {
            SetError(ex.what());
        }
    }

    void OnOK() override {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);

        const std::string handle = allocHandle();
        g_mounts[handle] = std::move(m_mount);
        m_deferred.Resolve(Napi::String::New(env, handle));
    }

    void OnError(const Napi::Error& e) override {
        m_deferred.Reject(e.Value());
    }

private:
    std::vector<std::string>        m_paths;
    std::vector<int>                m_priorities;
    Napi::Promise::Deferred         m_deferred;
    std::unique_ptr<swg::TreMount>  m_mount;
};

/**
 * mountSearchableAsync(paths: string[], priorities: number[]) -> Promise<string handle>
 * Parse and mount all archives off-thread; resolve with the mount handle.
 */
Napi::Value MountSearchableAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsArray()) {
        Napi::TypeError::New(env, "mountSearchableAsync: expected (paths: string[], priorities: number[])").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array pathsArr      = info[0].As<Napi::Array>();
    Napi::Array prioritiesArr = info[1].As<Napi::Array>();

    if (pathsArr.Length() != prioritiesArr.Length()) {
        Napi::TypeError::New(env, "mountSearchableAsync: paths and priorities must have equal length").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::vector<std::string> paths;
    std::vector<int>         priorities;

    for (uint32_t i = 0; i < pathsArr.Length(); ++i) {
        Napi::Value pv = pathsArr.Get(i);
        Napi::Value rv = prioritiesArr.Get(i);
        if (!pv.IsString() || !rv.IsNumber()) {
            Napi::TypeError::New(env, "mountSearchableAsync: paths must be strings, priorities must be numbers").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        paths.push_back(pv.As<Napi::String>().Utf8Value());
        priorities.push_back(rv.As<Napi::Number>().Int32Value());
    }

    auto deferred = Napi::Promise::Deferred::New(env);
    Napi::Promise promise = deferred.Promise();

    auto* worker = new MountSearchableAsyncWorker(env, std::move(paths), std::move(priorities), std::move(deferred));
    worker->Queue();

    return promise;
}

// ─── Plan 01-04 exports: TreBuilder (D-04 builder primitive) ─────────────────

/**
 * BuildTre — N-API binding for TreBuilder::build().
 *
 * buildTre(entries: {path: string, data: Uint8Array, tombstone?: boolean}[], version?: string)
 *   -> ArrayBuffer  (complete .tre archive bytes)
 *
 * Zero-copy contract: result returns as Napi::ArrayBuffer (binary stays binary — AGENTS.md).
 * v6000 throws (enumerate-only, T-01-17).
 *
 * Source: modules/core/tre/TreBuilder.h TreBuilder::build();
 *         RESEARCH.md § "TRE Builder (D-04)".
 */
Napi::Value BuildTre(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "buildTre: expected (entries: {path, data, tombstone?}[], version?: string)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array arr = info[0].As<Napi::Array>();

    // Optional version string (default V0005)
    swg::TreVersion version = swg::TreVersion::V0005;
    if (info.Length() >= 2 && info[1].IsString()) {
        const std::string vstr = info[1].As<Napi::String>().Utf8Value();
        try { version = swg::parseVersionString(vstr.c_str()); } catch (...) {}
    }

    std::vector<swg::TreBuilderEntry> entries;
    entries.reserve(arr.Length());

    for (uint32_t i = 0; i < arr.Length(); ++i) {
        Napi::Value v = arr.Get(i);
        if (!v.IsObject()) {
            Napi::TypeError::New(env, "buildTre: each entry must be an object").ThrowAsJavaScriptException();
            return env.Undefined();
        }
        Napi::Object obj = v.As<Napi::Object>();

        if (!obj.Has("path") || !obj.Get("path").IsString()) {
            Napi::TypeError::New(env, "buildTre: entry.path must be a string").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        swg::TreBuilderEntry e;
        e.path = obj.Get("path").As<Napi::String>().Utf8Value();

        if (obj.Has("tombstone") && obj.Get("tombstone").IsBoolean()) {
            e.tombstone = obj.Get("tombstone").As<Napi::Boolean>().Value();
        }

        if (!e.tombstone) {
            if (!obj.Has("data")) {
                Napi::TypeError::New(env, "buildTre: non-tombstone entry must have data").ThrowAsJavaScriptException();
                return env.Undefined();
            }
            Napi::Value dataVal = obj.Get("data");
            if (dataVal.IsArrayBuffer()) {
                Napi::ArrayBuffer ab = dataVal.As<Napi::ArrayBuffer>();
                const uint8_t* ptr = reinterpret_cast<const uint8_t*>(ab.Data());
                e.data.assign(ptr, ptr + ab.ByteLength());
            } else if (dataVal.IsTypedArray()) {
                Napi::TypedArray ta = dataVal.As<Napi::TypedArray>();
                Napi::ArrayBuffer ab = ta.ArrayBuffer();
                const uint8_t* ptr = reinterpret_cast<const uint8_t*>(ab.Data()) + ta.ByteOffset();
                e.data.assign(ptr, ptr + ta.ByteLength());
            } else {
                Napi::TypeError::New(env, "buildTre: entry.data must be ArrayBuffer or TypedArray").ThrowAsJavaScriptException();
                return env.Undefined();
            }
        }

        entries.push_back(std::move(e));
    }

    try {
        std::vector<uint8_t> bytes = swg::TreBuilder::build(entries, version);
        const size_t byteLen = bytes.size();
        Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, byteLen);
        if (byteLen > 0) {
            std::memcpy(buf.Data(), bytes.data(), byteLen);
        }
        return buf;
    } catch (const std::exception& ex) {
        Napi::Error::New(env, std::string("buildTre: ") + ex.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }
}

/**
 * RepackTre — N-API binding for TreBuilder::repack().
 *
 * repackTre(sourcePath: string, edits: {index: number, data: Uint8Array}[], version?: string)
 *   -> ArrayBuffer  (complete repacked .tre archive bytes)
 *
 * Untouched entries are copied verbatim (raw-slice identity contract, TreWriter.cs:166-174).
 * Only edited entries are recompressed (zlib level 6, no miniz).
 * v6000 throws (enumerate-only, T-01-17).
 *
 * Source: modules/core/tre/TreBuilder.h TreBuilder::repack();
 *         Utinni TreWriter.cs:166-174 (per-record raw-slice identity);
 *         RESEARCH.md § "TRE Builder (D-04)".
 */
Napi::Value RepackTre(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "repackTre: expected (sourcePath: string, edits?, version?)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string sourcePath = info[0].As<Napi::String>().Utf8Value();

    // Optional edits array [{index, data}]
    std::vector<int> editedIndices;
    std::vector<std::vector<uint8_t>> editedData;

    if (info.Length() >= 2 && info[1].IsArray()) {
        Napi::Array editsArr = info[1].As<Napi::Array>();
        for (uint32_t i = 0; i < editsArr.Length(); ++i) {
            Napi::Value ev = editsArr.Get(i);
            if (!ev.IsObject()) continue;
            Napi::Object eobj = ev.As<Napi::Object>();

            if (!eobj.Has("index") || !eobj.Get("index").IsNumber()) continue;
            const int idx = eobj.Get("index").As<Napi::Number>().Int32Value();

            std::vector<uint8_t> data;
            if (eobj.Has("data")) {
                Napi::Value dv = eobj.Get("data");
                if (dv.IsArrayBuffer()) {
                    Napi::ArrayBuffer ab = dv.As<Napi::ArrayBuffer>();
                    const uint8_t* ptr = reinterpret_cast<const uint8_t*>(ab.Data());
                    data.assign(ptr, ptr + ab.ByteLength());
                } else if (dv.IsTypedArray()) {
                    Napi::TypedArray ta = dv.As<Napi::TypedArray>();
                    Napi::ArrayBuffer ab = ta.ArrayBuffer();
                    const uint8_t* ptr = reinterpret_cast<const uint8_t*>(ab.Data()) + ta.ByteOffset();
                    data.assign(ptr, ptr + ta.ByteLength());
                }
            }
            editedIndices.push_back(idx);
            editedData.push_back(std::move(data));
        }
    }

    // Optional version string
    swg::TreVersion version = swg::TreVersion::V0005;
    if (info.Length() >= 3 && info[2].IsString()) {
        const std::string vstr = info[2].As<Napi::String>().Utf8Value();
        try { version = swg::parseVersionString(vstr.c_str()); } catch (...) {}
    }

    try {
        swg::FileInputStream stream(sourcePath);
        swg::TreArchive arc = swg::TreArchive::parse(stream);

        // Re-open for repack (repack reads raw payload slices)
        swg::FileInputStream stream2(sourcePath);
        std::vector<uint8_t> bytes = swg::TreBuilder::repack(
            arc, stream2, editedIndices, editedData, version);

        const size_t byteLen = bytes.size();
        Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, byteLen);
        if (byteLen > 0) {
            std::memcpy(buf.Data(), bytes.data(), byteLen);
        }
        return buf;
    } catch (const std::exception& ex) {
        Napi::Error::New(env, std::string("repackTre: ") + ex.what()).ThrowAsJavaScriptException();
        return env.Undefined();
    }
}

// ─── Plan 04.3-10 exports: extractMountAt + mountTreMountWithToc ─────────────

/**
 * LE uint32 read helper (unaligned-safe) — local to this translation unit.
 * Same as the one in TreArchive.cpp; duplicated to avoid cross-TU header change.
 */
static inline uint32_t readLE32_binding(const uint8_t* p) {
    return static_cast<uint32_t>(p[0])
        | (static_cast<uint32_t>(p[1]) << 8)
        | (static_cast<uint32_t>(p[2]) << 16)
        | (static_cast<uint32_t>(p[3]) << 24);
}

/**
 * Parse the master SearchTOC file and inject external entries into the TreMount.
 *
 * Replicates tocReader.ts (TS port) + TreeFile_SearchNode.h:270-299 (ground truth).
 *
 * SearchTOC header (36 bytes LE):
 *   [0..3]  uint32 magic    = 0x544F4320 (" COT")
 *   [4..7]  uint32 version  = 0x30303031 ("1000")
 *   [8]     uint8  tocCompressor
 *   [9]     uint8  fileNameBlockCompressor
 *   [10,11] uint8  unused
 *   [12..15] uint32 numberOfFiles
 *   [16..19] uint32 sizeOfTOC
 *   [20..23] uint32 sizeOfNameBlock
 *   [24..27] uint32 uncompSizeOfNameBlock
 *   [28..31] uint32 numberOfTreeFiles
 *   [32..35] uint32 sizeOfTreeFileNameBlock
 *
 * TOC entry (24 bytes, compressor-first per tocReader.ts SEARCH_TOC_ENTRY_FMT):
 *   [0]    uint8  compressor
 *   [1]    uint8  unused
 *   [2..3] uint16 treeFileIndex
 *   [4..7] uint32 crc
 *   [8..11] uint32 fileNameLength  (DISK: LENGTH of name string, NOT an offset)
 *   [12..15] uint32 offset
 *   [16..19] uint32 length
 *   [20..23] uint32 compressedLength
 *
 * Source: tocReader.ts readTocIndex(); TreeFile_SearchNode.h:289-299; tre_reader.py:381.
 */
static void parseTocIntoMount(const std::string& tocPath,
                               const std::string& tocTreePath,
                               swg::TreMount&     mount)
{
    // Read the entire .toc file into memory.
    std::ifstream tocFile(tocPath, std::ios::binary | std::ios::ate);
    if (!tocFile.is_open())
        throw std::runtime_error("parseTocIntoMount: cannot open .toc: " + tocPath);

    const std::streampos fileSize = tocFile.tellg();
    if (fileSize < 0 || fileSize > static_cast<std::streampos>(swg::ZLIB_MAX_BLOCK))
        throw std::runtime_error("parseTocIntoMount: .toc file size out of bounds");

    const size_t fsz = static_cast<size_t>(fileSize);
    tocFile.seekg(0);
    std::vector<uint8_t> buf(fsz);
    tocFile.read(reinterpret_cast<char*>(buf.data()), static_cast<std::streamsize>(fsz));
    if (!tocFile)
        throw std::runtime_error("parseTocIntoMount: failed to read .toc file");
    tocFile.close();

    if (fsz < 36)
        throw std::runtime_error("parseTocIntoMount: .toc file too short for header");

    // Parse header.
    const uint32_t magic   = readLE32_binding(buf.data());
    const uint32_t version = readLE32_binding(buf.data() + 4);
    if (magic != 0x544F4320u || version != 0x30303031u)
        throw std::runtime_error("parseTocIntoMount: invalid .toc magic/version");

    const uint8_t  tocCompressor          = buf[8];
    const uint8_t  fileNameBlockComp      = buf[9];
    const uint32_t numberOfFiles          = readLE32_binding(buf.data() + 12);
    const uint32_t sizeOfTOC             = readLE32_binding(buf.data() + 16);
    // const uint32_t sizeOfNameBlock     = readLE32_binding(buf.data() + 20); // unused
    const uint32_t uncompSizeOfNameBlock  = readLE32_binding(buf.data() + 24);
    const uint32_t numberOfTreeFiles      = readLE32_binding(buf.data() + 28);
    const uint32_t sizeOfTreeNames        = readLE32_binding(buf.data() + 32);

    // Security: numberOfFiles sanity (avoid giant alloc)
    if (numberOfFiles > static_cast<uint32_t>(swg::ZLIB_MAX_BLOCK) / 24u)
        throw std::runtime_error("parseTocIntoMount: numberOfFiles exceeds security cap");

    // Validate sizeOfTOC == numberOfFiles * 24.
    if (sizeOfTOC != numberOfFiles * 24u)
        throw std::runtime_error("parseTocIntoMount: sizeOfTOC mismatch (expected n*24)");

    // Tree-name block starts at offset 36.
    const size_t treeNameOff = 36;
    if (treeNameOff + sizeOfTreeNames > fsz)
        throw std::runtime_error("parseTocIntoMount: tree-name block out of bounds");

    // Parse tree-file names (null-terminated strings).
    std::vector<std::string> treeNames;
    treeNames.reserve(numberOfTreeFiles);
    {
        const uint8_t* nb  = buf.data() + treeNameOff;
        size_t         pos = 0;
        while (treeNames.size() < numberOfTreeFiles && pos < sizeOfTreeNames) {
            size_t end = pos;
            while (end < sizeOfTreeNames && nb[end] != 0) ++end;
            treeNames.emplace_back(reinterpret_cast<const char*>(nb + pos), end - pos);
            pos = end + 1;
        }
    }

    // TOC blob starts after header + tree-name block.
    const size_t tocBlobStart = treeNameOff + sizeOfTreeNames;
    if (tocBlobStart + sizeOfTOC > fsz)
        throw std::runtime_error("parseTocIntoMount: TOC blob out of bounds");

    // Decompress TOC blob if needed.
    std::vector<uint8_t> tocBlob;
    {
        const uint8_t* rawToc = buf.data() + tocBlobStart;
        if (tocCompressor != 0) {
            tocBlob = swg::treInflate(static_cast<int>(tocCompressor),
                                      rawToc, sizeOfTOC, numberOfFiles * 24u);
        } else {
            tocBlob.assign(rawToc, rawToc + sizeOfTOC);
        }
    }

    // Name block starts after TOC blob.
    const size_t nameBlockStart = tocBlobStart + sizeOfTOC;
    std::vector<uint8_t> nameBlock;
    {
        if (nameBlockStart <= fsz) {
            const uint8_t* rawName   = buf.data() + nameBlockStart;
            const size_t   rawNameSz = fsz - nameBlockStart;
            if (fileNameBlockComp != 0 && uncompSizeOfNameBlock > 0) {
                nameBlock = swg::treInflate(static_cast<int>(fileNameBlockComp),
                                            rawName, rawNameSz, uncompSizeOfNameBlock);
            } else {
                nameBlock.assign(rawName, rawName + rawNameSz);
            }
        }
    }

    // Build normalized-path → archiveIndex map from the mount's current nodes.
    // Normalization: lowercase + backslash → forward-slash.
    auto normalizePath = [](const std::string& p) -> std::string {
        std::string r;
        r.reserve(p.size());
        for (char c : p) {
            r += (c == '\\') ? '/' : static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        }
        return r;
    };

    std::unordered_map<std::string, int> pathToArchiveIdx;
    pathToArchiveIdx.reserve(static_cast<size_t>(mount.archiveCount()));
    for (int ai = 0; ai < mount.archiveCount(); ++ai) {
        pathToArchiveIdx[normalizePath(mount.nodeAt(ai).path)] = ai;
    }

    // Normalize tocTreePath once (used to build container paths).
    const std::string normTocTree = normalizePath(tocTreePath);

    // Parse TOC entries and group by archiveIndex.
    std::unordered_map<int, std::vector<swg::TocExternalEntry>> byArchive;
    size_t fnOffset = 0; // cumulative name-block position (rebuilt from fileNameLength)

    for (uint32_t i = 0; i < numberOfFiles; ++i) {
        const uint8_t* e = tocBlob.data() + i * 24u;

        const uint8_t  compressor       = e[0];
        // e[1] unused
        const uint16_t treeFileIndex    = static_cast<uint16_t>(e[2]) |
                                          (static_cast<uint16_t>(e[3]) << 8);
        const uint32_t crc              = readLE32_binding(e + 4);
        const uint32_t fileNameLength   = readLE32_binding(e + 8); // LENGTH not offset
        const uint32_t offset           = readLE32_binding(e + 12);
        const uint32_t length           = readLE32_binding(e + 16);
        const uint32_t compressedLength = readLE32_binding(e + 20);

        // Read virtual path from name block.
        std::string virtualPath;
        if (fnOffset + fileNameLength <= nameBlock.size() && fileNameLength > 0) {
            virtualPath.assign(reinterpret_cast<const char*>(nameBlock.data() + fnOffset),
                               fileNameLength);
            // Normalize: lowercase + backslash → slash.
            for (char& c : virtualPath) {
                if (c == '\\') c = '/';
                else c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            }
        }
        fnOffset += fileNameLength + 1; // +1 for NUL separator

        if (virtualPath.empty()) continue;

        // Resolve treeFileIndex → container archive name.
        if (treeFileIndex >= static_cast<uint16_t>(treeNames.size())) continue;
        const std::string& treName = treeNames[static_cast<size_t>(treeFileIndex)];

        // Build normalized container path: normTocTree + "/" + treName.
        std::string normContainer = normTocTree;
        if (!normContainer.empty() && normContainer.back() != '/')
            normContainer += '/';
        normContainer += normalizePath(treName);

        // Look up the matching archive in the mount.
        auto it = pathToArchiveIdx.find(normContainer);
        if (it == pathToArchiveIdx.end()) continue; // archive not in mount

        const int archiveIndex = it->second;

        swg::TocExternalEntry entry;
        entry.virtualPath      = std::move(virtualPath);
        entry.offset           = offset;           // uint32_t — F-5 (no cast needed)
        entry.length           = length;           // uint32_t — F-5
        entry.compressedLength = compressedLength; // uint32_t — F-5
        entry.compressor       = compressor;       // uint32_t — already was
        entry.crc              = crc;              // uint32_t — already was

        byArchive[archiveIndex].push_back(std::move(entry));
    }

    // Inject external entries into the mount.
    for (auto& [ai, entries] : byArchive) {
        mount.addExternalEntries(ai, std::move(entries));
    }
}

/**
 * extractMountAt(handle: string, archiveIndex: number, descriptor: object) -> ExtractAtResult
 *
 * Extract a payload from a mounted container using an EXTERNALLY-SUPPLIED entry descriptor.
 * The container is identified by (handle, archiveIndex) → mount.nodeAt(archiveIndex).path,
 * the same lookup readMountEntry uses (tre_binding.cpp:543-547). The descriptor carries
 * offset/length/compressedLength/compressor from the master .toc.
 *
 * Per-payload classify (MOUNT-04): on inflate success → { bytes: ArrayBuffer };
 * on inflate failure (encrypted) → { encrypted: true }.
 *
 * Binary stays binary: bytes cross the bridge as ArrayBuffer (AGENTS.md).
 * Security (T-01-02): bounds-check delegated to TreArchive::extractAt().
 *
 * Source: TreArchive::extractAt (plan 04.3-10 Task 2, H1 redesign);
 *         index.d.ts ExtractAtResult (frozen by plan 04.3-03).
 */
Napi::Value ExtractMountAt(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 ||
        !info[0].IsString() || !info[1].IsNumber() || !info[2].IsObject()) {
        Napi::TypeError::New(env,
            "extractMountAt: expected (handle: string, archiveIndex: number, descriptor: object)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle     = info[0].As<Napi::String>().Utf8Value();
    const int         archiveIdx = info[1].As<Napi::Number>().Int32Value();
    Napi::Object      descObj    = info[2].As<Napi::Object>();

    if (!descObj.Has("offset") || !descObj.Has("length") ||
        !descObj.Has("compressedLength") || !descObj.Has("compressor")) {
        Napi::TypeError::New(env,
            "extractMountAt: descriptor must have {offset, length, compressedLength, compressor}")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    swg::TreExtractDescriptor desc;
    // F-5 (gate D-16): use Uint32Value() — engine fields are uint32_t; Int32Value() mishandles
    // high-bit values (>2^31-1) that are valid unsigned offsets/lengths in large TRE files.
    desc.offset           = descObj.Get("offset").As<Napi::Number>().Uint32Value();
    desc.length           = descObj.Get("length").As<Napi::Number>().Uint32Value();
    desc.compressedLength = descObj.Get("compressedLength").As<Napi::Number>().Uint32Value();
    desc.compressor       = descObj.Get("compressor").As<Napi::Number>().Uint32Value();
    // F-4 (gate D-16): thread crc from the master-.toc entry through the descriptor so
    // extractAt() can use the (already-parsed, already-present) path-CRC for integrity gating.
    // Optional field: callers that don't have the crc (e.g. synthetic tests) may omit it.
    desc.crc = descObj.Has("crc")
                   ? descObj.Get("crc").As<Napi::Number>().Uint32Value()
                   : 0u;

    auto it = g_mounts.find(handle);
    if (it == g_mounts.end()) {
        Napi::RangeError::New(env, "extractMountAt: unknown mount handle")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const swg::TreMount& mount = *it->second;
    if (archiveIdx < 0 || archiveIdx >= mount.archiveCount()) {
        Napi::RangeError::New(env, "extractMountAt: archiveIndex out of range")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const swg::TreMountNode& node = mount.nodeAt(archiveIdx);

    Napi::Object result = Napi::Object::New(env);
    try {
        swg::FileInputStream    stream(node.path);
        swg::TreExtractResult   extracted = swg::TreArchive::extractAt(desc, stream);

        if (extracted.encrypted) {
            // Restoration v6000 or unknown encrypted payload — graceful degradation (MOUNT-04).
            result.Set("encrypted", Napi::Boolean::New(env, true));
        } else {
            // Plain-zlib payload (swg-source v6000) — zero-copy ArrayBuffer (AGENTS.md).
            const size_t byteLen = extracted.bytes.size();
            Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, byteLen);
            if (byteLen > 0) {
                std::memcpy(buf.Data(), extracted.bytes.data(), byteLen);
            }
            result.Set("bytes", buf);
        }
    } catch (const std::exception& ex) {
        // Bounds check failure or stream read error — throw to JS (not graceful degrade).
        Napi::Error::New(env, std::string("extractMountAt: ") + ex.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return result;
}

/**
 * mountTreMountWithToc(paths, priorities, tocPath, tocTreePath) -> string handle
 *
 * Create a priority-ordered virtual filesystem mount from the given archives, then
 * parse the master .toc and inject TOC-sourced external entries into the mount so that
 * empty-internal-TOC (numberOfFiles=0) v6000 containers contribute entries through
 * getMountEntriesColumnar (the H1 columnar-bridge gap fix).
 *
 * Extends mountTreMount() with two additional parameters (tocPath, tocTreePath).
 * Returns the same opaque handle type — all mount APIs (resolve, search, etc.) work.
 *
 * Source: index.d.ts mountTreMountWithToc declaration (frozen by plan 04.3-03);
 *         parseTocIntoMount() helper (SearchTOC format from tocReader.ts / h:270-299).
 */
Napi::Value MountTreMountWithToc(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4 ||
        !info[0].IsArray() || !info[1].IsArray() ||
        !info[2].IsString() || !info[3].IsString()) {
        Napi::TypeError::New(env,
            "mountTreMountWithToc: expected (paths: string[], priorities: number[], tocPath: string, tocTreePath: string)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array pathsArr      = info[0].As<Napi::Array>();
    Napi::Array prioritiesArr = info[1].As<Napi::Array>();
    const std::string tocPath     = info[2].As<Napi::String>().Utf8Value();
    const std::string tocTreePath = info[3].As<Napi::String>().Utf8Value();

    if (pathsArr.Length() != prioritiesArr.Length()) {
        Napi::TypeError::New(env,
            "mountTreMountWithToc: paths and priorities must have equal length")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Step 1: create the TreMount from the archive paths (same as mountTreMount).
    auto mount = std::make_unique<swg::TreMount>();

    for (uint32_t i = 0; i < pathsArr.Length(); ++i) {
        Napi::Value pathVal = pathsArr.Get(i);
        Napi::Value prioVal = prioritiesArr.Get(i);

        if (!pathVal.IsString() || !prioVal.IsNumber()) {
            Napi::TypeError::New(env,
                "mountTreMountWithToc: paths must be strings, priorities must be numbers")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }

        const std::string path     = pathVal.As<Napi::String>().Utf8Value();
        const int         priority = prioVal.As<Napi::Number>().Int32Value();

        try {
            swg::FileInputStream stream(path);
            auto arc = std::make_unique<swg::TreArchive>(swg::TreArchive::parse(stream));
            mount->addArchive(std::move(arc), path, priority);
        } catch (const std::exception& ex) {
            Napi::Error::New(env,
                std::string("mountTreMountWithToc: failed to parse '") + path + "': " + ex.what())
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    // Step 2: parse the master .toc and inject external entries.
    try {
        parseTocIntoMount(tocPath, tocTreePath, *mount);
    } catch (const std::exception& ex) {
        Napi::Error::New(env,
            std::string("mountTreMountWithToc: failed to parse .toc '") + tocPath + "': " + ex.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handle = allocHandle();
    g_mounts[handle] = std::move(mount);
    return Napi::String::New(env, handle);
}
