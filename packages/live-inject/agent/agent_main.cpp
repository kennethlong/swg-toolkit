/**
 * agent_main.cpp — Module entry point and agent_init remote-thread entry.
 *
 * ARCHITECTURE (harvested from Utinni Launcher/main.cpp:80-115):
 *
 * Module entry (DLL_PROCESS_ATTACH): ONLY call the thread-library-calls
 * disabler. NOTHING ELSE.
 *   Rationale: loader lock + CRT not initialized at module-attach time. Any
 *   engine call, any Win32 heap allocation, or call into non-trivially-
 *   initialized subsystems risks deadlock or crash. The real work runs on
 *   agent_init's thread, fired by the LAUNCHER via a SEPARATE remote thread
 *   (CreateRemoteThread) after the DLL load completes.
 *
 * agent_init: actual entry point fired on a fresh remote thread.
 *   lpReadyEventName points to a buffer written into THIS process by the
 *   launcher via VirtualAllocEx + WriteProcessMemory. The buffer contains
 *   two consecutive null-terminated C strings:
 *     [eventName\0][mappingName\0]
 *   e.g. "Local\\SwgToolkitAgent_<pid>\0Local\\SwgToolkitLive_<uuid>\0"
 *
 * Sequence inside agent_init (Pattern 3 — RESEARCH.md / PATTERNS.md):
 *   1. Parse event name and mapping name from lpReadyEventName.
 *   2. OpenEventA(EVENT_MODIFY_STATE, FALSE, eventName) → hReady.
 *      If null: return 1 (launcher WaitForSingleObject times out at 30s).
 *   3. swg::endpoints::resolveFromExe() — fills fn-pointer slots:
 *      advertised path: name-keyed via GetEngineHookPoints;
 *      legacy SWGEmu path: RVA literals from rva_table.cpp stay active.
 *   4. channelOpen(mappingName, LIVE_STATE_BYTE_SIZE).
 *      If false: signal ready anyway, return 2.
 *   5. SetEvent(hReady) — unblocks launcher's WaitForSingleObject.
 *   6. CloseHandle(hReady).
 *   7. Read-verify poll loop (~30fps; Phase 5 raises to 60fps).
 *   8. Return 0 when stopped (Phase 5 adds stop signal).
 *
 * CALLING CONVENTIONS:
 *   Member fns (getTransform_o2w etc.): __thiscall — MSVC passes `this` in
 *   ECX automatically via the typedef. Do NOT hand-emulate __fastcall.
 *   Free/static fns (getPlayer etc.): __cdecl.
 */

#include <Windows.h>
#include <cstring>
#include <cstdint>
#include <cstddef>
#include "resolve.h"
#include "sentinels.h"
#include "channel.h"

// ---------------------------------------------------------------------------
// Forward declarations for rva_table.cpp fn-pointer slots.
// Typedefs mirror rva_table.cpp exactly (same calling conventions).
// void* is used for opaque SWG Object*/Transform* types.
// ---------------------------------------------------------------------------

// Member-function typedefs (__thiscall: `this` in ECX, handled by the typedef)
typedef void*(__thiscall*       pGetTransform_o2w)(void*);     // object::getTransform_o2w
typedef const char*(__thiscall* pGetTemplateFilename)(void*);  // object::getObjectTemplateName
typedef void*(__thiscall*       pGetNetworkId)(void*);         // object::getNetworkId (advertised)

// Free/static-function typedefs (__cdecl)
typedef void*(__cdecl*          pGetPlayer)();                 // game::getPlayer
typedef int(__cdecl*            pMainLoopCount)();             // game::g_mainLoopCounter
typedef bool(__cdecl*           pIsOver)();                    // game::g_runningFlags (advertised)

// Extern references to fn-pointer slots defined in rva_table.cpp.
// On the advertised path, resolve() overwrites these by name.
// On the legacy SWGEmu path, RVA literals from rva_table.cpp remain active.
namespace swg { namespace endpoints {
    extern pGetTransform_o2w    getTransform_o2w;
    extern pGetPlayer           getPlayer;
    extern pGetTemplateFilename getTemplateFilename;
    extern pMainLoopCount       g_mainLoopCounter;
    extern pIsOver              g_runningFlags;
    extern pGetNetworkId        getNetworkId;
    extern const uintptr_t      k_mainLoopCounter_addr;  // legacy SWGEmu direct-global address
}}

// ---------------------------------------------------------------------------
// Module entry point.
//
// Rule: one call only — the disable-thread-library-calls Win32 function.
// No engine calls. No resolve. No heap allocation. No CreateThread.
// All real work belongs in agent_init (see file header rationale above).
// ---------------------------------------------------------------------------

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH)
        DisableThreadLibraryCalls(hModule);
    return TRUE;
}

// ---------------------------------------------------------------------------
// agent_init — real entry point on a fresh remote thread.
//
// lpReadyEventName: pointer to the double-string buffer written by the launcher.
// Format: "Local\\SwgToolkitAgent_<pid>\0Local\\SwgToolkitLive_<uuid>\0"
// ---------------------------------------------------------------------------

