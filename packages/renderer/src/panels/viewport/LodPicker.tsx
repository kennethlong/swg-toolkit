/**
 * packages/renderer/src/panels/viewport/LodPicker.tsx
 *
 * Read-only LOD level selector panel.
 * Per 02-UI-SPEC.md Surface 2 + 02-PATTERNS.md § LodPicker.tsx.
 *
 * Analog: packages/renderer/src/panels/iff/IffStructureTree.tsx (read-only inspector pattern).
 */

import React from 'react';
import type { LodLevel } from '@swg/contracts';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LodPickerProps {
  /** LOD levels from the appearance resolver (null = no LOD graph present). */
  lodLevels: LodLevel[] | null;
  /** Currently selected LOD level index. */
  selectedLod: number;
  /** Callback when the user selects a level. */
  onSelectLod: (index: number) => void;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function lodRowStyle(selected: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    gap: 8,
    background: selected ? 'var(--color-accent-dim)' : 'transparent',
    borderLeft: selected ? '2px solid var(--color-accent)' : '2px solid transparent',
    cursor: 'pointer',
    transition: 'background 0.1s ease',
  };
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text)',
  minWidth: 44,
};

const distStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  flex: 1,
};

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  padding: '6px 8px 4px',
  borderBottom: '1px solid var(--color-border)',
  userSelect: 'none',
};

const emptyStyle: React.CSSProperties = {
  padding: '8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function LodPicker({
  lodLevels,
  selectedLod,
  onSelectLod,
}: LodPickerProps): React.ReactElement {
  // Single level: collapse to one row without section head
  if (!lodLevels || lodLevels.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={sectionHeadStyle}>LOD</div>
        <div style={emptyStyle}>No LOD graph</div>
      </div>
    );
  }

  if (lodLevels.length === 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={sectionHeadStyle}>LOD</div>
        <div style={lodRowStyle(true)}>
          <span style={labelStyle}>LOD 0</span>
          <span style={distStyle}>1 level</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={sectionHeadStyle}>LOD</div>
      {lodLevels.map((level, i) => (
        <div
          key={i}
          style={lodRowStyle(selectedLod === i)}
          onClick={() => onSelectLod(i)}
          role="button"
          tabIndex={0}
          aria-label={`Select LOD level ${i}`}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') onSelectLod(i);
          }}
        >
          <span style={labelStyle}>LOD {i}</span>
          {level.minDist > 0 || level.maxDist > 0 ? (
            <span style={distStyle}>
              {level.minDist.toFixed(1)}–{level.maxDist.toFixed(1)}m
            </span>
          ) : (
            <span style={distStyle}>{level.generatorPath.split('/').pop() ?? level.generatorPath}</span>
          )}
        </div>
      ))}
    </div>
  );
}
