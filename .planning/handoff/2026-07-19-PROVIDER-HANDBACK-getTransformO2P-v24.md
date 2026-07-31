# 2026-07-19 — v24 HANDBACK: object::getTransformO2P (copy-out o2p read)

**Status:** DONE 2026-07-19 night, build-gated + 45s boot smoke, exe restaged.
**Contract v23 → v24, 145 → 146 names.**
**Request:** SWG-Toolkit `2026-07-19-CHANGE-REQUEST-object-getTransformO2P.md` — the last
accessor of the model-D persist flow (.ilf stores o2p; the gizmo drives o2w).

## 1. The row

`object::getTransformO2P` →
`extern "C" int __cdecl utinni_getObjectTransformO2P(void* object, float* out12)`

- `Object::getTransform_o2p()` is INLINE + returns `const Transform&` [Object.h:233/:652] —
  shim mandatory (ABI RULE), exactly as your request predicted.
- **Layout byte-for-byte = `camera::getTransformO2W`:** row-major 3x4, columns = local frame
  i/j/k, column 3 = position (the .ilf / UtinniWsNodeInfo transform convention; same column
  accessors, same ordering).
- Returns 1 ok / 0 null-object-or-arg. The `Object*` is BORROWED consumer-held (your pick
  rows) — null-checked only; lifetime discipline is yours (same rules as
  `collideScreenRayObject`: clear on cell/zone change).
- CALLED, game-thread-only, per-frame-safe (plain copy).

## 2. Gates (all green, 2026-07-19 ~22:55 local)

- Release/Win32 `/t:SwgClient` forced relink: exit 0, **0 unresolved**; exe auto-staged
  22:54:02. Exe-TU-only change (shim + row in engine_advertise.cpp).
- `GetEngineHookPoints` ordinal 82, undecorated. 146 == 146 static_assert holds.
- 45s boot smoke: alive, no new dumps. x64 untouched by construction.

## 3. Contract re-sync

```
8845c43a04fd72132f93eee2df292562246a8f3d9f3d09d0f01574bc6b3a9c6d  engine_hookpoints.h
2771b6d416063d93632e03aafe0c427dda71e2d5a41bd855729f87b038d532d4  engine_hookpoints.inc
```

Version-assert 24, count 146. Append-only — one re-sync covers every pending bind
(getSceneId v21, collideScreenRayObject v22, wsSetNodeTemplateName v23, this).

## 4. Smoke steps

1. Pick a decoration (`collideScreenRayObject`) → `getTransformO2P` → the 3x4 matches the
   .ilf row your `resolveRowIndex` names (identity rotation + the authored cell-local
   position for untouched furniture).
2. Gizmo-move it → `getTransformO2P` again → position delta in CELL space (not world) —
   sanity: move "north" inside a rotated building and confirm the o2p delta is along the
   CELL's axis, not the world's.
3. Null object → 0, outs untouched.

With this + v23, the full model-D loop is contract-complete: pick → resolve row → edit .ilf
→ derived template → wsSetNodeTemplateName → wsSaveSnapshot → reload. Looking forward to
the end-to-end smoke.
