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

import React, { useRef, useCallback } from 'react';
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

// ─── Scene content (inside Canvas) ───────────────────────────────────────────

function SceneContent(): React.ReactElement {
  const { isSkinned, parsedMesh, parsedSkeleton, renderMode, resolution } = useViewportStore();

  // Obtain geometry from resolution result
  const geometryBuffer = resolution?.meshes[0]?.geometry ?? null;

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

      {/* Mesh render */}
      {parsedMesh && geometryBuffer && (
        isSkinned ? (
          <SkinnedMeshView
            parsedMesh={parsedMesh}
            geometry={geometryBuffer}
            parsedSkeleton={parsedSkeleton}
            renderMode={renderMode}
          />
        ) : (
          <StaticMeshView
            parsedMesh={parsedMesh}
            geometry={geometryBuffer}
            renderMode={renderMode}
          />
        )
      )}
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
