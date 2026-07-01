/**
 * packages/renderer/src/state/dockStateStore.ts
 * Session-scoped dock active-panel state (S6 — statusbar sb-state chip).
 *
 * Written by WorkspaceShell.tsx when onDidActivePanelChange fires (plan 09 Rule 2
 * addition). Read by StatusBar.tsx to render the sb-state chip:
 *   "Deploy active · dock 440px"  |  "Inspect active · dock 290px"
 *
 * The dockWidth reflects the right-dock group width that WorkspaceShell sets via
 * the active-panel auto-widen hook (M3 — DEPLOY-05 / D-14).
 *
 * Session-scoped ONLY — NOT persisted. Plain in-memory Zustand store.
 *
 * Source: 04.3-09-PLAN.md Task 2 (S6).
 */

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface DockState {
  /**
   * The dockview panel id of the currently active right-dock panel.
   * null = no panel focused yet (initial state).
   */
  activePanelId: string | null;
  /** Current right-dock width in px (set by WorkspaceShell auto-widen). */
  dockWidth: number;

  setActiveDockPanel: (panelId: string, width: number) => void;
  clearActiveDockPanel: () => void;
}

export const useDockStateStore = create<DockState>((set) => ({
  activePanelId: null,
  dockWidth:     290, // INSPECTOR_WIDTH default
  setActiveDockPanel: (panelId: string, width: number) =>
    set({ activePanelId: panelId, dockWidth: width }),
  clearActiveDockPanel: () =>
    set({ activePanelId: null }),
}));

// ---------------------------------------------------------------------------
// Imperative setter — called from WorkspaceShell (not a hook context)
// ---------------------------------------------------------------------------

export function setActiveDockPanel(panelId: string, width: number): void {
  useDockStateStore.getState().setActiveDockPanel(panelId, width);
}
