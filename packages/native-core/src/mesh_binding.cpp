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
#include "formats/SkeletalMeshGen.h"
#include "formats/Skeleton.h"
#include "formats/SkeletalAppearance.h"
#include "formats/StaticAppearance.h"
#include "formats/DetailAppearance.h"
#include "formats/Effect.h"

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
        // JS key is "slot" to match the contract (ShaderSlot.slot in @swg/contracts).
        // The C++ struct member is still slotTag; only the bridge key name is aligned.
        sobj.Set("slot",          Napi::String::New(env, s.slotTag));
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
    result.Set("isCubemap",  Napi::Boolean::New(env, ddsResult.isCubemap));

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

// ─── ParseSkeletalMesh ────────────────────────────────────────────────────────

/**
 * parseSkeletalMesh(iffResult: object, srcBytes: ArrayBuffer|Uint8Array, boneOrder?: string[]) -> {
 *   formatTag: string,
 *   version: string,
 *   shaderGroups: Array<...MeshShaderGroupResult with skinIndices/skinWeights>,
 *   geometry: ArrayBuffer,
 *   boneNames: string[],
 *   sktmNames: string[],
 *   weightsTruncated: number,
 *   needsBoneRemap: boolean
 * }
 *
 * Phase 2 Plan 02-02 T-02-06/T-02-07 security:
 *   - positionCount/perShaderDataCount capped in SkeletalMeshGen.cpp
 *   - PIDX/NIDX OOB -> FormatParseError (T-02-07)
 */
Napi::Value ParseSkeletalMesh(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseSkeletalMesh: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array, boneOrder?: string[]) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseSkeletalMesh srcBytes");
    if (!srcData) return env.Undefined();

    // Optional boneOrder parameter
    std::vector<std::string> boneOrder;
    if (info.Length() >= 3 && info[2].IsArray()) {
        auto arr = info[2].As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            auto v = arr.Get(i);
            if (v.IsString()) boneOrder.push_back(v.As<Napi::String>().Utf8Value());
        }
    }

    swg_core::iff::IffNode root;
    swg_core::formats::SkeletalMeshResult meshResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        meshResult = swg_core::formats::parseSkeletalMesh(root, srcData, static_cast<uint32_t>(srcSize), boneOrder);
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseSkeletalMesh error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseSkeletalMesh internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag",         Napi::String::New(env, meshResult.formatTag));
    result.Set("version",           Napi::String::New(env, meshResult.version));
    result.Set("weightsTruncated",  Napi::Number::New(env, meshResult.weightsTruncated));
    result.Set("needsBoneRemap",    Napi::Boolean::New(env, meshResult.needsBoneRemap));

    // boneNames (XFNM)
    auto boneNamesArr = Napi::Array::New(env, meshResult.boneNames.size());
    for (size_t i = 0; i < meshResult.boneNames.size(); ++i) {
        boneNamesArr.Set(static_cast<uint32_t>(i), Napi::String::New(env, meshResult.boneNames[i]));
    }
    result.Set("boneNames", boneNamesArr);

    // sktmNames
    auto sktmNamesArr = Napi::Array::New(env, meshResult.sktmNames.size());
    for (size_t i = 0; i < meshResult.sktmNames.size(); ++i) {
        sktmNamesArr.Set(static_cast<uint32_t>(i), Napi::String::New(env, meshResult.sktmNames[i]));
    }
    result.Set("sktmNames", sktmNamesArr);

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

    // geometry: packed binary buffer (NEVER JSON)
    auto geomAb = Napi::ArrayBuffer::New(env, meshResult.geometry.size());
    if (!meshResult.geometry.empty()) {
        std::memcpy(geomAb.Data(), meshResult.geometry.data(), meshResult.geometry.size());
    }
    result.Set("geometry", geomAb);

    return result;
}

// ─── ParseSkeleton ────────────────────────────────────────────────────────────

/**
 * parseSkeleton(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> {
 *   formatTag: string,
 *   version: string,
 *   boneNames: string[],
 *   bones: Array<{ name, parentIndex, preRot[4], postRot[4], bindPos[3], preRotOff[3] }>
 * }
 *
 * Throws if root is FORM SLOD (not FORM SKTM) -- delta #7.
 */
