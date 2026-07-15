/**
 * packages/renderer/src/panels/viewport/TransformReadoutBar.tsx
 *
 * UI-SPEC Surface 1 items 5-6 — the bottom-center Pos/Rot/Scale numbox readout
 * bar (52px right-aligned mono numboxes, X/Y/Z axis tags) + the border-left
 * write-target indicator (D-05 disabled-with-reason offline copy, NOT
 * "staged (patch)") + the floating drag-delta readout (top-center, drag-only).
 *
 * Numbox updates during an ACTIVE DRAG are imperative (direct DOM writes via
 * refs, subscribed to TransformGizmo's onChange tick through
 * liveDragTelemetry.ts) — LIVE-03 SC1's "never per-frame React state churn"
 * contract. The BASELINE (non-dragging) display reactively follows liveStore
 * at ordinary channel-tick rate (~30fps), same as every other HUD surface —
 * that is not the drag hot path this SC targets.
 *
 * A plain DOM overlay (NOT an R3F component) — mounted as a `<Canvas>` sibling
 * in Viewport.tsx, mirroring LiveSyncClientCard/GizmoStatusLabel's idiom.
 *
 * Source: 05-11-PLAN.md Task 2; 05-UI-SPEC.md Surface 1 items 5-6 + Errata 1 (D-05).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useLiveStore } from '../../state/liveStore.js';
import { writeTransform } from '../../hooks/useCommandWriter.js';
import { subscribeDragTick } from './liveDragTelemetry.js';

const AXIS_HEX = { x: '#e0584f', y: '#6db33f', z: '#4a8cff' } as const;

/** No new drag tick within this window => the drag has ended (there is no
 *  explicit drag-end event wired from TransformGizmo this round — this
 *  idle-timeout heuristic is the simplest way to derive drag start/end
 *  WITHOUT widening TransformGizmo's onMouseDown/onMouseUp surface). */
const DRAG_IDLE_MS = 200;

// ─── Test-only render-count instrumentation (mirrors resetConsoleCaptureForTests'
// established convention) — proves numbox updates during a drag are imperative,
// not React-state-driven (acceptance criterion: O(1) renders across a 60-tick
// simulated drag, not O(60)). ──────────────────────────────────────────────────

let _renderCount = 0;
export function getRenderCountForTests(): number { return _renderCount; }
export function resetRenderCountForTests(): void { _renderCount = 0; }

// ─── Pure conversion helpers (mirror TransformGizmo.objectToTransform12's
// row-major float[3][4] <-> THREE.Matrix4 column-major convention) ───────────

const _m4 = new THREE.Matrix4();
const _euler = new THREE.Euler();

/** Row-major float[3][4] transform -> [rotX, rotY, rotZ] in degrees (XYZ order). */
export function eulerDegreesFromTransform12(t: ArrayLike<number>): [number, number, number] {
  _m4.set(
    t[0] ?? 0, t[1] ?? 0, t[2] ?? 0, t[3] ?? 0,
    t[4] ?? 0, t[5] ?? 0, t[6] ?? 0, t[7] ?? 0,
    t[8] ?? 0, t[9] ?? 0, t[10] ?? 0, t[11] ?? 0,
    0, 0, 0, 1,
  );
  _euler.setFromRotationMatrix(_m4, 'XYZ');
  return [
    THREE.MathUtils.radToDeg(_euler.x),
    THREE.MathUtils.radToDeg(_euler.y),
    THREE.MathUtils.radToDeg(_euler.z),
  ];
}

/** Writes the rotation sub-matrix (columns 0/1/2) for the given Euler degrees
 *  into `out` IN PLACE — translation (columns 3/7/11) is left untouched. */
export function applyEulerDegreesToTransform12(out: Float32Array, degX: number, degY: number, degZ: number): void {
  _euler.set(THREE.MathUtils.degToRad(degX), THREE.MathUtils.degToRad(degY), THREE.MathUtils.degToRad(degZ), 'XYZ');
  _m4.makeRotationFromEuler(_euler);
  const e = _m4.elements;
  out[0] = e[0]!; out[1] = e[4]!; out[2] = e[8]!;
  out[4] = e[1]!; out[5] = e[5]!; out[6] = e[9]!;
  out[8] = e[2]!; out[9] = e[6]!; out[10] = e[10]!;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-4)',
  background: 'rgba(20,20,20,0.82)',
  backdropFilter: 'blur(4px)',
  border: '1px solid var(--color-border-soft)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
};

const groupStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' };
const axisRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 3 };

