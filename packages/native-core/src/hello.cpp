/**
 * hello.cpp — hello() export for the swg_native_core N-API addon.
 *
 * Returns the string "pong" — proves the C++ → N-API → JS call chain works.
 * No exception handling (NAPI_DISABLE_CPP_EXCEPTIONS, value-return style).
 *
 * Ground truth: Napi::String::New is stable N-API (no NAPI_EXPERIMENTAL needed).
 * Source: RESEARCH.md Pattern 3 (corrected); node-addon-api ^8.8.0.
 */

#include <napi.h>

Napi::Value Hello(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), "pong");
}
