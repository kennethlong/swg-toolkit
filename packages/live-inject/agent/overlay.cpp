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
    typedef void*(__cdecl*    pGetObjectById)(const void* networkId);
    typedef void(__cdecl*     pWsLoad)(const char* sceneName);
    typedef int(__cdecl*      pWsSetNodeTemplateName)(int64_t id, const char* name); // v23 model-D rebind
    typedef void(__cdecl*     pWsVoid)();
    typedef int(__cdecl*      pGetSceneId)(char* buf, int cap);
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
    extern pGetObjectById     getObjectByIdAdvertised;
    extern pWsLoad            wsLoad;
    extern pWsVoid            wsUnloadSnapshot;
    extern pGetSceneId        getSceneId;
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

// --- CONSULT-69 decisive experiment: can the hover pointer reach an id-less .ilf
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

// Resolve the object the gizmo edits: a ray-picked object (re-resolved from its
// id each frame) takes precedence, else the current in-game target, else the
// player. Runs on the render/game thread (safe to touch engine objects here).
// The current hud hover pick (cuiHud::getTarget). Selects id-less .ilf decorations too
// under allowTargetAnything (CONSULT-69). Null when nothing is hovered / cursor off-world.
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
    // CONSULT-69: a latched hover pointer (id-less decoration) wins — the gizmo drives it.
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

    // Building id: an id-less .ilf decoration reports ray id 0 BY DESIGN (collideScreenRay's
    // getParent walk is m_childObject-gated so a cell-contained decoration never dissolves into
    // the building id — engine_advertise.cpp:521-525). So fall back to the current left-click
    // SELECTION: clicking a POB wall/floor (objectsOnly=0 pick) walks up to the building's
    // NetworkId == its .ws node id. Workflow: left-click the building wall/floor, then Arm.
    const int64_t bldgId = (g_lastRayId != 0) ? g_lastRayId : g_pickedId;
    if (bldgId == 0) return "no building id — left-click the building's wall/floor to select it, then Arm";

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

