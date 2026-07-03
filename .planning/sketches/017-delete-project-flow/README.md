---
sketch: 017
name: delete-project-flow
question: "How does destructive project-delete read in the project surfaces — the row affordance, the descriptive confirm, and session-undo (toast + trash section)?"
winner: "B"
tags: [delete, project-lifecycle, destructive-action, undo, confirm, trash, phase-4.4]
---

# Sketch 017 · Delete-Project Flow

## ✅ Decision — Variant B · Kebab menu + inline dimmed rows

Delete lives one level deep in a per-row **⋯ menu** (Open · Reveal studio folder · ── ·
**Delete project…**) on both surfaces (Welcome recents + Open Project dialog). After confirm,
the deleted project stays **in place** as a dimmed, dashed, struck-through row with a **Restore**
button ("deleted just now · N versions parked") until the app closes — plus the transient undo
toast. No separate trash section: the row IS the trash entry.

Carries into planning as: kebab affordance on `WorkspaceEntry` recents rows + `ProjectListDialog`
cards, the shared descriptive confirm modal (numbered plan lines per deploy model + amber
"currently open" line), undo toast (8s, ⚠ variant for restore failure), inline dimmed
recoverable rows.

## Design Question

Phase 04.4's `delete-project-with-restore` todo locks the behavior (restore-client-first,
`.trash` parking, session-scoped undo, descriptive confirm — CONTEXT.md D-01…D-05). This sketch
settles the remaining **idiom**: how the delete affordance appears on project rows (Welcome
recents + Open Project dialog), how the confirm modal's "here's exactly what will happen" plan
reads per deploy model, and where undo lives after the toast fades.

## How to View

Open `index.html` in a browser (self-contained; links `../themes/cyan.css`). Switch variants with
the top nav. Sketch toolbar (bottom-right): theme picker (all 5 themes), **simulate restore
failure** checkbox (drives the ⚠ toast state), and reset.

Walk the full loop in each variant: **delete → confirm (read the plan lines) → toast → undo /
trash-section Restore**. The three seed projects each exercise a different confirm plan:

- **DL-44 Overhaul** — cfg model (SWG Infinity), **currently open** → extra "workspace will close" line
- **Stormtrooper Recolor** — loose-override model (swg-client-v2) → "revert loose overrides" line
- **Tatooine Props** — standalone TRE set, never deployed → "nothing to restore" line

## Variants

- **A: Hover trash + trash section** — trash icon reveals on row hover (dialog + recents);
  deleted projects collect in a collapsed "Recently deleted (this session)" section at the
  dialog's bottom.
- **B: Kebab menu + inline dimmed rows** — per-row ⋯ menu (Open · Reveal folder · Delete…);
  deleted projects stay **in place** as dimmed dashed rows with a Restore button.
- **C: Manage mode** — explicit Manage toggle in the header flips rows into management state
  with always-visible Delete buttons; trash lives in an always-expanded footer section.

## What to Look For

- **Accident-resistance vs discoverability:** A is one hover away (fast, but is a bare trash icon
  on a clickable row too easy to hit?). B hides delete one level deep — safest, and the kebab
  gives future row actions a home. C makes destructive intent a deliberate mode switch.
- **The confirm plan:** do the numbered "exactly what will happen" lines earn trust? Check all
  three projects — cfg restore vs loose revert vs never-deployed, and the amber "currently open"
  line on DL-44.
- **Undo reachability after the toast:** A's collapsed section vs B's in-place dimmed rows vs C's
  always-open trash. Which matches "it's recoverable until I close the app"?
- **Does B's in-place row read as "still there" (confusing) or "recoverable" (reassuring)?**
- **Restore-failure surfacing (D-05):** toggle the toolbar checkbox and delete a deployed
  project — the ⚠ toast keeps the parked-for-undo promise while flagging the client may need a
  manual check. Right weight, or does failure deserve a blocking dialog?
- **Themes:** destructive red + the `⛁ bound` chip + amber warn line must stay legible across all
  5 themes (esp. high-contrast).
