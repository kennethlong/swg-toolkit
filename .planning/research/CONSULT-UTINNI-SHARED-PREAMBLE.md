# CONSULT — SWG-Toolkit: reuse-vs-rebuild Utinni for live world-editing (pros/cons)

You are ONE of four independent consultants. Deliver a rigorous, evidence-based pros/cons analysis.
Do NOT rubber-stamp the framing — critique it, and surface options it misses. Cite file:line from real
source where you make a claim. A productive disagreement between consultants is the goal, not consensus.

## Ground truth — read these (they are the neutral evidence)
- SPIKE FINDINGS (source-grounded, file:line index): `D:\Code\SWG-Toolkit\.planning\research\SPIKE-utinni-world-editor-gaps.md`
- Utinni source (OPEN SOURCE; maintainer owns it): `D:\Code\Utinni`, `D:\Code\UtinniPlugins`
  - core: `D:\Code\Utinni\UtinniCore` (native C++17 x86: swg/* engine shims, imgui/ImGuizmo, CLR host, DetourXS)
  - .NET editor: `D:\Code\Utinni\UtinniCoreDotNet` (WinForms `FormMain`, `PanelGame` HWND re-parent, CppSharp bindings)
  - plugins: `D:\Code\UtinniPlugins\The Jawa Toolbox`, `SytnersUtinniPlugin`
  - Utinni's own architecture doc: `D:\Code\Utinni\.planning\codebase\ARCHITECTURE.md`
- Our toolkit's live layer: `D:\Code\SWG-Toolkit\packages\live-inject` (host x64 N-API addon + x86 agent DLL),
  `D:\Code\SWG-Toolkit\packages\renderer\src\panels\viewport` (our three.js/R3F viewport + drei gizmo)

## Situation (facts — treat as given, but verify against source where it matters)
- **Utinni = IN-PROCESS.** Injects `UtinniCore.dll` (native C++17, x86) into `SwgClient_r.exe`; hosts the
  .NET CLR + a WinForms editor in-process; **re-parents the live D3D9 game HWND inside its own panel**; draws
  **ImGui + ImGuizmo onto the game's own D3D9 Present frame**. In-process engine access is what enables:
  in-world gizmo, "select anything" (`CuiPreferences::AllowTargetAnything`), object insertion
  (`WorldSnapshot::createObject` + `Object::addToWorld`), and `.ws` snapshot read/edit/save. Targets BOTH
  legacy SWGEmu (hardcoded RVAs) and the advertised `swg-client-v2` (via `GetEngineHookPoints` provider shims).
- **SWG-Toolkit = OUT-OF-PROCESS.** Electron (React/TS, x64) app + an injected x86 agent DLL + a shared-memory
  seqlock channel. Today it only READS a targeted object's transform and WRITES a transform back; its 3D
  viewport is our OWN three.js scene (a TRE mesh), NOT the game's render. No insertion, no selection beyond
  the player lookAt, no snapshot editing, no in-game gizmo. It also has substantial NON-live value the
  in-process approach lacks: TRE browsing, typed IFF/DTII/STF editors, a deploy/versioning pipeline, Blender
  bridge, cross-platform Electron UI.
- **Reuse is fully available.** Utinni is open-source and the SAME maintainer owns Utinni, UtinniPlugins, AND
  swg-client-v2 (the advertised client + its provider shims). Nothing legal/practical blocks reusing any part.

## The decision to weigh
How should SWG-Toolkit deliver Utinni-class LIVE world-editing (in-world gizmo, select-anything, object
insertion, `.ws` snapshot editing)? Candidate options — critique and EXTEND these; propose hybrids:
- **A. REBUILD** — expand the toolkit's own injected agent into an in-process Utinni-style core (in-game
  ImGuizmo overlay + engine object/snapshot APIs), keep Electron as the out-of-process control surface.
- **B. REUSE** — link/embed/interop with Utinni's actual open-source core (`UtinniCore.dll` and/or its
  plugins / the swg-client-v2 provider shims) instead of reimplementing.
- **C. RE-SCOPE** — keep the toolkit's live-sync as the thin transform-nudge slice; make full world-editing
  Utinni's domain or a later milestone.
- **(+ any hybrid/third path you see — e.g. toolkit-as-Utinni-plugin, headless-Utinni-backend-driven-by-Electron,
  a shared native core, division of labor between the two tools.)**

## Maintainer's current lean (2026-07-19) — PRESSURE-TEST IT, do NOT rubber-stamp
The maintainer leans toward **A + B-as-source-reuse**: EXPAND the toolkit's own injected x86 agent into an
in-process core, **pulling Utinni SOURCE CODE DIRECTLY INTO THE SWG-TOOLKIT PROJECT** — i.e. vendor/port the
relevant `UtinniCore` source (the `swg/*` engine shims, `imgui_gizmo`, `world_snapshot` editing, the
provider-shim bindings, DetourXS hooks) into our agent and build it as part of our native code. This is
**source-level reuse (copy/port into our repo)**, NOT linking to an external `UtinniCore.dll` and NOT
runtime IPC to a running Utinni. Electron stays the out-of-process control surface over the shared-memory
channel; the **in-game gizmo renders in the client's own D3D window** (as Utinni's does), NOT inside Electron.

Your job: pressure-test THIS direction on your assigned angle. Endorse it only if the evidence supports it;
if it has a fatal flaw, a hidden cost, or a materially better path, say so plainly. The maintainer wants the
truth, not validation. Note specifically: Utinni's own editor is a .NET/WinForms shell that re-parents the
game HWND — the lean DROPS that shell (Electron replaces it), so assess what of Utinni's core survives
cleanly once its WinForms/CLR editor layer is removed, and what was load-bearing in ways the port must replace.

Deliver: your angle's analysis (below), then an explicit **pros/cons list** and a **recommendation with the
conditions under which it flips.**
