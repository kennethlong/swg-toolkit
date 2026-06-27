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

/** Bumped from 1 → 2: retired 'staging'/'changesets', added 'deploy' (plan 05). */
export const LAYOUT_VERSION     = 2 as const;
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
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { direction: 'right', referencePanel: 'viewport' },
    initialWidth: 280,
  });

  // Data pane docked below viewport
  api.addPanel({
    id: 'data',
    component: 'data',
    title: 'Data',
    position: { direction: 'below', referencePanel: 'viewport' },
    initialHeight: 200,
  });

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
}
