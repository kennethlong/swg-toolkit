/**
 * anim_binding.cpp — Thin N-API binding for the .ans animation parser.
 *
 * Wires parseAnimation() from modules/core/formats/Animation.h into the N-API addon.
 * This file is a THIN BINDING LAYER ONLY — no parse logic here (Decision D-02).
 *
 * Exports (registered in addon.cpp):
 *   parseAnimation(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> AnimationBindingResult
 *
 * Return contract:
 *   - variant, fps, frameCount, joints[]  — typed JSON (metadata)
 *   - keyframes                           — sparse keyframe ArrayBuffer (binary-stays-binary)
 *   - channelTable                        — per-channel byte offsets + key counts (typed JSON)
 *   - roundTrip                           — { passed: boolean, failOffset?: number }
 *
 * Source pattern: mesh_binding.cpp (extractBytes + jsToIffNode + try/catch).
 *
 * Decision D-02: No parse logic here; no SOE engine headers.
 */

#include <napi.h>
#include <cstring>
#include <stdexcept>

#include "iff/Iff.h"
#include "formats/Animation.h"

// ─── extractBytes (copy from mesh_binding.cpp pattern) ───────────────────────

static std::pair<const uint8_t*, size_t>
extractBytesAnim(const Napi::Value& val, Napi::Env env, const char* argName) {
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

// ─── jsToIffNode (mirrors mesh_binding.cpp verbatim) ─────────────────────────

static swg_core::iff::IffNode jsToIffNodeAnim(const Napi::Object& obj,
                                               const uint8_t* srcBuf, uint32_t srcSize);

static swg_core::iff::IffNode jsToIffNodeAnim(const Napi::Object& obj,
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
                        jsToIffNodeAnim(childVal.As<Napi::Object>(), srcBuf, srcSize));
                }
            }
        }
    }
    return node;
}

static swg_core::iff::IffNode extractRootNodeAnim(const Napi::Object& iffResult,
                                                    const uint8_t* srcData, uint32_t srcSize)
{
    if (!iffResult.Has("roots") || !iffResult.Get("roots").IsArray())
        throw std::runtime_error("iffResult: missing 'roots' array");
    auto roots = iffResult.Get("roots").As<Napi::Array>();
    if (roots.Length() == 0)
        throw std::runtime_error("iffResult: 'roots' array is empty");
    auto rv = roots.Get(0u);
    if (!rv.IsObject()) throw std::runtime_error("iffResult: roots[0] is not an object");
    return jsToIffNodeAnim(rv.As<Napi::Object>(), srcData, srcSize);
}

// ─── variant string helper ────────────────────────────────────────────────────

static const char* variantString(swg_core::formats::AnimationVariant v) {
    switch (v) {
        case swg_core::formats::AnimationVariant::CKAT_0001:           return "CKAT-0001";
        case swg_core::formats::AnimationVariant::KFAT_0003:           return "KFAT-0003";
        case swg_core::formats::AnimationVariant::KFAT_0002_UNSUPPORTED: return "KFAT-0002-unsupported";
        default: return "unknown";
    }
}

// ─── ParseAnimation ──────────────────────────────────────────────────────────

/**
 * parseAnimation(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> {
 *   variant: 'CKAT-0001' | 'KFAT-0003' | 'KFAT-0002-unsupported',
 *   fps: number,
 *   frameCount: number,
 *   joints: Array<{
 *     name: string,
 *     hasAnimatedRotation: boolean,
 *     rotationChannelIndex: number,
 *     translationMask: number,
 *     translationChannelIndex: [number, number, number]
 *   }>,
 *   keyframes: ArrayBuffer,     // sparse binary keyframe data
 *   channelTable: {
 *     rotationChannels: Array<{ byteOffset: number, keyCount: number }>,
 *     staticRotByteOffset: number,
 *     staticRotationCount: number,
 *     translationChannels: Array<{ byteOffset: number, keyCount: number }>,
 *     staticTransByteOffset: number,
 *     staticTranslationCount: number
 *   },
 *   roundTrip: { passed: boolean, failOffset?: number }
 * }
 */
