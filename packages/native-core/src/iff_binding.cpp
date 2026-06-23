/**
 * iff_binding.cpp — Thin N-API binding for the IFF FORM/chunk parser/serializer.
 *
 * Wires the engine-free swg_core::iff library into the N-API addon.
 * This file is a THIN BINDING LAYER ONLY — no parse logic here (Decision D-02).
 *
 * Exports (registered in addon.cpp):
 *   parseIff(bytes: ArrayBuffer|Uint8Array) -> IffParseResultJson
 *   serializeIff(parseResult: IffParseResultJson, srcBytes: ArrayBuffer|Uint8Array) -> ArrayBuffer
 *   getChunkBytes(parseResult: IffParseResultJson, srcBytes: ArrayBuffer|Uint8Array, nodeIndex: number) -> ArrayBuffer
 *
 * Return contract:
 *   - Structure (IffNode tree, trailing info, round-trip status) crosses as typed JSON.
 *   - Binary payloads (getChunkBytes, serializeIff output) cross as zero-copy ArrayBuffer.
 *   - NEVER return binary as JSON (AGENTS.md zero-copy rule).
 *
 * Source (binding pattern): packages/native-core/src/sab-rw.cpp:29-67
 *   (argument-count guard → type guard → bounds check → extract → call → return).
 * Source (IFF logic): modules/core/iff/Iff.h / Iff.cpp.
 *
 * Decision D-02: This file includes no swg-client-v2 / SOE engine headers.
 *   It links against swg_core (the engine-free static lib) via CMakeLists.txt.
 */

#include <napi.h>
#include "iff/Iff.h"

#include <cstring>
#include <stdexcept>

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a pointer + size from a JS value that is either an ArrayBuffer or a Uint8Array.
 * Returns {nullptr, 0} with a TypeError thrown if the type is wrong.
 *
 * Source: sab-rw.cpp:29-67 (validate → extract pattern).
 */
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

// ─── IffNode → Napi::Object ─────────────────────────────────────────────────────

static Napi::Object nodeToJs(Napi::Env env, const swg_core::iff::IffNode& node) {
    auto obj = Napi::Object::New(env);

    obj.Set("tag",         Napi::String::New(env, node.tag));
    obj.Set("length",      Napi::Number::New(env, node.declaredLength));
    obj.Set("byteOffset",  Napi::Number::New(env, node.byteOffset));
    obj.Set("kind",        Napi::String::New(env, node.isForm ? "form" : "leaf"));

    if (node.isForm) {
        obj.Set("subType", Napi::String::New(env, node.subType));

        auto children = Napi::Array::New(env, node.children.size());
        for (size_t i = 0; i < node.children.size(); ++i) {
            children.Set(static_cast<uint32_t>(i), nodeToJs(env, node.children[i]));
        }
        obj.Set("children", children);
    }

    return obj;
}

// ─── Parse a Napi::Value back into IffNode (for serializeIff / getChunkBytes) ──

/**
 * Reconstruct IffNode from the JS object we previously returned.
 * For clean re-emit we need to look up the original bytes from the source buffer
 * and re-populate capturedSlice.
 *
 * Source: swg-client-v2 Iff.cpp:419-429 (verbatim write relies on captured slice).
 */
