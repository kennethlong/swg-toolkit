/**
 * packages/renderer/src/panels/viewport/TransformReadoutBar.test.tsx
 * Tests for 05-11 Task 2: the bottom-center Pos/Rot/Scale readout bar —
 * imperative drag mirroring (zero React state churn), typed-entry commit
 * parity with the gizmo's write path, D-05 offline copy, and the ROUND 2
 * Scale-build-availability structural gate.
 *
 * Mocking strategy: liveStore.ts imports writeTransform from useCommandWriter
 * (a plain local ES module) — vi.mock works normally, matching
 * liveStore.test.ts / LiveSyncClientCard.test.tsx's established pattern.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VerifiedObjectState } from '@swg/contracts';

vi.mock('../../hooks/useCommandWriter', () => ({
  writeTransform: vi.fn(),
}));

import { useLiveStore } from '../../state/liveStore';
import { writeTransform } from '../../hooks/useCommandWriter';
import { publishDragTick, resetDragTelemetryForTests } from './liveDragTelemetry';
import TransformReadoutBar, { getRenderCountForTests, resetRenderCountForTests } from './TransformReadoutBar';

const mockWriteTransform = writeTransform as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  mockWriteTransform.mockClear();
  useLiveStore.getState().detach();
  resetDragTelemetryForTests();
  resetRenderCountForTests();
  vi.useRealTimers();
});

// ─── D-05 offline copy ──────────────────────────────────────────────────────────

describe('TransformReadoutBar — D-05 write-target indicator', () => {
  it('renders the exact offline copy — never "staged (patch)"', () => {
    render(<TransformReadoutBar />);
    expect(document.body.textContent).toContain('Offline — attach a client to move objects live');
    expect(document.body.textContent).not.toContain('staged (patch)');
  });

  it('flips to the live copy when attached', () => {
    attach();
    render(<TransformReadoutBar />);
    expect(document.body.textContent).toContain('writing to client');
    expect(document.body.textContent).not.toContain('Offline — attach a client to move objects live');
  });
});

// ─── Disabled gating ────────────────────────────────────────────────────────────

describe('TransformReadoutBar — disabled gating', () => {
  it('all numboxes are disabled while offline', () => {
    render(<TransformReadoutBar />);
    const inputs = document.querySelectorAll('input');
    expect(inputs.length).toBe(9);
    inputs.forEach((el) => expect((el as HTMLInputElement).disabled).toBe(true));
  });

  it('Pos/Rot numboxes are enabled while attached', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    render(<TransformReadoutBar />);
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    // First 6 inputs are Pos (0-2) and Rot (3-5).
    for (let i = 0; i < 6; i++) expect(inputs[i]!.disabled).toBe(false);
  });

  it('ROUND 2: Scale numboxes are disabled when attached AND scaleUnavailableOnBuild, while Pos/Rot remain interactive', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ scaleUnavailableOnBuild: true }));
    render(<TransformReadoutBar />);
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    for (let i = 0; i < 6; i++) expect(inputs[i]!.disabled).toBe(false);
    for (let i = 6; i < 9; i++) expect(inputs[i]!.disabled).toBe(true);
    expect(document.body.textContent).toContain('Scale unavailable on this build');
  });
});

// ─── Typed entry commit parity ─────────────────────────────────────────────────

describe('TransformReadoutBar — typed entry commit', () => {
  it('Enter commits a Pos value via the SAME writeTransform function a gizmo drag calls', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    render(<TransformReadoutBar />);

    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const posX = inputs[0]!;
    fireEvent.change(posX, { target: { value: '12.5' } });
    fireEvent.keyDown(posX, { key: 'Enter' });

    expect(mockWriteTransform).toHaveBeenCalledTimes(1);
    const [mappingName, transform] = mockWriteTransform.mock.calls[0]!;
    expect(mappingName).toBe('Local\\SwgToolkitLive_test');
    expect((transform as Float32Array)[3]).toBeCloseTo(12.5, 3);
  });

  it('typed entry is IMPOSSIBLE while status.kind !== attached (input disabled, no commit fires)', () => {
    render(<TransformReadoutBar />);
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const posX = inputs[0]!;
    expect(posX.disabled).toBe(true);
    fireEvent.keyDown(posX, { key: 'Enter' });
    expect(mockWriteTransform).not.toHaveBeenCalled();
  });
});

// ─── Imperative drag mirror — zero React state churn (LIVE-03 SC1) ────────────

describe('TransformReadoutBar — imperative drag mirror', () => {
  it('a simulated 60-tick drag sequence keeps the React render count O(1), not O(60)', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    render(<TransformReadoutBar />);

    const before = getRenderCountForTests();
    const t = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 5]);
    const s = new Float32Array([1, 1, 1]);
    for (let i = 0; i < 60; i++) {
      t[11] = 5 + i * 0.01;
      publishDragTick(t, s);
    }
    const after = getRenderCountForTests();
    // Exactly ONE additional render is allowed — the drag-START dragging=true
    // transition (a single state flip, per the plan's own carve-out), never
    // one render per tick.
    expect(after - before).toBeLessThanOrEqual(1);
  });

  it('numbox DOM values update directly (imperative) during the simulated drag', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    render(<TransformReadoutBar />);

    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const posX = inputs[0]!;
    const t = new Float32Array([1, 0, 0, 42, 0, 1, 0, 0, 0, 0, 1, 0]);
    const s = new Float32Array([1, 1, 1]);
    publishDragTick(t, s);

    expect(posX.value).toBe('42.00');
  });
});
