/**
 * packages/renderer/src/panels/editors/DatatableGridEditor.tsx
 * DTII datatable grid editor — main-editor-group tab (05-UI-SPEC.md Surface 2 / sketch 014-D).
 *
 * 05-06 built items 1-4 of Surface 2's anatomy: the crumb bar, the grid toolbar, and the
 * virtualized typed grid (sort/edit/modified-encoding). This plan (05-08) completes the
 * remaining anatomy end-to-end:
 *   - item 5: the SchemaRail (Schema · COLS/TYPE, Selected row, Round-trip gate).
 *   - item 6: the real Hex view — HexInspector fed the ROWS chunk's cell-data span, with the
 *     last-edited cell's bytes highlighted DIRECTLY via its byteOffset/byteLength (05-02).
 *   - items 7-8: the GateBar/FailBanner WIRED to the real native round-trip
 *     (serializeDataTable -> parseIff -> parseDataTable -> serializeDataTable, byte-compared) and
 *     staging integration — pass stages, fail NEVER stages (T-05-21).
 *   - dockview tab modified-dot wiring via the panel `api` prop.
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
 * Round-trip gate comparator: assertRoundTrip.ts's byte-scan+hex-window diagnostic logic is
 * PORTED INLINE (diffFirstByte below) rather than imported cross-package — @swg/harness is not a
 * declared dependency of @swg/renderer (05-UI-SPEC.md/plan text sanctions this fallback explicitly
 * when a cross-package import is not viable without a new workspace dependency).
 *
 * Source: 05-UI-SPEC.md Surface 2 items 1-8; 05-02-SUMMARY.md (native return shape);
 *         dtiiTypeSpec.ts (type-spec grammar); packages/harness/assertRoundTrip.ts (diagnostic
 *         format ported inline); packages/renderer/src/state/stagingStore.ts (addEntry contract).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { parseTypeSpec, bitVectorFlagToMask, physicalTypeForKind, type TypeSpecInfo } from './dtiiTypeSpec';
import { TypeBadge } from './shared/TypeBadge';
import GateBar from './shared/GateBar';
import FailBanner from './shared/FailBanner';
import HexInspector from '../iff/HexInspector';
import SchemaRail, { type SchemaRailGateState } from './SchemaRail';
import { useStagingStore } from '../../state/stagingStore';

// Path B: require the addon directly (nodeIntegration:true in the renderer) — same convention as
// TreVfsBrowser.tsx / StatusBar.tsx. Vite leaves a bare require() untouched so it resolves through
// Electron's real Node at runtime; vitest's module graph still intercepts it via vi.mock.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  parseIff: (bytes: ArrayBuffer | Uint8Array) => { roots: IffNodeLike[]; trailingBytes: unknown; roundTrip: unknown };
  parseDataTable: (iffResult: unknown, srcBytes: ArrayBuffer | Uint8Array) => DtiiParsedTable;
  serializeDataTable: (table: {
    columns: DtiiColumn[];
    rows: Array<Array<{ type: 'int' | 'float' | 'string'; value: number | string }>>;
  }) => ArrayBuffer;
};

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

/** Minimal structural mirror of contracts' IffNode — the ROWS chunk locator only needs these
 *  fields, so this file doesn't take a hard dependency on @swg/contracts' IffNode type. */
interface IffNodeLike {
  tag: string;
  length: number;
  byteOffset: number;
  kind: 'form' | 'leaf';
  subType?: string;
  children?: IffNodeLike[];
}

export interface DatatableGridEditorParams {
  table: DtiiParsedTable;
  virtualPath: string;
  /** Raw bytes of the currently-open .iff file — Hex view target (05-08). Optional so existing
   *  05-06 tests/fixtures that don't build a full byte buffer keep passing unmodified; the Hex
   *  view gracefully falls back to HexInspector's own empty state when absent. */
  sourceBytes?: ArrayBuffer | Uint8Array;
  /** Parsed IFF tree (parseIff().roots) — locates the ROWS chunk's cell-data span for the Hex
   *  view (05-08). Same optionality rationale as sourceBytes. */
  iffRoots?: IffNodeLike[];
  /** Propagates the tab mod-dot up to the dockview tab title (05-08 wires the real tab). */
  onModifiedChange?: (modified: boolean) => void;
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
  /** Original native cell's byte location, relative to the ROWS chunk's cell-data span
   *  (05-02) — undefined for in-memory-added rows/cells that have no location in the source
   *  file yet (05-08 Hex-view highlight target; never re-derived, only ever carried through). */
  byteOffset?: number;
  byteLength?: number;
}

