/**
 * mesh_binding.cpp — Thin N-API binding for mesh + support format parsers.
 *
 * Wires the engine-free format parsers into the N-API addon.
 * This file is a THIN BINDING LAYER ONLY — no parse logic here (Decision D-02).
 *
 * Exports (registered in addon.cpp):
 *   parseMesh(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> MeshBindingResult + geometry ArrayBuffer
 *   parseMeshLod(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> MeshLodBindingResult
 *   parseLodDistanceTable(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> LodDistanceTableBindingResult
 *   parseShader(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> ShaderBindingResult
 *   parsePalette(bytes: ArrayBuffer|Uint8Array) -> PaletteBindingResult
 *   parseDds(bytes: ArrayBuffer|Uint8Array) -> DdsBindingResult
 *
 * Return contract:
 *   - Struct / metadata crosses as JS objects (numbers, strings, booleans, arrays).
 *   - Geometry binary (positions, normals, uvs, indices) crosses as ArrayBuffer (never JSON).
 *   - .pal and .dds round-trip bytes cross as ArrayBuffer (PARSER-NATIVE serialize is identity).
 *
 * Source (binding pattern): packages/native-core/src/iff_binding.cpp (extractBytes + two-tier catch).
 * Source (parse logic): modules/core/formats/*.h / *.cpp.
 *
 * Decision D-02: This file includes no swg-client-v2 / SOE engine headers.
 */

#include <napi.h>
#include <cstring>
#include <stdexcept>
#include <vector>

// Engine-free parser headers
#include "iff/Iff.h"
#include "formats/Mesh.h"
#include "formats/MeshLod.h"
#include "formats/LodDistanceTable.h"
#include "formats/Shader.h"
#include "formats/Palette.h"
#include "formats/Dds.h"

// ─── Helpers (shared with iff_binding.cpp; duplicated to keep files independent) ────

