/**
 * packages/renderer/src/shell/Titlebar.tsx
 * App titlebar: logo, app name, menu bar, theme picker, window controls.
 *
 * Per 00-UI-SPEC §Titlebar:
 *   - height var(--titlebar-h) = 30px
 *   - background #1c1c1c, border-bottom 1px var(--color-border)
 *   - -webkit-app-region: drag (container); no-drag on picker + window controls
 *
 * Accessibility Rule 5: aria-label + title on all icon-only / glyph controls.
 */

import React from 'react';
import { THEMES, ThemeName } from '../workspace/workspace-config';

interface TitlebarProps {
  activeTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
}

const THEME_LABELS: Record<ThemeName, string> = {
  cyan:           'Hologram cyan',
  'swg-green':    'SWG green',
  amber:          'Amber',
  blue:           'IDE blue',
  'high-contrast':'High contrast',
};

export default function Titlebar({ activeTheme, onThemeChange }: TitlebarProps): React.ReactElement {
  return (
    <div
      id="app-theme"
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 'var(--titlebar-h)',
        background: '#1c1c1c',
        borderBottom: '1px solid var(--color-border)',
        padding: '0 var(--space-4)',
        gap: 'var(--space-3)',
        flexShrink: 0,
        // Electron drag region
        WebkitAppRegion: 'drag' as unknown as undefined,
        userSelect: 'none',
      } as React.CSSProperties}
    >
      {/* Logo mark */}
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          background: 'linear-gradient(135deg, var(--color-accent) 0%, #3a7a1f 100%)',
          flexShrink: 0,
        }}
      />

      {/* App name */}
      <span
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          letterSpacing: '0.03em',
          color: 'var(--color-text)',
          flexShrink: 0,
        }}
      >
        SWG Toolkit
      </span>

      {/* Menu bar */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          flexShrink: 0,
        }}
      >
        {['File', 'Edit', 'View', 'Asset', 'Window', 'Help'].map(item => (
          <button
            key={item}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              padding: '0 var(--space-3)',
              height: 'var(--titlebar-h)',
              borderRadius: 'var(--radius-sm)',
              transition: 'background 0.12s ease, color 0.12s ease',
              WebkitAppRegion: 'no-drag' as unknown as undefined,
            } as React.CSSProperties}
          >
            {item}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Theme picker */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          WebkitAppRegion: 'no-drag' as unknown as undefined,
        } as React.CSSProperties}
      >
        {/* Theme picker glyph in accent color */}
        <span
          style={{
            color: 'var(--color-accent)',
            fontSize: 'var(--text-sm)',
            lineHeight: 1,
          }}
        >
          ◐
        </span>
        <select
          aria-label="Select theme"
          title="Select theme"
          value={activeTheme}
          onChange={e => onThemeChange(e.target.value as ThemeName)}
          style={{
            background: 'var(--color-widget)',
            border: '1px solid var(--color-border-soft)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text)',
            fontSize: 'var(--text-sm)',
            padding: '2px 4px',
            cursor: 'pointer',
            WebkitAppRegion: 'no-drag' as unknown as undefined,
          } as React.CSSProperties}
        >
          {THEMES.map(t => (
            <option key={t} value={t}>
              {THEME_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {/* Window controls — macOS style circles */}
      {/* Accessibility Rule 5: aria-label + title on all icon-only controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          WebkitAppRegion: 'no-drag' as unknown as undefined,
        } as React.CSSProperties}
      >
        <button
          aria-label="Minimize window"
          title="Minimize window"
          style={windowControlStyle('#e0a13a')}
          onClick={() => { /* Phase 0: visual chrome */ }}
        />
        <button
          aria-label="Maximize window"
          title="Maximize window"
          style={windowControlStyle('#7ec94e')}
          onClick={() => { /* Phase 0: visual chrome */ }}
        />
        <button
          aria-label="Close window"
          title="Close window"
          style={windowControlStyle('#e0584f')}
          onClick={() => { /* Phase 0: visual chrome */ }}
        />
      </div>
    </div>
  );
}

function windowControlStyle(color: string): React.CSSProperties {
  return {
    width: 13,
    height: 13,
    borderRadius: '50%',
    background: color,
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    WebkitAppRegion: 'no-drag' as unknown as undefined,
  } as React.CSSProperties;
}
