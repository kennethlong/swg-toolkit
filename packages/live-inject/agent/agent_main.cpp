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
 *      Immediately after: the setScale BLOCKER-fix conditional seed (05-03),
 *      then the one-time scaleUnavailableOnBuild/scaleGuardUnavailableOnBuild
 *      computations (05-03 ROUND 2 / plan-check revision).
 *   4. channelOpen(mappingName, LIVE_STATE_BYTE_SIZE).
 *      If false: signal ready anyway, return 2.
 *   5. SetEvent(hReady) — unblocks launcher's WaitForSingleObject.
 *   6. CloseHandle(hReady).
 *   7. Read-verify-write poll loop, 60fps (05-03 — raised from ~30fps):
 *      top-of-loop stop-signal check (before player is even resolved),
 *      cross-build focus-object resolution, guard-baseline re-key on a
 *      focus-identity change, sentinel-gated read+channelWrite, a genuine
 *      live m_scale member-offset read, and an independently-guarded
 *      Move/Rotate/Scale apply — the whole resolve->read->apply span wrapped
 *      in SEH so an access violation degrades to one skipped frame instead of
 *      crashing the injected client.
 *   8. Return 0 when the command slot's STOP_REQUESTED flag is honored.
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
#include "write.h"
#include "overlay.h"

// ---------------------------------------------------------------------------
// Forward declarations for rva_table.cpp fn-pointer slots.
// Typedefs mirror rva_table.cpp exactly (same calling conventions).
// void* is used for opaque SWG Object*/Transform*/Vector*/SwgCuiHud* types.
// ---------------------------------------------------------------------------

// Member-function typedefs (__thiscall: `this` in ECX, handled by the typedef)
typedef void*(__thiscall*       pGetTransform_o2w)(void*);     // object::getTransform_o2w
typedef const char*(__thiscall* pGetTemplateFilename)(void*);  // object::getObjectTemplateName
typedef void*(__thiscall*       pGetNetworkId)(void*);         // object::getNetworkId (advertised)
typedef void(__thiscall*        pSetTransform_o2w)(void*, const void*);  // object::setTransform_o2w
typedef void(__thiscall*        pSetScale)(void*, const void*);          // object::setScale
typedef void*(__thiscall*       pCachedNetworkIdGetObject)(void*);       // legacy target resolution
typedef void*(__thiscall*       pCuiHudGetTarget)(void*);                // advertised two-step, step 2

// Free/static-function typedefs (__cdecl)
typedef void*(__cdecl*          pGetPlayer)();                 // game::getPlayer
typedef int(__cdecl*            pMainLoopCount)();             // game::g_mainLoopCounter
typedef bool(__cdecl*           pIsOver)();                    // game::g_runningFlags (advertised)
typedef void*(__cdecl*          pGetPlayerCreatureObject)();    // legacy target resolution
typedef void*(__cdecl*          pCuiHudGetInstance)();          // advertised two-step, step 1

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

    // --- 05-03 additions ---
    extern pSetTransform_o2w         setTransform_o2w;
    extern pSetScale                 setScale;
    extern pGetPlayerCreatureObject  getPlayerCreatureObject;
    extern pCachedNetworkIdGetObject cachedNetworkIdGetObject;
    extern pCuiHudGetInstance        cuiHudGetInstance;
    extern pCuiHudGetTarget          cuiHudGetTarget;
    // (getObjectByIdLegacy / getObjectByIdAdvertised are reusable primitives,
    // NOT on the active focus-resolution path this phase — no extern needed
    // here, nothing in this file calls them.)
}}

// ---------------------------------------------------------------------------
// 05-03 file-scope constants
// ---------------------------------------------------------------------------

// LEGACY member-offset candidate for Object::m_scale — VALIDATE LIVE, computed
// from Utinni's own Object struct (object.h:76-107; scale field at :94),
// standard MSVC x86 alignment assumed, no #pragma pack anywhere in UtinniCore.
// See 05-03-PLAN.md Interfaces + the m-scale-offset-confirmation handoff for
// the full derivation. Not disassembly-confirmed — 05-12's UAT is where a
// wrong value would surface (scale-guard false-fail/false-pass).
constexpr uint32_t kLegacyScaleOffset = 0x44;

