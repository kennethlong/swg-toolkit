/**
 * packages/renderer/src/panels/LogPanel.tsx
 * Bottom-pane Log tab — dockview panel component for the 'log' id.
 *
 * Part of the sketch 008 S8 bottom-pane trio: Datatable | Console | Log.
 * Stub pane per plan spec: "Console/Log as present-but-stub panes."
 *
 * Phase 0 seed: renders structured application log entries.
 * Future: structured log viewer with level filters (info/warn/error).
 *
 * Source: 04.3-09-PLAN.md Task 3 (S8).
 */

import React from 'react';
import type { IDockviewPanelProps } from 'dockview';

export default function LogPanel(_props: IDockviewPanelProps): React.ReactElement {
  return (
    <div
      style={{
        display:    'flex',
        flexDirection: 'column',
        height:     '100%',
        background: 'var(--color-surface)',
        color:      'var(--color-text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize:   'var(--text-xs)',
        padding:    'var(--space-3) var(--space-4)',
        lineHeight: 1.7,
        overflow:   'auto',
      }}
    >
      <div>[log]{'  '}contracts/ types compiled · renderer + backend in sync</div>
    </div>
  );
}
