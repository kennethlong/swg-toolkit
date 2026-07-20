# Change request (→ swg-client-v2 session): `worldSnapshot::wsSetNodeTemplateName` (in-place `.ws` node template swap)

**Date:** 2026-07-19 · **From:** SWG-Toolkit live-editor session · **To:** swg-client-v2 (advertised catalog owner).
**Priority:** the ONE row that makes per-instance interior-decoration persistence (model D) lossless. **Motivated
by a CONSULT-70 adversarial finding — full analysis in `SWG-Toolkit/.planning/research/CONSULT-70-SYNTHESIS.md`
(+ `...-opus.out`).**

## Why (the data-loss defect this fixes)

Model (D) — per-instance interior editing via a DERV building template (overriding only `interiorLayoutFileName`)
+ an edited `.ilf`, both loose — is validated sound EXCEPT the "rebind the instance" step. The obvious mechanism
(`wsRemoveNode(building)` → `wsAddObject(derivedName)`) is **data-lossy**: `wsRemoveNode` tombstones the node's
ENTIRE subtree (cells + **every authored `.ws` object inside them**), and `wsAddObject` re-adds the POB with
freshly-created EMPTY cells + a NEW id, with no channel for the original in-cell content. The demonstrated Mos
Eisley cantina HAS authored in-cell `.ws` content (your Wave-3 provenance note, `WorldSnapshot.cpp:2494-2501`),
so a rebind would **permanently drop the ceiling fixtures/lights/fan on reload** and churn the building id.

## What's needed

An in-place template-name setter so a `.ws` building node can be re-pointed at the derived template **without
touching its subtree or id**:

```c
// Re-point an existing .ws node to a new object-template NAME in place. Interns the name in
// the snapshot's OTNL string table (the addObject intern path already exists,
// WorldSnapshotReaderWriter.cpp:913-923) and setObjectTemplateNameIndex on the node. Does NOT
// touch cells, children, id, or transform. Caller follows with wsSaveSnapshot.
// Returns: 1 ok / 0 miss (no such authored node) / -1 refused (buildout/tombstone/not name-swappable).
extern "C" int __cdecl utinni_wsSetNodeTemplateName(__int64 id, const char* name);
```

~10 lines over existing machinery. Semantics: authored `.ws` nodes only (mirror `wsRemoveNode`'s buildout
refusal); the derived name need not be CRC-registered (`.ws` is name-keyed); the spawn-time `portalLayoutCrc`
check still applies, so the toolkit guarantees the derived template inherits (never overrides) `.pob` → crc
unchanged. No occupancy despawn needed for the swap itself (the live `.ilf` re-apply on reload handles the visual).

## Consumer side (ready to wire on landing)

Toolkit binds `worldSnapshot::wsSetNodeTemplateName` by name in `rva_table.cpp` (1 line); the editor mints the
derived `.iff` + edited `.ilf` (both pure-consumer per CONSULT-70), calls set-name + `wsSaveSnapshot`, and stages
all three as one changeset through the deploy pipeline. This single row keeps (D) the cheapest correct model
(< the sidecar's ~4 rows).

## Nice-to-have (secondary, only if not derivable consumer-side)

A read-only resolver mapping a picked interior `Object*` → its `(cellName, rowIndex-in-cell)` so the editor knows
WHICH `.ilf` entry to patch. Flagged by CONSULT-70 (Cursor) as a resolver, not a writer — spec on request if the
toolkit can't derive it from the object's parent cell + spawn order.