Napi::Value ParseAnimation(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env,
            "parseAnimation: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytesAnim(info[1], env, "parseAnimation srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::AnimationResult animResult;

    try {
        root = extractRootNodeAnim(info[0].As<Napi::Object>(), srcData,
                                   static_cast<uint32_t>(srcSize));
        animResult = swg_core::formats::parseAnimation(
            root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::AnimationParseError& e) {
        Napi::Error::New(env, std::string("parseAnimation error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseAnimation internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("variant",    Napi::String::New(env, variantString(animResult.variant)));
    result.Set("fps",        Napi::Number::New(env, animResult.fps));
    result.Set("frameCount", Napi::Number::New(env, animResult.frameCount));

    // joints array
    auto jointsArr = Napi::Array::New(env, animResult.joints.size());
    for (size_t i = 0; i < animResult.joints.size(); ++i) {
        const auto& j = animResult.joints[i];
        auto jobj = Napi::Object::New(env);
        jobj.Set("name",                 Napi::String::New(env, j.name));
        jobj.Set("hasAnimatedRotation",  Napi::Boolean::New(env, j.hasAnimatedRotation));
        jobj.Set("rotationChannelIndex", Napi::Number::New(env, j.rotationChannelIndex));
        jobj.Set("translationMask",      Napi::Number::New(env, j.translationMask));

        auto tcArr = Napi::Array::New(env, 3);
        tcArr.Set(0u, Napi::Number::New(env, j.xTransChannelIndex));
        tcArr.Set(1u, Napi::Number::New(env, j.yTransChannelIndex));
        tcArr.Set(2u, Napi::Number::New(env, j.zTransChannelIndex));
        jobj.Set("translationChannelIndex", tcArr);

        jointsArr.Set(static_cast<uint32_t>(i), jobj);
    }
    result.Set("joints", jointsArr);

    // keyframes: sparse ArrayBuffer
    {
        auto& kfBuf = animResult.keyframeBuffer;
        auto ab = Napi::ArrayBuffer::New(env, kfBuf.size());
        if (!kfBuf.empty())
            std::memcpy(ab.Data(), kfBuf.data(), kfBuf.size());
        result.Set("keyframes", ab);
    }

    // channelTable: per-channel byte offsets + key counts
    {
        auto ctObj = Napi::Object::New(env);

        auto rotArr = Napi::Array::New(env, animResult.rotChannelHeaders.size());
        for (size_t i = 0; i < animResult.rotChannelHeaders.size(); ++i) {
            const auto& h = animResult.rotChannelHeaders[i];
            auto hobj = Napi::Object::New(env);
            hobj.Set("byteOffset", Napi::Number::New(env, h.byteOffset));
            hobj.Set("keyCount",   Napi::Number::New(env, h.keyCount));
            rotArr.Set(static_cast<uint32_t>(i), hobj);
        }
        ctObj.Set("rotationChannels",      rotArr);
        ctObj.Set("staticRotByteOffset",   Napi::Number::New(env, animResult.staticRotByteOffset));
        ctObj.Set("staticRotationCount",   Napi::Number::New(env, animResult.staticRotationCount));

        auto transArr = Napi::Array::New(env, animResult.transChannelHeaders.size());
        for (size_t i = 0; i < animResult.transChannelHeaders.size(); ++i) {
            const auto& h = animResult.transChannelHeaders[i];
            auto hobj = Napi::Object::New(env);
            hobj.Set("byteOffset", Napi::Number::New(env, h.byteOffset));
            hobj.Set("keyCount",   Napi::Number::New(env, h.keyCount));
            transArr.Set(static_cast<uint32_t>(i), hobj);
        }
        ctObj.Set("translationChannels",   transArr);
        ctObj.Set("staticTransByteOffset", Napi::Number::New(env, animResult.staticTransByteOffset));
        ctObj.Set("staticTranslationCount",Napi::Number::New(env, animResult.staticTranslationCount));

        result.Set("channelTable", ctObj);
    }

    // roundTrip
    {
        auto rtObj = Napi::Object::New(env);
        rtObj.Set("passed", Napi::Boolean::New(env, animResult.roundTripPassed));
        if (!animResult.roundTripPassed)
            rtObj.Set("failOffset", Napi::Number::New(env, animResult.roundTripFailOffset));
        result.Set("roundTrip", rtObj);
    }

    return result;
}
