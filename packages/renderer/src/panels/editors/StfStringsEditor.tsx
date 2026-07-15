/**
 * packages/renderer/src/panels/editors/StfStringsEditor.tsx
 * `.stf` localized-strings editor — main-editor-group tab (05-UI-SPEC.md Surface 3 / sketch 018-A).
 *
 * Direct SIBLING of DatatableGridEditor.tsx (05-06/05-08): reuses the SAME shared GateBar/
 * FailBanner components, the SAME crumb-bar/toolbar/virtualized-grid idiom, and the SAME
 * serialize -> re-parse -> re-serialize -> byte-compare -> stage-or-fail-banner gate shape —
 * adjusted for `.stf`'s PARSER-NATIVE two-section (byId / nameToId) on-disk layout (D-11) and
 * its D-10 sourceCrc preserve-verbatim-by-default contract.
 *
 * Consumes 05-05's native parseStf() shape directly:
 *   { nextUniqueId, entries: [{id, sourceCrc, text}], nameMap: [{id, name}] }
 * (entries = byId on-disk order; nameMap = nameToId on-disk order — two INDEPENDENTLY-ordered
 * sections, D-11.)
 *
 * D-10 (must hold): default save preserves every entry's sourceCrc byte-identical. The ONLY
 * path that recomputes it is the explicit, per-row "↻ Mark re-synced to source" action, which
 * calls addon.recomputeSourceCrcFromText — the ONE call site for that function in this file.
 * `Save · run gate`'s own serialize path NEVER calls it (REVIEWS.md MEDIUM fix — every piece of
 * copy in this file, including the new-row placeholder and the gate-bar footer note, states this
 * preserve-vs-recompute distinction unambiguously; no string here reads as "recomputed
 * automatically on every save").
 *
 * Working-state model: each in-memory row carries BOTH its id (byId key) and its key/name
 * (nameToId key) together — this trivially keeps both on-disk orderings derivable at any time
 * (D-11's "keep both orderings intact" requirement) without tracking two parallel arrays: at
 * serialize time, buildStfResult() re-derives byId (sorted numeric ascending by id) and nameToId
 * (sorted lexicographic ascending by key) FRESH from the current row set — it never assumes the
 * display array's (alpha-by-key) order is already correct for either section.
 *
 * Virtualization mirrors VfsTree.tsx's ROW_HEIGHT/OVERSCAN/ResizeObserver scaffold verbatim
 * (same idiom DatatableGridEditor.tsx already follows) — real `.stf` files can have thousands of
 * entries (05-UI-SPEC.md Spacing Scale: "grids MUST be virtualized at scale").
 *
 * Round-trip gate comparator (diffFirstByte): ported inline from
 * packages/harness/assertRoundTrip.ts's byte-scan+hex-window diagnostic, mirroring
 * DatatableGridEditor.tsx's own sanctioned inline port (@swg/harness is not a declared
 * @swg/renderer dependency).
 *
 * Source: 05-UI-SPEC.md Surface 3 items 1-6; 05-05-SUMMARY.md (native return shape);
 *         05-08-PLAN.md Task 2 (gate-wiring shape this file mirrors);
 *         packages/renderer/src/state/stagingStore.ts (addEntry contract).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import GateBar from './shared/GateBar';
import FailBanner from './shared/FailBanner';
import { ghostButtonStyle, disabledGhostButtonStyle, primaryButtonStyle } from './shared/crumbButtonStyles';
import { useStagingStore } from '../../state/stagingStore';

// Path B: require the addon directly (nodeIntegration:true in the renderer) — same convention as
// DatatableGridEditor.tsx / TreVfsBrowser.tsx / StatusBar.tsx. Vite leaves a bare require()
// untouched so it resolves through Electron's real Node at runtime; vitest's module graph
// intercepts it via a monkey-patch of the process-cached addon object (established project
// precedent — vi.mock does NOT intercept a bare require() of a native addon).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  parseStf: (bytes: ArrayBuffer | Uint8Array) => StfParsedResult;
  serializeStf: (table: { nextUniqueId: number; entries: StfEntryIn[]; nameMap: StfNameEntryIn[] }) => ArrayBuffer;
  recomputeSourceCrcFromText: (text: string) => number;
};

// ─── Native contract (05-05, N-API binding wired by 05-09) ──────────────────────

export interface StfEntryIn {
  id: number;
  sourceCrc: number;
  text: string;
}

export interface StfNameEntryIn {
  id: number;
  name: string;
}

export interface StfParsedResult {
  nextUniqueId: number;
  /** byId on-disk order (05-05's parseStf `entries`). */
  entries: StfEntryIn[];
  /** nameToId on-disk order (05-05's parseStf `nameMap`). */
  nameMap: StfNameEntryIn[];
}

