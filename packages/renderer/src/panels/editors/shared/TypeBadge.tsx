/**
 * packages/renderer/src/panels/editors/shared/TypeBadge.tsx
 * Shared DTII column-type badge — extracted from DatatableGridEditor.tsx (05-06) so
 * SchemaRail.tsx (05-08) can reuse the EXACT same badge component/colors for its
 * `Schema · COLS / TYPE` rail section, per this plan's action text ("reuse the exact badge
 * component/colors from 05-06's grid header").
 *
 * D-07/Errata 2 (05-UI-SPEC.md): widened beyond s/i/f to all 9 non-Comment DTII types — same
 * letter+color-reinforcement idiom, sketch-locked fixed hexes (do NOT theme-switch).
 */

import React from 'react';
import type { TypeSpecInfo } from '../dtiiTypeSpec';

export const BADGE_STYLES: Record<TypeSpecInfo['kind'], { letter: string; color: string; bg: string }> = {
  int:            { letter: 'i', color: '#7dd68a', bg: 'rgba(160,255,170,.10)' },
  float:          { letter: 'f', color: '#e8b46a', bg: 'rgba(255,200,120,.12)' },
  string:         { letter: 's', color: '#7fb2ff', bg: 'rgba(120,180,255,.13)' },
  hashstring:     { letter: 'h', color: '#c58aff', bg: 'rgba(197,138,255,.12)' },
  bool:           { letter: 'b', color: '#ff8ac5', bg: 'rgba(255,138,197,.12)' },
  enum:           { letter: 'e', color: '#8affea', bg: 'rgba(138,255,234,.12)' },
  bitvector:      { letter: 'v', color: '#ffd98a', bg: 'rgba(255,217,138,.12)' },
  packedObjVars:  { letter: 'p', color: '#c5ff8a', bg: 'rgba(197,255,138,.12)' },
  'enum-table':   { letter: 'e', color: '#8affea', bg: 'rgba(138,255,234,.12)' },
  unknown:        { letter: '?', color: '#9a9a9a', bg: 'rgba(154,154,154,.12)' },
};

export function TypeBadge({ kind }: { kind: TypeSpecInfo['kind'] }): React.ReactElement {
  const style = BADGE_STYLES[kind];
  return (
    <span
      data-testid="type-badge"
      data-kind={kind}
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: '10px',
        color: style.color,
        background: style.bg,
        borderRadius: 'var(--radius-sm)',
        padding: '1px 5px',
        flexShrink: 0,
      }}
    >
      {style.letter}
    </span>
  );
}

export default TypeBadge;
