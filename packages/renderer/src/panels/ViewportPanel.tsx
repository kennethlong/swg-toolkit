/**
 * packages/renderer/src/viewport/ViewportPanel.tsx
 * CENTER — Viewport panel.
 * Phase 0 seed state: proof status overlay + gizmo.
 *
 * DISPLAY-ONLY for wiring status: this component reads window.__zeroCopy and
 * window.__crossWriteOk to show proof results. It does NOT own or set any
 * window.__ test hook — StatusBar is the single owner of all proof hooks.
 * See packages/renderer/src/shell/StatusBar.tsx.
 *
 * Accessibility Rule 5: aria-label + title on all icon-only controls.
 */

import React, { useState, useEffect } from 'react';
import type { IDockviewPanelProps } from 'dockview';

type RenderMode = 'solid' | 'wire' | 'textured';
type CameraMode = 'orbit' | 'pan' | 'frame';

/** Read the wiring proof status set by StatusBar (single owner of proof hooks). */
function readWiringStatus(): boolean {
  const w = window as Window & typeof globalThis & Record<string, unknown>;
  return w['__zeroCopy'] === true && w['__crossWriteOk'] === true;
}

export default function ViewportPanel(_props: IDockviewPanelProps): React.ReactElement {
  const [renderMode, setRenderMode] = useState<RenderMode>('solid');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [wiringProven, setWiringProven] = useState(false);

  // Poll window.__ status set by StatusBar (single owner of all proof hooks)
  useEffect(() => {
    const check = (): void => {
      if (readWiringStatus()) setWiringProven(true);
    };
    check();
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, []);

  const dims = '1280×800'; // Phase 0 placeholder

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        background: 'radial-gradient(ellipse at center, #2a2e26 0%, #141414 100%)',
        overflow: 'hidden',
      }}
    >
      {/* 28x28 dot grid overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 0%, transparent 80%)',
          maskImage: 'radial-gradient(ellipse at center, black 0%, transparent 80%)',
          pointerEvents: 'none',
        }}
      />

      {/* Panel header — custom tab with close + maximize */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 'var(--tabstrip-h)',
          background: 'var(--color-header)',
          borderBottom: '1px solid var(--color-border)',
          padding: '0 var(--space-2)',
          gap: 'var(--space-2)',
          flexShrink: 0,
          position: 'relative',
          zIndex: 2,
        }}
      >
        <span
          style={{
            color: 'var(--color-text-faint)',
            cursor: 'grab',
            fontSize: 'var(--text-sm)',
            userSelect: 'none',
            width: 18,
            textAlign: 'center',
          }}
        >
          ⠿
        </span>
        <span
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            fontWeight: 600,
            flex: 1,
          }}
        >
          Viewport
        </span>
        {/* Accessibility Rule 5: aria-label + title on all icon-only controls */}
        <button
          aria-label="Maximize panel"
          title="Maximize panel"
          style={actionBtnStyle}
          onClick={() => { /* Phase 0: visual chrome */ }}
        >
          ⤢
        </button>
        <button
          aria-label="Close tab"
          title="Close tab"
          style={actionBtnStyle}
          onClick={() => { /* Phase 0: visual chrome */ }}
        >
          ×
        </button>
      </div>

      {/* Top-left: render mode chips — Solid | Wire | Textured */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(var(--tabstrip-h) + 8px)',
          left: 8,
          display: 'flex',
          gap: 4,
          zIndex: 3,
        }}
      >
        {(['solid', 'wire', 'textured'] as RenderMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => setRenderMode(mode)}
            style={chipStyle(renderMode === mode)}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      {/* Top-right: camera mode chips */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(var(--tabstrip-h) + 8px)',
          right: 8,
          display: 'flex',
          gap: 4,
          zIndex: 3,
        }}
      >
        {/* Accessibility Rule 5: aria-label + title on glyph-only controls */}
        <button
          aria-label="Orbit camera"
          title="Orbit camera"
          onClick={() => setCameraMode('orbit')}
          style={chipStyle(cameraMode === 'orbit')}
        >
          ⟲
        </button>
        <button
          aria-label="Pan camera"
          title="Pan camera"
          onClick={() => setCameraMode('pan')}
          style={chipStyle(cameraMode === 'pan')}
        >
          ✥
        </button>
        <button
          aria-label="Frame selection"
          title="Frame selection"
          onClick={() => setCameraMode('frame')}
          style={chipStyle(cameraMode === 'frame')}
        >
          ⛶
        </button>
      </div>

      {/* Center: Phase 0 placeholder / wiring proof status (display-only) */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {wiringProven ? (
          <>
            <span style={{ color: 'var(--color-accent)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
              crossOriginIsolated ✓
            </span>
            <span style={{ color: 'var(--color-accent)', fontSize: 'var(--text-sm)' }}>
              SAB round-trip: PASS
            </span>
            <span style={{ color: 'var(--color-accent)', fontSize: 'var(--text-xs)' }}>
              native-core: utility-process ✓
            </span>
          </>
        ) : (
          <>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
              Viewport — Phase 0
            </span>
            <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
              3D canvas ready
            </span>
            <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
              Waiting for asset
            </span>
          </>
        )}
      </div>

      {/* Bottom-left: stats overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        persp · {dims} · — fps · SAB {wiringProven ? '✓' : '…'}
      </div>

      {/* Bottom-right: gizmo (48x48 SVG axes) */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          right: 8,
          width: 48,
          height: 48,
          opacity: 0.8,
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        <svg viewBox="0 0 48 48" width={48} height={48}>
          {/* Y-up — green */}
          <line x1="24" y1="24" x2="24" y2="6"  stroke="#7ec94e" strokeWidth="2.5" />
          <polygon points="24,2 21,8 27,8" fill="#7ec94e" />
          <text x="25" y="5" fontSize="7" fill="#7ec94e">Y</text>
          {/* X-right — red */}
          <line x1="24" y1="24" x2="42" y2="24" stroke="#e0584f" strokeWidth="2.5" />
          <polygon points="46,24 40,21 40,27" fill="#e0584f" />
          <text x="40" y="22" fontSize="7" fill="#e0584f">X</text>
          {/* Z-depth — blue (projected diagonally) */}
          <line x1="24" y1="24" x2="10" y2="38" stroke="#4a8cff" strokeWidth="2.5" />
          <polygon points="7,41 10,34 17,37" fill="#4a8cff" />
          <text x="4" y="47" fontSize="7" fill="#4a8cff">Z</text>
        </svg>
      </div>
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-faint)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  padding: 0,
  transition: 'background 0.12s ease, color 0.12s ease',
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--color-accent)' : 'rgba(20,20,20,0.7)',
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-soft)'}`,
    color: active ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    backdropFilter: active ? undefined : 'blur(4px)',
    transition: 'background 0.12s ease, color 0.12s ease',
    lineHeight: 1,
  };
}
