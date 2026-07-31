---
sketch: 021
name: spawn-decoration-flow
question: "How does adding a NEW decoration flow across the two surfaces — app template browser → in-game placement → persisted row?"
winner: "A"
tags: [world-editor, spawn, wsAddObject, template-browser, cross-surface, model-d, leads-plumbing]
---

# Sketch 021: Spawn Decoration Flow

## Design Question

Adding a decoration crosses the boundary rule twice: choosing a template is rows/fields/text
(app), placing it is point-at-the-world (overlay). What's the handoff mechanism?

> ⚠ **UI leads the plumbing:** the "append a NEW row to the `.ilf`" persist path is NOT built —
> today's pipeline only edits existing rows (`wsAddObject` spawns live objects and is proven, but
> the toolkit-side `.ilf` append + row identity for a new node is future work). This sketch is
> the contract for that work, not a mock of something that exists.

## How to View

open .planning/sketches/021-spawn-decoration-flow/index.html

## Variants

- **A: Wizard Modal** — "+ Add decoration…" opens a 016-style picker modal (search + thumbnail grid) → "Place in game" hands a ghost to the overlay → click places → both surfaces confirm (3-step storyboard, click the step pills).
- **B: Palette Dock** — a persistent searchable palette section in the World panel with per-row "Place ▸"; no modal; optimized for decorating a whole room.
- **C: Overlay Quick-Add** — 3–5 recent templates as buttons inside the overlay; "more…" routes to the app browser; lightest chrome, weakest discovery.

## What to Look For

- The handoff moment: does "Place in game ▸" (A) / "Place ▸" (B) / recents (C) feel natural with the game on a second monitor?
- Repeat placement: decorating a room with 12 chairs — A's modal round-trip vs B's persistent palette.
- The ghost + reticle placement strip (shared by all variants): right amount of in-game feedback?
- Frame 3 of A: is the two-surface confirmation (overlay toast + new row in the World list) the right closure?