static std::pair<const uint8_t*, size_t>
extractBytes(const Napi::Value& val, Napi::Env env, const char* argName) {
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

// Reconstruct IffParseResult from JS iffResult object (minimal — only need roots[0])
static swg_core::iff::IffNode jsToIffNode(const Napi::Object& obj,
                                            const uint8_t* srcBuf, uint32_t srcSize);

static swg_core::iff::IffNode jsToIffNode(const Napi::Object& obj,
                                            const uint8_t* srcBuf, uint32_t srcSize)
{
    swg_core::iff::IffNode node;

    auto tagStr = obj.Get("tag").As<Napi::String>().Utf8Value();
    std::strncpy(node.tag, tagStr.c_str(), 4);
    node.tag[4] = '\0';

    auto kindStr = obj.Get("kind").As<Napi::String>().Utf8Value();
    node.isForm = (kindStr == "form");
    node.declaredLength = obj.Get("length").As<Napi::Number>().Uint32Value();
    node.byteOffset     = obj.Get("byteOffset").As<Napi::Number>().Uint32Value();
    node.isClean = true;

    // Re-populate capturedSlice
    uint32_t sliceEnd = node.byteOffset + 8 + node.declaredLength;
    if (srcBuf && sliceEnd <= srcSize) {
        node.capturedSlice.assign(srcBuf + node.byteOffset, srcBuf + sliceEnd);
    }

    if (node.isForm) {
        if (obj.Has("subType")) {
            auto stStr = obj.Get("subType").As<Napi::String>().Utf8Value();
            std::strncpy(node.subType, stStr.c_str(), 4);
            node.subType[4] = '\0';
        }
        if (obj.Has("children") && obj.Get("children").IsArray()) {
            auto arr = obj.Get("children").As<Napi::Array>();
            for (uint32_t i = 0; i < arr.Length(); ++i) {
                auto childVal = arr.Get(i);
                if (childVal.IsObject()) {
                    node.children.push_back(
                        jsToIffNode(childVal.As<Napi::Object>(), srcBuf, srcSize));
                }
            }
        }
    }
    return node;
}

static swg_core::iff::IffNode extractRootNode(const Napi::Object& iffResult,
                                               const uint8_t* srcData, uint32_t srcSize)
{
    if (!iffResult.Has("roots") || !iffResult.Get("roots").IsArray()) {
        throw std::runtime_error("iffResult: missing 'roots' array");
    }
    auto roots = iffResult.Get("roots").As<Napi::Array>();
    if (roots.Length() == 0) {
        throw std::runtime_error("iffResult: 'roots' array is empty");
    }
    auto rv = roots.Get(0u);
    if (!rv.IsObject()) throw std::runtime_error("iffResult: roots[0] is not an object");
    return jsToIffNode(rv.As<Napi::Object>(), srcData, srcSize);
}

// ─── Attribute slice helpers ──────────────────────────────────────────────────

static Napi::Object sliceToJs(Napi::Env env, const swg_core::formats::MeshAttributeSlice& s) {
    auto obj = Napi::Object::New(env);
    obj.Set("offset",         Napi::Number::New(env, s.offset));
    obj.Set("byteLength",     Napi::Number::New(env, s.byteLength));
    obj.Set("componentCount", Napi::Number::New(env, s.componentCount));
    obj.Set("elementCount",   Napi::Number::New(env, s.elementCount));
    return obj;
}

// ─── ParseMesh ───────────────────────────────────────────────────────────────

/**
 * parseMesh(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> {
 *   formatTag: string,
 *   version: string,
 *   shaderGroups: Array<{
 *     shaderName, vertexCount, indexCount,
 *     positions, normals, uvs, indices, skinIndices, skinWeights (all MeshAttributeSlice),
 *     hasDot3
 *   }>,
 *   geometry: ArrayBuffer,  // packed binary attribute data
 *   weightsTruncated: number
 * }
 */
Napi::Value ParseMesh(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseMesh: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseMesh srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::MeshResult meshResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        meshResult = swg_core::formats::parseMesh(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseMesh error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseMesh internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag", Napi::String::New(env, meshResult.formatTag));
    result.Set("version",   Napi::String::New(env, meshResult.version));
    result.Set("weightsTruncated", Napi::Number::New(env, meshResult.weightsTruncated));

    // shaderGroups
    auto groups = Napi::Array::New(env, meshResult.shaderGroups.size());
    for (size_t i = 0; i < meshResult.shaderGroups.size(); ++i) {
        const auto& grp = meshResult.shaderGroups[i];
        auto gobj = Napi::Object::New(env);
        gobj.Set("shaderName",   Napi::String::New(env, grp.shaderName));
        gobj.Set("vertexCount",  Napi::Number::New(env, grp.vertexCount));
        gobj.Set("indexCount",   Napi::Number::New(env, grp.indexCount));
        gobj.Set("positions",    sliceToJs(env, grp.positions));
        gobj.Set("normals",      sliceToJs(env, grp.normals));
        gobj.Set("uvs",          sliceToJs(env, grp.uvs));
        gobj.Set("indices",      sliceToJs(env, grp.indices));
        gobj.Set("skinIndices",  sliceToJs(env, grp.skinIndices));
        gobj.Set("skinWeights",  sliceToJs(env, grp.skinWeights));
        gobj.Set("hasDot3",      Napi::Boolean::New(env, grp.hasDot3));
        groups.Set(static_cast<uint32_t>(i), gobj);
    }
    result.Set("shaderGroups", groups);

    // geometry: packed binary buffer as ArrayBuffer (NEVER as JSON)
    auto geomAb = Napi::ArrayBuffer::New(env, meshResult.geometry.size());
    if (!meshResult.geometry.empty()) {
        std::memcpy(geomAb.Data(), meshResult.geometry.data(), meshResult.geometry.size());
    }
    result.Set("geometry", geomAb);

    return result;
}

// ─── ParseMeshLod ────────────────────────────────────────────────────────────

Napi::Value ParseMeshLod(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseMeshLod: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseMeshLod srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::MeshLodResult lodResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        lodResult = swg_core::formats::parseMeshLod(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseMeshLod error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseMeshLod internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag",   Napi::String::New(env, lodResult.formatTag));
    result.Set("version",     Napi::String::New(env, lodResult.version));
    result.Set("levelCount",  Napi::Number::New(env, lodResult.levelCount));

    auto levels = Napi::Array::New(env, lodResult.levels.size());
    for (size_t i = 0; i < lodResult.levels.size(); ++i) {
        auto lobj = Napi::Object::New(env);
        lobj.Set("path", Napi::String::New(env, lodResult.levels[i].path));
        levels.Set(static_cast<uint32_t>(i), lobj);
    }
    result.Set("levels", levels);

    return result;
}

// ─── ParseLodDistanceTable ────────────────────────────────────────────────────

Napi::Value ParseLodDistanceTable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseLodDistanceTable: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseLodDistanceTable srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::LodDistanceTableResult ldtResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        ldtResult = swg_core::formats::parseLodDistanceTable(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseLodDistanceTable error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseLodDistanceTable internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag",   Napi::String::New(env, ldtResult.formatTag));
    result.Set("version",     Napi::String::New(env, ldtResult.version));
    result.Set("levelCount",  Napi::Number::New(env, ldtResult.levelCount));

    auto levels = Napi::Array::New(env, ldtResult.levels.size());
    for (size_t i = 0; i < ldtResult.levels.size(); ++i) {
        auto lobj = Napi::Object::New(env);
        lobj.Set("minDist", Napi::Number::New(env, ldtResult.levels[i].minDist));
        lobj.Set("maxDist", Napi::Number::New(env, ldtResult.levels[i].maxDist));
        levels.Set(static_cast<uint32_t>(i), lobj);
    }
    result.Set("levels", levels);

    return result;
}

// ─── ParseShader ─────────────────────────────────────────────────────────────

Napi::Value ParseShader(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseShader: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseShader srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::ShaderResult shaderResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        shaderResult = swg_core::formats::parseShader(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseShader error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseShader internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("variant",    Napi::String::New(env, shaderResult.variant));
    result.Set("version",    Napi::String::New(env, shaderResult.version));
    result.Set("effectPath", Napi::String::New(env, shaderResult.effectPath));

    // slots
    auto slots = Napi::Array::New(env, shaderResult.slots.size());
    for (size_t i = 0; i < shaderResult.slots.size(); ++i) {
        const auto& s = shaderResult.slots[i];
        auto sobj = Napi::Object::New(env);
        sobj.Set("slotTag",       Napi::String::New(env, s.slotTag));
        sobj.Set("texturePath",   Napi::String::New(env, s.texturePath));
        sobj.Set("uvSet",         Napi::Number::New(env, s.uvSet));
        sobj.Set("isPlaceholder", Napi::Boolean::New(env, s.isPlaceholder));
        slots.Set(static_cast<uint32_t>(i), sobj);
    }
    result.Set("slots", slots);

    // customizationVars (empty for MVP)
    result.Set("customizationVars", Napi::Array::New(env, 0));

    return result;
}

// ─── ParsePalette ─────────────────────────────────────────────────────────────

Napi::Value ParsePalette(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "parsePalette: (bytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [data, size] = extractBytes(info[0], env, "parsePalette bytes");
    if (!data) return env.Undefined();

    swg_core::formats::PaletteResult paletteResult;
    try {
        paletteResult = swg_core::formats::parsePalette(data, static_cast<uint32_t>(size));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parsePalette error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parsePalette internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("entryCount", Napi::Number::New(env, paletteResult.entryCount));
    result.Set("versionOrComponentCount", Napi::Number::New(env, paletteResult.versionOrComponentCount));

    auto entries = Napi::Array::New(env, paletteResult.entries.size());
    for (size_t i = 0; i < paletteResult.entries.size(); ++i) {
        const auto& e = paletteResult.entries[i];
        auto eobj = Napi::Object::New(env);
        eobj.Set("r", Napi::Number::New(env, e.r));
        eobj.Set("g", Napi::Number::New(env, e.g));
        eobj.Set("b", Napi::Number::New(env, e.b));
        eobj.Set("a", Napi::Number::New(env, e.a));
        entries.Set(static_cast<uint32_t>(i), eobj);
    }
    result.Set("entries", entries);

    // Round-trip bytes for PARSER-NATIVE
    auto serialized = swg_core::formats::serializePalette(paletteResult);
    auto ab = Napi::ArrayBuffer::New(env, serialized.size());
    if (!serialized.empty()) {
        std::memcpy(ab.Data(), serialized.data(), serialized.size());
    }
    result.Set("roundTripBytes", ab);

    return result;
}

// ─── ParseDds ────────────────────────────────────────────────────────────────

Napi::Value ParseDds(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "parseDds: (bytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [data, size] = extractBytes(info[0], env, "parseDds bytes");
    if (!data) return env.Undefined();

    swg_core::formats::DdsResult ddsResult;
    try {
        ddsResult = swg_core::formats::parseDds(data, static_cast<uint32_t>(size));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseDds error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseDds internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("width",      Napi::Number::New(env, ddsResult.width));
    result.Set("height",     Napi::Number::New(env, ddsResult.height));
    result.Set("mipCount",   Napi::Number::New(env, ddsResult.mipCount));
    result.Set("format",     Napi::String::New(env, ddsResult.formatName));

    auto mips = Napi::Array::New(env, ddsResult.mips.size());
    for (size_t i = 0; i < ddsResult.mips.size(); ++i) {
        const auto& m = ddsResult.mips[i];
        auto mobj = Napi::Object::New(env);
        mobj.Set("offset",     Napi::Number::New(env, m.offset));
        mobj.Set("byteLength", Napi::Number::New(env, m.byteLength));
        mobj.Set("width",      Napi::Number::New(env, m.width));
        mobj.Set("height",     Napi::Number::New(env, m.height));
        mips.Set(static_cast<uint32_t>(i), mobj);
    }
    result.Set("mips", mips);

    // Round-trip bytes for PARSER-NATIVE (identity for DDS)
    auto serialized = swg_core::formats::serializeDds(ddsResult);
    auto ab = Napi::ArrayBuffer::New(env, serialized.size());
    if (!serialized.empty()) {
        std::memcpy(ab.Data(), serialized.data(), serialized.size());
    }
    result.Set("roundTripBytes", ab);

    return result;
}
