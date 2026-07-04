/**
 * packages/renderer/src/App.tsx
 * Root component: theme persistence + full-height flex column layout.
 *
 * Theme lifecycle:
 *   1. On mount: read THEME_STORAGE_KEY from localStorage
 *   2. Apply data-theme attribute synchronously (before first paint — no flash)
 *   3. Render <Titlebar>, <WorkspaceShell>, <StatusBar>
 *   4. Theme changes propagate via dataset.theme + localStorage
 *
 * Layout: 100vh flex column (overflow hidden)
 *   ┌──────────────────────────────────────┐
 *   │  Titlebar (--titlebar-h)             │
 *   ├──────────────────────────────────────┤
 *   │  WorkspaceShell (flex 1)             │
 *   ├──────────────────────────────────────┤
 *   │  StatusBar (--statusbar-h)           │
 *   └──────────────────────────────────────┘
 */

import React, { useState, useEffect } from 'react';
import { THEMES, ThemeName, THEME_STORAGE_KEY } from './workspace/workspace-config';
import Titlebar       from './shell/Titlebar';
import StatusBar      from './shell/StatusBar';
import WorkspaceShell from './workspace/WorkspaceShell';
import ProjectListDialog from './panels/deploy/ProjectListDialog';
import DeleteUndoToast from './panels/deploy/DeleteUndoToast';
import { useDeleteUndoStore } from './state/deleteUndoStore';

function getInitialTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && THEMES.includes(stored as ThemeName)) {
      return stored as ThemeName;
    }
  } catch {
    // localStorage unavailable
  }
  return 'cyan';
}

// Apply the theme synchronously before React renders (no flash)
const initialTheme = getInitialTheme();
document.documentElement.dataset.theme = initialTheme;

export default function App(): React.ReactElement {
  const [activeTheme, setActiveTheme] = useState<ThemeName>(initialTheme);
  const [trashWarnings, setTrashWarnings] = useState<string[]>([]);

  // Keep in sync if theme changes externally (e.g. from devtools)
  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
  }, [activeTheme]);

  // Session-scoped stale-trash purge (04.4-01 Task 3): every entry present in .trash/ at the
  // START of a new session is by definition from a PRIOR session (this session hasn't deleted
  // anything yet). MARKED entries (round-3: provably complete — entryDir/.complete.json present)
  // are purged unconditionally here on boot, avoiding a dependency on Electron's before-quit
  // event firing reliably. UNMARKED entries (a crash interrupted a prior session's park) are
  // left on disk by purgeStaleTrash() — this effect SURFACES those warnings rather than
  // silently swallowing them: console.warn (picked up by whatever console-capture lands from
  // 04.4-02/04.4-11 without importing their modules) plus a small, self-contained, dismissible,
  // non-blocking banner below. Runs BEFORE any project list is meaningfully interacted with.
  useEffect(() => {
    const { warnings } = useDeleteUndoStore.getState().purgeStaleTrash();
    if (warnings.length > 0) {
      warnings.forEach((w) => console.warn('[App] stale trash (unmarked entry):', w));
      setTrashWarnings(warnings);
    }
  }, []);

  const handleThemeChange = (theme: ThemeName): void => {
    setActiveTheme(theme);
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--color-bg)',
      }}
    >
      <Titlebar
        activeTheme={activeTheme}
        onThemeChange={handleThemeChange}
      />
      <WorkspaceShell />
      <StatusBar />
      {/* In-app "Open Project" dialog — full-window overlay, toggled via openProjectStore. */}
      <ProjectListDialog />
      {/* 04.4-10: global 8s undo toast for delete-project-with-restore (sketch 017 element #14) —
          a single sibling mount point, reacts to useDeleteUndoStore.pending regardless of which
          row surface (WorkspaceEntry recents or ProjectListDialog) triggered the delete/restore. */}
      <DeleteUndoToast />
      {/* 04.4-01 Task 3: non-blocking banner for UNMARKED (crash-mid-park) trash entries found
          on startup. A plain conditional <div> — does NOT import a toast component from
          04.4-10 (that plan depends on THIS one, not the reverse). */}
      {trashWarnings.length > 0 && (
        <div
          role="alert"
          data-testid="stale-trash-warning-banner"
          style={{
            position: 'fixed',
            bottom: 32,
            right: 12,
            maxWidth: 420,
            background: 'var(--color-bg-elevated, #2a2a2a)',
            border: '1px solid var(--color-warning, #d9a441)',
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 12,
            color: 'var(--color-text, #eee)',
            zIndex: 9999,
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <strong>Incomplete delete(s) found from a prior session</strong>
            <button
              type="button"
              onClick={() => setTrashWarnings([])}
              aria-label="Dismiss incomplete-delete warning"
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
            {trashWarnings.map((w, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
