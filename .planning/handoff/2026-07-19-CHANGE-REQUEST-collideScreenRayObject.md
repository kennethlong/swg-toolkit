# Change request (→ swg-client-v2 session): `clientWorld::collideScreenRayObject` (borrowed Object* pick)

**Date:** 2026-07-19 · **From:** SWG-Toolkit live-editor session · **To:** swg-client-v2 (advertised catalog owner).
**Type:** cross-repo change request (emit spec, don't edit swg-client-v2 from the toolkit session —
[[reference-cross-repo-change-request-handoffs]]). **Priority:** the one row that unblocks pure-`.ilf`
decoration selection. **This is the row you pre-described** in the hybrid-incell ANSWERS addendum
("if a later filter drops id-less objects, the fallback is a trivial v21 sibling").

## Measured confirmation (the decisive experiment, run + probed live)

Consumer wired the CONSULT-69 experiment and a layer probe. Result, from the running gl11 client inside a
Mos Eisley cantina, `allowTargetAnything=true`:

- **Pure `.ilf` decoration (a table):** `cuiHud::getTarget` = **null**; no template; networkId 0. But
  `clientWorld::collideScreenRay(objectsOnly=0)` = **hit=1, id=0, point=(3436.6, 4.8, −4840.2)** — the ray
  *reaches* it (we know exactly where it is) but there is **no pointer and no id** to select it with.
- **Sittable "chair" (for contrast):** `cuiHud::getTarget` = **non-null**, template
  `object/tangible/furniture/tatooine/shared_f…`, **networkId 1127094080** — i.e. a **tangible networked
  object** (server-streamed: moving it client-side left the NPC floating). NOT a pure decoration; it selects
  today via the pointer path exactly as your synthesis predicted.

So Verdict 1 holds for *tangible/networked* in-cell objects, but **pure `.ilf` decorations have no pointer via
the hud pick** — the pick seam needs this row.

## What's needed

A borrowed-`Object*` sibling of `collideScreenRay`, so the consumer can latch the actual decoration under the
cursor and drive the advertised transform rows against it. Primitives/opaque-pointer only, game-thread-only.

```c
// Like collideScreenRay, but returns the borrowed Object* of the nearest hit (INCLUDING id-less
// .ilf interior-layout decorations) instead of a NetworkId. Borrowed — never AddRef/Release.
// Lifetime: valid until the owning BUILDING leaves world (one delete site). Safe to hold across a
// gizmo drag WHILE in-cell; the consumer clears it on cell/zone change and SEH-guards a despawn.
extern "C" void* __cdecl utinni_collideScreenRayObject(int screenX, int screenY, int objectsOnly);
// returns the Object* (opaque) or null on miss / no current camera / null out.
```

Engine-side it's the same ray you already built for `collideScreenRay` — just return the hit `Object*` (the
in-cell collide recursion already reaches `.ilf` children per your hybrid-incell trace) rather than resolving
to a NetworkId. `objectsOnly=1` to skip terrain/geometry; `0` to include everything the ray touches.

## Consumer side (ready)

Toolkit `rva_table.cpp` adds a `clientWorld::collideScreenRayObject` binding; `overlay.cpp` latches the
returned `Object*` (same latch path the tangible-chair test already drove) so the gizmo moves a pure `.ilf`
decoration. No consumer blockers — purely waiting on the row.

## Note on scope (not this request)

This makes decorations *selectable/movable live*. **Persistence** is still the separate product-question
decision (per-instance model (D) template-derive+rebind vs per-template (A) `.ilf` edit) from
`CONSULT-69-SYNTHESIS`. This row is orthogonal and needed by every persistence path.
