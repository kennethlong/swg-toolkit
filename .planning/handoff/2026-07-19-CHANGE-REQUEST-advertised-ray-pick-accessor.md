# Change request (→ swg-client-v2 session): advertised copy-out ray-pick accessor

**Date:** 2026-07-19 · **From:** SWG-Toolkit live-editor session · **To:** swg-client-v2 (advertised catalog owner).
**Type:** cross-repo change request (do NOT edit swg-client-v2 from the toolkit session — emit spec, per
[[reference-cross-repo-change-request-handoffs]]). **Priority:** nice-to-have (see "Why it's not urgent").

## What's needed

A **copy-out ray-pick accessor** in the advertised `GetEngineHookPoints` catalog, mirroring the rider-4C camera
accessors (`utinni_getCameraProjectionMatrix` / `utinni_getCameraTransformO2W`, `engine_advertise.cpp:462-493`).
It must keep the NGE-unsafe struct reads (`CollisionInfo`, `clientWorld::collide`, `Camera::reverseProjectInViewportSpace`)
**inside the exe TU** and hand the consumer **primitives only** (ABI RULE), exactly like the camera rows.

Proposed shim (name/shape open to your preference):

```c
// Casts a ray from the CURRENT camera through screen pixel (x,y) and returns the nearest hit.
// Wraps the consumer-side collideCursorWithWorld logic (cui_hud.cpp:221) engine-side so the
// consumer never touches CollisionInfo / clientWorld::collide / reverseProjectInViewportSpace.
// Primitives-only, game-thread-only, per-frame-safe.
extern "C" int __cdecl utinni_collideScreenRay(
    int    screenX, int screenY,      // cursor position in client pixels
    int    objectsOnly,               // 1 = client objects only; 0 = include terrain/geometry
    __int64* outHitObjectId,          // NetworkId of the hit object (0 if terrain / non-object)
    float*   outPoint3);              // world x,y,z of the hit point
// returns 1 = hit, 0 = miss / no current camera / null out
```

Engine-side it composes what already exists: `Game::getConstCamera()` →
`camera->reverseProjectInViewportSpace(x - viewportX, y - viewportY)` → `rotate_l2p` → `clientWorld::collide(
camera->getParentCell(), &worldStart, &worldEnd, collisionResults, flags, exclude)` → read
`collisionResults.point` + `collisionResults.object->getNetworkId()`. (`clientWorld::collide` is currently only
in the SKIP-virtual comment at `engine_advertise.cpp:707`; `CollisionInfo` has no copy-out.)

The consumer already produces the matching `transform12` format and resolves NetworkId→Object* via the existing
`network::getObjectById` row, so the returned id feeds straight into the gizmo focus + `worldSnapshot::wsAddObject`.

## Why it's not urgent

Object **selection already works without this**: `cuiPreferences::setAllowTargetAnything(true)` (rider 4B, now
wired in the toolkit agent) + SWG's own click/Tab targeting lets the player select any client object, and the
gizmo edits the current target via the cuiHud two-step. Ray-pick adds two things targeting can't: (1) picking a
**world position on terrain** (for placing a NEW object where you point) and (2) selecting non-targetable raw
geometry. (1) is the real driver — until this lands, insertion places at the player/camera-front position instead
of the cursor-on-ground point.

## Consumer side (already ready)

Toolkit agent `packages/live-inject/agent/{overlay.cpp,rva_table.cpp}` — add a `clientWorld::collideScreenRay`
binding row + call it on a click inside the Present hook (game thread), feed the hit id into focus resolution.
No consumer blockers; purely waiting on the advertised row.
