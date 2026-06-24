/**
 * packages/renderer/src/panels/ViewportPanel.tsx
 * CENTER — Viewport panel.
 * Phase 2 wiring: mounts R3F Viewport into the panel body.
 *
 * Chrome is PRESERVED from Phase 0 — header, chips, stats overlay, gizmo.
 * The R3F Canvas is mounted below the overlay chips (position:absolute; inset:0; z-index:1).
 * Chips and overlay live at z-index 2+.
 *
 * Stats badge reads 'binary' (NOT 'zero-copy' — the binding memcpys into a JS-heap buffer;
 * the property is that geometry never crosses as JSON, not that it's literally zero-copy).
 *
 * Accessibility Rule 5: aria-label + title on all icon-only controls.
 */

import React, { useState, useCallback, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { useViewportStore } from '../state/viewportStore.js';
import Viewport from './viewport/Viewport.js';
import LodPicker from './viewport/LodPicker.js';
import AppearancePanel from './viewport/AppearancePanel.js';
import CustomizationPanel from './viewport/CustomizationPanel.js';
import MaterialInspector from './viewport/MaterialInspector.js';
import { MissingDepsOverlay } from './viewport/Viewport.js';
import type { FrameStats } from './viewport/Viewport.js';

type RenderMode = 'solid' | 'wire' | 'textured';
type CameraMode = 'orbit' | 'pan' | 'frame';

export default function ViewportPanel(_props: IDockviewPanelProps): React.ReactElement {
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [stats, setStats] = useState<FrameStats>({ verts: 0, tris: 0, draws: 0 });
  const [showSidePanels, setShowSidePanels] = useState(false);

  const { renderMode, setRenderMode, selectedLod, setSelectedLod, resolution, loadStatus } = useViewportStore();

  const dims = '1280×800'; // Phase 0 placeholder

  const handleStats = useCallback((s: FrameStats) => setStats(s), []);

  // FPS counter (approximate from frame stats update rate)
  const fpsRef = useRef<number>(0);
  const lastFpsUpdateRef = useRef<number>(0);
  const [fps, setFps] = useState<number>(0);
  const handleStatsWithFps = useCallback((s: FrameStats) => {
    setStats(s);
    const now = performance.now();
    if (now - lastFpsUpdateRef.current > 1000) {
      const elapsed = (now - lastFpsUpdateRef.current) / 1000;
      const newFps = fpsRef.current > 0 ? Math.round(fpsRef.current / elapsed) : 0;
      setFps(newFps);
      fpsRef.current = 0;
      lastFpsUpdateRef.current = now;
    }
    fpsRef.current++;
  }, []);

  const isLoading = loadStatus.kind === 'loading';
  const isError   = loadStatus.kind === 'error';
  const isDone    = loadStatus.kind === 'done';
  const isEmpty   = loadStatus.kind === 'idle';

  const lodLevels = resolution?.lodLevels ?? null;

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
      {/* 28×28 dot grid overlay */}
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

      {/* Panel header */}
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
          zIndex: 4,
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
        {/* Side panels toggle */}
        <button
          aria-label={showSidePanels ? 'Hide appearance panels' : 'Show appearance panels'}
          title={showSidePanels ? 'Hide appearance panels' : 'Show appearance panels'}
          style={actionBtnStyle}
          onClick={() => setShowSidePanels(v => !v)}
        >
          ☰
        </button>
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

      {/* R3F Canvas — position:absolute; inset:0; z-index:1 (behind chips) */}
      {(isDone || isLoading) && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <Viewport onStats={handleStatsWithFps} />
        </div>
      )}

      {/* Missing-deps warning overlay (⚠ banner per D-04) */}
      {isDone && <MissingDepsOverlay />}

      {/* Top-left: render mode chips */}
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

      {/* Loading state overlay */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
            Loading…
          </span>
          <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
            {'filename' in loadStatus ? loadStatus.filename : ''}
          </span>
        </div>
      )}

      {/* Error state overlay */}
      {isError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <span style={{ color: 'var(--color-danger)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
            Error
          </span>
          <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
            {'reason' in loadStatus ? loadStatus.reason : 'Unknown error'}
          </span>
        </div>
      )}

      {/* Empty state / Phase-2 copy */}
      {isEmpty && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            position: 'relative',
            zIndex: 2,
          }}
        >
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
            Viewport
          </span>
          <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
            Open a mesh from the Assets panel
          </span>
          <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
            .sat / .apt to compose · .mgn / .msh to inspect
          </span>
        </div>
      )}

      {/* Side panels: LOD + Appearance (shown when showSidePanels) */}
      {showSidePanels && resolution && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(var(--tabstrip-h) + 40px)',
            right: 8,
            width: 200,
            background: 'rgba(20,20,20,0.85)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            backdropFilter: 'blur(8px)',
            zIndex: 3,
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            maxHeight: 'calc(100% - 80px)',
            overflowY: 'auto',
          }}
        >
          <LodPicker
            lodLevels={lodLevels && lodLevels.length > 0 ? lodLevels : null}
            selectedLod={selectedLod}
            onSelectLod={setSelectedLod}
          />
          <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />
          <AppearancePanel resolution={resolution} />
          <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />
          <CustomizationPanel resolution={resolution} />
          <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />
          <MaterialInspector resolution={resolution} />
        </div>
      )}

      {/* Bottom-left: stats overlay — 'binary' badge (NOT 'zero-copy') */}
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
        {isDone
          ? `persp · ${dims} · ${fps} fps · ${stats.verts} v · ${stats.tris} t · ${stats.draws} dc · binary`
          : `persp · ${dims} · — fps · binary`}
      </div>

      {/* Bottom-right: gizmo (48×48 SVG axes) */}
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
