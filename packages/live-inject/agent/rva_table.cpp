/**
 * rva_table.cpp — Legacy known-RVA literals harvested from Utinni source.
 *
 * These slots are used when isAdvertisedClient() is false (legacy SWGEmu without
 * GetEngineHookPoints export). On the advertised-client path, resolve() overwrites
 * each slot by name from the GetEngineHookPoints table.
 *
 * CALLING-CONVENTION RULE: Use MSVC __thiscall directly for member function pointers.
 * Do NOT hand-emulate __fastcall(ECX,EDX,args) — MSVC __thiscall does ECX-this
 * passing automatically. Typedefs ported verbatim from Utinni source.
 * void* used for opaque SWG types (Object*, Transform*) to avoid header deps.
 *
 * Sources (ground truth):
 *   D:/Code/Utinni/UtinniCore/swg/object/object.cpp:43-190
 *   D:/Code/Utinni/UtinniCore/swg/game/game.cpp:41-98
 *   D:/Code/Utinni/UtinniCore/swg/misc/network.cpp:30-58
 */

#include "resolve.h"
#include <Windows.h>
#include <cstdint>

// ============================================================
// Calling-convention typedefs — ported verbatim from Utinni.
// void* used for opaque SWG types (Object*, Transform*) to keep
// this file self-contained without the full SWG type hierarchy.
// ============================================================

// VERIFIED: object.cpp:101 — __thiscall member fn, returns Transform* (opaque void*)
typedef void*(__thiscall*       pGetTransform_o2w)(void*);
// VERIFIED: object.cpp:129 — __thiscall member fn, returns const char*
typedef const char*(__thiscall* pGetTemplateFilename)(void*);
// VERIFIED: game.cpp:49 — __cdecl free fn, returns Object* (opaque void*)
typedef void*(__cdecl*          pGetPlayer)();
// VERIFIED: game.cpp:90 — __cdecl free fn, returns int (main loop counter accessor)
typedef int(__cdecl*            pMainLoopCount)();
// Advertised-only accessor for the "isOver" safety-flag (game.cpp:81-82, no SWGEmu RVA)
typedef bool(__cdecl*           pIsOver)();

namespace swg { namespace endpoints {

// ============================================================
// Function pointer slots — initialized to legacy RVA literals.
// Binding array points directly at these via (void**)&variable.
// On the advertised-client path, resolve() overwrites each slot by name.
// On the legacy SWGEmu path, RVA literals remain active.
// ============================================================

// --- object::getTransform_o2w ---
// VERIFIED: Utinni object.cpp:101 (typedef), object.cpp:146 (RVA literal)
pGetTransform_o2w getTransform_o2w = (pGetTransform_o2w)0x00B22C80;

// --- game::getPlayer ---
// VERIFIED: Utinni game.cpp:49 (typedef), game.cpp:65 (RVA literal)
pGetPlayer getPlayer = (pGetPlayer)0x00425140;

// --- object::getObjectTemplateName (legacy substitute: getTemplateFilename) ---
// VERIFIED: Utinni object.cpp:129 (typedef), object.cpp:174 (RVA literal).
// The legacy SWGEmu getTemplateFilename serves as the substitute for the
// advertised getObjectTemplateName slot (Utinni object.cpp:176-189).
// On the advertised path, "object::getObjectTemplateName" overwrites this slot.
pGetTemplateFilename getTemplateFilename = (pGetTemplateFilename)0x00B23C40;

// --- game::g_mainLoopCounter — read global directly on SWGEmu path ---
// VERIFIED: Utinni game.cpp:87,91 — SWGEmu: read the loop counter global at
// k_mainLoopCounter_addr directly: *(int*)k_mainLoopCounter_addr.
// Advertised client: slot resolves to &Game::getMainLoopCount (call-not-read accessor).
extern const uintptr_t k_mainLoopCounter_addr = 0x1908830;  // external linkage for agent_main.cpp
pMainLoopCount g_mainLoopCounter = nullptr;  // null until advertised-client resolves it

// --- game::g_runningFlags / isOver ---
// STILL UNVERIFIED for legacy SWGEmu path — read Utinni game.cpp:74-82.
// From game.cpp: "There is NO SWGEmu RVA literal — the consumer's isSafeToUse()
// reads two engine safety-flag globals directly via memory::read on the SWGEmu path.
// The slot starts null and resolves only on the advertised client."
// Legacy Phase-3 liveness check uses k_mainLoopCounter_addr advancing as the sentinel.
// STILL UNVERIFIED — legacy path uses memory::read, not a function pointer.
pIsOver g_runningFlags = nullptr;

// --- object::getNetworkId ---
// STILL UNVERIFIED for legacy SWGEmu path — no RVA found in files read.
// From Utinni object.cpp:176-189: "Phase 24 / D-01 full-catalog rows... NO SWGEmu RVA
// (no existing consumer call-site); slot starts null, resolves only on advertised client."
// Legacy networkId retrieved via playerCreature struct offset (+1432, per game.cpp:702-711).
// Phase-3 legacy gate uses 3.5/4 sentinels (transform + templateFilename + liveness);
// networkId sentinel deferred to Phase-5 for the legacy path.
// STILL UNVERIFIED — no RVA found in files read; advertised-only slot.
typedef void*(__thiscall* pGetNetworkId)(void*);
pGetNetworkId getNetworkId = nullptr;

// ============================================================
// Binding array — maps advertised contract names to slot storage cells.
// resolve() iterates this to overwrite slots by name (advertised path).
// On the legacy SWGEmu path, resolve() is never called; RVA literals remain.
// Pattern: (void**)&typed_fn_ptr — same as Utinni endpoints_bindings.cpp.
// ============================================================

Binding g_agentBindings[] = {
    {"object::getTransform_o2w",      (void**)&getTransform_o2w},
    {"object::getObjectTemplateName", (void**)&getTemplateFilename},  // legacy substitute
    {"game::getPlayer",               (void**)&getPlayer},
    {"game::g_mainLoopCounter",       (void**)&g_mainLoopCounter},
    {"game::g_runningFlags",          (void**)&g_runningFlags},
    {"object::getNetworkId",          (void**)&getNetworkId},
};
size_t g_agentBindingCount = sizeof(g_agentBindings) / sizeof(g_agentBindings[0]);

}} // namespace swg::endpoints
