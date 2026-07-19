# Spike — Utinni world-editor architecture vs. SWG-Toolkit live-sync (gaps)

**Date:** 2026-07-19 · **Trigger:** maintainer flagged that our live-sync gizmo doesn't match Utinni
(in-game selection of anything; object insertion; gizmo rendered *in the SWG window* on the object).
**Method:** 3 parallel source-research agents over `D:\Code\Utinni` + `D:\Code\UtinniPlugins` + Utinni's
own `.planning/codebase/ARCHITECTURE.md` and Phase-24 (Goal B snapshot-editor/gizmo) docs. All claims
below carry file:line evidence from the real Utinni source.

## Bottom line

The gaps are **architectural, not feature-sized.** Utinni is an **in-process DLL injected into the SWG
client** that hosts a .NET/WinForms editor **in-process**, **re-parents the live D3D9 game window inside
its own panel**, and **draws ImGui + ImGuizmo directly onto the game's own frame**. That in-process,
in-render posture is what makes the in-world gizmo, "select anything," object insertion, and `.ws`
snapshot editing possible. Our toolkit is an **out-of-process Electron app** talking to the client only
through an injected agent + a shared-memory channel; its 3D viewport is *our own* three.js scene, not the
game's render. Our Phase-5 live-sync ("nudge a targeted object's transform over the channel") is a much
thinner slice of what Utinni does, and closing the gap is a pivot, not an increment.

## Utinni's enabling architecture (source: Utinni `.planning/codebase/ARCHITECTURE.md`)

- Launcher suspends `SwgClient_r.exe`, injects `UtinniCore.dll`, which hosts the .NET CLR in-process and
  runs a **C# WinForms editor** (`FormMain`).
- **`PanelGame` re-parents SWG's HWND inside the editor's WinForms panel** — the game renders *inside* the
  tool window, not a separate window.
- **ImGui + ImGuizmo overlay is piggy-backed on the client's D3D9** device.
- Editor features (Object Explorer, World Snapshot editor, TRE Explorer) are **plugins** contributing
  WinForms panels around the embedded game view. Native core owns engine access; plugins own UX.

## Gap 1 — In-world gizmo (rendered in the game, on the real object)

Utinni draws ImGuizmo **into the client's own D3D9 `Present` hook**, fed the **live game camera**, writing
back to the **real engine `Object`** every frame:
- D3D9 present vtable hook → `UtinniCore/swg/graphics/directx9.cpp:380` `imgui_impl::render()`.
- `imgui_gizmo::draw()` → `ImGuizmo::Manipulate(...)` at `UtinniCore/swg/ui/imgui_impl.cpp:1181`
  (drawn between `ImGui::NewFrame`/`EndFrame`, `imgui_impl.cpp:781`).
- Camera view/proj from the live camera: advertised `swg::camera::getTransformO2W`/`getProjectionMatrix`
  (`imgui_impl.cpp:1216`), legacy `GroundScene::getCurrentCamera()` (`:1232-1234`). Object matrix =
  `object->getTransform_o2w()` (`:1241`). Rect = current render target (`:1256-1259`).
- Per-frame writeback during drag: `object->setTransform_o2w(...)` + `object->positionAndRotationChanged(...)`
  (`imgui_impl.cpp:1290-1292`).
- The plugin only picks *which* object to attach: `imgui_gizmo::enable(Object*)` (`imgui_impl.cpp:910`),
  called from `The Jawa Toolbox/.../WorldSnapshotImpl.cs:678` `EnableGizmo(target)`.

**Our state:** drei `TransformControls` in a **separate Electron three.js viewport**, our own orbit camera,
transform serialized over shared memory to the *targeted* object. We do **not** hook the game's render or
read its per-frame camera — so an in-game gizmo is impossible under the current model.

## Gap 2 — "Select anything"

- **The decisive enabler:** `cui_hud.cpp:297-326` `patchAllowTargetEverything(bool)` — advertised calls
  `CuiPreferences::setAllowTargetAnything`; SWGEmu `memory::createJMP(0x00BD3FA3, ...)` skips the
  targetability gate. Without it, target/lookAt is capped at combat-valid objects.
- **Cursor/ray picking:** `CuiHud::getTarget` (`cui_hud.cpp:41`, RVA `0x00BD3E20`) + `collideCursorWithWorld`
  (`cui_hud.cpp:221`) → `clientWorld::collide` (`client_world.cpp:29`, RVA `0x00561350`).
- **Browse-and-pick (target-independent):** placements table row → `WorldSnapshotImpl.cs:517`
  `SelectNodeById` → `Network.GetObjectById(nodeId)` → gizmo. (`FormSnapshotPlacements.cs:453-469`.)
