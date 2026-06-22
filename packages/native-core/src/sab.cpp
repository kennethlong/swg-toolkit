/**
 * sab.cpp — allocateSab() export for the swg_native_core N-API addon.
 *
 * Allocates a SharedArrayBuffer of the requested byteLength and returns it.
 * Zero-length SAB is explicitly allowed (tested as Test 6 edge case).
 *
 * GROUND TRUTH (RESEARCH Pitfall 4, primary-source verified):
 *   Napi::SharedArrayBuffer is ONLY available under NAPI_EXPERIMENTAL and
 *   node-addon-api >= 8.6.0. The class is gated by:
 *     #ifdef NODE_API_EXPERIMENTAL_HAS_SHAREDARRAYBUFFER
 *   in napi.h. CMakeLists.txt defines NAPI_EXPERIMENTAL to enable this guard.
 *   Without NAPI_EXPERIMENTAL, this file fails to compile.
 *
 * Source: RESEARCH.md Pattern 3 (corrected Pitfall 4); node-addon-api 8.8.0.
 */

#include <napi.h>

Napi::Value AllocateSab(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Validate argument (Rule 2: missing critical input validation)
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "allocateSab: byteLength (number) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Extract byteLength from the first argument
    uint32_t byteLength = info[0].As<Napi::Number>().Uint32Value();

    // Allocate and return a SharedArrayBuffer of the requested size.
    // Napi::SharedArrayBuffer::New is experimental-gated (NAPI_EXPERIMENTAL
    // compile def in CMakeLists.txt); available in node-addon-api >= 8.6.0.
    return Napi::SharedArrayBuffer::New(env, byteLength);
}
