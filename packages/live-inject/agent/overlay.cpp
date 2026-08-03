/**
 * overlay.cpp — DXGI Present-hook + ImGui(DX11) overlay for the advertised gl11 client.
 *
 * Slice-0 step 2 (static overlay, no engine interaction yet). See overlay.h for the
 * contract. Ground-truth references (read-only, do not fork):
 *   - Consumer pattern:  D:\Code\Utinni\UtinniCore\swg\graphics\directx11.cpp (tryInstall,
 *                        hkSwapChainPresent, hkResizeBuffers) + render_backend_dx11.cpp (RTV mgmt).
 *   - Producer contract: D:\Code\swg-client-v2\...\Direct3d11\src\win32\Direct3d11.cpp:958-976.
 *   - DXGI vtable slots: Present = 8, ResizeBuffers = 13 (IDXGISwapChain base; SwapChain1 inherits).
 *
 * DELIBERATELY DROPPED from Utinni's version (per the Slice-0 plan): PanelGame embed /
 * reparent, the present-block WinForms event, the first-present embed-aspect assert, and
 * depth-texture reach-in. Our game runs in its own standalone window, so backbuffer == window.
 */

#include <Windows.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <d3d11.h>
#include <dxgi1_2.h>

#include "imgui.h"
#include "imgui_impl_win32.h"
#include "imgui_impl_dx11.h"
#include "ImGuizmo.h"

#include "detourxs.h"
#include "overlay.h"
#include "channel.h"   // decoration-persist round trip (DecorationCapture/Rebind + channel fns)

// --- Engine endpoints consumed by the gizmo (step 4). Slots are defined in
//     rva_table.cpp (same DLL); on the advertised client resolve() overwrites them
//     by catalog name. Typedefs mirror rva_table.cpp exactly (calling conventions
//     matter — member fns are __thiscall so MSVC passes `this` in ECX). ---
namespace swg { namespace endpoints {
    typedef void*(__cdecl*    pGetPlayer)();
    typedef void*(__thiscall* pGetTransform_o2w)(void*);
    typedef void(__thiscall*  pSetTransform_o2w)(void*, const void*);
    typedef void*(__cdecl*    pCuiHudGetInstance)();
    typedef void*(__thiscall* pCuiHudGetTarget)(void*);
    typedef int(__cdecl*      pCameraGetMatrix)(float*);
    typedef void(__cdecl*     pSetAllowTargetAnything)(bool);
    typedef const char*(__thiscall* pGetTemplateFilename)(void*);
    typedef int64_t(__cdecl*  pWsAddObject)(const char* tmpl, const float* transform12, int64_t containedById);
    typedef int(__cdecl*      pWsSaveSnapshot)();
    typedef int(__cdecl*      pWsGetSavePath)(char* buf, int cap);
    typedef int(__cdecl*      pCollideScreenRay)(int, int, int, int64_t*, float*);
    typedef void*(__cdecl*    pCollideScreenRayObject)(int, int, int);
    typedef int(__cdecl*      pGetObjectTransformO2P)(void* object, float* out12);
    typedef int64_t(__cdecl*  pGetContainingBuildingId)(void* object);
    typedef void(__cdecl*     pGameLoadScene)(const char* terrainFilename, const char* playerFilename);
    typedef void(__cdecl*     pGameCleanupScene)();   // 05.1-16: "game::cleanupScene" (inc:77)
    typedef void*(__cdecl*    pGetObjectById)(const void* networkId);
    typedef void(__cdecl*     pWsLoad)(const char* sceneName);
    typedef int(__cdecl*      pWsSetNodeTemplateName)(int64_t id, const char* name); // v23 model-D rebind
    typedef void(__cdecl*     pWsVoid)();
    typedef int(__cdecl*      pGetSceneId)(char* buf, int cap);
    typedef int(__cdecl*      pWsRemoveNode)(int64_t networkIdInt);   // 05.1-09: 1 removed/0 miss/-1 occupied
    // 05.1-16: the real per-frame tick ("game::mainLoop" -> &Game::runGameLoopOnce), DISTINCT
    // from g_mainLoopCounter's getMainLoopCount accessor below — see rva_table.cpp for the full
    // provenance note. Preferred drain point for the deferred scene-swap command queue.
    typedef void(__cdecl*     pMainLoop)(bool presentToWindow, HWND hwnd, int width, int height);
    extern pGetPlayer         getPlayer;
    extern pGetTransform_o2w  getTransform_o2w;
    extern pSetTransform_o2w  setTransform_o2w;
    extern pCuiHudGetInstance cuiHudGetInstance;
    extern pCuiHudGetTarget   cuiHudGetTarget;
    extern pCameraGetMatrix   cameraGetTransformO2W;
    extern pCameraGetMatrix   cameraGetProjectionMatrix;
    extern pSetAllowTargetAnything setAllowTargetAnything;
    extern pGetTemplateFilename getTemplateFilename;
    extern pWsAddObject       wsAddObject;
    extern pWsSaveSnapshot    wsSaveSnapshot;
    extern pWsSetNodeTemplateName wsSetNodeTemplateName;
    extern pWsGetSavePath     wsGetSavePath;
    extern pCollideScreenRay  collideScreenRay;
    extern pCollideScreenRayObject collideScreenRayObject;
    extern pGetObjectTransformO2P getObjectTransformO2P;
    extern pGetContainingBuildingId getContainingBuildingId;
    extern pGameLoadScene     gameLoadScene;
    extern pGameCleanupScene  gameCleanupScene;   // 05.1-16: frame-1 teardown before loadScene
    extern pGetObjectById     getObjectByIdAdvertised;
    extern pWsLoad            wsLoad;
    extern pWsVoid            wsUnloadSnapshot;
    extern pGetSceneId        getSceneId;
    extern pWsRemoveNode      wsRemoveNode;
    extern pMainLoop          mainLoop;
    // 05.1-18 (v27/v28): the engine's own authored-move idiom. setPortalTransitionsEnabled
    // is GLOBAL unscoped state — call it ONLY through PortalTransitionGuard below.
    typedef void*(__thiscall* pGetParentCell)(void*);
    typedef int(__cdecl*      pSetParentCell)(void*, void*);
    typedef void*(__cdecl*    pGetWorldCellProperty)();
    typedef void(__cdecl*     pSetPortalTransitionsEnabled)(bool);
    typedef void(__cdecl*     pObjectWarped)(void*);
    typedef void*(__cdecl*    pFindCellAtWorldPosition)(float, float, float);
    typedef void*(__cdecl*    pGetAttachedTo)(void*);
    typedef int(__cdecl*      pWsIsParsePending)();   // 05.1-17: non-forcing completion poll
    extern pGetParentCell               getParentCell;
    extern pSetParentCell               setParentCell;
    extern pGetWorldCellProperty        getWorldCellProperty;
    extern pSetPortalTransitionsEnabled setPortalTransitionsEnabled;
    extern pObjectWarped                objectWarped;
    extern pFindCellAtWorldPosition     findCellAtWorldPosition;
    extern pGetAttachedTo               getAttachedTo;
    extern pWsIsParsePending            wsIsParsePending;
    typedef void*(__thiscall* pGetNetworkId)(void*);
    extern pGetNetworkId      getNetworkId;
    bool isAdvertisedClient();
}}

// imgui 1.92 wraps this declaration in a `#if 0` block inside imgui_impl_win32.h
// (so the helper header doesn't pull in <windows.h>). Per imgui's own instruction,
// forward-declare it here to call it from our WndProc subclass.
extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);

namespace {

// --- The advertised render contract. Field order/type MUST be byte-identical to the
//     producer (swg-client-v2 Direct3d11.cpp) — verified 2026-07-19. Borrowed pointers. ---
struct EngineDx11HookPoints {
    IDXGISwapChain1*     swapChain;
    ID3D11Device*        device;
    ID3D11DeviceContext* context;
};
using pGetHookPoints = EngineDx11HookPoints(__cdecl*)();

// --- DXGI IDXGISwapChain vtable indices (base interface; SwapChain1 inherits the slots). ---
constexpr unsigned kDxgiPresentIndex       = 8;
constexpr unsigned kDxgiResizeBuffersIndex = 13;

// --- Trampoline typedefs (base IDXGISwapChain::Present, idx 8 — NOT Present1). ---
using pSwapChainPresent = HRESULT(__stdcall*)(IDXGISwapChain* pSwapChain, UINT SyncInterval, UINT Flags);
using pResizeBuffers    = HRESULT(__stdcall*)(IDXGISwapChain* pSwapChain, UINT BufferCount, UINT Width, UINT Height, DXGI_FORMAT NewFormat, UINT SwapChainFlags);

// --- Original (trampolined) entry points, filled by Detour::Create. ---
pSwapChainPresent g_origPresent       = nullptr;
pResizeBuffers    g_origResizeBuffers = nullptr;

// --- 05.1-16: trampoline to the REAL per-frame tick (game::mainLoop -> Game::runGameLoopOnce),
//     the PREFERRED drain point for the deferred scene-swap command queue below — a full stack
//     frame outside this Present hook's own call chain (see hkMainLoop). Null on a build where
//     the "game::mainLoop" catalog row failed to resolve; hkSwapChainPresent's post-Present
//     fallback activates ONLY in that case (see the drain call site there). ---
swg::endpoints::pMainLoop g_origMainLoop = nullptr;

// --- Borrowed contract pointers (NEVER Released — client-owned). Set by the acquisition
//     thread BEFORE the detour is installed, so the render thread always sees them. ---
IDXGISwapChain1*     g_swapChain = nullptr;
ID3D11Device*        g_device    = nullptr;
ID3D11DeviceContext* g_context   = nullptr;
HWND                 g_hwnd      = nullptr;

// --- Render-thread-only state (touched only inside the Present/Resize hooks). ---
ID3D11RenderTargetView* g_rtv       = nullptr;
bool                    g_imguiInit = false;

// --- Input: the original game WndProc we subclass over (step 3). ---
WNDPROC g_origWndProc = nullptr;

// --- Install latch (acquisition thread). Once true the detours are live. ---
volatile LONG g_installed = 0;

void dbg(const char* msg) { OutputDebugStringA(msg); }

// (Re)create the cached backbuffer RTV from the live swapchain. The GetBuffer temp is
// ours to Release; the swapchain/device are borrowed. (render_backend_dx11.cpp:51.)
ID3D11RenderTargetView* createBackbufferRtv() {
    if (g_swapChain == nullptr || g_device == nullptr) return nullptr;
    ID3D11Texture2D* backbuffer = nullptr;
    if (FAILED(g_swapChain->GetBuffer(0, __uuidof(ID3D11Texture2D), reinterpret_cast<void**>(&backbuffer))) || backbuffer == nullptr) {
        dbg("overlay: GetBuffer(0) failed; no backbuffer RTV");
        return nullptr;
    }
    ID3D11RenderTargetView* rtv = nullptr;
    HRESULT hr = g_device->CreateRenderTargetView(backbuffer, nullptr, &rtv);
    backbuffer->Release();
    if (FAILED(hr)) {
        dbg("overlay: CreateRenderTargetView failed");
        return nullptr;
    }
    return rtv;
}

// --- WndProc subclass (step 3): feed Win32 input to ImGui, then always forward to
//     the game's original WndProc. NOTE: SWG polls game input via DirectInput, NOT the
//     Win32 message queue, so this gives ImGui its input WITHOUT starving the game —
//     but it also means an overlay click still reaches the game (double-input). Real
//     capture arbitration (suspend DirectInput while io.WantCaptureMouse) needs an engine
//     hook and lands with the gizmo in step 4/5; for now the overlay is just interactive. ---
LRESULT CALLBACK hkWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (ImGui::GetCurrentContext() != nullptr) {
        ImGui_ImplWin32_WndProcHandler(hwnd, msg, wParam, lParam);
    }
    return CallWindowProc(g_origWndProc, hwnd, msg, wParam, lParam);
}

// One-time ImGui init on the render thread (first Present fire). Keeping device/context
// touches on the render thread avoids cross-thread D3D11 immediate-context misuse.
void ensureImguiInit() {
    if (g_imguiInit) return;
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::GetIO().IniFilename = nullptr;   // no imgui.ini writes from inside the game process
    ImGui_ImplWin32_Init(g_hwnd);
    ImGui_ImplDX11_Init(g_device, g_context);
    g_rtv = createBackbufferRtv();

    // Subclass the game window so ImGui receives mouse/keyboard (step 3). Generic
    // SetWindowLongPtr/CallWindowProc resolve to the ANSI variants in this non-UNICODE
    // build, matching SWG's ANSI window class.
    if (g_hwnd != nullptr) {
        g_origWndProc = reinterpret_cast<WNDPROC>(
            SetWindowLongPtr(g_hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&hkWndProc)));
        dbg(g_origWndProc ? "overlay: WndProc subclass installed (ImGui input live)"
                          : "overlay: WndProc subclass FAILED (SetWindowLongPtr returned null)");
    }

    g_imguiInit = true;
    dbg("overlay: ImGui DX11 initialized (first Present)");
}

// ─── Matrix helpers (SWG row-major 3x4/4x4 ⇄ ImGuizmo column-major) ──────────
// SWG transforms are row-major float[3][4]: columns 0..2 = local frame basis
// (i/j/k), column 3 = position. ImGuizmo wants column-major float[16], so the
// pipeline builds row-major 4x4 then transposes — matching Utinni's proven path
// (imgui_impl.cpp:1237-1249).