Napi::Value ParseSkeleton(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseSkeleton: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseSkeleton srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::SkeletonResult skelResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        skelResult = swg_core::formats::parseSkeleton(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseSkeleton error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseSkeleton internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag", Napi::String::New(env, skelResult.formatTag));
    result.Set("version",   Napi::String::New(env, skelResult.version));

    auto boneNamesArr = Napi::Array::New(env, skelResult.boneNames.size());
    for (size_t i = 0; i < skelResult.boneNames.size(); ++i) {
        boneNamesArr.Set(static_cast<uint32_t>(i), Napi::String::New(env, skelResult.boneNames[i]));
    }
    result.Set("boneNames", boneNamesArr);

    auto bonesArr = Napi::Array::New(env, skelResult.bones.size());
    for (size_t i = 0; i < skelResult.bones.size(); ++i) {
        const auto& b = skelResult.bones[i];
        auto bobj = Napi::Object::New(env);
        bobj.Set("name",        Napi::String::New(env, b.name));
        bobj.Set("parentIndex", Napi::Number::New(env, b.parentIndex));

        auto preRot  = Napi::Array::New(env, 4);
        auto postRot = Napi::Array::New(env, 4);
        auto bindPos = Napi::Array::New(env, 3);
        auto preOff  = Napi::Array::New(env, 3);
        for (int k = 0; k < 4; ++k) {
            preRot.Set(static_cast<uint32_t>(k),  Napi::Number::New(env, b.preRot[k]));
            postRot.Set(static_cast<uint32_t>(k), Napi::Number::New(env, b.postRot[k]));
        }
        for (int k = 0; k < 3; ++k) {
            bindPos.Set(static_cast<uint32_t>(k), Napi::Number::New(env, b.bindPos[k]));
            preOff.Set(static_cast<uint32_t>(k),  Napi::Number::New(env, b.preRotOff[k]));
        }
        bobj.Set("preRot",    preRot);
        bobj.Set("postRot",   postRot);
        bobj.Set("bindPos",   bindPos);
        bobj.Set("preRotOff", preOff);
        bonesArr.Set(static_cast<uint32_t>(i), bobj);
    }
    result.Set("bones", bonesArr);

    return result;
}

// ─── ParseSkeletalAppearance ──────────────────────────────────────────────────

/**
 * parseSkeletalAppearance(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> {
 *   formatTag: string,
 *   version: string,
 *   filename: string,
 *   meshPaths: string[],
 *   skeletonRefs: Array<{ skeletonPath: string, attachmentTransformName: string }>
 * }
 */
Napi::Value ParseSkeletalAppearance(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseSkeletalAppearance: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseSkeletalAppearance srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::SkeletalAppearanceResult satResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        satResult = swg_core::formats::parseSkeletalAppearance(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseSkeletalAppearance error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseSkeletalAppearance internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag", Napi::String::New(env, satResult.formatTag));
    result.Set("version",   Napi::String::New(env, satResult.version));
    result.Set("filename",  Napi::String::New(env, satResult.filename));

    auto meshPathsArr = Napi::Array::New(env, satResult.meshPaths.size());
    for (size_t i = 0; i < satResult.meshPaths.size(); ++i) {
        meshPathsArr.Set(static_cast<uint32_t>(i), Napi::String::New(env, satResult.meshPaths[i]));
    }
    result.Set("meshPaths", meshPathsArr);

    auto sktRefsArr = Napi::Array::New(env, satResult.skeletonRefs.size());
    for (size_t i = 0; i < satResult.skeletonRefs.size(); ++i) {
        const auto& ref = satResult.skeletonRefs[i];
        auto robj = Napi::Object::New(env);
        robj.Set("skeletonPath",            Napi::String::New(env, ref.skeletonPath));
        robj.Set("attachmentTransformName", Napi::String::New(env, ref.attachmentTransformName));
        sktRefsArr.Set(static_cast<uint32_t>(i), robj);
    }
    result.Set("skeletonRefs", sktRefsArr);

    return result;
}

// ─── ParseStaticAppearance ────────────────────────────────────────────────────

/**
 * parseStaticAppearance(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> {
 *   formatTag: string,
 *   redirectTarget: string
 * }
 *
 * Throws FormatParseError if redirectTarget ends with ".apt" (T-02-08).
 */
Napi::Value ParseStaticAppearance(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseStaticAppearance: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseStaticAppearance srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::StaticAppearanceResult aptResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        aptResult = swg_core::formats::parseStaticAppearance(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseStaticAppearance error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseStaticAppearance internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag",      Napi::String::New(env, aptResult.formatTag));
    result.Set("redirectTarget", Napi::String::New(env, aptResult.redirectTarget));

    return result;
}

// ─── ParseDetailAppearance ────────────────────────────────────────────────────

/**
 * parseDetailAppearance(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> {
 *   formatTag: string,        // 'DTLA'
 *   versionTag: string,       // '0001'..'0008'
 *   lodFlags: number,         // uint8 from PIVT (0 if version < 6)
 *   levels: Array<{
 *     id: number,             // int32 from INFO
 *     near: number,           // float32 nearDistance
 *     far: number,            // float32 farDistance
 *     childPath: string       // raw name from CHLD (e.g. "mesh/foo.msh") — caller prepends "appearance/"
 *   }>
 * }
 *
 * Source: DetailAppearanceTemplate.cpp:556-658 (load()) and :343-417 (loadEntries()).
 * Verified 2026-06-24 against wb_02_09e_00000000000000000000.lod (362 bytes).
 */
Napi::Value ParseDetailAppearance(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseDetailAppearance: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseDetailAppearance srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::DetailAppearanceResult dtlaResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        dtlaResult = swg_core::formats::parseDetailAppearance(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseDetailAppearance error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseDetailAppearance internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag",   Napi::String::New(env, dtlaResult.formatTag));
    result.Set("versionTag",  Napi::String::New(env, dtlaResult.versionTag));
    result.Set("lodFlags",    Napi::Number::New(env, dtlaResult.lodFlags));

    auto levels = Napi::Array::New(env, dtlaResult.levels.size());
    for (size_t i = 0; i < dtlaResult.levels.size(); ++i) {
        const auto& lv = dtlaResult.levels[i];
        auto lobj = Napi::Object::New(env);
        lobj.Set("id",        Napi::Number::New(env, lv.id));
        lobj.Set("near",      Napi::Number::New(env, lv.near));
        lobj.Set("far",       Napi::Number::New(env, lv.far));
        lobj.Set("childPath", Napi::String::New(env, lv.childPath));
        levels.Set(static_cast<uint32_t>(i), lobj);
    }
    result.Set("levels", levels);

    return result;
}

// ─── ParseEffect ─────────────────────────────────────────────────────────────

/**
 * parseEffect(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> {
 *   formatTag: string,       // 'EFCT'
 *   version: string,         // '0000' or '0001'
 *   bestImplIndex: number,   // index of selected IMPL (-1 if none)
 *   impls: Array<{
 *     scapValues: number[],
 *     options: string[],
 *     blend: { alphaBlendEnable, blendOperation, blendSrc, blendDst,
 *              alphaTestEnable, alphaTestFunc, alphaTestRef, zWrite },
 *     samplers: Array<{ index: number, role: string }>,
 *   }>
 * }
 *
 * Phase 2 Plan 02-03 gap-closure: .eft effect parser.
 * Source: modules/core/formats/Effect.h
 *   swg-client-v2 ShaderEffect.cpp:86-179
 *   swg-client-v2 ShaderImplementation.cpp:1692-1738, 2600-2651, 3113-3181
 */
Napi::Value ParseEffect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseEffect: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "parseEffect srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::EffectResult effectResult;

    try {
        root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        effectResult = swg_core::formats::parseEffect(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseEffect error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseEffect internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag",     Napi::String::New(env, effectResult.formatTag));
    result.Set("version",       Napi::String::New(env, effectResult.version));
    result.Set("bestImplIndex", Napi::Number::New(env, effectResult.bestImplIndex));

    auto implsArr = Napi::Array::New(env, effectResult.impls.size());
    for (size_t i = 0; i < effectResult.impls.size(); ++i) {
        const auto& impl = effectResult.impls[i];
        auto iobj = Napi::Object::New(env);

        auto scapArr = Napi::Array::New(env, impl.scapValues.size());
        for (size_t j = 0; j < impl.scapValues.size(); ++j)
            scapArr.Set(static_cast<uint32_t>(j), Napi::Number::New(env, impl.scapValues[j]));
        iobj.Set("scapValues", scapArr);

        auto optsArr = Napi::Array::New(env, impl.options.size());
        for (size_t j = 0; j < impl.options.size(); ++j)
            optsArr.Set(static_cast<uint32_t>(j), Napi::String::New(env, impl.options[j]));
        iobj.Set("options", optsArr);

        auto blendObj = Napi::Object::New(env);
        blendObj.Set("alphaBlendEnable",  Napi::Boolean::New(env, impl.blend.alphaBlendEnable));
        blendObj.Set("blendOperation",    Napi::Number::New(env, impl.blend.blendOperation));
        blendObj.Set("blendSrc",          Napi::Number::New(env, impl.blend.blendSrc));
        blendObj.Set("blendDst",          Napi::Number::New(env, impl.blend.blendDst));
        blendObj.Set("alphaTestEnable",   Napi::Boolean::New(env, impl.blend.alphaTestEnable));
        blendObj.Set("alphaTestFunc",     Napi::Number::New(env, impl.blend.alphaTestFunc));
        blendObj.Set("alphaTestRef",      Napi::Number::New(env, impl.blend.alphaTestRef));
        blendObj.Set("zWrite",            Napi::Boolean::New(env, impl.blend.zWrite));
        iobj.Set("blend", blendObj);

        auto samplersArr = Napi::Array::New(env, impl.samplers.size());
        for (size_t j = 0; j < impl.samplers.size(); ++j) {
            const auto& s = impl.samplers[j];
            auto sobj = Napi::Object::New(env);
            sobj.Set("index", Napi::Number::New(env, s.index));
            sobj.Set("role",  Napi::String::New(env, s.role));
            samplersArr.Set(static_cast<uint32_t>(j), sobj);
        }
        iobj.Set("samplers", samplersArr);

        implsArr.Set(static_cast<uint32_t>(i), iobj);
    }
    result.Set("impls", implsArr);

    return result;
}
