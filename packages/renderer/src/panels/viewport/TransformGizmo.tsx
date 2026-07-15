/**
 * packages/renderer/src/panels/viewport/TransformGizmo.tsx
 *
 * The interactive drag-to-write transform gizmo (LIVE-03 headline capability) — a
 * restyled drei `TransformControls` wrapper attached to the SAME object
 * Viewport.tsx's SceneContent already renders (no separate object picker, per
 * this phase's scope). Four modes (Move/Rotate/Scale/Universal); write path is
 * zero-allocation `writeTransform` (05-07); offline and Scale-build-availability
 * are STRUCTURAL disabled-with-reason states, never a fake local-only move.
 *
 * Two exports:
 *   - `TransformGizmo` (default) — the 3D component, MUST be mounted inside the
 *     R3F `<Canvas>` scene tree (it calls useFrame/useThree-family hooks via
 *     drei's TransformControls). Owns the drag write path.
 *   - `GizmoStatusLabel` — a plain DOM overlay (NOT an R3F component), mirrors
 *     Viewport.tsx's `MissingDepsOverlay` idiom (absolutely-positioned sibling
 *     of `<Canvas>`, reads liveStore directly). Owns the offline copy, the
 *     honest cross-build target-identity label, and the Scale-unavailable-on-
 *     build structural label. Split out from the 3D component specifically so
 *     these acceptance-criteria strings are trivially assertable with
 *     `@testing-library/react` without needing an R3F/WebGL test harness (this
 *     project has none yet — see TransformGizmo.test.tsx's header comment).
 *
 * Source: 05-10-PLAN.md Task 1; 05-UI-SPEC.md Surface 1 items 3-4;
 *         05-07-PLAN.md (writeTransform/liveStore contracts).
 */

import React, { useCallback, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TransformControls, Html } from '@react-three/drei';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import { useLiveStore } from '../../state/liveStore.js';
import { writeTransform } from '../../hooks/useCommandWriter.js';

// ─── Sketch-locked fixed hexes (do NOT theme-switch — UI-SPEC Color) ─────────

const AXIS_HEX = { x: '#e0584f', y: '#6db33f', z: '#4a8cff' } as const;

// ─── Modes ────────────────────────────────────────────────────────────────────

/** Component-level mode union — GizmoModeRail's four buttons (Move/Rotate/
 *  Scale/Universal). 'universal' has no direct drei equivalent (drei's own
 *  `mode` prop only accepts translate/rotate/scale) — Flagged Assumption 1
 *  resolved here: render all three drei TransformControls instances stacked
 *  and simultaneously visible/attached to the SAME object, the simpler of the
 *  two well-supported options the plan offered (vs. a Q-press mode cycle). */
export type GizmoMode = 'translate' | 'rotate' | 'scale' | 'universal';

// ─── Zero-allocation write-path scratch (module-level, reused every tick) ────
// Mirrors useCommandWriter.ts's own preallocation discipline (T-05-17) — one
// buffer pair reused for the process lifetime, never reallocated per onChange.

const _scratchTransform = new Float32Array(12);
const _scratchScale = new Float32Array(3);
const _scratchMatrix4 = new THREE.Matrix4();

/**
 * Pure, unit-testable helper: THREE Object3D local position + quaternion ->
 * the SAME row-major float[3][4] (12-value) layout LIVE_CHANNEL_LAYOUT.TRANSFORM
 * uses (translation in column 3: out[3]/out[7]/out[11] — see live-inject.ts and
 * LiveInspectorPanel.tsx's positionFromTransform, the existing read-side
 * convention this mirrors on the write side). Writes into the caller-supplied
 * `out` buffer — never allocates a new Float32Array.
 */
export function objectToTransform12(obj: THREE.Object3D, out: Float32Array): void {
  _scratchMatrix4.makeRotationFromQuaternion(obj.quaternion);
  const e = _scratchMatrix4.elements; // THREE.Matrix4 stores column-major
  out[0] = e[0]!;  out[1] = e[4]!;  out[2] = e[8]!;   out[3] = obj.position.x;
  out[4] = e[1]!;  out[5] = e[5]!;  out[6] = e[9]!;   out[7] = obj.position.y;
  out[8] = e[2]!;  out[9] = e[6]!;  out[10] = e[10]!; out[11] = obj.position.z;
}

/** Best-effort recolor of the underlying three-stdlib gizmo's single-axis
 *  handle materials to the sketch-locked hexes (UI-SPEC "apply the locked
 *  axis hexes... to the corresponding TransformControls handle materials") —
 *  drei exposes no declarative color prop, so this walks the attached
 *  instance's internal `.gizmo` Object3D (public field on three-stdlib's
 *  TransformControls) and recolors meshes named exactly 'X'/'Y'/'Z' (never
 *  the combo handles 'XY'/'YZ'/'XZ'/'XYZ'/'E', which stay the library
 *  default). Purely cosmetic — guarded so a future three-stdlib internal
 *  restructure degrades to a no-op rather than throwing. */
