/**
 * stf_binding.cpp — Thin N-API binding for the `.stf` localized-string-table parser + serializer.
 *
 * Wires parseStf()/serializeStf() from modules/core/formats/StringTable.h into the N-API addon.
 * This file is a THIN BINDING LAYER ONLY — no parse logic here (Decision D-02).
 *
 * .stf is PARSER-NATIVE (like Palette.h), not IFF-tree-based (like Effect.h/DataTable.h) — no
 * IffNode reconstruction is needed here, mirroring ParsePalette's shape exactly
 * (mesh_binding.cpp:392-442).
 *
 * Exports (registered in addon.cpp):
 *   parseStf(bytes: ArrayBuffer|Uint8Array) -> StfBindingResult (+ roundTripBytes: ArrayBuffer)
 *   serializeStf(table: object) -> ArrayBuffer
 *
 * Return contract:
 *   - Struct/metadata crosses as JS objects (numbers, strings, arrays).
 *   - `text` decodes std::u16string -> a JS string via a direct UTF-16LE copy (the native
 *     platform string encoding, so this is not a re-encode).
 *   - `roundTripBytes` on ParseStf's result lets the CORE-05 gate feed the SAME object straight
 *     back into a serialize call without a second round-trip through JS (mirrors ParsePalette's
 *     roundTripBytes tail, mesh_binding.cpp:433-439).
 *   - A standalone SerializeStf export additionally accepts a JS-side EDITED
 *     { nextUniqueId, entries, nameMap } shape and returns fresh bytes, since the DATA-02 editor
 *     (05-09) needs to serialize an edited buffer, not just prove round-trip identity.
 *
 * Source pattern: mesh_binding.cpp (extractBytes + two-tier try/catch + roundTripBytes tail).
 *
 * Decision D-02: No parse logic here; no SOE engine headers.
 */

#include <napi.h>
#include <cstring>
#include <stdexcept>
#include <vector>

#include "formats/StringTable.h"

// ─── Helpers (duplicated from mesh_binding.cpp/dtii_binding.cpp to keep this file independent —
//      same convention those files already follow) ─────────────────────────────────────────────

static std::pair<const uint8_t*, size_t>
extractBytesStf(const Napi::Value& val, Napi::Env env, const char* argName) {
    if (val.IsArrayBuffer()) {
        auto ab = val.As<Napi::ArrayBuffer>();
        return { static_cast<const uint8_t*>(ab.Data()), ab.ByteLength() };
    }
    if (val.IsTypedArray()) {
        auto ta = val.As<Napi::TypedArray>();
        if (ta.TypedArrayType() == napi_uint8_array) {
            auto u8 = val.As<Napi::Uint8Array>();
            return { u8.Data(), u8.ByteLength() };
        }
    }
    std::string msg = std::string(argName) + " must be an ArrayBuffer or Uint8Array";
    Napi::TypeError::New(env, msg).ThrowAsJavaScriptException();
    return { nullptr, 0 };
}

// UTF-16LE (std::u16string, native platform encoding on Windows) -> Napi::String.
// node-addon-api's Napi::String::New(env, std::u16string) is a direct UTF-16 constructor — no
// UTF-8 re-encode, which would corrupt unpaired surrogates / non-BMP text.
static Napi::String u16ToJsString(Napi::Env env, const std::u16string& s) {
    return Napi::String::New(env, s);
}

// Napi::String (UTF-16 JS string) -> std::u16string, preserving code units verbatim via
// node-addon-api's built-in Utf16Value() (no UTF-8 round-trip).
static std::u16string jsStringToU16(const Napi::String& s) {
    return s.Utf16Value();
}

// ─── ParseStf ───────────────────────────────────────────────────────────────────

/**
 * parseStf(bytes: ArrayBuffer|Uint8Array) -> {
 *   nextUniqueId: number,
 *   entries: Array<{ id: number, sourceCrc: number, text: string }>,   // byId order
 *   nameMap: Array<{ id: number, name: string }>,                      // nameToId order
 *   roundTripBytes: ArrayBuffer,
 * }
 */
