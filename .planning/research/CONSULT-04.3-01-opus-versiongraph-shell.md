# Task: UI-vs-sketch gap diff — Version Graph (002, cross-check) + Shell Composition (008)

You are one of four independent reviewers. **Read the real files yourself and report only what you
observe in them.** Do not trust my framing or any element list as complete — re-derive it from the
sketch. Another reviewer is independently diffing surface 1; do NOT coordinate — your value is an
independent read we can cross-check.

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
  (owned by `DeployPanel.tsx` in the same dir).
- This is the load-bearing surface. The sketch winner is a **git-graph with lanes** (nodes, connector
  lines between parent/child, branch-from curves, lane columns). Reason carefully about what graph
  structure the sketch actually draws vs. what the component renders, element by element.

### Surface 2 — Shell Composition (sketch 008, winner = "A + B · compose coheres; Deploy widens to ~440px")
- **Sketch:** `D:\Code\SWG-Toolkit\.planning\sketches\008-shell-composition\index.html`
- **As-built:** `D:\Code\SWG-Toolkit\packages\renderer\src\workspace\WorkspaceShell.tsx`,
  `packages\renderer\src\shell\StatusBar.tsx`, `packages\renderer\src\shell\Titlebar.tsx`, and how
  `DeployPanel.tsx` is composed in as a tab (`Inspect` | `Deploy` group; auto-widen).

## What to produce

For **each** surface, a table: one row per **distinct visual element / affordance in the sketch**
(enumerate them yourself from the HTML — activity rail, tab groups, status-bar chips, the Inspect|Deploy
tab group, auto-widen behavior, accent/theme, markers, connector lines, lanes, etc.).

| Sketch element | Status | Evidence (build file:line, or "absent") | Notes / divergence |
|---|---|---|---|

- **Status** ∈ {OBSERVED, MISSING, DIVERGENT}. DIVERGENT = present but differs from the sketch.
- Cite exact `file:line` for OBSERVED/DIVERGENT; "absent" for MISSING.
- For surface 1, be explicit about the **flat-list vs. git-graph-lanes** question with specific evidence.
- End each surface with a 2-3 line **summary of the biggest gaps**.

Be exhaustive and concrete. Output **prose + the tables only** — no preamble.
