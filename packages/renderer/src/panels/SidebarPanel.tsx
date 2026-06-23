/**
 * packages/renderer/src/panels/SidebarPanel.tsx
 * LEFT — Assets panel (Phase 1: TRE VFS Browser).
 *
 * Phase 0 seed body ("No archive mounted") is replaced by <TreVfsBrowser/>.
 * The panel header chrome (drag handle, collapse, split) is preserved.
 *
 * Source: 01-02-PLAN.md Task 2 (replace seed body with TreVfsBrowser);
 *         01-UI-SPEC.md § "Surface 1 — TRE Virtual-Filesystem Browser".
 *
 * Accessibility Rule 5: aria-label + title on all icon-only controls.
 */

import React, { useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import TreVfsBrowser from './tre/TreVfsBrowser.tsx';

export default function SidebarPanel(_props: IDockviewPanelProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Panel head */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 'var(--tabstrip-h)',
          background: 'var(--color-header)',
          borderBottom: '1px solid var(--color-border)',
          padding: '0 var(--space-2)',
          gap: 'var(--space-2)',
          flexShrink: 0,
        }}
      >
        {/* Drag handle */}
        <span
          style={{
            color: 'var(--color-text-faint)',
            cursor: 'grab',
            fontSize: 'var(--text-sm)',
            userSelect: 'none',
            width: 18,
            textAlign: 'center',
          }}
        >
          ⠿
        </span>

        {/* Tab */}
        <span
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            fontWeight: 600,
            flex: 1,
          }}
        >
          Assets
        </span>

        {/* Action buttons */}
        {/* Accessibility Rule 5: aria-label + title on all icon-only controls */}
        <button
          aria-label="Split panel"
          title="Split panel"
          style={actionBtnStyle}
          onClick={() => { /* Phase 0: visual chrome */ }}
        >
          ⊟
        </button>
        {/* Accessibility Rule 5: both labels used (collapsed/expanded states) */}
        {collapsed ? (
          <button
            aria-label="Expand panel"
            title="Expand panel"
            style={actionBtnStyle}
            onClick={() => setCollapsed(false)}
          >
            ▸
          </button>
        ) : (
          <button
            aria-label="Collapse panel"
            title="Collapse panel"
            style={actionBtnStyle}
            onClick={() => setCollapsed(true)}
          >
            ▾
          </button>
        )}
      </div>

      {/* Panel body (hidden when collapsed): Phase 1 TRE VFS Browser */}
      {!collapsed && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TreVfsBrowser />
        </div>
      )}
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-faint)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  padding: 0,
  transition: 'background 0.12s ease, color 0.12s ease',
};
