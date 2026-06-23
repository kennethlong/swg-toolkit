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
#include "../modules/core/io/FileInputStream.h"
#include "../modules/core/io/MemoryInputStream.h"
#include <string>
#include <vector>
#include <memory>
#include <unordered_map>
#include <atomic>
#include <stdexcept>
#include <cstring>

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