function axisTagStyle(hex: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 11,
    height: 11,
    background: hex,
    color: '#111',
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    fontWeight: 700,
    borderRadius: 2,
    flexShrink: 0,
  };
}

function numboxStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 52,
    textAlign: 'right',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    background: disabled ? 'transparent' : 'var(--color-widget)',
    color: disabled ? 'var(--color-text-faint)' : 'var(--color-text)',
    border: '1px solid var(--color-border-soft)',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 4px',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TransformReadoutBar(): React.ReactElement {
  _renderCount++;

  const status = useLiveStore((s) => s.status);
  const verifiedState = useLiveStore((s) => s.verifiedState);
  const guardState = useLiveStore((s) => s.guardState);
  const expectedScale = useLiveStore((s) => s.expectedScale);

  const attached = status.kind === 'attached';
  const scaleUnavailableOnBuild = verifiedState?.scaleUnavailableOnBuild ?? false;
  const scaleDisabled = !attached || scaleUnavailableOnBuild;

  const posRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const rotRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const scaleRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const deltaLabelRef = useRef<HTMLSpanElement>(null);

  // Scratch pose kept in sync by BOTH the reactive baseline effect AND the
  // imperative drag-tick subscription — typed numbox commits read from these.
  const currentTransformRef = useRef<Float32Array>(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]));
  const currentScaleRef = useRef<Float32Array>(new Float32Array([1, 1, 1]));

  // "dragging" is the ONE acceptable per-gesture (not per-frame) React state
  // transition (plan's own carve-out: "show/hide on drag-start/drag-end IS an
  // acceptable state transition since it happens once per drag, not per frame").
  const [dragging, setDragging] = useState(false);
  const dragIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartTransformRef = useRef<Float32Array | null>(null);

  const writeNumboxes = useCallback((t: Float32Array, s: Float32Array) => {
    const [rx, ry, rz] = eulerDegreesFromTransform12(t);
    const vals = [t[3] ?? 0, t[7] ?? 0, t[11] ?? 0, rx, ry, rz, s[0] ?? 1, s[1] ?? 1, s[2] ?? 1];
    const refs = [...posRefs, ...rotRefs, ...scaleRefs];
    for (let i = 0; i < 9; i++) {
      const el = refs[i]!.current;
      // Never clobber a value the user is actively typing into.
      if (el && document.activeElement !== el) el.value = vals[i]!.toFixed(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reactive baseline (ordinary channel-tick-rate re-render — NOT the drag
  // hot path LIVE-03 SC1 targets). Pos/Rot from verifiedState.transform;
  // Scale from expectedScale() (no live-scale channel field exists this round,
  // 05-07's own documented limitation). ─────────────────────────────────────
  useEffect(() => {
    if (!attached) return;
    if (verifiedState) currentTransformRef.current.set(verifiedState.transform);
    const s = expectedScale();
    if (s) currentScaleRef.current.set(s);
    if (!dragging) writeNumboxes(currentTransformRef.current, currentScaleRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached, verifiedState, dragging]);

  // ── Imperative drag-tick mirror (zero React state churn per tick) ────────
  useEffect(() => {
    return subscribeDragTick((t, s) => {
      if (dragStartTransformRef.current === null) {
        dragStartTransformRef.current = t.slice();
        setDragging(true);
      }
      currentTransformRef.current.set(t);
      currentScaleRef.current.set(s);
      writeNumboxes(t, s);

      // Floating delta readout — a DIRECT DOM write, not React state, so this
      // tick handler never triggers a re-render.
      const start = dragStartTransformRef.current;
      const dx = (t[3] ?? 0) - (start[3] ?? 0);
      const dy = (t[7] ?? 0) - (start[7] ?? 0);
      const dz = (t[11] ?? 0) - (start[11] ?? 0);
      const deltas: Array<['x' | 'y' | 'z', number]> = [['x', dx], ['y', dy], ['z', dz]];
      const [axis, delta] = deltas.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
      const sign = delta >= 0 ? '+' : '';
      if (deltaLabelRef.current) {
        deltaLabelRef.current.textContent = `Δ pos.${axis} ${sign}${delta.toFixed(2)}m`;
      }

      if (dragIdleTimerRef.current) clearTimeout(dragIdleTimerRef.current);
      dragIdleTimerRef.current = setTimeout(() => {
        setDragging(false);
        dragStartTransformRef.current = null;
      }, DRAG_IDLE_MS);
    });
  }, [writeNumboxes]);

  useEffect(() => () => {
    if (dragIdleTimerRef.current) clearTimeout(dragIdleTimerRef.current);
  }, []);

  // ── Typed-entry commit path — SAME writeTransform function a gizmo drag
  // calls (05-10 parity), gated per-channel exactly like the gizmo. ────────
  function sendCurrent(channel: 'transform' | 'scale'): void {
    const { status: s, guardState: g, verifiedState: vs } = useLiveStore.getState();
    if (s.kind !== 'attached') return;
    if (channel === 'scale') {
      if (vs?.scaleUnavailableOnBuild === true) return;
      if (g.scale === 'blocked') return;
    } else {
      if (g.transform === 'blocked') return;
    }
    writeTransform(s.mappingName, currentTransformRef.current, currentScaleRef.current);
    useLiveStore.getState().recordWrite(currentTransformRef.current, currentScaleRef.current);
  }

  function commitPos(axisIdx: 0 | 1 | 2, value: number): void {
    const idx = [3, 7, 11][axisIdx]!;
    currentTransformRef.current[idx] = value;
    sendCurrent('transform');
  }
  function commitRot(axisIdx: 0 | 1 | 2, value: number): void {
    const [rx, ry, rz] = eulerDegreesFromTransform12(currentTransformRef.current);
    const degs: [number, number, number] = [rx, ry, rz];
    degs[axisIdx] = value;
    applyEulerDegreesToTransform12(currentTransformRef.current, degs[0], degs[1], degs[2]);
    sendCurrent('transform');
  }
  function commitScale(axisIdx: 0 | 1 | 2, value: number): void {
    currentScaleRef.current[axisIdx] = value;
    sendCurrent('scale');
  }

  function makeKeyDownHandler(commit: (v: number) => void): (e: React.KeyboardEvent<HTMLInputElement>) => void {
    return (e) => {
      const input = e.target as HTMLInputElement;
      if (e.key === 'Enter') {
        const v = parseFloat(input.value);
        if (!Number.isNaN(v)) commit(v);
        input.blur();
      } else if (e.key === 'Escape') {
        writeNumboxes(currentTransformRef.current, currentScaleRef.current);
        input.blur();
      }
    };
  }

  const axisLabels = ['X', 'Y', 'Z'] as const;
  const axisHexes = [AXIS_HEX.x, AXIS_HEX.y, AXIS_HEX.z];

  function renderGroup(
    label: string,
    refs: React.RefObject<HTMLInputElement | null>[],
    disabled: boolean,
    onCommit: (axisIdx: 0 | 1 | 2, value: number) => void,
  ): React.ReactElement {
    return (
      <div style={groupStyle}>
        <span style={{ color: 'var(--color-text-faint)', textTransform: 'uppercase', fontSize: '9px', fontWeight: 600 }}>
          {label}
        </span>
        {([0, 1, 2] as const).map((i) => (
          <div key={i} style={axisRowStyle}>
            <span style={axisTagStyle(axisHexes[i]!)}>{axisLabels[i]}</span>
            <input
              ref={refs[i]}
              type="text"
              inputMode="decimal"
              disabled={disabled}
              defaultValue="0.00"
              style={numboxStyle(disabled)}
              onKeyDown={makeKeyDownHandler((v) => onCommit(i, v))}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {dragging && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(var(--tabstrip-h) + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            background: 'rgba(20,20,20,0.85)',
            border: '1px solid var(--color-border-soft)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            zIndex: 4,
            pointerEvents: 'none',
          }}
        >
          <span ref={deltaLabelRef} style={{ fontWeight: 700 }} />
          <span style={{ color: attached ? 'var(--color-accent)' : 'var(--color-warn)' }}>
            → client {attached ? 'ok' : 'offline'}
          </span>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 3,
          ...barStyle,
        }}
      >
        {renderGroup('Pos', posRefs, !attached, commitPos)}
        {renderGroup('Rot', rotRefs, !attached, commitRot)}
        {renderGroup('Scale', scaleRefs, scaleDisabled, commitScale)}
        {scaleUnavailableOnBuild && attached && (
          <span style={{ color: 'var(--color-warn)', fontSize: 'var(--text-xs)' }}>Scale unavailable on this build</span>
        )}
        <div style={{ borderLeft: '1px solid var(--color-border-soft)', paddingLeft: 'var(--space-3)' }}>
          {attached ? (
            <span style={{ color: 'var(--color-accent)' }}>writing to client → client ✓</span>
          ) : (
            <span style={{ color: 'var(--color-warn)' }}>○ Offline — attach a client to move objects live</span>
          )}
        </div>
      </div>
    </>
  );
}
