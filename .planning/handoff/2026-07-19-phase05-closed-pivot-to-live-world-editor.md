# Handoff — Phase 05 CLOSED; pivot to a Live World Editor milestone (Slice-0 spike is the next work)

**Date:** 2026-07-19 · **Branch:** `main` · **HEAD:** `63d4113` · **Working tree:** clean · **Not pushed.**
**Status:** Phase 05 complete. Direction for the next milestone is LOCKED. Immediate next work = the
**Slice-0 spike** (go/no-go gate) — start at step 1 (build scaffolding). ← start here.

---

## TL;DR

Phase 05 (WYSIWYG Live-Sync & Typed Editors) is **done and closed** — its live capability is a *thin slice*
(drag a gizmo in the toolkit's own three.js viewport → transform-nudge the currently-*targeted* in-game
object over a shared-memory channel). During in-app UAT the maintainer realized the real requirement is an
**in-GAME gizmo** (rendered in the SWG window, for placing objects *relative to one another in the live
scene*) — like Utinni. A Utinni ground-truth spike + a 5-consultant crew established that this is a
**different, in-process + in-render architecture**, not a Phase-5 tweak. Decision: **build it**, starting
with a **Slice-0 render-overlay spike** that gates a new "Live World Editor" milestone.

**Read these three docs first (they hold the full analysis + plan):**
1. `.planning/research/SPIKE-utinni-world-editor-gaps.md` — how Utinni actually works vs. us (file:line grounded).
2. `.planning/research/CONSULT-UTINNI-SYNTHESIS.md` — 5-consultant crew synthesis → the refined plan.
3. `.planning/research/SLICE-0-SPIKE-PLAN.md` — the concrete go/no-go spike (ordered steps + criteria).
(Raw crew memos: `.planning/research/CONSULT-UTINNI-{codex-reuse,cursor-seam}.out` — UTF-16LE; the Opus/
Sonnet/Fable memos live in the git history of this session's summary, paraphrased in the SYNTHESIS.)

---

## What happened this session (arc)

1. **Restarted after a power loss**, resumed Phase 05 execution (planning was already 6-review-rounds converged).
2. **Executed all 12 Phase-05 plans** (6 waves, sequential-on-main since `use_worktrees=false`). All green, committed.
   Includes the round-6 ABA content-compare fix landed with a real behavioral test.
3. **Full-workspace test gate** — found the root `vitest run` was red because the new soak test hard-throws
   without `--expose-gc`; fixed the root config (`e94344e`). 558 tests green.
4. **In-app UAT surfaced FIVE real live-inject bugs — all fixed + committed** (this is the load-bearing part;
   none were caught by the Node test suite because they're Electron/real-process-only):
   - **`70a5dd3`** copy-on-read channel buffer — **Electron 42's V8 sandbox forbids external ArrayBuffers**;
     `openChannel` threw "External buffers are not allowed". Now the JS-facing buffer is V8-owned and
     `readChannelView` does a seqlock-validated memcpy of the mapped view. (native-core already did this;
     the channel was the only external-buffer user.)
   - **`5ca53d5`** agent-DLL path resolution — inject failed "LoadLibraryA returned NULL"; `getAgentDllPath`'s
     fixed `__dirname/../../` traversal missed the DLL after a vite rework. Now resolves via `process.cwd()`
     + several anchors, first-existing.
   - **`b9d63fd`** launch cwd — client booted then **stalled right after SetupSharedFoundation** ("skufree.iff
     could not be found — are your paths set up correctly?") because `CreateProcessA` passed `nullptr` cwd, so
     the client inherited the *toolkit's* cwd and couldn't find `client.cfg`. Now launches with the exe's own dir.
   - **`67e1cac`→`86a8593`** client-exit detection — first attempt (SEQ_COUNTER staleness) **false-positived**
     ~2s into every launch, because the agent skips `channelWrite` whenever the player is null (loading/login/
     zoning), so the counter freezes while the client is alive (`agent_main.cpp: if (!player){Sleep;continue}`).
     Replaced with **process liveness** (`process.kill(pid,0)`, pure JS) on a **`setTimeout`** loop (rAF *pauses*
     when the toolkit is occluded by the fullscreen game).
   - **`a11ff97`** Browse button for the client exe (`client:pick-exe` IPC, mirrors `workspace:pick-file`) +
     gitignored the SWG client's crash dumps / boot trace (they were landing in the toolkit dir pre-cwd-fix).
   After all five, the **full live loop works end-to-end**: inject → boot into world → stream real position/
   `playerActive` → move a targeted object → clean process-liveness detach.
5. **Gizmo confusion → the real requirement.** The maintainer couldn't find "the gizmo." Explanation: our gizmo
   is drei `TransformControls` bound to the toolkit's *own viewport mesh*, not the in-game object. The maintainer
   clarified the real need: an **in-game gizmo** for relative object placement in the live scene (= Utinni's
   world-snapshot editor).
6. **Spike (3 research agents)** on Utinni's real architecture, then a **5-consultant crew** (Codex/Cursor/Opus/
   Sonnet/Fable) on reuse-vs-rebuild. Strong convergence (see below).
7. **Decisions (maintainer):** in-game gizmo is REQUIRED; **close Phase 05** (accept the slice); **Slice-0 spike
   first**, then plan the milestone.
8. **Closed Phase 05** (`319ab87`): 05-12 Task-2 checkpoint accepted at the slice, `LIVE-03` marked complete,
   `phase.complete 05` run (advanced to Phase 6). Wrote the **Slice-0 spike plan** (`63d4113`).

---

## The locked plan (crew synthesis — refines the maintainer's "vendor Utinni into our agent" lean)

**Don't vendor `UtinniCore` wholesale.** Instead:
- **Vendor ONLY the render overlay** into our x86 agent: D3D9 `Present` vtable hook + ImGui + ImGuizmo +
  camera/object matrices + per-frame writeback (~2–3k LOC + libs `imgui`/`imguizmo`/`DetourXS`/`spdlog`).
- **Reach select-anything / insertion / snapshot / camera via the SHARED `engine_hookpoints.h` contract**
  (swg-client-v2, maintainer-owned) — add binding rows to our agent's `packages/live-inject/agent/rva_table.cpp`
  (already ported from Utinni's endpoint pattern, but **pinned STALE ~v6 vs live v19**). Do NOT copy
  `world_snapshot.cpp`/`cui_hud.cpp` source (avoids fork tax on code the same maintainer develops upstream).
- **Standalone game window** — do NOT re-parent the game into Electron. Utinni's one unsolved bug (embed-aspect/
  present-stretch that mis-calibrates the gizmo hit-test) is *caused by* re-parenting; standalone ⇒ backbuffer
  == window ⇒ gizmo maps 1:1.
- **Game-thread command queue** — MANDATORY. Engine mutations (createObject/AllowTargetAnything/snapshot) run on
  the game thread via the Present-hook drain, NOT the agent's current poll thread (a Phase-5 shortcut, unsafe to
  expand). This is the top technical risk.
- **Editing model in Electron** (selection, undo/redo, snapshot node tree); the agent stays a *mechanism*.
- **Scope full world-editing to the ADVERTISED client** (swg-client-v2); legacy SWGEmu stays transform-nudge.
- **Killer payoff:** wire `.ws` snapshot save into the toolkit's existing deploy/versioning pipeline (Utinni-as-
  separate-tool can never give this).
