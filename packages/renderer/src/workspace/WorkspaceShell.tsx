/**
 * packages/renderer/src/workspace/WorkspaceShell.tsx
 * DockviewReact wrapper with layout persistence.
 *
 * Persistence:
 *   onReady   → try api.fromJSON(localStorage) → fallback to buildInitialLayout
 *   onDidLayoutChange → api.toJSON() → localStorage
 *
 * Panel registration: all four components are registered in `panelComponents`
 * BEFORE fromJSON is called (RESEARCH Pitfall 5).
 */

import React, { useRef } from 'react';
import { DockviewReact, DockviewReadyEvent, DockviewApi } from 'dockview';
import type { IDockviewPanelProps } from 'dockview';
import { LAYOUT_STORAGE_KEY, buildInitialLayout } from './workspace-config';
import SidebarPanel        from '../panels/SidebarPanel';
import ViewportPanel       from '../panels/ViewportPanel';
import InspectorPanel      from '../panels/InspectorPanel';
import DataPanel           from '../panels/DataPanel';
import LiveInspectorPanel  from '../panels/LiveInspectorPanel';

// Panel component registry — all IDs registered before fromJSON (Pitfall 5)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const panelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = {
  sidebar:          SidebarPanel,
  viewport:         ViewportPanel,
  inspector:        InspectorPanel,
  data:             DataPanel,
  'live-inspector': LiveInspectorPanel,  // Phase 3: live injection HUD panel (03-06)
};

export default function WorkspaceShell(): React.ReactElement {
  const apiRef = useRef<DockviewApi | null>(null);

  const onReady = (event: DockviewReadyEvent): void => {
    apiRef.current = event.api;

    // Register onDidLayoutChange FIRST so that initial panel additions
    // (from buildInitialLayout) trigger the save handler.
    // This ensures localStorage is populated immediately after first render —
    // required by the SC-5 E2E assertion (04-workspace.spec.ts).
    event.api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(event.api.toJSON()));
    });

    // Restore persisted layout or fall back to default
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      try {
        event.api.fromJSON(JSON.parse(saved));
      } catch {
        // Corrupted or incompatible layout — fall back to default
        buildInitialLayout(event.api);
        // Explicitly save after fallback (fromJSON corruption path)
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(event.api.toJSON()));
      }
    } else {
      buildInitialLayout(event.api);
      // Explicitly save the initial layout (onDidLayoutChange may not fire for
      // the first addPanel batch before the handler was attached in older dockview)
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(event.api.toJSON()));
    }
  };

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
