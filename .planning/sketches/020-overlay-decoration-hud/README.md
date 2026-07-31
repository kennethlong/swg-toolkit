---
sketch: 020
name: overlay-decoration-hud
question: "What is the productized in-game overlay for decoration editing — thin pick+gizmo+persist, replacing the CONSULT-69 debug probe?"
winner: "A"
tags: [overlay, imgui, live-editor, hud, in-game, decoration-persist, model-d]
---

# Sketch 020: In-Game Decoration HUD

## Design Question

The in-game half of the boundary rule ("point at the world" = overlay). The CONSULT-69 debug
probe (raw pointers, latch buttons, result codes) becomes a product surface: hover-pick +
gizmo + Arm/Persist + a status readout — and deliberately nothing else. Rows/fields/text
live in the app's World panel (sketch 019).

Mocked over a fake in-game cantina backdrop with ImGui-style chrome (the overlay renders
inside the game on the game's D3D device — it is NOT themed by the app; the cyan is shared
identity, not shared CSS).

## How to View

open .planning/sketches/020-overlay-decoration-hud/index.html

## Variants

- **A: Status Strip** — one thin top-center strip; hotkey-driven (F arm, G/R move/rotate); state-cycle buttons below the frame let you feel idle/hover/armed/saved/failed.
- **B: Compact Card** — small right-edge card with pick context (cell/row/building), delta readout, Persist/Cancel, and a words-not-codes status line; collapses to its title bar.
- **C: Contextual Callout** — a label anchored to the picked object with Arm/Persist actions; results as a transient bottom toast; zero fixed chrome.

## What to Look For

- Thin-ness: which one disappears best while still telling you what's armed and what happened?
- The failure state (variant A's "failed" cycle): "rebind refused — derived template missing (see World panel)" — is punting detail to the app panel the right call?
- Does the delta readout (cell-space Δ) belong in-game (A/B) or is it app-panel material?
- Hotkeys vs buttons: A leans keys, C leans clicks — which matches in-game editing flow?