// Row-major 3x4 → row-major 4x4 (append [0 0 0 1]).
void mat34ToMat44(const float m34[12], float out16[16]) {
    for (int i = 0; i < 12; ++i) out16[i] = m34[i];
    out16[12] = 0.0f; out16[13] = 0.0f; out16[14] = 0.0f; out16[15] = 1.0f;
}

// Rigid inverse of a row-major 3x4 (orthonormal rotation R + translation t):
// Rinv = Rᵀ, tinv = −Rᵀ·t. Exact for a camera o2w (no scale).
void invertRigid34(const float m[12], float out[12]) {
    float rt[3][3];
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 3; ++c)
            rt[r][c] = m[c * 4 + r];               // transpose of the 3×3 rotation
    const float t[3] = { m[3], m[7], m[11] };
    for (int r = 0; r < 3; ++r) {
        out[r * 4 + 0] = rt[r][0];
        out[r * 4 + 1] = rt[r][1];
        out[r * 4 + 2] = rt[r][2];
        out[r * 4 + 3] = -(rt[r][0] * t[0] + rt[r][1] * t[1] + rt[r][2] * t[2]);
    }
}

// Transpose a flat 4×4 — converts between row-major and column-major.
void transpose44(const float in[16], float out[16]) {
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < 4; ++j)
            out[i * 4 + j] = in[j * 4 + i];
}

// ─── Gizmo state (render-thread-only) ────────────────────────────────────────
bool  g_gizmoEnabled = false;
int   g_gizmoOp      = 0;   // 0=translate 1=rotate 2=scale
int   g_gizmoMode    = 1;   // 0=world 1=local (default local: handles align to the object)
bool  g_gizmoWasUsing = false;
float g_gizmoOriginal34[12] = {};
bool  g_allowTargetAnything = false;   // let the reticle lock onto any object

// --- Ray-pick state. g_pickedId is a NetworkId VALUE (re-resolved to an Object*
//     every frame via getObjectById — ABA-safe, never a cached raw pointer).
//     g_pickPoint is the last world hit point (for cursor placement). ---
int64_t g_pickedId = 0;
bool    g_havePickPoint = false;
float   g_pickPoint[3] = {};

// --- Id-less .ilf decoration reach: can the hover pointer reach an id-less .ilf
//     decoration and can the gizmo move it? g_lastHoverObj tracks the most recent
//     non-null hud hover pick (cuiHud::getTarget, which selects id-less objects too
//     under allowTargetAnything); g_latchedFocus freezes one so the gizmo drives it
//     even after the cursor leaves the object. Raw Object* by necessity (no id);
//     SEH in the Present hook covers a despawn (building-unload only, per the synthesis). ---
void* g_lastHoverObj = nullptr;
void* g_latchedFocus = nullptr;
bool  g_followHover  = true;   // once latched, hovering another decoration switches to it
// Probe capture (last WORLD-cursor sample) — distinguishes a tangible/pointer-pickable
// object (HUD pick non-null, has a template/networkId) from a pure id-less .ilf decoration
// (HUD pick null, but the ray still reaches it with id 0 + a point).
void*   g_probeHoverPtr = nullptr;   // CURRENT world-cursor hud pick (null if none — e.g. a table)
char    g_lastHoverTmpl[256] = {};
int64_t g_lastHoverNet = 0;
bool    g_lastRayHit = false;
int64_t g_lastRayId = 0;
float   g_lastRayPt[3] = {};
// v22 borrowed-Object* pick (the .ilf-decoration path): the raw Object* the ray struck
// + its template — the template settles whether the ray hit the TABLE or the floor (§2.1).
void*   g_lastRayObj = nullptr;
char    g_lastRayObjTmpl[256] = {};

// --- Decoration persist (model D) capture baseline + round-trip state. Armed BEFORE the
//     move (the pre-move o2p, decoration + building template, building .ws node id), then
//     shipped on Persist. The building id is g_lastRayId — collideScreenRay walks the ray to
//     the networked BUILDING, whose id == the snapshot .ws node id (P2 smoke confirms). ---
bool     g_capArmed = false;              // a decoration edit is armed (baseline captured)
void*    g_capFocus = nullptr;            // the latched decoration this arm belongs to
int64_t  g_capBuildingId = 0;
float    g_capOriginalO2p[12] = {};
char     g_capDecorationTemplate[256] = {};
char     g_capBuildingTemplate[256] = {};
uint32_t g_captureEpoch = 0;             // monotonic; bumped once per Persist click
uint32_t g_lastAppliedRebindEpoch = 0;   // agent applies each new REBIND epoch once
int32_t  g_lastDecoResult = 0x7fffffff;  // last rebind outcome (sentinel = none yet)
uint32_t g_lastDecoResultEpoch = 0;
// 05.1-09: HOST_CMD's own last-applied-epoch tracker (handleHostCommand(), defined further down
// this file, alongside the deferred-queue extension) — same consume-once-per-epoch shape as
// g_lastAppliedRebindEpoch above, on the SEPARATE REBIND vs. HOST_CMD region/epoch space. Reset to
// 0 whenever a fresh HOST_CMD epoch of 0 is observed (R9 review, BB4 — see handleHostCommand()).
uint32_t g_lastAppliedHostCmdEpoch = 0;
// D-10: true when the most-recently-APPLIED rebind's persist had mirrorToStockIlf resolve
// false (host-set DECO_REBIND_FLAG_MIRROR_OFF), stashed by applyPendingRebind alongside
// g_lastAppliedRebindEpoch and read-only from the strip's saved-state check (020-A) so a
// mirror-off persist reads "saved (not visible here)" instead of plain "saved".
bool     g_lastRebindMirrorOff = false;
// Last arm-attempt failure reason (020-A hover state, F key). Stashed locally AND published
// off-process via the CAPTURE region (kind=ARM_FAILED) so the World panel's
// worldEditorStore.recordArmFailure has a real source — not a dead-end local-only global (C8).
char     g_lastArmFailureReason[256] = {};

// --- 020-A Status Strip auto-clear timers (render-thread-only, ImGui::GetTime() seconds).
//     Distinguishes "still showing an old saved/failed/couldn't-arm message" from "a brand
//     new one just landed this frame" so saved/failed/couldn't-arm auto-clear back to
//     idle/hover a few seconds after landing instead of sticking around forever (exact
//     seconds — Claude's discretion per this plan's behavior spec). ---
constexpr double kStripMessageHoldSec = 2.0;
uint32_t g_stripLastShownResultEpoch = 0;   // last g_lastDecoResultEpoch the strip has shown
double   g_stripResultShownUntil = 0.0;     // ImGui::GetTime() deadline for the current saved/failed text
double   g_stripArmFailShownUntil = 0.0;    // ImGui::GetTime() deadline for "couldn't arm" text

// Resolve the object the gizmo edits: a ray-picked object (re-resolved from its
// id each frame) takes precedence, else the current in-game target, else the
// player. Runs on the render/game thread (safe to touch engine objects here).
// The current hud hover pick (cuiHud::getTarget). Selects id-less .ilf decorations too
// under allowTargetAnything. Null when nothing is hovered / cursor off-world.
void* resolveHoverPick() {
    if (swg::endpoints::isAdvertisedClient() &&
        swg::endpoints::cuiHudGetInstance && swg::endpoints::cuiHudGetTarget) {
        void* hud = swg::endpoints::cuiHudGetInstance();
        if (hud) return swg::endpoints::cuiHudGetTarget(hud);
    }
    return nullptr;
}

void* resolveFocusObject() {
    void* focus = nullptr;
    // A latched hover pointer (id-less decoration) wins — the gizmo drives it.
    if (g_latchedFocus != nullptr) return g_latchedFocus;
    // Ray-picked selection wins — re-resolve the id to a live Object* (ABA-safe).
    if (g_pickedId != 0 && swg::endpoints::getObjectByIdAdvertised) {
        void* picked = swg::endpoints::getObjectByIdAdvertised(&g_pickedId);
        if (picked) return picked;
    }
    if (swg::endpoints::isAdvertisedClient() &&
        swg::endpoints::cuiHudGetInstance && swg::endpoints::cuiHudGetTarget) {
        void* hud = swg::endpoints::cuiHudGetInstance();
        if (hud) {
            void* selected = swg::endpoints::cuiHudGetTarget(hud);
            if (selected) focus = selected;
        }
    }
    if (focus == nullptr && swg::endpoints::getPlayer) focus = swg::endpoints::getPlayer();
    return focus;
}

// The in-game transform gizmo (step 4). Advertised-only: needs the live-camera
// accessors. All engine reads/writes happen HERE, inside the Present hook (the
// game-thread call site) — never the agent poll thread.
void drawGizmo() {
    if (!swg::endpoints::isAdvertisedClient()) return;
    if (!swg::endpoints::cameraGetTransformO2W || !swg::endpoints::cameraGetProjectionMatrix) return;

    void* focus = resolveFocusObject();
    if (focus == nullptr || swg::endpoints::getTransform_o2w == nullptr) return;

    float camO2W12[12];
    float proj16[16];
    if (swg::endpoints::cameraGetTransformO2W(camO2W12) == 0 ||
        swg::endpoints::cameraGetProjectionMatrix(proj16) == 0) {
        return;   // no current camera this frame
    }

    void* objXformPtr = swg::endpoints::getTransform_o2w(focus);
    if (objXformPtr == nullptr) return;
    float obj34[12];
    std::memcpy(obj34, objXformPtr, sizeof(obj34));

    // view = inverse(cameraO2W); promote to 4×4; projection is already 4×4.
    float view34[12];  invertRigid34(camO2W12, view34);
    float view44[16];  mat34ToMat44(view34, view44);
    float obj44[16];   mat34ToMat44(obj34, obj44);

    // Row-major → column-major for ImGuizmo.
    float viewCM[16], projCM[16], objCM[16];
    transpose44(view44, viewCM);
    transpose44(proj16, projCM);
    transpose44(obj44, objCM);

    const ImGuizmo::OPERATION op =
        (g_gizmoOp == 1) ? ImGuizmo::ROTATE : (g_gizmoOp == 2) ? ImGuizmo::SCALE : ImGuizmo::TRANSLATE;
    const ImGuizmo::MODE mode = (g_gizmoMode == 1) ? ImGuizmo::LOCAL : ImGuizmo::WORLD;

    const ImGuiIO& io = ImGui::GetIO();
    ImGuizmo::SetOrthographic(false);
    ImGuizmo::SetRect(0.0f, 0.0f, io.DisplaySize.x, io.DisplaySize.y);
    ImGuizmo::BeginFrame();
    ImGuizmo::Enable(true);
    ImGuizmo::Manipulate(viewCM, projCM, op, mode, objCM);

    if (ImGuizmo::IsUsing()) {
        if (!g_gizmoWasUsing) std::memcpy(g_gizmoOriginal34, obj34, sizeof(obj34));

        if (ImGui::IsKeyDown(ImGuiKey_Escape)) {
            if (swg::endpoints::setTransform_o2w)
                swg::endpoints::setTransform_o2w(focus, g_gizmoOriginal34);
            g_gizmoWasUsing = false;
            return;
        }

        // Column-major → row-major 4×4; the first 12 floats are the 3×4 Transform.
        float objRM[16];
        transpose44(objCM, objRM);
        if (swg::endpoints::setTransform_o2w)
            swg::endpoints::setTransform_o2w(focus, objRM);
        g_gizmoWasUsing = true;
    } else {
        g_gizmoWasUsing = false;
    }
}

// The actual per-frame draw. Split out of the hook so hkSwapChainPresent's own frame has
// no C++ unwinding objects and can host a __try/__except (SEH) guard (MSVC C2712).
// --- Decoration persist (model D): arm the edit from the current ray object. Snapshots the
//     pre-move baseline the toolkit needs to resolve the .ilf row + derive the template.
//     Returns a human reason on failure (shown in the probe), nullptr on success. ---
const char* armDecorationEdit() {
    void* deco = g_lastRayObj;
    if (deco == nullptr) return "no ray object under cursor (hover the decoration first)";
    if (!swg::endpoints::getObjectTransformO2P) return "object::getTransformO2P unresolved";
    if (!swg::endpoints::getTemplateFilename)   return "getObjectTemplateName unresolved";

    // Building id: prefer the advertised cell→building resolver on the decoration itself
    // (getContainingBuildingId walks getParentCell→portal→owner→building). An id-less .ilf
    // decoration reports ray id 0 by design, and a wall/floor click resolves to the CELL
    // (object/cell/shared_cell.iff, no interiorLayoutFileName) not the building — so the resolver
    // is the correct source. Until the provider ships it (REQUEST 2026-07-30) the slot is null;
    // fall back to the current left-click selection (which for now resolves the cell, not the
    // building — hence the "no interiorLayoutFileName" abort you'll see without the shim).
    // When the resolver IS advertised, its answer is authoritative INCLUDING 0. Per the client
    // catalog (engine_hookpoints.inc:446 + the v25 note): "world-cell objects report 0 (no
    // PortalProperty)" — i.e. 0 means "not inside a POB", a definitive NO, not "unknown". The old
    // `if (bldgId == 0) bldgId = g_lastRayId` fallback was a PRE-SHIM workaround (see REQUEST
    // 2026-07-30) that outlived its cause: after v25 shipped it silently substituted the picked
    // object's OWN id, so hovering a building from outside armed it as its own containing
    // building — meaningless state that would assemble an .ilf edit against a building that never
    // contained the object, and it made the refusal path unreachable (the 020-A `failed` state
    // could never be exercised). The fallback now applies ONLY when the slot is unresolved.
    int64_t bldgId = 0;
    if (swg::endpoints::getContainingBuildingId) {
        bldgId = swg::endpoints::getContainingBuildingId(deco);
        if (bldgId == 0) return "not inside a building — interior decorations only";
    } else {
        bldgId = (g_lastRayId != 0) ? g_lastRayId : g_pickedId;
        if (bldgId == 0) return "no building id — hover a decoration (or click the building), then Arm";
    }

    // Pre-move o2p of the decoration.
    if (!swg::endpoints::getObjectTransformO2P(deco, g_capOriginalO2p)) return "getTransformO2P returned 0";

    // Decoration template.
    const char* dt = swg::endpoints::getTemplateFilename(deco);
    if (!dt || dt[0] == '\0') return "decoration has no template name";
    std::strncpy(g_capDecorationTemplate, dt, sizeof(g_capDecorationTemplate) - 1);
    g_capDecorationTemplate[sizeof(g_capDecorationTemplate) - 1] = '\0';

    // Building template = the stock .iff of the selected building.
    g_capBuildingId = bldgId;
    g_capBuildingTemplate[0] = '\0';
    if (swg::endpoints::getObjectByIdAdvertised) {
        void* bldg = swg::endpoints::getObjectByIdAdvertised(&g_capBuildingId);
        if (bldg) {
            const char* bt = swg::endpoints::getTemplateFilename(bldg);
            if (bt && bt[0] != '\0') {
                std::strncpy(g_capBuildingTemplate, bt, sizeof(g_capBuildingTemplate) - 1);
                g_capBuildingTemplate[sizeof(g_capBuildingTemplate) - 1] = '\0';
            }
        }
    }
    if (g_capBuildingTemplate[0] == '\0') return "could not resolve building template from id";

    g_latchedFocus = deco;   // drive the gizmo against this decoration
    g_capFocus     = deco;
    g_capArmed     = true;
    return nullptr;
}

