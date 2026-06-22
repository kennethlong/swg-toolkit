/**
 * addon.cpp — NODE_API_MODULE registration for swg_native_core.
 *
 * Wires hello() and allocateSab() into the addon's export object.
 * Exports exactly match the TypeScript surface in index.d.ts.
 *
 * Source: RESEARCH.md Pattern 3 (corrected); node-addon-api ^8.8.0.
 */

#include <napi.h>

// Forward declarations (implemented in hello.cpp and sab.cpp)
Napi::Value Hello(const Napi::CallbackInfo& info);
Napi::Value AllocateSab(const Napi::CallbackInfo& info);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("hello",       Napi::Function::New(env, Hello));
    exports.Set("allocateSab", Napi::Function::New(env, AllocateSab));
    return exports;
}

NODE_API_MODULE(swg_native_core, Init)