function recolorAxisHandles(controls: TransformControlsImpl | null): void {
  if (!controls) return;
  const gizmoRoot = (controls as unknown as { gizmo?: THREE.Object3D }).gizmo;
  if (!gizmoRoot || typeof gizmoRoot.traverse !== 'function') return;
  gizmoRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh || !mesh.name) return;
    const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
    if (!mat || !('color' in mat)) return;
    if (mesh.name === 'X') mat.color.set(AXIS_HEX.x);
    else if (mesh.name === 'Y') mat.color.set(AXIS_HEX.y);
    else if (mesh.name === 'Z') mat.color.set(AXIS_HEX.z);
  });
}

// ─── Write-suppression gate (T-05-16/T-05-17/T-05-36) ────────────────────────

type WriteChannel = 'transform' | 'scale';

/** Reads liveStore imperatively (`getState()`, not the reactive hook) so the
 *  drag hot-loop never re-subscribes/re-renders — matches this plan's
 *  Interaction Contract (zero React state churn during drag). */
function trySendWrite(object: THREE.Object3D | null, channel: WriteChannel): void {
  if (!object) return;
  const { status, verifiedState, guardState } = useLiveStore.getState();
  // Belt-and-suspenders (T-05-16): TransformControls is enabled={false} whenever
  // not attached, so drei never fires onChange in that state — but the gate is
  // asserted here too so there is no path, present or future, that reaches a
  // write while offline.
  if (status.kind !== 'attached') return;

  if (channel === 'scale') {
    // ROUND 2 W2 fix (T-05-36) — a structural build-capability gap takes
    // precedence over, and is unconditional regardless of, the ordinary
    // guard-blocked traffic-suppression check below.
    if (verifiedState?.scaleUnavailableOnBuild === true) return;
    if (guardState.scale === 'blocked') return; // Cursor MEDIUM traffic suppression
  } else {
    if (guardState.transform === 'blocked') return;
  }

  objectToTransform12(object, _scratchTransform);
  _scratchScale[0] = object.scale.x;
  _scratchScale[1] = object.scale.y;
  _scratchScale[2] = object.scale.z;
  writeTransform(status.mappingName, _scratchTransform, _scratchScale);
}

// ─── Axis letter labels (UI-SPEC Accessibility Rule 1 — color never alone) ───
// No existing drei `Html`-in-3D-scene precedent elsewhere in this codebase
// (grepped per this task's read_first) — this is the first use, following the
// action text's own suggestion.

function AxisLabels({
  object,
  size,
}: {
  object: React.RefObject<THREE.Object3D | null>;
  size: number;
}): React.ReactElement {
  const groupRef = useRef<THREE.Group>(null);

  // Track the target object's position every frame (imperative, zero-alloc —
  // StatsCollector/AnimationTransport precedent in this codebase) since a
  // React ref mutation never triggers a re-render on its own.
  useFrame(() => {
    const obj = object.current;
    const grp = groupRef.current;
    if (!obj || !grp) return;
    grp.position.copy(obj.position);
  });

  const offset = size * 1.15;
  const labelStyle = (hex: string): React.CSSProperties => ({
    color: hex,
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    fontWeight: 700,
    pointerEvents: 'none',
    userSelect: 'none',
    textShadow: '0 0 3px rgba(0,0,0,0.85)',
  });

  return (
    <group ref={groupRef}>
      <Html position={[offset, 0, 0]} center distanceFactor={8} occlude={false} style={labelStyle(AXIS_HEX.x)}>
        X
      </Html>
      <Html position={[0, offset, 0]} center distanceFactor={8} occlude={false} style={labelStyle(AXIS_HEX.y)}>
        Y
      </Html>
      <Html position={[0, 0, offset]} center distanceFactor={8} occlude={false} style={labelStyle(AXIS_HEX.z)}>
        Z
      </Html>
    </group>
  );
}

// ─── TransformGizmo (3D component — mount INSIDE <Canvas>) ───────────────────

export interface TransformGizmoProps {
  /** Ref to the target Object3D this gizmo manipulates — the SAME group
   *  Viewport.tsx's SceneContent already wraps the loaded mesh in (no
   *  separate object picker, 05-CONTEXT). */
  object: React.RefObject<THREE.Object3D | null>;
  mode: GizmoMode;
}

/** Widened hit area (UI-SPEC "generous hit area") — drei/three-stdlib expose
 *  a single `size` knob that scales the whole gizmo (no per-axis hit-padding
 *  prop in the installed @react-three/drei@10.7.7 API, confirmed via its
 *  TransformControlsProps typings), so this is the knob used. */
