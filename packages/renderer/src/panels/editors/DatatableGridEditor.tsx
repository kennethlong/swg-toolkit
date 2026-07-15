/**
 * packages/renderer/src/panels/editors/DatatableGridEditor.tsx
 * DTII datatable grid editor — main-editor-group tab (05-UI-SPEC.md Surface 2 / sketch 014-D).
 *
 * This plan (05-06) builds items 1-4 of Surface 2's anatomy: the crumb bar, the grid toolbar, and
 * the virtualized typed grid (sort/edit/modified-encoding). The schema rail (item 5), the real Hex
 * view (item 6), and GateBar/FailBanner WIRING to the native round-trip gate (items 7-8) are all
 * completed by 05-08, which depends on this plan — this file renders placeholders/stubs for those
 * so the crumb bar and toolbar read correctly at their target width in the meantime.
 *
 * Consumes 05-02's native parseDataTable() shape directly:
 *   { formatTag: 'DTII', version, columns: [{name, typeSpec}], rows: [[{type,value,byteOffset,byteLength}]] }
 *
 * Cell-widget dispatch is driven ENTIRELY by dtiiTypeSpec.ts's parseTypeSpec() — this file never
 * re-implements the type-spec grammar inline (REVIEWS.md carve-out contract).
 *
 * Virtualization mirrors VfsTree.tsx's ROW_HEIGHT/OVERSCAN/ResizeObserver scaffold verbatim (only
 * ROW_HEIGHT value and the row-renderer differ per 05-UI-SPEC.md's "content-width, virtualized"
 * requirement — real datatables have thousands of rows).
 *
 * Source: 05-UI-SPEC.md Surface 2 items 1-4; 05-02-SUMMARY.md (native return shape);
 *         dtiiTypeSpec.ts (this plan's Task 2).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { parseTypeSpec, bitVectorFlagToMask, type TypeSpecInfo } from './dtiiTypeSpec';
import GateBar from './shared/GateBar';

// ─── Native contract (05-02) ─────────────────────────────────────────────────────

export interface DtiiCellIn {
  type: 'int' | 'float' | 'string';
  value: number | string;
  byteOffset: number;
  byteLength: number;
}

export interface DtiiColumn {
  name: string;
  typeSpec: string;
}

export interface DtiiParsedTable {
  formatTag: string;
  version: string;
  columns: DtiiColumn[];
  rows: DtiiCellIn[][];
}

export interface DatatableGridEditorParams {
  table: DtiiParsedTable;
  virtualPath: string;
  /** Propagates the tab mod-dot up to the dockview tab title (05-08 wires the real tab). */
  onModifiedChange?: (modified: boolean) => void;
  /** Stubs — real behavior wired in 05-08. */
  onStage?: () => void;
  onSaveRunGate?: () => void;
}

// ─── Virtualization constants (VfsTree.tsx idiom) ───────────────────────────────

const ROW_HEIGHT = 26; // 5px+5px cell padding (UI-SPEC) + ~16px text line
const OVERSCAN = 8;
const ROW_NUMBER_COL_WIDTH = 48;
const DEFAULT_COL_WIDTH = 140;

// ─── Working (in-memory edit-buffer) row/cell model ─────────────────────────────

interface WorkingCell {
  type: 'int' | 'float' | 'string';
  value: number | string;
  originalValue: number | string;
}

interface WorkingRow {
  key: string;
  cells: WorkingCell[];
  isNew: boolean;
}

function cloneCell(c: DtiiCellIn): WorkingCell {
  return { type: c.type, value: c.value, originalValue: c.value };
}

/** Physical type for a column's parsed type-spec — mirrors physicalTypeForSpec's basicType
 *  dispatch (DataTable.h): float->Float, string/packedObjVars->String, everything else->Int. */
function physicalTypeForKind(kind: TypeSpecInfo['kind']): 'int' | 'float' | 'string' {
  switch (kind) {
    case 'float': return 'float';
    case 'string':
    case 'packedObjVars':
      return 'string';
    default:
      return 'int';
  }
}

function defaultCellForInfo(info: TypeSpecInfo): WorkingCell {
  const type = physicalTypeForKind(info.kind);
  const value: number | string = type === 'string' ? '' : 0;
  return { type, value, originalValue: value };
}

