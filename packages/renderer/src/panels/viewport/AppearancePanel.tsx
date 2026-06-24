/**
 * packages/renderer/src/panels/viewport/AppearancePanel.tsx
 *
 * Read-only appearance resolution inspector panel.
 * Per 02-UI-SPEC.md Surface 6 + 02-PATTERNS.md § AppearancePanel.tsx.
 *
 * Analog: packages/renderer/src/panels/iff/IffStructureTree.tsx (read-only inspector pattern).
 */

import React from 'react';
import VerificationStatus from '../../shared/VerificationStatus.tsx';
import type { AppearanceResolutionResult, ResolvedMesh } from './resolver/appearanceResolver.js';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AppearancePanelProps {
  resolution: AppearanceResolutionResult | null;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  padding: '6px 8px 4px',
  borderBottom: '1px solid var(--color-border)',
  userSelect: 'none',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '3px 8px',
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const modeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  padding: '4px 8px',
};

const missingBannerStyle: React.CSSProperties = {
  margin: '6px 8px 4px',
  padding: '4px 8px',
  background: 'rgba(var(--color-warn-rgb, 200,160,0), 0.12)',
  border: '1px solid var(--color-warn)',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-warn)',
};

const stubButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-soft)',
  color: 'var(--color-text-faint)',
  borderRadius: 'var(--radius-sm)',
  padding: '3px 8px',
  cursor: 'not-allowed',
  fontSize: 'var(--text-xs)',
  fontFamily: 'var(--font-sans)',
  margin: '4px 8px',
  opacity: 0.5,
};

const emptyStyle: React.CSSProperties = {
  padding: '8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
};

// ─── Mode label ───────────────────────────────────────────────────────────────

function modeLabel(mode: AppearanceResolutionResult['mode']): string {
  switch (mode) {
    case 'composed':        return 'composed (.sat)';
    case 'composed-static': return 'composed-static (.apt)';
    case 'leaf':            return 'leaf (.mgn / .msh standalone)';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppearancePanel({ resolution }: AppearancePanelProps): React.ReactElement {
  if (!resolution) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={sectionHeadStyle}>Appearance</div>
        <div style={emptyStyle}>No asset loaded</div>
      </div>
    );
  }

  const resolvedMeshPaths = resolution.meshes.flatMap(m => m ? [m.path] : []);
  const skeletonPath = resolution.skeleton?.path ?? null;
  const isLeaf = resolution.mode === 'leaf';

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={sectionHeadStyle}>Appearance</div>

      {/* Open-mode indicator */}
      <div style={modeStyle}>{modeLabel(resolution.mode)}</div>

      {/* Missing-deps banner */}
      {resolution.missing.length > 0 && (
        <div style={missingBannerStyle} role="alert">
          ▴ {resolution.missing.length} missing dependenc{resolution.missing.length === 1 ? 'y' : 'ies'}
        </div>
      )}

      {/* Resolved mesh paths */}
      {resolvedMeshPaths.length > 0 && (
        <>
          {resolvedMeshPaths.map(p => (
            <div key={p} style={rowStyle}>
              <VerificationStatus variant="pass" caption="resolved ✓" compact />
              <span style={labelStyle} title={p}>{p.split('/').pop() ?? p}</span>
            </div>
          ))}
        </>
      )}

      {/* Skeleton path */}
      {skeletonPath !== null && (
        <div style={rowStyle}>
          <VerificationStatus variant="pass" caption="skeleton resolved ✓" compact />
          <span style={labelStyle} title={skeletonPath}>
            {skeletonPath.split('/').pop() ?? skeletonPath}
          </span>
        </div>
      )}

      {/* Missing dependencies */}
      {resolution.missing.map(name => (
        <div key={name} style={rowStyle}>
          <VerificationStatus variant="warn" caption={`missing: ${name} — placeholder`} compact />
          <span style={{ ...labelStyle, color: 'var(--color-warn)' }} title={name}>
            {name.split('/').pop() ?? name}
          </span>
        </div>
      ))}

      {/* Leaf mode stub buttons (wired in 02-04) */}
      {isLeaf && (
        <>
          <button
            style={stubButtonStyle}
            disabled
            title="Attach skeleton — available in a future phase"
            aria-label="Attach skeleton (not yet available)"
          >
            Attach skeleton…
          </button>
          <button
            style={stubButtonStyle}
            disabled
            title="Attach animation — available in a future phase"
            aria-label="Attach animation (not yet available)"
          >
            Attach animation…
          </button>
        </>
      )}
    </div>
  );
}
