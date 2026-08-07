---
created: 2026-08-07
source: 05.1-15 sign-off session — a cloning terminal refused to persist, correctly; root-caused to server ownership
blocks: nothing
depends_on: nothing technical (both halves already exist) — see "Why this is cheaper than it looks"
related: exterior-ws-node-editing.md (classes 1 and 2)
---

# Class 3: editing server-spawned objects (datatable + server push)

## The three-class model — this todo owns the third row

Established live 2026-08-07 by trying to move a cloning terminal and failing correctly.

| Class | Defined in | Persist route | Status |
| --- | --- | --- | --- |
| Interior decoration | `.ilf` interior layout (client) | derived template + `wsSetNodeTemplateName` rebind | **BUILT** (Phase 05.1) |
| Exterior world object | `.ws` node (client) | direct node edit + `wsSaveSnapshot` | designed, NOT built — [[exterior-ws-node-editing]] |
| **Server-spawned object** | **server datatable** | **datatable edit + server push** | **THIS TODO** |

## The worked example, verified end to end

`object/tangible/terminal/shared_terminal_cloning.iff`:

- **Absent** from `interiorlayout/shared_cloning_facility.ilf`'s 46 rows (verified against pristine
  TRE bytes; the layout holds bacta tanks ×8, bactatank/steam particles ×12,
  `shared_frn_all_bed_lg_s2` ×4, wall data terminals ×6, …). The 46 also matches the
  `deleted=46` in a `refreshInteriorLayout` ack — independent cross-check.
- **Defined server-side** in
  `swg-main/dsrc/sku.0/sys.server/compiled/game/datatables/structure/municipal/cloning_facility_terminal.tab`:

```
STRUCTURE                                              X     Y    Z     CELL       HEADING  TERMINAL                       DROID
object/building/tatooine/cloning_facility_tatooine.iff 1.04  0.1  2.57  insurance  0        .../terminal_cloning.iff
```

- **Consumed by a script:** `script/structure/municipal/cloning_facility.java:19,41` →
  `structure.createStructureTerminals(self, …, DATATABLE_TERMINAL_LIST)` →
  `library/structure.java:420-438` reads `X`/`Y`/`Z`/`CELL`/`HEADING`, resolves the cell by name via
  `getCellId(facility, CELL_NAME)`, and spawns the object at that cell-relative location.

Note the cell reads **`insurance`** — the exact cell name the client's `[cellAtPos]` probe reported
at that position (`cell=insurance building=1106500`). Client probe and server datatable agree
independently.

**So the object can be MOVED live with the gizmo, but nothing client-side owns its position** —
`decorationPersist` refuses with *"could not resolve picked … in any cell"*, which is **correct**:
there is no `.ilf` row to rewrite, and the server restores it.

## Why this is cheaper than it looks — both halves already exist

- **The editor:** the DTII grid editor (Phase 05) already edits `.iff` datatables.
- **The push:** swg-main server push (Phase 04.4) already writes to the server and is proven.

**No server-side instrumentation is needed.** This is files plus a push — not a live-memory story.

## Open questions to settle BEFORE designing the flow

1. **`.tab` is source, not what the server reads.** The script references
   `datatables/structure/municipal/cloning_facility_terminal.iff` — the compiled form. Either the
   toolkit edits the compiled `.iff` directly (which is what the DTII editor already does), or a
   `dsrc` build step is involved. Confirm which.
2. **A reload is probably not sufficient on its own.** `reloadTable`/`reloadDataTable` exist in the
   server's console command parsers (`ConsoleCommandParserServer.cpp`, `CentralCommandParserGame.cpp`),
   so the TABLE can be refreshed live — but terminals spawn from `OnInitialize` →
   `handleTerminalSpawning`, so objects already in the world are persisted and will not move
   themselves. Likely needs destroying the existing objects and letting them respawn, or a restart.
   **Empirical — test it, do not assume.**
3. **Scope.** Is this only structure terminals, or the general class (vendors, mission NPCs, static
   spawns)? The datatable shape differs per family; a general solution needs a per-family mapping.

## ⚠ This class CANNOT join the unified "editor picks the route" model

[[exterior-ws-node-editing]]'s design intent — *"the buttons work the same no matter if you are
inside or outside; the editor will put it in the right containers behind the scenes"* — holds for
classes 1 and 2. Both are client-side and both end in `wsSaveSnapshot`.

**Class 3 is a different pipeline with different lifetime and deploy semantics** (server data, a
push, probably a restart, and it affects EVERY player on that server rather than one client's view).
Hiding it behind the same button would promise a persistence the toolkit cannot deliver against a
live server.

## Recommended interim, before any of this is built

Give class 3 an **honest refusal naming the reason** — e.g. *"this object is spawned by the server;
moving it permanently means editing server data"* — rather than the current generic
*"could not resolve picked … in any cell"*, which reads as a toolkit failure when it is correct
behaviour. That is the same lesson as the reporting defects found on 2026-08-06/07: the refusals
were all right; only their reporting was broken.

Detecting the class cheaply is plausible: if the picked object is not in the building's `.ilf` AND
has a NetworkId (server-owned objects get one; `.ilf`-created objects never do — the disjointness
`wsForgetNode` already relies on), it is almost certainly server-spawned.

## Priority

**Low relative to class 2.** Tatooine's snapshot alone holds 15,808 `.ws` node records, so exterior
editing is the common case by a wide margin; class 3 is a narrow set of functional objects
(terminals, vendors, mission NPCs) that a decorator rarely wants to move. Cheapness is not a reason
to reorder ahead of it.