static swg_core::iff::IffNode jsToNode(const Napi::Object& obj,
                                        const uint8_t* srcBuf,
                                        uint32_t srcSize) {
    swg_core::iff::IffNode node;

    std::string tag = obj.Get("tag").As<Napi::String>().Utf8Value();
    std::string kind = obj.Get("kind").As<Napi::String>().Utf8Value();
    uint32_t length = obj.Get("length").As<Napi::Number>().Uint32Value();
    uint32_t byteOffset = obj.Get("byteOffset").As<Napi::Number>().Uint32Value();

    std::strncpy(node.tag, tag.c_str(), 4);
    node.tag[4] = '\0';
    node.declaredLength = length;
    node.byteOffset = byteOffset;
    node.isForm = (kind == "form");
    node.isClean = true;

    // Re-populate capturedSlice from the source buffer so the serializer can do
    // verbatim re-emit. This is the mechanism that makes the round-trip byte-exact.
    const uint32_t sliceEnd = byteOffset + 8 + length;
    if (srcBuf && sliceEnd <= srcSize) {
        node.capturedSlice.assign(srcBuf + byteOffset, srcBuf + sliceEnd);
    }

    if (node.isForm) {
        if (obj.Has("subType")) {
            std::string st = obj.Get("subType").As<Napi::String>().Utf8Value();
            std::strncpy(node.subType, st.c_str(), 4);
            node.subType[4] = '\0';
        }
        if (obj.Has("children") && obj.Get("children").IsArray()) {
            auto arr = obj.Get("children").As<Napi::Array>();
            for (uint32_t i = 0; i < arr.Length(); ++i) {
                auto childVal = arr.Get(i);
                if (childVal.IsObject()) {
                    node.children.push_back(jsToNode(childVal.As<Napi::Object>(), srcBuf, srcSize));
                }
            }
        }
    }

    return node;
}

// ─── parseIff ────────────────────────────────────────────────────────────────

/**
 * parseIff(bytes: ArrayBuffer|Uint8Array) -> { roots, trailingBytes, roundTrip }
 *
 * Parses an IFF buffer and returns the tree as typed JSON + round-trip status.
 * Throws a JS Error on malformed input (never crashes the renderer).
 *
 * Note: For large buffers this is called synchronously. A Napi::AsyncWorker
 * wrapper can be added if needed; for the current UI (single-file parse) the
 * synchronous path is adequate.
 *
 * Source: modules/core/iff/Iff.h parseIff().
 */
