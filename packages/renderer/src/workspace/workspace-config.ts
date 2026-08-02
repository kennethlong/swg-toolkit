/**
 * packages/renderer/src/workspace/workspace-config.ts
 * Workspace constants: storage keys, theme names, panel component registry,
 * and the initial dockview layout builder.
 *
 * INITIAL_LAYOUT uses explicit initialWidth/initialHeight (review LOW / Cursor):
 *   sidebar: 240px, inspector: 280px, data: 200px (bottom).
 *
 * All component IDs are registered BEFORE fromJSON (RESEARCH Pitfall 5).
 *
 * LAYOUT_VERSION = 2 (plan 05): retired staging+changesets; added deploy.
 * LAYOUT_VERSION = 4 (05-08): retired the bottom-pane 'datatable' placeholder panel —
 *   DatatableGridEditor now opens as a dynamic main-editor-group tab via editorTabs.ts.
 *   The 008-S8 bottom-pane trio becomes Console | Log only.
 */

import { DockviewApi } from 'dockview';
import type { IDockviewPanelProps } from 'dockview';
import type React from 'react';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

export const LAYOUT_STORAGE_KEY  = 'swg-workspace-layout' as const;
export const THEME_STORAGE_KEY   = 'swg-active-theme' as const;

// ---------------------------------------------------------------------------
// Layout version guard (D-03 / DEPLOY-07 / Pattern 6)
//
// Bump LAYOUT_VERSION whenever panel ids are added, renamed, or retired.
// WorkspaceShell.onReady checks localStorage[LAYOUT_VERSION_KEY] and discards
// any saved layout whose version differs from LAYOUT_VERSION, preventing
// returning users from being soft-bricked by retired panel ids (dockview #341).
// ---------------------------------------------------------------------------

/** Bumped from 2 → 3: renamed 'Inspector'→'Inspect', replaced single 'data' with
 *  Datatable/Console/Log trio (plan 09 — sketch 008 S4 + S8).
 *  Bumped from 3 → 4 (05-08): retired the 'datatable' placeholder panel id — bottom pane is
 *  now Console/Log only; DatatableGridEditor opens dynamically via editorTabs.ts instead.
 *  Bumped from 4 → 5 (05.1-10): added the 'world' panel — Live World Editor productization.
 *  Bumped from 5 → 6 (05.1-09 checkpoint): added the 'live-inspector' panel to the DEFAULT layout.
 *  It was reopenable but had never been in buildInitialLayout, so the 4→5 bump wiped it from saved
 *  layouts and the launch/attach surface disappeared. This bump is what makes the fix reach users
 *  who already migrated to 5 — without it their (now stale) v5 layout is considered current and is
 *  never rebuilt, so they would keep the broken arrangement. */
export const LAYOUT_VERSION     = 6 as const;
export const LAYOUT_VERSION_KEY = 'swg-workspace-layout-version' as const;

// ---------------------------------------------------------------------------
// Theme names
// ---------------------------------------------------------------------------

export const THEMES = ['cyan', 'swg-green', 'amber', 'blue', 'high-contrast'] as const;
export type ThemeName = (typeof THEMES)[number];

// ---------------------------------------------------------------------------
// Panel component registry (populated by WorkspaceShell via lazy import)
// The type is kept generic here so the registry can be set without importing
// the React components at this level (avoids circular imports).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PanelComponents = Record<string, React.FunctionComponent<IDockviewPanelProps<any>>>;

// The actual registry is built in WorkspaceShell.tsx so that component imports
// stay co-located with the shell. We export the type for callers.

// ---------------------------------------------------------------------------
// Initial layout
// ---------------------------------------------------------------------------

