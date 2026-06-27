---
sketch: 006
name: combined-deploy-tab
question: "How should staging + version-graph + deploy compose in ONE Deploy tab so both stay usable at dock width — and where do Save version / change badges / per-file actions / the Baseline node land?"
winner: "D"
tags: [layout, deploy, staging, version-graph, composition, phase-4, redesign]
---

> **WINNER: Variant D — Collapsible sections + resizable splitter + expandable per-changeset file
> lists.** Synthesis of C (collapse) + B (splitter, auto-hidden when a section is collapsed). Adds the
> maintainer's new requirement: each version row expands (▸) to list **the changeset's actual changed
> files** (action badge + changed/identical dot + path) — so you see *what's in* a version, not just a
> count. Selecting a version sets the Deploy target. (`combined-deploy-tab` rework, sketch-faithful.)

# Sketch 006: Combined Deploy Tab

## Design Question

Sketch **005-B** already proved the deploy UI fits as ONE `Deploy` tab inside the Inspect panel group
(~380px). But the executor wrongly split it into three separate dockview tabs. This sketch **restores
the approved single combined tab** and resolves the open question 005 flagged — **how to manage the
vertical space** so the working-changes (staging) list and the version graph both stay usable — while
folding in the design decisions captured during Phase-4 UAT.

**This is ONE surface = ONE component** (a `DeployPanel` with stacked sections), NOT separate panels —
honoring the spec-consistency lesson from the 005 divergence post-mortem.

## How to View

open .planning/sketches/006-combined-deploy-tab/index.html

Switch variants in the top bar. Use the toolbar (bottom-right) to swap **theme** and toggle **width**
(380px ↔ 300px narrow stress). Right-click a staging row (or click ⋯) for the per-file menu; hover a
version row for inline Revert/Deploy/Branch; click a version to select it (Deploy targets the selection);
**Deploy…** opens the 003-A modal.

## Variants (all faithful to 005-B; they differ only in vertical-space management)

- **A: Fixed stack** — staging on top → divider → version graph below, all in one scroll; sticky
  Deploy… bar. The path of least resistance / the approved 005-B baseline.
- **B: Resizable splitter** — staging and graph each scroll independently, separated by a **draggable**
  divider so the user balances staging-heavy vs history-heavy work.
- **C: Collapsible sections** — staging and graph are Blender-style **collapsible accordions**; collapse
  one to give the other the room. Directly kills 005's vertical-scroll concern; matches the DCC aesthetic.

## Folded-in decisions (present in all three)

- **Save version** in the staging header (seals a changeset) + **Add…**.
- Per staged row: **changed-vs-base indicator** — `●` green = content differs, `○` faint = *identical to
  base* (a no-op; row dimmed + "identical to base" tag). Footer counts changed vs identical.
- Per staged row: **right-click / ⋯ context menu at TRE-view parity** — Open in editor, Open in viewport,
  Reveal in TRE browser, Compare to base, Remove from staging.
- **Baseline (pristine)** root node in the graph — distinct dashed-square node, "0 deltas · shadow ≡
  source", with "Deploy (reset to stock)".
- **Deploy operates on the SELECTED version** (flatten(active)) — the sticky button names the selected
  version; selecting a version re-materializes staging. The deploy modal reflects the new model
  (absolute-path patch default, cfg snapshot/restore).

## What to Look For

- **Vertical-space feel:** at 380px (and the 300px stress), does the fixed stack scroll too much? Does
  the splitter feel worth the chrome? Do collapsible sections read as obvious, or hide content?
- **Change badge:** is `●/○ changed/identical` legible and useful, or noise? Right treatment for a no-op?
- **Per-file menu:** does right-click + ⋯ parity with the TRE view feel coherent?
- **Baseline node:** does the dashed "pristine" node read clearly as the reset-to-stock anchor?
- **Deploy placement:** bottom-of-graph sticky button — does "deploy the selected version" read right?
