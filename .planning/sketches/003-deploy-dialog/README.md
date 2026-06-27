---
sketch: 003
name: deploy-dialog
question: How does the deploy flow read — target client + model picker + slot preview + build/activate progress + result/reset?
winner: "A"  # Single-column stepper modal (deploy is a modal, costs no panel space)
tags: [deploy, modal, dialog, cfg, progress, error-states, phase-4]
---

# Sketch 003 — Deploy Dialog

## Design Question

How does the deploy flow read — target client + model picker + slot preview + build/activate progress + result/reset? Does a single-column modal stepper, a two-section compact modal, or an inline-in-panel approach feel most natural for this workflow?

## How to View

Open `index.html` directly in a browser. No build step, no server needed.

**Variant A** is the most interactive: use the **state toggle bar** (small buttons that appear above the dialog) to cycle through all dialog states: choosing / shadow ⚠ / building… / ✓ success / ✕ build err / ✕ cfg err / ⚠ no client.

## Scenario Data

- **Deploying:** v4 "Alt: heavier blaster" (active version, cumulative: 5 files)
- **Client detected:** SWG Infinity at `D:\SWG Infinity` (EERT5000 / v5000)
- **Client not found:** SWGEmu
- **Config slot:** `[SharedFile] searchTree_00_55=swgtoolkit_mymod.tre` (maxSearchPriority=60, slots 30–54 used → 55 free)
- **Shadow model disk estimate:** ~3.2 GB

## Variants

| Variant | Label | Description |
|---------|-------|-------------|
| A | Single-Column Stepper (modal) | Verbatim ExportDialog pattern: 360px overlay panel, sections stacked vertically (client → model → cfg slot preview → action row). All deploy states reachable via the sketch-chrome state toggle bar: choosing, shadow ⚠ warning, building…, ✓ deployed, ✕ build failure, ✕ cfg activation failure (backup restored), ⚠ no-client disabled. |
| B | Two-Section Compact (modal) | 560px modal split left/right: left = client list + model radios; right = cfg preview + live deploy status. Denser, single-screen read. |
| C | Inline-in-Panel (non-modal) | Same deploy controls embedded as sections inside a panel (alongside the version history panel), no modal overlay. Compare: does permanent visibility feel cleaner or cluttered vs. opening a modal? |

## What to Look For

- Does the **single-column stepper** (A) give enough breathing room for first-time users to understand each decision before proceeding, or is it too tall?
- Does the **two-section compact** (B) feel like a natural "configure + confirm" screen, or does splitting left/right make the cfg-slot preview feel disconnected from the slot selection?
- Does the **inline approach** (C) reduce the "ceremony" of deployment in a way that matches the frequency of the action, or does it make the panel feel overloaded?
- **State machine legibility (Variant A):** do the building / success / error / no-client states all feel distinct and actionable? Is the "cfg was restored from backup" copy on activation failure reassuring?
- Is the cfg slot preview (`searchTree_00_55=swgtoolkit_mymod.tre`) legible at `--text-xs` monospace density?
- Does the **disabled-no-client** state (⚠ instead of Deploy button) clearly gate the action without being confusing?
