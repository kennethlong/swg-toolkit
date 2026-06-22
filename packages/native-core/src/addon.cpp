/**
 * addon.cpp — NODE_API_MODULE registration for swg_native_core.
 *
 * Wires hello(), allocateSab(), writeSab(), and readSab() into the addon's export object.
 * Exports exactly match the TypeScript surface in index.d.ts.
 *
 * Path B (native-in-renderer) additions (00-03):
 *   writeSab(sab, int32Index, value) — C++ writes an Int32 into the SAB (C++ → JS proof)
 *   readSab(sab, int32Index)         — C++ reads an Int32 from the SAB  (JS → C++ proof)
 *
 * Source: RESEARCH.md Pattern 3 (corrected); node-addon-api ^8.8.0.
 */

#include <napi.h>

// Forward declarations (implemented in hello.cpp, sab.cpp, and sab-rw.cpp)
Napi::Value Hello(const Napi::CallbackInfo& info);
Napi::Value AllocateSab(const Napi::CallbackInfo& info);
Napi::Value WriteSab(const Napi::CallbackInfo& info);
Napi::Value ReadSab(const Napi::CallbackInfo& info);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("hello",       Napi::Function::New(env, Hello));
    exports.Set("allocateSab", Napi::Function::New(env, AllocateSab));
    // Path B bidirectional proof exports (00-03):
    exports.Set("writeSab",    Napi::Function::New(env, WriteSab));
    exports.Set("readSab",     Napi::Function::New(env, ReadSab));
    return exports;
}

NODE_API_MODULE(swg_native_core, Init)
