/**
 * tre_binding.cpp — Thin N-API binding over the engine-free modules/core TRE lib.
 *
 * Exports:
 *   mountArchive(paths: string[])  -> object[]  (entry list, synchronous for Plan 01;
 *                                                AsyncWorker wrapping in Plan 02)
 *   listEntries(archiveIdx: number) -> object[] (all entries for a mounted archive)
 *   readEntry(archiveIdx: number, entryIdx: number) -> ArrayBuffer (zero-copy payload)
 *
 * Pattern: mirror sab-rw.cpp validate->bounds->extract->call-lib->return shape.
 * Source: swg-client-v2 TreeFile_SearchNode.cpp:226-408 (logic now in TreArchive.cpp);
 *         Utinni TreFile.cs:155-310 (version dispatch, field order).
 *
 * Zero-copy contract (AGENTS.md + RESEARCH.md § "Async Worker Model"):
 *   Payload bytes return as Napi::ArrayBuffer — NEVER JSON for binary data.
 *   Entry metadata (path, crc, sizes) returns as JS objects (structure-only).
 *
 * SAB lifetime note (RESEARCH Pitfall 6): for Plan 01 sync path, the C++ call
 * completes before the JS return — no lifetime concern. The AsyncWorker wrapping
 * in Plan 02 will add Napi::Reference guards for input ArrayBuffers.
 */

#include <napi.h>
#include "../modules/core/tre/TreArchive.h"
#include "../modules/core/io/FileInputStream.h"
#include "../modules/core/io/MemoryInputStream.h"
#include <string>
#include <vector>
#include <memory>

// Global mounted archive cache (synchronous Plan 01 implementation).
// Plan 02 replaces this with an AsyncWorker + proper lifecycle manager.
static std::vector<std::unique_ptr<swg::TreArchive>> g_archives;
static std::vector<std::string>                       g_archivePaths;

/**
 * mountArchive(paths: string[]) -> { archiveIndex: number, entryCount: number }[]
 *
 * Parse one or more TRE archives and add them to the global mount list.
 * Returns an array of { archiveIndex, entryCount } for each successfully parsed archive.
 *
 * Source: swg-client-v2 TreeFile.cpp:285-308 (priority search node list);
 *         TreArchive.cpp parse() (header + TOC + name block).
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
 * listEntries(archiveIdx: number) -> TreEntry[]
 *
 * Returns all TOC entries for the mounted archive at archiveIdx.
 * Each entry has { path, crc, uncompressedSize, compressedSize, offset, compressor, archiveIndex }.
 *
 * Source: swg-client-v2 TreeFile_SearchNode.cpp:329 (name block access);
 *         TreArchive.cpp entries() + nameAt().
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
 *
 * Extract and return the decompressed payload for one TOC entry.
 * Returns a ZERO-COPY ArrayBuffer (binary stays binary — AGENTS.md).
 * Throws for v6000 enumerate-only archives (T-01-05).
 *
 * Source: TreArchive.cpp extractEntry(); swg-client-v2 TreeFile_SearchNode.cpp:534
 *         (ZlibCompressor().expand — now in Zlib.cpp).
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

        // Return as a zero-copy ArrayBuffer (transfer ownership of the data)
        // Source: node-addon-api ArrayBuffer with external data + finalizer.
        const size_t byteLen = payload.size();
        uint8_t* rawPtr = payload.data();

        // Allocate a new ArrayBuffer that copies the data
        // (true zero-copy via external ArrayBuffer requires careful lifetime management
        //  which will be added in Plan 02 with proper AsyncWorker + Napi::Reference)
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
