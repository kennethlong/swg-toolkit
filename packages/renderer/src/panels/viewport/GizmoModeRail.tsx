/**
 * packages/renderer/src/panels/viewport/GizmoModeRail.tsx
 *
 * Left-edge, vertically-centered mode rail for the transform gizmo (LIVE-03,
 * 05-UI-SPEC.md Surface 1 item 3): Move(W) / Rotate(E) / Scale(R) / Universal(Q).
 * A controlled component — the active mode is lifted to Viewport.tsx (single
 * source of truth shared with TransformGizmo's `mode` prop, per this task's
 * action text — no independently-tracked second state that can drift).
 *
 * Scale (R) is ALWAYS selectable regardless of `scaleUnavailableOnBuild` (D-09
 * — Scale remains an in-scope MODE at all times; only the WRITE is suppressed,
 * TransformGizmo.tsx's concern, not this rail's).
 *
 * Source: 05-10-PLAN.md Task 2; 05-UI-SPEC.md Surface 1 item 3.
 */

import React, { useEffect } from 'react';
import type { GizmoMode } from './TransformGizmo.js';

interface RailButton {
  mode: GizmoMode;
  glyph: string;
  key: string;
  label: string;
}

const BUTTONS: RailButton[] = [
  { mode: 'translate', glyph: '✥', key: 'w', label: 'Move (W)' },
  { mode: 'rotate',    glyph: '⟳', key: 'e', label: 'Rotate (E)' },
  { mode: 'scale',     glyph: '⤢', key: 'r', label: 'Scale (R)' },
  { mode: 'universal', glyph: '✛', key: 'q', label: 'Universal (Q)' },
];

const KEY_TO_MODE: Record<string, GizmoMode> = {
  w: 'translate',
  e: 'rotate',
  r: 'scale',
  q: 'universal',
};

export interface GizmoModeRailProps {
  mode: GizmoMode;
  onModeChange: (mode: GizmoMode) => void;
}

export default function GizmoModeRail({ mode, onModeChange }: GizmoModeRailProps): React.ReactElement {
  // Keyboard shortcuts W/E/R/Q — mirrors DeployDialog.tsx's document-level
  // keydown-listener-in-useEffect idiom (this codebase's established pattern;
  // grepped per this task's read_first, no viewport-panel-focus-scoping
  // precedent exists elsewhere to mirror instead). Ignore keystrokes while
  // the user is typing in a text input/textarea elsewhere in the app (Rule 2
  // — an un-scoped global shortcut would otherwise hijack ordinary typing).
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      const next = KEY_TO_MODE[e.key.toLowerCase()];
      if (next) onModeChange(next);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onModeChange]);

  return (
    <div
      role="radiogroup"
      aria-label="Gizmo mode"
      style={{
        position: 'absolute',
        left: 8,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        zIndex: 3,
      }}
    >
      {BUTTONS.map((b) => {
        const active = mode === b.mode;
        return (
          <button
            key={b.mode}
            type="button"
            aria-pressed={active}
            aria-label={b.label}
            title={b.label}
            onClick={() => onModeChange(b.mode)}
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              background: active ? 'var(--color-accent-dim)' : 'rgba(20,20,20,0.7)',
              border: `1px solid ${active ? 'var(--color-accent-line)' : 'var(--color-border-soft)'}`,
              color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              backdropFilter: active ? undefined : 'blur(4px)',
            }}
          >
            <span style={{ fontSize: 'var(--text-md)', lineHeight: 1 }} aria-hidden="true">{b.glyph}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, lineHeight: 1, textTransform: 'uppercase' }}>
              {b.key}
            </span>
          </button>
        );
      })}
    </div>
  );
}