// Mirrors channel.h's char templateName[256] — used to bound the
// s_expectedCapturedAgainstTemplate content compare/copy (ROUND 6).
static constexpr size_t k_templateNameLen = sizeof(LiveState::templateName);

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

    // --- 05-03 BLOCKER FIX (REVIEWS.md Fix A) ---
    // setScale is seeded nullptr in rva_table.cpp. Only NOW, after
    // resolveFromExe() has had its chance to overwrite it by catalog name on
    // the advertised path, do we conditionally apply the legacy RVA literal —
    // and ONLY when isAdvertisedClient() has confirmed we are NOT advertised.
    // This structurally prevents a stale legacy absolute address from ever
    // being callable on the advertised build.
    if (!swg::endpoints::isAdvertisedClient()) {
        swg::endpoints::setScale = (pSetScale)0x00B23A10;
    }

    // ROUND 2 W2 fix — computed ONCE, immediately after the conditional seed
    // above (so setScale's resolved-ness is final and stable for the rest of
    // the agent's lifetime). true only when advertised AND setScale is still
    // unresolved (the D-09 known gap) — this is reported via liveness bit4,
    // NEVER conflated with a genuine per-write SCALE_REFUSED guard mismatch.
    //
    // NOTE: declaration (constant-initialized) is split from its dynamic
    // assignment below — a function-local `static` with a NON-constant
    // (dynamic, function-call-driven) initializer forces MSVC to generate
    // thread-safe "magic static" guard/unwind machinery, which conflicts
    // with this function's later __try/__except (SEH) block (MSVC C2712,
    // "cannot use __try in functions that require object unwinding"). A
    // constant-initialized declaration followed by a plain runtime
    // assignment carries the identical "computed exactly once" semantics
    // without triggering that machinery.
    static bool s_scaleUnavailableOnBuild = false;
    s_scaleUnavailableOnBuild =
        swg::endpoints::isAdvertisedClient() && swg::endpoints::setScale == nullptr;

    // RE-ARCHITECTED 2026-07-09 (plan-check revision + de-anchoring crew):
    // the scale-guard READ-side comparand is a member-offset read, not an
    // accessor binding. s_advertisedScaleOffsetConfirmed defaults false — no
    // confirmed advertised m_scale offset exists this session (see the
    // m-scale-offset-confirmation handoff) — and stays false this phase.
    static bool s_advertisedScaleOffsetConfirmed = false;
    // Paired offset value, unused while unconfirmed — kept only to keep the
    // gated-read code path compiling; never populated with a guessed value.
    static uint32_t s_advertisedScaleOffset = 0;

    // A DISTINCT static from s_scaleUnavailableOnBuild — this one reports
    // "the READ-side comparand is unverified on this build" (liveness bit5),
    // never merged with bit4's WRITE-side (setScale==nullptr) meaning.
    // Unconditionally false on legacy (the computed offset is always
    // attempted there, never gated). Same declaration/assignment split as
    // s_scaleUnavailableOnBuild above, for the same C2712 reason.
    static bool s_scaleGuardUnavailableOnBuild = false;
    s_scaleGuardUnavailableOnBuild =
        swg::endpoints::isAdvertisedClient() && !s_advertisedScaleOffsetConfirmed;

    // --- Step 4: Open the file-mapping channel ---
    // The host (channel_binding.cpp OpenChannel) created this mapping before inject.
    bool channelOk = channelOpen(mappingName, LIVE_STATE_BYTE_SIZE);

    // --- Step 5+6: Signal the launcher, then release the event handle ---
    SetEvent(hReady);
    CloseHandle(hReady);

    if (!channelOk) {
        return 2;  // channel unavailable — cannot report state
    }

    // --- Slice-0 step 2: spin up the in-game render overlay (advertised gl11 client). ---
    // Fire-and-forget: an acquisition thread polls gl11_r.dll!GetHookPoints() until the
    // swapchain is live, installs the DXGI Present detour, then the game render thread
    // owns the per-frame overlay. No-op on a non-D3D11 client (gl11 absent → never latches).
    overlay::start();

    // --- Step 7: Read-verify-write poll loop (60fps, 05-03) ---
    int prevLoopCounter = 0;

    // --- 05-03 guard-baseline state (persists across loop iterations; this
    //     function body only ever executes once per agent instance, so plain
    //     locals declared before the loop would work functionally the same
    //     as `static` here — declared `static` to make the "captured once,
    //     re-armed on re-key" contract explicit, matching this plan's own
    //     phrasing). ---
    static bool  s_expectedCaptured = false;
    static float s_expectedTransform[3][4] = {};
    static float s_expectedScale[3] = {};

    // ROUND 4 re-key identity (raw pointer) + ROUND 6 cross-check fields
    // (templateName CONTENT copy + networkId) — closes Opus's agent-side
    // pointer-ABA finding (a despawned object's address reallocated to a
    // DIFFERENT object no longer skips re-capture merely because the raw
    // pointer/token happens to match a stale baseline's key).
    static void*   s_expectedCapturedAgainst = nullptr;
    static char    s_expectedCapturedAgainstTemplate[k_templateNameLen] = {0};
    static int64_t s_expectedCapturedAgainstNetworkId = 0;

    // Command-apply bookkeeping (ROUND 4: gates the REBASELINE_GUARD mutation
    // + the apply atomically, once per distinct command).
    static uint32_t lastAppliedCmdSeq = 0;

    // ROUND 4/5 (REVIEWS.md round-3 decision #4): transient, agent-only
    // telemetry — set on a caught SEH fault, OR'd into the NEXT successful
    // liveness publish, then cleared right after that single publish (never
    // sticky, unlike GUARD_FLAG_STOPPING). No renderer/HUD consumer decodes
    // this bit this round — a documented, deliberate scope boundary.
    static bool s_agentFaultRecovered = false;

    while (true) {
        // --- TRUE TOP OF LOOP: read the command slot BEFORE computing/
        //     checking `player` (REVIEWS.md Fix F — a detach while the world
        //     is not loaded must still be honored, not starved by the
        //     player-null early-continue below). ---
        LiveCommand cmd{};
        uint32_t    cmdSeq = 0;
        bool        haveCmd = channelReadCommand(&cmd, &cmdSeq);

        if (haveCmd && (cmd.flags & CMD_FLAG_STOP_REQUESTED)) {
            // ROUND 4 (REVIEWS.md round-3 decision #5): publish a STICKY
            // acknowledgement BEFORE closing, so a host detach retry-loop can
            // observe STOP was honored even if a later drag command overtook
            // the latest-wins command slot before the host's next read.
            channelWriteGuardStatus(GUARD_FLAG_STOPPING, 0);
            channelClose();
            return 0;
        }

        // ROUND 4/5 (REVIEWS.md round-3 decision #4, round-4 decision #4):
        // the ENTIRE resolve->read->apply span, STARTING at getPlayer(),
        // through focus resolution, the reads, the sentinel gate, and the
        // guarded applyWrite call, runs inside SEH. An access violation on a
        // freed/relocated Object*/SwgCuiHud* (the sim thread tearing an
        // object down mid-poll — T-05-32, accept-watched) degrades to one
        // skipped frame plus a transient liveness bit, never a client crash.
        __try {
            // (a) Get the player Object*
            void* player = swg::endpoints::getPlayer ? swg::endpoints::getPlayer() : nullptr;
            if (!player) {
                Sleep(100);  // world not loaded yet
                continue;    // legal inside __try (no __finally involved)
            }

            // (b) Resolve the "focus object" for this iteration — CROSS-BUILD
            //     (05-CONTEXT decision #1b, ROUND 2). Defaults to the player;
            //     overridden below when a real target/selection resolves.
            void* focus = player;
            bool  hasTarget = false;
            bool  targetUnavailableOnBuild = false;

            if (swg::endpoints::isAdvertisedClient()) {
                // ADVERTISED: REAL two-step selected-object resolver.
                if (swg::endpoints::cuiHudGetInstance && swg::endpoints::cuiHudGetTarget) {
                    void* hudInstance = swg::endpoints::cuiHudGetInstance();
                    if (hudInstance) {
                        void* selected = swg::endpoints::cuiHudGetTarget(hudInstance);
                        if (selected) {
                            focus = selected;
                            hasTarget = true;
                        }
                    }
                    // Both slots resolved but nothing selected right now — a
                    // normal, expected state; targetUnavailableOnBuild stays
                    // false (the MECHANISM is available, just nothing chosen).
                } else {
                    // Either half of the two-step mechanism is genuinely
                    // unresolved — a build-capability gap, not "nothing
                    // selected."
                    targetUnavailableOnBuild = true;
                }
            } else {
                // LEGACY: unchanged +1432 lookAt-target chain (ROUND 2).
                if (swg::endpoints::getPlayerCreatureObject) {
                    void* playerCreature = swg::endpoints::getPlayerCreatureObject();
                    if (playerCreature) {
                        // VALIDATE LIVE — comment-backed, not independently
                        // source-proven (Utinni game.cpp:726-733); confirm
                        // during the 05-12 UAT.
                        void* cachedNetIdPtr =
                            reinterpret_cast<uint8_t*>(playerCreature) + 1432;
                        if (swg::endpoints::cachedNetworkIdGetObject) {
                            void* target =
                                swg::endpoints::cachedNetworkIdGetObject(cachedNetIdPtr);
                            if (target) {
                                focus = target;
                                hasTarget = true;
                            }
                        }
                    }
                }
                // Legacy's mechanism is a hard literal, never catalog-gated —
                // targetUnavailableOnBuild is always false on this path.
            }

            // (c) ROUND 5 — publish focusToken EVERY iteration (not only on
            //     a guard-checked apply), so the host's identity re-key can
            //     never lag or disagree with this agent's own re-key below.
            uint32_t focusToken =
                static_cast<uint32_t>(reinterpret_cast<uintptr_t>(focus));

            // (d) Read the focus object's world transform (TRANSFORM_BYTE_SIZE
            //     = 48 bytes, float[3][4] row-major — VERIFIED: swg_math.h:69)
            float xform[3][4] = {};
            if (swg::endpoints::getTransform_o2w) {
                void* xformPtr = swg::endpoints::getTransform_o2w(focus);
                if (xformPtr) {
                    std::memcpy(xform, xformPtr, TRANSFORM_BYTE_SIZE);
                }
            }

            // (e) Read the network ID (advertised-only accessor; legacy stays
            //     the not-applicable sentinel — REVIEWS.md Fix E, unchanged).
            uint64_t netId = 0;
            if (swg::endpoints::getNetworkId) {
                void* rawId = swg::endpoints::getNetworkId(focus);
                netId = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(rawId));
            }

            // (f) Read the object template name
            const char* tmplName = nullptr;
            if (swg::endpoints::getTemplateFilename) {
                tmplName = swg::endpoints::getTemplateFilename(focus);
            }

            // (g) ROUND 4 re-key + ROUND 6 identity cross-check (Opus 3c-ii):
            //     compares the raw focus pointer AND the CONTENT of
            //     templateName (never a pointer/reference compare — a pointer
            //     compare silently no-ops the fix on a reused frame buffer,
            //     or defeats tamper detection on a fresh per-frame buffer)
            //     AND networkId against the agent's OWNED captured-against
            //     snapshot. Either signal disagreeing re-arms the
            //     first-sentinel-passing-read capture below (restores D-03's
            //     "captured per object, once" model against the NEW focus).
            {
                const char* cmpName = tmplName ? tmplName : "";
                bool pointerMismatch  = (focus != s_expectedCapturedAgainst);
                bool templateMismatch = (std::strncmp(
                    cmpName, s_expectedCapturedAgainstTemplate, k_templateNameLen) != 0);
                bool networkIdMismatch =
                    (static_cast<int64_t>(netId) != s_expectedCapturedAgainstNetworkId);

                if (pointerMismatch || templateMismatch || networkIdMismatch) {
                    s_expectedCaptured = false;  // re-arm the capture path below
                    s_expectedCapturedAgainst = focus;
                    std::strncpy(s_expectedCapturedAgainstTemplate, cmpName,
                                 k_templateNameLen - 1);
                    s_expectedCapturedAgainstTemplate[k_templateNameLen - 1] = '\0';
                    s_expectedCapturedAgainstNetworkId = static_cast<int64_t>(netId);
                }
            }

            // (h) Read game liveness: main-loop counter delta + isOver flag
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

            // (i) Run all 4 sentinel checks (D-05: all must pass for a write)
            SentinelResult results[4];
            results[0] = checkTransform(&xform[0][0]);
            // networkId is advertised-path-only (getNetworkId has no legacy SWGEmu RVA).
            results[1] = swg::endpoints::getNetworkId
                             ? checkNetworkId(netId)
                             : SentinelResult{ true, nullptr };
            results[2] = checkTemplateName(tmplName, 256);
            results[3] = checkLiveness(player != nullptr, isOver, loopDelta);

            // (j) Write verified state to the seqlock channel
            if (allSentinelsPassed(results)) {
                LiveState state = {};
                std::memcpy(state.transform, xform, TRANSFORM_BYTE_SIZE);
                state.networkId = netId;
                if (tmplName) {
                    std::strncpy(state.templateName, tmplName, sizeof(state.templateName) - 1);
                    state.templateName[sizeof(state.templateName) - 1] = '\0';
                }
                // liveness: bit0=playerNonNull, bit1=isOver, bit2=hasTarget,
                // bit3=targetUnavailableOnBuild, bit4=scaleUnavailableOnBuild,
                // bit5=scaleGuardUnavailableOnBuild, bit6=agentFaultRecovered
                // (transient — consumed/cleared immediately below).
                uint32_t liveness =
                    (player ? 1u : 0u) |
                    (isOver ? 2u : 0u) |
                    (hasTarget ? 4u : 0u) |
                    (targetUnavailableOnBuild ? 8u : 0u) |
                    (s_scaleUnavailableOnBuild ? 16u : 0u) |
                    (s_scaleGuardUnavailableOnBuild ? 32u : 0u);
                if (s_agentFaultRecovered) {
                    liveness |= 64u;
                    // DOCUMENTED AGENT-ONLY telemetry this round (mirrors
                    // bit5's existing agent-only treatment) — no renderer/HUD
                    // consumer decodes bit6 this phase. Clear immediately so
                    // it publishes for exactly this one write.
                    s_agentFaultRecovered = false;
                }
                state.liveness = liveness;
                state.focusToken = focusToken;
                channelWrite(&state);
            }

            // (k) Genuine live m_scale read — the scale-guard's liveScale
            //     comparand, replacing a self-referential s_expectedScale
            //     feedback loop with real external-tamper-detection parity
            //     with Transform wherever the offset is confirmed for this
            //     build (2026-07-08 plan-check revision; RE-ARCHITECTED
            //     2026-07-09 to a member-offset read).
            float currentScale[3] = { s_expectedScale[0], s_expectedScale[1], s_expectedScale[2] };
            if (!swg::endpoints::isAdvertisedClient()) {
                // LEGACY: unconditional (kLegacyScaleOffset is always attempted).
                const float* scalePtr = reinterpret_cast<const float*>(
                    reinterpret_cast<const uint8_t*>(focus) + kLegacyScaleOffset);
                currentScale[0] = scalePtr[0];
                currentScale[1] = scalePtr[1];
                currentScale[2] = scalePtr[2];
            } else if (s_advertisedScaleOffsetConfirmed) {
                // ADVERTISED, CONFIRMED (never true this phase — reserved for
                // a future patch once the confirmation handoff responds).
                const float* scalePtr = reinterpret_cast<const float*>(
                    reinterpret_cast<const uint8_t*>(focus) + s_advertisedScaleOffset);
                currentScale[0] = scalePtr[0];
                currentScale[1] = scalePtr[1];
                currentScale[2] = scalePtr[2];
            }
            // else: ADVERTISED, UNCONFIRMED — currentScale stays the
            // self-compare fallback (== s_expectedScale) seeded above.
            // checkWriteGuard will report scalePassed=true this iteration
            // (never worse than round-1's behavior) — s_scaleGuardUnavailableOnBuild,
            // already published above, is what tells a downstream consumer
            // this pass is UNVERIFIED, not a confirmed-clean state.

            // (l) Capture the guard baseline from the FIRST sentinel-passing
            //     read after channel open OR after a focus-identity change
            //     (ROUND 4 — restores D-03's "captured per object, once"
            //     model; s_expectedCaptured was reset to false above on a
            //     re-key mismatch, re-arming this same path).
            if (!s_expectedCaptured && results[0].passed) {
                std::memcpy(s_expectedTransform, xform, TRANSFORM_BYTE_SIZE);
                if (!swg::endpoints::isAdvertisedClient() || s_advertisedScaleOffsetConfirmed) {
                    // Genuine live read available — seed from it directly.
                    s_expectedScale[0] = currentScale[0];
                    s_expectedScale[1] = currentScale[1];
                    s_expectedScale[2] = currentScale[2];
                }
                // else: ADVERTISED, UNCONFIRMED — leave s_expectedScale as-is
                // (round-1's documented scope note: the FIRST command's own
                // cmd.scale seeds it naturally via the post-apply refresh
                // below, since currentScale already self-compares to whatever
                // s_expectedScale currently holds).
                s_expectedCaptured = true;
            }

            // (m) Command-apply block — gated on a NEW, non-torn command
            //     (channelReadCommand already rejected torn reads by
            //     returning false; cmdSeq-newness prevents re-processing a
            //     stale/repeated command on the latest-wins slot). ROUND 4:
            //     the REBASELINE_GUARD mutation sits LEXICALLY INSIDE this
            //     SAME gate — it can execute at most ONCE per distinct
            //     command, never silently re-adopt a post-revert external
            //     tamper across repeated frames (closes the ungated-rebaseline
            //     guard defeat, REVIEWS.md round-3 decision #2).
            if (haveCmd && cmdSeq != lastAppliedCmdSeq) {
                if (cmd.flags & CMD_FLAG_REBASELINE_GUARD) {
                    // ROUND 2 COALESCE + ROUND 4: BOTH channels rebaseline to
                    // the LIVE value read/computed THIS SAME gated instant —
                    // transform from the fresh read this iteration, scale
                    // from the genuine currentScale member-offset read (never
                    // cmd.scale) — then fall through immediately into the
                    // normal guard+apply flow using these just-rebaselined
                    // values as the baseline and cmd's payload as the target.
                    // Do NOT skip the apply for a REBASELINE_GUARD command —
                    // round 1's mutually-exclusive design is what created the
                    // two-command race this closes.
                    std::memcpy(s_expectedTransform, xform, TRANSFORM_BYTE_SIZE);
                    s_expectedScale[0] = currentScale[0];
                    s_expectedScale[1] = currentScale[1];
                    s_expectedScale[2] = currentScale[2];
                }

                GuardResult guardResult = checkWriteGuard(
                    xform, s_expectedTransform, currentScale, s_expectedScale);
                applyWrite(focus, cmd, guardResult);

                uint32_t guardFlags = 0;
                if (!guardResult.transformPassed) {
                    guardFlags |= GUARD_FLAG_TRANSFORM_REFUSED;
                }
                // ROUND 2 W2 fix: SCALE_REFUSED requires BOTH a genuine
                // mismatch AND a resolved setter — an unresolved setScale is
                // reported ONLY via the one-time scaleUnavailableOnBuild
                // liveness bit, never here (closes the false-tamper-banner
                // class of bug on a build where Scale is simply unresolved).
                if (!guardResult.scalePassed && swg::endpoints::setScale != nullptr) {
                    guardFlags |= GUARD_FLAG_SCALE_REFUSED;
                }

                if (guardResult.transformPassed) {
                    // Fix D: refresh from a FRESH read-back, not cmd.transform
                    // — survives STATIC interior/non-world-cell float-rounded
                    // storage without false-failing write N+1. CAVEAT: for a
                    // dynamically-moving parent (m_attachedToObject =
                    // mount/vehicle/POB ship) this world-space read-back
                    // drifts every frame and WILL false-fail the guard on
                    // write N+1 — fails safe, documented, not fixed here.
                    if (swg::endpoints::getTransform_o2w) {
                        void* freshXformPtr = swg::endpoints::getTransform_o2w(focus);
                        if (freshXformPtr) {
                            std::memcpy(s_expectedTransform, freshXformPtr, TRANSFORM_BYTE_SIZE);
                        }
                    }
                }
                if (guardResult.scalePassed) {
                    // setScale stores verbatim (m_scale = scale;,
                    // Object.cpp:2205) so cmd.scale IS what was actually
                    // stored — no read-back needed for THIS baseline-refresh
                    // purpose (a different purpose from currentScale's
                    // per-iteration GUARD read above).
                    s_expectedScale[0] = cmd.scale[0];
                    s_expectedScale[1] = cmd.scale[1];
                    s_expectedScale[2] = cmd.scale[2];
                }

                channelWriteGuardStatus(guardFlags, focusToken);
                lastAppliedCmdSeq = cmdSeq;
            }
        } __except (EXCEPTION_EXECUTE_HANDLER) {
            // A fault on a freed/relocated Object*/SwgCuiHud* mid-poll (the
            // sim thread tearing the object down) — never call a setter, let
            // this iteration's read/apply be abandoned, publish the transient
            // telemetry bit on the NEXT successful write (see (j) above).
            s_agentFaultRecovered = true;
        }

        Sleep(16);  // ~60fps polling (05-03 — raised from ~30fps)
    }

    return 0;  // unreachable — the loop only exits via the STOP_REQUESTED return above
}
