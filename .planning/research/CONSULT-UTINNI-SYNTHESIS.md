# CONSULT SYNTHESIS — Reuse-vs-rebuild Utinni for live world-editing

**Date:** 2026-07-19 · **Crew:** Codex (reuse feasibility), Cursor (integration seam), Opus (risk/sequencing),
Sonnet (challenge/division-of-labor), Fable (target architecture). Neutral brief:
`CONSULT-UTINNI-SHARED-PREAMBLE.md`. Raw memos: `CONSULT-UTINNI-{codex-reuse,cursor-seam}.out` + the
Opus/Sonnet/Fable agent transcripts. Spike this builds on: `SPIKE-utinni-world-editor-gaps.md`.

## Bottom line

**The maintainer's lean is directionally right but over-scoped as literally stated.** All five converge:
DON'T vendor `UtinniCore` wholesale. DO a **curated native port of only the in-process render overlay**
(D3D9 `Present` hook + ImGui + ImGuizmo + camera/object matrices + per-frame writeback) into our x86 agent,
and reach **selection / insertion / snapshot / AllowTargetAnything through the shared `GetEngineHookPoints`
contract you already own** — by adding binding rows to our agent's `rva_table.cpp`, NOT by copying
`world_snapshot.cpp`/`cui_hud.cpp` source. "Vendor" applies to the render glue; "share the contract" applies
to everything else. This respects the lean while dodging its two traps (over-scope + fork tax).

## Unanimous convergence (all 5)

1. **The one genuinely-new, in-process-only piece is the render overlay** — Present-hook + ImGui/ImGuizmo
   (~2–3k LOC + external libs: `imgui`, `imguizmo`, `DetourXS`, `spdlog`). This is the only legitimate
   "vendor Utinni source" target. It's native, CLR-free, and ports as straight C++.
2. **Select-anything / insertion / snapshot / camera are already commoditized** by swg-client-v2's
   `engine_hookpoints.h` contract (`worldSnapshot::ws*`, `cuiPreferences::AllowTargetAnything`,
   `camera::getProjectionMatrix/getTransformO2W`) — Utinni's "Goal B" (2026-07-15→18) already exercises them.
   Our agent's `resolve.cpp`/`rva_table.cpp` are *already ported from Utinni's endpoint pattern*, but pinned
   at a **stale contract version (~6 vs live 19)**. Reaching these = extend the binding table, not copy source.
3. **Drop Utinni's WinForms/CLR/CppSharp/MEF/PanelGame shell entirely** — Electron replaces the editor UI.
   This deletes Utinni's largest, most painful subsystem. No-CLR is not a blocker (UtinniCore already builds CLR-off).
4. **Do NOT re-parent the game window into Electron — keep the game standalone.** Utinni's one unsolved bug
   (embed-aspect / present-stretch that makes the gizmo mis-hit) is *caused by* re-parenting the HWND into a
   WinForms panel (backbuffer ≠ panel rect). Standalone window ⇒ backbuffer == window ⇒ gizmo maps 1:1. The
   lean's "own window" instinct **cancels Utinni's worst problem.** Cost: two-window UX (alt-tab).
5. **The threading rewrite is mandatory and load-bearing** (top technical risk). Engine-mutating calls
   (`createObject`/`addToWorld`/snapshot/`AllowTargetAnything`) MUST run on the **game thread** via the
   Present-hook drain / a game-thread command queue — NOT the agent's current poll thread (a Phase-5 shortcut,
   SEH-wrapped, unsafe to expand). This is the biggest structural change from today's agent.
6. **Editing MODEL lives in Electron (selection, undo/redo, snapshot node tree); the agent stays a MECHANISM.**
   Undo/redo was managed C# — rebuild in TS. The C# callback bus (`AddMainLoopCall`) → native command/event rings.
7. **Keep the WndProc input subclass** — ImGui still needs mouse/keys from the game's own window (survives the
   re-parent drop; commonly mis-assumed to die with it).
8. **Protocol: keep the seqlock read-frame for hot telemetry; ADD a host→agent command ring (in-order, nothing
   dropped) + an agent→host event ring (target-changed, placement-list, cmd-ack incl. `SaveResult`).** Seqlock is
   latest-wins — wrong for discrete edits. Both rings fit the single existing mapping (Fable) or a companion
   named pipe for bulk (Cursor); mechanics are a detail, the class split is the point.
9. **Scope full world-editing to the advertised client;** keep legacy SWGEmu at transform-nudge (already shipped).
   Advertised is where the provider rows + Utinni's Goal B actually work; legacy doubles the work at lowest value.