- Effort (Codex): ~2–3 wk first slice, ~5–8 wk to Utinni-class parity.
- **Flip conditions:** → full wholesale vendor only if upstream Utinni is SUNSET; → keep Utinni as THE live editor
  if the Slice-0 present-hook spike is unstable or two-window UX tests worse.

---

## NEXT WORK — the Slice-0 spike (go/no-go gate). Start here.

Full plan: `.planning/research/SLICE-0-SPIKE-PLAN.md`. It answers ONE question before any milestone planning:
*can our x86 agent host a D3D9 Present hook + ImGui/ImGuizmo overlay + `ImGui_ImplWin32` input from the
standalone game window + game-thread engine marshalling, and draw a working gizmo on the live object?*

Ordered steps:
1. **Build scaffolding** — vendor `imgui`/`imguizmo`/`DetourXS`/`spdlog` into `packages/live-inject/agent`'s
   **`/MT` x86** build (the agent's hard CRT constraint; `/MD` breaks remote LoadLibraryA). Verify it still injects.
2. **Present hook** — vendor Utinni's `directx9.cpp:hkPresent` (vtable index 17); draw a STATIC overlay first
   (no engine interaction) to prove the hook is safe. DROP the PanelGame-era embed-aspect latch + window-pos clamp.
3. **Input** — vendor `hkWndProcHandler` → `ImGui_ImplWin32_WndProcHandler` (survives the re-parent drop).
4. **Camera + gizmo** — feed ImGuizmo the live camera (advertised rows `camera::getTransformO2W`/`getProjectionMatrix`,
   already provider-shimmed) + object o2w; `ImGuizmo::Manipulate`; per-frame `setTransform_o2w` + `positionAndRotationChanged`.
5. **Game-thread command queue** — the load-bearing new primitive; drain inside the Present hook.
6. **Electron** — send `GIZMO_ENABLE` + `GIZMO_MODE` over the channel; poll thread degrades to reads only.

GO if: Present hook stable, ImGui gets input from the standalone window, gizmo drags every axis 1:1 and moves the
live object (advertised client first). NO-GO → keep Utinni as the live editor, share only `.ws` + the contract.

---

## Key ground-truth pointers (Utinni source, `D:\Code\Utinni` / `D:\Code\UtinniPlugins`)
- In-game gizmo render: `UtinniCore/swg/graphics/directx9.cpp:380` (hkPresent → imgui_impl::render); `swg/ui/imgui_impl.cpp:781,910,1181,1216,1290-1292`.
- Select-anything: `swg/ui/cui_hud.cpp:297` (`patchAllowTargetEverything`/`CuiPreferences::AllowTargetAnything`); ray-pick `cui_hud.cpp:221` → `swg/scene/client_world.cpp:29`.
- Insertion + `.ws`: `swg/scene/world_snapshot.cpp:728 createAddNode` (`createObject` 0x0059BBA0 + `addToWorld` 0x00B225F0), `:608 saveFile` / advertised `wsSaveSnapshot`.
- Utinni architecture doc: `D:\Code\Utinni\.planning\codebase\ARCHITECTURE.md`; Goal-B handoff (yesterday): `D:\Code\Utinni\.planning\phases\24-.../24-SESSION-HANDOFF-2026-07-18-goalB-waves-complete-gizmo-aspect.md`.
- Our agent (reuse target for the port host): `packages/live-inject/agent/{agent_main.cpp,channel.h,resolve.cpp,rva_table.cpp,CMakeLists.txt}`; host addon `packages/live-inject/src/{channel_binding,inject_binding}.cpp`.

## Build / test gotchas (learned the hard way this session — also in memory)
- **Rebuild native via `pnpm --filter @swg/live-inject run rebuild`** (WITH `run` — bare `rebuild` is pnpm's
  builtin no-op). After building, **`stat` the .node/.dll mtime and confirm it's newer than the source** — a
  stale mtime means the build no-op'd and the app is loading old code. Rebuild with the app CLOSED (it locks the binary).
- **Node/vitest tests CANNOT prove an Electron-sandbox or real-process native fix** (external ArrayBuffers are
  legal in Node; the injected agent needs a real client). The definitive proof is the running app.
- Agent is **x86 /MT, KERNEL32-only** (statically linked; `/MD` fails remote LoadLibraryA). Host addon is x64.
- The SWG client is **x86**. An x64 swg-client-v2 build exists but the agent is x86-only → x64 support is a
  backlog todo (`.planning/todos/pending/x64-live-inject-agent-support.md`).

## Open todos / carry-forward
- **Slice-0 spike** (the main next work — above).
- `project-persist-last-client-exe` (memory) — make the Live Inspector "Client executable" field remember the
  last-run path + default to it on restart (currently empty each session). Small; not built.
- `x64-live-inject-agent-support` (repo todo) — x64 agent build for the x64+D3D11 client.
- Pre-existing (NOT ours): `packages/backend/src/preload.ts:57,59` TS2556 errors (from Phase-0 commit `12ee87d`);
  one flaky `e2e`/`gitLfs.test.ts` case logged in the 05 phase dir's deferred-items.
- STATE.md's free-text "Current focus"/"Next" lines are cosmetically stale post-`phase.complete` (still say 05-09);
  the milestone replan will rewrite STATE anyway.

## Memories written this session (recall context)
`reference-rebuild-native-verify-mtime-and-electron`, `reference-live-sync-liveness-and-poll-loop`,
`reference-utinni-inprocess-vs-toolkit-shared-memory` (updated with the crew synthesis),
`gsd-partial-summary-false-complete`, `project-persist-last-client-exe`, and the x64 clarification in
`reference-live-target-builds-in-scope`.

## Git
HEAD `63d4113`, clean, **not pushed**. This session's commits: `70a5dd3` copy-on-read → `5ca53d5` agent-path →
`b9d63fd` cwd → `67e1cac`/`86a8593` liveness → `a11ff97` Browse → `319ab87` Phase-05 close + spike/consult →
`63d4113` Slice-0 plan (plus `e94344e` expose-gc and the 05-01..05-12 execution commits earlier).

## Related memory
[[reference-utinni-inprocess-vs-toolkit-shared-memory]] · [[reference-live-sync-liveness-and-poll-loop]] ·
[[reference-rebuild-native-verify-mtime-and-electron]] · [[feedback-crew-catches-what-plancheck-cannot]] ·
[[reference-cross-repo-change-request-handoffs]] · [[swg-client-v2-advertised-hooks]]
