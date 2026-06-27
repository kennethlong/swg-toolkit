---
sketch: 002
name: version-graph-timeline
question: How to visualize the branching version history + the dual active-vs-deployed state + revert/deploy/branch affordances, inside a dockview panel?
winner: "A"  # Git-Graph Lanes — branch + active/deployed reads clearest
tags: [versioning, graph, timeline, branching, deploy, revert, history, phase-4]
---

# Sketch 002 — Version Graph Timeline

## Design Question

How to visualize the BRANCHING version history + the dual active-vs-deployed state + revert/deploy/branch affordances, inside a dockview panel?

The model to express (from `04-CONTEXT.md` D-04-05..08): a version **graph** (parentId/branching), save→version, revert-to-any-version, DEPLOY materializes a version (flatten root→N), active-vs-deployed are **DISTINCT** states.

## How to View

Open `index.html` directly in a browser. No build step, no server needed.

## Scenario Data

- **v1** "Initial weapon tweaks" — root, 2026-06-24, 8 files
- **v2** "Buffed DL-44 damage" — child of v1, **DEPLOYED** (live in client), 2026-06-25, 5 files
- **v3** "Recolor stormtrooper armor" — child of v2 (main branch), 2026-06-26 09:00, 3 files
- **v4** "Alt: heavier blaster" — child of v2 (**BRANCHED** off v2 after reverting from v3), **ACTIVE** (currently editing), 2026-06-26 14:00, 2 files

Graph topology: v1 → v2 →┬→ v3 (main)
                           └→ v4 (branch, ACTIVE)

Plus 3 uncommitted changes in the working set above v4.

## Variants

| Variant | Label | Description |
|---------|-------|-------------|
| A | Git-Graph Lanes | Vertical SVG graph (GitKraken / VS Code style). Two lanes: lane 0 (main) holds v1/v2/v3; lane 1 (branch) holds v4. Cyan filled node = active; info-bordered node + ⤓ pip = deployed. Hover any row to reveal Revert / Deploy / Branch actions. Dashed line above v4 = uncommitted work in progress. |
| B | Indented List + Branch Badges | Reverse-chron flat list. Main branch items are at left margin; branch items are indented with a "↳ branched from v2" badge. Active row = cyan left border + accent-dim bg. Deployed row = info pill on the right. Simpler, no SVG. |
| C | Horizontal Subway / Mini-Map | Compact horizontal strip at panel top (left=oldest, right=newest). Main rail + branch spur below. Click a node → small action popover (Revert / Deploy / Branch). Selected version's details (files + actions) appear in a card pane below the strip. |

## What to Look For

- Does the **git-graph lane approach** (A) make the branching immediately legible, or does it add cognitive overhead for what is typically a linear (short) history?
- Is the **active ≠ deployed** distinction clear enough in each variant? A user must never confuse "what I'm editing" with "what's running in my client".
- Does the hover-to-reveal action bar (A) feel discoverable, or should revert/deploy/branch be always-visible buttons (B/C style)?
- Does the horizontal subway (C) save enough vertical space to be worth the loss of detail density vs. A/B?
- **Key branching question:** when a user reverts to v2 and starts editing, the new work should clearly appear as a branch (not overwrite v3). Does each variant communicate this branching moment?
