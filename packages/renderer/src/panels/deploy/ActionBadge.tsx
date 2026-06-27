/**
 * packages/renderer/src/panels/deploy/ActionBadge.tsx
 * Reusable staging-action glyph + color + label badge (DEPLOY-02 / Rule 1).
 *
 * Triple-encoded per Accessibility Rule 1 (state never color alone):
 *   glyph  — visual shape (aria-hidden)
 *   color  — semantic color token
 *   label  — text caption (always visible for badge context)
 *
 * Follows VerificationStatus triple-encode pattern exactly.
 *
 * Source: 04-PATTERNS.md §ActionBadge.tsx; 04-UI-SPEC.md §Surface 2 (color table).
 */

import React from 'react';
import type { StagingAction } from '@swg/contracts';

// ─── Config ───────────────────────────────────────────────────────────────────

/** Visual configuration for each staging action. */
const ACTION_CONFIG: Record<StagingAction, { glyph: string; label: string; colorVar: string }> = {
  add:    { glyph: '+',  label: 'add',                  colorVar: 'var(--color-info)'       },
  modify: { glyph: '~',  label: 'modify',               colorVar: 'var(--color-text-muted)' },
  delete: { glyph: '⊘', label: 'delete (tombstone)',    colorVar: 'var(--color-warn)'       },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface ActionBadgeProps {
  action: StagingAction;
}

/**
 * Compact badge showing staging action (add / modify / delete) with
 * glyph + color + label (triple-encoded per Accessibility Rule 1).
 */
export default function ActionBadge({ action }: ActionBadgeProps): React.ReactElement {
  const { glyph, label, colorVar } = ACTION_CONFIG[action];
  return (
    <span
      aria-label={label}
      title={label}
      style={{
        display:     'inline-flex',
        alignItems:  'center',
        gap:         'var(--space-1)',
        color:       colorVar,
        fontFamily:  'var(--font-mono)',
        fontSize:    'var(--text-xs)',
        flexShrink:  0,
      }}
    >
      {/* Glyph — aria-hidden so screen readers rely on aria-label on the wrapper */}
      <span aria-hidden="true">{glyph}</span>
      {/* Label — always visible */}
      <span>{label}</span>
    </span>
  );
}