// Ship the armed edit: snapshot the POST-move o2p and write it to the CAPTURE region with a
// fresh epoch. The toolkit answers via the REBIND region (applyPendingRebind consumes it).
const char* persistDecorationEdit() {
    if (!g_capArmed) return "no armed edit (arm one first)";
    if (g_capFocus == nullptr || !swg::endpoints::getObjectTransformO2P) return "focus/o2p unavailable";

    DecorationCapture cap = {};
    cap.buildingId = static_cast<uint64_t>(g_capBuildingId);
    std::memcpy(cap.originalO2p, g_capOriginalO2p, sizeof(cap.originalO2p));
    if (!swg::endpoints::getObjectTransformO2P(g_capFocus, &cap.newO2p[0][0])) return "getTransformO2P (new) returned 0";
    std::strncpy(cap.decorationTemplate, g_capDecorationTemplate, sizeof(cap.decorationTemplate) - 1);
    std::strncpy(cap.buildingTemplate,   g_capBuildingTemplate,   sizeof(cap.buildingTemplate) - 1);

    channelWriteCapture(&cap, ++g_captureEpoch);
    return nullptr;
}

// Per-frame (game thread): consume a REBIND directive the toolkit published. Applies each new
// epoch once — APPLY → wsSetNodeTemplateName + wsSaveSnapshot; ABORT → just report. Publishes
// the outcome to the RESULT region. Ordering (v23): the toolkit writes the loose files BEFORE
// sending APPLY, so by the time we rebind the derived template already resolves via TreeFile.
void applyPendingRebind() {
    DecorationRebind rb = {};
    if (!channelReadRebind(&rb)) return;                 // torn read or channel closed
    if (rb.epoch == 0 || rb.epoch == g_lastAppliedRebindEpoch) return;  // nothing new
    g_lastAppliedRebindEpoch = rb.epoch;
    g_lastRebindMirrorOff = (rb.flags & DECO_REBIND_FLAG_MIRROR_OFF) != 0;   // D-10 stash

    // Apply the REBIND's OWN payload — it is self-contained (the toolkit derived the template
    // FOR rb.buildingId and echoes it) and epoch-gated, so it need not match the currently-armed
    // edit (the user may have armed another since). rb.buildingId==0 is a malformed directive.
    int32_t code;
    if ((rb.flags & DECO_REBIND_FLAG_ABORT) || !(rb.flags & DECO_REBIND_FLAG_APPLY)) {
        code = DECO_RESULT_ABORTED;
    } else if (rb.buildingId == 0) {
        code = DECO_RESULT_BUILDING_ID_MISMATCH;         // no valid target id
    } else if (!swg::endpoints::wsSetNodeTemplateName) {
        code = DECO_RESULT_NODE_NOT_FOUND;               // endpoint unresolved on this client
    } else {
        const int reb = swg::endpoints::wsSetNodeTemplateName(
            static_cast<int64_t>(rb.buildingId), rb.derivedTemplate);
        if (reb == 0) {
            code = DECO_RESULT_NODE_NOT_FOUND;           // node id didn't resolve (server-streamed / bad id)
        } else if (reb < 0) {
            // Provider -1 = refused (empty name / buildout-provenance node / template unresolvable).
            // MUST NOT fall through to the save path: nothing was rebound, and a save result here
            // would masquerade as the rebind outcome (even a false OK).
            code = DECO_RESULT_REBIND_REFUSED;
        } else if (swg::endpoints::wsSaveSnapshot) {
            code = static_cast<int32_t>(swg::endpoints::wsSaveSnapshot());  // 0 ok / 1..6 save reason
        } else {
            code = DECO_RESULT_SAVE_NO_SNAPSHOT;
        }
    }

    g_lastDecoResult = code;
    g_lastDecoResultEpoch = rb.epoch;
    channelWriteResult(code, rb.epoch);
    // Disarm only when the commit matches the edit currently armed (multi-arm safe).
    if (code == DECO_RESULT_OK && rb.buildingId == static_cast<uint64_t>(g_capBuildingId)) g_capArmed = false;
}

// --- 020-A Status Strip label helpers ----------------------------------------------------
// The agent has no friendly-name or cell-name resolver (no such endpoint is advertised) —
// decorationTemplate/buildingTemplate are raw VFS paths (e.g.
// "object/tangible/furniture/general/shared_cantina_table.iff"). DEVIATION from sketch
// 020-A's exact mock copy ("Cantina Table · alcove1 · Cantina (Mos Eisley)"), which needs
// data (a friendly display name, the cell name) this process cannot resolve — the World
// panel (host side, Plan 04) derives friendly building labels from the .iff's own DERV/base
// chunk, a capability this x86 agent DLL does not have. Best-effort substitute: prettify the
// raw template path (strip dir + extension + "shared_" prefix, underscores → spaces, title
// case) and omit the cell segment entirely rather than fabricate one.
void prettifyTemplateLabel(const char* templatePath, char* out, size_t outCap) {
    if (outCap == 0) return;
    if (templatePath == nullptr || templatePath[0] == '\0') { out[0] = '\0'; return; }
    const char* base = std::strrchr(templatePath, '/');
    base = base ? base + 1 : templatePath;
    if (std::strncmp(base, "shared_", 7) == 0) base += 7;
    char stem[256] = {};
    size_t n = 0;
    for (; base[n] != '\0' && base[n] != '.' && n < sizeof(stem) - 1; ++n) stem[n] = base[n];
    stem[n] = '\0';
    bool startOfWord = true;
    size_t w = 0;
    for (size_t i = 0; stem[i] != '\0' && w < outCap - 1; ++i) {
        char c = stem[i];
        if (c == '_') { out[w++] = ' '; startOfWord = true; continue; }
        if (startOfWord && c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
        startOfWord = false;
        out[w++] = c;
    }
    out[w] = '\0';
}

// Decoration + building label, e.g. "Cantina Table \xC2\xB7 Cantina Tatooine" — building
// resolved either from an explicit template (armed/saved/failed, already captured) or by
// live-resolving buildingId (hover preview, no capture yet). buildingTemplateOverride may be
// nullptr/empty to force the live-resolve path.
void buildStripLabel(const char* decoTemplate, int64_t buildingId, const char* buildingTemplateOverride,
                      char* out, size_t outCap) {
    char decoLabel[128] = {};
    prettifyTemplateLabel(decoTemplate, decoLabel, sizeof(decoLabel));
    char bldgLabel[128] = {};
    if (buildingTemplateOverride != nullptr && buildingTemplateOverride[0] != '\0') {
        prettifyTemplateLabel(buildingTemplateOverride, bldgLabel, sizeof(bldgLabel));
    } else if (buildingId != 0 && swg::endpoints::getObjectByIdAdvertised && swg::endpoints::getTemplateFilename) {
        int64_t bid = buildingId;
        void* bldg = swg::endpoints::getObjectByIdAdvertised(&bid);
        if (bldg) {
            const char* bt = swg::endpoints::getTemplateFilename(bldg);
            if (bt) prettifyTemplateLabel(bt, bldgLabel, sizeof(bldgLabel));
        }
    }
    if (bldgLabel[0] != '\0') std::snprintf(out, outCap, "%s \xC2\xB7 %s", decoLabel, bldgLabel);
    else std::snprintf(out, outCap, "%s", decoLabel[0] != '\0' ? decoLabel : "(decoration)");
}

// --- 020-A Status Strip: retires the old debug-probe CollapsingHeader (raw pointers, latch
//     buttons, a raw-integer result-code text line — the exact SC1 violation this replaces). One thin
//     top-center ImGui window, hotkey-driven (F arm, G/R move/rotate, Esc cancel). The
//     arm/persist/rebind INTERNALS above are reused completely unchanged — only the TRIGGER
//     (hotkey vs. the old probe's button clicks) and the RENDER surface change here.
//     Five coarse states only (idle/hover/armed/saved/failed) — SC1: never a raw
//     LIVE_DECORATION_RESULT code or full reason text reaches this surface; that detail is
//     deliberately punted to the World panel (D-12). Called from renderFrame() right after
//     applyPendingRebind() so it always reflects the LATEST rebind result even the same
//     frame it lands. ---
void renderDecorationStrip() {
    ImGuiIO& io = ImGui::GetIO();

    // --- F/G/R contextual hotkeys (D-11: gated on !WantCaptureKeyboard so the strip never
    //     hijacks keystrokes meant for another ImGui text field, e.g. the Editor-scene
    //     terrain/avatar text inputs). F only arms while genuinely hovering AND nothing else
    //     is armed; G/R only act while armed. ---
    if (!io.WantCaptureKeyboard) {
        if (!g_capArmed && g_lastRayObj != nullptr && ImGui::IsKeyPressed(ImGuiKey_F, false)) {
            const char* failReason = armDecorationEdit();
            if (failReason != nullptr) {
                std::strncpy(g_lastArmFailureReason, failReason, sizeof(g_lastArmFailureReason) - 1);
                g_lastArmFailureReason[sizeof(g_lastArmFailureReason) - 1] = '\0';

                // C8: publish the failure off-process via the CAPTURE region (kind=ARM_FAILED,
                // reusing cellName as the reason string per channel.h's documented dual-purpose
                // slot) so the World panel's worldEditorStore.recordArmFailure has a real
                // source — not just this agent-local stash with no reader.
                DecorationCapture cap = {};
                cap.kind = DECO_CAPTURE_KIND_ARM_FAILED;
                cap.buildingId = 0;
                std::strncpy(cap.cellName, failReason, sizeof(cap.cellName) - 1);
                cap.cellName[sizeof(cap.cellName) - 1] = '\0';
                channelWriteCapture(&cap, ++g_captureEpoch);

                g_stripArmFailShownUntil = ImGui::GetTime() + kStripMessageHoldSec;
            }
        }
        if (g_capArmed) {
            if (ImGui::IsKeyPressed(ImGuiKey_G, false)) { g_gizmoOp = 0; g_gizmoEnabled = true; }
            if (ImGui::IsKeyPressed(ImGuiKey_R, false)) { g_gizmoOp = 1; g_gizmoEnabled = true; }
            // NO Escape key binding — deliberate. Sketch 020-A specs Esc as an on-strip BUTTON
            // (`im-btn ghost`), and only F and G/R as KEYS (`im-key`); the two are distinguished
            // by class in the sketch. An Esc KEY binding was tried and reverted: SWG polls game
            // input via DirectInput, NOT the Win32 message queue, so hkWndProc cannot consume a
            // keystroke (it always forwards — see hkWndProc's own note) and Esc reached the game
            // too, toggling the in-game settings menu on every cancel. Cancel is the strip's Esc
            // BUTTON below. See the input-arbitration limitation note in this plan's SUMMARY.
        }
    }

    // --- coarse state classification (words only — SC1) ---
    if (g_lastDecoResultEpoch != 0 && g_lastDecoResultEpoch != g_stripLastShownResultEpoch) {
        g_stripLastShownResultEpoch = g_lastDecoResultEpoch;
        g_stripResultShownUntil = ImGui::GetTime() + kStripMessageHoldSec;
    }
    const bool showResult = ImGui::GetTime() < g_stripResultShownUntil;
    const bool showArmFail = !g_capArmed && ImGui::GetTime() < g_stripArmFailShownUntil;

    enum class DecoStripState { Idle, Hover, Armed, Saved, Failed };
    DecoStripState state;
    if (g_capArmed) state = DecoStripState::Armed;
    else if (showResult && g_lastDecoResult == DECO_RESULT_OK) state = DecoStripState::Saved;
    else if (showResult) state = DecoStripState::Failed;
    else if (g_lastRayObj != nullptr) state = DecoStripState::Hover;
    else state = DecoStripState::Idle;

    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, 12.0f), ImGuiCond_Always, ImVec2(0.5f, 0.0f));
    ImGui::SetNextWindowBgAlpha(0.85f);
    const ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                                    ImGuiWindowFlags_NoResize | ImGuiWindowFlags_AlwaysAutoResize |
                                    ImGuiWindowFlags_NoFocusOnAppearing | ImGuiWindowFlags_NoNav;
    if (ImGui::Begin("##decoStrip", nullptr, flags)) {
        char label[300] = {};
        switch (state) {
            case DecoStripState::Idle:
                break;   // no object label — nothing under the cursor, nothing armed
            case DecoStripState::Hover: {
                int64_t bldgId = 0;
                if (swg::endpoints::getContainingBuildingId) bldgId = swg::endpoints::getContainingBuildingId(g_lastRayObj);
                if (bldgId == 0) bldgId = (g_lastRayId != 0) ? g_lastRayId : g_pickedId;
                buildStripLabel(g_lastRayObjTmpl, bldgId, nullptr, label, sizeof(label));
                break;
            }
            case DecoStripState::Armed:
            case DecoStripState::Saved:
            case DecoStripState::Failed:
                // g_capDecorationTemplate/g_capBuildingTemplate/g_capBuildingId persist past
                // disarm (armDecorationEdit sets them, nothing clears them on success/fail) —
                // reading them here always reflects the LAST armed edit, exactly what
                // saved/failed needs to still show.
                buildStripLabel(g_capDecorationTemplate, g_capBuildingId, g_capBuildingTemplate, label, sizeof(label));
                break;
        }
        if (label[0] != '\0') { ImGui::TextUnformatted(label); ImGui::SameLine(); }

        switch (state) {
            case DecoStripState::Idle:
                break;
            case DecoStripState::Hover:
                if (showArmFail) ImGui::TextColored(ImVec4(0.95f, 0.35f, 0.30f, 1.0f), "couldn't arm \xE2\x80\x94 see World panel");
                else ImGui::TextDisabled("press F to arm");
                break;
            case DecoStripState::Armed: {
                float curO2p[12] = {};
                const bool haveDelta = g_capFocus != nullptr && swg::endpoints::getObjectTransformO2P &&
                                        swg::endpoints::getObjectTransformO2P(g_capFocus, curO2p);
                if (haveDelta) {
                    ImGui::TextColored(ImVec4(1.0f, 0.75f, 0.2f, 1.0f), "ARMED \xCE\x94 % .2f, % .2f, % .2f",
                                        curO2p[3] - g_capOriginalO2p[3], curO2p[7] - g_capOriginalO2p[7],
                                        curO2p[11] - g_capOriginalO2p[11]);
                } else {
                    ImGui::TextColored(ImVec4(1.0f, 0.75f, 0.2f, 1.0f), "ARMED");
                }
                ImGui::SameLine();
                if (ImGui::Button("Persist")) persistDecorationEdit();
                ImGui::SameLine();
                if (ImGui::Button("Esc")) g_capArmed = false;
                break;
            }
            case DecoStripState::Saved:
                if (g_lastRebindMirrorOff) ImGui::TextColored(ImVec4(0.55f, 0.85f, 0.55f, 1.0f), "saved (not visible here)");
                else ImGui::TextColored(ImVec4(0.3f, 0.85f, 0.35f, 1.0f), "saved");
                break;
            case DecoStripState::Failed:
                ImGui::TextColored(ImVec4(0.95f, 0.35f, 0.30f, 1.0f), "failed \xE2\x80\x94 see World panel");
                break;
        }
        if (state != DecoStripState::Idle) ImGui::SameLine();
        ImGui::TextDisabled("F arm \xC2\xB7 G/R move/rotate");
    }
    ImGui::End();
}