Napi::Value ParseStf(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "parseStf: (bytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [data, size] = extractBytesStf(info[0], env, "parseStf bytes");
    if (!data) return env.Undefined();

    swg_core::formats::StfResult stfResult;
    try {
        stfResult = swg_core::formats::parseStf(data, static_cast<uint32_t>(size));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseStf error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseStf internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("nextUniqueId", Napi::Number::New(env, stfResult.nextUniqueId));

    auto entries = Napi::Array::New(env, stfResult.byId.size());
    for (size_t i = 0; i < stfResult.byId.size(); ++i) {
        const auto& e = stfResult.byId[i];
        auto eobj = Napi::Object::New(env);
        eobj.Set("id", Napi::Number::New(env, e.id));
        eobj.Set("sourceCrc", Napi::Number::New(env, e.sourceCrc));
        eobj.Set("text", u16ToJsString(env, e.text));
        entries.Set(static_cast<uint32_t>(i), eobj);
    }
    result.Set("entries", entries);

    auto nameMap = Napi::Array::New(env, stfResult.nameToId.size());
    for (size_t i = 0; i < stfResult.nameToId.size(); ++i) {
        const auto& pair = stfResult.nameToId[i];
        auto nobj = Napi::Object::New(env);
        nobj.Set("id", Napi::Number::New(env, pair.second));
        nobj.Set("name", Napi::String::New(env, pair.first));
        nameMap.Set(static_cast<uint32_t>(i), nobj);
    }
    result.Set("nameMap", nameMap);

    // Round-trip bytes for PARSER-NATIVE (mirrors ParsePalette's roundTripBytes tail) — lets the
    // CORE-05 gate feed this same result straight into a serialize call.
    auto serialized = swg_core::formats::serializeStf(stfResult);
    auto ab = Napi::ArrayBuffer::New(env, serialized.size());
    if (!serialized.empty()) {
        std::memcpy(ab.Data(), serialized.data(), serialized.size());
    }
    result.Set("roundTripBytes", ab);

    return result;
}

// ─── SerializeStf ───────────────────────────────────────────────────────────────

/**
 * serializeStf(table: { nextUniqueId, entries: Array<{id,sourceCrc,text}>,
 *                        nameMap: Array<{id,name}> }) -> ArrayBuffer
 *
 * Accepts the same shape ParseStf returns (entries/nameMap), so an edited buffer from the
 * DATA-02 editor (05-09) can be serialized directly. sourceCrc is written VERBATIM from each
 * entry — this export never recomputes it (D-10).
 */
Napi::Value SerializeStf(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "serializeStf: (table: object) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object tableObj = info[0].As<Napi::Object>();
    swg_core::formats::StfResult table;
    std::vector<uint8_t> serialized;

    try {
        table.nextUniqueId = tableObj.Has("nextUniqueId")
            ? tableObj.Get("nextUniqueId").As<Napi::Number>().Uint32Value()
            : 0;

        if (!tableObj.Has("entries") || !tableObj.Get("entries").IsArray())
            throw std::runtime_error("serializeStf: table.entries must be an array");
        auto entriesArr = tableObj.Get("entries").As<Napi::Array>();
        table.byId.reserve(entriesArr.Length());
        for (uint32_t i = 0; i < entriesArr.Length(); ++i) {
            auto ev = entriesArr.Get(i);
            if (!ev.IsObject()) throw std::runtime_error("serializeStf: entries[] entries must be objects");
            auto eobj = ev.As<Napi::Object>();
            swg_core::formats::StfEntry entry;
            entry.id = eobj.Get("id").As<Napi::Number>().Uint32Value();
            entry.sourceCrc = eobj.Get("sourceCrc").As<Napi::Number>().Uint32Value();
            entry.text = jsStringToU16(eobj.Get("text").As<Napi::String>());
            table.byId.push_back(std::move(entry));
        }

        if (!tableObj.Has("nameMap") || !tableObj.Get("nameMap").IsArray())
            throw std::runtime_error("serializeStf: table.nameMap must be an array");
        auto nameMapArr = tableObj.Get("nameMap").As<Napi::Array>();
        table.nameToId.reserve(nameMapArr.Length());
        for (uint32_t i = 0; i < nameMapArr.Length(); ++i) {
            auto nv = nameMapArr.Get(i);
            if (!nv.IsObject()) throw std::runtime_error("serializeStf: nameMap[] entries must be objects");
            auto nobj = nv.As<Napi::Object>();
            std::string name = nobj.Get("name").As<Napi::String>().Utf8Value();
            uint32_t id = nobj.Get("id").As<Napi::Number>().Uint32Value();
            table.nameToId.emplace_back(std::move(name), id);
        }

        serialized = swg_core::formats::serializeStf(table);
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("serializeStf error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("serializeStf internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto ab = Napi::ArrayBuffer::New(env, serialized.size());
    if (!serialized.empty()) {
        std::memcpy(ab.Data(), serialized.data(), serialized.size());
    }
    return ab;
}
