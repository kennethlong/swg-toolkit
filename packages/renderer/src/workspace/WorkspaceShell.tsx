/**
 * packages/renderer/src/workspace/WorkspaceShell.tsx
 * DockviewReact wrapper with layout persistence and version-guard migration.
 *
 * Layout persistence (Plan 05 — DEPLOY-07 / D-03):
 *   onReady:
 *     1. Register onDidLayoutChange to persist layout + version on every change.
 *     2. Read LAYOUT_VERSION_KEY from localStorage.
 *     3. If saved layout exists AND version matches → api.fromJSON (catch → clear + rebuild).
 *     4. Else (version mismatch or first run) → buildInitialLayout + write version key.
 *
 * Active-panel auto-widen (M3 — DEPLOY-05 / D-14):
 *   api.onDidActivePanelChange fires whenever the user switches tabs.
 *   The handler resizes the right-dock group:
 *     deploy    → ~440px (combined panel is wider than inspector alone)
 *     inspector → ~290px (original inspector width)
 *   Uses api.activePanel (no-args event) + panel.group.api.setSize({ width }).
 *
 * Panel registration:
 *   All component IDs registered in panelComponents BEFORE fromJSON (Pitfall 5).
 *   Retired ids ('staging', 'changesets') removed to avoid stranded-panel risk.
 *
 * Reset layout (plan-08 affordance — surfaced by plan-08 menu/status-bar control):
 *   resetLayout() is defined here (apiRef scope) and exposed on window.__resetLayout
 *   so plan-08 can wire it without importing WorkspaceShell internals.
 */

import React, { useRef } from 'react';
import { DockviewReact, DockviewReadyEvent, DockviewApi } from 'dockview';
import type { IDockviewPanelProps } from 'dockview';
import {
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION,
  LAYOUT_VERSION_KEY,
  buildInitialLayout,
} from './workspace-config';

// ─── Panel imports ────────────────────────────────────────────────────────────

import SidebarPanel       from '../panels/SidebarPanel';
import ViewportPanel      from '../panels/ViewportPanel';
import InspectorPanel     from '../panels/InspectorPanel';
import DataPanel          from '../panels/DataPanel';
import LiveInspectorPanel from '../panels/LiveInspectorPanel';
// Plan 04.1-05: 'deploy' replaces retired 'staging' + 'changesets'.
// StagingPanel and ChangesetTimelinePanel are intentionally NOT removed from disk
// until plan 10 (cleanup); they are simply de-registered here.
import DeployPanel        from '../panels/deploy/DeployPanel';
import VcsPanel           from '../panels/deploy/VcsPanel';

// ─── Panel component registry ─────────────────────────────────────────────────
//
// ALL IDs must be registered BEFORE fromJSON is called (Pitfall 5).
// Retired IDs ('staging', 'changesets') are intentionally absent — the version
// guard in onReady ensures their saved layouts are discarded rather than loaded.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const panelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = {
  sidebar:          SidebarPanel,
  viewport:         ViewportPanel,
  inspector:        InspectorPanel,
  data:             DataPanel,
  'live-inspector': LiveInspectorPanel,  // Phase 3: live injection HUD panel (03-06)
  // Plan 05: ONE combined deploy panel; vcs stays separate.
  deploy:           DeployPanel,
  vcs:              VcsPanel,
};

// ─── Width constants for active-panel auto-widen (M3) ────────────────────────

const DEPLOY_WIDTH    = 440;  // combined Deploy panel (staging + history)
const INSPECTOR_WIDTH = 290;  // original Inspector-only width

// ─── WorkspaceShell ───────────────────────────────────────────────────────────

export default function WorkspaceShell(): React.ReactElement {
  const apiRef = useRef<DockviewApi | null>(null);

  // ── onReady: version-guard layout restore + auto-widen handler ────────────

  const onReady = (event: DockviewReadyEvent): void => {
    const api = event.api;
    apiRef.current = api;

    // 1. Register onDidLayoutChange FIRST so initial addPanel calls are persisted.
    //    Also persists the LAYOUT_VERSION_KEY on every layout change so it stays
    //    in sync after the initial write.
    api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
      localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION));
    });

    // 2. Active-panel auto-widen (M3 — DEPLOY-05).
    //    dockview@6.6.1: onDidActivePanelChange fires with no args; use api.activePanel.
    api.onDidActivePanelChange(() => {
      const panel = api.activePanel;
      if (!panel?.group?.api) return;
      if (panel.id === 'deploy') {
        panel.group.api.setSize({ width: DEPLOY_WIDTH });
      } else if (panel.id === 'inspector') {
        panel.group.api.setSize({ width: INSPECTOR_WIDTH });
      }
    });

    // 3. Version-guard restore (D-03 / Pattern 6).
    const savedVer = Number(localStorage.getItem(LAYOUT_VERSION_KEY) ?? '0');
    const saved    = localStorage.getItem(LAYOUT_STORAGE_KEY);

    if (saved && savedVer === LAYOUT_VERSION) {
      // Matching version — restore persisted layout.
      try {
        api.fromJSON(JSON.parse(saved));
      } catch {
        // Corrupted layout (catch JSON.parse or fromJSON errors) → fallback.
        api.clear();
        buildInitialLayout(api);
      }
    } else {
      // Version mismatch (retired panel ids) or first run → build the 008 default.
      // D-03: discard the old layout so returning users are not soft-bricked.
      buildInitialLayout(api);
      localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION));
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
    }
  };

  // ── resetLayout (plan-08 affordance) ─────────────────────────────────────
  //
  // Clears persisted state, rebuilds the 008 default layout in-place.
  // Plan-08 will surface this as a menu or status-bar "Reset layout" control.
  // Exposed on window.__resetLayout for easy access from plan-08 without
  // importing WorkspaceShell internals.

  const resetLayout = (): void => {
    const api = apiRef.current;
    if (!api) return;
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    localStorage.removeItem(LAYOUT_VERSION_KEY);
    api.clear();
    buildInitialLayout(api);
    localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION));
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
  };

  // Expose for plan-08 wiring (window.__* test-hook pattern).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__resetLayout = resetLayout;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <DockviewReact
        className="dockview-theme-dark"
        components={panelComponents}
        onReady={onReady}
      />
    </div>
  );
}