// --- 020-A strip fault containment (Bug A, 05.1-16). Own SEH handler so a bad per-frame
//     engine read (a stale/freed borrowed Object*) costs a label for one frame, never the
//     whole overlay — hkSwapChainPresent's outer handler stays as the last-resort net for
//     everything else. A separate wrapper function (not __try inlined into renderFrame()
//     itself) mirrors the file's own established C2712 workaround (see renderFrame()'s
//     header comment: no C++ unwind objects may share a function with __try on this MSVC). ---
void renderDecorationStripGuarded() {
    static uint32_t s_stripFaultCount = 0;
    __try {
        renderDecorationStrip();
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        ++s_stripFaultCount;
        // Rate-limited (hard requirement 4 — this fired 3,424 times in one run pre-fix):
        // first 5 verbatim, then every 50th, always carrying a running count + region.
        if (s_stripFaultCount <= 5 || (s_stripFaultCount % 50) == 0) {
            char buf[160];
            std::snprintf(buf, sizeof(buf),
                "overlay: SEH fault in renderDecorationStrip [020-A strip] — strip skipped this frame (count=%u)\n",
                s_stripFaultCount);
            dbg(buf);
        }
    }
}

// --- 05.1-16 Bug B fix: deferred command queue for engine calls that DESTROY AND RECREATE
//     the player/scene (gameLoadScene and future scene-lifecycle actions) — issuing these
//     synchronously from inside Present re-entrantly tears down/rebuilds the scene mid-frame
//     and FATALs (InputScheme::fetchGroundInputMap "on a new player without releasing old
//     one" — see 05.1-16-PLAN.md's evidence section). Teleport and other calls that merely
//     MOVE the existing player are proven safe from Present (05.1-05 checkpoint) and are
//     deliberately NOT routed through this queue — see the plan's routing table.
//
//     Single game thread, never concurrent: the producer (an ImGui button click) and the
//     consumer (drainDeferredCommands, called from hkMainLoop below) both run on the SAME
//     thread — Game::runGameLoopOnce calls Graphics::Present (which reaches our button
//     click via renderFrame()) and, on the preferred drain path, hkMainLoop drains AFTER
//     that same call returns. No atomics/locks needed; a plain fixed-capacity ring is
//     sufficient and allocates nothing on the render thread. ---
// 05.1-09: kind gains Reload (RELOAD_CURRENT_SCENE) alongside LoadScene (LOAD_EDITOR_SCENE) —
// same scene-lifecycle class per 05.1-16-SUMMARY's handoff table (both MUST NOT be issued from
// inside Present). Reload uses worldSnapshot::wsUnloadSnapshot+wsLoad, a DIFFERENT engine call
// pair than game::cleanupScene/loadScene — nothing in the 05.1-16 evidence shows it needs the
// two-frame gap that gameLoadScene does (that FATAL is specific to InputScheme's ground-input-map
// release, tied to the SceneCreator player-recreation lifecycle Reload does not go through), so
// Reload executes in a SINGLE drain pass, just moved outside Present. Flagged as an assumption,
// not a proven fact, in this plan's checkpoint return — Task 3 smoke-tests it live.
enum class DeferredCmdKind : uint8_t { None = 0, LoadScene, Reload };
struct DeferredCmd {
    DeferredCmdKind kind = DeferredCmdKind::None;
    char terrain[128] = {};   // LoadScene only
    char player[160] = {};    // LoadScene only
    char scene[128] = {};     // Reload only
    // Two-frame sequencing latch (Utinni game.cpp:499-554 equivalent of `sceneCleaned`).
    // false = cleanupScene still owed; true = teardown done a tick ago, safe to load.
    // LoadScene only — Reload has no cleanup step (see kind comment above).
    bool sceneCleaned = false;
    // 05.1-09: 0 = locally-triggered (existing ImGui button; no ack owed — nothing is waiting
    // on a HOST_CMD epoch). Non-zero = the HOST_CMD epoch handleHostCommand() consumed to enqueue
    // this command; drainDeferredCommands() publishes exactly one channelWriteHostCommandResult
    // for it at the point the command actually EXECUTES (ack-on-execution — see this plan's
    // checkpoint-return design-decision statement), never at enqueue time.
    uint32_t hostCmdEpoch = 0;
};
constexpr int kDeferredQueueCapacity = 4;
DeferredCmd g_deferredQueue[kDeferredQueueCapacity];
int      g_deferredHead = 0;   // next slot to consume
int      g_deferredTail = 0;   // next slot to produce
int      g_deferredCount = 0;
uint32_t g_deferredDroppedCount = 0;

// 05.1-17: a LoadScene that has completed frame 1 (cleanupScene) and is waiting for frame 2
// (loadScene) is MID-SEQUENCE. A Reload must never execute in that window: it would run
// wsUnloadSnapshot+wsLoad against a scene cleanupScene already tore down, and frame 2 would
// then load on top of the result. Set when frame 1 re-enqueues, cleared when frame 2 runs.
//
// Detection is deliberately "a LoadScene with sceneCleaned == true", NOT "any LoadScene in the
// ring": for [Reload, LoadScene(frame 1)] the Reload running first is SAFE, and deferring it
// would be a pointless behavior change.
bool g_loadSceneAwaitingFrame2 = false;

// 05.1-18: scene-epoch counter, bumped at OUR OWN cleanupScene/loadScene call sites — the only
// signal that increments exactly once per scene swap. getSceneId() cannot substitute: it is keyed
// on the terrain appearance template name, so reloading the SAME terrain leaves it unchanged while
// ms_scene is destroyed and rebuilt, and a "pointer differed but scene id did not" reading would
// misclassify that as NOT a scene boundary. Declared here (above drainDeferredCommands) because
// the drain bumps it; the teleport logger below reads it.
uint32_t g_sceneEpoch = 0;

// 05.1-17: reload completion tracking. The ack for a HOST_CMD reload is published when the
// snapshot parse actually finishes (wsIsParsePending -> 0), not when wsLoad returns, so that
// ack=1 means "world rebuilt" and a remote verifier can trust it.
//
// Exactly ONE outstanding entry by construction — a second reload arriving while one is pending
// is coalesced (epoch-0 only) or enqueued behind it, so two epochs can never wait on one signal.
//
// Bounded: Plan 08's HOST_CMD timeout is 11s, so we give up well under that and ack the existing
// "did not complete" code rather than claiming a success we cannot see.
constexpr uint32_t kReloadAckTimeoutTicks = 600;   // ~10s at 60fps; comfortably inside Plan 08's 11s
uint32_t g_pendingReloadAckEpoch = 0;              // 0 = nothing outstanding
uint32_t g_pendingReloadAckTicks = 0;
bool     g_pendingReloadSawPending = false;        // saw wsIsParsePending()==1 at least once

// Called from the ImGui button handler (render thread, inside Present) — enqueues only,
// never calls the engine directly. Fixed capacity; drops-with-log on overflow rather than
// growing (no allocation on the render thread).
bool enqueueDeferredCmd(const DeferredCmd& cmd) {
    if (g_deferredCount >= kDeferredQueueCapacity) {
        ++g_deferredDroppedCount;
        char buf[160];
        std::snprintf(buf, sizeof(buf),
            "overlay: deferred queue FULL — dropped command (total dropped=%u)\n",
            g_deferredDroppedCount);
        dbg(buf);
        return false;
    }
    g_deferredQueue[g_deferredTail] = cmd;
    g_deferredTail = (g_deferredTail + 1) % kDeferredQueueCapacity;
    ++g_deferredCount;
    return true;
}

// hostCmdEpoch defaults to 0 (local ImGui button caller — unchanged call site, no ack owed).
// handleHostCommand() passes its consumed epoch explicitly so the eventual drain can ack it.
bool enqueueDeferredLoadScene(const char* terrain, const char* player, uint32_t hostCmdEpoch = 0) {
    DeferredCmd cmd;
    cmd.kind = DeferredCmdKind::LoadScene;
    std::strncpy(cmd.terrain, terrain, sizeof(cmd.terrain) - 1);
    cmd.terrain[sizeof(cmd.terrain) - 1] = '\0';
    std::strncpy(cmd.player, player, sizeof(cmd.player) - 1);
    cmd.player[sizeof(cmd.player) - 1] = '\0';
    cmd.sceneCleaned = false;   // frame 1 (cleanup) is always owed on a fresh request
    cmd.hostCmdEpoch = hostCmdEpoch;
    return enqueueDeferredCmd(cmd);
}

// 05.1-17: ALL reload callers now come through here — the HOST_CMD dispatch AND both local ImGui
// buttons ("Reload current scene", "Load##scene"). The buttons used to call
// wsUnloadSnapshot()+wsLoad() inline from inside Present; routing them through the queue is what
// brings them under the g_loadSceneAwaitingFrame2 interleave guard (an inline click during a
// LoadScene's two-frame window hit exactly the ordering bug that guard exists to prevent), and it
// is the only way "no reload path skips completion tracking" can hold. hostCmdEpoch is NOT
// defaulted: local callers must pass 0 explicitly so the ack ownership is visible at the call site.
//
// COALESCING (05.1-17 Task 2f) — epoch-0 into epoch-0 ONLY. A remote reload's epoch is marked
// applied BEFORE enqueue, so the renderer is already waiting on it; coalescing one away, or
// overwriting a pending slot's epoch, strands that epoch to an 11s timeout. Dropping a duplicate
// LOCAL click owes nobody an ack, so that is the only safe merge.
bool enqueueDeferredReload(const char* scene, uint32_t hostCmdEpoch) {
    if (hostCmdEpoch == 0) {
        for (int i = 0; i < g_deferredCount; ++i) {
            const DeferredCmd& q = g_deferredQueue[(g_deferredHead + i) % kDeferredQueueCapacity];
            if (q.kind == DeferredCmdKind::Reload && q.hostCmdEpoch == 0 &&
                std::strncmp(q.scene, scene, sizeof(q.scene)) == 0) {
                dbg("overlay: deferred Reload — coalesced duplicate local request\n");
                return true;   // no-op success: nothing is waiting on an ack
            }
        }
    }
    DeferredCmd cmd;
    cmd.kind = DeferredCmdKind::Reload;
    std::strncpy(cmd.scene, scene, sizeof(cmd.scene) - 1);
    cmd.scene[sizeof(cmd.scene) - 1] = '\0';
    cmd.hostCmdEpoch = hostCmdEpoch;
    return enqueueDeferredCmd(cmd);
}

