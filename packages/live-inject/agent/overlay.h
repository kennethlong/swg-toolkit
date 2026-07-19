/**
 * overlay.h — in-game ImGui render overlay for the advertised D3D11 (gl11) client.
 *
 * Slice-0 step 2: prove our x86 injection agent can host a DXGI Present hook +
 * an ImGui (DX11) overlay drawn into the live game window. Everything downstream
 * (input, camera, gizmo, engine mutation) builds on this substrate.
 *
 * The overlay consumes the advertised render contract exported by gl11_r.dll:
 *   extern "C" __declspec(dllexport) EngineDx11HookPoints __cdecl GetHookPoints();
 *   struct EngineDx11HookPoints { IDXGISwapChain1*; ID3D11Device*; ID3D11DeviceContext*; };
 * (producer: swg-client-v2 Direct3d11.cpp:958-976 — verified byte-identical). It
 * borrows those pointers (never Released), detours the swapchain's Present (vtable
 * idx 8) + ResizeBuffers (idx 13) via DetourXS, and renders inside the Present hook
 * on the game's own render thread.
 */
#pragma once

namespace overlay {

// Spawn the acquisition thread. Call ONCE from agent_init (a real thread — never
// from DllMain). The thread polls gl11_r.dll!GetHookPoints() until the swapchain
// is live, installs the Present/ResizeBuffers detours, then exits; the game's
// render thread owns the per-frame overlay from that point on. No-op (safe) on a
// non-D3D11 client — gl11 absent means the acquisition simply never latches.
void start();

} // namespace overlay
