---
sketch: 019
name: world-editor-panel
question: "How does the World Editor app panel compose — what's the spine of the 'rows/fields/text' surface for in-world edits?"
winner: "A"
tags: [world-editor, live-editor, decoration-persist, panel, composition, model-d]
---

# Sketch 019: World Editor Panel

## Design Question

The model-D decoration-persist pipeline is built and proven; the app-side surface for it is a
debug probe. What is the **information architecture** of the real World Editor panel — the
dockview tab (`Inspect | Deploy | World`) that owns everything "rows/fields/text" about
in-world editing (boundary rule: point-at-the-world = overlay, rows/fields/text = app)?

All variants carry the same required elements (from the productize contract):
per-building edited-decoration list · persist history · mirror-mode toggle with scope hint ·
human-readable rebind/save feedback (never raw codes) · editor-scene launcher + teleport
bookmarks · "+ Add decoration…" entry (spawn flow = sketch 021) · live-session strip.

## How to View

open .planning/sketches/019-world-editor-panel/index.html

## Variants

- **A: Building Tree** — buildings own the hierarchy; decorations nest under their building; detail card for the selection; Activity/Scene as collapsed accordions.
- **B: Session Timeline** — the persist history is the spine (commit-log feel); buildings are chips on events; filters (All/Saved/Pending/Failed); selected-event detail below.
- **C: Live / Persisted Split** — top section mirrors the overlay's live state (hover/armed/delta + Persist from the app); bottom is the flat persisted-edits list.

## What to Look For

- Which spine matches how you actually work — by *place* (A), by *history* (B), or by *session* (C)?
- Does the mirror toggle's scope hint read clearly (per-template vs per-instance)?
- Are the human-readable status lines right ("building wasn't in the loaded snapshot" vs code -1)?
- Is the live strip (attached exe · scene chip · editor-scene state) the right amount of session info?
- Real data everywhere: node 1082874, alcove1 row 3, edit_1082874.ilf — the shapes the pipeline actually produces.
