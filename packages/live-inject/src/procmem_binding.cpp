/**
 * procmem_binding.cpp — OpenProcessHandle, CloseProcessHandle,
 *                       ReadProcessRegion, IsProcessAlive stubs.
 *
 * Full implementation lands in Plan 03-04.
 * Shape follows native-core/src/sab-rw.cpp validate-extract-call-return pattern.
 */

#include <napi.h>
#include <Windows.h>
#include <string>

// TODO: full implementation in Plan 03-04
Napi::Value OpenProcessHandle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}

// TODO: full implementation in Plan 03-04
Napi::Value CloseProcessHandle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}

// TODO: full implementation in Plan 03-04
// Returns ArrayBuffer of byteCount bytes read from the target process region.
Napi::Value ReadProcessRegion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}

// TODO: full implementation in Plan 03-04
Napi::Value IsProcessAlive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}