- **Enumeration:** `NetworkIdManager::getObjectById` (`network.cpp:69`, RVA `0x00B380E0`); world-snapshot
  node tree (`world_snapshot.cpp` `WorldSnapshotLive::getTopNodeCount/...`); player/lookat anchors
  (`game.cpp:747/780`). In-process selection yields a **live `Object*`**, not just a value.

**Our state:** single out-of-process lookAt read over the channel, engine target filter intact — a value to
look up, not a manipulable handle.

## Gap 3 — Object insertion + `.ws` snapshot editing

- **Insertion (two parts):** a WorldSnapshot **data Node** in the in-memory reader tree
  (`WorldSnapshotReaderWriter::addNode`, `world_snapshot.cpp:66/786`) **plus a live engine object** via the
  client's own factory `WorldSnapshot::createObject` (`world_snapshot.cpp:103/806`, RVA `0x0059BBA0`) +
  `Object::addToWorld` (`object.cpp:142`, RVA `0x00B225F0`). Advertised path: `wsAddObject` shim
  (reader-add + sphere-tree insert + same create/addToWorld pair). POB buildings add interior
  `shared_cell.iff` cell nodes (`world_snapshot.cpp:789-793`).
- **Scene data model:** the editor mutates the live **`WorldSnapshotReaderWriter` node tree** (parsed `.ws`)
  in lockstep with the live objects — add/remove/duplicate/move/radius, with managed **undo/redo**.
- **Persistence:** Save writes a real **`.ws` file** — `saveFile` (`world_snapshot.cpp:608`, RVA `0x00B98120`)
  / advertised `wsSaveSnapshot` (typed `SaveResult`, writes to the top loose SearchPath root). `.ws` is a
  **client asset format**, int32 node ids + OTNL template table. Edits are **live-only until an explicit Save**.
- **All inserted objects are client-only** (no server object); the server only learns of them if the
  resulting `.ws` is deployed as a data asset.

**Our state:** no insertion, no scene/snapshot data model, no persistence — live edits vanish on client exit.

## Root cause (why every gap traces to the same thing)

In-process + in-render + engine-API access. Utinni can (a) call the client's own object-creation/snapshot
functions, (b) draw into the game's swapchain with the game's camera, and (c) host the editor UI around the
embedded game window. Our out-of-process shared-memory channel can move a byte-blob transform into an
already-targeted object and nothing more.

## Strategic options (maintainer's call — not decided here)

1. **Expand the agent into an Utinni-style in-process core; keep Electron as the control surface.** The
   injected agent gains: `AllowTargetAnything`, ray-pick + object enumeration, `createObject`/`addToWorld`,
   snapshot node mutation + `.ws` save, **and an in-game ImGuizmo overlay hooked into the client's Present**.
   Electron becomes the browse/list/deploy/inspect panel (mirrors Utinni's native-core-vs-WinForms-plugin
   split, but with the "plugin" out-of-process). Heaviest, but the only path to a true in-world gizmo.
2. **Interop with / reuse Utinni's core** rather than rebuild it. The maintainer already maintains Utinni
   (and swg-client-v2's provider shims — the Goal B `ws*`/`AllowTargetAnything`/camera rows). Build-vs-reuse
   is a real question given Utinni already ships all three capabilities on the advertised client.
3. **Re-scope Phase 5 honestly.** Position the toolkit's live-sync as "transform-nudge a targeted object"
   (the thin slice), and make full world-editing (insert / in-world gizmo / snapshot `.ws`) an explicit
   future milestone (or Utinni's domain), rather than implying parity now.

## Implication for Phase 05

The Phase-5 UAT as written tests the thin slice (drag a targeted object's transform via a viewport gizmo).
That's internally consistent for what Phase 5 *built*, but it is **not** the Utinni world-editor experience.
Decide the scope question above before closing Phase 5 — the current live-sync is a narrow, honest slice,
not a gap-free world editor.

## Evidence index (Utinni source)
- Gizmo: `swg/graphics/directx9.cpp:380`; `swg/ui/imgui_impl.cpp:781,910,1181,1216,1232-1234,1241,1256-1259,1290-1292`
- Selection: `swg/ui/cui_hud.cpp:41,221,245-260,297-326`; `swg/scene/client_world.cpp:29`; `swg/misc/network.cpp:69`;
  `The Jawa Toolbox/.../WorldSnapshotImpl.cs:517,586-688`; `FormSnapshotPlacements.cs:453-469`
- Insertion/snapshot: `swg/scene/world_snapshot.cpp:66,103,608,728-813,985-1055`; `swg/object/object.cpp:142,220,347-361`;
  Utinni `.planning/phases/24-.../24-PROVIDER-CONSULT-goalB-snapshot-editor-ANSWERS.md`,
  `24-SESSION-HANDOFF-2026-07-18-goalB-waves-complete-gizmo-aspect.md`
- Architecture: Utinni `.planning/codebase/ARCHITECTURE.md`
