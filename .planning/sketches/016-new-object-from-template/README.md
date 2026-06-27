---
sketch: 016
name: new-object-from-template
question: "How does a modder create a new object — pick the engine item type, derive a new instance via @base, name + place it, optionally scaffold the Core3 server template, then hand off to the IFF editor — without ever authoring a new type?"
winner: "A (Type-grid wizard modal)"
tags: [object-templates, creation, derivation, item-types, core3, phase-4, phase-8]
---

# Sketch 016 — New Object from Template

## ✅ Decision — A (Type-grid wizard modal)

The 4-step modal wizard wins: **pick item type** (grid of the fixed engine `Shared*ObjectTemplate`
set) → **derive** (clone an existing template vs start from the base type, with the live `@base`
derivation chain shown) → **name & path** → **sides** (Client `.iff` always; Server / Core3 template
gated on a bound local server), then **Create & open in editor** hands off to the IFF editor (009).
It makes the **type-vs-instance** rule unmissable — you always pick a known type and derive an
instance, never author a new type. (B's inline derived-properties preview and C's right-click
"Duplicate as new object…" are good follow-on affordances to fold in, but the wizard is the canonical
entry.) Carries into UI-SPEC.md; ties to 007's project/server binding and 009's editor handoff.

## Design Question
A modder never invents a new item **type** — the type universe is a fixed, engine-defined set
(`Shared*ObjectTemplate`, compiled into client + server). They create a new **instance** that
**derives** from an existing template via an `@base` chain. How should the toolkit surface that:
pick a known type, set `@base`, name + place the new `.iff`, optionally scaffold the server-side
(Core3) Lua template, then hand off to the IFF editor (sketch 009)? The crux is making
**type vs instance** legible.

## How to View
Open `index.html` in a browser (links `../themes/cyan.css`). Use the variant-nav tabs (A/B/C). The
bottom-right toolbar switches theme, toggles annotate, and flips **server: bound ⇄ none** to show how
the Server-template side is gated on a bound local server (tie-in to sketch 007).

## Variants
- **A · Type-grid wizard (modal)** — reuses 007's wizard modal. 4 steps: pick item type from a grid of
  type cards (engine class + `object/…/` prefix) → derive (clone existing `shared_pistol_dl44.iff` vs
  base type template) with a live derivation chain → name & path → scaffold sides (Client always +
  Server gated). Footer hands off to the IFF editor.
- **B · Inline New-Object panel** — same flow as a dedicated panel (no modal): type list down the left,
  derivation + name/path + sides on the right, plus a live **derived-properties preview** showing
  type-specific fields tagged inherited `○` vs overridden `●`. For power users creating many objects.
- **C · Derive-from-selected (context action)** — the real 80% case: right-click
  `shared_pistol_dl44.iff` → **Duplicate as new object…** opens a compact dialog pre-filled with the
  source as `@base`, type auto-detected (read-only chip). User only sets name + path + sides.

## What to Look For
- **Type-grid wizard vs inline panel vs derive-from-selected** — which entry point fits which user?
  Wizard for first-timers, inline panel for bulk power-use, context-duplicate for clone-and-tweak.
- **Does type-vs-instance read clearly?** Every variant shows the closed engine type set as harvested,
  not editable, plus an explainer ("Types come from the engine — pick one and derive a new instance").
  Nowhere can you author a new type.
- **Is the `@base` derivation chain legible?** `new ▸ @base shared_pistol_dl44.iff ▸
  shared_base_weapon.iff ▸ SharedWeaponObjectTemplate` is rendered live in all three variants.
- **Client + server scaffolding** — Client `.iff` is always created; the Core3 Lua server template is
  optional and gated on a bound local server (flip the toolbar toggle to see it disable with a hint).
- **The clone-and-tweak common path** — variant C makes duplicating an existing template (type
  auto-detected from source) the fastest route, matching how modders actually work.