/**
 * Adds the four panels to the dockview API with explicit sizing.
 * Called when no persisted layout exists (or fromJSON fails).
 *
 * Panel sizing (review LOW / Cursor):
 *   sidebar   → direction 'left',  initialWidth 240
 *   viewport  → no position option (first panel = root, fills 1fr)
 *   data      → direction 'below', referencePanel 'viewport', initialHeight 200
 *   inspector → direction 'right', referencePanel 'viewport', initialWidth 280
 */
export function buildInitialLayout(api: DockviewApi): void {
  // Add viewport first — it becomes the root that others dock against
  api.addPanel({
    id: 'viewport',
    component: 'viewport',
    title: 'Viewport',
  });

  // Assets panel docked to the left of viewport
  api.addPanel({
    id: 'sidebar',
    component: 'sidebar',
    title: 'Assets',
    position: { direction: 'left', referencePanel: 'viewport' },
    initialWidth: 240,
  });

  // Inspector panel docked to the right of viewport
  // S4 (sketch 008): renamed from 'Inspector' → 'Inspect'
  const inspectorPanel = api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspect',
    position: { direction: 'right', referencePanel: 'viewport' },
    initialWidth: 280,
  });

  // S8 (sketch 008): bottom pane = Console / Log pair (05-08: 'datatable' placeholder retired —
  // DatatableGridEditor now opens as a dynamic main-editor-group tab via editorTabs.ts instead
  // of this fixed bottom-pane slot; LAYOUT_VERSION 3→4 clears old saved layouts referencing it).
  const consolePanel = api.addPanel({
    id: 'console',
    component: 'console',
    title: 'Console',
    position: { direction: 'below', referencePanel: 'viewport' },
    initialHeight: 200,
  });
  api.addPanel({
    id: 'log',
    component: 'log',
    title: 'Log',
    position: { direction: 'within', referencePanel: 'console' },
  });
  // Console is the default active tab in the bottom-pane group
  consolePanel?.api?.setActive?.();

  // Plan 05 (DEPLOY-05 / D-14): ONE combined 'deploy' tab replaces 'staging'+'changesets'.
  // 'vcs' stays as a separate tab in the same inspector group.
  // direction: 'within' + referencePanel: 'inspector' = dockview tab-within-group placement.
  // initialWidth: 440 — Deploy panel is wider than the old Inspector/Staging split (M3 / UI-SPEC).
  // The width only sets the group on first render; active-panel auto-widen in WorkspaceShell
  // maintains the correct width per active tab on every subsequent switch (M3 dynamic).
  api.addPanel({
    id: 'deploy',
    component: 'deploy',
    title: 'Deploy',
    position: { direction: 'within', referencePanel: 'inspector' },
    initialWidth: 440,
  });
  api.addPanel({
    id: 'vcs',
    component: 'vcs',
    title: 'Version Control',
    position: { direction: 'within', referencePanel: 'inspector' },
  });

  // Live Inspector — launch/attach + live session state. Registered in STATIC_PANEL_IDS and
  // reopenable since plan 08, but it had NEVER been added to the initial layout, so it existed
  // only in whatever saved layout a user happened to have. 05.1-10's LAYOUT_VERSION 4->5 bump
  // invalidated saved layouts and the panel silently vanished — reported at the 05.1-09 live
  // checkpoint as "I don't see the launch/attach panel on the right". A tool whose core loop is
  // "attach to a running client" must not ship a default layout without it.
  api.addPanel({
    id: 'live-inspector',
    component: 'live-inspector',
    title: 'Live Inspector',
    position: { direction: 'within', referencePanel: 'inspector' },
  });

  // 05.1-10 (sketch 019-A): World tab — "Inspect | Deploy | World" tabstrip in the same group.
  api.addPanel({
    id: 'world',
    component: 'world',
    title: 'World',
    position: { direction: 'within', referencePanel: 'inspector' },
  });

  // Inspect is the default active tab in the right group — adding 'deploy'/'vcs'/'world' last
  // would otherwise leave one of them focused (and auto-widened) on a fresh start.
  inspectorPanel?.api?.setActive?.();
}
