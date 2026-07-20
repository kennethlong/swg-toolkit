# Change request (→ swg-client-v2 session): `object::getTransformO2P` (copy-out o2p read)

**Date:** 2026-07-19 · **From:** SWG-Toolkit live-editor session · **To:** swg-client-v2 (advertised catalog owner).
**Priority:** the last accessor model-D persistence needs. Trivial — identical shape to the rider-4C
`camera::getTransformO2W` copy-out.

## Why

Model-D interior-decoration persistence writes the moved object's transform into the `.ilf`, which stores
**o2p** (object-to-parent-CELL), not world space. The gizmo drives the object in **o2w**. To read the object's
o2p directly, `Object::getTransform_o2p()` exists ([Object.h:233 / inline :652]) but is **inline + returns
`const Transform&`** — un-advertisable as-is (the same ABI-RULE reason the camera getters got copy-out shims).
Computing it consumer-side would need `getParentCell` → `CellProperty` owner → cell o2w → matrix inverse, most
of those hops NOT advertised — more rows than just this one copy-out.

## What's needed

A copy-out of an object's o2p, byte-for-byte the shape of `utinni_getCameraTransformO2W` (row-major 3x4,
columns = local frame i/j/k, column 3 = position — the `.ilf`/UtinniWsNodeInfo transform convention):

```c
// out12: the object's transform_o2p as row-major 3x4 (cols i/j/k, col3 position) — same layout the
// .ilf stores and setTransform_o2w/camera::getTransformO2W already use. 1 ok / 0 null-object-or-arg.
extern "C" int __cdecl utinni_getObjectTransformO2P(void* object, float* out12);
```

Engine-side it's `Object::getTransform_o2p()` copied out via the same column accessors the camera shim uses
(getLocalFrameI_p/J_p/K_p/getPosition_p). CALLED, game-thread-only, per-frame-safe (plain copy).

## Consumer use (both ends of the persist flow)

Read at PICK time (the decoration's original o2p → resolve its `.ilf` (cell,rowIndex) via the already-built
`resolveRowIndex`), and again at PERSIST time (the moved o2p → `editNodeTransform` into the edited `.ilf`).
Consumer binds `object::getTransformO2P` by name in `rva_table.cpp` (1 line). No other blockers.