interface WorkingRow {
  key: string;
  cells: WorkingCell[];
  isNew: boolean;
}

function cloneCell(c: DtiiCellIn): WorkingCell {
  return {
    type: c.type,
    value: c.value,
    originalValue: c.value,
    byteOffset: c.byteOffset,
    byteLength: c.byteLength,
  };
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

/** Read-only display text for a cell — shared by the grid's cell display AND SchemaRail's
 *  Selected-row inspector (05-08) so the two never present divergent formatting for the same cell. */
function cellDisplayText(info: TypeSpecInfo, cell: WorkingCell): string {
  if (info.kind === 'bool') {
    return cell.value === 1 || cell.value === '1' ? 'true' : 'false';
  }
  if (info.kind === 'enum') {
    const match = Object.entries(info.labels).find(([, v]) => v === cell.value);
    return match ? match[0] : String(cell.value);
  }
  if (info.kind === 'bitvector') {
    const mask = Number(cell.value) || 0;
    const active = Object.entries(info.flags)
      .filter(([, bit]) => (mask & bitVectorFlagToMask(bit)) !== 0)
      .map(([label]) => label);
    return active.length > 0 ? active.join('|') : 'NONE';
  }
  return String(cell.value);
}

/** The last cell whose edit was committed — drives the Hex view's highlight (05-08 item 6). */
interface LastEditedCell {
  rowKey: string;
  colIdx: number;
  columnName: string;
  kind: TypeSpecInfo['kind'];
  rowNumber: number;
  byteOffset: number;
  byteLength: number;
}

// ─── Round-trip byte-diff (ported inline from packages/harness/assertRoundTrip.ts — @swg/harness
//      is not a declared @swg/renderer dependency; porting is the plan's sanctioned fallback) ────

interface ByteDiff {
  offset: number;
  expectedHex: string;
  actualHex: string;
}

function diffFirstByte(expected: Uint8Array, actual: Uint8Array): ByteDiff | null {
  const len = Math.max(expected.length, actual.length);
  let offset = -1;
  for (let i = 0; i < len; i++) {
    if (expected[i] !== actual[i]) {
      offset = i;
      break;
    }
  }
  if (offset === -1) return null;

  const WINDOW = 8;
  const end = Math.min(len, offset + WINDOW);
  const hexSlice = (arr: Uint8Array, from: number, to: number): string =>
    Array.from({ length: to - from }, (_, k) => {
      const idx = from + k;
      return idx < arr.length ? arr[idx]!.toString(16).toUpperCase().padStart(2, '0') : '--';
    }).join(' ');

  return {
    offset,
    expectedHex: hexSlice(expected, offset, end),
    actualHex: hexSlice(actual, offset, end),
  };
}

// ─── ROWS chunk cell-data span locator (05-08 Hex view — DataTable.cpp ground truth: the ROWS
//      chunk's payload is [numRows:int32][cell data...]; cell byteOffset/byteLength (05-02) are
//      relative to the first byte AFTER that int32 header) ─────────────────────────────────────

function findRowsPayloadSpan(roots: IffNodeLike[] | undefined, version: string): { start: number; end: number } | null {
  const dtii = roots?.[0];
  if (!dtii || dtii.kind !== 'form' || dtii.subType !== 'DTII' || !dtii.children) return null;
  const versionForm =
    dtii.children.find((c) => c.kind === 'form' && c.subType === version) ??
    dtii.children.find((c) => c.kind === 'form');
  if (!versionForm?.children) return null;
  const rowsNode = versionForm.children.find((c) => c.tag === 'ROWS');
  if (!rowsNode) return null;
  const payloadStart = rowsNode.byteOffset + 8 + 4; // 8-byte tag+length header, then numRows int32
  const payloadEnd = rowsNode.byteOffset + 8 + rowsNode.length;
  if (payloadEnd < payloadStart) return null;
  return { start: payloadStart, end: payloadEnd };
}

// ─── Type badge set — D-07 widened beyond s/i/f (05-UI-SPEC.md Color, Errata 2) ─────────────────
// (TypeBadge component + its color map now live in shared/TypeBadge.tsx — reused verbatim by
// SchemaRail.tsx so the rail's Schema·COLS/TYPE badges are pixel-identical to the grid header's.)

// ─── Main component ──────────────────────────────────────────────────────────────

export default function DatatableGridEditor({
  params,
  api,
}: IDockviewPanelProps<DatatableGridEditorParams>): React.ReactElement {
  const { table, virtualPath, sourceBytes, iffRoots, onModifiedChange } = params;

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

  // ── Hex-view highlight target (05-08 item 6) ────────────────────────────────────

  const [lastEditedCell, setLastEditedCell] = useState<LastEditedCell | null>(null);

  // ── Round-trip gate machine (05-08 items 7-8) ────────────────────────────────────

  const [gateState, setGateState] = useState<'not-run' | 'running' | 'pass' | 'fail'>('not-run');
  const [gateLastRun, setGateLastRun] = useState<string>('never');
  const [gateBytes, setGateBytes] = useState<number | null>(null);
  const [gateFailInfo, setGateFailInfo] = useState<(ByteDiff & { bytes: Uint8Array }) | null>(null);
  const [hexJumpActive, setHexJumpActive] = useState(false);

  // ── Modified tracking / tab mod-dot propagation ────────────────────────────────

  const anyRowModified = useMemo(() => rows.some(isRowModified), [rows]);
  const modifiedCellCount = useMemo(
    () => rows.reduce((n, row) => n + row.cells.filter((c) => isCellModified(row, c)).length, 0),
    [rows],
  );

  useEffect(() => {
    onModifiedChange?.(anyRowModified);
    // Dockview tab modified-dot (05-08): mirrors SidebarPanel.tsx's api.setTitle precedent.
    // try/catch guards test environments that pass a stub `api` (e.g. `api={{} as never}`).
    try {
      const fileName = virtualPath.split('/').pop() ?? virtualPath;
      api?.setTitle(`${fileName} — Datatable${anyRowModified ? ' ●' : ''}`);
    } catch {
      /* api unavailable in some test envs */
    }
  }, [anyRowModified, onModifiedChange, api, virtualPath]);

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
  //    gate/serialize step (T-05-20 mitigation: an invalid numeric entry is REJECTED/reverted
  //    at the input, never silently coerced to NaN/0). ──────────────────────────────────────

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

  /** Wraps commitCellEdit with the Hex-view highlight bookkeeping (05-08) — captures the edited
   *  cell's ORIGINAL byteOffset/byteLength (05-02) directly, no re-derivation. Rows added
   *  in-memory (isNew) or cells with no recorded location are simply not highlighted. */
  const handleCellCommit = useCallback(
    (row: WorkingRow, colIdx: number, rowIdx: number, info: TypeSpecInfo, rawValue: string | number) => {
      commitCellEdit(row.key, colIdx, rawValue);
      setHexJumpActive(false);
      const cell = row.cells[colIdx];
      if (!row.isNew && cell?.byteOffset !== undefined && cell?.byteLength !== undefined) {
        setLastEditedCell({
          rowKey: row.key,
          colIdx,
          columnName: table.columns[colIdx]?.name ?? '',
          kind: info.kind,
          rowNumber: rowIdx + 1,
          byteOffset: cell.byteOffset,
          byteLength: cell.byteLength,
        });
      }
    },
    [commitCellEdit, table.columns],
  );

  const handleRevertCell = useCallback(() => {
    const led = lastEditedCell;
    if (!led) return;
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== led.rowKey) return row;
        const cells = row.cells.slice();
        const cell = cells[led.colIdx];
        if (!cell) return row;
        cells[led.colIdx] = { ...cell, value: cell.originalValue };
        return { ...row, cells };
      }),
    );
  }, [lastEditedCell]);

  // ── Round-trip gate — Save · run gate / ＋ Stage (05-08 items 7-8, T-05-21) ────────────────
  //
  // Re-encodes the edited buffer, proves byte-exact re-serialization stability against the SAME
  // native functions the CORE-05 harness uses, and ONLY on success calls stagingStore.addEntry.
  // stagingStore.addEntry has exactly ONE call site in this file, inside the pass branch below —
  // the acceptance-criteria invariant this file must never violate.

  const handleSaveRunGate = useCallback(() => {
    setGateState('running');
    setGateFailInfo(null);
    setHexJumpActive(false);

    try {
      const editedNativeTable = {
        columns: table.columns.map((c) => ({ name: c.name, typeSpec: c.typeSpec })),
        rows: rows.map((row) => row.cells.map((c) => ({ type: c.type, value: c.value }))),
      };

      const firstPass = new Uint8Array(nativeCore.serializeDataTable(editedNativeTable));
      const reparsedIff = nativeCore.parseIff(firstPass);
      const reparsedTable = nativeCore.parseDataTable(reparsedIff, firstPass);
      const secondPass = new Uint8Array(
        nativeCore.serializeDataTable({
          columns: reparsedTable.columns,
          rows: reparsedTable.rows.map((r) => r.map((c) => ({ type: c.type, value: c.value }))),
        }),
      );

      const diff = diffFirstByte(firstPass, secondPass);
      if (diff) {
        setGateState('fail');
        setGateFailInfo({ ...diff, bytes: firstPass });
        setGateLastRun('just now');
        return;
      }

      // ── PASS: stage the newly-serialized bytes (mirrors TreVfsBrowser's Extract→Add
      //    temp-file-materialization pattern — the seal/pack pipeline reads replacementFilePath
      //    from disk, so an in-memory buffer must be written out before staging). ──────────────
      const tmpDir = path.join(os.tmpdir(), 'swg-toolkit-editor-stage');
      fs.mkdirSync(tmpDir, { recursive: true });
      const safeName = virtualPath.replace(/[\\/:*?"<>|]/g, '_');
      const tmpPath = path.join(tmpDir, `${Date.now()}-${safeName}`);
      const buf = Buffer.from(firstPass);
      fs.writeFileSync(tmpPath, buf);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

      useStagingStore.getState().addEntry({
        virtualPath,
        action: 'modify',
        replacementFilePath: tmpPath,
        sha256,
      });

      // Clear ALL modified marks (cell/row/tab) — the staged buffer becomes the new baseline.
      setRows((prev) =>
        prev.map((row) => ({
          ...row,
          isNew: false,
          cells: row.cells.map((c) => ({ ...c, originalValue: c.value })),
        })),
      );

      setGateState('pass');
      setGateBytes(firstPass.byteLength);
      setGateLastRun('just now');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setGateState('fail');
      setGateFailInfo({ offset: 0, expectedHex: '', actualHex: message, bytes: new Uint8Array(0) });
      setGateLastRun('just now');
    }
  }, [rows, table.columns, virtualPath]);

  const handleJumpToBytes = useCallback(() => {
    if (!gateFailInfo) return;
    setViewMode('hex');
    setHexJumpActive(true);
  }, [gateFailInfo]);

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

  // ── Hex view target (05-08 item 6) ───────────────────────────────────────────────

  const rowsSpan = useMemo(() => findRowsPayloadSpan(iffRoots, table.version), [iffRoots, table.version]);
  const rowsSpanBytes = useMemo<Uint8Array | null>(() => {
    if (!sourceBytes || !rowsSpan) return null;
    const u8 = sourceBytes instanceof Uint8Array ? sourceBytes : new Uint8Array(sourceBytes);
    if (rowsSpan.end > u8.length) return null;
    return u8.subarray(rowsSpan.start, rowsSpan.end);
  }, [sourceBytes, rowsSpan]);

  const hexTarget = useMemo<{
    bytes: Uint8Array | null;
    selectedRange: { start: number; end: number } | null;
    caption: string | null;
  }>(() => {
    if (hexJumpActive && gateFailInfo) {
      return {
        bytes: gateFailInfo.bytes,
        selectedRange: { start: gateFailInfo.offset, end: Math.min(gateFailInfo.offset + 8, gateFailInfo.bytes.length) },
        caption: `round-trip gate mismatch — bytes at DATA+0x${gateFailInfo.offset.toString(16).toUpperCase()}`,
      };
    }
    if (lastEditedCell && rowsSpanBytes) {
      return {
        bytes: rowsSpanBytes,
        selectedRange: { start: lastEditedCell.byteOffset, end: lastEditedCell.byteOffset + lastEditedCell.byteLength },
        caption: `highlighted: ${lastEditedCell.columnName} (${lastEditedCell.kind}) row ${lastEditedCell.rowNumber} — the cell you edit in Grid view is these bytes`,
      };
    }
    return { bytes: rowsSpanBytes, selectedRange: null, caption: null };
  }, [hexJumpActive, gateFailInfo, lastEditedCell, rowsSpanBytes]);

  // ── SchemaRail props (05-08 item 5) ──────────────────────────────────────────────

  const schemaRailColumns = useMemo(
    () => table.columns.map((c, i) => ({ name: c.name, kind: columnTypeSpecs[i]!.kind })),
    [table.columns, columnTypeSpecs],
  );

  const schemaRailSelectedRow = useMemo(() => {
    const row = rows.find((r) => r.key === selectedRowKey);
    if (!row) return null;
    return row.cells.map((cell, i) => ({
      name: table.columns[i]?.name ?? `col${i}`,
      value: cellDisplayText(columnTypeSpecs[i]!, cell),
      modified: isCellModified(row, cell),
    }));
  }, [rows, selectedRowKey, table.columns, columnTypeSpecs]);

  const schemaRailGateState: SchemaRailGateState = useMemo(
    () => ({
      lastRun: gateLastRun,
      result:
        gateState === 'pass'
          ? { kind: 'pass' }
          : gateState === 'fail' && gateFailInfo
            ? { kind: 'fail', offset: gateFailInfo.offset }
            : { kind: 'none' },
      bytes: gateBytes,
    }),
    [gateLastRun, gateState, gateFailInfo, gateBytes],
  );

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
          onClick={handleSaveRunGate}
          title="Runs the SAME gate-then-stage flow as Save · run gate"
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
          onClick={handleSaveRunGate}
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

      {/* ── Content row: (Grid | Hex) content + SchemaRail (item 5) ─────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {viewMode === 'hex' ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <HexInspector bytes={hexTarget.bytes} selectedRange={hexTarget.selectedRange} />
              </div>
              {hexTarget.caption && (
                <div
                  data-testid="hex-caption"
                  style={{
                    flexShrink: 0,
                    padding: 'var(--space-2) var(--space-4)',
                    borderTop: '1px solid var(--color-border)',
                    background: 'var(--color-header)',
                    color: 'var(--color-warn)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  {hexTarget.caption}
                </div>
              )}
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
                                  ? renderCellEditor(
                                      info,
                                      cell,
                                      (v) => handleCellCommit(row, colIdx, rowIdx, info, v),
                                      () => setEditingCell(null),
                                    )
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
        </div>

        {/* ── Schema rail (item 5) — 250px, always visible in both Grid and Hex modes ── */}
        <SchemaRail columns={schemaRailColumns} selectedRow={schemaRailSelectedRow} gateState={schemaRailGateState} />
      </div>

      {/* ── Fail banner (item 8) — above the gate bar, danger tint ─────────────────── */}
      {gateState === 'fail' && gateFailInfo && (
        <FailBanner
          message={`✗ Round-trip gate FAILED at DATA+0x${gateFailInfo.offset.toString(16).toUpperCase()} — expected ${gateFailInfo.expectedHex}, wrote ${gateFailInfo.actualHex}. Not staged.`}
          actions={[
            { label: 'Jump to bytes', onClick: handleJumpToBytes },
            { label: 'Revert cell', onClick: handleRevertCell, variant: 'danger' },
          ]}
        />
      )}

      {/* ── Gate bar footer (item 7) — wired to the real native round-trip (05-08) ──── */}
      <GateBar
        state={gateState}
        notRunLabel="round-trip gate: not run"
        runningLabel="round-trip gate: re-encoding DTII…"
        passLabel={`✓ byte-exact round-trip (${gateBytes ?? 0} B)`}
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
  const text = cellDisplayText(info, cell);

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
