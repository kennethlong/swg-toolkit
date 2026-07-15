/**
 * packages/renderer/src/panels/editors/shared/FailBanner.tsx
 * Shared danger-tinted diagnostic banner shown above the GateBar on a gate FAIL — ONE
 * implementation reused by the DTII grid editor (05-06/05-08) and the .stf strings editor
 * (05-09), per 05-UI-SPEC.md's Component Inventory (sibling anatomy contract).
 *
 * DTII copy (05-08 wires the real values in): "Round-trip gate FAILED at DATA+0x<offset> -
 * expected <bytes>, wrote <bytes>. Not staged." + actions "Jump to bytes" / "Revert cell".
 * .stf inherits the same anatomy (05-UI-SPEC.md Surface 3 item 6) with its own message/actions.
 *
 * Pure/presentational — driven entirely by props, no DTII-specific or .stf-specific imports.
 *
 * Accessibility: root element carries role="alert" (05-UI-SPEC.md Accessibility contract —
 * "Banners use role=alert (guard-blocked, gate-fail)").
 *
 * Source: 05-UI-SPEC.md Surface 2 item 8 (fail banner copy contract), Copywriting Contract table.
 */

import React from 'react';

export interface FailBannerAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
}

export interface FailBannerProps {
  message: string;
  actions: FailBannerAction[];
}

export default function FailBanner({ message, actions }: FailBannerProps): React.ReactElement {
  return (
    <div
      role="alert"
      data-testid="fail-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-4)',
        background: 'rgba(230,90,90,.08)',
        borderTop: '1px solid var(--color-danger)',
        color: 'var(--color-danger)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        flexShrink: 0,
      }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0 }}>✕</span>
      <span style={{ flex: 1 }}>{message}</span>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            style={{
              background: 'transparent',
              border: `1px solid ${action.variant === 'danger' ? 'var(--color-danger)' : 'var(--color-border-soft)'}`,
              borderRadius: 'var(--radius-sm)',
              color: action.variant === 'danger' ? 'var(--color-danger)' : 'var(--color-text)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-xs)',
              padding: '1px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
