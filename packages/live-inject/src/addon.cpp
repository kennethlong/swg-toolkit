/**
 * addon.cpp — NODE_API_MODULE registration for swg_live_inject.
 *
 * Exports:
 *   Inject/attach/detach  → inject_binding.cpp: LaunchAndInject, AttachAndInject, Detach
 *   Process handle lifecycle → procmem_binding.cpp: OpenProcessHandle, CloseProcessHandle,
 *                              ReadProcessRegion, IsProcessAlive
 *   File-mapping channel  → channel_binding.cpp: OpenChannel, CloseChannel, ReadChannelView
 *   Test-utility resolver → inject_binding.cpp: LookupByNameInTable, ResolveFromSyntheticTable,
 *                              ResolveFromExe, IsAdvertisedClient
 */

#include <napi.h>

// Forward declarations (implemented in inject_binding.cpp)
Napi::Value LaunchAndInject(const Napi::CallbackInfo& info);
Napi::Value AttachAndInject(const Napi::CallbackInfo& info);
Napi::Value Detach(const Napi::CallbackInfo& info);

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

// Forward declarations (implemented in channel_binding.cpp)
Napi::Value OpenChannel(const Napi::CallbackInfo& info);
Napi::Value CloseChannel(const Napi::CallbackInfo& info);
Napi::Value ReadChannelView(const Napi::CallbackInfo& info);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Inject/attach/detach
    exports.Set("launchAndInject", Napi::Function::New(env, LaunchAndInject));
    exports.Set("attachAndInject", Napi::Function::New(env, AttachAndInject));
    exports.Set("detach",          Napi::Function::New(env, Detach));

    // Test-utility resolver exports (Plan 03-02 TDD)
    exports.Set("lookupByNameInTable",      Napi::Function::New(env, LookupByNameInTable));
    exports.Set("resolveFromSyntheticTable",Napi::Function::New(env, ResolveFromSyntheticTable));
    exports.Set("resolveFromExe",           Napi::Function::New(env, ResolveFromExe));
    exports.Set("isAdvertisedClient",       Napi::Function::New(env, IsAdvertisedClient));

    // Process handle lifecycle
    exports.Set("openProcessHandle",  Napi::Function::New(env, OpenProcessHandle));
    exports.Set("closeProcessHandle", Napi::Function::New(env, CloseProcessHandle));
    exports.Set("readProcessRegion",  Napi::Function::New(env, ReadProcessRegion));
    exports.Set("isProcessAlive",     Napi::Function::New(env, IsProcessAlive));

    // File-mapping channel
    exports.Set("openChannel",     Napi::Function::New(env, OpenChannel));
    exports.Set("closeChannel",    Napi::Function::New(env, CloseChannel));
    exports.Set("readChannelView", Napi::Function::New(env, ReadChannelView));

    return exports;
}

NODE_API_MODULE(swg_live_inject, Init)
