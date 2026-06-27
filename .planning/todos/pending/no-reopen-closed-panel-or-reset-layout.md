---
id: no-reopen-closed-panel-or-reset-layout
title: No UI way to reopen a closed Dockview panel or reset the layout
created: 2026-06-27
origin: Maintainer UAT — accidentally closed the Staging tab; restart didn't bring it back (layout persisted)
severity: medium (UX / discoverability)
area: renderer / WorkspaceShell (Dockview layout persistence)
status: pending
---

## Symptom

Closing a Dockview tab (e.g. Staging) removes it from the layout, which `WorkspaceShell.tsx`
persists to `localStorage['swg-workspace-layout']` via `onDidLayoutChange`. On restart, `onReady`
restores the persisted (panel-missing) layout, so the panel stays gone with **no way to bring it back
from the UI**. Restarting does NOT help (that's what reloads the bad layout).

Current recovery (not discoverable): DevTools console →
`localStorage.removeItem('swg-workspace-layout'); location.reload()` → triggers `buildInitialLayout`.

## Fix (when desired)

Add a UI affordance. Options (pick at least one):
- **Reset Layout** menu/button → `localStorage.removeItem(LAYOUT_STORAGE_KEY)` + rebuild via
  `buildInitialLayout(api)` (no reload needed — call it on the live api).
- **View menu / panel list** to toggle/re-add individual panels (sidebar, viewport, inspector, data,
  staging, changesets, vcs) — re-`addPanel` the missing one without nuking the whole layout.
- Optionally guard against closing the last/essential panels, or make deploy tabs re-addable from the
  Assets/Inspector group header.

`WorkspaceShell.tsx` already has the api in `onReady` (`apiRef`); buildInitialLayout + the panel
registry (`panelComponents`) are all present — this is wiring an entry point, not new infrastructure.

## Severity

Medium — not data loss (workspace state is in `.studio/` + stores, not the layout), but a user can
trivially soft-brick their own UI with no in-app escape hatch. Pairs with the broader layout/UX polish.
