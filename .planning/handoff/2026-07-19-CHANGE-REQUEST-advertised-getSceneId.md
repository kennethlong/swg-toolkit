# Change request (→ swg-client-v2 session): advertised `game::getSceneId` copy-out

**Date:** 2026-07-19 · **From:** SWG-Toolkit live-editor session · **To:** swg-client-v2 (advertised catalog owner).
**Type:** cross-repo change request (emit spec, don't edit swg-client-v2 from the toolkit session —
[[reference-cross-repo-change-request-handoffs]]). **Priority:** small ergonomic unblock.

## What's needed

A copy-out getter for the current scene id, so the in-game editor's **"Reload current scene"** is one-click
(no typed scene name) and the imported `.ws` can be auto-named. Primitives-only, mirroring the rider-4C
camera accessors / `wsGetSavePath` shape.

```c
// Current scene id (e.g. "tatooine") — Game::ms_sceneId, the same string
// WorldSnapshot::load()/wsSaveSnapshot() key the .ws filename on.
extern "C" int __cdecl utinni_getSceneId(char* buf, int cap);
// returns needed length INCLUDING the NUL (copy-out convention); 0 = no scene loaded.
```

Engine-side it's just `Game::getSceneId()` (`Game.cpp:409 ms_sceneId`, derived via
`getSceneIdFromTerrainFilename`). Catalog name suggestion: `game::getSceneId`.

## Why it matters (consumer symptom that prompted this)

The consumer bound `worldSnapshot::load` for a "Reload scene" button but has no way to know the current
scene id, so it asks the user to type it. A user typed `tatooine-2` (thinking version), the button ran
`unload()` + `load("tatooine-2")`, no such `.ws` existed → the edited snapshot was unloaded and nothing
reloaded. With this getter the button reads the id itself: `unload()` + `load(getSceneId())` reloads the
SAME scene and picks up the just-saved override `.ws` — matching what a fresh client boot already does.

## Consumer side (ready)

Toolkit agent `rva_table.cpp` adds a `game::getSceneId` binding row; `overlay.cpp` auto-fills the scene
field / drops it entirely for a one-click reload, and `snapshotWatcher` can prefer the reported id. No
consumer blockers — purely waiting on the row.
