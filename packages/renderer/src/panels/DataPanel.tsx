/**
 * packages/renderer/src/panels/DataPanel.tsx
 * BOTTOM — Data pane with Datatable | Console | Log tabs.
 * Phase 0 seed states per 00-UI-SPEC §Console seed state.
 *
 * Accessibility Rule 5: aria-label + title on all icon-only controls.
 */

import React, { useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';

type TabId = 'datatable' | 'console' | 'log';

// Phase 0 Console seed lines (timestamps are fixed for the seed state)
const consoleSeedLines = [
  { ts: '09:30:11', msg: 'native-core addon loaded in renderer process (Path B, pid —)' },
  { ts: '09:30:11', msg: 'cmake-js build: ok · node-addon-api 8 · electron 42 abi' },
  { ts: '09:30:11', msg: 'COOP/COEP set · crossOriginIsolated = true' },
  { ts: '09:30:11', msg: 'SharedArrayBuffer round-trip: PASS (4 bytes, in-process)' },
  { ts: '09:30:11', msg: 'contracts/ types compiled · renderer + backend in sync' },
];

export default function DataPanel(_props: IDockviewPanelProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>('datatable');
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
      {/* Panel head: tabs + action buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 'var(--tabstrip-h)',
          background: 'var(--color-header)',
          borderBottom: '1px solid var(--color-border)',
          padding: '0 var(--space-2)',
          gap: 0,
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
            marginRight: 'var(--space-2)',
          }}
        >
          ⠿
        </span>

        {/* Tabs */}
        {(['datatable', 'console', 'log'] as TabId[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? 'var(--color-surface)' : 'transparent',
              border: 'none',
              borderRight: '1px solid var(--color-border)',
              borderBottom: activeTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--color-text)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              padding: '0 var(--space-4)',
              height: 'var(--tabstrip-h)',
              transition: 'background 0.12s ease',
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}

        {/* Add tab button */}
        {/* Accessibility Rule 5: aria-label + title on all icon-only controls */}
        <button
          aria-label="Add tab"
          title="Add tab"
          style={{
            background: 'transparent',
            border: 'none',
            borderRight: '1px solid var(--color-border)',
            color: 'var(--color-text-faint)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            padding: '0 var(--space-3)',
            height: 'var(--tabstrip-h)',
            transition: 'color 0.12s ease',
          }}
          onClick={() => { /* Phase 0: visual chrome */ }}
        >
          +
        </button>

        <div style={{ flex: 1 }} />

        {/* Collapse button — Accessibility Rule 5: both labels for each state */}
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

      {/* Panel body */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            minHeight: 0,
          }}
        >
          {/* Datatable tab */}
          {activeTab === 'datatable' && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-faint)',
                padding: '8px 12px',
              }}
            >
              <div>[no datatable loaded]</div>
              <div>Mount an archive and open a .iff datatable</div>
            </div>
          )}

          {/* Console tab */}
          {activeTab === 'console' && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                padding: '8px 12px',
                lineHeight: 1.7,
              }}
            >
              {consoleSeedLines.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--color-text-faint)' }}>[{line.ts}]</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {/* Highlight success tokens in accent color */}
                    {highlightSuccessTokens(line.msg)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Log tab */}
          {activeTab === 'log' && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                padding: '8px 12px',
                lineHeight: 1.7,
              }}
            >
              [log]{'  '}contracts/ types compiled · renderer + backend in sync
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Highlight success tokens (ok, true, PASS, addon names) in --color-accent.
 * Returns an array of React nodes.
 */
function highlightSuccessTokens(text: string): React.ReactNode {
  // Match tokens that should be colored in accent
  const accentPattern = /\b(ok|true|PASS|native-core|in sync)\b/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = accentPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} style={{ color: 'var(--color-accent)' }}>
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
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
