/**
 * sab-rw.cpp — writeSab() and readSab() exports for the swg_native_core N-API addon.
 *
 * Provides bidirectional C++ ↔ JS access to a SharedArrayBuffer passed from JS:
 *   writeSab(sab, int32Index, value) — C++ writes an Int32 value into the SAB
 *   readSab(sab, int32Index)         — C++ reads and returns an Int32 value from the SAB
 *
 * Purpose: drives the BIDIRECTIONAL SAME-MEMORY PROOF in Path B (native-in-renderer):
 *   - C++ calls writeSab(sab, 0, 0xDEAD) → renderer reads Int32Array(sab)[0] (C++ → JS)
 *   - renderer writes a nonce to Int32Array(sab)[1] → C++ calls readSab(sab, 1) (JS → C++)
 *   Both directions prove same-memory access (true zero-copy, no IPC, no copy).
 *
 * GROUND TRUTH NOTE (RESEARCH Pitfall 4):
 *   Napi::SharedArrayBuffer is ONLY available under NAPI_EXPERIMENTAL.
 *   CMakeLists.txt defines NAPI_EXPERIMENTAL to enable this guard.
 *   Without NAPI_EXPERIMENTAL, this file fails to compile.
 *
 * Source: node-addon-api 8.8.0 Napi::SharedArrayBuffer API.
 */

#include <napi.h>

/**
 * writeSab(sab: SharedArrayBuffer, int32Index: number, value: number): void
 *
 * Writes `value` as an Int32 at `int32Index * 4` bytes into `sab`.
 * Used by the renderer proof: C++ writes 0xDEAD → renderer reads it (C++ → JS direction).
 */
Napi::Value WriteSab(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "writeSab: (sab: SharedArrayBuffer, int32Index: number, value: number) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsSharedArrayBuffer()) {
        Napi::TypeError::New(env, "writeSab: first argument must be a SharedArrayBuffer")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "writeSab: int32Index and value must be numbers")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::SharedArrayBuffer sab = info[0].As<Napi::SharedArrayBuffer>();
    uint32_t int32Index = info[1].As<Napi::Number>().Uint32Value();
    int32_t value = info[2].As<Napi::Number>().Int32Value();

    // Bounds check: ensure int32Index * 4 + 4 is within the SAB byte length.
    if ((uint64_t)int32Index * 4 + 4 > sab.ByteLength()) {
        Napi::RangeError::New(env, "writeSab: int32Index out of bounds")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Write the value as an Int32 at the given slot index.
    // The SAB's raw data pointer is stable for the lifetime of the JS value.
    int32_t* data = reinterpret_cast<int32_t*>(sab.Data());
    data[int32Index] = value;

    return env.Undefined();
}

/**
 * readSab(sab: SharedArrayBuffer, int32Index: number): number
 *
 * Reads and returns the Int32 at `int32Index * 4` bytes from `sab`.
 * Used by the renderer proof: renderer writes a nonce → C++ reads it (JS → C++ direction).
 */
Napi::Value ReadSab(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "readSab: (sab: SharedArrayBuffer, int32Index: number) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsSharedArrayBuffer()) {
        Napi::TypeError::New(env, "readSab: first argument must be a SharedArrayBuffer")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "readSab: int32Index must be a number")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::SharedArrayBuffer sab = info[0].As<Napi::SharedArrayBuffer>();
    uint32_t int32Index = info[1].As<Napi::Number>().Uint32Value();

    // Bounds check: ensure int32Index * 4 + 4 is within the SAB byte length.
    if ((uint64_t)int32Index * 4 + 4 > sab.ByteLength()) {
        Napi::RangeError::New(env, "readSab: int32Index out of bounds")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Read and return the Int32 at the given slot index.
    const int32_t* data = reinterpret_cast<const int32_t*>(sab.Data());
    return Napi::Number::New(env, static_cast<double>(data[int32Index]));
}
