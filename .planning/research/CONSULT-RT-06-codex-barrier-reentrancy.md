# CONSULT-RT-06 (Codex) — Is a force-finish from a mainLoop detour re-entrant now?

Repo-tracer task. Answer from `D:/Code/swg-client-v2` source with file:line. This is a **new** question
created by a change that landed today; do not assume prior analyses of this area still hold.

## The situation

A tool injects an agent DLL into the running client. The agent installs a detour on `game::mainLoop`
(the advertised per-frame tick, `&Game::runGameLoopOnce`) and drains a command queue **after** calling
the original. From that drain it intends to call the advertised shim
`worldSnapshot::wsGetNodeCount`, whose prologue is `if (ms_parsePending) finishLoadNow();`
(`WorldSnapshot.cpp:1780-1791`), and `finishLoadNow()` (`:796-803`) is
`while (ms_parsePending) WorldSnapshot::loadStep();`.

**What changed today:** commit `04c3f8e11` hoisted `WorldSnapshot::loadStep()` out of
`GroundScene::updateLoading()` and into `GroundScene::update()`, where it now runs **unconditionally,
every frame** (`GroundScene.cpp:2064-2079`). Previously `loadStep()` only ran under a loading screen.

So the engine now pumps `loadStep()` per-frame, and the agent wants to spin `loadStep()` to completion
from inside a `mainLoop` detour on the same thread.

## Questions

**Q1. Establish the call ordering.** Where does `GroundScene::update()` sit relative to
`Game::runGameLoopOnce` (the symbol advertised as `game::mainLoop`)? Trace the frame's call chain. Is
`GroundScene::update()` invoked from *within* `runGameLoopOnce`? If the agent's code runs after
`runGameLoopOnce` returns, is it inside or outside `GroundScene::update()`'s dynamic extent?

**Q2. Re-entrancy.** Can `finishLoadNow()` called from the agent's drain point ever re-enter, or be
re-entered by, the engine's own per-frame `loadStep()` call? Consider: an exception or callback inside
`loadStep()` that pumps the message loop or renders a frame; `loadOneBuildoutArea` doing file I/O;
anything in the `PP_*` phase machine that could recursively reach `GroundScene::update()` or
`WorldSnapshot::load()`/`unload()`. Name any concrete path, or state that none exists and show the
coverage.

**Q3. What breaks if `loadStep()` is called while `ms_parsePending` is false?** The agent's barrier may
fire when no parse is pending. Read `loadStep()`'s entry (`WorldSnapshot.cpp:807-810`) and confirm the
early-out is total, or name what it still touches.

**Q4. Cost of the barrier in the new world.** Since the engine now advances the parse every frame
anyway, how much work is actually left for a `finishLoadNow()` called one frame after an in-world
`WorldSnapshot::load()`? Roughly what fraction of the parse does one frame's budgeted `loadStep()`
complete? The per-frame budget knob is `ConfigClientGame::getWorldSnapshotParseBudgetMs()` (default 40
per `ConfigClientGame.cpp:1119-1124`) — relate the budget to the total work so the tool can predict
whether the barrier costs ~40ms or ~2s.

**Q5. Is there a way to OBSERVE parse completion without forcing it?** The tool would prefer to wait
rather than block, if a poll-safe signal exists. `wsGetGeneration` is documented as a pure counter that
bumps on load/unload only. Is there any other advertised or advertisable read that reports
`ms_parsePending` or an equivalent, without calling `finishLoadNow()`? If none exists, say so — the
tool will then request one rather than guess.

## Scope fence

- Stay in `swg-client-v2`. Do not read `D:/Code/SWG-Toolkit/.planning/` — it contains the plan whose
  assumptions you are testing, and it would anchor you.
- Do not evaluate whether the tool SHOULD use a barrier. Answer the mechanics.