export interface StfStringsEditorParams {
  stfResult: StfParsedResult;
  virtualPath: string;
  /** Locale parsed from the path by the caller (e.g. `string/en/some_table.stf` -> `en`). */
  locale: string;
  /** Propagates the tab mod-dot up to the dockview tab title (mirrors 05-08's DTII wiring). */
  onModifiedChange?: (modified: boolean) => void;
}

// ─── nullCrc convention (client's own sentinel for "no source CRC yet") ─────────
// LocalizedString.cpp:73 — `return LocalizedString::nullCrc;` (0xFFFFFFFF). Assigned to a NEW
// row's sourceCrc ONLY at first save — never a recomputed hash of the row's own text (D-10).
const NULL_CRC = 0xffffffff;

// ─── Virtualization constants (VfsTree.tsx / DatatableGridEditor.tsx idiom) ─────

const ROW_HEIGHT = 28; // 6px+6px cell padding (UI-SPEC .stf density) + ~16px text line
const OVERSCAN = 8;

// ─── Working (in-memory edit-buffer) row model ──────────────────────────────────

interface WorkingEntry {
  /** Stable React key — independent of id/key so edits to either never remount the row. */
  rowKey: string;
  id: number;
  key: string; // the name (nameToId's name) — the UI's "key" column
  originalKey: string;
  text: string;
  originalText: string;
  /** undefined = unset (new row, no source CRC assigned yet — D-10). */
  sourceCrc: number | undefined;
  originalSourceCrc: number | undefined;
  isNew: boolean;
}

function buildInitialRows(stfResult: StfParsedResult): WorkingEntry[] {
  const nameById = new Map<number, string>();
  for (const n of stfResult.nameMap) nameById.set(n.id, n.name);
  return stfResult.entries.map((e) => {
    const name = nameById.get(e.id) ?? '';
    return {
      rowKey: `id-${e.id}`,
      id: e.id,
      key: name,
      originalKey: name,
      text: e.text,
      originalText: e.text,
      sourceCrc: e.sourceCrc,
      originalSourceCrc: e.sourceCrc,
      isNew: false,
    };
  });
}

function isRowModified(row: WorkingEntry): boolean {
  return (
    row.isNew ||
    row.key !== row.originalKey ||
    row.text !== row.originalText ||
    row.sourceCrc !== row.originalSourceCrc
  );
}

/** Read-only display text for the crc32 column — REVIEWS.md-corrected copy (D-10/Errata 4). */
function crcDisplayText(sourceCrc: number | undefined): string {
  if (sourceCrc === undefined) return 'unset · assigned on first save';
  return `0x${(sourceCrc >>> 0).toString(16).padStart(8, '0')}`;
}

// ─── Serialize helper — re-derives BOTH on-disk orderings fresh (D-11) ───────────

function buildStfResult(
  rows: WorkingEntry[],
  nextUniqueId: number,
): { nextUniqueId: number; entries: StfEntryIn[]; nameMap: StfNameEntryIn[] } {
  const entries = rows
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((r) => ({ id: r.id, sourceCrc: r.sourceCrc ?? NULL_CRC, text: r.text }));
  const nameMap = rows
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((r) => ({ id: r.id, name: r.key }));
  return { nextUniqueId, entries, nameMap };
}

// ─── Round-trip byte-diff (ported inline from packages/harness/assertRoundTrip.ts — mirrors
//      DatatableGridEditor.tsx's own sanctioned inline port; @swg/harness is not a declared
//      @swg/renderer dependency) ─────────────────────────────────────────────────────────────

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

// ─── Main component ──────────────────────────────────────────────────────────────

