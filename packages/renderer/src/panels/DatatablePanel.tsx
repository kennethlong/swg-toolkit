/**
 * packages/renderer/src/panels/DatatablePanel.tsx
 * Bottom-pane Datatable tab — dockview panel component for the 'datatable' id.
 *
 * Part of the sketch 008 S8 bottom-pane trio: Datatable | Console | Log.
 * Replaces the single 'data' panel (retired in LAYOUT_VERSION 3).
 *
 * Phase 0 seed: renders a placeholder until a DTII datatable is mounted and opened.
 * Future: full datatable editor with rows + columns + cell editing.
 *
 * Source: 04.3-09-PLAN.md Task 3 (S8).
 */

import React from 'react';
import { useNoProjectDimStyle } from '../state/useNoProjectDim';
import type { IDockviewPanelProps } from 'dockview';

export default function DatatablePanel(_props: IDockviewPanelProps): React.ReactElement {
  const dimStyle = useNoProjectDimStyle();

  return (
    <div
      style={{
        display:    'flex',
        flexDirection: 'column',
        height:     '100%',
        background: 'var(--color-surface)',
        color:      'var(--color-text)',
        fontFamily: 'var(--font-sans)',
        ...dimStyle,
      }}
    >
      <div
        style={{
          flex:       1,
          fontFamily: 'var(--font-mono)',
          fontSize:   'var(--text-xs)',
          color:      'var(--color-text-faint)',
          padding:    'var(--space-3) var(--space-4)',
        }}
      >
        <div>[no datatable loaded]</div>
        <div>Mount an archive and open a .iff datatable to populate this view.</div>
      </div>
    </div>
  );
}
