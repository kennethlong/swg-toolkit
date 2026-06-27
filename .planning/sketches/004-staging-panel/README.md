---
sketch: 004
name: staging-panel
question: How does the "add to patch" staging list read, and how does "save a set of changes → new version" surface?
winner: "B"  # Working-vs-saved split — clearest working-set → version step
tags: [staging, patch, versioning, save-version, list, phase-4]
---

# Sketch 004 — Staging Panel

## Design Question

How does the "add to patch" staging list read, and how does "save a set of changes → new version" feel? Specifically: where does the "name and save this version" affordance live relative to the list, and how do per-row actions (remove, relink) surface?

## How to View

Open `index.html` directly in a browser. No build step, no server needed.

Click rows to select them. Hover rows to see the remove (×) control. In Variant A, hover the "● uncommitted — Save version…" link to open the label popover. Variant C's ⋯ dropdown is demo-open on row 3.

## Scenario Data

Five staged entries (the spec's required set):

| Virtual path | Action | Source |
|---|---|---|
| `appearance/tt8l_y7.sat` | Modify (`~`) | tt8l_y7.sat · 18 kB |
| `texture/stormtrooper_armor.dds` | Modify (`~`) | stormtrooper_armor.dds · 512 kB |
| `datatables/weapon/weapon.iff` | Modify (`~`) | weapon.iff · 42 kB |
| `appearance/old_emitter.apt` | Delete / tombstone (`⊘`) | (tombstone — length-0) |
| `appearance/new_blaster_l0.msh` | Add (`+`) | new_blaster_l0.msh · 96 kB |

Footer summary: 5 staged · 1 add · 2 modify · 1 delete · 668 kB total.

Active version context: based on v4 "Alt: heavier blaster" (branched from v2).

## Variants

| Variant | Label | Description |
|---------|-------|-------------|
| A | List + Footer Save Bar | Virtualized rows (ROW_HEIGHT=30, per spec). Action badge (+ add / ~ modify / ⊘ delete) triple-encodes glyph+color+label. Hover → × remove. Footer: summary counts + "● uncommitted — Save version…" opens an inline popover label field. Pack Patch + Deploy… in the panel head. |
| B | Working-vs-Saved Split | Two sub-lists divided by a section divider: top = uncommitted working changes (full opacity), bottom = entries already committed into the active version (v4, dimmed). "Save version…" button promotes working changes → new version and is visible at the top of the working section. |
| C | Inline Compose Banner | A top banner anchors the version label input field always-visible when uncommitted changes exist ("5 unsaved changes — name & save this version" + inline text input + Save). Per-row ⋯ dropdown replaces the × control — exposes Change action + Relink + Remove. |

## What to Look For

- Does the **footer save bar** (A) feel like a natural place to name a version, or does it get lost at the bottom of the list?
- Does the **working-vs-saved split** (B) help users understand the "staged changes that will deploy" vs. "changes locked into the current version" mental model?
- Does the **inline compose banner** (C) make the label-and-save act feel lower-friction (always one tab-stop away), or does it feel intrusive / always-visible noise?
- **Action badge legibility:** at ROW_HEIGHT=30 and `--text-xs`, do the three badge types (+ add / ~ modify / ⊘ delete) read clearly enough at a glance?
- Does showing the tombstone differently (`⊘ delete (tombstone)` + warm color on the source column) make it clear that this entry hides a retail file rather than deleting anything on disk?
- **Remove affordance:** does hover-to-reveal `×` (A/B) feel discoverable enough, or is the ⋯ dropdown (C) more predictable?