// Drains the queue. Consumed BEFORE the engine call executes (advance head/count first) so a
// command can never double-execute even if the engine call itself re-enters this path.
// Called from hkMainLoop (preferred — genuinely outside Present) or, as a fallback, from
// hkSwapChainPresent after g_origPresent() returns (see that call site's own caveat).
// --- Scene-change pointer invalidation (05.1-16 checkpoint finding).
//     Every cached engine pointer in this file is a BORROWED Object* with no ownership and no
//     liveness signal. A scene swap (loadScene, or wsUnloadSnapshot+wsLoad) destroys the entire
//     object graph, so every one of them dangles immediately afterward — they were previously
//     set to nullptr ONLY at declaration and never cleared again for the life of the process.
//     Any subsequent deref (the strip's per-frame getContainingBuildingId(g_lastRayObj), the
//     gizmo's focus resolve) is then a use-after-free, which is the leading candidate for the
//     3,424-fault HUD-blank run in this plan's evidence section.
//     Disarms any in-flight edit too: an arm captured against a destroyed object can never be
//     persisted meaningfully, and silently keeping g_capArmed set would let a Persist write a
//     row for an object that no longer exists. ---
void invalidateSceneCachedPointers(const char* why) {
    g_lastHoverObj  = nullptr;
    g_latchedFocus  = nullptr;
    g_probeHoverPtr = nullptr;
    g_lastRayObj    = nullptr;
    g_lastRayObjTmpl[0] = '\0';
    g_lastRayId     = 0;
    g_pickedId      = 0;
    g_capFocus      = nullptr;
    g_capArmed      = false;
    char buf[160];
    std::snprintf(buf, sizeof(buf), "overlay: scene changed (%s) — cached object pointers invalidated, edit disarmed\n", why);
    dbg(buf);
}

void drainDeferredCommands() {
    // Snapshot the count at entry. A command RE-QUEUED during this drain (the LoadScene
    // cleanup->load handoff below) is appended past this bound and is therefore NOT consumed
    // until the NEXT mainLoop tick — which is precisely the one-full-frame gap between
    // cleanupScene and loadScene that the engine requires. Draining `while (count > 0)` would
    // pick the re-queued command straight back up in this same pass and collapse the gap,
    // reproducing the exact FATAL this sequencing exists to avoid.
    int toProcess = g_deferredCount;
    while (toProcess-- > 0 && g_deferredCount > 0) {
        DeferredCmd cmd = g_deferredQueue[g_deferredHead];
        g_deferredQueue[g_deferredHead].kind = DeferredCmdKind::None;
        g_deferredHead = (g_deferredHead + 1) % kDeferredQueueCapacity;
        --g_deferredCount;

        switch (cmd.kind) {
            case DeferredCmdKind::LoadScene:
                if (!swg::endpoints::gameLoadScene) {
                    // Endpoint unresolved on this client build — the command can never execute.
                    // Ack now (0 = endpoint unresolved) rather than stranding a HOST_CMD-originated
                    // request's pending slot until its 11 s timeout (Plan 08's "agent always-acks").
                    if (cmd.hostCmdEpoch != 0) channelWriteHostCommandResult(0, cmd.hostCmdEpoch);
                    break;
                }
                // TWO-FRAME SEQUENCE (05.1-16 checkpoint finding). Draining outside Present is
                // necessary but NOT sufficient: calling loadScene while a scene is already live
                // FATALs at InputScheme.cpp:480 ("fetchGroundInputMap called on a new player
                // without releasing old one"). Verified live — it crashes in-world but SUCCEEDS
                // from the login screen, where there is no GroundScene/player to release.
                //
                // Ground truth is Utinni's hkMainLoop state machine (game.cpp:499-554), which is
                // NOT "cleanup then load" in one call: frame N runs cleanupScene and latches
                // sceneCleaned; frame N+1 runs loadScene. The engine needs a full tick between
                // teardown and construction. We reproduce that by re-queueing ourselves once
                // after cleanup, so the load lands on the NEXT drain (i.e. the next mainLoop
                // tick) rather than immediately after the teardown returns.
                if (!cmd.sceneCleaned && swg::endpoints::gameCleanupScene) {
                    dbg("overlay: deferred LoadScene — frame 1: cleanupScene (scene is live)");
                    // Invalidate BEFORE the teardown, not only after frame 2's loadScene. The object
                    // graph dies HERE — a full frame before the load — and a DebugView capture caught
                    // the strip faulting inside exactly that window (loadScene @53874.902 -> strip
                    // fault @53875.015 -> invalidation @53875.027). Clearing at frame 1 closes it; the
                    // frame-2 invalidation stays as the belt-and-braces pass for anything loadScene
                    // itself creates and then discards.
                    invalidateSceneCachedPointers("cleanupScene (frame 1)");
                    ++g_sceneEpoch;   // 05.1-18: the ONLY signal that bumps once per scene swap
                    swg::endpoints::gameCleanupScene();
                    DeferredCmd next = cmd;          // hostCmdEpoch carries forward with the copy
                    next.sceneCleaned = true;
                    if (!enqueueDeferredCmd(next)) {
                        dbg("overlay: deferred LoadScene — re-queue FAILED after cleanup; scene left unloaded");
                        // Queue-overflow drop: the command will now NEVER execute. Ack 0 so the
                        // renderer's pending slot resolves immediately instead of timing out.
                        if (cmd.hostCmdEpoch != 0) channelWriteHostCommandResult(0, cmd.hostCmdEpoch);
                    } else {
                        g_loadSceneAwaitingFrame2 = true;   // 05.1-17: block Reload until frame 2 runs
                    }
                    break;   // do NOT load this frame — ack (if any) happens on frame 2 or the drop path above
                }
                dbg("overlay: deferred LoadScene — frame 2: loadScene (game thread, outside Present)");
                swg::endpoints::gameLoadScene(cmd.terrain, cmd.player);
                ++g_sceneEpoch;
                g_loadSceneAwaitingFrame2 = false;
                invalidateSceneCachedPointers("loadScene");
                // Ack-on-execution (this plan's design decision, stated in the checkpoint return):
                // the scene has ACTUALLY swapped by this line, so code 1 here is truthful, not a
                // hopeful ack-on-enqueue. Plan 08's 11 s timeout comfortably absorbs the one-plus-
                // frame delay between HOST_CMD consumption and this point.
                if (cmd.hostCmdEpoch != 0) channelWriteHostCommandResult(1, cmd.hostCmdEpoch);
                break;
            case DeferredCmdKind::Reload:
                if (!swg::endpoints::wsLoad) {
                    if (cmd.hostCmdEpoch != 0) channelWriteHostCommandResult(0, cmd.hostCmdEpoch);
                    break;
                }
                // 05.1-17 INTERLEAVE GUARD. A LoadScene is mid two-frame sequence: running the
                // reload here would unload+load against a scene cleanupScene already tore down,
                // and frame 2 would then load on top of the result. Defer behind it.
                //
                // The re-enqueue lands past this pass's toProcess bound, so it cannot livelock.
                // The `break` is load-bearing: falling through would both execute AND double-ack.
                if (g_loadSceneAwaitingFrame2) {
                    if (!enqueueDeferredCmd(cmd)) {
                        // Already dequeued and now unqueueable — the command is LOST. Ack 0 or the
                        // epoch strands to its 11s timeout (mirrors the LoadScene precedent above).
                        dbg("overlay: deferred Reload — re-queue FAILED behind LoadScene; request dropped");
                        if (cmd.hostCmdEpoch != 0) channelWriteHostCommandResult(0, cmd.hostCmdEpoch);
                    } else {
                        dbg("overlay: deferred Reload — deferred behind an in-flight LoadScene\n");
                    }
                    break;
                }
                // Invalidate BEFORE the teardown: the object graph dies at wsUnloadSnapshot, not at
                // wsLoad. Matches the LoadScene frame-1 precedent above.
                invalidateSceneCachedPointers("reload current scene");
                dbg("overlay: deferred Reload — wsUnloadSnapshot+wsLoad (game thread, outside Present)");
                if (swg::endpoints::wsUnloadSnapshot) swg::endpoints::wsUnloadSnapshot();
                swg::endpoints::wsLoad(cmd.scene);
                // 05.1-17: do NOT ack here. wsLoad only STARTS a phased parse; the world is not
                // rebuilt for another ~1-2s. Hand the epoch to the completion poll so ack=1 means
                // "world rebuilt" and Plans 12/15 can trust it as a timing signal.
                if (cmd.hostCmdEpoch != 0) {
                    if (swg::endpoints::wsIsParsePending) {
                        g_pendingReloadAckEpoch  = cmd.hostCmdEpoch;
                        g_pendingReloadAckTicks  = 0;
                        g_pendingReloadSawPending = false;
                    } else {
                        // Legacy SWGEmu / row unresolved: degrade honestly rather than silently.
                        // The ack means "the call was made", NOT "the world is rebuilt".
                        dbg("overlay: deferred Reload — wsIsParsePending unbound; acking on execution (ack != rebuilt)\n");
                        channelWriteHostCommandResult(1, cmd.hostCmdEpoch);
                    }
                }
                break;
            case DeferredCmdKind::None:
                break;
        }
    }

    // 05.1-17: resolve a pending reload ack once the snapshot parse actually completes.
    //
    // POLL, never force. wsIsParsePending is the only ws* row with no finishLoadNow() prologue
    // — wsGetNodeCount would force-finish here and freeze the client for the whole remaining
    // parse (~1-2s), which is exactly the design this replaced. Do not "optimise" it back.
    //
    // The engine advances the parse itself every frame (GroundScene::update since 04c3f8e11),
    // so this is purely observational.
    if (g_pendingReloadAckEpoch != 0 && swg::endpoints::wsIsParsePending) {
        const bool parsing = swg::endpoints::wsIsParsePending() != 0;
        if (parsing) {
            g_pendingReloadSawPending = true;   // proves we observed the rebuild, not just a gap
        }
        ++g_pendingReloadAckTicks;

        if (!parsing) {
            char buf[160];
            std::snprintf(buf, sizeof(buf),
                "overlay: reload complete — wsIsParsePending 1->0 after %u ticks (sawPending=%d); acking rebuilt\n",
                g_pendingReloadAckTicks, g_pendingReloadSawPending ? 1 : 0);
            dbg(buf);
            channelWriteHostCommandResult(1, g_pendingReloadAckEpoch);
            g_pendingReloadAckEpoch = 0;
        } else if (g_pendingReloadAckTicks >= kReloadAckTimeoutTicks) {
            // Never claim success on a timeout. 0 is Plan 08's existing "did not complete" code;
            // no new ack vocabulary is invented here.
            char buf[160];
            std::snprintf(buf, sizeof(buf),
                "overlay: reload ack TIMEOUT — still parsing after %u ticks; acking not-complete\n",
                g_pendingReloadAckTicks);
            dbg(buf);
            channelWriteHostCommandResult(0, g_pendingReloadAckEpoch);
            g_pendingReloadAckEpoch = 0;
        }
    }
}

// --- 05.1-18: PortalTransitionGuard — the ONLY permitted caller of setPortalTransitionsEnabled.
//
//     That endpoint is GLOBAL, UNSCOPED engine state: no RAII, no refcount (provider's explicit
//     warning, v28 handback §1.1). A leaked `false` disables portal transitions for the REST OF
//     THE SESSION, and the resulting symptom — doors stop reparenting you, interiors render wrong
//     everywhere — looks nothing like its cause. A destructor is therefore mandatory rather than
//     stylistic: this overlay wraps regions in SEH, and an unwind past a manual re-enable would
//     leak the flag silently.
//
//     Null-safe: if the row is unresolved the guard is inert and the caller still works, just
//     without suppression (the pre-v28 behavior).
struct PortalTransitionGuard {
    bool engaged = false;
    PortalTransitionGuard() {
        if (swg::endpoints::setPortalTransitionsEnabled) {
            swg::endpoints::setPortalTransitionsEnabled(false);
            engaged = true;
        }
    }
    ~PortalTransitionGuard() {
        if (engaged) swg::endpoints::setPortalTransitionsEnabled(true);
    }
    PortalTransitionGuard(const PortalTransitionGuard&) = delete;
    PortalTransitionGuard& operator=(const PortalTransitionGuard&) = delete;
};

