---
created: 2026-08-02
source: maintainer question during 05.1-05 live checkpoint — "why don't we want everything to be armable? Makes positioning things outside possible."
blocks: nothing in 05.1
---

# Exterior object editing via `.ws` nodes (the second persist route)

## ⭐ MAINTAINER DESIGN INTENT (2026-08-02) — read this first, it reframes everything below

> *"The plan is to have these buttons work the same no matter if you are inside or outside. The editor
> will put it in the right containers behind the scenes, so this becomes a non-issue later on."*

**The interior/exterior split is an IMPLEMENTATION DETAIL, not a user-facing mode.** The user never
picks a route, never sees a container, and is never refused for standing in the wrong place. Place an
object; the editor resolves the correct container and picks the matching persist route (`.ilf` row vs
`.ws` node) itself.

### ⚠ The container is resolved from the PLACEMENT POINT, never from the player (2026-08-02)

> *"The decision should be made based on the placement location, not the player location. If I'm
> standing in the cantina door, I can place a world object just outside the door — that goes to `.ws`
> not `.ilf`. And the opposite is also true: if I'm just outside the cantina door, I can place an
> object just inside the door and that goes into `.ilf`, not world."*

Player position and target position are INDEPENDENT inputs, and a doorway makes them disagree. Any
implementation that reads `getParentCell(player)` — or infers the route from where the camera/avatar
happens to be — is wrong, and will be wrong in exactly the case a user is most likely to try.

**The doorway is the acceptance test.** Both directions must hold:

| Player stands | Places at | Correct route |
| --- | --- | --- |
| inside the cantina (or in the doorway) | just OUTSIDE the door | `.ws` world node |
| outside the cantina (or in the doorway) | just INSIDE the door | `.ilf` interior row |

**This is implementable with bindings that already exist**, and it is what Plan 12's click-to-place
flow already does structurally: the ray hit at the target point IS the container signal. Per
`armDecorationEdit`'s own note, a wall/floor click inside a building resolves to the CELL object
(`object/cell/shared_cell.iff`); a click on open terrain resolves to no cell. So the hit at the
placement point yields cell-or-world directly — no player state involved.

Corollary: **"Insert at player" is structurally the wrong affordance** for this and cannot be made
correct — its container is the player by definition. "Insert at cursor" (`overlay.cpp:1253`) is the
shape that generalizes. Plan 14's Add wizard should follow the cursor/target model, not the player one.

This is a stronger requirement than "add a second route", and it retires two things elsewhere in the
codebase as INTERIM, not final:

1. **The arm guard's refusal** (`armDecorationEdit`, `cb6f369`): today an object outside a building is
   REFUSED with "not inside a building — interior decorations only". Under this intent the correct end
   state is to ROUTE to the `.ws` path, not refuse. The refusal is only correct while the `.ws` route
   does not exist. When it lands, revisit that guard — do not treat the refusal as settled behavior.
   (The deferred wording change already queued for `overlay.cpp` — "exterior editing needs .ws (not
   wired yet)" — is deliberately phrased as *unbuilt route*, not *prohibition*, for this reason.)
2. **`containedById 0 = world`** in "Insert at player" (`overlay.cpp:1247`): the container must be
   DERIVED from context, not hardcoded. See the field observation below for what hardcoding it looks
   like to a user.

Consumers: **Plan 12** (placement — already carries `cellName` + `buildingId`, so it is aligned) and
**Plan 14** (the Add wizard — its UI must not expose a route choice). Anything that makes the user
aware of which route was taken contradicts this intent.

The maintainer wants to position objects **outside** buildings. That capability is legitimate and
partly reachable today — it is blocked by the toolkit having exactly ONE persist route, not by any
client limitation.

## ⚠ There are THREE object classes, not two (established live 2026-08-07)

The interior/exterior split below is real but INCOMPLETE. A third class exists and is not reachable
by either route, which was discovered by trying to persist a cloning terminal and failing correctly:

| Object class | Defined in | Persist route | Status |
| --- | --- | --- | --- |
| Interior decoration | `.ilf` interior layout (client) | derived template + `wsSetNodeTemplateName` rebind | **BUILT** (Phase 05.1) |
| Exterior world object | `.ws` node (client) | direct node edit + `wsSaveSnapshot` | designed here, NOT built |
| **Server-spawned object** | **server datatable** | **edit datatable + server push** | **not designed** |

**Worked example — the cloning facility terminal.** `object/tangible/terminal/shared_terminal_cloning.iff`
is **absent** from `interiorlayout/shared_cloning_facility.ilf`'s 46 rows (verified against pristine
TRE bytes; the layout holds bacta tanks, particles, beds and wall data terminals). It is defined
server-side in
`swg-main/dsrc/sku.0/sys.server/compiled/game/datatables/structure/municipal/cloning_facility_terminal.tab`
and spawned at runtime into the building's cell.

So it can be MOVED live with the gizmo but nothing client-side owns its position — the server
restores it. `decorationPersist` refuses with *"could not resolve picked … in any cell"*, which is
**correct**: there is no `.ilf` row to rewrite.

**Consequence for this todo's design intent.** The intent is "the buttons work the same no matter
where you are; the editor resolves the container behind the scenes." That holds for classes 1 and 2,
which are both client-side and both end in `wsSaveSnapshot`. **Class 3 cannot join that model** — it
needs a server datatable edit and a server push, an entirely different pipeline with different
lifetime and deploy semantics. Attempting to hide that behind the same button would promise a
persistence the toolkit cannot deliver against a live server.

