/**
 * packages/renderer/src/shared/AsyncProgress.tsx — Async/progress affordance (Surface 4).
 *
 * Determinate and indeterminate progress bars for long-running async operations
 * (mount, parse, round-trip verify). Includes a Cancel text action (aria-reachable).
 *
 * Source: 01-UI-SPEC.md § "Surface 4 — Async / Progress & Verification-Status Affordances".
 * Tokens: var(--color-accent) fill, var(--color-widget) track, 3px bar height.
 * Copy: "Mounting {filename} · {pct}%", "Parsing {filename}…", "Cancel mount".
 */

import React from 'react';

interface AsyncProgressProps {
  /** Caption text to display above the bar (e.g. "Mounting foo.tre · 42%"). */
  caption: string;
  /**
   * Progress value 0–100 for determinate mode.
   * Omit or pass undefined for indeterminate (animated sweep).
   */
  pct?: number;
  /** aria-label for the Cancel button. e.g. "Cancel mount". */
  cancelLabel?: string;
  /** Called when the user clicks Cancel. If not provided, Cancel is not shown. */
  onCancel?: () => void;
}

export default function AsyncProgress({
  caption,
  pct,
  cancelLabel = 'Cancel',
  onCancel,
}: AsyncProgressProps): React.ReactElement {
  const isDeterminate = pct !== undefined;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
        background: 'var(--color-surface)',
      }}
    >
      {/* Caption + optional Cancel */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          {caption}
        </span>
        {onCancel && (
          <button
            aria-label={cancelLabel}
            title={cancelLabel}
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-xs)',
              padding: '0 var(--space-1)',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress bar (3px tall per UI-SPEC) */}
      <div
        role="progressbar"
        aria-valuenow={isDeterminate ? pct : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={caption}
        style={{
          height: '3px',
          background: 'var(--color-widget)',
          borderRadius: '2px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {isDeterminate ? (
          <div
            style={{
              height: '100%',
              width: `${Math.min(100, Math.max(0, pct!))}%`,
              background: 'var(--color-accent)',
              transition: 'width 0.2s ease',
              borderRadius: '2px',
            }}
          />
        ) : (
          /* Indeterminate: CSS animation sweep */
          <div
            style={{
              height: '100%',
              width: '40%',
              background: 'var(--color-accent)',
              borderRadius: '2px',
              animation: 'swg-indeterminate 1.4s ease-in-out infinite',
              position: 'absolute',
            }}
          />
        )}
      </div>

      {/* Inject indeterminate keyframe animation once */}
      <style>{`
        @keyframes swg-indeterminate {
          0%   { left: -40%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  );
}
