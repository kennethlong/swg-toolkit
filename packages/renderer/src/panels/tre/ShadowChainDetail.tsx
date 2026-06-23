/**
 * packages/renderer/src/panels/tre/ShadowChainDetail.tsx — Shadow chain display.
 *
 * Shows the full shadow chain for a selected VFS file:
 *   "resolves from: {archive} ✓ wins"  (accent)
 *   "shadows: {lower-archive}"          (muted, no strikethrough)
 *   Tombstone: "deleted here — hides lower archives" (⊘)
 *
 * Source: 01-UI-SPEC.md § "Shadow / override resolution — the must-communicate contract";
 *         01-02-PLAN.md Task 2 (ShadowChainDetail min_lines: 25).
 *
 * Accessibility: state conveyed by glyph + color + label (Rule 1: never color alone).
 */

import React from 'react';
import type { ShadowChainDisplay } from '../../state/treStore.ts';

interface ShadowChainDetailProps {
  chain: ShadowChainDisplay;
}

export default function ShadowChainDetail({
  chain,
}: ShadowChainDetailProps): React.ReactElement {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        padding: 'var(--space-2) var(--space-4)',
        background: 'var(--color-surface-2)',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      {/* Winner line */}
      {chain.tombstone ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            color: 'var(--color-warn)',
          }}
        >
          {/* Accessibility Rule 1: glyph + color + label */}
          <span aria-label="Deleted entry" role="img">⊘</span>
          <span style={{ color: 'var(--color-text-muted)' }}>deleted here — hides lower archives</span>
          <span
            style={{
              color: 'var(--color-text-faint)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
            title={chain.winner.path}
          >
            {chain.winner.filename}
          </span>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
          }}
        >
          <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>resolves from:</span>
          <span
            style={{
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
            title={chain.winner.path}
          >
            {chain.winner.filename}
          </span>
          {/* ✓ wins — accent indicator for the winning archive */}
          <span
            style={{ color: 'var(--color-accent)', flexShrink: 0 }}
            title="Wins the override resolution"
          >
            ✓ wins
          </span>
        </div>
      )}

      {/* Shadow lines */}
      {chain.shadows.map((shadow, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            paddingLeft: 'var(--space-2)',
          }}
        >
          <span style={{ color: 'var(--color-text-faint)', flexShrink: 0 }}>shadows:</span>
          <span
            style={{
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
            title={shadow.path}
          >
            {shadow.filename}
          </span>
        </div>
      ))}
    </div>
  );
}
