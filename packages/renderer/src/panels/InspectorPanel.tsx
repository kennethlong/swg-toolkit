/**
 * packages/renderer/src/panels/InspectorPanel.tsx
 * RIGHT — Inspector panel.
 * Phase 0 seed state: "No selection".
 *
 * Accessibility Rule 5: aria-label + title on all icon-only controls.
 */

import React, { useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';

export default function InspectorPanel(_props: IDockviewPanelProps): React.ReactElement {
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
        <span
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            fontWeight: 600,
            flex: 1,
          }}
        >
          Inspector
        </span>
        {/* Accessibility Rule 5: aria-label + title on all icon-only controls */}
        <button
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          title={collapsed ? 'Expand panel' : 'Collapse panel'}
          style={actionBtnStyle}
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>

      {/* Panel body (hidden when collapsed) */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            minHeight: 0,
            padding: 'var(--space-3) 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <span>No selection</span>
          <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
            Select an asset in the Assets panel
          </span>
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