Recommended: route classes 1+2 through the unified flow this todo describes, and give class 3 an
HONEST refusal that names the reason ("this object is spawned by the server — moving it permanently
means editing server data"). That refusal is a better outcome than silence, and it is the same
lesson as the three reporting defects found on 2026-08-06/07: the refusals were all correct; only
their reporting was broken.

## The distinction that matters

| | Interior decoration | Exterior object |
| --- | --- | --- |
| Lives in | `.ilf` — per-building interior layout, cell-indexed rows | `.ws` — top-level world-snapshot node |
| Persist path | edit `.ilf` row → derived building template → `wsSetNodeTemplateName` → `wsSaveSnapshot` | edit the `.ws` node directly → `wsSaveSnapshot` |
| Needs | a containing building id | no building at all |

All of Phase 05.1 drives the **interior** column (`decorationPersist.ts`, `ilf.ts` addNode/removeNode,
the World panel's building tree, model-D's derived-template rebind).

## Why the arm guard exists (05.1-05, `cb6f369`)

`armDecorationEdit()` does not merely select an object — it captures `buildingId` +
`buildingTemplate` and commits to assembling an `.ilf` edit. Arming an exterior object therefore did
not deliver exterior editing; it routed a world object into the interior pipeline, where "which
building contains this" has no answer. The retired pre-shim fallback answered it with *the object's
own id*, which would assemble an `.ilf` row against a building that never contained it.

So the guard means **"wrong route"**, NOT "not allowed". It should not be read as a decision against
exterior editing.

## Field-observed 2026-08-02 — the split is VISIBLE, and "Insert at player" demonstrates it

Maintainer, at the 05.1-09 checkpoint: *"when I create object inside with insert at player I don't see
them, but if I walk outside the cantina door and look back in I can see them, and at certain angles I
can see them once back inside the room."*

Cause, confirmed in source — `overlay.cpp:1247`:

```cpp
swg::endpoints::wsAddObject(s_insertTemplate, t12, 0);   // containedById 0 = world
```

**"Insert at player" ALWAYS spawns into the world cell**, regardless of where the player stands. Used
indoors it creates a world-cell object at interior coordinates, and SWG's portal culling then behaves
exactly as observed:

| Viewpoint | Result |
| --- | --- |
| inside the cell | world-cell geometry culled → **invisible** |
| outside, looking in through the door | viewer is in the world cell too → **visible** |
| certain angles inside | portal frustum leakage → **partially visible** |

This is not a code defect — the parameter does what its own comment says. It IS a UX trap: the button
gives no hint that inserting indoors produces something invisible from where you are standing.

**It is also the clearest demonstration of why the `.ilf` interior path exists**, and it is the same
portal boundary as the see-through teleport in this file's first section, seen from the other side:
teleport puts the PLAYER in the wrong cell; this puts the OBJECT in the wrong cell.

**Plan 12 already anticipates it** — `START_PLACEMENT` carries both `cellName` and `buildingId`, and
the C6 wrong-building guard exists precisely to stop an object landing in the wrong container.
`wsAddObject`'s catalog note confirms a real `containedById` does the right thing ("mints
id..id+cellCount, atomic POB cell expansion"). The Slice-0 button simply predates that design.

Do NOT "fix" the Slice-0 button as incidental work — Plan 14's Add wizard replaces it, and Plan 12
owns correct cell placement.

## Most of the client side already exists

- `worldSnapshot::wsAddObject` — `__int64 (const char* sharedTemplateFilename, const float*
  transform12, __int64 containedById)`; mints id..id+cellCount, spawns immediately, returns the new
  top id, 0 = fail-closed. **`containedById` takes world, not only a POB.**
- `worldSnapshot::wsAddNodeAt` — re-add at an EXPLICIT id (undo-replay).
- `worldSnapshot::wsRemoveNode`, `wsSaveSnapshot`, `wsGetSavePath`.
- Legacy parity exists too: Utinni's classic layer binds `WorldSnapshot::addNode 0x00B98410`,
  `removeNode 0x00B98780`, `saveFile 0x00B98120` as real SWGEmu RVAs — the maintainer's open-world
  Naboo armoire IS this path. See `.planning/backlog/milestone-9-swgemu-capability-parity.md`.

## What is actually missing (our side)

1. A `.ws`-node edit/persist route parallel to `decorationPersist`'s `.ilf` route.
2. A branch at arm time that **routes on `buildingId`** (0 → `.ws` route, non-0 → `.ilf` route)
   instead of refusing.
3. World-panel representation for exterior nodes (the tree is building-keyed today).

## Deliberately NOT folded into 05.1

The 05.1 plan set is 15 plans converged over a 13-round cross-AI review loop, built end-to-end on the
interior path. Adding a second persist route mid-execution is precisely the half-propagation failure
that loop existed to eliminate ([[feedback-centralize-contracts-split-hard-from-broad]],
[[feedback-reviews-replan-half-propagates-seams]]). Route it as its own phase.

## Cheap interim polish (not yet applied)

The refusal string is currently `"not inside a building — interior decorations only"`, which reads as
a permanent no. Better: `"not inside a building — exterior editing needs .ws (not wired yet)"` — same
guard, honest about it being an unbuilt route rather than a prohibition. Maintainer deferred the
wording change so the checkpoint DLL stayed stable; apply whenever `overlay.cpp` is next touched.
