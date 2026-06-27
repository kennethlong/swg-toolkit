---
sketch: 005
name: deploy-inspect-tab
question: "Does the Deploy UI fit comfortably as a sibling tab of Inspect in the right dock, or does the narrow real-estate make it unusable?"
winner: "B"  # Widened (~480px) composition — Deploy tab needs ~380px+ to read comfortably
tags: [layout, tabs, inspector, composition, phase-4]
---

## Design Question

The existing Inspect panel already occupies the right dock. Rather than opening Deploy in a
separate region, can it live as a second tab on the **same panel** — so the user just clicks
`Deploy` to swap? This sketch tests the composition: staging list + version graph + modal CTA,
all stacked in the inspector's dock slot.

## How to View

Open `D:\Code\SWG-Toolkit\.planning\sketches\005-deploy-inspect-tab\index.html` in a browser
(no server needed — fully standalone).

Use the top bar to switch variants. The `Deploy…` button at the bottom of the Deploy tab opens
the 003-A modal; the `×` in the modal header closes it. Tab switching and the staging row hover
interactions (remove `×`, overflow `⋯` popover) all work.

## Variants

**Variant A — Narrow (~300 px panel)**
Realistic right-dock width. Long version labels and file paths truncate via `text-overflow:
ellipsis`. Per-row hover actions in the version graph collapse into a single `⋯` overflow button
that opens a tiny popover (Revert / Deploy / Branch). Staging rows drop the file-size source
column entirely. This is the "is it cramped?" stress test.

**Variant B — Wide (~480 px panel)**
Same composition with more horizontal room. Version labels and file paths render in full.
Staging rows show the source (file size) column. Version-graph row hover reveals the full inline
action bar (Revert / Deploy vN / Branch from here) without collapsing to `⋯`.

## What to Look For

- **Density at ~300 px (A):** Can you read the staging paths and version titles, or do ellipses
  make it illegible? Does the `⋯` popover feel reachable or fiddly at narrow width?
- **The `⋯` overflow pattern (A):** Is a single collapsed overflow button sufficient, or do you
  lose discoverability of Revert / Branch actions that aren't Deploy?
- **Vertical scroll (both):** Staging + graph together require scrolling within the deploy pane.
  Does that feel natural, or should one section be collapsible?
- **Deploy is a modal, not a panel (both):** The `Deploy…` CTA at the bottom opens the 003-A
  stepper modal rather than replacing the tab content. Does that transition feel right, or
  should the deploy flow live inline?
- **Tab coexistence:** Does having `Inspect` and `Deploy` as sibling tabs feel intuitive, or
  does it imply that Inspect and Deploy are peers when Deploy is arguably a workflow step?
