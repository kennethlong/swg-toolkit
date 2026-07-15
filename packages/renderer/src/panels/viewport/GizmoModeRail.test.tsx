/**
 * packages/renderer/src/panels/viewport/GizmoModeRail.test.tsx
 * Tests for 05-10 Task 2: the mode rail, its W/E/R/Q keyboard shortcuts, and
 * the single-source-of-truth mode contract shared with TransformGizmo.
 *
 * "Shares one mode value with TransformGizmo" is tested via a small harness
 * that lifts state exactly the way Viewport.tsx does (useState + a controlled
 * `mode`/`onModeChange` pair) and asserts the SAME value a `TransformGizmo
 * mode` prop would receive — full R3F Canvas mounting is unavailable in this
 * project's vitest setup (see TransformGizmo.test.tsx's header comment).
 */

import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import GizmoModeRail from './GizmoModeRail';
import type { GizmoMode } from './TransformGizmo';

function Harness({ initial = 'translate' as GizmoMode }: { initial?: GizmoMode }): React.ReactElement {
  const [mode, setMode] = useState<GizmoMode>(initial);
  return (
    <div>
      <GizmoModeRail mode={mode} onModeChange={setMode} />
      {/* Stands in for TransformGizmo's `mode` prop — same lifted value. */}
      <div data-testid="gizmo-mode-mirror">{mode}</div>
    </div>
  );
}

describe('GizmoModeRail', () => {
  it('has role="radiogroup" and exactly one button with aria-pressed="true"', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Gizmo mode' });
    expect(group).toBeTruthy();
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.length).toBe(1);
    expect(pressed[0]!.getAttribute('aria-label')).toBe('Move (W)');
  });

  it('pressing "R" while the viewport has focus activates Scale mode — not disabled/grayed at the mode-selection level (D-09)', () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'r' });
    expect(screen.getByTestId('gizmo-mode-mirror').textContent).toBe('scale');
    const scaleButton = screen.getByRole('button', { name: 'Scale (R)' });
    expect(scaleButton.getAttribute('aria-pressed')).toBe('true');
    expect((scaleButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('W/E/Q also switch modes via keyboard', () => {
    render(<Harness initial="scale" />);
    fireEvent.keyDown(document, { key: 'e' });
    expect(screen.getByTestId('gizmo-mode-mirror').textContent).toBe('rotate');
    fireEvent.keyDown(document, { key: 'q' });
    expect(screen.getByTestId('gizmo-mode-mirror').textContent).toBe('universal');
    fireEvent.keyDown(document, { key: 'w' });
    expect(screen.getByTestId('gizmo-mode-mirror').textContent).toBe('translate');
  });

  it('ignores shortcut keys while focus is inside a text input (does not hijack ordinary typing)', () => {
    render(
      <div>
        <Harness />
        <input aria-label="somewhere else" />
      </div>,
    );
    const input = screen.getByLabelText('somewhere else');
    input.focus();
    fireEvent.keyDown(input, { key: 'r' });
    expect(screen.getByTestId('gizmo-mode-mirror').textContent).toBe('translate');
  });

  it('GizmoModeRail and the shared mode mirror update TOGETHER when a rail button is clicked (single source of truth, no drift)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Universal (Q)' }));
    expect(screen.getByTestId('gizmo-mode-mirror').textContent).toBe('universal');
    expect(screen.getByRole('button', { name: 'Universal (Q)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Move (W)' }).getAttribute('aria-pressed')).toBe('false');
  });
});
