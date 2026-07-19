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
    typedef void*(__cdecl*    pGetObjectById)(const void* networkId);
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
    extern pWsGetSavePath     wsGetSavePath;
    extern pCollideScreenRay  collideScreenRay;
    extern pGetObjectById     getObjectByIdAdvertised;
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

// Resolve the object the gizmo edits: a ray-picked object (re-resolved from its
// id each frame) takes precedence, else the current in-game target, else the
// player. Runs on the render/game thread (safe to touch engine objects here).
void* resolveFocusObject() {
    void* focus = nullptr;
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
void renderFrame() {
    ensureImguiInit();
    if (!g_imguiInit) return;

    // Flip-discard unbinds the RTV each Present — rebind the cached one before drawing.
    if (g_rtv == nullptr) g_rtv = createBackbufferRtv();

    ImGui_ImplDX11_NewFrame();
    ImGui_ImplWin32_NewFrame();
    ImGui::NewFrame();

    // --- STATIC overlay (step 2): proof-of-life only, no engine interaction. ---
    ImGui::SetNextWindowPos(ImVec2(24, 24), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(340, 0), ImGuiCond_FirstUseEver);
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
