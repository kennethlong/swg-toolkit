/**
 * channel_binding.cpp — OpenChannel, CloseChannel, ReadChannelView stubs.
 *
 * Full implementation lands in Plan 03-05.
 * Shape follows native-core/src/sab.cpp OpenFileMappingA/MapViewOfFile pattern.
 *
 * CHANNEL_BYTE_SIZE = 320 per LIVE_CHANNEL_LAYOUT.TOTAL_SIZE
 */

#include <napi.h>
#include <Windows.h>
#include <string>

// TODO: full implementation in Plan 03-05
// Opens the named file-mapping channel created by the agent.
Napi::Value OpenChannel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}

// TODO: full implementation in Plan 03-05
Napi::Value CloseChannel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}

// TODO: full implementation in Plan 03-05
// Returns ArrayBuffer over the mapped view (CHANNEL_BYTE_SIZE = 320 bytes).
Napi::Value ReadChannelView(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}
