# Slice-0 Spike — in-agent in-game gizmo (GO/NO-GO gate for the Live World Editor)

**Date:** 2026-07-19 · **Decision:** in-game gizmo is REQUIRED (relative object placement in the live
scene). Source of plan: `CONSULT-UTINNI-SYNTHESIS.md` (5-consultant crew) + `SPIKE-utinni-world-editor-gaps.md`.

## ✅ VERDICT: GO (2026-07-19)
All four build steps done + live-proven end-to-end on the advertised gl11 client: DXGI Present hook stable,
ImGui gets input from the standalone game window, and the ImGuizmo gizmo **moved a selected in-game terminal
1:1**. The architecture is validated — our out-of-process x86 agent CAN host the in-process overlay. Pivoted
D3D9→D3D11 (advertised client). Next = plan the **Live World Editor milestone**. See the Progress log below.

## The single question this spike answers (go/no-go)
Can our **x86 agent** (Electron-driven, no WinForms/CLR) reproduce Utinni's in-process posture —
**D3D9 `Present` hook + ImGui + ImGuizmo overlay, ImGui_ImplWin32 input from the game's OWN window,
and cross-thread engine mutation marshalled onto the game thread** — and draw a working transform gizmo
on the live object, with the game in its **own standalone window** (no re-parent)? Everything downstream
(ray-pick, browse-pick, insertion, `.ws` save) is feature work on this substrate. If this holds, the
architecture is validated; if not, fall back to keeping Utinni as the live editor.

## Scope (deliberately minimal)
- Gizmo on the object we **already resolve today** (`agent_main.cpp` focus resolution) — NOT full selection.
- `cuiPreferences::setAllowTargetAnything` so "current target" can be anything.
- Electron sends only **enable + gizmo-mode**; the agent's in-game gizmo does the interactive drag against
  the live camera and writes back per-frame (`object->setTransform_o2w` + `positionAndRotationChanged`).
- Standalone game window (the existing launch path already does NOT re-parent — good).

