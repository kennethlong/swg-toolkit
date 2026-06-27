---
sketch: 008
name: shell-composition
question: "Does the FINAL 006-D Deploy tab read right inside the real 001 workspace shell — and does the Inspect | Deploy tab group cohere with the rest of the workspace, including at narrow dock width?"
winner: "A + B (composition coheres; Deploy goes wide ~440px — not narrow C)"
tags: [layout, shell, composition, deploy, inspector, consistency, phase-4]
---

# Sketch 008: Shell Composition

## ✅ Decision — A + B (compose works; Deploy goes wide)

The composition **coheres** — the 006-D Deploy tab reads as a native part of the 001 shell, and the
`Inspect | Deploy` two-tab right-dock group reads clearly as one group. Confirmed:

- **A (Inspect active)** and **B (Deploy active)** are both good — flipping between the two tabs is the
  intended interaction, and the whole page holds together.
- **Deploy uses the WIDE dock (~440px, B), not narrow (C).** Narrow was only the stress test; wide
  reads better, so the dock **auto-widens when Deploy activates**.

Carries into UI-SPEC.md: right dock = one `Inspect | Deploy` tab group; Deploy = one `DeployPanel`
(collapsible *Working changes* + splitter + *Version history* + sticky Deploy…); the inspector group
defaults wider (~440px) while Deploy is active.

## Design Question

Sketches 002–006 were all **standalone panels** — they have NEVER been composed into the full
workspace. 006-D picked the winning **Deploy panel** (one component: collapsible *Working changes* +
resizable splitter + collapsible *Version history* + sticky Deploy… button). This sketch is the
**coherence / consistency check**: drop that finished Deploy panel into the **right dock of the real
001 shell** and see whether the whole page reads as one app.

Critically, the right dock is **one tab GROUP with exactly two tabs — `Inspect` and `Deploy`** — and
the Deploy tab is **one `DeployPanel`** (stacked collapsible child sections), *not* separate
Staging / Changesets / VCS dockview tabs. (That was the spec-consistency mistake 006 had to undo.)

## How to View

Open `index.html` in a browser (links `../themes/cyan.css`). Use the top variant-nav to switch A/B/C.
All three are the **same full shell**; they differ only in the right-dock state.

Interactions are live: switch the `Inspect | Deploy` tabs (Deploy auto-widens the dock except in C);
collapse the *Working changes* / *Version history* sections; drag the splitter; expand a version row
(▸) to see its changeset's files; right-click or click `⋯` on a staged row for the context menu;
click **Deploy v4…** to open the 003-A modal. Sketch toolbar (bottom-right): theme picker,
**dock: wide ⇄ narrow** stress toggle, and **annotate**.

## Variants

- **A · Inspect active (default editing state)** — Right dock = `[Inspect ●] [Deploy]` with **Inspect**
  active, showing the 001 inspector accordions (Transform / Mesh / Material) for the selected asset.
  Deploy tab present but inactive. Dock at default **~290px**. This is the normal, non-deploy workspace.

- **B · Deploy active, dock widened (~440px) ★** — Click `Deploy` → it activates and the dock
  **widens to ~440px** (decision: "the inspector group defaults wider when Deploy is active"). Content
  is the faithful **006-D DeployPanel**: *Working changes* (5 rows — `tt8l_y7.sat` ~modify,
  `stormtrooper_armor.dds` ~modify, `weapon.iff` ~modify but ○ identical-to-base, `old_emitter.apt`
  ⊘ delete/tombstone, `new_blaster_l0.msh` ＋ add) → splitter → *Version history* (v1→v2 [⤓ live/
  deployed]→v3, branch v4 [● active]; dashed **Baseline (pristine)** root) → sticky **Deploy v4…**.

- **C · Deploy active, narrow (~300px stress test)** — Same as B but the dock **stays at ~300px** to
  stress-test legibility (the 005-A concern): paths/labels truncate with ellipsis, sizes drop, and the
  two per-row actions collapse to a **single `⋯` overflow**. Width is locked here (Deploy does not
  auto-widen) so you can judge whether the composed panel survives tight real-estate.

## What to Look For

- **Whole-page coherence:** does the Deploy tab read as a native part of the workspace, or as a bolted-on
  panel? Tab chrome, headers, badges, and the sticky footer should feel of-a-piece with the tree /
  viewport / datatable.
- **Tab-group legibility:** is it obvious that `Inspect` and `Deploy` are two tabs of **one** right-dock
  group (not a new region)? Does flipping between them feel natural — and does the auto-widen on Deploy
  help or jar?
- **Deploy-at-narrow (C):** at ~300px do the staging rows + version graph stay usable — ellipsis truncation,
  `⋯` overflow, the dashed Baseline node, the expandable changeset files? Or does it break down and argue
  the dock should always widen for Deploy?
- **Accessibility cues survive composition:** action/state are glyph + border/bg + label, never color alone —
  deploy badges (`~ modify` / `＋ add` / `⊘ delete`), changed/identical dots (● filled vs ○ hollow +
  "identical to base"), and `● active` / `⤓ live · deployed` / dashed `baseline` pips.
- **Vertical budget:** with titlebar + bottom dock + statusbar eating height, does the splitter give enough
  room to both *Working changes* and *Version history*, or does one section want to be collapsed by default?
