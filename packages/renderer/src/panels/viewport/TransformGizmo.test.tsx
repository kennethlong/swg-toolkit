/**
 * packages/renderer/src/panels/viewport/TransformGizmo.test.tsx
 * Tests for 05-10 Task 1: the drag-to-write gizmo, its guard-aware write
 * suppression, and its honest offline/target/Scale-availability labels.
 *
 * Mocking strategy: this project has no R3F/WebGL test harness (no
 * @react-three/test-renderer, no jsdom-canvas mock) — TransformGizmo cannot be
 * rendered inside a real <Canvas> in vitest. `@react-three/drei`'s
 * TransformControls and Html, and `@react-three/fiber`'s useFrame, are mocked
 * to plain stand-ins: TransformControls records its own props (mode/enabled/
 * onChange) into a shared array so a test can invoke `onChange()` directly to
 * simulate a drag-move tick (exactly what drei's real onChange callback fires
 * continuously during a real drag), without needing real pointer events or a
 * WebGL context. useLiveStore is the REAL Zustand store (liveStore.test.ts's
 * own established convention) — driven via attachComplete/updateState/
 * setGuardState, not mocked.
 */

import React from 'react';
import * as THREE from 'three';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VerifiedObjectState } from '@swg/contracts';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../hooks/useCommandWriter', () => ({
  writeTransform: vi.fn(),
}));

interface CapturedControls {
  mode: string;
  enabled: boolean;
  onChange?: () => void;
}

const mockControlsCalls = vi.hoisted(() => [] as CapturedControls[]);

vi.mock('@react-three/drei', () => ({
  TransformControls: (props: { mode: string; enabled: boolean; onChange?: () => void }) => {
    mockControlsCalls.push({ mode: props.mode, enabled: props.enabled, onChange: props.onChange });
    return null;
  },
  Html: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: () => {},
  useThree: () => ({}),
}));

import { useLiveStore } from '../../state/liveStore';
import { writeTransform } from '../../hooks/useCommandWriter';
import TransformGizmo, { GizmoStatusLabel, objectToTransform12 } from './TransformGizmo';

const mockWriteTransform = writeTransform as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeState(overrides?: Partial<VerifiedObjectState>): VerifiedObjectState {
  return {
    networkId: 0n,
    templateName: 'object/tangible/deed/base.iff',
    transform: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
    playerAlive: true,
    hasTarget: true,
    targetUnavailableOnBuild: false,
    scaleUnavailableOnBuild: false,
    focusToken: 1,
    ...overrides,
  };
}

function attach(mappingName = 'Local\\SwgToolkitLive_test'): void {
  useLiveStore.getState().attachComplete(1234, mappingName);
}

function makeObjectRef(): React.RefObject<THREE.Object3D | null> {
  const obj = new THREE.Object3D();
  obj.position.set(1, 2, 3);
  obj.scale.set(1, 1, 1);
  return { current: obj };
}

function findControls(mode: string): CapturedControls {
  const match = [...mockControlsCalls].reverse().find((c) => c.mode === mode);
  if (!match) throw new Error(`no TransformControls captured for mode=${mode}`);
  return match;
}

beforeEach(() => {
  mockWriteTransform.mockClear();
  mockControlsCalls.length = 0;
  useLiveStore.getState().detach();
});

// ─── objectToTransform12 (pure, zero-alloc conversion helper) ────────────────

describe('objectToTransform12', () => {
  it('identity rotation places translation in column 3 (row-major float[3][4])', () => {
    const obj = new THREE.Object3D();
    obj.position.set(1, 2, 3);
    const out = new Float32Array(12);
    objectToTransform12(obj, out);
    expect(Array.from(out)).toEqual([
      1, 0, 0, 1,
      0, 1, 0, 2,
      0, 0, 1, 3,
    ]);
  });

  it('a 180-degree Z rotation flips the X/Y rotation columns, translation unchanged', () => {
    const obj = new THREE.Object3D();
    obj.position.set(0, 0, 0);
    obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    const out = new Float32Array(12);
    objectToTransform12(obj, out);
    expect(out[0]).toBeCloseTo(-1, 5);
    expect(out[5]).toBeCloseTo(-1, 5);
    expect(out[10]).toBeCloseTo(1, 5);
  });

  it('never allocates — reuses the SAME caller-supplied buffer across repeated calls', () => {
    const obj = new THREE.Object3D();
    const out = new Float32Array(12);
    objectToTransform12(obj, out);
    const ref = out;
    objectToTransform12(obj, out);
    expect(out).toBe(ref);
  });
});

// ─── Write suppression (T-05-16, T-05-17, T-05-36, Cursor MEDIUM) ────────────