void renderFrame() {
    ensureImguiInit();
    if (!g_imguiInit) return;

    // Flip-discard unbinds the RTV each Present — rebind the cached one before drawing.
    if (g_rtv == nullptr) g_rtv = createBackbufferRtv();

    ImGui_ImplDX11_NewFrame();
    ImGui_ImplWin32_NewFrame();
    ImGui::NewFrame();

    // Decoration persist (model D): consume any REBIND the toolkit published (game thread,
    // un-gated by the panel/header — must run every frame the overlay renders).
    applyPendingRebind();

    // CONSULT-69: track the last non-null hud hover pick every frame so a decoration
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
        if (g_followHover && g_latchedFocus != nullptr && !g_gizmoWasUsing && g_lastHoverObj != nullptr) {
            g_latchedFocus = g_lastHoverObj;
        }
    }

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

        // --- CONSULT-69 decisive experiment: can we select + move an id-less .ilf
        //     interior decoration via the pointer-keyed hover pick (no NetworkId)? ---
        if (ImGui::CollapsingHeader("In-cell decoration probe (CONSULT-69)")) {
            ImGui::TextDisabled("Hover an object IN-WORLD (cursor OFF this panel) to sample it.");
            ImGui::Text("HUD pick (cuiHud::getTarget): %p", g_probeHoverPtr);
            ImGui::Text("  template : %s", g_lastHoverTmpl[0] != '\0' ? g_lastHoverTmpl : "(null pick — not pointer-selectable)");
            ImGui::Text("  networkId: %lld", static_cast<long long>(g_lastHoverNet));
            ImGui::Separator();
            ImGui::Text("last world ray: hit=%d id=%lld @(%.1f %.1f %.1f)",
                        g_lastRayHit ? 1 : 0, static_cast<long long>(g_lastRayId),
                        g_lastRayPt[0], g_lastRayPt[1], g_lastRayPt[2]);
            ImGui::Text("ray Object* (v22): %p", g_lastRayObj);
            ImGui::Text("  template: %s", g_lastRayObjTmpl[0] != '\0' ? g_lastRayObjTmpl : "(null / no hit)");
            ImGui::TextDisabled("§2.1: is that template the TABLE (good) or floor/terrain (need extent-pick)?");
            ImGui::Separator();
            if (ImGui::Button("Latch last hovered")) g_latchedFocus = g_lastHoverObj;   // hud pick (chairs/tangibles)
            ImGui::SameLine();
            if (ImGui::Button("Latch ray object")) g_latchedFocus = g_lastRayObj;        // raw ray hit (.ilf decorations)
            ImGui::SameLine();
            if (ImGui::Button("Clear latch")) g_latchedFocus = nullptr;
            ImGui::Checkbox("Follow hover", &g_followHover);
            ImGui::Text("latched: %p  (gizmo edits this when set)", g_latchedFocus);
            ImGui::Separator();
            // --- v24: object o2p read (the .ilf transform of the focus object). Live, so a
            //     gizmo-move shows the CELL-space delta (smoke step 2), and it's what
            //     resolveRowIndex/editNodeTransform consume at persist time. ---
            if (swg::endpoints::getObjectTransformO2P == nullptr) {
                ImGui::TextDisabled("object::getTransformO2P: not advertised by this client");
            } else {
                void* focus = resolveFocusObject();
                float o2p[12] = {0};
                const int ok = focus ? swg::endpoints::getObjectTransformO2P(focus, o2p) : 0;
                if (ok) {
                    ImGui::Text("o2p (cell-space, row-major 3x4):");
                    ImGui::Text("  i: % .3f % .3f % .3f", o2p[0], o2p[4], o2p[8]);   // frame i (col 0)
                    ImGui::Text("  j: % .3f % .3f % .3f", o2p[1], o2p[5], o2p[9]);   // frame j (col 1)
                    ImGui::Text("  k: % .3f % .3f % .3f", o2p[2], o2p[6], o2p[10]);  // frame k (col 2)
                    ImGui::Text("  pos: % .3f % .3f % .3f", o2p[3], o2p[7], o2p[11]); // col 3
                } else {
                    ImGui::TextDisabled("o2p: no focus object (latch a decoration first)");
                }
            }
            ImGui::Separator();

            // --- Decoration persist (model D) round trip. Arm (snapshot pre-move baseline)
            //     → move with the gizmo → Persist (ships new o2p) → toolkit assembles the loose
            //     files → the agent rebinds the .ws node + saves. ---
            static const char* s_decoMsg = nullptr;
            const bool haveRebind = (swg::endpoints::wsSetNodeTemplateName != nullptr);
            ImGui::TextDisabled("Persist decoration (edit → .ilf + derived template → .ws rebind)");
            ImGui::TextDisabled("1) left-click the building WALL/FLOOR to select it (id below)");
            ImGui::Text("   building selection id: %lld%s", static_cast<long long>(g_pickedId),
                        g_pickedId == 0 ? "  (click a wall/floor)" : "");
            ImGui::TextDisabled("2) hover the decoration  3) Arm  4) move  5) Persist");
            if (ImGui::Button("Arm edit from ray object")) s_decoMsg = armDecorationEdit();
            if (g_capArmed) {
                ImGui::SameLine();
                if (ImGui::Button("Persist")) s_decoMsg = persistDecorationEdit();
                ImGui::SameLine();
                if (ImGui::Button("Cancel")) { g_capArmed = false; s_decoMsg = "cancelled"; }
                ImGui::Text("armed: bldg id %lld · %s", static_cast<long long>(g_capBuildingId), g_capDecorationTemplate);
                ImGui::TextDisabled("building: %s", g_capBuildingTemplate);
            } else {
                ImGui::TextDisabled("not armed — hover a decoration, then Arm");
            }
            if (!haveRebind) ImGui::TextDisabled("(wsSetNodeTemplateName unresolved — rebind will report node-not-found)");
            if (s_decoMsg) ImGui::TextWrapped("edit: %s", s_decoMsg);
            if (g_lastDecoResultEpoch != 0) {
                ImGui::Text("last rebind (epoch %u): code %d %s", g_lastDecoResultEpoch, g_lastDecoResult,
                            g_lastDecoResult == DECO_RESULT_OK ? "(ok — saved)" : "(see LIVE_DECORATION_RESULT)");
            }
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
        if (swg::endpoints::wsLoad) {
            char scene[128] = {};
            const bool haveScene =
                swg::endpoints::getSceneId && swg::endpoints::getSceneId(scene, sizeof(scene)) > 0 && scene[0] != '\0';
            if (!haveScene) ImGui::BeginDisabled();
            if (ImGui::Button("Reload current scene")) {
                if (swg::endpoints::wsUnloadSnapshot) swg::endpoints::wsUnloadSnapshot();
                swg::endpoints::wsLoad(scene);
            }
            if (!haveScene) ImGui::EndDisabled();
            ImGui::SameLine();
            ImGui::TextDisabled(haveScene ? scene : "(no scene loaded)");

            // Manual: load a DIFFERENT scene by id (advanced).
            static char s_sceneName[128] = "";
            ImGui::InputText("Scene id", s_sceneName, sizeof(s_sceneName));
            ImGui::SameLine();
            if (ImGui::Button("Load##scene") && s_sceneName[0] != '\0') {
                if (swg::endpoints::wsUnloadSnapshot) swg::endpoints::wsUnloadSnapshot();
                swg::endpoints::wsLoad(s_sceneName);
            }
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
    // (mirrors agent_main's poll-loop SEH discipline).
    __try {
        renderFrame();
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        dbg("overlay: SEH fault in renderFrame — frame skipped");
    }

    return g_origPresent(sc, syncInterval, flags);
}

// --- DXGI ResizeBuffers hook. Release our RTV BEFORE the original (else
//     DXGI_ERROR_INVALID_CALL), recreate it AFTER. (directx11.cpp:106.) ---
HRESULT __stdcall hkResizeBuffers(IDXGISwapChain* sc, UINT bufferCount, UINT width, UINT height, DXGI_FORMAT newFormat, UINT swapChainFlags) {
    if (g_rtv != nullptr) { g_rtv->Release(); g_rtv = nullptr; }
    HRESULT hr = g_origResizeBuffers(sc, bufferCount, width, height, newFormat, swapChainFlags);
    g_rtv = createBackbufferRtv();
    return hr;
}

// Advertised-contract consumer. Returns true once the detours are installed (latched).
bool tryInstall() {
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
