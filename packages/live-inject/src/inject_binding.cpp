/**
 * inject_binding.cpp — LaunchAndInject, AttachAndInject, Detach stubs.
 *
 * Full Win32 inject implementation lands in Plan 03-04.
 * Shape follows native-core/src/tre_binding.cpp AsyncWorker pattern.
 */

#include <napi.h>
#include <Windows.h>
#include <TlHelp32.h>
#include <string>
#include <vector>
#include <memory>
#include <stdexcept>

// TODO: LaunchAndInjectWorker full implementation in Plan 03-04
Napi::Value LaunchAndInject(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}

// TODO: AttachAndInjectWorker full implementation in Plan 03-04
Napi::Value AttachAndInject(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}

// TODO: Detach full implementation in Plan 03-04
Napi::Value Detach(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}