10. **First vertical slice = the in-game gizmo on the already-resolved focus object, driven by Electron
    (enable + mode) + `AllowTargetAnything` + the game-thread queue — the GO/NO-GO gate.** Everything downstream
    (ray-pick, browse-pick, insertion, `.ws` save) is feature work on that substrate.
11. **The killer justification for in-housing it: wire `.ws` snapshot save into the toolkit's existing
    deploy/versioning pipeline** — the one thing Utinni-as-separate-tool can never give.

## The productive split — the ONE decision to make

Sonnet & Opus push hardest on: *do you even need the in-GAME-WINDOW gizmo?* Most of what the maintainer
wants (select-anything, move real objects, insert, snapshot-edit) is reachable **today-ish** by extending the
binding table and driving from Electron + the **existing three.js viewport gizmo** — at a fraction of the cost —
because only the *visual render in the game window* requires the overlay port.

**So the crux the crew hands back:**
> **Is a gizmo rendered IN THE GAME WINDOW a hard requirement, or is our three.js viewport gizmo acceptable
> once it's driven by REAL selection and can move/insert REAL objects?**
- **In-window gizmo required** → do the render-overlay port (Slice 0), standalone window sidesteps aspect,
  accept the threading rewrite. (Cursor/Fable/Codex design this; the maintainer's original complaint —
  "the gizmo shows in the SWG app, not ours" — implies YES.)
- **Not required** → skip the overlay port entirely for now: sync the contract (v6→19), add ~15 binding rows,
  drive select/insert/snapshot from Electron + the three.js gizmo. Cheapest path; leaves in-game render to
  Utinni or a later slice.

## Top risks + mitigations (Opus/Sonnet/Codex)

- **R1 Fork tax (highest)** — maintaining a fork of engine shims the same person develops upstream (contract at
  v19, +19 bumps in ~2 months). **Mitigation (consensus):** do NOT fork the editing source; share the
  `engine_hookpoints.h` *contract* (bind by name, extend our table). Only vendor the render glue (external libs
  + thin glue, low churn, no upstream competitor).
- **R2 Agent balloons into an editor core** — keep the model in Electron; agent stays hook+resolve+apply-on-game-
  thread; grow in numbered, flag-gated slices.
- **R3 Present-hook / aspect** — real only if you embed; standalone window makes it near-zero. Residual: the
  Present hook itself is untested in our Electron-driven agent → that's exactly what Slice 0 proves.
- **R4 Dual legacy+advertised** — scope world-editing to advertised; legacy stays transform-nudge.
- **R5 Cross-platform identity** — the heavy agent is a separately-built optional DLL behind the channel; it
  doesn't infect the cross-platform Electron frontend as long as editing-model code never leaks into the agent.

## Effort (Codex)

~**2–3 weeks** for a serious first vertical slice (in-game gizmo, selective vendor, no PanelGame/CLR/plugins);
~**5–8 weeks** to credible Utinni-class parity (selection, insertion, snapshot enumerate/save, undo/redo,
Electron controls). More if advertised provider rows are missing or DX11 is needed immediately.

## Conditions that flip the recommendation

- **→ Full wholesale vendor** (the lean, literally): only if the maintainer **sunsets upstream Utinni** and makes
  the toolkit the sole live editor — then fork tax → 0 and harvesting finished Goal B code is pure gain.
- **→ Re-scope / keep Utinni as THE live editor**: if the Slice-0 present-hook spike proves unstable in the
  Electron-driven/non-WinForms agent, or the two-window UX tests materially worse than Utinni's embed. Then
  division of labor wins: toolkit owns asset/deploy/versioning + launches the Utinni-injected client, sharing
  only the `.ws` format + provider contract.

## Recommended path (crew consensus, refining the lean)

1. **Decide the crux** (in-window gizmo: required or not).
2. If required: **Slice 0 spike** = vendor Present-hook + ImGui/ImGuizmo + minimal engine shims into the agent;
   game standalone (no reparent); draw the gizmo on today's resolved focus object; `AllowTargetAnything`;
   introduce the game-thread command queue; Electron sends enable+mode. **Gate the whole program here.**
3. **Sync the contract (v6→19) + add binding rows** for `ws*` / `AllowTargetAnything` / camera — this delivers
   select/insert/snapshot regardless of the gizmo decision, cheaply, via the existing channel.
4. Then layer ray-pick → browse-and-pick → insertion → `.ws` save, keeping model/undo in Electron and wiring
   `.ws` output into the toolkit's deploy pipeline.
5. Keep Utinni as the reference/fallback live editor until the toolkit's in-game gizmo clears the
   "no half-working" bar. Scope full world-editing to the advertised client.
