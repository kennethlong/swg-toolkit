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
 *   D:/Code/swg-client-v2/.../engine_advertise.cpp:705-709 (cross-build target resolution, 05-03)
 *
 * 05-03 ADDITIONS (write-slot + cross-build target resolution):
 *   setTransform_o2w / setScale — the guarded write endpoints (REVIEWS.md BLOCKER
 *   fix A — setScale is seeded nullptr, NEVER a stale legacy literal on the
 *   advertised build; agent_main.cpp's agent_init conditionally seeds it AFTER
 *   confirming isAdvertisedClient()==false).
 *   getPlayerCreatureObject / cachedNetworkIdGetObject — LEGACY-ONLY target
 *   resolution (the +1432 lookAt-target chain), gated at every call site in
 *   agent_main.cpp behind an explicit !isAdvertisedClient() check — never
 *   bound in g_agentBindings[] (a legacy-literal-only pair).
 *   getObjectByIdLegacy / getObjectByIdAdvertised — a cross-build generic
 *   NetworkId->Object* resolver, bound on BOTH builds as a reusable primitive
 *   (project's "SWGEmu never descoped" rule) but NOT on the active per-frame
 *   focus-resolution path this phase (05-CONTEXT decision #1b).
 *   cuiHudGetInstance / cuiHudGetTarget — the ADVERTISED build's real TWO-STEP
 *   selected-object resolver (engine_advertise.cpp:706/:705), the ACTIVE
 *   advertised-path focus-resolution mechanism.
 *   No getScale/m_scale binding exists in this file — the scale-guard
 *   comparand is a member-offset read owned entirely by agent_main.cpp
 *   (Object::getScale() is inline with no standalone address, 2026-07-09).
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

// --- 05-03: write-slot typedefs ---
// VERIFIED: object.cpp:148 (setTransform_o2w), object.cpp:155 (setScale) — both
// __thiscall member fns, opaque Transform*/Vector* args (void*, mirrors the
// existing pGetTransform_o2w opaque-pointer convention — no concrete struct dep).
typedef void(__thiscall*        pSetTransform_o2w)(void*, const void*);
typedef void(__thiscall*        pSetScale)(void*, const void*);

// --- 05-03: legacy-only target-resolution typedefs (ROUND 2, UNCHANGED) ---
// VERIFIED: game.cpp:74 — __cdecl free fn, returns Object* (opaque void*)
typedef void*(__cdecl*          pGetPlayerCreatureObject)();
// VERIFIED: network.cpp:35 typedef, :42 literal — __thiscall, pThis = the
// CachedNetworkId pointer computed from the +1432 target-slot offset.
typedef void*(__thiscall*       pCachedNetworkIdGetObject)(void*);

// --- 05-03: cross-build getObjectById primitive typedefs (ROUND 2, reusable,
//     NOT on the active focus-resolution path this phase) ---
// VERIFIED: network.cpp:32 typedef, :39 literal — __cdecl static, const int64_t& id.
typedef void*(__cdecl*          pIdManagerGetObjectById)(const int64_t& id);
// CONFIRMED (2026-07-09 de-anchoring crew): engine_advertise.cpp:709,
// "network::getObjectById" -> &NetworkIdManager::getObjectById,
// static Object* NetworkIdManager::getObjectById(const NetworkId&), __cdecl.
// NetworkId argument treated as an opaque pointer-sized value (no existing
// NetworkId-shaped slot in this file to confirm a concrete representation
// against) — never called this phase (advertised getObjectById-equivalent is
// a reusable primitive, not the active resolver; see cuiHudGetTarget below).
typedef void*(__cdecl*          pNetworkIdManagerGetObjectById)(const void* networkId);

// --- 05-03: advertised TWO-STEP selected-object resolver typedefs (ROUND 2,
//     CONFIRMED 2026-07-09 — the ACTIVE advertised-path focus mechanism) ---
// CONFIRMED: engine_advertise.cpp:706, "cuiHud::g_instance" ->
// &SwgCuiHudFactory::findMediatorForCurrentHud, a STATIC zero-arg accessor.
// __cdecl per this file's established zero-arg-static-accessor convention
// (config::loadOverrideConfig / the sibling cuiIo::g_instance row).
typedef void*(__cdecl*          pCuiHudGetInstance)();
// CONFIRMED: engine_advertise.cpp:705, "cuiHud::getTarget" (NAME-MISMATCHED in
// the catalog — a getter, not a setter) -> &engine_hudGetLastSelectedObject, a
// __fastcall(SwgCuiHud*, int) call-through thunk over
// SwgCuiHud::getLastSelectedObject() const; the DLL source's own comment states
// the consumer typedef explicitly as Object*(__thiscall*)(SwgCuiHud*) — use
// __thiscall here, NOT __fastcall, matching that comment exactly.
typedef void*(__thiscall*       pCuiHudGetTarget)(void*);

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

// --- object::setTransform_o2w ---
// VERIFIED: Utinni object.cpp:148 (RVA literal). CONFIRMED advertised
// (engine_advertise.cpp:578/850) — safe to unconditionally seed with the
// legacy RVA: resolve() overwrites it by name on the advertised path, and the
// legacy literal is correct on the legacy path (no BLOCKER risk here, unlike
// setScale below — this endpoint IS confirmed advertised).
pSetTransform_o2w setTransform_o2w = (pSetTransform_o2w)0x00B22CC0;

// --- object::setScale ---
// VERIFIED: Utinni object.cpp:155 (RVA literal). BLOCKER FIX (REVIEWS.md Fix
// A) — seeded nullptr, NEVER the legacy literal, at declare time. resolve()'s
// graceful-degrade contract leaves an unresolved advertised slot UNTOUCHED, so
// seeding this with the legacy RVA here would leave a stale, invalid absolute
// address callable on the advertised build after a name-miss. The legacy RVA
// is applied ONLY by agent_main.cpp's agent_init, AFTER resolveFromExe() has
// confirmed isAdvertisedClient()==false (post-resolve conditional seed).
// object::setScale is a KNOWN GAP on the advertised build until the maintainer
// adds the upstream catalog row (user_setup, D-09) — until then this slot
// stays nullptr on advertised, and applyWrite/agent_main.cpp never call an
// unresolved setter.
pSetScale setScale = nullptr;

// --- 05-03 ROUND 2: legacy-only target-resolution slots (UNCHANGED from
//     round 1) — LEGACY-ONLY literals, gated at every call site in
//     agent_main.cpp behind an explicit !isAdvertisedClient() check; no
//     binding-array row (no advertised catalog name exists for either). ---

// VERIFIED: Utinni game.cpp:74 (RVA literal) — the CreatureObject wrapper the
// +1432 target-slot offset is measured FROM. LEGACY-ONLY target resolution;
// gate on !isAdvertisedClient() at the call site (agent_main.cpp).
pGetPlayerCreatureObject getPlayerCreatureObject = (pGetPlayerCreatureObject)0x004251D0;

// VERIFIED: Utinni network.cpp:35 (typedef), :42 (RVA literal) — resolves a
// CachedNetworkId pointer to an Object*. LEGACY-ONLY; gate on
// !isAdvertisedClient() at the call site (mirrors Utinni's own
// Network::getCachedObjectById gate, network.cpp:74-85).
// VALIDATE LIVE — the +1432 target-slot arithmetic feeding this call is
// comment-backed (Utinni game.cpp:726-733), not independently source-proven;
// confirm during the 05-12 UAT.
pCachedNetworkIdGetObject cachedNetworkIdGetObject = (pCachedNetworkIdGetObject)0x00B30160;

// --- 05-03 ROUND 2: cross-build getObjectById primitives (reusable, NOT on
//     the active per-frame focus-resolution path this phase — see file
//     header). ---

// VERIFIED: Utinni network.cpp:32 (typedef), :39 (RVA literal). LEGACY-ONLY
// literal — if ever called (not this phase), gate on !isAdvertisedClient() at
// the call site, mirroring the other two legacy-only slots above. Bound per
// the project's "SWGEmu never descoped" rule; the ACTIVE legacy focus path
// uses the CachedNetworkId sibling 0x00B30160 (via the +1432 chain) instead —
// Object::networkId (object.h:86) IS a real field, legacy is not incapable of
// targeting; this is simply a reusable, more-generic primitive for a future
// networkId-driven flow. No binding-array row (legacy literal only).
pIdManagerGetObjectById getObjectByIdLegacy = (pIdManagerGetObjectById)0x00B380E0;

// CONFIRMED 2026-07-09: engine_advertise.cpp:709, "network::getObjectById" ->
// &NetworkIdManager::getObjectById. Null-safe (mirrors setScale's pattern) —
// bound via g_agentBindings[] below; not on the active advertised
// focus-resolution path (the two-step cuiHud resolver below is active).
pNetworkIdManagerGetObjectById getObjectByIdAdvertised = nullptr;

// --- 05-03 ROUND 2: advertised TWO-STEP selected-object resolver (CONFIRMED
//     2026-07-09) — the ACTIVE advertised-path focus-resolution mechanism.
//     Both slots null-safe (mirrors setScale's pattern); bound via
//     g_agentBindings[] below. Call cuiHudGetInstance() FIRST, then
//     cuiHudGetTarget(instance) SECOND, passing step 1's result. ---
pCuiHudGetInstance cuiHudGetInstance = nullptr;
pCuiHudGetTarget    cuiHudGetTarget   = nullptr;

// --- Slice-0 step 4: advertised live-camera matrix accessors (Goal B Wave-3
//     rider 4C, engine_advertise.cpp:462-493). Copy-out primitives feeding the
//     in-game ImGuizmo overlay its view + projection. int(float*) -> 1 ok / 0 no
//     current camera (or null arg). Layouts (ground truth, verified 2026-07-19):
//       getTransformO2W(out12): row-major 3x4, columns = local frame i/j/k,
//                               column 3 = position (== Transform's own layout).
//       getProjectionMatrix(out16): the engine GlMatrix4x4 verbatim, row-major 4x4.
//     ADVERTISED-ONLY: no legacy SWGEmu RVA (Utinni's legacy path reads the
//     GroundScene camera raw, NGE-unsafe); slots start null and resolve by name.
//     overlay.cpp branches on null (the gizmo stays dark rather than reading a
//     raw/mis-offset layout). ---
typedef int(__cdecl* pCameraGetMatrix)(float*);
pCameraGetMatrix cameraGetTransformO2W     = nullptr;
pCameraGetMatrix cameraGetProjectionMatrix = nullptr;

// --- AllowTargetAnything: the advertised NGE targeting-filter gate (rider 4B,
//     Utinni cui_hud.cpp:297 / engine_advertise.cpp:789). setAllowTargetAnything(true)
//     lets the targeting reticle lock onto ANY object (static scenery, props,
//     structures) — not just creatures/NPCs — so the gizmo can edit anything the
//     focus resolver picks up. ADVERTISED-ONLY: the legacy path is a byte-patch at
//     0x00BD3FA3 that corrupts relocated NGE CUI code (NEVER used here). Slots start
//     null and resolve by name; both static (__cdecl). ---
typedef void(__cdecl* pSetAllowTargetAnything)(bool);
typedef bool(__cdecl* pGetAllowTargetAnything)();
pSetAllowTargetAnything setAllowTargetAnything = nullptr;
pGetAllowTargetAnything getAllowTargetAnything = nullptr;

// --- Object insertion + .ws persistence: the advertised worldSnapshot editor
//     (Goal B Waves 1-3, frozen 2026-07-18; engine_advertise.cpp:769-782).
//     Primitives-only / ABI-safe, ADVERTISED-ONLY, game-thread-only. transform12 is
//     the row-major 3x4 (cols i/j/k, col3 position) — the SAME format getTransform_o2w
//     returns and setTransform_o2w takes. wsAddObject spawns immediately and returns
//     the new node id (0 = fail-closed). wsSaveSnapshot returns a typed result
//     (0 ok, 1 no-snapshot, 2 no-loose-search-path, 3 destination-shadowed,
//     4 id-int32-overflow, 5 buildout-set-integrity, 6 write-failure). ---
typedef int64_t(__cdecl* pWsAddObject)(const char* tmpl, const float* transform12, int64_t containedById);
typedef int(__cdecl*     pWsSaveSnapshot)();
typedef int(__cdecl*     pWsGetSavePath)(char* buf, int cap);
typedef void(__cdecl*    pWsUnloadSnapshot)();
typedef int(__cdecl*     pWsSetNodeTemplateName)(int64_t id, const char* name); // v23: in-place .ws node template re-point (model-D lossless rebind)
typedef void(__cdecl*    pWsLoad)(const char* sceneName);   // static WorldSnapshot::load(char const*)
typedef int(__cdecl*     pGetSceneId)(char* buf, int cap);  // game::getSceneId (v21 copy-out, size-first)
// --- 05.1-09: wsRemoveNode (advertised, engine_advertise.cpp:993, WorldSnapshot.cpp:2348-2358).
//     utinni_wsRemoveNode(networkIdInt) -> 1 removed / 0 miss (id-less/buildout-provenance node,
//     the engine's OWN wsIsBuildoutNode guard refuses these — T-05.1-09a's actual enforcement
//     boundary, not caller discipline) / -1 occupied (try again). SCOPE: this-session
//     wsAddObject-minted preview nodes ONLY — never called on an id-less .ilf-sourced decoration
//     (RESEARCH Pitfall 2/4); the caller (Plan 13's live-despawn case) is responsible for only
//     ever sending ids it tracked from its own wsAddObject spawns. ---
typedef int(__cdecl*     pWsRemoveNode)(int64_t networkIdInt);
pWsAddObject      wsAddObject      = nullptr;
pWsSaveSnapshot   wsSaveSnapshot   = nullptr;
pWsGetSavePath    wsGetSavePath    = nullptr;
pWsUnloadSnapshot wsUnloadSnapshot = nullptr;
pWsSetNodeTemplateName wsSetNodeTemplateName = nullptr;
pWsLoad           wsLoad           = nullptr;
pGetSceneId       getSceneId       = nullptr;
pWsRemoveNode     wsRemoveNode     = nullptr;

// --- Ray-pick (advertised v20, provider handback 2026-07-19). Copy-out cursor
//     ray-cast from the current camera through client-window pixel (x,y):
//     returns 1=hit / 0=miss; outPoint3 = world x,y,z of the nearest hit;
//     outHitObjectId = the hit object's NetworkId (0 for a terrain hit — STILL a
//     valid hit; walks up Object::getParent() to the nearest NETWORKED ancestor
//     for non-networked child parts). objectsOnly: 1 = client objects only,
//     0 = include terrain/geometry (use 0 for placement). ADVERTISED-ONLY,
//     game-thread-only, per-frame-safe. ---
typedef int(__cdecl* pCollideScreenRay)(int screenX, int screenY, int objectsOnly, int64_t* outHitObjectId, float* outPoint3);
pCollideScreenRay collideScreenRay = nullptr;

// --- Borrowed-Object* pick (advertised v22, provider handback 2026-07-19). Same ray
//     as collideScreenRay but returns the RAW nearest-hit Object* (no ancestor walk, no
//     id resolution) — the ONLY way to reach a pure id-less .ilf decoration. Null = miss.
//     BORROWED, game-thread-only; clear on cell/zone change, never cache across a zone. ---
typedef void*(__cdecl* pCollideScreenRayObject)(int screenX, int screenY, int objectsOnly);
pCollideScreenRayObject collideScreenRayObject = nullptr;

// --- Object o2p read (advertised v24, provider handback 2026-07-19). Copy-out of
//     Object::getTransform_o2p() (inline / const Transform& -> shim mandatory) as a
//     row-major 3x4 (cols i/j/k, col3 position) -- byte-for-byte camera::getTransformO2W's
//     layout and the .ilf transform convention. 1 ok / 0 null-object-or-arg. The Object* is
//     the BORROWED pointer from collideScreenRayObject; same lifetime discipline (clear on
//     cell/zone change, never cache across a zone). Feeds resolveRowIndex at pick time and
//     editNodeTransform at persist time -- the last accessor of the model-D loop. ---
typedef int(__cdecl* pGetObjectTransformO2P)(void* object, float* out12);
pGetObjectTransformO2P getObjectTransformO2P = nullptr;

// --- Containing-building resolver (advertised REQUEST 2026-07-30, pending). Given any
//     cell-contained object (an id-less .ilf decoration), returns the POB building's NetworkId
//     (== its .ws node id) via getParentCell()->getPortalProperty()->getOwner()->getNetworkId().
//     collideScreenRay returns 0 for a decoration and the CELL id for a wall click (neither is
//     the building), and object::getParent is not advertised, so this is the only path to the
//     building the wsSetNodeTemplateName rebind + derived template need. 0 = not in a POB.
//     Slot stays null until the provider ships the row; overlay falls back to the click pick. ---
typedef int64_t(__cdecl* pGetContainingBuildingId)(void* object);
pGetContainingBuildingId getContainingBuildingId = nullptr;

// --- Cell parentage + teleport-safety rows (advertised v27/v28, provider handbacks
//     2026-08-02). Together these are the engine's OWN authored-move idiom, which
//     GroundScene.cpp:1492-1497 performs verbatim:
//
//         setParentCell(C); setPortalTransitionsEnabled(false);
//         setTransform_o2p(...); setPortalTransitionsEnabled(true); objectWarped(p);
//
//     Why the bracket is not optional: the portal line-sweep is a side effect of the
//     TRANSFORM WRITE (CellPropertyNamespace::Notification hooks positionChanged at
//     priority -100, CellProperty.cpp:150-176) — NOT of setParentCell, which only fires
//     cellChanged. On a portal hit the sweep reparents the object itself and returns
//     false, which ABORTS the remaining notifications (Object.cpp:240-246), silently
//     skipping the DPVS occlusion and collision updates for that write. Measured live
//     pre-v28: 28 DOORHIT-WAKE events per teleport.
//
//     ⚠ setPortalTransitionsEnabled is GLOBAL, UNSCOPED state — no RAII, no refcount
//     (provider's explicit warning). A leaked `false` disables portal transitions for the
//     REST OF THE SESSION and the symptom looks nothing like the cause. It is called from
//     exactly ONE place: overlay.cpp's PortalTransitionGuard destructor-backed wrapper.
//     Do not add a second call site.
//
//     getAttachedTo is a SAFETY row, not a convenience: setParentCell on a MOUNTED player
//     silently corrupts its pose in Release (the DEBUG_FATAL at Object.cpp:1396 is #if 0'd;
//     attachToObject_p re-enters detachFromObject(DF_none), whose :2002 overwrites the
//     correctly-computed m_objectToParent). Non-null => refuse the reparent.
//
//     findCellAtWorldPosition NEVER returns null (world-cell fallback), so its result is
//     always a legal setParentCell argument — which matters because setParentCell FATALs on
//     null (NOT_NULL, Object.cpp:1389). Never pass null to mean "outside"; that is what
//     getWorldCellProperty is for.
//
//     NOTE getParentCell deliberately walks THROUGH mount attachment to the ambient cell
//     (shared m_attachedToObject field, Object.cpp:1372-1383), so it is NOT a mount probe.
//     All game-thread-only. ---
typedef void*(__thiscall* pGetParentCell)(void* object);              // CellProperty*; opaque, never deref
typedef int(__cdecl*      pSetParentCell)(void* object, void* cell);  // v27: 1 ok / 0 refused
typedef void*(__cdecl*    pGetWorldCellProperty)();                   // v27: world-cell sentinel
typedef void(__cdecl*     pSetPortalTransitionsEnabled)(bool);        // v28: GLOBAL — see warning above
typedef void(__cdecl*     pObjectWarped)(void* object);               // v28: collision resync after a discontinuous move
typedef void*(__cdecl*    pFindCellAtWorldPosition)(float x, float y, float z); // v28: never null
typedef void*(__cdecl*    pGetAttachedTo)(void* object);              // v28: parent object or 0
pGetParentCell               getParentCell               = nullptr;
pSetParentCell               setParentCell               = nullptr;
pGetWorldCellProperty        getWorldCellProperty        = nullptr;
pSetPortalTransitionsEnabled setPortalTransitionsEnabled = nullptr;
pObjectWarped                objectWarped                = nullptr;
pFindCellAtWorldPosition     findCellAtWorldPosition     = nullptr;
pGetAttachedTo               getAttachedTo               = nullptr;

// --- Non-forcing parse-completion poll (advertised v28, provider handback 2026-08-02).
//     1 = snapshot parse in flight (world still rebuilding), 0 = idle/complete.
//     This is the ONLY ws* row with no finishLoadNow() prologue — it is deliberately pure,
//     and the provider shipped it so we would stop forcing. It lets the deferred Reload ack
//     mean "world rebuilt" instead of "the call was made", with no synchronous parse.
//
//     ⚠ Do NOT substitute any of these; each silently reintroduces a bug we already fixed:
//       - wsGetNodeCount  FORCE-FINISHES (WorldSnapshot.cpp:1780) -> ~1-2s client freeze per
//         reload. This plan's earlier design did exactly that and it was retired.
//       - wsGetGeneration bumps on load/unload only -> says nothing about the parse.
//       - getLoadingPercent returns 0 WHILE parsing and then a preload percentage -> the 0
//         is ambiguous (WorldSnapshot.cpp:983). ---
typedef int(__cdecl* pWsIsParsePending)();
pWsIsParsePending wsIsParsePending = nullptr;

// --- Editor scene load (advertised 2026-06-25, engine_advertise.cpp:321). FULL offline
//     scene-load via the SceneCreator lifecycle: sets Game::setSinglePlayer(true) then
//     Game::setScene(true, terrain, player, nullptr). No server session -> the snapshot layer
//     spawns every building itself (no SceneCreateObject replacement), which is the canonical
//     context to SEE a model-D rebind (derived template + edited .ilf) in-world.
//     ⚠ Swaps the scene: never call while a live server session should be preserved.
//     playerFilename must be a loadable object template or GroundScene::ctor FATALs. ---
typedef void(__cdecl* pGameLoadScene)(const char* terrainFilename, const char* playerFilename);
pGameLoadScene gameLoadScene = nullptr;

// --- Scene teardown (advertised, engine_hookpoints.inc:77 / catalog "game::cleanupScene").
//     05.1-16 CHECKPOINT FINDING: gameLoadScene alone FATALs when a scene is ALREADY live
//     (InputScheme.cpp:480 "fetchGroundInputMap called on a new player without releasing old
//     one") — it crashes in-world but SUCCEEDS from the login screen, where there is no
//     GroundScene/player to release. Ground truth for the correct sequence is Utinni's own
//     hkMainLoop TWO-FRAME state machine (game.cpp:499-554), which is NOT "cleanup then load"
//     in one call: frame N runs Game::cleanupScene() and latches sceneCleaned=true; frame N+1
//     runs loadScene. The engine gets a full tick between teardown and construction. ---
typedef void(__cdecl* pGameCleanupScene)();
pGameCleanupScene gameCleanupScene = nullptr;

// --- Per-frame game-thread tick (advertised, engine_hookpoints.inc:74 / catalog "game::mainLoop"
//     -> &Game::runGameLoopOnce, engine_advertise.cpp:743). 05.1-16: the PREFERRED drain point for
//     the deferred scene-swap command queue — DISTINCT from "game::g_mainLoopCounter" above (->
//     &Game::getMainLoopCount, a call-not-read counter ACCESSOR, not the tick itself). mainLoop is
//     the real per-frame function: Utinni already detours this exact address for the identical
//     purpose (hkMainLoop, game.cpp:460-553, including its own advertised game::loadScene call —
//     proven precedent for issuing a scene load from here, never from inside Present). EXACT
//     __cdecl(bool,HWND,int,int) signature match confirmed by the advertise-side comment
//     ("24-4a RE-POINT ... EXACT __cdecl signature match to Utinni hkMainLoop"). ADVERTISED-ONLY —
//     no legacy SWGEmu RVA known/verified for this entry point in this codebase; overlay.cpp falls
//     back to a post-Present drain when this slot is unresolved (see 05.1-16-PLAN.md). ---
typedef void(__cdecl* pMainLoop)(bool presentToWindow, HWND hwnd, int width, int height);
pMainLoop mainLoop = nullptr;

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
    // --- 05-03: write-slot + cross-build target-resolution rows ---
    {"object::setTransform_o2w",      (void**)&setTransform_o2w},
    {"object::setScale",              (void**)&setScale},  // D-09 known gap — resolves once the upstream row exists
    {"network::getObjectById",        (void**)&getObjectByIdAdvertised},  // reusable primitive, engine_advertise.cpp:709
    {"cuiHud::g_instance",            (void**)&cuiHudGetInstance},        // engine_advertise.cpp:706
    {"cuiHud::getTarget",             (void**)&cuiHudGetTarget},          // engine_advertise.cpp:705
    // --- Slice-0 step 4: live-camera matrix accessors (advertised-only) ---
    {"camera::getTransformO2W",       (void**)&cameraGetTransformO2W},    // engine_advertise.cpp:795
    {"camera::getProjectionMatrix",   (void**)&cameraGetProjectionMatrix},// engine_advertise.cpp:794
    // --- AllowTargetAnything: select any in-world object (advertised-only) ---
    {"cuiPreferences::setAllowTargetAnything", (void**)&setAllowTargetAnything}, // engine_advertise.cpp:789
    {"cuiPreferences::getAllowTargetAnything", (void**)&getAllowTargetAnything}, // engine_advertise.cpp:790
    // --- Object insertion + .ws persistence (advertised worldSnapshot editor) ---
    {"worldSnapshot::wsAddObject",      (void**)&wsAddObject},      // engine_advertise.cpp:769
    {"worldSnapshot::wsSaveSnapshot",   (void**)&wsSaveSnapshot},   // engine_advertise.cpp:780
    {"worldSnapshot::wsGetSavePath",    (void**)&wsGetSavePath},    // engine_advertise.cpp:781
    {"worldSnapshot::wsUnloadSnapshot", (void**)&wsUnloadSnapshot}, // engine_advertise.cpp:782
    {"worldSnapshot::wsSetNodeTemplateName", (void**)&wsSetNodeTemplateName}, // v23 handback (model-D lossless rebind)
    {"worldSnapshot::load",             (void**)&wsLoad},           // engine_advertise.cpp:726 (load/reload a scene)
    {"game::getSceneId",                (void**)&getSceneId},       // v21 handback (one-click reload / .ws auto-name)
    {"worldSnapshot::wsRemoveNode",     (void**)&wsRemoveNode},     // engine_advertise.cpp:993 — 1/0/-1; this-session preview-node despawn only (05.1-09)
    // --- Ray-pick (advertised v20 handback 2026-07-19) ---
    {"clientWorld::collideScreenRay",       (void**)&collideScreenRay},
    {"clientWorld::collideScreenRayObject", (void**)&collideScreenRayObject}, // v22: borrowed Object* pick
    {"object::getTransformO2P",             (void**)&getObjectTransformO2P},   // v24: copy-out o2p (last model-D accessor)
    {"object::getContainingBuildingId",     (void**)&getContainingBuildingId}, // v25 handback 2026-07-30: cell→building (proven live)
    {"game::loadScene",                     (void**)&gameLoadScene},           // offline editor scene (single-player; model-D visible-verify context)
    {"game::mainLoop",                      (void**)&mainLoop},                // 05.1-16: per-frame tick — deferred-queue drain point OUTSIDE Present
    {"game::cleanupScene",                  (void**)&gameCleanupScene},        // 05.1-16: MUST run a frame BEFORE loadScene when a scene is live (Utinni game.cpp:548-554)
    // --- Cell parentage + teleport safety (v27/v28 handbacks 2026-08-02) — see the block comment above ---
    {"object::getParentCell",                  (void**)&getParentCell},                  // already advertised pre-v27; NOT a mount probe
    {"object::setParentCell",                  (void**)&setParentCell},                  // v27 — FATALs on a null cell; pass getWorldCellProperty for "outside"
    {"cellProperty::getWorldCellProperty",     (void**)&getWorldCellProperty},           // v27 — the only legal way to say "reparent out"
    {"cellProperty::setPortalTransitionsEnabled", (void**)&setPortalTransitionsEnabled}, // v28 — GLOBAL unscoped; ONE call site only (PortalTransitionGuard)
    {"collisionWorld::objectWarped",           (void**)&objectWarped},                   // v28 — refreshes m_lastTransform via storePosition; no ordering can substitute
    {"clientWorld::findCellAtWorldPosition",   (void**)&findCellAtWorldPosition},        // v28 — placement routing; never null
    {"object::getAttachedTo",                  (void**)&getAttachedTo},                  // v28 — SAFETY: non-null => mounted => refuse reparent
    {"worldSnapshot::wsIsParsePending",        (void**)&wsIsParsePending},               // v28 — non-forcing completion poll (never swap for wsGetNodeCount)
};
size_t g_agentBindingCount = sizeof(g_agentBindings) / sizeof(g_agentBindings[0]);

}} // namespace swg::endpoints
