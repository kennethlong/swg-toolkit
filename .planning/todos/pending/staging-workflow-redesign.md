---
id: staging-workflow-redesign
title: Redesign the add-to-staging workflow — stage directly from the TRE browser
created: 2026-06-27
origin: Maintainer UAT feedback (Phase-4 deploy-loop) — "This is not intuitive at all… the workflow should allow you to stage things from the TRE browser. Let's test what we have and redesign at the rework task."
severity: medium-high (UX)
area: renderer / staging (StagingPanel) ↔ TRE VFS browser (TreVfsBrowser/VfsTree)
status: pending
disposition: redesign deferred to the rework task; UAT proceeds with the current minimal flow
related: project-binds-and-automounts-client-tres
---

## Problem

The current add-to-staging flow is unintuitive and disconnected from how a user actually mods:

1. **No path from the TRE browser to staging.** You browse/extract in `TreVfsBrowser`, but there is
   no "stage this entry / Extract & Add to patch" action. To stage you must instead go to the Staging
   panel, click **Add…**, pick a loose file from disk, and then **manually type the virtual archive
   path** (e.g. `appearance/armor.mgn`). The user has to already know the exact VFS path — the very
   thing the TRE browser knows and could supply.
2. **Misleading empty-state copy.** Staging's empty state says *"Extract a file and Add to patch, or
   drop in a replacement,"* implying a TRE-browser→staging flow that does not exist.
3. **Manual virtual-path entry is error-prone** (typos, wrong casing, wrong folder) and unnecessary
   when staging originates from a known VFS entry.

## Desired workflow (redesign target)

- **Right-click / action in the TRE browser → "Add to patch" (and "Extract & edit → Add to patch").**
  Staging an entry from the browser should auto-populate the virtual path from the VFS entry — no
  manual typing. The user picks/produces the replacement bytes; the path comes from the browser.
- Keep **Add… (loose file)** and **drag-drop** as secondary entry points, but auto-suggest the
  virtual path (and let the browser-origin flow fill it exactly).
- Fix the empty-state copy to match whatever the redesigned flow actually offers.
- Dovetails with [[project-binds-and-automounts-client-tres]]: once a project auto-mounts its client's
  base TREs, "browse base TRE → stage override" becomes the natural primary loop.

## Interim fix already applied (UAT unblock — not the redesign)

`window.prompt()` is **not supported in Electron's renderer** (threw
`Error: prompt() is not supported` at `StagingPanel.tsx` handleAdd/handleDrop). Replaced both prompt
calls with a lightweight in-app `VirtualPathModal` (input + validation + Enter/Esc) so Add… and
drag-drop work for UAT. This modal is intentionally minimal and will be superseded by the redesign.
(Renderer tsc clean; 28/28 tests still green.)

## Severity

Medium-high UX — not a correctness bug (the deploy loop functions), but the first-run experience is
confusing and the TRE-browser disconnect is the core ergonomic gap. Schedule with the staging/TRE
rework.