// --- 05.1-18: cell-aware teleport, shared by the local button and the HOST_CMD action.
//
//     Implements the engine's own authored-move idiom verbatim (GroundScene.cpp:1492-1497), which
//     the provider handed us and which ClientInteriorLayoutManager::applyInteriorLayout also uses
//     internally:
//
//         setParentCell(C); { suppress } setTransform_o2p(...); { restore } objectWarped(player);
//
//     Why not "write o2w then reparent": that ordering was correct only while suppression was
//     UNAVAILABLE. The portal sweep is a side effect of the transform write, so an unsuppressed
//     write in the wrong cell can silently reparent the player mid-teleport and abort the DPVS +
//     collision notifications. With the bracket the question is moot — do not reintroduce it.
//
//     Returns true if the player moved. Refuses (false) when mounted: setParentCell on a child
//     object silently corrupts its pose in Release builds (the DEBUG_FATAL at Object.cpp:1396 is
//     #if 0'd out), and getParentCell cannot detect it — it walks THROUGH mount attachment by
//     design. getAttachedTo is the correct probe and is why v28 shipped it.
//
//     GAME-THREAD ONLY. setParentCell is a game-thread-only row; never reach this from the D-03
//     poll thread in agent_main.cpp.
bool teleportPlayerToWorldPos(const float pos[3], const char* origin, char* outNote, size_t outNoteCap) {
    void* player = swg::endpoints::getPlayer ? swg::endpoints::getPlayer() : nullptr;

    // One structured record per attempt, null included as a field rather than a separate line, so a
    // capture can answer "did this click land in the cleanupScene->loadScene gap?" mechanically.
    // The corrected mechanism is a transient NULL player in that window — not a stale pointer.
    {
        char tb[224];
        std::snprintf(tb, sizeof(tb),
            "overlay: teleport click — origin=%s player=%p sceneEpoch=%u target=(%.1f, %.1f, %.1f)\n",
            origin, player, g_sceneEpoch, pos[0], pos[1], pos[2]);
        dbg(tb);
    }

    if (!player || !swg::endpoints::setTransform_o2w) {
        if (outNote) std::snprintf(outNote, outNoteCap, "no player — reload/scene-swap in progress?");
        dbg("overlay: teleport refused — no player (likely inside the cleanupScene->loadScene window)\n");
        return false;
    }

    // SAFETY: mounted/child object. Refuse rather than corrupt the pose.
    //
    // ⚠ getAttachedTo is NOT a mount probe on its own — FALSIFIED LIVE 2026-08-03. Cell attachment
    // and mount attachment share m_attachedToObject (setParentCell does
    // attachToObject_w(&cellProperty->getOwner(), false)), so ANY player standing inside a POB
    // reports non-null. The first cut of this guard used it raw and refused every teleport made
    // from inside the cantina — i.e. it broke the exact workflow this plan exists to enable.
    // The true discriminator is the m_childObject FLAG (Object::isChildObject), which no advertised
    // row exposes; requested from the provider.
    //
    // INTERIM NARROWING: only treat an attachment as a mount when the player's parent cell is the
    // WORLD cell. Case analysis:
    //   mounted outdoors  -> parent=world, attached=mount  -> REFUSED   (correct; the common case)
    //   unmounted outdoors-> parent=world, attached=null   -> allowed   (correct)
    //   unmounted indoors -> parent=cell,  attached=owner  -> allowed   (correct; was the false positive)
    //   mounted indoors   -> parent=cell,  attached=mount  -> allowed   (NOT guarded — same exposure
    //                                                                    as before this plan, not worse)
    if (swg::endpoints::getAttachedTo && swg::endpoints::getWorldCellProperty &&
        swg::endpoints::getParentCell) {
        void* const attached  = swg::endpoints::getAttachedTo(player);
        void* const parent    = swg::endpoints::getParentCell(player);
        void* const worldCell = swg::endpoints::getWorldCellProperty();
        if (attached != nullptr && parent == worldCell) {
            if (outNote) std::snprintf(outNote, outNoteCap, "refused — dismount first (reparent would corrupt pose)");
            dbg("overlay: teleport REFUSED — attached in the world cell (mount/vehicle)\n");
            return false;
        }
    }

    const float t[12] = {
        1.0f, 0.0f, 0.0f, pos[0],
        0.0f, 1.0f, 0.0f, pos[1],
        0.0f, 0.0f, 1.0f, pos[2],
    };

    // Resolve the destination cell. findCellAtWorldPosition NEVER returns null (world-cell
    // fallback), which matters because setParentCell FATALs on a null cell. Without the row we
    // fall back to the pre-v28 behavior: write only, no reparent, interiors render wrong.
    void* destCell = swg::endpoints::findCellAtWorldPosition
        ? swg::endpoints::findCellAtWorldPosition(pos[0], pos[1], pos[2])
        : nullptr;

    if (destCell && swg::endpoints::setParentCell) {
        void* worldCell = swg::endpoints::getWorldCellProperty ? swg::endpoints::getWorldCellProperty() : nullptr;
        const int rc = swg::endpoints::setParentCell(player, destCell);
        {
            PortalTransitionGuard guard;              // suppress the sweep across the write
            swg::endpoints::setTransform_o2w(player, t);
        }
        if (swg::endpoints::objectWarped) swg::endpoints::objectWarped(player);

        void* nowCell = swg::endpoints::getParentCell ? swg::endpoints::getParentCell(player) : nullptr;
        char cb[224];
        std::snprintf(cb, sizeof(cb),
            "overlay: teleport cell — dest=%p world=%p setParentCell=%d after=%p suppressed=%d warped=%d\n",
            destCell, worldCell, rc, nowCell,
            swg::endpoints::setPortalTransitionsEnabled ? 1 : 0,
            swg::endpoints::objectWarped ? 1 : 0);
        dbg(cb);

        if (outNote) {
            std::snprintf(outNote, outNoteCap,
                (worldCell && destCell == worldCell) ? "moved (outside)" : "moved (interior cell)");
        }
        return true;
    }

    // Degraded path — no cell resolver. Honest, not silent.
    swg::endpoints::setTransform_o2w(player, t);
    if (outNote) std::snprintf(outNote, outNoteCap, "moved (no cell resolver — interiors may render wrong)");
    dbg("overlay: teleport — findCellAtWorldPosition/setParentCell unresolved; wrote transform only\n");
    return true;
}

// --- 05.1-09: HOST_CMD dispatch — the remote-trigger counterpart to the local ImGui buttons
//     above (reload/editor-scene/teleport) plus DESPAWN_NODE (no local button exists for it).
//     Structural analog: applyPendingRebind()'s per-frame consume-once-per-epoch shape (torn-read
//     bail, epoch-vs-last-applied gate, mark-applied BEFORE dispatch). Called from renderFrame()
//     immediately after applyPendingRebind(), same as that function's own call site discipline.
//
//     Per-action routing (05.1-16-SUMMARY's handoff table, binding): RELOAD_CURRENT_SCENE and
//     LOAD_EDITOR_SCENE are BOTH proven-FATAL from inside Present (scene-lifecycle class) and are
//     therefore ALWAYS routed through the deferred queue — never called directly here, even though
//     this function itself runs inside Present. TELEPORT is proven safe from Present (05.1-05
//     checkpoint) and is called directly, matching the existing teleport button. DESPAWN_NODE
//     mutates snapshot state but does not recreate the player/scene, so it is also called directly
//     (UNKNOWN-verified-live per the handoff table — Task 3 smoke-tests it).
//
//     ACK-TIMING DESIGN DECISION (required by this plan, not pre-decided by 05.1-16 or Plan 08):
//     deferred actions ack ON EXECUTION, not on enqueue. Enqueue-time acking would tell the
//     renderer "success" before the scene has actually swapped — a lie if the two-frame sequence
//     later hits an unresolved endpoint or a queue-overflow drop. Ack-on-execution is truthful and
//     the 11 s PLACEMENT_ACK_TIMEOUT_MS-sibling budget (Plan 08's HOST_CMD ACK PROTOCOL) comfortably
//     absorbs the one-plus-frame delay between consumption here and execution in
//     drainDeferredCommands(). See that function's LoadScene/Reload cases for where the deferred
//     ack actually publishes (success on real execution; 0 on unresolved-endpoint or overflow-drop
//     — every path acks exactly once, never silently stranding the renderer's pending slot).
void handleHostCommand() {
    HostCommand cmd = {};
    if (!channelReadHostCommand(&cmd)) return;   // torn read or channel closed — retry next frame

    if (cmd.epoch == 0) {
        // R9 review, BB4 (ground-truth adjudicated): a zeroed epoch slot means a fresh
        // openChannel just re-initialized the region — channel_binding.cpp:153-154's
        // std::memset(view, 0, CHANNEL_BYTE_SIZE) runs UNCONDITIONALLY on every open, including a
        // re-open while this agent is still running, so no REGION epoch survives a toolkit
        // restart. Only this AGENT-LOCAL tracker can go stale across that restart. Resetting here
        // guarantees a restarted toolkit's epochs 1..N can never silently collide with (and be
        // swallowed by) a stale tracker left over from a previous toolkit session.
        g_lastAppliedHostCmdEpoch = 0;
        return;
    }
    if (cmd.epoch == g_lastAppliedHostCmdEpoch) return;   // already handled this epoch (self-loop)
    g_lastAppliedHostCmdEpoch = cmd.epoch;                // mark BEFORE dispatch — consume-once, never re-entrant

    int32_t code = 0;
    bool deferredAck = false;   // true = a queued command owns publishing its own ack later

    switch (cmd.action) {
        case HOST_CMD_ACTION_RELOAD_CURRENT_SCENE: {
            char scene[128] = {};
            const bool haveScene = swg::endpoints::getSceneId && swg::endpoints::wsLoad &&
                swg::endpoints::getSceneId(scene, sizeof(scene)) > 0 && scene[0] != '\0';
            if (haveScene && enqueueDeferredReload(scene, cmd.epoch)) {
                deferredAck = true;   // drainDeferredCommands() acks this epoch on real execution
            }
            // else: no scene resolved, or the queue is full — code stays 0, acked below now.
            break;
        }
        case HOST_CMD_ACTION_LOAD_EDITOR_SCENE: {
            if (swg::endpoints::gameLoadScene && cmd.str1[0] != '\0' && cmd.str2[0] != '\0' &&
                enqueueDeferredLoadScene(cmd.str1, cmd.str2, cmd.epoch)) {
                deferredAck = true;   // drainDeferredCommands() acks this epoch on real execution
            }
            // else: endpoint unresolved, empty terrain/avatar, or the queue is full — code 0 below.
            break;
        }
        case HOST_CMD_ACTION_TELEPORT: {
            // Same call sequence as the existing "Go##teleport" button (identity rotation,
            // vec3 as world position) — inlined here rather than extracted into a shared helper
            // so the existing button's own instrumentation (click trace + read-back log, added by
            // 05.1-16 to diagnose the stale-player-after-reload defect) stays untouched.
            // 05.1-18: shared cell-aware implementation. Returns false for "no player" (the
            // cleanupScene->loadScene window) and for a mounted refusal; both correctly ack 0.
            if (teleportPlayerToWorldPos(cmd.vec3, "HOST_CMD", nullptr, 0)) code = 1;
            break;
        }
        case HOST_CMD_ACTION_DESPAWN_NODE: {
            if (swg::endpoints::wsRemoveNode) {
                // Verbatim pass-through, per this plan's behavior spec — 1/0/-1 is the CALLER's
                // contract to interpret (hostCommand.ts's describeHostCommandResult), never
                // remapped here.
                code = swg::endpoints::wsRemoveNode(static_cast<int64_t>(cmd.id));
            }
            // else: endpoint unresolved — code stays 0.
            break;
        }
        default:
            // START_PLACEMENT/CANCEL_PLACEMENT (4/5 — Plan 12's dedicated ghost/reticle
            // state-machine work) and any unrecognized future action value: fail-closed, never a
            // crash or a silent drop — code stays 0 and is published below, so Plan 12's future
            // handler can widen this same dispatch by adding cases rather than fighting over
            // epoch tracking (T-05.1-09b).
            code = 0;
            break;
    }

    if (!deferredAck) {
        channelWriteHostCommandResult(code, cmd.epoch);
    }
}

// --- 05.1-16 preferred drain point: detour of game::mainLoop (Game::runGameLoopOnce), the
//     real per-frame tick. g_origMainLoop is the trampoline to the ORIGINAL tick (identical
//     Present-call-included frame this build already runs) — we call it FIRST so this frame's
//     own Present has fully returned, THEN drain. At that point Graphics::Present's entire
//     call chain (Graphics.cpp:1171 in the FATAL stack — see 05.1-16-PLAN.md evidence) has
//     unwound completely: this is a stack frame ABOVE Present, not nested inside it, mirroring
//     Utinni's own proven hkMainLoop precedent for issuing game::loadScene from exactly this
//     call site (game.cpp:460-553). ---
void __cdecl hkMainLoop(bool presentToWindow, HWND hwnd, int width, int height) {
    if (g_origMainLoop != nullptr) g_origMainLoop(presentToWindow, hwnd, width, height);
    drainDeferredCommands();
}

