/**
 * packages/renderer/src/panels/editors/SchemaRail.tsx
 * DTII grid editor's right-side schema rail — 05-UI-SPEC.md Surface 2 item 5 (sketch 014-D).
 *
 * 250px fixed-width panel (`--color-surface-2` bg) with three independently-collapsible
 * sections, each with a rotating `▾` twisty (mirrors ShadowChainDetail.tsx's fixed
 * detail-panel-outside-the-scrolling-list idiom — the rail itself is NOT a scrolling list,
 * so each section collapses/expands independently without disturbing the others):
 *
 *   1. `Schema · COLS / TYPE` — one row per column: type badge (shared TypeBadge, D-07 widened
 *      set) + column name + derived storage type (`ascii·z` / `int32` / `float32`, faint).
 *   2. `Selected row` — vertical key/value inspector of the selected row; modified values in
 *      warn; empty state `Click a row…` (faint, Copywriting Contract).
 *   3. `Round-trip gate` — kv rows: `last run` (`never` / `just now`), `result`
 *      (`—` / `✓ byte-exact` / `✗ mismatch @0x<off>`), `bytes` (`DATA <N> B`). Purely
 *      presentational — driven entirely by the `gateState` prop; DatatableGridEditor.tsx
 *      (Task 2) supplies the real values from the live gate machine.
 *
 * Source: 05-UI-SPEC.md Surface 2 item 5 + Copywriting Contract; ShadowChainDetail.tsx
 *         (collapse/fixed-panel idiom); dtiiTypeSpec.ts (physicalTypeForKind, TypeSpecInfo).
 */

import React, { useState } from 'react';
import type { TypeSpecInfo } from './dtiiTypeSpec';
import { physicalTypeForKind } from './dtiiTypeSpec';
import { TypeBadge } from './shared/TypeBadge';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SchemaRailColumn {
  name: string;
  kind: TypeSpecInfo['kind'];
}

export interface SchemaRailSelectedField {
  name: string;
  value: string;
  modified: boolean;
}

export type SchemaRailGateResult =
  | { kind: 'none' }
  | { kind: 'pass' }
  | { kind: 'fail'; offset: number };

export interface SchemaRailGateState {
  /** 'never' or a formatted timestamp/relative label (e.g. 'just now'). */
  lastRun: string;
  result: SchemaRailGateResult;
  /** Total DATA chunk byte count once known; null before the first successful gate run. */
  bytes: number | null;
}

export interface SchemaRailProps {
  columns: SchemaRailColumn[];
  selectedRow: SchemaRailSelectedField[] | null;
  gateState: SchemaRailGateState;
}

// ─── Storage-type label (derived from physicalTypeForKind — D-07 widened set) ──────────────────

function storageTypeLabel(kind: TypeSpecInfo['kind']): string {
  switch (physicalTypeForKind(kind)) {
    case 'float':  return 'float32';
    case 'string': return 'ascii·z';
    case 'int':    return 'int32';
  }
}

// ─── Main component ──────────────────────────────────────────────────────────────

export default function SchemaRail({ columns, selectedRow, gateState }: SchemaRailProps): React.ReactElement {
  return (
    <div
      data-testid="schema-rail"
      style={{
        width: 250,
        flexShrink: 0,
        background: 'var(--color-surface-2)',
        borderLeft: '1px solid var(--color-border)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <RailSection title="Schema · COLS / TYPE" defaultExpanded>
        {columns.length === 0 ? (
          <EmptyHint text="No columns" />
        ) : (
          columns.map((col) => (
            <div
              key={col.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                padding: '2px 0',
              }}
            >
              <TypeBadge kind={col.kind} />
              <span
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={col.name}
              >
                {col.name}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-faint)',
                  flexShrink: 0,
                }}
              >
                {storageTypeLabel(col.kind)}
              </span>
            </div>
          ))
        )}
      </RailSection>

      <RailSection title="Selected row" defaultExpanded>
        {selectedRow === null ? (
          <EmptyHint text="Click a row…" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {selectedRow.map((field) => (
              <div key={field.name} style={{ display: 'flex', gap: 'var(--space-1)' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-faint)',
                    flexShrink: 0,
                    maxWidth: '45%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={field.name}
                >
                  {field.name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: field.modified ? 'var(--color-warn)' : 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                  title={field.value}
                >
                  {field.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </RailSection>

      <RailSection title="Round-trip gate" defaultExpanded>
        <GateKvRow label="last run" value={gateState.lastRun} />
        <GateKvRow label="result" value={formatGateResult(gateState.result)} warn={gateState.result.kind === 'fail'} accent={gateState.result.kind === 'pass'} />
        <GateKvRow label="bytes" value={gateState.bytes != null ? `DATA ${gateState.bytes} B` : '—'} />
      </RailSection>
    </div>
  );
}

function formatGateResult(result: SchemaRailGateResult): string {
  switch (result.kind) {
    case 'none': return '—';
    case 'pass': return '✓ byte-exact';
    case 'fail': return `✗ mismatch @0x${result.offset.toString(16).toUpperCase()}`;
  }
}

// ─── Gate kv row ──────────────────────────────────────────────────────────────

function GateKvRow({
  label,
  value,
  warn = false,
  accent = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
  accent?: boolean;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-1)', padding: '1px 0' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: warn ? 'var(--color-danger)' : accent ? 'var(--color-accent)' : 'var(--color-text)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Empty hint ───────────────────────────────────────────────────────────────

function EmptyHint({ text }: { text: string }): React.ReactElement {
  return (
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
      {text}
    </span>
  );
}

// ─── Collapsible rail section (rotating ▾ twisty) ───────────────────────────────

function RailSection({
  title,
  defaultExpanded = false,
  children,
}: {
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 'var(--space-2) var(--space-3)',
          textAlign: 'left',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '.07em',
          color: 'var(--color-text-faint)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.1s ease',
          }}
        >
          ▾
        </span>
        <span style={{ flex: 1 }}>{title}</span>
      </button>
      {expanded && (
        <div style={{ padding: '0 var(--space-3) var(--space-3)' }}>
          {children}
        </div>
      )}
    </div>
  );
}
