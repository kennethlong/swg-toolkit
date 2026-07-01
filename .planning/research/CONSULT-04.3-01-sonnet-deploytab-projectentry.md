# Task: UI-vs-sketch gap diff — Deploy/Inspect Tab (005, cross-check) + Project Entry (007, cross-check)

You are one of four independent reviewers. **Read the real files yourself and report only what you
observe in them.** Do not trust my framing or any element list as complete — re-derive it from the
sketch. Other reviewers are independently diffing these same surfaces; do NOT coordinate — your value
is an independent read and a **lateral eye** for gaps the structural readers might miss (empty states,
error/loading states, copy/wording, accessibility affordances, disabled states, edge transitions).

## Context (treat as given)

This repo (`D:\Code\SWG-Toolkit`) is an Electron + React 19 + TypeScript SWG modding suite. The
HTML mockups under `.planning\sketches\` are the **authoritative UI contract** — the spec of intended
behavior and layout for each surface. The React components under `packages\renderer\src\` are the
**as-built implementation**. Your job is a faithful **diff**: does the build contain each distinct
visual element the sketch specs?

## Your two surfaces

### Surface 1 — Deploy/Inspect Tab (sketch 005, winner = "B · Widened ~480px"; FINAL composition is 006-D)
- **Sketch:** `D:\Code\SWG-Toolkit\.planning\sketches\005-deploy-inspect-tab\index.html`
- **As-built:** `D:\Code\SWG-Toolkit\packages\renderer\src\panels\deploy\DeployPanel.tsx`
  plus children in the same dir: `StagingPanelBody.tsx`, `VersionHistoryBody.tsx`, `DeployDialog.tsx`.

### Surface 2 — Project Entry / front door (sketch 007, winner = "Synthesis · A header + C wizard + B first-run")
- **Sketch:** `D:\Code\SWG-Toolkit\.planning\sketches\007-project-entry\index.html`
- **As-built (read all):** in `packages\renderer\src\panels\deploy\`:
  `WorkspaceEntry.tsx`, `ProjectBindingBar.tsx`, `NewProjectWizard.tsx`, `ProjectListDialog.tsx`.
  Also `packages\renderer\src\workspace\WorkspaceShell.tsx`.

## What to produce

For **each** surface, a table: one row per **distinct visual element / affordance in the sketch**
(enumerate them yourself from the HTML). Pay special attention to states/copy the others may skip:
empty, loading, error, disabled, success, hover, first-run-vs-returning, and exact wording.

| Sketch element | Status | Evidence (build file:line, or "absent") | Notes / divergence |
|---|---|---|---|

- **Status** ∈ {OBSERVED, MISSING, DIVERGENT}. DIVERGENT = present but differs from the sketch.
- Cite exact `file:line` for OBSERVED/DIVERGENT; "absent" for MISSING.
- End each surface with a 2-3 line **summary of the biggest gaps**.

Be exhaustive and concrete. Output **prose + the tables only** — no preamble.
