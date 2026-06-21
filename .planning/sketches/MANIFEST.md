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

## Proposed follow-ups (not yet built)
- **002 docking affordances** — drag preview, live 5-way drop zones, split/merge feel (interaction, not static layout).
- **003 panel chrome & density** — header/tab/accordion treatment, number-drag fields, hit targets at real density.
