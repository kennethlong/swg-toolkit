# Slice-0 Spike — in-agent in-game gizmo (GO/NO-GO gate for the Live World Editor)

**Date:** 2026-07-19 · **Decision:** in-game gizmo is REQUIRED (relative object placement in the live
scene). Source of plan: `CONSULT-UTINNI-SYNTHESIS.md` (5-consultant crew) + `SPIKE-utinni-world-editor-gaps.md`.

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

## After the spike
If GO → plan the **Live World Editor milestone** (selection modes → browse-pick → insertion → `.ws` model+save
in Electron → wire `.ws` into the toolkit deploy pipeline). Re-sequence Blender (was Phase 6) / Format Editors
(was Phase 7) around it. Legacy SWGEmu stays transform-nudge; full world-editing is advertised-client-scoped.