void renderFrame() {
    ensureImguiInit();
    if (!g_imguiInit) return;

    // Flip-discard unbinds the RTV each Present — rebind the cached one before drawing.
    if (g_rtv == nullptr) g_rtv = createBackbufferRtv();

    ImGui_ImplDX11_NewFrame();
    ImGui_ImplWin32_NewFrame();
    ImGui::NewFrame();

    // Decoration persist (model D): consume any REBIND the toolkit published (game thread,
    // un-gated by the panel/header — must run every frame the overlay renders). Runs BEFORE
    // the strip below so applyPendingRebind's result-epoch is always the LATEST one the strip
    // can show the same frame it lands — that property does not depend on hover-tracking
    // order and is unaffected by the 05.1-16 reorder below.
    applyPendingRebind();

    // 05.1-09: consume any HOST_CMD the toolkit published this frame (remote
    // reload/editor-scene/teleport/despawn trigger). Same "run every frame, un-gated" discipline
    // as applyPendingRebind() immediately above — a SEPARATE region/epoch space, so ordering
    // relative to applyPendingRebind() has no cross-effect either way.
    handleHostCommand();

    // Hover tracking: track the last non-null hud hover pick every frame so a decoration
    // hovered in the world can still be latched after the cursor moves to the panel.
    // Follow-hover: ONCE a decoration is latched (opted into decoration mode), hovering
    // another one switches the latch to it — so you don't Clear+re-Latch per chair. A
    // drag locks the current one (g_gizmoWasUsing); Clear latch exits back to normal.
    // Gated on g_latchedFocus != null so it never hijacks normal ray-pick/target editing.
    {
        ImGuiIO& io = ImGui::GetIO();
        // Only sample when the cursor is over the WORLD (not our panel), so the probe
        // reflects what's under the cursor in-game, not the overlay.
        if (!io.WantCaptureMouse) {
            void* h = resolveHoverPick();
            g_probeHoverPtr = h;   // current sample (may be null — e.g. hovering a pure decoration)
            if (h != nullptr) {
                g_lastHoverObj = h;   // sticky non-null, used for latching
                if (swg::endpoints::getTemplateFilename) {
                    const char* t = swg::endpoints::getTemplateFilename(h);
                    if (t) { std::strncpy(g_lastHoverTmpl, t, sizeof(g_lastHoverTmpl) - 1); g_lastHoverTmpl[sizeof(g_lastHoverTmpl) - 1] = '\0'; }
                    else g_lastHoverTmpl[0] = '\0';
                }
                g_lastHoverNet = swg::endpoints::getNetworkId
                    ? static_cast<int64_t>(reinterpret_cast<intptr_t>(swg::endpoints::getNetworkId(h))) : 0;
            } else {
                g_lastHoverTmpl[0] = '\0';   // no current pick — the table case
                g_lastHoverNet = 0;
            }
            if (swg::endpoints::collideScreenRay) {
                int64_t rid = 0; float rp[3] = {};
                g_lastRayHit = swg::endpoints::collideScreenRay(static_cast<int>(io.MousePos.x),
                                                               static_cast<int>(io.MousePos.y), 0, &rid, rp) != 0;
                if (g_lastRayHit) { g_lastRayId = rid; g_lastRayPt[0] = rp[0]; g_lastRayPt[1] = rp[1]; g_lastRayPt[2] = rp[2]; }
            }
            // v22 borrowed-Object* pick — the raw hit Object* + its template name. The
            // template is the §2.1 tiebreak: does the ray strike the TABLE or the floor?
            if (swg::endpoints::collideScreenRayObject) {
                void* ro = swg::endpoints::collideScreenRayObject(static_cast<int>(io.MousePos.x),
                                                                  static_cast<int>(io.MousePos.y), 0);
                g_lastRayObj = ro;
                if (ro != nullptr && swg::endpoints::getTemplateFilename) {
                    const char* t = swg::endpoints::getTemplateFilename(ro);
                    if (t) { std::strncpy(g_lastRayObjTmpl, t, sizeof(g_lastRayObjTmpl) - 1); g_lastRayObjTmpl[sizeof(g_lastRayObjTmpl) - 1] = '\0'; }
                    else g_lastRayObjTmpl[0] = '\0';
                } else {
                    g_lastRayObjTmpl[0] = '\0';
                }
            }
        }
        // NOT while a decoration edit is armed — the armed decoration (a ray-object latch) is the
        // deliberate target; follow-hover keys on the HUD pick (g_lastHoverObj), which for an
        // id-less .ilf decoration is the last TANGIBLE hovered (a chair), and would yank the gizmo
        // off the armed table back onto that chair every frame.
        if (g_followHover && !g_capArmed && g_latchedFocus != nullptr && !g_gizmoWasUsing && g_lastHoverObj != nullptr) {
            g_latchedFocus = g_lastHoverObj;
        }
    }

    // 020-A Status Strip: the productized in-game half of the boundary rule ("point at the
    // world" = overlay; rows/fields/text = the World panel). 05.1-16 REORDER (Bug A fix): now
    // called AFTER the hover-tracking block above (not before it, as originally), so
    // g_lastRayObj/g_lastRayObjTmpl are THIS frame's values, not a one-frame-stale borrowed
    // pointer that can already be freed by the time the strip reads it. Guarded (own SEH) so
    // a bad pointer costs this label for one frame, never the rest of the overlay.
    renderDecorationStripGuarded();

    // --- STATIC overlay (step 2): proof-of-life only, no engine interaction. ---
    ImGui::SetNextWindowPos(ImVec2(24, 24), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(340, 0), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowBgAlpha(0.75f);   // ~25% see-through onto the live scene
    if (ImGui::Begin("SWG Toolkit — Live World Editor (Slice-0)")) {
        const ImGuiIO& io = ImGui::GetIO();
        ImGui::Text("In-game overlay is ALIVE.");
        ImGui::Separator();
        ImGui::Text("ImGui %s", ImGui::GetVersion());
        ImGui::Text("%.1f FPS  (%.2f ms/frame)", io.Framerate, 1000.0f / (io.Framerate > 0 ? io.Framerate : 1.0f));
        ImGui::Text("Backbuffer: %.0f x %.0f", io.DisplaySize.x, io.DisplaySize.y);
        ImGui::Separator();

        // --- Input proof (step 3): if these respond, the WndProc subclass works. ---
        static int s_clicks = 0;
        if (ImGui::Button("Click me")) s_clicks++;
        ImGui::SameLine();
        ImGui::Text("clicks: %d", s_clicks);
        ImGui::Text("mouse: %.0f, %.0f", io.MousePos.x, io.MousePos.y);
        ImGui::Text("WantCaptureMouse: %d  WantCaptureKeyboard: %d",
                    io.WantCaptureMouse ? 1 : 0, io.WantCaptureKeyboard ? 1 : 0);
        ImGui::Separator();

        // --- Selection: let the reticle target ANY object, not just creatures/NPCs.
        //     Advertised-only engine call; runs here on the game thread. ---
        static bool s_allowAnyPrev = false;
        const bool haveAllowAny = (swg::endpoints::setAllowTargetAnything != nullptr);
        if (!haveAllowAny) ImGui::BeginDisabled();
        ImGui::Checkbox("Allow target anything (select any object)", &g_allowTargetAnything);
        if (!haveAllowAny) {
            ImGui::EndDisabled();
            ImGui::SameLine(); ImGui::TextDisabled("(unresolved)");
        }
        if (g_allowTargetAnything != s_allowAnyPrev) {
            s_allowAnyPrev = g_allowTargetAnything;
            if (swg::endpoints::setAllowTargetAnything)
                swg::endpoints::setAllowTargetAnything(g_allowTargetAnything);
        }
        ImGui::Separator();

        // --- Gizmo controls (step 4). Edits the current target, else the player. ---
        ImGui::Checkbox("Enable transform gizmo", &g_gizmoEnabled);
        if (g_gizmoEnabled) {
            ImGui::TextDisabled("target-else-player · drag axes to move the live object");
            ImGui::RadioButton("Translate", &g_gizmoOp, 0); ImGui::SameLine();
            ImGui::RadioButton("Rotate", &g_gizmoOp, 1);    ImGui::SameLine();
            ImGui::RadioButton("Scale", &g_gizmoOp, 2);
            ImGui::RadioButton("World", &g_gizmoMode, 0);   ImGui::SameLine();
            ImGui::RadioButton("Local", &g_gizmoMode, 1);
            ImGui::TextDisabled("Esc while dragging = revert");
        }
        ImGui::Separator();

        // --- World edit: insert an object at the player, then save to .ws (advertised
        //     worldSnapshot editor). All calls run HERE on the game thread. ---
        ImGui::TextDisabled("World edit (advertised snapshot)");
        static char s_insertTemplate[256] = "";
        static long long s_lastInsertId = 0;
        static int s_lastSaveResult = -1;

        const bool haveInsert = (swg::endpoints::wsAddObject != nullptr);
        if (!haveInsert) ImGui::BeginDisabled();

        // Grab the current selection's template so Insert spawns a known-valid copy.
        if (ImGui::Button("Copy template from selection")) {
            void* sel = resolveFocusObject();
            if (sel && swg::endpoints::getTemplateFilename) {
                const char* tn = swg::endpoints::getTemplateFilename(sel);
                if (tn) {
                    std::strncpy(s_insertTemplate, tn, sizeof(s_insertTemplate) - 1);
                    s_insertTemplate[sizeof(s_insertTemplate) - 1] = '\0';
                }
            }
        }
        ImGui::InputText("Template", s_insertTemplate, sizeof(s_insertTemplate));
        if (ImGui::Button("Insert at player") && s_insertTemplate[0] != '\0') {
            void* player = swg::endpoints::getPlayer ? swg::endpoints::getPlayer() : nullptr;
            if (player && swg::endpoints::getTransform_o2w && swg::endpoints::wsAddObject) {
                void* xf = swg::endpoints::getTransform_o2w(player);
                if (xf) {
                    float t12[12];
                    std::memcpy(t12, xf, sizeof(t12));            // player o2w = row-major 3x4
                    s_lastInsertId = static_cast<long long>(
                        swg::endpoints::wsAddObject(s_insertTemplate, t12, 0));  // containedById 0 = world
                }
            }
        }
        if (g_havePickPoint) {
            ImGui::SameLine();
            if (ImGui::Button("Insert at cursor") && s_insertTemplate[0] != '\0') {
                float t12[12];
                void* player = swg::endpoints::getPlayer ? swg::endpoints::getPlayer() : nullptr;
                void* pxf = (player && swg::endpoints::getTransform_o2w) ? swg::endpoints::getTransform_o2w(player) : nullptr;
                if (pxf) std::memcpy(t12, pxf, sizeof(t12));   // player facing
                else { std::memset(t12, 0, sizeof(t12)); t12[0] = t12[5] = t12[10] = 1.0f; }
                t12[3] = g_pickPoint[0]; t12[7] = g_pickPoint[1]; t12[11] = g_pickPoint[2];  // col3 = position
                if (swg::endpoints::wsAddObject)
                    s_lastInsertId = static_cast<long long>(swg::endpoints::wsAddObject(s_insertTemplate, t12, 0));
            }
        }
        if (!haveInsert) { ImGui::EndDisabled(); ImGui::SameLine(); ImGui::TextDisabled("(unresolved)"); }
        if (s_lastInsertId != 0) ImGui::Text("Inserted node id: %lld", s_lastInsertId);

        // Ray-pick status + selection control.
        if (g_havePickPoint)
            ImGui::Text("Pick point: %.1f, %.1f, %.1f", g_pickPoint[0], g_pickPoint[1], g_pickPoint[2]);
        if (g_pickedId != 0) {
            ImGui::Text("Picked selection id: %lld", static_cast<long long>(g_pickedId));
            ImGui::SameLine();
            if (ImGui::SmallButton("Clear")) g_pickedId = 0;
        } else {
            ImGui::TextDisabled("Left-click an object in-world to select it");
        }

        // Persist the authored snapshot to its .ws on disk.
        if (swg::endpoints::wsSaveSnapshot) {
            if (ImGui::Button("Save .ws")) s_lastSaveResult = swg::endpoints::wsSaveSnapshot();
            if (s_lastSaveResult >= 0) {
                static const char* kSave[] = { "ok", "no-snapshot", "no-loose-search-path",
                    "destination-shadowed", "id-int32-overflow", "buildout-set-integrity", "write-failure" };
                const char* m = (s_lastSaveResult >= 0 && s_lastSaveResult <= 6) ? kSave[s_lastSaveResult] : "?";
                ImGui::SameLine(); ImGui::Text("[%d %s]", s_lastSaveResult, m);
            }
            // Show the resolved save root so you can find the .ws (and see up front
            // whether a writable loose SearchPath even exists — 0 = save will fail).
            if (swg::endpoints::wsGetSavePath) {
                char pathBuf[512] = {};
                const int n = swg::endpoints::wsGetSavePath(pathBuf, sizeof(pathBuf));
                if (n > 0 && pathBuf[0] != '\0') ImGui::TextWrapped("Save path: %s", pathBuf);
                else ImGui::TextDisabled("Save path: none (no loose SearchPath — save fails with 2)");
            }
        }

        // Reload the CURRENT scene (one-click, v21 getSceneId) to see just-saved .ws edits.
        // Unload first to clear the sticky ms_sceneName, else load(currentScene) early-outs.
        //
        // 05.1-17: these buttons ENQUEUE now — they no longer call wsUnloadSnapshot()+wsLoad()
        // inline. Inline meant a click during a LoadScene's two-frame window ran a reload between
        // cleanupScene and loadScene; the queue's interleave guard is what prevents that. Reasoned
        // exception to 05.1-16's "do not route working paths through the queue" note.
        //
        // ⚠ DISCLOSED RESIDUAL (provider handback 0b2e9259c §2): a building with server-owned
        // occupants is now KEPT across a reload, and the kept root collides with the re-parsed node
        // (createObject -> CEC_objectAlreadyExists; update() strips the NEW node's sphere handle).
        // Such a building renders its PRE-EDIT state until a zone change or relog. Per-building
        // interior refresh is requested to retire this; see the note rendered below.
        if (swg::endpoints::wsLoad) {
            char scene[128] = {};
            const bool haveScene =
                swg::endpoints::getSceneId && swg::endpoints::getSceneId(scene, sizeof(scene)) > 0 && scene[0] != '\0';
            if (!haveScene) ImGui::BeginDisabled();
            if (ImGui::Button("Reload current scene")) {
                enqueueDeferredReload(scene, 0);   // 0 = local; no ack owed
            }
            if (!haveScene) ImGui::EndDisabled();
            ImGui::SameLine();
            ImGui::TextDisabled(haveScene ? scene : "(no scene loaded)");

            // Manual: load a DIFFERENT scene by id (advanced).
            static char s_sceneName[128] = "";
            ImGui::InputText("Scene id", s_sceneName, sizeof(s_sceneName));
            ImGui::SameLine();
            if (ImGui::Button("Load##scene") && s_sceneName[0] != '\0') {
                enqueueDeferredReload(s_sceneName, 0);
            }

            // Honest disclosure of the kept-root staleness (provider handback 0b2e9259c §2).
            // Occupied buildings survive the reload but render their PRE-EDIT state, so a modder
            // checking their work inside a populated building sees no change. Saying so beats
            // letting them conclude the editor dropped the edit.
            ImGui::TextDisabled("Occupied buildings are kept — their edits show after a zone change or relog.");
        }

        // --- Editor scene (offline, single-player): game::loadScene builds a FULL scene via the
        //     SceneCreator lifecycle with no server session, so the snapshot layer spawns every
        //     building itself — the canonical context to SEE a model-D rebind (derived template +
        //     edited .ilf) in-world, free of the hybrid server-stream replacement (§4).
        //     05.1-16 Bug B fix: this DESTROYS AND RECREATES the player/scene — calling it
        //     synchronously here (inside Present) re-entrantly FATALs (see plan evidence). The
        //     button now ENQUEUES only; the deferred queue executes it outside Present. ---
        if (swg::endpoints::gameLoadScene) {
            ImGui::Separator();
            ImGui::TextDisabled("Editor scene (OFFLINE single-player — replaces any live session!)");
            static char s_edTerrain[128] = "terrain/tatooine.trn";
            static char s_edPlayer[160]  = "object/creature/player/shared_human_male.iff";
            ImGui::InputText("Terrain##edscene", s_edTerrain, sizeof(s_edTerrain));
            ImGui::InputText("Avatar##edscene",  s_edPlayer,  sizeof(s_edPlayer));
            if (ImGui::Button("Load editor scene") && s_edTerrain[0] != '\0' && s_edPlayer[0] != '\0') {
                enqueueDeferredLoadScene(s_edTerrain, s_edPlayer);
            }
        }

        // --- Teleport player (identity rotation, world coords). The offline editor scene drops the
        //     avatar at the engine default; this jumps straight to the verify site. Same 12-float
        //     row-major 3x4 write the gizmo uses. Default = Mos Eisley cantina front door (approx;
        //     tweak Y if you land under/over terrain). ---
        if (swg::endpoints::getPlayer && swg::endpoints::setTransform_o2w) {
            static float s_tpPos[3] = { 3428.0f, 8.0f, -4788.0f };
            ImGui::InputFloat3("Teleport x/y/z", s_tpPos, "%.1f");
            ImGui::SameLine();
            static const char* s_tpNote = nullptr;
            if (ImGui::Button("Go##teleport")) {
                // 05.1-18: shared cell-aware implementation (RAII-suppressed bracket + objectWarped).
                // The read-back trace that discriminated "write landed" from "write did not take"
                // has served its purpose -- the write is proven correct (9/9 exact across two
                // sessions) and the defect was cell parentage, not the transform. The cell-decision
                // log line inside teleportPlayerToWorldPos supersedes it.
                static char s_tpNoteBuf[128];
                s_tpNoteBuf[0] = '\0';
                teleportPlayerToWorldPos(s_tpPos, "button", s_tpNoteBuf, sizeof(s_tpNoteBuf));
                s_tpNote = s_tpNoteBuf[0] ? s_tpNoteBuf : nullptr;
            }
            // OWN LINE, not SameLine — appended after the wide InputFloat3 + button this clipped off
            // the right edge of the window and read as "no message at all" during the 05.1-16 checkpoint.
            if (s_tpNote != nullptr) ImGui::TextDisabled("teleport: %s", s_tpNote);
        }
        ImGui::Separator();

        ImGui::TextDisabled("DXGI Present hook · advertised gl11 · input live");
    }
    ImGui::End();

    // --- World ray-pick: a left-click NOT over the overlay casts a ray from the
    //     cursor. objectsOnly=0 so we always get the ground/surface point (for
    //     placement); if an object is hit its id also becomes the gizmo selection.
    //     Game-thread call (Present hook). Skipped while ImGui wants the mouse. ---
    {
        ImGuiIO& io = ImGui::GetIO();
        if (swg::endpoints::collideScreenRay && !io.WantCaptureMouse &&
            ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            int64_t hitId = 0;
            float pt[3] = {};
            if (swg::endpoints::collideScreenRay(static_cast<int>(io.MousePos.x),
                                                 static_cast<int>(io.MousePos.y), 0, &hitId, pt)) {
                g_pickPoint[0] = pt[0]; g_pickPoint[1] = pt[1]; g_pickPoint[2] = pt[2];
                g_havePickPoint = true;
                if (hitId != 0) g_pickedId = hitId;   // object hit → select it (terrain id 0 leaves selection)
            }
        }
    }

    // ImGuizmo must draw within the active ImGui frame (after NewFrame, before Render).
    if (g_gizmoEnabled) drawGizmo();

    // Cursor: SWG hides/manages the OS cursor via DirectInput, so over our panel the OS
    // cursor flickers/vanishes. Draw ImGui's own SOFTWARE cursor whenever ImGui wants the
    // mouse (i.e. over the overlay) so it's always visible; hand the cursor back to the game
    // otherwise. (We don't suspend DirectInput on the advertised client, so this is the fix.)
    ImGui::GetIO().MouseDrawCursor = ImGui::GetIO().WantCaptureMouse;

    ImGui::Render();

    if (g_context != nullptr && g_rtv != nullptr) {
        ID3D11RenderTargetView* rtv = g_rtv;
        g_context->OMSetRenderTargets(1, &rtv, nullptr);
    }
    ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
}

// --- DXGI Present hook. Render BEFORE the original present. ---
HRESULT __stdcall hkSwapChainPresent(IDXGISwapChain* sc, UINT syncInterval, UINT flags) {
    static bool s_firstFire = true;
    if (s_firstFire) { s_firstFire = false; dbg("overlay: hkSwapChainPresent first fire (DXGI detour confirmed)"); }

    // A fault inside the overlay degrades to a skipped frame, never a client crash
    // (mirrors agent_main's poll-loop SEH discipline). This is the LAST-RESORT net —
    // the 020-A strip has its own scoped handler (renderDecorationStripGuarded) so a
    // fault there costs one label, not this entire frame (Bug A, 05.1-16).
    static uint32_t s_outerFaultCount = 0;
    __try {
        renderFrame();
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        ++s_outerFaultCount;
        // Rate-limited (hard requirement 4 — this line alone fired 3,424 times in one
        // pre-fix run): first 5 verbatim, then every 50th, always with a running count.
        if (s_outerFaultCount <= 5 || (s_outerFaultCount % 50) == 0) {
            char buf[160];
            std::snprintf(buf, sizeof(buf),
                "overlay: SEH fault in renderFrame [outer/last-resort] — frame skipped (count=%u)\n",
                s_outerFaultCount);
            dbg(buf);
        }
    }

    HRESULT hr = g_origPresent(sc, syncInterval, flags);

    // 05.1-16 FALLBACK drain (hard requirement 1): only reachable when the game::mainLoop
    // detour never installed (catalog row unresolved on this build — see tryInstall()).
    // g_origPresent() has just returned above, so the swap itself has completed; this is
    // NOT claimed to be main-loop semantics (we are still inside Graphics::Present's own
    // call chain, one frame short of hkMainLoop's true outside-Present position) — it is a
    // best-effort net for a build where the preferred drain point is unavailable.
    if (g_origMainLoop == nullptr) {
        drainDeferredCommands();
    }

    return hr;
}

// --- DXGI ResizeBuffers hook. Release our RTV BEFORE the original (else
//     DXGI_ERROR_INVALID_CALL), recreate it AFTER. (directx11.cpp:106.) ---
HRESULT __stdcall hkResizeBuffers(IDXGISwapChain* sc, UINT bufferCount, UINT width, UINT height, DXGI_FORMAT newFormat, UINT swapChainFlags) {
    if (g_rtv != nullptr) { g_rtv->Release(); g_rtv = nullptr; }
    HRESULT hr = g_origResizeBuffers(sc, bufferCount, width, height, newFormat, swapChainFlags);
    g_rtv = createBackbufferRtv();
    return hr;
}

// 05.1-16: one-shot install of the game::mainLoop detour (the preferred deferred-queue drain
// point — see hkMainLoop's own comment). Independent of the D3D11 swapchain (mainLoop ticks
// every frame from process start, well before a swapchain may exist), so this installs as
// soon as the endpoint resolves rather than waiting on tryInstall()'s D3D11 gate. Idempotent
// (guarded by g_origMainLoop != nullptr) and safe to poll repeatedly.
void tryInstallMainLoopHook() {
    if (g_origMainLoop != nullptr) return;                  // already installed
    if (swg::endpoints::mainLoop == nullptr) return;         // catalog row unresolved — poll again

    g_origMainLoop = reinterpret_cast<swg::endpoints::pMainLoop>(Detour::Create(
        reinterpret_cast<LPVOID>(swg::endpoints::mainLoop), reinterpret_cast<LPVOID>(&hkMainLoop), DETOUR_TYPE_PUSH_RET));

    if (g_origMainLoop != nullptr) {
        dbg("overlay: game::mainLoop detour installed (deferred-queue drain point live, outside Present)");
    } else {
        dbg("overlay: Detour::Create(game::mainLoop) failed — falling back to post-Present drain");
    }
}

// Advertised-contract consumer. Returns true once the detours are installed (latched).
bool tryInstall() {
    // Independent of the D3D11 latch below (mainLoop has nothing to do with the swapchain);
    // retried every acquisitionThread tick until it succeeds or the endpoint proves absent.
    tryInstallMainLoopHook();

    if (InterlockedCompareExchange(&g_installed, 0, 0) != 0) return true;

    HMODULE hGl11 = GetModuleHandleA("gl11_r.dll");
    if (hGl11 == nullptr) hGl11 = GetModuleHandleA("gl11_d.dll");
    if (hGl11 == nullptr) return false;   // not a D3D11 client (yet) — poll again

    auto getHookPoints = reinterpret_cast<pGetHookPoints>(GetProcAddress(hGl11, "GetHookPoints"));
    if (getHookPoints == nullptr) {
        static bool s_warned = true;
        if (s_warned) { s_warned = false; dbg("overlay: gl11 loaded but GetHookPoints not exported; no overlay"); }
        return false;
    }

    EngineDx11HookPoints hp = getHookPoints();
    if (hp.swapChain == nullptr || hp.device == nullptr || hp.context == nullptr) {
        return false;   // swapchain not created yet — poll again next tick
    }

    HWND hwnd = nullptr;
    if (FAILED(hp.swapChain->GetHwnd(&hwnd)) || hwnd == nullptr) {
        dbg("overlay: swapChain->GetHwnd failed; deferring install");
        return false;
    }

    // Publish the borrowed pointers BEFORE installing the detour, so the render thread's
    // very first hkSwapChainPresent already sees a complete, consistent contract.
    g_swapChain = hp.swapChain;
    g_device    = hp.device;
    g_context   = hp.context;
    g_hwnd      = hwnd;

    // Read the live swapchain's vtable and detour Present (8) + ResizeBuffers (13).
    void** vtbl = *reinterpret_cast<void***>(hp.swapChain);
    DWORD presentAddr = Detour::CheckPointer(reinterpret_cast<DWORD>(vtbl[kDxgiPresentIndex]));
    g_origPresent = reinterpret_cast<pSwapChainPresent>(
        Detour::Create(reinterpret_cast<LPVOID>(presentAddr), reinterpret_cast<LPVOID>(&hkSwapChainPresent), DETOUR_TYPE_PUSH_RET));
    DWORD resizeAddr = Detour::CheckPointer(reinterpret_cast<DWORD>(vtbl[kDxgiResizeBuffersIndex]));
    g_origResizeBuffers = reinterpret_cast<pResizeBuffers>(
        Detour::Create(reinterpret_cast<LPVOID>(resizeAddr), reinterpret_cast<LPVOID>(&hkResizeBuffers), DETOUR_TYPE_PUSH_RET));

    if (g_origPresent == nullptr) {
        dbg("overlay: Detour::Create(Present) failed — no overlay");
        return false;
    }

    InterlockedExchange(&g_installed, 1);
    dbg("overlay: D3D11 overlay installed (advertised swapchain latched)");
    return true;
}

DWORD WINAPI acquisitionThread(LPVOID) {
    // Poll until the advertised swapchain is live (the client injects us before it has
    // finished creating its D3D11 device). ~200 ms cadence — install is one-shot.
    for (;;) {
        if (tryInstall()) break;
        Sleep(200);
    }
    return 0;   // render thread owns the per-frame overlay from here on
}

} // namespace

namespace overlay {

void start() {
    HANDLE h = CreateThread(nullptr, 0, &acquisitionThread, nullptr, 0, nullptr);
    if (h != nullptr) CloseHandle(h);
}

} // namespace overlay
