# Task: UI-vs-sketch gap diff — Version Graph (002) + Deploy/Inspect Tab (005)

You are one of four independent reviewers. **Read the real files yourself and report only what you
observe in them.** Do not trust my framing or any element list as complete — re-derive it from the
sketch.

## Context (treat as given)

This repo (`D:\Code\SWG-Toolkit`) is an Electron + React 19 + TypeScript SWG modding suite. The
HTML mockups under `.planning\sketches\` are the **authoritative UI contract** — the spec of intended
behavior and layout for each surface. The React components under `packages\renderer\src\` are the
**as-built implementation**. Your job is a faithful **diff**: does the build contain each distinct
visual element the sketch specs?

## Your two surfaces

### Surface 1 — Version Graph (sketch 002, winner = "A · Git-Graph Lanes")
- **Sketch:** `D:\Code\SWG-Toolkit\.planning\sketches\002-version-graph-timeline\index.html`
- **As-built:** `D:\Code\SWG-Toolkit\packages\renderer\src\panels\deploy\VersionHistoryBody.tsx`
  (wrapped/owned by `DeployPanel.tsx` in the same dir — read it for context).

### Surface 2 — Deploy/Inspect Tab (sketch 005, winner = "B · Widened ~480px"; see also the FINAL 006-D composition)
- **Sketch:** `D:\Code\SWG-Toolkit\.planning\sketches\005-deploy-inspect-tab\index.html`
- **As-built:** `D:\Code\SWG-Toolkit\packages\renderer\src\panels\deploy\DeployPanel.tsx`
  plus its children in the same dir: `StagingPanelBody.tsx`, `VersionHistoryBody.tsx`, `DeployDialog.tsx`.

## What to produce

For **each** surface, a table: one row per **distinct visual element / affordance in the sketch**
(enumerate them yourself from the HTML — markers, badges, connector lines, buttons, labels, section
headers, collapse/splitter affordances, states, copy/wording, etc.).

| Sketch element | Status | Evidence (build file:line, or "absent") | Notes / divergence |
|---|---|---|---|

- **Status** ∈ {OBSERVED, MISSING, DIVERGENT}. DIVERGENT = present but differs from the sketch
  (wrong shape, wrong copy, flat-vs-graph, etc.) — describe the difference.
- Cite the exact `file:line` in the as-built component for OBSERVED/DIVERGENT; write "absent" for MISSING.
- End each surface with a 2-3 line **summary of the biggest gaps**.

Be exhaustive and concrete. If something in the sketch is ambiguous, say so rather than guessing.
Output **prose + the tables only** — no preamble.