export default function StfStringsEditor({
  params,
  api,
}: IDockviewPanelProps<StfStringsEditorParams>): React.ReactElement {
  const { stfResult, virtualPath, locale, onModifiedChange } = params;

  const [rows, setRows] = useState<WorkingEntry[]>(() => buildInitialRows(stfResult));
  const nextUniqueIdRef = useRef<number>(stfResult.nextUniqueId);
  const newRowCounterRef = useRef(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingTextRowKey, setEditingTextRowKey] = useState<string | null>(null);
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null);

  // ── Round-trip gate machine (mirrors DatatableGridEditor.tsx items 7-8, T-05-23) ─────────

  const [gateState, setGateState] = useState<'not-run' | 'running' | 'pass' | 'fail'>('not-run');
  const [gateFailInfo, setGateFailInfo] = useState<(ByteDiff & { bytes: Uint8Array }) | null>(null);

  // ── Modified tracking / tab mod-dot propagation ─────────────────────────────────

  const anyModified = useMemo(() => rows.some(isRowModified), [rows]);
  const modifiedCount = useMemo(() => rows.filter(isRowModified).length, [rows]);

  useEffect(() => {
    onModifiedChange?.(anyModified);
    // Dockview tab modified-dot — mirrors DatatableGridEditor.tsx's api.setTitle precedent.
    // try/catch guards test environments that pass a stub `api` (e.g. `api={{} as never}`).
    try {
      const fileName = virtualPath.split('/').pop() ?? virtualPath;
      api?.setTitle(`${fileName} — Strings${anyModified ? ' ●' : ''}`);
    } catch {
      /* api unavailable in some test envs */
    }
  }, [anyModified, onModifiedChange, api, virtualPath]);

  // ── Search filter (by key OR text, case-insensitive) + alpha-by-key display order (D-11) ──

  const displayRows = useMemo(() => {
    const sorted = rows.slice().sort((a, b) => a.key.localeCompare(b.key));
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (r) => r.key.toLowerCase().includes(q) || r.text.toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  // ── Add / edit handlers ──────────────────────────────────────────────────────────

  const handleAddKey = useCallback(() => {
    const id = nextUniqueIdRef.current;
    nextUniqueIdRef.current += 1;
    newRowCounterRef.current += 1;
    setRows((prev) => [
      ...prev,
      {
        rowKey: `new-${id}-${newRowCounterRef.current}`,
        id,
        key: '',
        originalKey: '',
        text: '',
        originalText: '',
        sourceCrc: undefined,
        originalSourceCrc: undefined,
        isNew: true,
      },
    ]);
  }, []);

  const handleKeyChange = useCallback((rowKey: string, newKey: string) => {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, key: newKey } : r)));
  }, []);

  const commitTextEdit = useCallback((rowKey: string, newText: string) => {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, text: newText } : r)));
    setEditingTextRowKey(null);
  }, []);

  // ── Per-row "↻ Mark re-synced to source" action (D-10 — the ONLY call site for
  //    recomputeSourceCrcFromText in this file; never called by the Save · run gate path) ────

  const handleResync = useCallback((rowKey: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowKey !== rowKey) return r;
        const newCrc = nativeCore.recomputeSourceCrcFromText(r.text);
        return { ...r, sourceCrc: newCrc };
      }),
    );
  }, []);

  // ── Round-trip gate — Save · run gate / ＋ Stage (mirrors DatatableGridEditor.tsx items 7-8,
  //    T-05-23) — sourceCrc in the serialized output is EXACTLY the in-memory value at save
  //    time (original parsed value, or the value set by handleResync above) — never computed
  //    inline here. ──────────────────────────────────────────────────────────────────────────

  const handleSaveRunGate = useCallback(() => {
    setGateState('running');
    setGateFailInfo(null);

    try {
      const built = buildStfResult(rows, nextUniqueIdRef.current);
      const firstPass = new Uint8Array(nativeCore.serializeStf(built));
      const reparsed = nativeCore.parseStf(firstPass);
      const secondPass = new Uint8Array(
        nativeCore.serializeStf({
          nextUniqueId: reparsed.nextUniqueId,
          entries: reparsed.entries,
          nameMap: reparsed.nameMap,
        }),
      );

      const diff = diffFirstByte(firstPass, secondPass);
      if (diff) {
        setGateState('fail');
        setGateFailInfo({ ...diff, bytes: firstPass });
        return;
      }

      // ── PASS: stage the newly-serialized bytes (mirrors DatatableGridEditor.tsx's
      //    materialize-to-temp-file pattern — the seal/pack pipeline reads
      //    replacementFilePath from disk). ─────────────────────────────────────────────
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

      // Clear ALL modified marks — the staged buffer becomes the new baseline. Rows that were
      // NEW get their assigned sourceCrc (NULL_CRC, D-10) baked in as the new original value —
      // never a recomputed hash.
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          isNew: false,
          originalKey: r.key,
          originalText: r.text,
          sourceCrc: r.sourceCrc ?? NULL_CRC,
          originalSourceCrc: r.sourceCrc ?? NULL_CRC,
        })),
      );

      setGateState('pass');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setGateState('fail');
      setGateFailInfo({ offset: 0, expectedHex: '', actualHex: message, bytes: new Uint8Array(0) });
    }
  }, [rows, virtualPath]);

  // ── Virtualization (VfsTree.tsx / DatatableGridEditor.tsx scaffold, verbatim math) ────────

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

  const totalRows = displayRows.length;
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

  // ── Crumb text ────────────────────────────────────────────────────────────────

  const fileName = virtualPath.split('/').pop() ?? virtualPath;
  const crumbText = `string/${locale}/${fileName} · STF · ${rows.length} entries (${displayRows.length} shown)`;

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
        <span data-testid="stf-crumb" style={{ fontWeight: 600 }}>
          {crumbText}
        </span>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          disabled
          title="Compare to base view (sketch 015) is not yet designed"
          style={disabledGhostButtonStyle}
        >
          ⇄ Compare to base
        </button>
        <button
          type="button"
          onClick={handleSaveRunGate}
          title="Runs the SAME gate-then-stage flow as Save · run gate"
          style={ghostButtonStyle}
        >
          ＋ Stage
        </button>
        <button type="button" onClick={handleSaveRunGate} style={primaryButtonStyle}>
          Save · run gate
        </button>
      </div>

      {/* ── Toolbar (item 3) ─────────────────────────────────────────────────────── */}
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
          placeholder="Search keys and text…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            background: 'var(--color-widget)',
            border: '1px solid var(--color-border-soft)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text)',
            padding: '2px 8px',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            width: 220,
          }}
        />
        <button type="button" onClick={handleAddKey} title="Add a new key (in-memory only)" style={ghostButtonStyle}>
          ＋ Add key
        </button>
        <div style={{ flex: 1 }} />
        <span
          data-testid="key-count-chip"
          style={{ color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
        >
          {displayRows.length} / {rows.length} keys
          {modifiedCount > 0 ? ` · ${modifiedCount} modified` : ''}
        </span>
      </div>

      {/* ── The grid (item 4) ────────────────────────────────────────────────────── */}
      {displayRows.length === 0 && searchQuery.trim() ? (
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
          No keys match "{searchQuery.trim()}"
        </div>
      ) : (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          role="grid"
          aria-label="Localized string entries"
          style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '220px 140px 1fr', width: '100%' }}>
            {/* Sticky header row */}
            <div style={headerCellStyle}>key</div>
            <div style={headerCellStyle} title="Preserved on save. Use ↻ per row to re-sync from source text.">
              crc32
            </div>
            <div style={headerCellStyle}>localized text ({locale})</div>

            <div style={{ gridColumn: '1 / span 3', height: topPad }} />

            {visibleRowIndices.map((rowIdx) => {
              const row = displayRows[rowIdx];
              if (!row) return null;
              const modified = isRowModified(row);
              const isEditingText = editingTextRowKey === row.rowKey;
              const isHovered = hoveredRowKey === row.rowKey;
              return (
                <React.Fragment key={row.rowKey}>
                  {/* key column */}
                  <div
                    style={{
                      ...cellStyle,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.isNew ? (
                      <input
                        type="text"
                        aria-label="New key name"
                        placeholder="key"
                        value={row.key}
                        onChange={(e) => handleKeyChange(row.rowKey, e.target.value)}
                        style={{
                          width: '100%',
                          background: 'var(--color-widget)',
                          border: '1px solid var(--color-accent-line)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text)',
                          padding: '1px 4px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-sm)',
                        }}
                      />
                    ) : (
                      <>
                        {row.key}
                        {modified && <span style={{ color: 'var(--color-warn)' }}> ●</span>}
                      </>
                    )}
                  </div>

                  {/* crc32 column — ALWAYS read-only, never an <input> (acceptance criterion) */}
                  <div
                    data-testid="crc32-cell"
                    onMouseEnter={() => setHoveredRowKey(row.rowKey)}
                    onMouseLeave={() => setHoveredRowKey((k) => (k === row.rowKey ? null : k))}
                    style={{
                      ...cellStyle,
                      color: 'var(--color-text-faint)',
                      fontSize: 'var(--text-xs)',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{crcDisplayText(row.sourceCrc)}</span>
                    {isHovered && (
                      <button
                        type="button"
                        onClick={() => handleResync(row.rowKey)}
                        title="Mark re-synced to source — recomputes sourceCrc from this file's current text"
                        aria-label={`Mark ${row.key || 'this row'} re-synced to source`}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--color-border-soft)',
                          color: 'var(--color-text-muted)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0 3px',
                          cursor: 'pointer',
                          fontSize: 'var(--text-xs)',
                          lineHeight: '14px',
                          flexShrink: 0,
                        }}
                      >
                        ↻
                      </button>
                    )}
                  </div>

                  {/* localized text column */}
                  <div
                    onDoubleClick={() => setEditingTextRowKey(row.rowKey)}
                    style={{
                      ...cellStyle,
                      cursor: 'text',
                      background: modified && !isEditingText ? 'rgba(230,180,80,0.07)' : 'transparent',
                      borderLeft: modified && !isEditingText ? '3px inset var(--color-warn)' : '3px solid transparent',
                    }}
                  >
                    {isEditingText ? (
                      <TextCellEditor
                        initialValue={row.text}
                        onCommit={(v) => commitTextEdit(row.rowKey, v)}
                        onCancel={() => setEditingTextRowKey(null)}
                      />
                    ) : (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.text}
                        {modified && <span style={{ color: 'var(--color-warn)' }}> ●</span>}
                      </span>
                    )}
                  </div>
                </React.Fragment>
              );
            })}

            <div style={{ gridColumn: '1 / span 3', height: bottomPad }} />
          </div>
        </div>
      )}

      {/* ── Fail banner (item 6) — above the gate bar, danger tint ─────────────────── */}
      {gateState === 'fail' && gateFailInfo && (
        <FailBanner
          message={`✗ Round-trip gate FAILED at offset 0x${gateFailInfo.offset.toString(16).toUpperCase()} — expected ${gateFailInfo.expectedHex}, wrote ${gateFailInfo.actualHex}. Not staged.`}
          actions={[{ label: 'Dismiss', onClick: () => setGateState('not-run') }]}
        />
      )}

      {/* ── Gate bar footer (item 5) ─────────────────────────────────────────────── */}
      <GateBar
        state={gateState}
        notRunLabel="round-trip gate: not run"
        runningLabel="gate: rebuilding index + payload…"
        passLabel="✓ byte-exact round-trip · CRC index rebuilt"
        failLabel="✗ round-trip mismatch — not staged"
        note="values are UTF-16LE · keys ASCII · sourceCrc preserved on save"
      />
    </div>
  );
}

// ─── Shared cell styles ───────────────────────────────────────────────────────────

const headerCellStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  background: 'var(--color-header)',
  borderBottom: '1px solid var(--color-border)',
  borderRight: '1px solid var(--color-border)',
  padding: '6px 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
};

const cellStyle: React.CSSProperties = {
  height: ROW_HEIGHT,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  padding: '6px 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  borderBottom: '1px solid var(--color-border)',
  borderRight: '1px solid var(--color-border)',
  overflow: 'hidden',
};

// ─── Text cell editor — double-click to edit, Enter commits, Escape cancels ────────────────

function TextCellEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  let current = initialValue;
  return (
    <input
      autoFocus
      type="text"
      defaultValue={initialValue}
      aria-label="Localized text"
      onChange={(e) => {
        current = e.target.value;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(current);
        else if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => onCommit(current)}
      style={{
        width: '100%',
        background: 'var(--color-widget)',
        border: '1px solid var(--color-accent-line)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text)',
        padding: '1px 4px',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
      }}
    />
  );
}
