/**
 * packages/renderer/src/panels/LiveInspectorPanel.tsx
 * Dockable live-injection inspector panel — Phase 3 HUD surface.
 *
 * Surfaces the three injection states:
 *   STATE 1 — idle / file-patch / error: disabled state with reason (D-08);
 *             "Connecting…" sub-state when status.kind === 'connecting'
 *   STATE 2 — live + verified: networkId, templateName, transform, playerAlive
 *   STATE 3 — live + regionBytes: collapsible raw memory view (HexInspector, D-07)
 *
 * The attach trigger UI (STATE 1 button) is wired in Plan 03-06b Task 2.
 *
 * Structural analog: InspectorPanel.tsx (panel head, collapse, actionBtnStyle).
 *
 * Source: 03-PATTERNS.md §LiveInspectorPanel.tsx; 03-CONTEXT.md §D-07, §D-08.
 *
 * Accessibility Rule 5: aria-label + title on all icon-only controls.
 */

import React, { useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { useLiveStore } from '../state/liveStore.ts';
import HexInspector from './iff/HexInspector';
import { launchAndInjectUI, attachToRunningUI } from '../hooks/useLiveService';
import { useChannelReader } from '../hooks/useChannelReader';

// VerifiedObjectState is used for type guidance only (flows through liveStore).
import type { VerifiedObjectState } from '@swg/contracts';

// Satisfy the import so TypeScript doesn't prune it — the type is referenced
// in the helper below to keep field access explicit.
void (0 as unknown as VerifiedObjectState);

export default function LiveInspectorPanel(_props: IDockviewPanelProps): React.ReactElement {
  const [collapsed,    setCollapsed]   = useState(false);
  const [hexExpanded,  setHexExpanded] = useState(false);
  const [hoveredByte,  setHoveredByte] = useState<number | null>(null);
  const [clientExe,    setClientExe]   = useState('');
  const [attachPid,    setAttachPid]   = useState('');

  const status        = useLiveStore((s) => s.status);
  const mode          = useLiveStore((s) => s.mode);
  const disabledReason = useLiveStore((s) => s.disabledReason);
  const verifiedState = useLiveStore((s) => s.verifiedState);
  const regionBytes   = useLiveStore((s) => s.regionBytes);
  const isConnecting  = useLiveStore((s) => s.status.kind === 'connecting');

  // Activates RAF poll loop when status is 'attached'; no-ops otherwise (useChannelReader).
  useChannelReader();

  // ── Derived display values ─────────────────────────────────────────────────

  /** Extract translation from float[3][4] row-major transform (column 3 = indices 3, 7, 11). */
  function positionFromTransform(t: Float32Array): string {
    const x = t[3]?.toFixed(2) ?? '—';
    const y = t[7]?.toFixed(2) ?? '—';
    const z = t[11]?.toFixed(2) ?? '—';
    return `${x}  ${y}  ${z}`;
  }

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
        background:    'var(--color-surface)',
        color:         'var(--color-text)',
        fontFamily:    'var(--font-sans)',
        overflow:      'hidden',
      }}
    >
      {/* Panel head */}
      <div
        style={{
          display:       'flex',
          alignItems:    'center',
          height:        'var(--tabstrip-h)',
          background:    'var(--color-header)',
          borderBottom:  '1px solid var(--color-border)',
          padding:       '0 var(--space-2)',
          gap:           'var(--space-2)',
          flexShrink:    0,
        }}
      >
        <span
          style={{
            color:      'var(--color-text-faint)',
            cursor:     'grab',
            fontSize:   'var(--text-sm)',
            userSelect: 'none',
            width:      18,
            textAlign:  'center',
          }}
        >
          ⠿
        </span>
        <span
          style={{
            fontSize:   'var(--text-sm)',
            color:      'var(--color-text)',
            fontWeight: 600,
            flex:       1,
          }}
        >
          Live Inspector
        </span>
        {/* Accessibility Rule 5: both labels used (collapsed/expanded states) */}
        {collapsed ? (
          <button
            aria-label="Expand panel"
            title="Expand panel"
            style={actionBtnStyle}
            onClick={() => setCollapsed(false)}
          >
            ▸
          </button>
        ) : (
          <button
            aria-label="Collapse panel"
            title="Collapse panel"
            style={actionBtnStyle}
            onClick={() => setCollapsed(true)}
          >
            ▾
          </button>
        )}
      </div>

      {/* Panel body (hidden when collapsed) */}
      {!collapsed && (
        <div
          style={{
            flex:          1,
            overflowY:     'auto',
            minHeight:     0,
            padding:       'var(--space-3) 10px',
            display:       'flex',
            flexDirection: 'column',
            gap:           'var(--space-2)',
          }}
        >

          {/* ── STATE 1: File-patch / idle / error / connecting ──────────── */}
          {(mode === 'file-patch' || status.kind === 'idle' || status.kind === 'error') && (
            <div
              style={{
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                justifyContent: 'center',
                flex:          1,
                gap:           'var(--space-2)',
                padding:       'var(--space-3) 0',
                textAlign:     'center',
              }}
            >
              {status.kind === 'connecting' ? (
                /* Connecting sub-state */
                <span
                  style={{
                    color:    'var(--color-text-muted)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  Connecting…
                </span>
              ) : (
                /* Disabled / file-patch state (D-08) */
                <>
                  <span
                    style={{
                      color:    'var(--color-text-muted)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    ○ File-patch mode
                  </span>
                  <span
                    style={{
                      color:    'var(--color-text-faint)',
                      fontSize: 'var(--text-xs)',
                    }}
                  >
                    {disabledReason ?? 'Injection unavailable — all format editing still works normally.'}
                  </span>
                </>
              )}
              {/* Attach form — only shown when not already connecting/attached */}
              {status.kind !== 'connecting' && (
                <div
                  style={{
                    display:       'flex',
                    flexDirection: 'column',
                    gap:           'var(--space-2)',
                    width:         '100%',
                    marginTop:     'var(--space-3)',
                    textAlign:     'left',
                  }}
                >
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                    Attach to SWG Client
                  </span>

                  {/* PRIMARY PATH — Launch & Inject */}
                  <label style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
                    Client executable
                  </label>
                  <input
                    type="text"
                    value={clientExe}
                    onChange={(e) => setClientExe(e.target.value)}
                    placeholder="C:\path\to\SwgClient_r.exe"
                    style={attachInputStyle}
                  />
                  <button
                    style={attachBtnStyle}
                    disabled={isConnecting || !clientExe.trim()}
                    onClick={() => { void launchAndInjectUI(clientExe.trim()); }}
                  >
                    Launch &amp; Inject (read-verify)
                  </button>

                  {/* SECONDARY PATH — Attach to Running */}
                  <label
                    style={{
                      color:     'var(--color-text-faint)',
                      fontSize:  'var(--text-xs)',
                      marginTop: 'var(--space-2)',
                    }}
                  >
                    Running client PID
                  </label>
                  <input
                    type="number"
                    value={attachPid}
                    onChange={(e) => setAttachPid(e.target.value)}
                    placeholder="PID (e.g. 1234)"
                    style={attachInputStyle}
                  />
                  <button
                    style={attachBtnStyle}
                    disabled={isConnecting || !attachPid.trim() || isNaN(Number(attachPid))}
                    onClick={() => { void attachToRunningUI(Number(attachPid)); }}
                  >
                    Attach to Running (read-verify)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── STATE 2: Live + verified object state ────────────────────── */}
          {mode === 'live' && verifiedState !== null && (
            <div
              style={{
                display:       'flex',
                flexDirection: 'column',
                gap:           'var(--space-2)',
              }}
            >
              <FieldRow label="networkId"    value={verifiedState.networkId.toString()} />
              <FieldRow label="templateName" value={verifiedState.templateName} />
              <FieldRow
                label="position"
                value={positionFromTransform(verifiedState.transform)}
              />
              <FieldRow
                label="playerAlive"
                value={verifiedState.playerAlive ? '● In-world' : '○ Out-of-world'}
                valueColor={verifiedState.playerAlive ? 'var(--color-accent)' : 'var(--color-text-muted)'}
              />
            </div>
          )}

          {/* ── STATE 3: Raw memory view (D-07 stretch) ──────────────────── */}
          {mode === 'live' && regionBytes !== null && (
            <div
              style={{
                display:       'flex',
                flexDirection: 'column',
                gap:           'var(--space-2)',
                marginTop:     'var(--space-2)',
              }}
            >
              <button
                style={hexToggleBtnStyle}
                onClick={() => setHexExpanded(!hexExpanded)}
                aria-label={hexExpanded ? 'Collapse raw memory view' : 'Expand raw memory view'}
                title={hexExpanded ? 'Collapse raw memory view' : 'Expand raw memory view'}
              >
                {hexExpanded ? '▾' : '▸'}{' '}Raw Memory View
              </button>
              {hexExpanded && (
                <div style={{ height: 280, flexShrink: 0 }}>
                  <HexInspector
                    bytes={regionBytes}
                    selectedRange={null}
                    onHoverByte={setHoveredByte}
                    hoveredByteIndex={hoveredByte}
                  />
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FieldRowProps {
  label:       string;
  value:       string;
  valueColor?: string;
}

/** Label / value row — consistent visual language with InspectorPanel field rows. */
function FieldRow({ label, value, valueColor }: FieldRowProps): React.ReactElement {
  return (
    <div
      style={{
        display:    'flex',
        gap:        'var(--space-2)',
        alignItems: 'baseline',
        fontSize:   'var(--text-sm)',
      }}
    >
      <span
        style={{
          color:     'var(--color-text-faint)',
          minWidth:  110,
          flexShrink: 0,
          fontFamily: 'var(--font-mono)',
          fontSize:   'var(--text-xs)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          color:    valueColor ?? 'var(--color-text)',
          wordBreak: 'break-all',
          fontFamily: 'var(--font-mono)',
          fontSize:   'var(--text-xs)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/** Verbatim from InspectorPanel.tsx actionBtnStyle (lines 108-122). */
const actionBtnStyle: React.CSSProperties = {
  background:   'transparent',
  border:       'none',
  color:        'var(--color-text-faint)',
  cursor:       'pointer',
  fontSize:     'var(--text-sm)',
  width:        22,
  height:       22,
  display:      'flex',
  alignItems:   'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  padding:      0,
  transition:   'background 0.12s ease, color 0.12s ease',
};

/** Toggle button for the collapsible hex section. */
const hexToggleBtnStyle: React.CSSProperties = {
  background:    'transparent',
  border:        '1px solid var(--color-border)',
  borderRadius:  'var(--radius-sm)',
  color:         'var(--color-text-muted)',
  cursor:        'pointer',
  fontSize:      'var(--text-xs)',
  fontFamily:    'var(--font-sans)',
  padding:       '2px var(--space-2)',
  textAlign:     'left',
  width:         '100%',
  transition:    'background 0.12s ease, color 0.12s ease',
};

/** Full-width button for the attach trigger actions (Phase 3 read-verify paths). */
const attachBtnStyle: React.CSSProperties = {
  background:    'transparent',
  border:        '1px solid var(--color-border)',
  borderRadius:  'var(--radius-sm)',
  color:         'var(--color-text)',
  cursor:        'pointer',
  fontSize:      'var(--text-xs)',
  fontFamily:    'var(--font-sans)',
  padding:       'var(--space-1) var(--space-2)',
  textAlign:     'center',
  width:         '100%',
  transition:    'background 0.12s ease, color 0.12s ease',
};

/** Text input style for clientExe and PID fields. */
const attachInputStyle: React.CSSProperties = {
  width:        '100%',
  fontSize:     'var(--text-xs)',
  background:   'var(--color-input)',
  color:        'var(--color-text)',
  border:       '1px solid var(--color-border)',
  borderRadius: '2px',
  padding:      'var(--space-1) var(--space-2)',
  boxSizing:    'border-box',
  fontFamily:   'var(--font-mono)',
};
