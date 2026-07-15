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

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { DockviewReact, DockviewReadyEvent, DockviewApi } from 'dockview';
import type { IDockviewPanelProps } from 'dockview';
import {
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION,
  LAYOUT_VERSION_KEY,
  buildInitialLayout,
} from './workspace-config';
import { setActiveDockPanel } from '../state/dockStateStore';
import { installTestHooks } from '../testHooks';

// SWG_TEST_MODE hook surface (04.4-09 Task 2, D-08): installed as a PLAIN STATEMENT at
// MODULE SCOPE (not inside a useEffect/component body) so window.__testHooks exists the
// instant this module is evaluated — before React's first render commits. WorkspaceShell.tsx
// is unconditionally, statically imported by App.tsx on every boot (verified 2026-07-03 — the
// Welcome/recents screen is itself one of this file's dockview panels), so this closes even
// the small effect-timing gap a useEffect would leave for Welcome/New-Project-screen specs.
// No-op unless SWG_TEST_MODE=1 (installTestHooks() itself gates on the env var).
installTestHooks();

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
// Plan 04.3-09 (S8): Console / Log pair (was Datatable / Console / Log trio — the 'datatable'
// placeholder is retired in 05-08; see DatatableGridEditor below).
import ConsolePanel       from '../panels/ConsolePanel';
import LogPanel           from '../panels/LogPanel';
// 05-08: DTII grid editor — opens as a DYNAMIC per-file main-editor-group tab via
// editorTabs.ts's openEditorTab (NOT a static singleton panel id like 'inspector'/'deploy'),
// which is why it is deliberately excluded from PANEL_TITLES/PANEL_REOPEN_POSITIONS/
// STATIC_PANEL_IDS below (the generic "reopen closed panel" menu assumes a fixed id with no
// required params, which per-file editor tabs do not have).
import DatatableGridEditor from '../panels/editors/DatatableGridEditor';

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
  // 'data' kept for backward-compat fallback (LAYOUT_VERSION 3 discards old layouts via
  // version guard, but keeping the registration avoids stranded-panel crashes if someone
  // has an older layout from before the version bump).
  data:             DataPanel,
  'live-inspector': LiveInspectorPanel,  // Phase 3: live injection HUD panel (03-06)
  // Plan 05: ONE combined deploy panel; vcs stays separate.
  deploy:           DeployPanel,
  vcs:              VcsPanel,
  // Plan 09 (S8): Console / Log pair (replaces single 'data' in new layouts; 'datatable'
  // placeholder retired in 05-08 — see 'datatable-grid-editor' below).
  console:          ConsolePanel,
  log:              LogPanel,
  // 05-08: dynamic per-file DTII editor tab component — registered so dockview can render
  // instances opened via editorTabs.openEditorTab(dockApi, { component: 'datatable-grid-editor', ... }).
  // Deliberately NOT added to STATIC_PANEL_IDS (see import comment above).
  'datatable-grid-editor': DatatableGridEditor,
};

/**
 * Static, reopenable SINGLETON panel ids — used by the "reopen closed panel" menu below.
 * Deliberately EXCLUDES dynamic per-file editor tab components (e.g. 'datatable-grid-editor'),
 * which are opened via editorTabs.ts's openEditorTab with a per-file id + required params, not
 * through this generic menu (which assumes a fixed id and no required params — reopening
 * 'datatable-grid-editor' with no params would crash the panel). 05-08.
 */
const STATIC_PANEL_IDS = [
  'sidebar', 'viewport', 'inspector', 'data', 'live-inspector', 'deploy', 'vcs', 'console', 'log',
] as const;

// ─── Width constants for active-panel auto-widen (M3) ────────────────────────

const DEPLOY_WIDTH    = 440;  // combined Deploy panel (staging + history)
const INSPECTOR_WIDTH = 290;  // original Inspector-only width

// ─── Panel display metadata (plan-08 reopen affordance) ──────────────────────

/** Human-readable title for each registered panel. */
const PANEL_TITLES: Record<string, string> = {
  sidebar:          'Assets',
  viewport:         'Viewport',
  inspector:        'Inspect',   // S4 (sketch 008): renamed from 'Inspector'
  data:             'Data',      // retired but kept for backward compat registration
  'live-inspector': 'Live Inspector',
  deploy:           'Deploy',
  vcs:              'Version Control',
  // Plan 09 (S8): bottom-pane pair ('datatable' placeholder retired in 05-08)
  console:          'Console',
  log:              'Log',
};

