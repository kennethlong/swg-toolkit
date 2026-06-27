---
sketch: 010
name: inspector-properties
question: "What do the Blender-style property accordions actually contain for a real SWG asset (mesh, material/shaders, skeleton, animation), and how should they be laid out in the right-dock Inspect tab?"
winner: "C (Hybrid — pinned stat-chip summary + key groups open by default)"
tags: [inspector, properties, accordion, material, skeleton, phase-5]
---

# Sketch 010 · Inspector Properties

## ✅ Decision — C (Hybrid)

A pinned **stat-chip summary header** (verts / tris / LOD / shaders / bones + bind-pose badge) with
**Transform + Materials open by default** and the rest collapsed wins: the key facts are visible at a
glance (no scrolling to confirm bind pose or counts) without B's per-group click-cost or A's long
scroll. Materials renders each shader as a nested card with a diffuse / normal / spec texture
mini-grid. Carries into UI-SPEC.md as the Inspect-tab layout — resolves the 001 stub and pairs with
the 008 `Inspect | Deploy` dock group.

## Design Question
The workspace shell (sketch 001) leaves the right-dock **Inspect** tab as a stub — a few
Transform / Mesh / Material rows — while its **Deploy** sibling is fully designed. This sketch fills
that gap: what does a *fully-populated* inspector look like for a real skinned-mesh asset, and which
layout pattern carries it best? It feeds the Phase-5 typed editors.

Sample asset: **player_human_male.mgn** — Skinned Mesh (MGN), 12,044 verts · 8,510 tris, 4 LODs,
1 UV set, bounding r 1.12; 2 shaders; skeleton `appearance/skeleton/all_b.skt` (74 bones, bind pose
loaded); clips stand / walk / run / combat_idle. Content is grounded in the project's verified
material pipeline (MATL → CSHD-wraps-SSHT, DXT/RGBA8, normal-map BGRA tangent-space) and skeleton
facts — not fabricated tags. (Per-LOD vertex counts are illustrative mock numbers.)

## How to View
Open `index.html` in a browser (no build step). Use the top variant-nav to switch A / B / C.
Bottom-right sketch toolbar: **theme** picker, **⇆ dock** width toggle (300px ⇄ 440px — feel the
density at both real dock widths), **annotate** outlines. Accordions expand/collapse; in B the
group sub-tabs switch panes; the collapse ▾ folds the whole panel.

## Variants
- **A · Accordion stack** (path of least resistance — the 001 pattern, fully populated). Pinned
  name/type header, then every group as a collapsible accordion in one scroll:
  Transform → Mesh (with per-LOD list) → Materials/Shaders (per-shader cards) → Skeleton → Animation.
- **B · Tabbed groups.** Same content, but the property groups are sub-tabs in the panel head
  (`Transform | Mesh | Material | Skeleton | Anim`) — one group visible at a time, no long scroll,
  more clicks. Pinned identity header sits above the panes.
- **C · Hybrid.** Pinned summary header with stat-chips (verts/tris/LOD/shaders/bones + bind-pose
  badge) + Transform and Materials **open by default**, the rest collapsed. Materials renders each
  shader as a nested card with a diffuse / normal / specular texture-slot mini-grid.

## What to Look For
- **Accordion-scroll (A) vs tabbed-groups (B) vs hybrid (C):** does the single long scroll feel
  navigable, or is a tab/summary split worth the extra clicks? Which gets you to "is the bind pose
  loaded?" fastest?
- **Per-shader card legibility:** is the CSHD→SSHT chain + the diffuse/normal/spec swatch grid clear,
  and does the `⚠ BGRA tangent-space` note land without being noise?
- **Density at 300 vs 440px:** toggle the dock width — does the 3-up texture grid hold at 300px, do
  the kv rows and LOD list stay readable, or does anything truncate badly?
- **Does the skeleton/bind-pose info read** as status (glyph + bordered badge + label, not colour
  alone), and is "74 bones / attach root / all_b.skt" legible at a glance?
- **Pinned header value:** does C's stat-chip summary make the collapsed groups feel safe to leave
  closed, vs A where you scroll to confirm the same numbers?
