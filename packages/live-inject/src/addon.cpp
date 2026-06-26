/**
 * addon.cpp — NODE_API_MODULE registration for swg_live_inject.
 *
 * Exports:
 *   Inject/attach/detach  → inject_binding.cpp: launchAndInject, attachAndInject, detach
 *   PID discovery         → inject_binding.cpp: listSWGClientPids
 *
 *   Process handle lifecycle → procmem_binding.cpp:
 *     openProcessHandle(pid, forInject) → {handleId, isAdvertisedClient}
 *     closeProcessHandle(handleId)
 *     readProcessRegion(handleId, addr, byteCount) → ArrayBuffer
 *     isProcessAlive(handleId) → boolean
 *     isAdvertisedClientProcess(handleId) → boolean
 *
 *   File-mapping channel → channel_binding.cpp:
 *     openChannel(name) → ArrayBuffer
 *     closeChannel(name)
 *     readChannelView(name) → ArrayBuffer | null
 *
 *   Test-utility resolver (Plan 03-02 TDD) → inject_binding.cpp:
 *     lookupByNameInTable, resolveFromSyntheticTable, resolveFromExe, isAdvertisedClient
 */

#include <napi.h>

// Forward declarations (implemented in inject_binding.cpp)
Napi::Value LaunchAndInject(const Napi::CallbackInfo& info);
Napi::Value AttachAndInject(const Napi::CallbackInfo& info);
Napi::Value Detach(const Napi::CallbackInfo& info);
Napi::Value ListSWGClientPids(const Napi::CallbackInfo& info);

// Test-utility resolver exports (Plan 03-02 TDD — implemented in inject_binding.cpp)
Napi::Value LookupByNameInTable(const Napi::CallbackInfo& info);
Napi::Value ResolveFromSyntheticTable(const Napi::CallbackInfo& info);
Napi::Value ResolveFromExe(const Napi::CallbackInfo& info);
Napi::Value IsAdvertisedClient(const Napi::CallbackInfo& info);

// Forward declarations (implemented in procmem_binding.cpp)
Napi::Value OpenProcessHandle(const Napi::CallbackInfo& info);
Napi::Value CloseProcessHandle(const Napi::CallbackInfo& info);
Napi::Value ReadProcessRegion(const Napi::CallbackInfo& info);
Napi::Value IsProcessAlive(const Napi::CallbackInfo& info);
Napi::Value IsAdvertisedClientProcess(const Napi::CallbackInfo& info);  // process-level probe

// Forward declarations (implemented in channel_binding.cpp)
Napi::Value OpenChannel(const Napi::CallbackInfo& info);
Napi::Value CloseChannel(const Napi::CallbackInfo& info);
Napi::Value ReadChannelView(const Napi::CallbackInfo& info);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Inject/attach/detach + PID discovery
    exports.Set("launchAndInject",   Napi::Function::New(env, LaunchAndInject));
    exports.Set("attachAndInject",   Napi::Function::New(env, AttachAndInject));
    exports.Set("detach",            Napi::Function::New(env, Detach));
    exports.Set("listSWGClientPids", Napi::Function::New(env, ListSWGClientPids));

    // Test-utility resolver exports (Plan 03-02 TDD)
    exports.Set("lookupByNameInTable",       Napi::Function::New(env, LookupByNameInTable));
    exports.Set("resolveFromSyntheticTable", Napi::Function::New(env, ResolveFromSyntheticTable));
    exports.Set("resolveFromExe",            Napi::Function::New(env, ResolveFromExe));
    exports.Set("isAdvertisedClient",        Napi::Function::New(env, IsAdvertisedClient));

    // Process handle lifecycle
    exports.Set("openProcessHandle",          Napi::Function::New(env, OpenProcessHandle));
    exports.Set("closeProcessHandle",         Napi::Function::New(env, CloseProcessHandle));
    exports.Set("readProcessRegion",          Napi::Function::New(env, ReadProcessRegion));
    exports.Set("isProcessAlive",             Napi::Function::New(env, IsProcessAlive));
    exports.Set("isAdvertisedClientProcess",  Napi::Function::New(env, IsAdvertisedClientProcess));

    // File-mapping channel
    exports.Set("openChannel",     Napi::Function::New(env, OpenChannel));
    exports.Set("closeChannel",    Napi::Function::New(env, CloseChannel));
    exports.Set("readChannelView", Napi::Function::New(env, ReadChannelView));

    return exports;
}

NODE_API_MODULE(swg_live_inject, Init)
