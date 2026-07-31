# PROVIDER HANDBACK (← swg-client-v2): `object::getContainingBuildingId` — v25, DONE

**Date:** 2026-07-30 · **From:** swg-client-v2 (advertised catalog owner) · **To:** SWG-Toolkit live-editor.
**Answers:** your `2026-07-30-CHANGE-REQUEST-getContainingBuildingId.md` (change request #6).
**Status:** DONE same-day — build-gated + 45s boot smoke, exe restaged at `stage/SwgClient_r.exe`
(2026-07-30 20:05:31 local). **Contract v24 → v25, 146 → 147 names.**

## 1. The row

`object::getContainingBuildingId` →
`extern "C" __int64 __cdecl utinni_getContainingBuildingId(void* object)`

- Returns the NetworkId VALUE of the POB building that contains `object` (== the `.ws` node
  id `wsSetNodeTemplateName` takes). 0 = null arg / not inside a POB.
- Your cited chain verified and used — with **one correction that makes your own fallback
  case work**: `Object::getParentCell()` [Object.cpp:1372] walks the ATTACHMENT ANCESTORS,
  so called on a **cell object itself** it lands in the WORLD cell and would return 0. The
  shim therefore checks the object's OWN `CellProperty` first (`getCellProperty()`,
  Object.h:299), THEN falls back to `getParentCell()`:
  - `.ilf` decoration / player / any cell-contained object → `getParentCell()` → its cell.
  - the CELL object (your live wall-click path: cell id → `getObjectById` → cell Object*)
    → its own `CellProperty` → the building. **So the wall-click fallback ALSO resolves to
    the building now, not just the hover-the-decoration path.**
- Remaining hops exactly as your request cited: `getPortalProperty()` [CellProperty.h:119 /
  inline :270 — NULL for the world cell = the "not inside a POB" return] → `getOwner()`
  [Property.h:34 / inline :57, via Container] = the building → `getNetworkId().getValue()`
  (full 64 bits).
- `getParentCell()` never returns null (world-cell fallback), so the fail-closed exit is
  the null `PortalProperty` — a decoration sitting in the world cell returns 0, per spec.
- The `Object*` is BORROWED consumer-held (your pick rows) — null-checked only; lifetime
  discipline is yours (same rules as `collideScreenRayObject` / `getTransformO2P`).
- CALLED, game-thread-only, per-frame-safe (pointer hops + a value read, no alloc).

## 2. Gates (all green, 2026-07-30 ~20:06 local)

- Release/Win32 `/t:SwgClient` forced relink: exit 0, **0 unresolved**; exe auto-staged.
  Exe-TU-only change (shim + row in engine_advertise.cpp + the two contract files).
- `GetEngineHookPoints` ordinal 82, undecorated. 147 == 147 static_assert holds.
- Boot smoke: a live session on the new exe went boot → login → world entry with normal
  in-world output and zero new dumps (stronger than the usual 45s login-screen smoke).
  x64 untouched by construction.

## 3. Contract re-sync

```
2ac2e96352ef09878e6bf69b50d8e04b6f2936cafbf97ff90ec643af3c23c09e  engine_hookpoints.h
2fa6436e431bc06a610032bea6661dc5ad25b2c5a9f6b5cae285358f2c4d7250  engine_hookpoints.inc
```

Version-assert 25, count 147. Append-only over v24 — one new name at the end;
`rva_table.cpp` gets its 1 line.

## 4. Smoke steps

1. Hover a decoration → `collideScreenRayObject` → `getContainingBuildingId(rayObject)` →
   nonzero id → `getObjectById(id)` → `getObjectTemplateName` = a BUILDING template (has
   `interiorLayoutFileName`), NOT `object/cell/shared_cell.iff`.
2. Cross-check vs your captured case: standing in bldg 1082878's cell, the wall-click cell
   object now ALSO resolves — `getContainingBuildingId(cellObject)` == the same building id
   as step 1.
3. Outdoors (world cell): any pick → 0. Null → 0.
4. Then the full model-D end-to-end: Arm (this row feeds `buildingInstanceId` +
   `buildingTemplateVfsPath`) → edited `.ilf` + derived template → `wsSetNodeTemplateName`
   → `wsSaveSnapshot` → reload → edited interior visible, subtree intact, other instances
   unchanged.

This was the single open accessor — with it, the model-D flow is contract-complete AND
armable from a single hover. Looking forward to the end-to-end result.

_(Provider-side record: `swg-client-v2/.planning/handoff/2026-07-30-toolkit-getcontainingbuildingid-v25-HANDBACK.md`.)_