## Ordered steps
1. **Build scaffolding.** Add `imgui`, `imguizmo`, `DetourXS`, (optional) `spdlog` to the agent's build,
   all `/MT` x86 (the agent's hard CRT constraint — `agent/CMakeLists.txt`). Utinni's deps are vcpkg
   (`imgui`, `imguizmo`, `spdlog`); DetourXS is compiled directly. Keep the agent self-contained (KERNEL32-only
   runtime dep) — verify the .node/.dll still injects (remote LoadLibraryA) after the deps land.
2. **Present hook.** Vendor Utinni's D3D9 present-vtable detour (`directx9.cpp:hkPresent`, index 17) → call an
   `overlay::render()` each frame. DROP the PanelGame-era embed-aspect latch + window-pos clamp
   (`imgui_impl.cpp:1191-1198`, the WM_WINDOWPOSCHANGING clamp) — standalone window makes them unnecessary.
   First milestone: draw a STATIC overlay (a label/triangle), no engine interaction — proves the hook is safe.
3. **Input.** Vendor `hkWndProcHandler` → `ImGui_ImplWin32_WndProcHandler` so ImGui gets mouse/keys from the
   game's own window (survives the re-parent drop).
4. **Camera + gizmo.** Feed ImGuizmo the live camera via the advertised rows `camera::getTransformO2W` /
   `getProjectionMatrix` (already provider-shimmed) + object o2w; `ImGuizmo::Manipulate`; writeback per frame;
   Escape-revert. Recolor axis handles (cosmetic, optional).
5. **Game-thread command queue.** The load-bearing new primitive: a lock-free queue drained INSIDE the Present
   hook. `AllowTargetAnything`, gizmo enable/mode, and (later) all engine mutation run on that render/game-thread
   call site — NEVER the agent poll thread (today's poll-thread write is a Phase-5 shortcut, unsafe to expand).
6. **Electron control.** One new host→agent command path: `GIZMO_ENABLE` + `GIZMO_MODE` over the channel
   (extend the existing command region; a full command ring comes later). Poll thread degrades to reads only.

## Go/no-go criteria
- **GO** if: the Present hook is stable (no crash over a sustained session), ImGui receives input from the
  standalone game window, and the gizmo drags every axis 1:1 and moves the live object — on the advertised
  client first (legacy is a follow-on). Meets the "no half-working gizmo" bar.
- **NO-GO** if: input can't reach ImGui from the un-reparented window, or engine mutation can't be safely
  marshalled onto the game thread via the present hook, or the aspect/hit-test can't be made exact standalone.
  → fall back to keeping Utinni as the live editor; toolkit shares only the `.ws` format + provider contract.

## Top risks (from the consult)
- **Threading** (highest technical): engine calls must be on the game thread — step 5 is the crux.
- **Present hook in an Electron-driven, non-WinForms host** — untested for us; step 2's static-overlay
  milestone isolates it.
- **/MT vendoring** of imgui/imguizmo/DetourXS — Utinni builds `/MD`; ours must be `/MT` or injection fails.
- **Fork tax** — mitigated by design: vendor only render glue; reach editing via the shared contract
  (sync `engine_hookpoints.h` v6→19, extend `rva_table.cpp`), don't copy `world_snapshot.cpp`/`cui_hud.cpp`.

## Progress

- **2026-07-19 — Step 1 (build scaffolding): mechanically DONE + proven; live re-inject pending a client.**
  Chose **vcpkg static triplet** (`x86-windows-static` = `/MT`) over hand-vendoring imgui source — it
  reuses Utinni's exact proven version pair with zero API-compat risk and still yields a self-contained DLL
  (imgui folds in statically). Landed:
  - `agent/vcpkg.json` + `agent/vcpkg-configuration.json` — imgui[docking-experimental,dx9-binding,win32-binding]
    + imguizmo, pinned to Utinni's registry baseline (`aa40add…`). Resolved to **imgui 1.92.8 + imguizmo 1.10**.
  - `agent/third_party/DetourXS/` — vendored source (Utinni's copy incl. its unmapped-target guard); swapped the
    upstream `utinni::log::warning` call for `OutputDebugStringA` to keep the TU KERNEL32-only.
  - `agent/CMakeLists.txt` — auto-locates the vcpkg toolchain (VCPKG_ROOT → VS-bundled), forces the static
    triplet, compiles DetourXS, links `imgui::imgui` + `imguizmo::imguizmo` + `d3d9`. Manifest mode auto-installs
    deps on configure, so the documented build command is unchanged.
  - `agent/overlay_smoke.cpp` + `overlay_selftest` export — link-smoke TU forcing all three deps to resolve.
  - **Proof (dumpbin):** DLL is machine `14C` (x86), imports **KERNEL32.dll only** (no vcruntime/ucrt/msvcp →
    static `/MT` confirmed, self-contained), both `agent_init` (undecorated) + `overlay_selftest` exported. The
    injection contract is intact by static analysis.
  - **STILL OPEN (needs the maintainer's running SWG client):** confirm the enlarged DLL still injects via remote
    `LoadLibraryA` end-to-end. Node/vitest can't prove this. That's the real step-1 sign-off before step 2.
  - Build artifacts (`vcpkg_installed/`, `vcpkg-install.log`) gitignored; manifest + vendored source tracked.
    Everything **uncommitted**.

- **2026-07-19 — Step 2 (Present hook + static overlay): PIVOTED D3D9→D3D11, code + build DONE; live proof pending.**
  **Decision (maintainer):** target the **advertised D3D11 (gl11)** client first, NOT D3D9. Ground truth that
  forced the pivot: swg-client-v2 selects its renderer via `rasterMajor` in `client.cfg` (`5`=gl05 D3D9,
  `11`=gl11 D3D11); the D3D11 path is a *different* hook than the plan's D3D9 assumption. The advertised D3D11
  client exports a clean render contract from `gl11_r.dll`:
  `extern "C" __declspec(dllexport) EngineDx11HookPoints __cdecl GetHookPoints()` returning
  `{IDXGISwapChain1*; ID3D11Device*; ID3D11DeviceContext*}` (borrowed) — **producer verified byte-identical**
  (swg-client-v2 `Direct3d11.cpp:958-976`). So the agent consumes the contract directly (`GetModuleHandle`+
  `GetProcAddress`), no throwaway-device harvest, no engine callback registry. Landed:
  - `agent/overlay.{h,cpp}` — acquisition thread polls `GetHookPoints()` until the swapchain is live, then
    DetourXS-hooks **DXGI Present (vtable idx 8)** + **ResizeBuffers (idx 13)**; renders a **static** ImGui(DX11)
    overlay inside the Present hook on the game's render thread (RTV rebind for flip-discard, SEH-guarded frame,
    lazy imgui init on first present). Dropped Utinni's PanelGame embed/reparent, present-block event, and
    embed-aspect assert (standalone window ⇒ backbuffer==window).
  - `agent/vcpkg.json` — added `dx11-binding` to imgui features (resolved imgui 1.92.8 + dx11 backend static /MT).
  - `agent/CMakeLists.txt` — link `d3d11 dxgi d3dcompiler imm32` (+ `d3d9` kept for the future legacy path).
  - `agent_main.cpp` — `overlay::start()` fired after channel open (additive; live-sync loop unchanged).
  - **Proof (dumpbin):** DLL still x86, static `/MT` (imports OS DLLs only — `D3DCOMPILER_47/GDI32/IMM32/KERNEL32/
    SHELL32/USER32`, NO vcruntime/ucrt/msvcp; d3d11/dxgi are pure vtable calls so not even imported), `agent_init`
    export intact. Injection contract preserved.
  - **STILL OPEN (needs the maintainer's running gl11 client):** inject and confirm the overlay window actually
    draws in-game over the live scene, Present hook stable over a sustained session, ResizeBuffers survives a
    window resize. That is step 2's real GO. (`OutputDebugStringA` breadcrumbs at each stage — watch in DebugView.)
  - Note: legacy SWGEmu / advertised-D3D9 overlay is a deliberate follow-on (the D3D9 throwaway-harvest path,
    `directx9.cpp:getVtbl`, is documented but not vendored yet). Everything **uncommitted**.

- **2026-07-19 — Step 2 live proof: GO.** Maintainer ran the advertised gl11 client: overlay renders in-game,
  stable, no glitches. Present hook confirmed safe in our Electron-driven host. → proceed to step 3.

- **2026-07-19 — Step 3 (input via WndProc subclass): code + build DONE; live proof pending.**
  `overlay.cpp` now subclasses the game HWND (`SetWindowLongPtr GWLP_WNDPROC`) and routes messages through
  `ImGui_ImplWin32_WndProcHandler` before forwarding to the game's original WndProc. Added an input-proof
  widget to the overlay (Click-me counter + live mouse pos + `WantCaptureMouse/Keyboard` readout). Still
  x86 / static-`/MT` / `agent_init` intact.
  - **KEY SWG FACT (ground truth, Utinni `imgui_impl.cpp:210-216,783-790`):** SWG polls **game input via
    DirectInput**, NOT the Win32 message queue. So the WndProc subclass feeds ImGui *without* starving the game —
    but an overlay click ALSO reaches the game (double-input). Real capture arbitration = suspend the engine's
    DirectInput polling while `io.WantCaptureMouse` — that needs an engine hook and is deferred to step 4/5
    (it's needed there anyway so a gizmo drag doesn't also spin the camera). Documented, not a bug.
  - **STILL OPEN (needs the live gl11 client):** confirm the overlay is interactive — drag the window, click the
    button (counter increments), `WantCaptureMouse` flips true while hovering. Expect the double-input jank until
    step 4/5.

- **2026-07-19 — Step 3 live proof: GO.** Overlay interactive in-game; clicks registered in the counter.

- **2026-07-19 — Step 4 (camera + ImGuizmo gizmo): code + build DONE; live proof pending.**
  Added `camera::getTransformO2W` + `camera::getProjectionMatrix` advertised binding rows to `rva_table.cpp`
  (producer `engine_advertise.cpp:462-493`, verified layout: getTransformO2W = row-major 3x4, cols=i/j/k,
  col3=position; getProjectionMatrix = engine GlMatrix4x4 row-major 4x4). In `overlay.cpp`:
  - Resolve focus = current in-game target (advertised cuiHud two-step) **else the player**, inside the Present
    hook (game thread) — engine reads/writes never touch the poll thread.
  - Matrix pipeline replicates Utinni exactly (`imgui_impl.cpp:1237-1290`): view = rigid-inverse(cameraO2W),
    promote 3x4→4x4, transpose row-major→column-major for ImGuizmo, `Manipulate`, transpose back, first 12
    floats = the 3x4 Transform → `setTransform_o2w`. Escape-revert to the drag-start transform.
  - Overlay controls: Enable checkbox, Translate/Rotate/Scale, World/Local.
  - `SetRect(0,0,DisplaySize)` — standalone window ⇒ backbuffer==window ⇒ gizmo hit-test maps 1:1 (the exact
    reason we dropped the embed/reparent). Removed the step-1 `overlay_smoke.cpp` link probe (imguizmo now
    genuinely linked). Still x86 / static-`/MT` / only `agent_init` exported.
  - **Deliberately NOT built (ground-truth-driven):** (1) `positionAndRotationChanged` — not in the advertised
    catalog; the existing nudge moves objects without it; it's a collision/cell-fidelity follow-on (would need a
    new upstream catalog row = cross-repo handoff). (2) **DirectInput suspend** — Utinni's own code no-ops
    suspend/resume on the advertised client (the SWGEmu RVAs `0x00420880/0x90` are unbound there), so the gizmo
    works LMB-drag vs RMB-camera-look without it; matching Utinni.
  - **STILL OPEN (needs the live gl11 client):** enable the gizmo, confirm the axis handles render on the target/
    player and dragging moves the live object 1:1 on every axis, Escape reverts. Caveat: don't drive the toolkit's
    drei gizmo and the in-game gizmo on the same object simultaneously (two writers). If the gizmo doesn't draw,
    the likely one-line fix is `ImGuizmo::SetDrawlist(ImGui::GetForegroundDrawList())` before Manipulate.

- **2026-07-19 — Step 4 live proof: GO, orientation VERIFIED.** Gizmo moved a selected terminal 1:1. An
  apparent "handles 45° off" turned out to be **correct behavior**, diagnosed from ground-truth matrices (a
  temporary `overlay.cpp` dump → `gizmo-diag.log`, since removed): the terminal is yawed ~48°; ImGuizmo WORLD
  mode aligns handles to the world grid, LOCAL aligns to the object (confirmed in ImGuizmo `ComputeContext`
  :1090 — WORLD sets model rotation to identity). The view/projection were proven correct (the object projected
  to screen-center). For BOTH modes to align correctly, the whole matrix pipeline must be right — so this is a
  stronger GO. Defaulted the gizmo to **LOCAL** (maintainer preference for object-relative editing). Total spike
  time: a few hours (stood on Utinni's proven overlay/gizmo code + the maintainer's advertised `GetHookPoints`/
  camera-accessor contracts; not a from-scratch 2-3wk build).

## After the spike
If GO → plan the **Live World Editor milestone** (selection modes → browse-pick → insertion → `.ws` model+save
in Electron → wire `.ws` into the toolkit deploy pipeline). Re-sequence Blender (was Phase 6) / Format Editors
(was Phase 7) around it. Legacy SWGEmu stays transform-nudge; full world-editing is advertised-client-scoped.
