---
sketch: 011
name: viewport-gizmo
question: "How do the viewport HUD + transform gizmo + live-sync state read for Phase 5's headline interaction — drag a gizmo and the object moves in the running game client?"
winner: "B (Full overlay HUD)"
tags: [viewport, gizmo, live-sync, hud, wysiwyg, phase-5, phase-3]
---

# Sketch 011 · Viewport Gizmo + Live-Sync

## ✅ Decision — B (Full overlay HUD)

The persistent full-overlay HUD wins: the top-right **live-sync client card** (Infinity · pid 8841 ·
fps · last sync · COW snapshot), the left-edge **gizmo-mode toolbar** (Move/Rotate/Scale/Universal),
and the bottom **transform readout bar** keep the injection state + numeric transform permanently on
screen — the right call for the Phase-5 WYSIWYG loop where you must always know *what's being written
to the live client*. (A's minimal HUD reads cleaner but hides too much; C's gizmo-focus is a nice
manipulation flourish to fold in, not the base.) Carries into UI-SPEC.md as the viewport HUD layout;
live↔offline state stays glyph + border + label (never color alone), with the file-patch fallback as
a first-class safe mode.

## Design Question
The viewport has only ever been a gray placeholder. This sketch designs the manipulation +
live-sync overlays for the Phase-5 WYSIWYG moment: **drag a transform gizmo and the object moves in
the running game client.** It also has to surface the gated/explicit nature of live memory injection
(Windows-only, `OpenProcess`/`WriteProcessMemory`) and its **Phase-3 file-patch fallback** when not
attached. Three HUD densities are compared: minimal, full-overlay, and gizmo-focused.

## How to View
Open `index.html` in a browser (links `../themes/cyan.css`). Switch variants with the top nav tabs.

- **Drag an axis arrow** (X red / Y green / Z blue) on the model to see the live `Δ pos.*` readout
  increment and reflect the write target (`→ client` vs `→ staged`).
- Use the bottom-right **sketch toolbar** `● Live (injected)` button to flip the whole app between
  **Live (injected, pid 8841)** and **Offline — file-patch fallback**. Watch the chips, card, readout
  bar, and statusbar all switch glyph + border + label together.
- Theme picker and `⊙ annotate` (shows panel role notes) also live in the toolbar.

## Variants
- **A · Minimal HUD** — path of least resistance. Clean viewport: shading chips (Solid/Wire/Textured)
  top-left, nav chips + a compact `● Live · pid 8841` chip top-right, corner axis gizmo, vp-stats
  bottom-left, and a transform gizmo on the model. The `Δ pos.x +0.42m → client` readout appears only
  **while dragging** an arrow.
- **B · Full overlay HUD** — maximum at-a-glance. Persistent overlays: a top-right **live-sync client
  card** (SWG Infinity · injected pid 8841 · 60 fps · last sync 0.2s · COW snapshot ✓), a left-edge
  **gizmo-mode toolbar** (Move/Rotate/Scale/Universal · W/E/R/Q), and a bottom **transform readout
  bar** with Pos/Rot/Scale numboxes that mirror the gizmo + a `writing to client → client ✓` indicator.
- **C · Gizmo-focused** — the manipulation moment. Larger gizmo, a Blender/Unity-style mode switch
  (Move=G / Rotate=R / Scale=S) + snapping toggles (grid snap, angle snap), and a **"writing to client
  memory" pulse** (CSS keyframe glow on the sync chip + model) plus a Δ label while dragging.

## What to Look For
- **Minimal vs full-HUD vs gizmo-focused** — which density fits a DCC viewport? A stays out of the
  way until you act; B keeps the injection state + numeric transform permanently on screen; C makes
  the live-write the hero beat.
- **Does live-vs-offline read unambiguously?** State is conveyed by glyph (● / ○) + border (solid /
  dashed) + label + color — never color alone (sketch-001 accessibility rule). Toggle `#btn-sync` and
  confirm every surface (chip, card, readout, statusbar) agrees.
- **Does the `Δ → client` readout sell the WYSIWYG moment?** When dragging, does the live delta +
  write target make it obvious the change is hitting the running client (and that Offline reroutes to
  `→ staged (patch)`)?
- **Gizmo legibility** — are the X/Y/Z arrows readable against the wireframe model and grid, are the
  axes individually grabbable (each labelled X/Y/Z, not color-only), and does the corner axis gizmo
  add or compete?
- **Is the gated/explicit injection nature honest?** The fallback is first-class, not an error state —
  does Offline feel like a deliberate safe mode rather than a failure?
