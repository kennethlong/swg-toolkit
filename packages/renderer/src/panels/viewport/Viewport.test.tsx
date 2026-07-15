/**
 * packages/renderer/src/panels/viewport/Viewport.test.tsx
 * Tests for 05-11 Task 3: the final Surface 1 assembly in Viewport.tsx — the
 * NEW vp-stats overlay (distinct from ViewportPanel's existing verts/tris/
 * draws overlay, which this file never touches), LiveSyncClientCard +
 * TransformReadoutBar mounted as `<Canvas>` siblings, and a single
 * `useLiveStore` status transition driving every HUD surface (including
 * StatusBar, rendered separately) simultaneously from one source of truth.
 *
 * Mocking strategy: this project has no R3F/WebGL test-rendering harness
 * (TransformGizmo.test.tsx's own precedent) — `@react-three/fiber` and
 * `@react-three/drei` are mocked to plain stand-ins so Viewport's DOM-overlay
 * children (LiveSyncClientCard, TransformReadoutBar, GizmoModeRail,
 * GizmoStatusLabel, the new vp-stats line) can be asserted without a real
 * Canvas/WebGL context.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../hooks/useCommandWriter', () => ({
  writeTransform: vi.fn(),
  writeStop: vi.fn(),
}));

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div data-testid="canvas-stub">{children}</div>,
  useThree: () => ({
    gl: { info: { render: { triangles: 0, calls: 0 }, memory: { geometries: 0 } } },
    size: { width: 800, height: 600 },
    scene: {},
    invalidate: () => {},
  }),
  useFrame: () => {},
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Grid: () => null,
  GizmoHelper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  GizmoViewport: () => null,
  Html: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TransformControls: () => null,
}));

import { useLiveStore } from '../../state/liveStore';
import StatusBar from '../../shell/StatusBar';
import Viewport from './Viewport';

beforeEach(() => {
  useLiveStore.getState().detach();
});

describe('Viewport — 05-11 Task 3 vp-stats overlay + Surface 1 assembly', () => {
  it('renders a NEW vp-stats line with the perspective/resolution/fps/SAB-status format', () => {
    render(<Viewport onStats={() => {}} />);
    expect(document.body.textContent).toContain('persp ·');
    expect(document.body.textContent).toContain('fps');
    expect(document.body.textContent).toContain('SAB');
  });

  it('still mounts GizmoModeRail and GizmoStatusLabel (05-10 regression check)', () => {
    render(<Viewport onStats={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Gizmo mode' })).toBeTruthy();
    expect(document.body.textContent).toContain('Offline — attach a client to move objects live');
  });

  it('mounts LiveSyncClientCard and TransformReadoutBar as Canvas siblings', () => {
    render(<Viewport onStats={() => {}} />);
    // Offline copy from both new HUD surfaces is present simultaneously.
    expect(document.body.textContent).toContain('○ Offline');
    expect(document.body.textContent).toContain('mode: file-patch fallback');
  });
});

describe('Viewport + StatusBar — single store transition drives every HUD surface', () => {
  it('an attach->idle (detach) transition flips Viewport HUD copy AND the StatusBar sync segment together', () => {
    useLiveStore.getState().attachComplete(999, 'Local\\SwgToolkitLive_viewporttest');

    const { rerender: rerenderViewport } = render(<Viewport onStats={() => {}} />);
    render(<StatusBar />);

    expect(document.body.textContent).toContain('sync: ● Live · injected · pid 999');
    expect(document.body.textContent).toContain('writing to client');

    useLiveStore.getState().detach();
    rerenderViewport(<Viewport onStats={() => {}} />);

    expect(document.body.textContent).toContain('sync: ○ Offline — file-patch fallback');
    expect(document.body.textContent).toContain('Offline — attach a client to move objects live');
    expect(document.body.textContent).not.toContain('sync: ● Live');
  });
});
