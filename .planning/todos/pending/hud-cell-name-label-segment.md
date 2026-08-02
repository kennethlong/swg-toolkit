---
created: 2026-08-02
resolves_phase: 5.2
source: 05.1-05 live checkpoint — maintainer APPROVED shipping the two-segment label, fix deferred
depends_on: provider cell-name shim (change request filed by 05.1-15)
---

# HUD strip: restore the cell segment (and friendlier building name) to the 020-A label

**Approved to ship as-is in 05.1** (maintainer, 2026-08-02). This is the deferred remainder, targeted
at **Phase 5.2**, whose SC5 already retrofits the sketch-021 decoration flow as the first
engine-hosted flow and whose SC2 asset-discovery resolver is adjacent to friendly-name derivation.

## The gap

Sketch 020-A specifies three segments:

```
Cantina Table · alcove1 · Cantina (Mos Eisley)
   decoration     cell        building
```

Shipped in 05.1-05:

```
Cantina Table · Cantina Tatooine
   decoration       building
```

## Two distinct causes — do not conflate them

**1. Cell segment — genuinely unresolvable client-side today.** All 150 rows of the client's
advertised catalog were checked (`engine_hookpoints.inc`, contract v26): `object::getParentCell`
returns the cell *object* and `objectTemplate::getPortalLayoutFilename` returns the `.pob` path, but
**nothing returns a cell NAME string**. Needs a provider shim — same pattern as
`object::getContainingBuildingId` (v25). **05.1-15 files that change request**; this todo is the
consumer side and is blocked on the handback.

**2. Building name is a prettified template path, not a display name.** `prettifyTemplateLabel()` in
`overlay.cpp` does: strip dir → drop `shared_` → drop `.iff` → underscores to spaces → title case.
So `shared_cantina_tatooine.iff` → `Cantina Tatooine`. The sketch's `Cantina (Mos Eisley)` is a
display name absent from the template path entirely.

Note the asymmetry: the **World panel already does better** — 05.1-04 derives building labels from the
`.iff`'s own `FORM SBOT → FORM DERV → leaf` chain (verified against a real
`shared_cantina_tatooine.iff` on disk that session). That is host-side code with VFS access. The x86
agent DLL injected into the game process has neither, which is why the two surfaces disagree.

## Why it was acceptable to ship

- The strip is a **point-at-the-world** surface — you are looking directly at the hovered object, so
  "which room" is visually obvious on screen.
- D-12's boundary rule puts rows/fields/text in the World panel and keeps the overlay minimal; the
  World panel can and does show better names.
- Blocking a 16-plan phase on a cosmetic label requiring an external round trip is poor value.

## Where it actually bites (the real motivation to fix)

In a multi-room POB — e.g. the player house in the 05.1-05 session with `hall3`, `bedroom3`,
`kitchen`, `elevator1`, `livingroom1`, `foyer1` — **two identical chairs in two different rooms
produce an identical strip label**. The cell name is the only disambiguator.

## Implementation when unblocked

1. Bind the provider's cell-name row in `packages/live-inject/agent/rva_table.cpp` (one line; lights
   up on restage, binding is by NAME — see [[swg-client-v2-advertised-hooks]]).
2. Add the middle segment in `buildStripLabel()` (`overlay.cpp`), omitting it when the resolver is
   null so pre-shim clients degrade to today's two-segment form rather than showing an empty `·`.
3. Consider routing building display names through the same `.iff` DERV derivation the World panel
   uses — likely via 5.2's asset-discovery resolver rather than duplicating it in the agent.

Sketch contract: `.planning/sketches/020-overlay-decoration-hud/index.html` (Variant A).
Related: [[feedback-sketches-are-ui-source-of-truth]].
