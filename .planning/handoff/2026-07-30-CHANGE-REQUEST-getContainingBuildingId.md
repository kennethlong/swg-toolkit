# Change request (→ swg-client-v2): `object::getContainingBuildingId` — cell→building resolver

**Date:** 2026-07-30 · **From:** SWG-Toolkit live-editor · **To:** swg-client-v2 (advertised catalog owner).
**Filed to provider inbox:** `swg-client-v2/.planning/handoff/2026-07-30-toolkit-getContainingBuildingId-REQUEST.md`.

## Why

Live smoke of the model-D round trip (all built + proven this session) fail-closes at ONE step: getting the
POB building's `.ws` node id + template from in-game.

- `collideScreenRay` on a decoration → id 0 (by design, v22 m_childObject gate).
- Wall/floor click → the **CELL** (`object/cell/shared_cell.iff`, no `interiorLayoutFileName`) → derive fails.
  Confirmed live: `bldg=1082878 → getObjectTemplateName = object/cell/shared_cell.iff → ABORT "has no
  interiorLayoutFileName"`.
- `object::getParent` not advertised → can't walk cell→building consumer-side.

## The ask (grounded chain, all inline → shim mandatory)

`__int64 __cdecl utinni_getContainingBuildingId(void* object)` doing
`object->getParentCell()->getPortalProperty()->getOwner()->getNetworkId().getValue()` with null guards.
(`getParentCell` Object.h:166 · `getPortalProperty` CellProperty.h:119/270 · `getOwner` Property.h:34/57.)

## Consumer status (PRE-WIRED — lights up on exe restage, no consumer rebuild)

- `rva_table.cpp`: bound `{"object::getContainingBuildingId", &getContainingBuildingId}`.
- `overlay.cpp` armDecorationEdit: prefers `getContainingBuildingId(rayObject)` for the building id; falls back
  to the current wall-click selection when the shim is unresolved (so today's build still runs).
- Also simplifies UX: hover decoration → Arm, no separate building selection.

Everything else (contract, C++ channel mirror, agent capture/rebind, host writeRebind, renderer orchestrator +
override-dir resolution + `.ilf` assemble + derived template + staging) is done and proven live.
