/**
 * packages/renderer/src/panels/editors/shared/crumbButtonStyles.ts
 * Shared crumb-bar button style constants — extracted from DatatableGridEditor.tsx's inline
 * styles (05-06/05-08) so the .stf editor (05-09) can reuse the EXACT same ghost/primary button
 * look without duplicating the style object inline, per 05-09-PLAN.md Task 1's action text
 * ("reuse the exact button styling from DatatableGridEditor — extract a small shared style
 * constant if one does not already exist, rather than duplicating inline styles").
 *
 * DatatableGridEditor.tsx itself is NOT refactored to consume these constants in this plan
 * (out of 05-09's file scope) — they are extracted verbatim from its existing inline styles so
 * a future pass can converge both editors onto this single source without a visual diff.
 */

import type { CSSProperties } from 'react';

/** Ghost (secondary) crumb-bar button — e.g. "＋ Stage", "＋ Add key". */
export const ghostButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-soft)',
  color: 'var(--color-text)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px 8px',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-xs)',
};

/** Disabled ghost crumb-bar button — e.g. "⇄ Compare to base" (015 diff surface not yet designed). */
export const disabledGhostButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-soft)',
  color: 'var(--color-text-faint)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px 8px',
  cursor: 'not-allowed',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-xs)',
};

/** Primary crumb-bar CTA — "Save · run gate". */
export const primaryButtonStyle: CSSProperties = {
  background: 'var(--color-accent-dim)',
  border: '1px solid var(--color-accent-line)',
  color: 'var(--color-accent)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px 10px',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontWeight: 600,
  fontSize: 'var(--text-xs)',
};
