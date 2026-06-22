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

  // Keep in sync if theme changes externally (e.g. from devtools)
  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
  }, [activeTheme]);

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
    </div>
  );
}
