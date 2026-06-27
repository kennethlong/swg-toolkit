---
id: deploy-tab-combine-staging-and-changesets
title: Build the single combined Deploy tab (staging + version graph) per approved sketch 005-B
created: 2026-06-27
origin: Maintainer UAT — the split Staging/Changesets tabs are the core usability gap; sketch 005-B designed ONE combined tab
severity: high (core surface diverges from approved design; this is the maintainer's #1 friction)
area: renderer / deploy panels + workspace-config tab registration
status: pending
disposition: centerpiece of the rework task; framed as a divergence from the approved sketch, not a new redesign
related: staging-workflow-redesign, project-entry-point-and-shadow-redesign, no-reopen-closed-panel-or-reset-layout
---

## This is a divergence from the APPROVED design, not a fresh idea

Sketch **005-B is a recorded WINNER** (`.planning/sketches/005-deploy-inspect-tab/README.md`,
`winner: "B"`). It explicitly composed the Deploy UI as ONE tab: *"staging list + version graph +
modal CTA, all stacked in the inspector's dock slot."* The Phase-4 handoff described it the same way:
*"Deploy tab = Staging OVER the Version graph + Deploy… button."*

The executor instead built **three separate Dockview tabs** — `Staging`, `Changesets`, `Version
Control` — registered individually in `workspace-config.ts`. Splitting working-changes from version-
history across tabs is the maintainer's core friction (you can't see your staged changes and the
version timeline together, and closing one tab stranded the workflow). **Correcting this = building
what was already approved.**

## Target composition (sketch 005-B)

A single **`Deploy`** panel, vertically stacked in the inspector dock slot (~380px+ wide, per 005-B):

1. **Working changes (staging)** on top — the `StagingPanel` list (ActionBadge | virtual path | source
   size | remove ×), `Add…` action.
2. **Version graph** below — the `ChangesetTimelinePanel` git-graph lanes; row hover → Revert /
   Deploy vN / Branch from here (full inline bar at wide width; `⋯` overflow at ~300px per 005-A).
3. **`Deploy…` CTA** at the bottom → opens the existing `DeployDialog` (003-A modal). Deploy stays a
   modal, NOT inline (005 confirmed).
4. Sections may need collapse/scroll since both stack in one pane (005 "What to Look For" flagged
   vertical scroll — consider a collapsible split).

## Implementation notes (UI composition only — engine reused)

- New combined panel (e.g. `DeployPanel.tsx`) renders the staging section + timeline section + Deploy
  button. Reuse the existing bodies — extract `StagingPanelBody` and the timeline body so they compose
  without duplicate panel headers / workspace gates.
- `workspace-config.ts`: replace the `staging` + `changesets` `addPanel` calls with a single `deploy`
  panel; keep `vcs` as its own tab. Update `panelComponents` in `WorkspaceShell.tsx`.
- Engine untouched: `stagingStore`, `changesetService` (flatten/seal/select), `DeployDialog`,
  `packPatch` all reused as-is.
- Migrate the persisted layout: an old `localStorage['swg-workspace-layout']` referencing `staging`/
  `changesets` components will dangle → bump a layout version or clear-on-mismatch (pairs with
  [[no-reopen-closed-panel-or-reset-layout]]).

## Deploy button belongs with the version graph, not staging (maintainer)

Deploy operates on **`flatten(activeVersionId)`** — the selected/active changeset — **never the live
staging list** (the headline test "select an old version → Deploy → deploys that version" depends on
this). So conceptually the **Deploy… CTA belongs with the version-graph**, not the Staging list. The
executor placed it on the Staging tab, which is misleading. In the combined 005-B tab it sits at the
**bottom, under the version graph** (correct). **INTERIM DONE (2026-06-27):** Deploy moved off Staging
→ bottom action bar of the **Changesets** tab; Staging header now has Add… + Save version. Split-tab
interim; the combined 005-B tab still supersedes it. (tsc clean, 28/28 green.) (Auto-seal-when-dirty in
`DeployDialog` is what bridges uncommitted
staging into a new active version before deploying — so the staging state isn't ignored, it's sealed
first.)

## Deploy dialog polish (minor, same rework)

- **Auto-select a single detected client.** `DeployDialog` gates "Deploy patch" on `!selectedClient`,
  but auto-detected clients are NOT auto-selected → the button looks broken/grayed until the user
  notices they must click the Section-A radio. When `clients.length === 1`, default `selectedClient`
  to it (and surface "Browse to the folder containing `swgemu.cfg`" more clearly when none detected).

## Changeset changed-file list (maintainer, 2026-06-27 — validated in sketch 006-D)

Each version row in the graph must **expand (▸) to list that changeset's actual changed files** (its
deltas: action badge + changed/identical dot + virtual path), not just show a count. Source = the
changeset's `deltas[]`. Clicking a version still selects it (Deploy target / staging materialization).
Designed + accepted in sketch 006 winner D. (Distinct from "saved-in-vN" — this is the per-node delta
list, on demand.)

## VCS tab — confirmed wired, stays separate

`VcsPanel` is fully wired (Commit/Push/LFS status/retail-guard/commit log via `gitLfsService`;
`createWorkspace` git-inits + LFS + hook). It's git-backed PROJECT persistence/sharing — a separate
axis from deploy. The sketch combined only staging + version-graph; VCS remains its own tab.

## Severity

High — the core deploy surface does not match the approved sketch, and the split is the maintainer's
primary usability blocker. Top of the rework task.
