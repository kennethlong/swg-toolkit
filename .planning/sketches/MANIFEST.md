# Sketch Manifest

## Design Direction
A dark, **Blender-style 3D-DCC** workspace: gray panels with hard separators, compact density,
rounded widgets, collapsible property accordions, and drag-to-dock panels (dockview). Identity
accent is **SWG green** (with amber / cyan / IDE-blue offered as switchable themes). The shell must
read as a serious modding/3D tool — the successor to Sytner's IFF Editor and Utinni — while quietly
surfacing the Phase 0 wiring proof (utility-process native addon, `crossOriginIsolated: true`,
SharedArrayBuffer @ 60fps) in its status bar and console.

## Reference Points
- Blender (3D DCC editor layout, property accordions, gray panel chrome) — chosen aesthetic
- VS Code (activity rail, tab groups, drop-zone docking) — informs the compact variant
- dockview (the actual docking library; toJSON/fromJSON layout persistence)
- Sytner's IFF Editor / Utinni (predecessor tools this replaces)

## Theme System
**Theming is a first-class, user-selectable feature (accent + contrast) for accessibility — not a
hardcoded brand color.** Exposed via an in-app titlebar picker.
- `themes/cyan.css` — hologram cyan **(active default — chosen accent; CVD-distinguishable)**
- `themes/default.css` — SWG green
- `themes/amber.css` — Star Wars amber/gold
- `themes/blue.css` — neutral IDE blue
- `themes/high-contrast.css` — **accessibility:** visible borders, white text, bright accent, thick focus rings

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | workspace-shell | Does the dark DCC-style dockable shell + chrome feel right, and which docking structure (regions / tab-groups / compact)? | **A · Classic Regions (cyan)** | layout, shell, docking, dark-theme, accessibility, phase-0 |
| 002 | version-graph-timeline | How to visualize branching version history + active-vs-deployed state + revert/deploy/branch affordances inside a dockview panel? | **A · Git-Graph Lanes** | versioning, graph, branching, deploy, history, phase-4 |
| 003 | deploy-dialog | How does the deploy flow read — client picker + model radios + cfg slot preview + build/activate progress + success/error? | **A · Single-Column Stepper (modal)** | deploy, modal, dialog, cfg, progress, error-states, phase-4 |
| 004 | staging-panel | How does the "add to patch" staging list read, and how does "save a set of changes → new version" surface? | **B · Working-vs-Saved Split** | staging, patch, versioning, save-version, list, phase-4 |
| 005 | deploy-inspect-tab | Does staging + version-graph + deploy fit inside the Inspect panel as a `Deploy` tab at dock width? | **B · Widened (~480px)** | layout, tabs, inspector, composition, phase-4 |

## Layout decision (from 002–005)

The Phase-4 deploy UI lives **inside the Inspect panel as a tabbed group** (`Inspect` | `Deploy`), NOT as separate dock regions. The **`Deploy` tab** stacks **Staging (004-B)** over the **Version graph (002-A)** with a **`Deploy…` button**. The **deploy dialog (003-A) is a modal** — it overlays the app and costs no panel space, which is what makes the composition fit. **005 confirmed (winner B):** the combined Deploy tab needs **~380px+ width** to read comfortably — ~300px is functional but cramped (labels clip, row-actions collapse to a `⋯` overflow). So the inspector panel should **default wider (~380–480px) when the Deploy tab is active**, and it stays resizable/floatable for working the history. Plan impact: register Staging + Timeline as tabs in the inspector group (an `addPanel` position tweak in 04-02 / 04-04b), not standalone panels; set the inspector group's default width to ~380px.

## Proposed follow-ups

> **Note:** The original "002 docking affordances" / "003 panel chrome & density" ideas are **superseded** by the Phase-4 sketches above. They remain open but deprioritized; renumbered 006+ to avoid colliding with 005 (deploy-inspect-tab).

- **006 docking affordances** — drag preview, live 5-way drop zones, split/merge feel (interaction, not static layout).
- **007 panel chrome & density** — header/tab/accordion treatment, number-drag fields, hit targets at real density.