/**
 * Where to add a panel when reopening it (mirrors buildInitialLayout positions).
 * If the reference panel has also been closed, dockview will create a new group.
 */
const PANEL_REOPEN_POSITIONS: Record<string, { direction: string; referencePanel?: string }> = {
  sidebar:          { direction: 'left',   referencePanel: 'viewport' },
  viewport:         { direction: 'within', referencePanel: 'viewport' },
  inspector:        { direction: 'right',  referencePanel: 'viewport' },
  data:             { direction: 'below',  referencePanel: 'viewport' },
  'live-inspector': { direction: 'within', referencePanel: 'inspector' },
  deploy:           { direction: 'within', referencePanel: 'inspector' },
  vcs:              { direction: 'within', referencePanel: 'inspector' },
  // Plan 09 (S8): bottom-pane pair reopen positions ('datatable' placeholder retired in 05-08)
  console:          { direction: 'below',  referencePanel: 'viewport' },
  log:              { direction: 'within', referencePanel: 'console' },
};

// ─── WorkspaceShell ───────────────────────────────────────────────────────────

export default function WorkspaceShell(): React.ReactElement {
  const apiRef    = useRef<DockviewApi | null>(null);
  const menuRef   = useRef<HTMLDivElement>(null);

  // ── Layout menu state (plan-08 affordance) ────────────────────────────────
  //
  // Closed panels are computed ON OPEN from the live api.panels list so the
  // list is always fresh (no stale state from panel add/remove events).

  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [closedPanels,   setClosedPanels]   = useState<Array<{ id: string; title: string }>>([]);

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
      let width = INSPECTOR_WIDTH;
      if (panel.id === 'deploy') {
        width = DEPLOY_WIDTH;
        panel.group.api.setSize({ width });
      } else if (panel.id === 'inspector') {
        panel.group.api.setSize({ width });
      }
      // S6: update dock state so StatusBar sb-state chip reflects active panel (plan 09)
      setActiveDockPanel(panel.id, width);
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

  // ── activatePanel (Extract→Add affordance) ───────────────────────────────
  //
  // Bring a panel to the front of its tab group (e.g. activate 'deploy' so an
  // Extract→Add from the TRE browser is visibly staged). Reopens the panel if it
  // was closed. Exposed on window.__activatePanel (same window.__* pattern).
  const activatePanel = (id: string): void => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    // Closed → reopen it next to the inspector (mirrors buildInitialLayout placement).
    const pos = PANEL_REOPEN_POSITIONS[id] as { direction: string; referencePanel?: string } | undefined;
    api.addPanel({
      id,
      component: id,
      title: PANEL_TITLES[id] ?? id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(pos ? { position: pos as any } : {}),
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__activatePanel = activatePanel;

  // ── Layout menu handlers (plan-08 affordance) ─────────────────────────────

  /** Open the layout dropdown and compute closed panels at this instant. */
  const handleLayoutMenuOpen = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    // Compute closed panel ids: registered ids not currently in api.panels
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openIds = new Set((api as any).panels?.map((p: { id: string }) => p.id) ?? []);
    // 05-08: iterate the curated STATIC_PANEL_IDS list, NOT Object.keys(panelComponents) — the
    // latter would include 'datatable-grid-editor' (a dynamic per-file template component with
    // no fixed id/params), which would crash if "reopened" through this generic menu.
    const closed = STATIC_PANEL_IDS
      .filter((id) => !openIds.has(id))
      .map((id) => ({ id, title: PANEL_TITLES[id] ?? id }));
    setClosedPanels(closed);
    setLayoutMenuOpen(true);
  }, []);

  /** Re-add a closed panel. Guards against duplicate ids (T-04.1-20). */
  const handleReopenPanel = useCallback((panelId: string) => {
    const api = apiRef.current;
    if (!api) return;
    // Guard: don't add if already open (T-04.1-20)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const already = (api as any).panels?.find((p: { id: string }) => p.id === panelId);
    if (already) { setLayoutMenuOpen(false); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pos = PANEL_REOPEN_POSITIONS[panelId] as any;
    api.addPanel({
      id:        panelId,
      component: panelId,
      title:     PANEL_TITLES[panelId] ?? panelId,
      ...(pos ? { position: pos } : {}),
    });
    setLayoutMenuOpen(false);
  }, []);

  // Close layout menu when user clicks outside of it (standard dropdown behaviour).
  useEffect(() => {
    if (!layoutMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setLayoutMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [layoutMenuOpen]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>

      {/* ── Layout toolbar (plan-08: discoverable Reset layout + Reopen panel) ── */}
      {/*
       * Thin 22px chrome bar that sits ABOVE the dockview pane.
       * Matches --statusbar-h (22px) so it doesn't compete with panel header chrome.
       * Keyboard-accessible: button has a visible focus ring; menu items are buttons
       * with role="menuitem" (Accessibility Rule 5 — no icon-only controls here).
       */}
      <div
        ref={menuRef}
        style={{
          display:      'flex',
          alignItems:   'center',
          height:       'var(--statusbar-h)',
          background:   'var(--color-header)',
          borderBottom: '1px solid var(--color-border)',
          paddingLeft:  'var(--space-2)',
          gap:          'var(--space-2)',
          flexShrink:   0,
          position:     'relative',
          zIndex:       10,
        }}
      >
        {/* Layout menu button */}
        <button
          aria-label="Layout menu — reset layout or reopen closed panels"
          aria-haspopup="menu"
          aria-expanded={layoutMenuOpen}
          title="Reset layout or reopen closed panels"
          onClick={layoutMenuOpen ? () => setLayoutMenuOpen(false) : handleLayoutMenuOpen}
          style={{
            background:   'transparent',
            border:       'none',
            color:        'var(--color-text-muted)',
            cursor:       'pointer',
            fontFamily:   'var(--font-sans)',
            fontSize:     'var(--text-xs)',
            fontWeight:   600,
            padding:      '1px 6px',
            borderRadius: 'var(--radius-sm)',
            outline:      'none',
            flexShrink:   0,
          }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--focus-ring)'; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'; }}
        >
          Layout ▾
        </button>

        {/* Layout dropdown menu */}
        {layoutMenuOpen && (
          <div
            role="menu"
            aria-label="Layout options"
            style={{
              position:     'absolute',
              top:          'calc(100% + 2px)',
              left:         'var(--space-2)',
              background:   'var(--color-surface)',
              border:       '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              boxShadow:    '0 4px 12px rgba(0,0,0,0.4)',
              minWidth:     160,
              zIndex:       100,
              display:      'flex',
              flexDirection: 'column',
              padding:      '3px 0',
            }}
          >
            {/* Reset layout */}
            <button
              role="menuitem"
              onClick={() => { resetLayout(); setLayoutMenuOpen(false); }}
              title="Discard the current layout and rebuild the default arrangement"
              style={{
                background:  'transparent',
                border:      'none',
                color:       'var(--color-text)',
                cursor:      'pointer',
                fontFamily:  'var(--font-sans)',
                fontSize:    'var(--text-xs)',
                padding:     '4px var(--space-4)',
                textAlign:   'left',
                outline:     'none',
                whiteSpace:  'nowrap',
              }}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--focus-ring)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-2)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              Reset layout
            </button>

            {/* Reopen closed panels — only shown when there are closed panels */}
            {closedPanels.length > 0 && (
              <>
                <div
                  role="separator"
                  style={{ borderTop: '1px solid var(--color-border)', margin: '3px 0' }}
                />
                <span
                  style={{
                    padding:     '2px var(--space-4)',
                    fontSize:    'var(--text-xs)',
                    color:       'var(--color-text-muted)',
                    fontFamily:  'var(--font-sans)',
                    userSelect:  'none',
                    fontWeight:  600,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                  }}
                >
                  Reopen panel
                </span>
                {closedPanels.map(({ id, title }) => (
                  <button
                    key={id}
                    role="menuitem"
                    onClick={() => handleReopenPanel(id)}
                    title={`Reopen the ${title} panel`}
                    style={{
                      background:  'transparent',
                      border:      'none',
                      color:       'var(--color-text)',
                      cursor:      'pointer',
                      fontFamily:  'var(--font-sans)',
                      fontSize:    'var(--text-xs)',
                      padding:     '4px var(--space-4)',
                      textAlign:   'left',
                      outline:     'none',
                      whiteSpace:  'nowrap',
                    }}
                    onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--focus-ring)'; }}
                    onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-2)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    {title}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <DockviewReact
        className="dockview-theme-dark"
        components={panelComponents}
        onReady={onReady}
      />
    </div>
  );
}