describe('TransformGizmo write suppression', () => {
  it('calls writeTransform with a 12-length and a 3-length array on a drag-change tick while attached and guardState.transform is ok', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    const objRef = makeObjectRef();

    render(<TransformGizmo object={objRef} mode="translate" />);
    findControls('translate').onChange!();

    expect(mockWriteTransform).toHaveBeenCalledTimes(1);
    const [mappingName, transform, scale] = mockWriteTransform.mock.calls[0]!;
    expect(mappingName).toBe('Local\\SwgToolkitLive_test');
    expect((transform as Float32Array).length).toBe(12);
    expect((scale as Float32Array).length).toBe(3);
  });

  it('suppresses translate/rotate writes when guardState.transform is blocked (traffic suppression)', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    useLiveStore.getState().setGuardState('transform', 'blocked');
    const objRef = makeObjectRef();

    render(<TransformGizmo object={objRef} mode="translate" />);
    findControls('translate').onChange!();

    expect(mockWriteTransform).not.toHaveBeenCalled();
  });

  it('suppresses ONLY scale writes when guardState.scale is blocked (transform unaffected) and scaleUnavailableOnBuild is false', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ scaleUnavailableOnBuild: false }));
    useLiveStore.getState().setGuardState('scale', 'blocked');
    const objRef = makeObjectRef();

    render(<TransformGizmo object={objRef} mode="universal" />);
    findControls('scale').onChange!();
    expect(mockWriteTransform).not.toHaveBeenCalled();

    findControls('translate').onChange!();
    expect(mockWriteTransform).toHaveBeenCalledTimes(1);
  });

  it('ROUND 2: when scaleUnavailableOnBuild is true, writeTransform is NEVER called regardless of guardState.scale, and the status label reads "Scale unavailable on this build"', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ scaleUnavailableOnBuild: true }));
    // guardState.scale intentionally left 'ok' — proves the structural gate
    // takes precedence independently of the ordinary guard-blocked state.
    const objRef = makeObjectRef();

    render(<TransformGizmo object={objRef} mode="scale" />);
    findControls('scale').onChange!();
    expect(mockWriteTransform).not.toHaveBeenCalled();

    render(<GizmoStatusLabel mode="scale" />);
    expect(screen.getByText('Scale unavailable on this build')).toBeTruthy();
  });

  it('never calls writeTransform while status.kind is not attached (no fallback write path offline)', () => {
    // status stays 'idle' (detach() in beforeEach)
    const objRef = makeObjectRef();

    render(<TransformGizmo object={objRef} mode="translate" />);
    const captured = findControls('translate');
    expect(captured.enabled).toBe(false);

    captured.onChange!();
    expect(mockWriteTransform).not.toHaveBeenCalled();
  });
});

// ─── GizmoStatusLabel (D-05 offline copy + 05-CONTEXT decision #1 ROUND 2) ───

describe('GizmoStatusLabel', () => {
  it('offline copy matches exactly', () => {
    render(<GizmoStatusLabel mode="translate" />);
    expect(screen.getByText('○ Offline — attach a client to move objects live')).toBeTruthy();
  });

  it('attached + hasTarget: renders "target: <templateName>" (legacy-shaped state, networkId=0n)', () => {
    attach();
    useLiveStore.getState().updateState(
      makeState({ hasTarget: true, targetUnavailableOnBuild: false, networkId: 0n, templateName: 'object/mobile/shared_bantha.iff' }),
    );
    render(<GizmoStatusLabel mode="translate" />);
    expect(screen.getByText('target: object/mobile/shared_bantha.iff')).toBeTruthy();
  });

  it('attached + hasTarget: renders "target: <templateName>" (advertised-shaped state, networkId non-zero) — build-agnostic', () => {
    attach();
    useLiveStore.getState().updateState(
      makeState({ hasTarget: true, targetUnavailableOnBuild: false, networkId: 123456789n, templateName: 'object/creature/npc_womp_rat.iff' }),
    );
    render(<GizmoStatusLabel mode="translate" />);
    expect(screen.getByText('target: object/creature/npc_womp_rat.iff')).toBeTruthy();
  });

  it('attached + no target, mechanism available: renders "target: none — moving player avatar"', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: false, targetUnavailableOnBuild: false }));
    render(<GizmoStatusLabel mode="translate" />);
    expect(screen.getByText('target: none — moving player avatar')).toBeTruthy();
  });

  it('attached + resolution mechanism unresolved: renders "target: unavailable on this build — moving player avatar"', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: false, targetUnavailableOnBuild: true }));
    render(<GizmoStatusLabel mode="translate" />);
    expect(screen.getByText('target: unavailable on this build — moving player avatar')).toBeTruthy();
  });

  it('does not show the Scale-unavailable line outside scale/universal mode even when scaleUnavailableOnBuild is true', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ scaleUnavailableOnBuild: true }));
    render(<GizmoStatusLabel mode="translate" />);
    expect(screen.queryByText('Scale unavailable on this build')).toBeNull();
  });
});

// ─── Axis letter labels (UI-SPEC Accessibility Rule 1) ───────────────────────

describe('TransformGizmo axis letter labels', () => {
  it('renders a discoverable letter label for each axis (X/Y/Z), not color alone', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    const objRef = makeObjectRef();

    render(<TransformGizmo object={objRef} mode="translate" />);

    expect(screen.getByText('X')).toBeTruthy();
    expect(screen.getByText('Y')).toBeTruthy();
    expect(screen.getByText('Z')).toBeTruthy();
  });
});
