/**
 * packages/renderer/src/panels/ConsolePanel.tsx
 * Bottom-pane Console tab — dockview panel component for the 'console' id.
 *
 * Part of the sketch 008 S8 bottom-pane trio: Datatable | Console | Log.
 * Stub pane per plan spec: "Console/Log as present-but-stub panes."
 *
 * Phase 0 seed: renders application console messages.
 * Future: live app log stream with filter + search.
 *
 * Source: 04.3-09-PLAN.md Task 3 (S8).
 */

import React from 'react';
import type { IDockviewPanelProps } from 'dockview';

const consoleSeedLines = [
  { ts: '09:30:11', msg: 'native-core addon loaded in renderer process (Path B)' },
  { ts: '09:30:11', msg: 'COOP/COEP set · crossOriginIsolated = true' },
  { ts: '09:30:11', msg: 'contracts/ types compiled · renderer + backend in sync' },
];

export default function ConsolePanel(_props: IDockviewPanelProps): React.ReactElement {
  return (
    <div
      style={{
        display:    'flex',
        flexDirection: 'column',
        height:     '100%',
        background: 'var(--color-surface)',
        color:      'var(--color-text)',
        fontFamily: 'var(--font-mono)',
        fontSize:   'var(--text-xs)',
        padding:    'var(--space-3) var(--space-4)',
        lineHeight: 1.7,
        overflow:   'auto',
      }}
    >
      {consoleSeedLines.map((line, i) => (
        <div key={i} style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: 'var(--color-text-faint)' }}>[{line.ts}]</span>
          <span style={{ color: 'var(--color-text-muted)' }}>{line.msg}</span>
        </div>
      ))}
    </div>
  );
}
