/**
 * packages/renderer/src/panels/deploy/ActionBadge.tsx
 * Reusable staging-action pill badge — DEPLOY-02 / Rule 1 + DEPLOYUI-06/D8 (plan 04.3-07).
 *
 * 04.3-07 changes (D8):
 *   - Restyled as a pill (bg + border) per sketch 005-B/006-D
 *   - 'modify' action label changed from "changed" → "modify"
 *
 * Triple-encoded per Accessibility Rule 1 (state never color alone):
 *   glyph  — visual shape (aria-hidden)
 *   color  — semantic color token
 *   label  — text caption (always visible for badge context)
 *
 * Source: 04-PATTERNS.md §ActionBadge.tsx; 04-UI-SPEC.md §Surface 2; 04.3-07-PLAN.md Task 2.
 */

import React from 'react';
import type { StagingAction } from '@swg/contracts';

// ─── Config ───────────────────────────────────────────────────────────────────

/** Visual configuration for each staging action. */
const ACTION_CONFIG: Record<
  StagingAction,
  { glyph: string; label: string; colorVar: string; bgVar: string; borderVar: string }
> = {
  //                                                 D8: label is "modify" (was "changed")
  add:    { glyph: '+',  label: 'add',    colorVar: 'var(--color-info)',    bgVar: 'rgba(74,140,255,.12)',    borderVar: 'rgba(74,140,255,.3)'     },
  modify: { glyph: '~',  label: 'modify', colorVar: 'var(--color-text-muted)', bgVar: 'rgba(255,255,255,.05)', borderVar: 'var(--color-border-soft)' },
  delete: { glyph: '⊘', label: 'delete', colorVar: 'var(--color-warn)',    bgVar: 'rgba(224,161,58,.12)',    borderVar: 'rgba(224,161,58,.3)'      },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface ActionBadgeProps {
  action: StagingAction;
}

/**
 * Compact pill badge showing staging action (add / modify / delete) with
 * glyph + color + label (triple-encoded per Accessibility Rule 1).
 *
 * D8: styled as a pill (bg + border + padding) per sketch 005-B/006-D.
 */
export default function ActionBadge({ action }: ActionBadgeProps): React.ReactElement {
  const { glyph, label, colorVar, bgVar, borderVar } = ACTION_CONFIG[action];
  return (
    <span
      aria-label={label}
      title={label}
      data-testid="action-badge"
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          3,
        color:        colorVar,
        background:   bgVar,
        border:       `1px solid ${borderVar}`,
        borderRadius: 999,
        padding:      '1px 5px',
        fontFamily:   'var(--font-mono)',
        fontSize:     10,
        flexShrink:   0,
        whiteSpace:   'nowrap',
      }}
    >
      {/* Glyph — aria-hidden so screen readers rely on aria-label on the wrapper */}
      <span aria-hidden="true">{glyph}</span>
      {/* Label — always visible */}
      <span>{label}</span>
    </span>
  );
}
