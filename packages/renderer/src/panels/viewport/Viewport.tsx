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

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useViewportStore } from '../../state/viewportStore.js';
import { useGizmoModeStore } from '../../state/gizmoModeStore.js';
import StaticMeshView from './StaticMeshView.js';
import SkinnedMeshView from './SkinnedMeshView.js';
import TransformGizmo, { GizmoStatusLabel } from './TransformGizmo.js';
import GizmoModeRail from './GizmoModeRail.js';
import LiveSyncClientCard from './LiveSyncClientCard.js';
import TransformReadoutBar from './TransformReadoutBar.js';

// Sketch-locked axis hexes (UI-SPEC Color) — the corner axis gizmo (item 7)
// reuses the SAME fixed hexes the transform gizmo's arrows use.
const AXIS_HEX = { x: '#e0584f', y: '#6db33f', z: '#4a8cff' } as const;

// ─── Live-scene capture (module-level, not reactive) ─────────────────────────
// The live R3F scene (THREE.Scene) is captured inside the Canvas by SceneCapturer
// and exposed via getLiveScene() for the export pipeline.
// This is read-only: the export pipeline clones geometry from it but NEVER mutates it.
let _capturedScene: THREE.Scene | null = null;

/**
 * Get the current live THREE.Scene for glTF export.
 * Returns null if no Canvas is mounted yet.
 * The returned scene is READ-ONLY — pass it to buildExportScene() which deep-clones.
 */
export function getLiveScene(): THREE.Scene | null {
  return _capturedScene;
}

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

// ─── Scene capturer (inside Canvas) ──────────────────────────────────────────
// Captures the THREE.Scene from useThree() and stores it in the module-level ref.
// The export pipeline (buildExportScene) reads this to find live SkinnedMesh instances.
function SceneCapturer(): null {
  const { scene } = useThree();
  useEffect(() => {
    _capturedScene = scene;
    return () => { _capturedScene = null; };
  }, [scene]);
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

interface SceneContentProps {
  /** The transform gizmo's target — a stable group wrapping whatever mesh is
   *  currently loaded (05-10: "the same object SceneContent already renders",
   *  no separate object picker). Persists across mesh swaps; TransformGizmo
   *  attaches to it once and never needs a re-render on ref mutation alone. */
  targetRef: React.RefObject<THREE.Group | null>;
}

function SceneContent({ targetRef }: SceneContentProps): React.ReactElement {
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
          redirects, leaf .mgn). Wrapped in a stable group — the transform gizmo's
          target (05-10: same object already rendered here, no separate picker). */}
      <group ref={targetRef}>
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
      </group>

      {/* Repaint trigger for demand frameloop after async loadComplete */}
      <LoadInvalidator />
    </>
  );
}

// ─── vp-stats collector (inside Canvas) — UI-SPEC Surface 1 item 7 ───────────
// DISTINCT from and additional to StatsCollector's existing verts/tris/draws
// overlay (which stays mounted in ViewportPanel.tsx, unmodified) — this is a
// NEW perspective/resolution/fps/SAB-status line (05-11 Task 3).

interface VpStats {
  width: number;
  height: number;
  fps: number;
}

function VpStatsCollector({ onStats }: { onStats: (s: VpStats) => void }): null {
  const { size } = useThree();
  const frameCountRef = useRef(0);
  const lastCalcRef = useRef(0);

  useFrame(() => {
    const now = performance.now();
    frameCountRef.current += 1;
    if (lastCalcRef.current === 0) lastCalcRef.current = now;
    if (now - lastCalcRef.current >= 1000) {
      onStats({ width: Math.round(size.width), height: Math.round(size.height), fps: frameCountRef.current });
      frameCountRef.current = 0;
      lastCalcRef.current = now;
    }
  });

  return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ViewportProps {
  /** Callback to report per-frame stats to the overlay in ViewportPanel. */
  onStats: (stats: FrameStats) => void;
}

// ─── Main Viewport component ──────────────────────────────────────────────────

export default function Viewport({ onStats }: ViewportProps): React.ReactElement {
  const handleStats = useCallback((s: FrameStats) => onStats(s), [onStats]);

  // Gizmo mode: SINGLE source of truth shared by GizmoModeRail (DOM overlay,
  // sibling of <Canvas>), TransformGizmo (3D, inside <Canvas>), AND (05-11
  // Task 3) StatusBar's new mode segment — lifted from local useState (05-10)
  // to a small dedicated store so a shell-level component can read it too.
  const gizmoMode = useGizmoModeStore((s) => s.mode);
  const setGizmoMode = useGizmoModeStore((s) => s.setMode);
  // Stable target group the gizmo attaches to — persists across mesh swaps
  // (05-10: "the same object SceneContent already renders").
  const targetRef = useRef<THREE.Group>(null);

  const [vpStats, setVpStats] = useState<VpStats>({ width: 0, height: 0, fps: 0 });
  const handleVpStats = useCallback((s: VpStats) => setVpStats(s), []);
  // Best-effort read of the Phase-0 SAB proof's single-owner test hook
  // (StatusBar.tsx) — informational display only, never written here.
  const sabOk = typeof window !== 'undefined' && (window as unknown as { __sabIsShared?: boolean }).__sabIsShared === true;

  return (
    <>
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
        <SceneContent targetRef={targetRef} />
        <TransformGizmo object={targetRef} mode={gizmoMode} />
        <StatsCollector onStats={handleStats} />
        <VpStatsCollector onStats={handleVpStats} />
        <SceneCapturer />
        {/* Corner axis gizmo, bottom-right (UI-SPEC Surface 1 item 7) — a REAL
            drei on-canvas orientation widget, distinct from the flat SVG
            corner indicator ViewportPanel.tsx already renders as a DOM
            overlay (unmodified, stays as-is). */}
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={[AXIS_HEX.x, AXIS_HEX.y, AXIS_HEX.z]} labelColor="black" />
        </GizmoHelper>
      </Canvas>
      <GizmoModeRail mode={gizmoMode} onModeChange={setGizmoMode} />
      <div style={{ position: 'absolute', left: 56, top: 'calc(50% - 20px)', zIndex: 3 }}>
        <GizmoStatusLabel mode={gizmoMode} />
      </div>

      {/* Live-sync client card, top-right (UI-SPEC Surface 1 item 2) */}
      <div style={{ position: 'absolute', top: 'calc(var(--tabstrip-h) + 44px)', right: 8, zIndex: 3 }}>
        <LiveSyncClientCard />
      </div>

      {/* Transform readout bar, bottom-center (UI-SPEC Surface 1 items 5-6) —
          mounts its own floating drag-delta readout (top-center) internally. */}
      <TransformReadoutBar />

      {/* vp-stats, bottom-left (UI-SPEC Surface 1 item 7) — NEW, distinct from
          ViewportPanel's existing verts/tris/draws overlay at bottom:8. */}
      <div
        style={{
          position: 'absolute',
          bottom: 26,
          left: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        persp · {vpStats.width}×{vpStats.height} · {vpStats.fps} fps · SAB {sabOk ? '✓' : '—'}
      </div>
    </>
  );
}

// Export FrameStats for ViewportPanel to use
export type { FrameStats };
