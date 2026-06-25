/**
 * packages/renderer/src/panels/viewport/Viewport.tsx
 *
 * R3F Canvas — mounts into the ViewportPanel body (position:absolute; inset:0; overflow:hidden).
 * Renders StaticMeshView when isSkinned===false, SkinnedMeshView when true.
 *
 * Lighting (3-point):
 *   Key:  DirectionalLight at (5,5,3) intensity 1.2
 *   Fill: DirectionalLight at (-3,3,1) intensity 0.4
 *   Rim:  DirectionalLight at (0,5,-5) intensity 0.3
 *   Ambient: AmbientLight intensity 0.3
 *
 * Stats overlay: verts/tris/draws + 'binary' badge (NOT 'zero-copy' — the binding memcpys).
 *
 * Source: 02-PATTERNS.md § Viewport.tsx
 *         + 02-UI-SPEC.md Surface 1 (Canvas chrome, empty/loading/error states, 'binary' badge)
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useViewportStore } from '../../state/viewportStore.js';
import StaticMeshView from './StaticMeshView.js';
import SkinnedMeshView from './SkinnedMeshView.js';

// ─── Stats collector (inside Canvas) ─────────────────────────────────────────

interface FrameStats {
  verts: number;
  tris: number;
  draws: number;
}

function StatsCollector({
  onStats,
}: {
  onStats: (stats: FrameStats) => void;
}): null {
  const { gl } = useThree();
  const lastFrame = useRef<number>(0);

  useFrame(() => {
    const now = performance.now();
    if (now - lastFrame.current < 200) return; // update ~5Hz
    lastFrame.current = now;
    const info = gl.info.render;
    onStats({
      verts: gl.info.memory?.geometries ?? 0,
      tris: Math.round(info.triangles),
      draws: info.calls,
    });
  });

  return null;
}

// ─── Invalidate-on-load helper (inside Canvas) ──────────────────────────────
// OPTIONAL fix: after async loadComplete swaps state in demand mode, trigger a repaint.
function LoadInvalidator(): null {
  const { invalidate } = useThree();
  const { loadStatus } = useViewportStore();

  useEffect(() => {
    if (loadStatus.kind === 'done') {
      // Schedule a repaint so the new geometry is visible in frameloop="demand".
      invalidate();
    }
  }, [loadStatus, invalidate]);

  return null;
}

// ─── Missing-deps warning (inside Canvas / rendered as HTML overlay outside) ─
// Exported so ViewportPanel can render it in the overlay layer.
export function MissingDepsOverlay(): React.ReactElement | null {
  const { resolution } = useViewportStore();
  const missing = resolution?.missing ?? [];
  if (missing.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 32,
        left: 8,
        background: 'rgba(180, 120, 0, 0.15)',
        border: '1px solid rgba(180, 120, 0, 0.5)',
        borderRadius: 4,
        padding: '4px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'rgba(255, 190, 0, 0.9)',
        zIndex: 3,
        pointerEvents: 'none',
        maxWidth: 320,
      }}
    >
      ⚠ {missing.length} missing dep{missing.length > 1 ? 's' : ''}: {missing.slice(0, 3).join(', ')}{missing.length > 3 ? ` +${missing.length - 3} more` : ''}
    </div>
  );
}

// ─── Scene content (inside Canvas) ───────────────────────────────────────────

function SceneContent(): React.ReactElement {
  const { isSkinned, parsedMesh, parsedSkeleton, renderMode, resolution, selectedLod } = useViewportStore();

  // Multi-part composed skinned .sat: select each part's mesh at the shared selectedLod.
  // All parts render together sharing the one merged skeleton.
  const skinnedParts = React.useMemo(() => {
    if (!resolution?.parts) return null;
    const out = [];
    for (const part of resolution.parts) {
      const m = part.meshesByLod[selectedLod] ?? part.meshesByLod[0] ?? null;
      if (m) out.push({ parsedMesh: m.parseResult, geometry: m.geometry, materials: part.materials });
    }
    return out;
  }, [resolution?.parts, selectedLod]);

  // TERTIARY fix: index by selectedLod instead of always using meshes[0].
  // The resolver returns meshes[] where each index corresponds to a LOD level
  // (or for non-LOD assets, meshes[0] is the single mesh).
  // Render the mesh at the selected LOD if available; fall back to index 0.
  const lodMesh = resolution?.meshes[selectedLod] ?? resolution?.meshes[0] ?? null;
  const geometryBuffer = lodMesh?.geometry ?? null;

  // For multi-PSDT / non-null mesh: parsedMesh carries the shaderGroups.
  // lodMesh.parseResult is the actual per-LOD MeshParseResult.
  const activeMesh = lodMesh?.parseResult ?? parsedMesh;

  return (
    <>
      {/* 3-point lighting */}
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 5, 3]}   intensity={1.2} castShadow={false} />
      <directionalLight position={[-3, 3, 1]}  intensity={0.4} castShadow={false} />
      <directionalLight position={[0, 5, -5]}  intensity={0.3} castShadow={false} />

      {/* Ground grid */}
      <Grid
        args={[20, 20]}
        cellSize={0.5}
        cellThickness={0.5}
        sectionSize={2}
        sectionThickness={1}
        cellColor="#444444"
        sectionColor="#666666"
        fadeDistance={20}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {/* Orbit controls */}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        makeDefault
      />

      {/* Mesh render. Multi-part composed skinned .sat → render all parts at selectedLod
          sharing the merged skeleton. Otherwise the legacy single-mesh path (static
          redirects, leaf .mgn). */}
      {isSkinned && skinnedParts && skinnedParts.length > 0 ? (
        <SkinnedMeshView
          parts={skinnedParts}
          parsedSkeleton={parsedSkeleton}
          renderMode={renderMode}
        />
      ) : activeMesh && geometryBuffer && (
        isSkinned ? (
          <SkinnedMeshView
            parsedMesh={activeMesh}
            geometry={geometryBuffer}
            parsedSkeleton={parsedSkeleton}
            renderMode={renderMode}
            materials={resolution?.materials}
          />
        ) : (
          <StaticMeshView
            parsedMesh={activeMesh}
            geometry={geometryBuffer}
            renderMode={renderMode}
            materials={resolution?.materials}
          />
        )
      )}

      {/* Repaint trigger for demand frameloop after async loadComplete */}
      <LoadInvalidator />
    </>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ViewportProps {
  /** Callback to report per-frame stats to the overlay in ViewportPanel. */
  onStats: (stats: FrameStats) => void;
}

// ─── Main Viewport component ──────────────────────────────────────────────────

export default function Viewport({ onStats }: ViewportProps): React.ReactElement {
  const handleStats = useCallback((s: FrameStats) => onStats(s), [onStats]);

  return (
    <Canvas
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
      camera={{ position: [3, 2, 3], fov: 55 }}
      gl={{
        antialias: true,
        toneMapping: 3, // ACESFilmicToneMapping
        toneMappingExposure: 1.0,
      }}
      frameloop="demand"
    >
      <SceneContent />
      <StatsCollector onStats={handleStats} />
    </Canvas>
  );
}

// Export FrameStats for ViewportPanel to use
export type { FrameStats };