extern "C" __declspec(dllexport)
DWORD WINAPI agent_init(LPVOID lpReadyEventName) {
    if (!lpReadyEventName) return 1;

    // --- Step 1: Parse event name and mapping name from the buffer ---
    const char* buf         = static_cast<const char*>(lpReadyEventName);
    const char* eventName   = buf;
    const char* mappingName = buf + strlen(buf) + 1;  // skip eventName + '\0'

    // --- Step 2: Open the ready event ---
    HANDLE hReady = OpenEventA(EVENT_MODIFY_STATE, FALSE, eventName);
    if (!hReady) {
        // Launcher will time out its WaitForSingleObject at 30s — safe error path.
        return 1;
    }

    // --- Step 3: Resolve engine endpoints ---
    // Advertised path: GetEngineHookPoints() found → name-keyed overwrite.
    // Legacy SWGEmu path: export absent → STRICT NO-OP, RVA literals stand.
    swg::endpoints::resolveFromExe();

    // --- Step 4: Open the file-mapping channel ---
    // The host (channel_binding.cpp OpenChannel) created this mapping before inject.
    bool channelOk = channelOpen(mappingName, LIVE_STATE_BYTE_SIZE);

    // --- Step 5+6: Signal the launcher, then release the event handle ---
    SetEvent(hReady);
    CloseHandle(hReady);

    if (!channelOk) {
        return 2;  // channel unavailable — cannot report state
    }

    // --- Step 7: Read-verify poll loop (~30fps) ---
    int prevLoopCounter = 0;

    while (true) {
        // (a) Get the player Object*
        void* player = swg::endpoints::getPlayer ? swg::endpoints::getPlayer() : nullptr;
        if (!player) {
            Sleep(100);  // world not loaded yet
            continue;
        }

        // (b) Read the player's world transform (TRANSFORM_BYTE_SIZE = 48 bytes,
        //     float[3][4] row-major — VERIFIED: swg_math.h:69)
        float xform[3][4] = {};
        if (swg::endpoints::getTransform_o2w) {
            void* xformPtr = swg::endpoints::getTransform_o2w(player);
            if (xformPtr) {
                std::memcpy(xform, xformPtr, TRANSFORM_BYTE_SIZE);
            }
        }

        // (c) Read the network ID
        // Advertised path: getNetworkId resolves to the engine accessor.
        // NOTE: The rva_table.cpp typedef uses void* (4-byte) as a placeholder.
        // On x86, this captures the lower 32 bits of the return value only.
        // Full 64-bit NetworkId support is deferred to Phase 5 once the exact
        // x86 return convention (EDX:EAX vs hidden out-param) is confirmed.
        // Legacy path: getNetworkId is null → netId stays 0. The networkId sentinel
        // is made not-applicable in that case (see results[1] below) so it does not
        // block the legacy write — transform/template/liveness are independently valid.
        uint64_t netId = 0;
        if (swg::endpoints::getNetworkId) {
            void* rawId = swg::endpoints::getNetworkId(player);
            netId = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(rawId));
        }

        // (d) Read the object template name
        const char* tmplName = nullptr;
        if (swg::endpoints::getTemplateFilename) {
            tmplName = swg::endpoints::getTemplateFilename(player);
        }

        // (e) Read game liveness: main-loop counter delta + isOver flag
        int curCounter = 0;
        if (swg::endpoints::g_mainLoopCounter) {
            curCounter = swg::endpoints::g_mainLoopCounter();  // advertised path
        } else {
            // Legacy SWGEmu: read the global directly (k_mainLoopCounter_addr = 0x1908830)
            curCounter = *reinterpret_cast<const volatile int*>(
                swg::endpoints::k_mainLoopCounter_addr);
        }
        int loopDelta   = curCounter - prevLoopCounter;
        prevLoopCounter = curCounter;

        bool isOver = false;
        if (swg::endpoints::g_runningFlags) {
            isOver = swg::endpoints::g_runningFlags();  // advertised path only
        }

        // (f) Run all 4 sentinel checks (D-05: all must pass for a write)
        SentinelResult results[4];
        results[0] = checkTransform(&xform[0][0]);
        // networkId is advertised-path-only (getNetworkId has no legacy SWGEmu RVA).
        // When the accessor is unavailable, the sentinel is not-applicable rather than a
        // hard failure — otherwise it blocks EVERY legacy write even though
        // transform/template/liveness are all valid. Ground truth: Utinni reads this exact
        // SWGEmu build fine, so the gate (not the RVAs) was blocking the legacy path.
        results[1] = swg::endpoints::getNetworkId
                         ? checkNetworkId(netId)
                         : SentinelResult{ true, nullptr };
        results[2] = checkTemplateName(tmplName, 256);
        results[3] = checkLiveness(player != nullptr, isOver, loopDelta);

        // (g) Write verified state to the seqlock channel
        if (allSentinelsPassed(results)) {
            LiveState state = {};
            std::memcpy(state.transform, xform, TRANSFORM_BYTE_SIZE);
            state.networkId = netId;
            if (tmplName) {
                std::strncpy(state.templateName, tmplName, sizeof(state.templateName) - 1);
                state.templateName[sizeof(state.templateName) - 1] = '\0';
            }
            // liveness: bit 0 = playerNonNull, bit 1 = isOver
            state.liveness = (player ? 1u : 0u) | (isOver ? 2u : 0u);
            channelWrite(&state);
        }

        Sleep(33);  // ~30fps polling; Phase 5 raises to 60fps
    }

    return 0;  // unreachable until Phase 5 adds a stop signal
}