function isRowModified(row: WorkingRow): boolean {
  return row.isNew || row.cells.some((c) => c.value !== c.originalValue);
}

function isCellModified(row: WorkingRow, cell: WorkingCell): boolean {
  return row.isNew || cell.value !== cell.originalValue;
}

// ─── Type badge set — D-07 widened beyond s/i/f (05-UI-SPEC.md Color, Errata 2) ─────────────────
// enum-table uses the SAME letter+color as plain enum (both getBasicType()===Int, D-12) — the
// widget (read-only vs. dropdown) is the only divergence, enforced in renderCellWidget below.

const BADGE_STYLES: Record<TypeSpecInfo['kind'], { letter: string; color: string; bg: string }> = {
  int:            { letter: 'i', color: '#7dd68a', bg: 'rgba(160,255,170,.10)' },
  float:          { letter: 'f', color: '#e8b46a', bg: 'rgba(255,200,120,.12)' },
  string:         { letter: 's', color: '#7fb2ff', bg: 'rgba(120,180,255,.13)' },
  hashstring:     { letter: 'h', color: '#c58aff', bg: 'rgba(197,138,255,.12)' },
  bool:           { letter: 'b', color: '#ff8ac5', bg: 'rgba(255,138,197,.12)' },
  enum:           { letter: 'e', color: '#8affea', bg: 'rgba(138,255,234,.12)' },
  bitvector:      { letter: 'v', color: '#ffd98a', bg: 'rgba(255,217,138,.12)' },
  packedObjVars:  { letter: 'p', color: '#c5ff8a', bg: 'rgba(197,255,138,.12)' },
  'enum-table':   { letter: 'e', color: '#8affea', bg: 'rgba(138,255,234,.12)' },
  unknown:        { letter: '?', color: '#9a9a9a', bg: 'rgba(154,154,154,.12)' },
};

function TypeBadge({ kind }: { kind: TypeSpecInfo['kind'] }): React.ReactElement {
  const style = BADGE_STYLES[kind];
  return (
    <span
      data-testid="type-badge"
      data-kind={kind}
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: '10px',
        color: style.color,
        background: style.bg,
        borderRadius: 'var(--radius-sm)',
        padding: '1px 5px',
        flexShrink: 0,
      }}
    >
      {style.letter}
    </span>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────────

