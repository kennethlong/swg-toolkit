---
sketch: 001
name: workspace-shell
question: "Does the dark DCC-style dockable shell + panel chrome feel right for the SWG Toolkit?"
winner: "A"
accent: cyan
tags: [layout, shell, docking, dark-theme, accessibility, phase-0]
---

# Sketch 001: Workspace Shell

## ✅ Decision
- **Layout: Variant A — Classic Editor Regions** (always-visible sidebar · viewport · inspector · bottom data pane).
- **Accent: Hologram cyan** — set as the active default.
- **Theme is a first-class, user-selectable setting (accessibility), not a hardcoded brand color.**
  The accent picker now lives **in the app titlebar** (not just sketch tooling), and the theme list
  includes a **High contrast** option (`themes/high-contrast.css`). Rationale: users with color-vision
  deficiency or low vision can choose an accent/contrast that works for them; cyan was chosen partly
  because it stays distinguishable under red-green CVD where the SWG-green accent does not. State cues
  (selected row, active tab, tree selection) use **borders/underlines + background, never color alone.**
  → This carries into UI-SPEC.md as a theming/accessibility requirement.

## Design Question
Does a dark, Blender-style 3D-DCC dockable workspace feel right as the Phase 0 app shell —
and which docking *structure* do we commit to? Three structures are explored; the dark theme,
panel chrome (drag handles, tabs, split/collapse), and SWG-green identity are shared across all.

## How to View
open .planning/sketches/001-workspace-shell/index.html

(Just open the file in a browser — no build step.)

## Variants
- **A: Classic Editor Regions** — fixed 4-region layout (asset tree · viewport · inspector · bottom data
  pane). Each region is one dock panel. Most legible, most "Blender/Maya editor". Closest to the
  CONTEXT.md description (sidebar / 3D canvas / data pane / inspector).
- **B: Tabbed Dock-Groups** — same regions, but each is a *tab group* (Assets+Archives+Outliner,
  Viewport+UV, Inspector+Properties, Datatable+Console). Leans into the dockview metaphor — many
  tabs, drag-to-rearrange, 5-way drop zones. Best matches how dockview actually wants to be used.
- **C: Compact / Edge-Overlay** — VS Code-style activity rail + thin collapsible left panel + an
  edge-to-edge viewport + a *slide-over* inspector and an expandable bottom strip. Maximizes the 3D
  canvas; chrome gets out of the way. Most screen for the viewport, least always-on context.

## Try the interactions
- Switch variants with the top bar (A / B / C).
- **Accent switcher** (bottom-right toolbar): SWG green ↔ Amber ↔ Cyan ↔ IDE blue — feel the identity.
- **"docking demo"** toolbar button: overlays the dockview-style **5-way drop zones** (center=tab,
  edges=split) on the viewport — this is the affordance that proves the docking model.
- **"annotate"**: outlines each panel and labels its role.
- Expand/collapse tree folders; click an asset → the **Inspector + status bar update**.
- Click bottom panel tabs (Datatable / Console / Log); collapse panels with ▾.
- In **C**: click the activity-rail icons to toggle the left panel, the slide-over inspector, and the
  expandable bottom data strip.

## What to Look For
- **Density & chrome weight** — does the compact DCC spacing feel right, or too tight / too heavy?
- **Docking structure** — do you want explicit always-visible regions (A), a tab-group-everywhere
  model (B), or a minimal-chrome viewport-first layout (C)? This is the real decision.
- **SWG-green identity** — does green read well as the accent on the gray panels, or does another
  accent (amber/cyan) feel more "us"? (You can cherry-pick: e.g. B's structure + amber accent.)
- **Phase-0 fit** — the status bar / console deliberately surface the wiring proof
  (`crossOriginIsolated: true`, utility-process addon, SAB @ 60 fps) so the shell shows the de-risk
  story, not just chrome.