const GIZMO_SIZE = 1.35;

export default function TransformGizmo({ object, mode }: TransformGizmoProps): React.ReactElement {
  const status = useLiveStore((s) => s.status);
  const scaleUnavailableOnBuild = useLiveStore((s) => s.verifiedState?.scaleUnavailableOnBuild ?? false);
  const attached = status.kind === 'attached';

  const handleTransformChange = useCallback(() => {
    trySendWrite(object.current, 'transform');
  }, [object]);

  const handleScaleChange = useCallback(() => {
    trySendWrite(object.current, 'scale');
  }, [object]);

  const showTranslate = mode === 'translate' || mode === 'universal';
  const showRotate    = mode === 'rotate'    || mode === 'universal';
  const showScale     = mode === 'scale'     || mode === 'universal';

  // ROUND 2 W2 fix (T-05-36): Scale is disabled here (structural, distinct
  // from an ordinary guard-blocked tamper) whenever the build-capability gap
  // is real — the WRITE is what's gated, not the mode-selection affordance
  // (D-09, GizmoModeRail's own concern in 05-10 Task 2).
  const scaleEnabled = attached && !scaleUnavailableOnBuild;

  // drei's TransformControlsProps types `object` as RefObject<Object3D> (no
  // `| null`), but React 19's useRef(null) yields RefObject<Object3D | null>
  // — this cast is the seam; the runtime attach effect (drei's own
  // useLayoutEffect) already null-checks `object.current` before use.
  const drieObject = object as unknown as React.RefObject<THREE.Object3D>;

  return (
    <>
      {showTranslate && (
        <TransformControls
          object={drieObject}
          mode="translate"
          enabled={attached}
          size={GIZMO_SIZE}
          onChange={handleTransformChange}
          ref={(c) => recolorAxisHandles(c as TransformControlsImpl | null)}
        />
      )}
      {showRotate && (
        <TransformControls
          object={drieObject}
          mode="rotate"
          enabled={attached}
          size={GIZMO_SIZE}
          onChange={handleTransformChange}
          ref={(c) => recolorAxisHandles(c as TransformControlsImpl | null)}
        />
      )}
      {showScale && (
        <TransformControls
          object={drieObject}
          mode="scale"
          enabled={scaleEnabled}
          size={GIZMO_SIZE}
          onChange={handleScaleChange}
          ref={(c) => recolorAxisHandles(c as TransformControlsImpl | null)}
        />
      )}
      <AxisLabels object={object} size={GIZMO_SIZE} />
    </>
  );
}

// ─── GizmoStatusLabel (DOM overlay — mount as a SIBLING of <Canvas>) ─────────
// Mirrors Viewport.tsx's MissingDepsOverlay idiom: absolutely-positioned DOM
// overlay reading liveStore directly, NOT inside the R3F scene tree.

export interface GizmoStatusLabelProps {
  mode: GizmoMode;
}

const labelCardStyle = (offline: boolean): React.CSSProperties => ({
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: offline ? 'var(--color-warn)' : 'var(--color-text-muted)',
  background: 'rgba(20,20,20,0.7)',
  border: `1px ${offline ? 'dashed' : 'solid'} ${offline ? 'var(--color-warn)' : 'var(--color-border-soft)'}`,
  borderRadius: 'var(--radius-sm)',
  padding: '3px 8px',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  pointerEvents: 'none',
  maxWidth: 320,
});

/**
 * D-05 (offline honesty) + 05-CONTEXT decision #1 ROUND 2 (cross-build target
 * identity) + ROUND 2 W2 fix (Scale build-availability), all in ONE small
 * inline area — never silently omitted while attached.
 */
export function GizmoStatusLabel({ mode }: GizmoStatusLabelProps): React.ReactElement {
  const status = useLiveStore((s) => s.status);
  const verifiedState = useLiveStore((s) => s.verifiedState);

  if (status.kind !== 'attached') {
    return (
      <div style={labelCardStyle(true)}>
        <span>○ Offline — attach a client to move objects live</span>
      </div>
    );
  }

  let targetLabel: string;
  if (verifiedState?.hasTarget === true) {
    targetLabel = `target: ${verifiedState.templateName}`;
  } else if (verifiedState?.targetUnavailableOnBuild === true) {
    targetLabel = 'target: unavailable on this build — moving player avatar';
  } else {
    targetLabel = 'target: none — moving player avatar';
  }

  const showScaleUnavailable =
    (mode === 'scale' || mode === 'universal') && verifiedState?.scaleUnavailableOnBuild === true;

  return (
    <div style={labelCardStyle(false)}>
      <span>{targetLabel}</span>
      {showScaleUnavailable && <span style={{ color: 'var(--color-warn)' }}>Scale unavailable on this build</span>}
    </div>
  );
}
