/**
 * packages/renderer/src/shared/VerificationStatus.tsx — Verification status pill.
 *
 * Renders a glyph + color + mono caption status indicator.
 * Triple-encoded per Accessibility Rule 1 (state never color alone):
 *   glyph   — visual shape/icon
 *   color   — semantic color token
 *   caption — text label (always present; may be visually hidden for compact mode)
 *
 * Used by IffStructureTree for round-trip and trailing-bytes status.
 * Extensible for future verification surfaces.
 *
 * Source: 01-UI-SPEC.md § "Semantic-state color is always paired with a glyph"
 *         Accessibility Rule 1 (state never color-alone).
 *
 * Tokens: --color-accent (pass), --color-danger (fail), --color-warn (warn),
 *         --color-text-muted (neutral), --text-xs (mono caption).
 */

import React from 'react';

export type VerificationVariant =
  | 'pass'        // byte-exact ✓
  | 'fail'        // round-trip FAIL
  | 'warn'        // trailing bytes or enumerate-only
  | 'parse-error' // IFF parse error
  | 'running'     // in-progress (Phase 5 gate machine — 05-UI-SPEC.md Surface 2 item 7:
                  // "running: info text, dashed border" — pair with dashedBorder prop below)
  | 'neutral';    // informational

/** Configuration for each variant. */
const VARIANT_CONFIG: Record<
  VerificationVariant,
  { glyph: string; colorVar: string; ariaRole?: string }
> = {
  'pass':        { glyph: '✓', colorVar: 'var(--color-accent)' },
  'fail':        { glyph: '✕', colorVar: 'var(--color-danger)' },
  'warn':        { glyph: '▴', colorVar: 'var(--color-warn)' },
  'parse-error': { glyph: '✕', colorVar: 'var(--color-danger)', ariaRole: 'alert' },
  'running':     { glyph: '⋯', colorVar: 'var(--color-info)' },
  'neutral':     { glyph: '·', colorVar: 'var(--color-text-muted)' },
};

export interface VerificationStatusProps {
  variant: VerificationVariant;
  /** Text caption shown next to the glyph (mono --text-xs). */
  caption: string;
  /** Optional additional aria-label (e.g. for the glyph alone). */
  ariaLabel?: string;
  /** Compact mode: hide the caption visually (still in the DOM for a11y). */
  compact?: boolean;
  /**
   * Wrap the pill in a dashed border of the variant's color. Used by the Phase-5 gate machine's
   * 'running' state ("info text, dashed border" — 05-UI-SPEC.md Surface 2 item 7), which needs a
   * border-style change on top of the existing glyph+color+caption triple-encoding, not just a
   * color swap. Defaults to false so every pre-existing call site (IffStructureTree etc.) renders
   * identically to before.
   */
  dashedBorder?: boolean;
}

export default function VerificationStatus({
  variant,
  caption,
  ariaLabel,
  compact = false,
  dashedBorder = false,
}: VerificationStatusProps): React.ReactElement {
  const { glyph, colorVar, ariaRole } = VARIANT_CONFIG[variant];

  const pill = (
    <span
      role={ariaRole}
      aria-label={ariaLabel ?? caption}
      title={caption}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        color: colorVar,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        flexShrink: 0,
      }}
    >
      <span aria-hidden="true">{glyph}</span>
      <span
        style={
          compact
            ? {
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
                clip: 'rect(0,0,0,0)',
                whiteSpace: 'nowrap',
              }
            : undefined
        }
      >
        {caption}
      </span>
    </span>
  );

  if (!dashedBorder) return pill;

  return (
    <span
      data-dashed-border="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: `1px dashed ${colorVar}`,
        borderRadius: 'var(--radius-sm)',
        padding: '1px 6px',
      }}
    >
      {pill}
    </span>
  );
}