Napi::Value ParseIff(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "parseIff: (bytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [data, size] = extractBytes(info[0], env, "parseIff bytes");
    if (!data) return env.Undefined(); // TypeError already thrown

    swg_core::iff::IffParseResult parseResult;
    bool roundTripOk = false;
    uint32_t failOffset = 0;

    try {
        parseResult = swg_core::iff::parseIff(data, static_cast<uint32_t>(size));
    } catch (const swg_core::iff::IffParseError& e) {
        Napi::Error::New(env, std::string("IFF parse error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("IFF internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Run byte-exact round-trip check inline (CORE-04).
    try {
        auto reserialised = swg_core::iff::serializeIff(parseResult, data, static_cast<uint32_t>(size));
        if (reserialised.size() == size) {
            roundTripOk = true;
            for (size_t i = 0; i < size; ++i) {
                if (reserialised[i] != data[i]) {
                    roundTripOk = false;
                    failOffset = static_cast<uint32_t>(i);
                    break;
                }
            }
        } else {
            roundTripOk = false;
            failOffset = 0;
        }
    } catch (...) {
        roundTripOk = false;
    }

    // Build the result object.
    auto result = Napi::Object::New(env);

    // roots array
    auto roots = Napi::Array::New(env, parseResult.roots.size());
    for (size_t i = 0; i < parseResult.roots.size(); ++i) {
        roots.Set(static_cast<uint32_t>(i), nodeToJs(env, parseResult.roots[i]));
    }
    result.Set("roots", roots);

    // trailingBytes
    if (parseResult.trailingBytes.count > 0) {
        auto tb = Napi::Object::New(env);
        tb.Set("offset", Napi::Number::New(env, parseResult.trailingBytes.offset));
        tb.Set("count",  Napi::Number::New(env, parseResult.trailingBytes.count));
        result.Set("trailingBytes", tb);
    } else {
        result.Set("trailingBytes", env.Null());
    }

    // roundTrip
    auto rt = Napi::Object::New(env);
    rt.Set("passed", Napi::Boolean::New(env, roundTripOk));
    if (!roundTripOk) {
        rt.Set("failOffset", Napi::Number::New(env, failOffset));
    }
    result.Set("roundTrip", rt);

    return result;
}

// ─── serializeIff ────────────────────────────────────────────────────────────

/**
 * serializeIff(parseResult: object, srcBytes: ArrayBuffer|Uint8Array) -> ArrayBuffer
 *
 * Re-serializes a (possibly modified) IFF tree back to bytes.
 * The srcBytes buffer is needed to re-populate capturedSlices for verbatim re-emit.
 * Returns the serialized bytes as a zero-copy ArrayBuffer.
 *
 * Source: modules/core/iff/Iff.h serializeIff().
 */
Napi::Value SerializeIff(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "serializeIff: (parseResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "serializeIff: first argument must be an object (parseResult)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "serializeIff srcBytes");
    if (!srcData) return env.Undefined();

    auto jsResult = info[0].As<Napi::Object>();

    // Reconstruct the IffParseResult from the JS object.
    swg_core::iff::IffParseResult parseResult;

    if (jsResult.Has("roots") && jsResult.Get("roots").IsArray()) {
        auto roots = jsResult.Get("roots").As<Napi::Array>();
        for (uint32_t i = 0; i < roots.Length(); ++i) {
            auto rv = roots.Get(i);
            if (rv.IsObject()) {
                parseResult.roots.push_back(jsToNode(rv.As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize)));
            }
        }
    }

    if (jsResult.Has("trailingBytes") && jsResult.Get("trailingBytes").IsObject()) {
        auto tb = jsResult.Get("trailingBytes").As<Napi::Object>();
        parseResult.trailingBytes.offset = tb.Get("offset").As<Napi::Number>().Uint32Value();
        parseResult.trailingBytes.count  = tb.Get("count").As<Napi::Number>().Uint32Value();
    }

    std::vector<uint8_t> out;
    try {
        out = swg_core::iff::serializeIff(parseResult, srcData, static_cast<uint32_t>(srcSize));
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("IFF serialize error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Return as ArrayBuffer (zero-copy via external — caller must not free).
    // Copy into a new ArrayBuffer owned by the JS heap for safety.
    auto ab = Napi::ArrayBuffer::New(env, out.size());
    std::memcpy(ab.Data(), out.data(), out.size());
    return ab;
}

// ─── getChunkBytes ────────────────────────────────────────────────────────────

/**
 * getChunkBytes(parseResult: object, srcBytes: ArrayBuffer|Uint8Array, nodeIndex: number) -> ArrayBuffer
 *
 * Returns the capturedSlice for the node at pre-order index nodeIndex.
 * Used by the Hex inspector to display a specific chunk's bytes.
 *
 * Source: modules/core/iff/Iff.h getNodeBytes().
 */
Napi::Value GetChunkBytes(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "getChunkBytes: (parseResult, srcBytes, nodeIndex) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "getChunkBytes: first argument must be an object (parseResult)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytes(info[1], env, "getChunkBytes srcBytes");
    if (!srcData) return env.Undefined();

    if (!info[2].IsNumber()) {
        Napi::TypeError::New(env, "getChunkBytes: nodeIndex must be a number")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    uint32_t nodeIndex = info[2].As<Napi::Number>().Uint32Value();
    auto jsResult = info[0].As<Napi::Object>();

    // Reconstruct parse result.
    swg_core::iff::IffParseResult parseResult;
    if (jsResult.Has("roots") && jsResult.Get("roots").IsArray()) {
        auto roots = jsResult.Get("roots").As<Napi::Array>();
        for (uint32_t i = 0; i < roots.Length(); ++i) {
            auto rv = roots.Get(i);
            if (rv.IsObject()) {
                parseResult.roots.push_back(jsToNode(rv.As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize)));
            }
        }
    }

    std::vector<uint8_t> bytes;
    try {
        bytes = swg_core::iff::getNodeBytes(parseResult, nodeIndex);
    } catch (const std::out_of_range& e) {
        Napi::RangeError::New(env, std::string("getChunkBytes: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("getChunkBytes error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto ab = Napi::ArrayBuffer::New(env, bytes.size());
    if (!bytes.empty()) {
        std::memcpy(ab.Data(), bytes.data(), bytes.size());
    }
    return ab;
}
