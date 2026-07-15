/**
 * packages/renderer/src/panels/editors/shared/GateBar.tsx
 * Shared footer gate-state bar — ONE implementation reused by the DTII grid editor (05-06/05-08)
 * and the .stf strings editor (05-09), per 05-UI-SPEC.md's Component Inventory ("Shared GateBar /
 * GateChip / FailBanner — ONE shared implementation across 014/018 — sibling anatomy is the
 * contract, same chip states, same banner skeleton").
 *
 * The round-trip gate is a first-class 4-state machine (not-run / running / pass / fail), never
 * color alone (05-UI-SPEC.md Surface 2 item 7, Accessibility Rule 1):
 *   not-run  -> neutral glyph/color, solid border
 *   running  -> info text, DASHED border (VerificationStatus's dashedBorder prop)
 *   pass     -> accent "gate-ok" pill + adjacent "-> staged in working changes" info chip
 *   fail     -> danger "gate-fail" pill (FailBanner, rendered by the caller, carries the diagnostic)
 *
 * Both DTII and .stf supply their OWN copy strings as props (notRunLabel/runningLabel/passLabel/
 * failLabel) so the two editors share this single component with different text:
 *   DTII: "round-trip gate: not run" / "round-trip gate: re-encoding DTII..." /
 *         "byte-exact round-trip (<N> B)" / "round-trip mismatch - not staged"
 *   .stf: "round-trip gate: not run" / "gate: rebuilding index + payload..." /
 *         "byte-exact round-trip . CRC index rebuilt" / "round-trip mismatch - not staged"
 *
 * This component is pure/presentational — no DTII-specific or .stf-specific imports — so 05-09
 * can import it unchanged (REVIEWS.md carve-out contract).
 *
 * Source: 05-UI-SPEC.md Surface 2 item 7 (gate bar state table), Surface 2 item 2 ("Save . run
 * gate" primary CTA lives in the crumb bar, not here), Copywriting Contract (exact strings).
 */

import React from 'react';
import VerificationStatus from '../../../shared/VerificationStatus';

export type GateState = 'not-run' | 'running' | 'pass' | 'fail';

export interface GateBarProps {
  state: GateState;
  notRunLabel: string;
  runningLabel: string;
  passLabel: string;
  failLabel: string;
  /** Wired by 05-08/05-09 to trigger "Save . run gate" from the gate bar itself, if present.
   *  Optional — the primary CTA usually lives in the crumb bar; this is a secondary affordance. */
  onSaveRunGate?: () => void;
  /**
   * Right-aligned faint mono footer note (05-09 — .stf UI-SPEC Surface 3 item 5: "values are
   * UTF-16LE . keys ASCII . sourceCrc preserved on save"). Optional — DTII (05-06/05-08) has no
   * footer note and omits this prop, so the gate bar's height/anatomy is unchanged for DTII.
   */
  note?: string;
}

const STAGED_CHIP_LABEL = '→ staged in working changes';

export default function GateBar({
  state,
  notRunLabel,
  runningLabel,
  passLabel,
  failLabel,
  note,
}: GateBarProps): React.ReactElement {
  const { variant, caption, dashedBorder } = mapStateToStatus(state, {
    notRunLabel,
    runningLabel,
    passLabel,
    failLabel,
  });

  return (
    <div
      data-testid="gate-bar"
      data-gate-state={state}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: 'var(--tabstrip-h)',
        padding: '0 var(--space-4)',
        background: 'var(--color-header)',
        borderTop: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    >
      <VerificationStatus variant={variant} caption={caption} dashedBorder={dashedBorder} />
      {state === 'pass' && (
        <span
          data-testid="gate-staged-chip"
          style={{
            color: 'var(--color-info)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {STAGED_CHIP_LABEL}
        </span>
      )}
      {note && (
        <span
          data-testid="gate-bar-note"
          style={{
            marginLeft: 'auto',
            color: 'var(--color-text-faint)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {note}
        </span>
      )}
    </div>
  );
}

function mapStateToStatus(
  state: GateState,
  labels: { notRunLabel: string; runningLabel: string; passLabel: string; failLabel: string },
): { variant: 'neutral' | 'running' | 'pass' | 'fail'; caption: string; dashedBorder: boolean } {
  switch (state) {
    case 'not-run':
      return { variant: 'neutral', caption: labels.notRunLabel, dashedBorder: false };
    case 'running':
      return { variant: 'running', caption: labels.runningLabel, dashedBorder: true };
    case 'pass':
      return { variant: 'pass', caption: labels.passLabel, dashedBorder: false };
    case 'fail':
      return { variant: 'fail', caption: labels.failLabel, dashedBorder: false };
  }
}
