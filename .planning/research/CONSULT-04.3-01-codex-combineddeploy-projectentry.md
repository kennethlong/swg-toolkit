# Task: UI-vs-sketch gap diff — Combined Deploy Tab (006) + Project Entry (007)

You are one of four independent reviewers. **Read the real files yourself and report only what you
observe in them.** Do not trust my framing or any element list as complete — re-derive it from the
sketch.

## Context (treat as given)

This repo (`D:\Code\SWG-Toolkit`) is an Electron + React 19 + TypeScript SWG modding suite. The
HTML mockups under `.planning\sketches\` are the **authoritative UI contract** — the spec of intended
behavior and layout for each surface. The React components under `packages\renderer\src\` are the
**as-built implementation**. Your job is a faithful **diff**: does the build contain each distinct
visual element the sketch specs? You are good at tracing how components compose — pay attention to
**structure** (which component renders what, tab/section grouping, wiring).

## Your two surfaces

### Surface 1 — Combined Deploy Tab (sketch 006, winner = "D · Collapse + splitter + changeset file-lists" — this is the FINAL composition)
- **Sketch:** `D:\Code\SWG-Toolkit\.planning\sketches\006-combined-deploy-tab\index.html`
- **As-built:** `D:\Code\SWG-Toolkit\packages\renderer\src\panels\deploy\DeployPanel.tsx`
  plus children in the same dir: `StagingPanelBody.tsx`, `VersionHistoryBody.tsx`, `DeployDialog.tsx`, `ActionBadge.tsx`.
- Key contract from the manifest: the Deploy tab is **ONE** `DeployPanel` with **stacked collapsible
  sections** (Working changes / Version history) split by a **resizable splitter** (auto-hidden when a
  section is collapsed) + a sticky **`Deploy…`** button; each version row **▸-expands** to its changed
  files. Verify the build matches this structure (NOT 3 separate tabs).

### Surface 2 — Project Entry / front door (sketch 007, winner = "Synthesis · A header + C wizard + B first-run")
- **Sketch:** `D:\Code\SWG-Toolkit\.planning\sketches\007-project-entry\index.html`
- **As-built (read all):** in `packages\renderer\src\panels\deploy\`:
  `WorkspaceEntry.tsx`, `ProjectBindingBar.tsx`, `NewProjectWizard.tsx`, `ProjectListDialog.tsx`.
  Also `packages\renderer\src\workspace\WorkspaceShell.tsx` for where the front door mounts.
- Look for: project↔client binding, optional local-server wiring, the **unconfirmed-directory**
  ("is this a client install?") branch, Open/Create-beside-Mount, first-run takeover.

## What to produce

For **each** surface, a table: one row per **distinct visual element / affordance in the sketch**
(enumerate them yourself from the HTML).

| Sketch element | Status | Evidence (build file:line, or "absent") | Notes / divergence |
|---|---|---|---|

- **Status** ∈ {OBSERVED, MISSING, DIVERGENT}. DIVERGENT = present but differs from the sketch.
- Cite exact `file:line` for OBSERVED/DIVERGENT; "absent" for MISSING.
- End each surface with a 2-3 line **summary of the biggest gaps**.

Be exhaustive and concrete. Output **prose + the tables only** — no preamble.

(You are Codex, run non-interactively. Read files directly from the absolute paths above.)