export default function DatatableGridEditor({ params }: IDockviewPanelProps<DatatableGridEditorParams>): React.ReactElement {
  const { table, virtualPath, onModifiedChange, onStage, onSaveRunGate } = params;

  const columnTypeSpecs = useMemo<TypeSpecInfo[]>(
    () => table.columns.map((c) => parseTypeSpec(c.typeSpec)),
    [table.columns],
  );

  const [rows, setRows] = useState<WorkingRow[]>(() =>
    table.rows.map((row, i) => ({ key: `orig-${i}`, cells: row.map(cloneCell), isNew: false })),
  );

  const [viewMode, setViewMode] = useState<'grid' | 'hex'>('grid');
  const [filterQuery, setFilterQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowKey: string; colIdx: number } | null>(null);

  // ── Modified tracking / tab mod-dot propagation ────────────────────────────────

  const anyRowModified = useMemo(() => rows.some(isRowModified), [rows]);
  const modifiedCellCount = useMemo(
    () => rows.reduce((n, row) => n + row.cells.filter((c) => isCellModified(row, c)).length, 0),
    [rows],
  );

  useEffect(() => {
    onModifiedChange?.(anyRowModified);
  }, [anyRowModified, onModifiedChange]);

  // ── Filter (by first/name column) + sort ────────────────────────────────────────

  const filteredRows = useMemo(() => {
    if (!filterQuery.trim()) return rows;
    const q = filterQuery.trim().toLowerCase();
    return rows.filter((row) => String(row.cells[0]?.value ?? '').toLowerCase().includes(q));
  }, [rows, filterQuery]);

  const sortedRows = useMemo(() => {
    if (sortColumn === null) return filteredRows;
    const col = sortColumn;
    const arr = filteredRows.slice();
    arr.sort((a, b) => {
      const av = a.cells[col]?.value ?? '';
      const bv = b.cells[col]?.value ?? '';
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredRows, sortColumn, sortDir]);

  // ── Row add/remove (in-memory only — 05-UI-SPEC destructive-actions table) ─────

  const handleAddRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}-${prev.length}`,
        cells: columnTypeSpecs.map(defaultCellForInfo),
        isNew: true,
      },
    ]);
  }, [columnTypeSpecs]);

  const handleRemoveRow = useCallback(() => {
    setRows((prev) => {
      if (prev.length === 0) return prev;
      const idx = selectedRowKey ? prev.findIndex((r) => r.key === selectedRowKey) : prev.length - 1;
      if (idx === -1) return prev;
      const next = prev.slice();
      next.splice(idx, 1);
      return next;
    });
    setSelectedRowKey(null);
  }, [selectedRowKey]);

  // ── Sort toggle ──────────────────────────────────────────────────────────────

  const handleHeaderClick = useCallback((colIdx: number) => {
    setSortColumn((prevCol) => {
      if (prevCol === colIdx) {
        setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return colIdx;
      }
      setSortDir('asc');
      return colIdx;
    });
  }, []);

  // ── Cell commit — typed coercion happens HERE, before the value ever reaches the
  //    edit-buffer 05-08's gate/serialize step consumes (T-05-20 mitigation: an invalid
  //    numeric entry is REJECTED/reverted at the input, never silently coerced to NaN/0). ──

  const commitCellEdit = useCallback((rowKey: string, colIdx: number, rawValue: string | number) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== rowKey) return row;
        const cells = row.cells.slice();
        const cell = cells[colIdx];
        if (!cell) return row;
        let coerced: number | string = cell.value;
        if (cell.type === 'int') {
          const n = typeof rawValue === 'number' ? rawValue : parseInt(String(rawValue), 10);
          coerced = Number.isNaN(n) ? cell.value : n;
        } else if (cell.type === 'float') {
          const n = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue));
          coerced = Number.isNaN(n) ? cell.value : n;
        } else {
          coerced = String(rawValue);
        }
        cells[colIdx] = { ...cell, value: coerced };
        return { ...row, cells };
      }),
    );
    setEditingCell(null);
  }, []);

  // ── Virtualization (VfsTree.tsx scaffold, verbatim math) ────────────────────────

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 400;
      setViewHeight(h);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget as HTMLDivElement).scrollTop);
  }, []);

  const totalRows = sortedRows.length;
  const totalHeight = totalRows * ROW_HEIGHT;
  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT);
  const startRow = Math.max(0, firstVisible - OVERSCAN);
  const endRow = Math.min(totalRows - 1, firstVisible + visibleCount + OVERSCAN);
  const topPad = startRow * ROW_HEIGHT;
  const bottomPad = Math.max(0, (totalRows - endRow - 1) * ROW_HEIGHT);

  const visibleRowIndices = useMemo(() => {
    const out: number[] = [];
    for (let r = startRow; r <= endRow; r++) out.push(r);
    return out;
  }, [startRow, endRow]);

  const gridTemplateColumns = `${ROW_NUMBER_COL_WIDTH}px repeat(${table.columns.length}, ${DEFAULT_COL_WIDTH}px)`;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* ── Crumb bar (item 2) ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          height: 'var(--tabstrip-h)',
          padding: '0 var(--space-4)',
          background: 'var(--color-header)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          flexShrink: 0,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span style={{ fontWeight: 600 }}>
          FORM DTII <span aria-hidden="true">▸</span> FORM {table.version || '0001'}{' '}
          <span aria-hidden="true">▸</span> DATA
        </span>

        {/* Grid | Hex segmented toggle */}
        <div role="radiogroup" aria-label="View mode" style={{ display: 'flex', gap: 1 }}>
          {(['grid', 'hex'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={viewMode === mode}
              onClick={() => setViewMode(mode)}
              style={{
                background: viewMode === mode ? 'var(--color-accent-dim)' : 'transparent',
                border: `1px solid ${viewMode === mode ? 'var(--color-accent-line)' : 'var(--color-border-soft)'}`,
                color: viewMode === mode ? 'var(--color-accent)' : 'var(--color-text-muted)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          disabled
          title="Compare to base view (sketch 015) is not yet designed"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border-soft)',
            color: 'var(--color-text-faint)',
            borderRadius: 'var(--radius-sm)',
            padding: '1px 8px',
            cursor: 'not-allowed',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-xs)',
          }}
        >
          ⇄ Compare to base
        </button>
        <button
          type="button"
          onClick={() => onStage?.()}
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border-soft)',
            color: 'var(--color-text)',
            borderRadius: 'var(--radius-sm)',
            padding: '1px 8px',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-xs)',
          }}
        >
          ＋ Stage
        </button>
        <button
          type="button"
          onClick={() => onSaveRunGate?.()}
          style={{
            background: 'var(--color-accent-dim)',
            border: '1px solid var(--color-accent-line)',
            color: 'var(--color-accent)',
            borderRadius: 'var(--radius-sm)',
            padding: '1px 10px',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            fontSize: 'var(--text-xs)',
          }}
        >
          Save · run gate
        </button>
      </div>

      {viewMode === 'hex' ? (
        <div
          data-testid="hex-view-placeholder"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-faint)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
          }}
        >
          Hex view — wired in 05-08 (cell-highlight target: {virtualPath})
        </div>
      ) : (
        <>
          {/* ── Grid toolbar (item 3) ────────────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-4)',
              borderBottom: '1px solid var(--color-border)',
              flexShrink: 0,
            }}
          >
            <input
              type="text"
              placeholder="Filter rows…"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              style={{
                background: 'var(--color-widget)',
                border: '1px solid var(--color-border-soft)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text)',
                padding: '2px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                width: 200,
              }}
            />
            <span style={{ width: 1, height: 16, background: 'var(--color-border-soft)' }} />
            <button
              type="button"
              onClick={handleAddRow}
              title="Add row (in-memory only)"
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border-soft)',
                color: 'var(--color-text)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
              }}
            >
              ＋ Row
            </button>
            <button
              type="button"
              onClick={handleRemoveRow}
              title="Remove selected row (in-memory only)"
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border-soft)',
                color: 'var(--color-text)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
              }}
            >
              − Row
            </button>
            <div style={{ flex: 1 }} />
            <span
              data-testid="row-count-chip"
              style={{ color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
            >
              {rows.length} rows · {table.columns.length} cols
              {modifiedCellCount > 0 ? ` · ${modifiedCellCount} cell(s) modified` : ''}
            </span>
          </div>

          {/* ── The grid (item 4) ────────────────────────────────────────────────── */}
          {sortedRows.length === 0 && filterQuery.trim() ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
              }}
            >
              No rows match "{filterQuery.trim()}"
            </div>
          ) : (
            <div
              ref={containerRef}
              onScroll={handleScroll}
              role="grid"
              aria-label="Datatable rows"
              style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns, width: 'max-content', minWidth: '100%' }}>
                {/* Sticky header row */}
                {renderRowNumberHeaderCell()}
                {table.columns.map((col, colIdx) => (
                  <div
                    key={col.name}
                    role="columnheader"
                    onClick={() => handleHeaderClick(colIdx)}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      background: 'var(--color-header)',
                      borderBottom: '1px solid var(--color-border)',
                      borderRight: '1px solid var(--color-border)',
                      padding: '5px 10px',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    <TypeBadge kind={columnTypeSpecs[colIdx]!.kind} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
                    {sortColumn === colIdx && (
                      <span aria-hidden="true" style={{ color: 'var(--color-accent)', marginLeft: 'auto' }}>
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                ))}

                {/* Top pad spacer (spans full row) */}
                <div style={{ gridColumn: `1 / span ${table.columns.length + 1}`, height: topPad }} />

                {visibleRowIndices.map((rowIdx) => {
                  const row = sortedRows[rowIdx];
                  if (!row) return null;
                  const modified = isRowModified(row);
                  const selected = row.key === selectedRowKey;
                  return (
                    <React.Fragment key={row.key}>
                      {/* Row-number cell (sticky left) */}
                      <div
                        onClick={() => setSelectedRowKey(row.key)}
                        style={{
                          position: 'sticky',
                          left: 0,
                          zIndex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: 2,
                          height: ROW_HEIGHT,
                          background: 'var(--color-header)',
                          borderRight: '1px solid var(--color-border)',
                          borderBottom: '1px solid var(--color-border)',
                          padding: '0 6px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          color: 'var(--color-text-faint)',
                          cursor: 'pointer',
                        }}
                      >
                        {modified && (
                          <span aria-hidden="true" style={{ color: 'var(--color-warn)' }}>●</span>
                        )}
                        {rowIdx + 1}
                      </div>

                      {row.cells.map((cell, colIdx) => {
                        const info = columnTypeSpecs[colIdx]!;
                        const cellModified = isCellModified(row, cell);
                        const isEditing = editingCell?.rowKey === row.key && editingCell?.colIdx === colIdx;
                        return (
                          <div
                            key={colIdx}
                            role="gridcell"
                            onClick={() => setSelectedRowKey(row.key)}
                            onDoubleClick={() => {
                              if (info.kind !== 'enum-table') setEditingCell({ rowKey: row.key, colIdx });
                            }}
                            data-modified={cellModified || undefined}
                            style={{
                              height: ROW_HEIGHT,
                              boxSizing: 'border-box',
                              display: 'flex',
                              alignItems: 'center',
                              padding: '5px 10px',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-sm)',
                              cursor: info.kind === 'enum-table' ? 'default' : 'cell',
                              background: selected
                                ? 'var(--color-accent-dim)'
                                : cellModified
                                  ? 'rgba(230,180,80,0.07)'
                                  : 'transparent',
                              borderLeft: cellModified ? '3px inset var(--color-warn)' : '3px solid transparent',
                              borderBottom: '1px solid var(--color-border)',
                              borderRight: '1px solid var(--color-border)',
                              overflow: 'hidden',
                            }}
                          >
                            {isEditing
                              ? renderCellEditor(info, cell, (v) => commitCellEdit(row.key, colIdx, v), () => setEditingCell(null))
                              : renderCellDisplay(info, cell, cellModified)}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  );
                })}

                {/* Bottom pad spacer */}
                <div style={{ gridColumn: `1 / span ${table.columns.length + 1}`, height: bottomPad }} />
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Gate bar footer (item 7) — static not-run placeholder; real gate wiring is 05-08 ── */}
      <GateBar
        state="not-run"
        notRunLabel="round-trip gate: not run"
        runningLabel="round-trip gate: re-encoding DTII…"
        passLabel="✓ byte-exact round-trip"
        failLabel="✗ round-trip mismatch — not staged"
      />
    </div>
  );
}

function renderRowNumberHeaderCell(): React.ReactElement {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        left: 0,
        zIndex: 3,
        background: 'var(--color-header)',
        borderBottom: '1px solid var(--color-border)',
        borderRight: '1px solid var(--color-border)',
      }}
    />
  );
}

// ─── Cell display (read-only) ────────────────────────────────────────────────────

function renderCellDisplay(info: TypeSpecInfo, cell: WorkingCell, modified: boolean): React.ReactElement {
  let text: string;
  if (info.kind === 'bool') {
    text = cell.value === 1 || cell.value === '1' ? 'true' : 'false';
  } else if (info.kind === 'enum') {
    const match = Object.entries(info.labels).find(([, v]) => v === cell.value);
    text = match ? match[0] : String(cell.value);
  } else if (info.kind === 'bitvector') {
    const mask = Number(cell.value) || 0;
    const active = Object.entries(info.flags)
      .filter(([, bit]) => (mask & bitVectorFlagToMask(bit)) !== 0)
      .map(([label]) => label);
    text = active.length > 0 ? active.join('|') : 'NONE';
  } else {
    text = String(cell.value);
  }

  return (
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {text}
      {modified && <span style={{ color: 'var(--color-warn)' }}> ●</span>}
    </span>
  );
}

// ─── Cell editors (double-click to edit; Enter commits, Escape cancels, blur commits) ──────────

function renderCellEditor(
  info: TypeSpecInfo,
  cell: WorkingCell,
  commit: (value: string | number) => void,
  cancel: () => void,
): React.ReactElement {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--color-widget)',
    border: '1px solid var(--color-accent-line)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text)',
    padding: '1px 4px',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
  };

  const onKeyDownFactory = (getValue: () => string | number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit(getValue());
    else if (e.key === 'Escape') cancel();
  };

  switch (info.kind) {
    case 'enum-table':
      // Read-only numeric display — no dropdown, no cross-table resolution (D-12/Open Question 2
      // safe default; REVIEWS.md MEDIUM fix). Editing is disallowed by construction (onDoubleClick
      // never sets editingCell for this kind), so this branch is unreachable in practice, but kept
      // as a defensive fallback that renders the same read-only display.
      return <span>{String(cell.value)}</span>;

    case 'enum': {
      return (
        <select
          autoFocus
          defaultValue={String(cell.value)}
          onChange={(e) => {
            const label = e.target.value;
            const val = info.labels[label];
            commit(val ?? cell.value);
          }}
          onBlur={(e) => {
            const label = e.target.value;
            const val = info.labels[label];
            commit(val ?? cell.value);
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
          style={inputStyle}
        >
          {Object.entries(info.labels).map(([label, val]) => (
            <option key={label} value={label} selected={val === cell.value}>
              {label}
            </option>
          ))}
        </select>
      );
    }

    case 'bool': {
      const checked = cell.value === 1 || cell.value === '1';
      return (
        <input
          autoFocus
          type="checkbox"
          defaultChecked={checked}
          onChange={(e) => commit(e.target.checked ? 1 : 0)}
          onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
        />
      );
    }

    case 'bitvector': {
      const mask = Number(cell.value) || 0;
      let working = mask;
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.entries(info.flags).map(([label, bit]) => {
            const bitMask = bitVectorFlagToMask(bit);
            return (
              <label key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 'var(--text-xs)' }}>
                <input
                  type="checkbox"
                  defaultChecked={(mask & bitMask) !== 0}
                  onChange={(e) => {
                    working = e.target.checked ? working | bitMask : working & ~bitMask;
                    commit(working);
                  }}
                />
                {label}
              </label>
            );
          })}
        </div>
      );
    }

    case 'packedObjVars': {
      // Minimal structured name|type|value editor (D-07 "full inline edit" requirement) — a
      // single-entry pipe-delimited field, not a bare text box. Joins on commit as
      // `name|type|value|$|` matching the real on-disk packed-objvar terminator convention.
      const raw = String(cell.value);
      const parts = raw.split('|');
      const [name0 = '', type0 = '0', value0 = ''] = parts;
      let name = name0;
      let typeField = type0;
      let valueField = value0;
      const join = () => `${name}|${typeField}|${valueField}|$|`;
      return (
        <div style={{ display: 'flex', gap: 2 }}>
          <input
            autoFocus
            placeholder="name"
            defaultValue={name}
            onChange={(e) => { name = e.target.value; }}
            onKeyDown={onKeyDownFactory(join)}
            onBlur={() => commit(join())}
            style={{ ...inputStyle, width: '40%' }}
          />
          <input
            placeholder="type"
            defaultValue={typeField}
            onChange={(e) => { typeField = e.target.value; }}
            onKeyDown={onKeyDownFactory(join)}
            onBlur={() => commit(join())}
            style={{ ...inputStyle, width: '20%' }}
          />
          <input
            placeholder="value"
            defaultValue={valueField}
            onChange={(e) => { valueField = e.target.value; }}
            onKeyDown={onKeyDownFactory(join)}
            onBlur={() => commit(join())}
            style={{ ...inputStyle, width: '40%' }}
          />
        </div>
      );
    }

    case 'int':
    case 'float': {
      let current: string = String(cell.value);
      return (
        <input
          autoFocus
          type="number"
          defaultValue={current}
          onChange={(e) => { current = e.target.value; }}
          onKeyDown={onKeyDownFactory(() => current)}
          onBlur={() => commit(current)}
          style={inputStyle}
        />
      );
    }

    case 'string':
    case 'hashstring':
    case 'unknown':
    default: {
      let current: string = String(cell.value);
      return (
        <input
          autoFocus
          type="text"
          defaultValue={current}
          onChange={(e) => { current = e.target.value; }}
          onKeyDown={onKeyDownFactory(() => current)}
          onBlur={() => commit(current)}
          style={inputStyle}
        />
      );
    }
  }
}
