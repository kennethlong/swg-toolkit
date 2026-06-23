/**
 * packages/renderer/src/panels/iff/HexInspector.tsx — Virtualized hex/ASCII inspector.
 *
 * Surface 3: offset │ hex │ ascii byte grid for the selected IFF chunk / file.
 *
 * Grid contract (01-UI-SPEC.md § "Surface 3"):
 *   - Three regions per row, all mono --text-xs, row height 18px (= --space-6)
 *   - Offset gutter: 8-hex-digit absolute offset, right-aligned, --color-text-faint
 *   - Hex columns: 16 bytes/row grouped 8+8 with wider midpoint gap; even/odd shade
 *   - ASCII gutter: 16 chars; non-printable rendered as · in --color-text-faint
 *   - Selected-range highlight: --color-accent-dim across hex + ascii
 *   - Hover cross-highlight: hovering hex byte highlights paired ascii char + vice-versa
 *   - Sticky ruler: "00 01 02 … 0F" on --color-header
 *   - Virtualized: only visible rows in the DOM (T-01-14 — large chunks must scroll smoothly)
 *
 * Read-only (D-08): no editable hex cells, no patch/save affordance.
 *
 * Source:
 *   01-UI-SPEC.md § "Surface 3 — Hex / ASCII Inspector Pane"
 *   01-CONTEXT.md D-07 (SIE-successor baseline), D-08 (read-only)
 *
 * Accessibility Rule 1: selected range: --color-accent-dim + the originating IFF node row
 *   also shows as selected in the tree (paired cross-highlight).
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const BYTES_PER_ROW = 16;
/** Row height per UI-SPEC: 18px (= --space-6). Exception to the 3px grid. */
const ROW_HEIGHT = 18;
/** How many rows to render above/below the visible area for smooth scroll. */
const OVERSCAN = 5;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HexInspectorProps {
  /** Raw bytes to display. Pass null for the empty state. */
  bytes: Uint8Array | null;
  /** Selected byte range [start, end) — highlights in --color-accent-dim. */
  selectedRange: { start: number; end: number } | null;
  /** Called when the user hovers a byte (for cross-highlight). */
  onHoverByte?: (index: number | null) => void;
  /** Currently hovered byte index (driven by the store). */
  hoveredByteIndex?: number | null;
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState(): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
        textAlign: 'center',
      }}
    >
      {/* UI-SPEC Copywriting Contract — exact strings */}
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
        }}
      >
        No bytes to inspect
      </span>
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
        }}
      >
        Select an IFF chunk or file
      </span>
    </div>
  );
}

// ─── Ruler (sticky header row) ────────────────────────────────────────────────

function HexRuler(): React.ReactElement {
  const cols = Array.from({ length: BYTES_PER_ROW }, (_, i) =>
    i.toString(16).toUpperCase().padStart(2, '0'),
  );

  return (
    <div
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        height: ROW_HEIGHT,
        background: 'var(--color-header)',
        borderBottom: '1px solid var(--color-border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 1,
        userSelect: 'none',
      }}
    >
      {/* Offset gutter placeholder */}
      <span
        style={{
          width: 80,
          flexShrink: 0,
          textAlign: 'right',
          paddingRight: 'var(--space-2)',
          color: 'transparent',
        }}
      >
        00000000
      </span>
      <span style={{ width: 8, flexShrink: 0 }} /> {/* separator */}

      {/* Hex column headers: 8 + gap + 8 */}
      {cols.slice(0, 8).map((c) => (
        <span key={c} style={{ width: 22, textAlign: 'center', flexShrink: 0 }}>
          {c}
        </span>
      ))}
      <span style={{ width: 8, flexShrink: 0 }} /> {/* midpoint gap */}
      {cols.slice(8).map((c) => (
        <span key={c + '8'} style={{ width: 22, textAlign: 'center', flexShrink: 0 }}>
          {c}
        </span>
      ))}

      <span style={{ width: 12, flexShrink: 0 }} /> {/* ascii separator */}
      {/* ASCII header is blank */}
      <span style={{ flex: 1 }} />
    </div>
  );
}

// ─── One hex row ──────────────────────────────────────────────────────────────

interface HexRowProps {
  rowIndex: number;
  bytes: Uint8Array;
  selectedRange: { start: number; end: number } | null;
  hoveredByteIndex: number | null;
  onHoverByte: (index: number | null) => void;
}

const HexRow = React.memo(function HexRow({
  rowIndex,
  bytes,
  selectedRange,
  hoveredByteIndex,
  onHoverByte,
}: HexRowProps): React.ReactElement {
  const startByte = rowIndex * BYTES_PER_ROW;
  const endByte   = Math.min(startByte + BYTES_PER_ROW, bytes.length);
  const count     = endByte - startByte;

  const hexOffset = `0x${startByte.toString(16).toUpperCase().padStart(8, '0')}`;

  function isSelected(byteIdx: number): boolean {
    if (!selectedRange) return false;
    return byteIdx >= selectedRange.start && byteIdx < selectedRange.end;
  }

  function isHovered(byteIdx: number): boolean {
    return hoveredByteIndex === byteIdx;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: ROW_HEIGHT,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        lineHeight: '1',
        background:
          rowIndex % 2 === 0
            ? 'var(--color-surface)'
            : 'var(--color-surface-2)',
        userSelect: 'none',
      }}
    >
      {/* Offset gutter */}
      <span
        style={{
          width: 80,
          flexShrink: 0,
          textAlign: 'right',
          paddingRight: 'var(--space-2)',
          color: 'var(--color-text-faint)',
          background: 'var(--color-header)',
        }}
      >
        {hexOffset}
      </span>
      <span style={{ width: 8, flexShrink: 0 }} />

      {/* Hex bytes: 8 + gap + 8 */}
      {Array.from({ length: BYTES_PER_ROW }, (_, i) => {
        const byteIdx = startByte + i;
        const isPresent = i < count;
        const sel = isPresent && isSelected(byteIdx);
        const hov = isPresent && isHovered(byteIdx);

        return (
          <React.Fragment key={i}>
            {i === 8 && <span style={{ width: 8, flexShrink: 0 }} />}
            <span
              onMouseEnter={isPresent ? () => onHoverByte(byteIdx) : undefined}
              onMouseLeave={isPresent ? () => onHoverByte(null) : undefined}
              style={{
                width: 22,
                textAlign: 'center',
                flexShrink: 0,
                color: isPresent ? 'var(--color-text)' : 'transparent',
                // Selection = accent-dim fill only. Hover = same fill PLUS an accent
                // outline. The translucent cyan fill (accent-dim) is visible on BOTH
                // even/odd row shades — unlike the old opaque --color-surface-2 tint
                // (which matched the odd-row bg) and unlike a bare outline (too thin to
                // read on the 10px-wide ASCII cells). Hover's outline keeps it distinct
                // from a plain selection.
                background: sel || hov ? 'var(--color-accent-dim)' : undefined,
                boxShadow: hov ? 'inset 0 0 0 1px var(--color-accent)' : undefined,
                transition: 'background 0.1s ease, box-shadow 0.1s ease',
                cursor: 'default',
              }}
            >
              {isPresent
                ? bytes[byteIdx].toString(16).toUpperCase().padStart(2, '0')
                : '  '}
            </span>
          </React.Fragment>
        );
      })}

      <span style={{ width: 12, flexShrink: 0 }} />

      {/* ASCII gutter */}
      {Array.from({ length: BYTES_PER_ROW }, (_, i) => {
        const byteIdx = startByte + i;
        const isPresent = i < count;
        const b = isPresent ? bytes[byteIdx] : 0;
        const isPrintable = b >= 0x20 && b <= 0x7E;
        const sel = isPresent && isSelected(byteIdx);
        const hov = isPresent && isHovered(byteIdx);

        return (
          <span
            key={i}
            onMouseEnter={isPresent ? () => onHoverByte(byteIdx) : undefined}
            onMouseLeave={isPresent ? () => onHoverByte(null) : undefined}
            style={{
              width: 10,
              textAlign: 'center',
              flexShrink: 0,
              color: isPresent
                ? isPrintable
                  ? 'var(--color-text)'
                  : 'var(--color-text-faint)'
                : 'transparent',
              // Mirror of the hex cell: accent-dim fill for selection, fill + accent
              // outline for hover. The translucent fill is what makes the cross-highlight
              // readable on these narrow 10px ASCII cells (a bare outline was too thin).
              background: sel || hov ? 'var(--color-accent-dim)' : undefined,
              boxShadow: hov ? 'inset 0 0 0 1px var(--color-accent)' : undefined,
              transition: 'background 0.1s ease, box-shadow 0.1s ease',
              cursor: 'default',
            }}
          >
            {isPresent ? (isPrintable ? String.fromCharCode(b) : '·') : ' '}
          </span>
        );
      })}
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function HexInspector({
  bytes,
  selectedRange,
  onHoverByte,
  hoveredByteIndex = null,
}: HexInspectorProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop]   = useState(0);
  const [viewHeight, setViewHeight] = useState(400);

  // Measure container height via ResizeObserver.
  React.useEffect(() => {
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

  const handleHoverByte = useCallback(
    (index: number | null) => {
      onHoverByte?.(index);
    },
    [onHoverByte],
  );

  // Row math — computed unconditionally (handles null bytes) so the useMemo below
  // is never skipped by an early return. Hoisting these above the empty-state guard
  // keeps the hook count stable when `bytes` toggles null <-> non-null (Rules of Hooks).
  const byteLength    = bytes?.length ?? 0;
  const totalRows     = Math.ceil(byteLength / BYTES_PER_ROW);
  const totalHeight   = totalRows * ROW_HEIGHT;

  // Visible rows + overscan
  const firstVisible  = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount  = Math.ceil(viewHeight / ROW_HEIGHT);
  const startRow      = Math.max(0, firstVisible - OVERSCAN);
  const endRow        = Math.min(totalRows - 1, firstVisible + visibleCount + OVERSCAN);

  const topPad    = startRow * ROW_HEIGHT;
  const bottomPad = Math.max(0, (totalRows - endRow - 1) * ROW_HEIGHT);

  const visibleRows = useMemo(() => {
    const rows = [];
    for (let r = startRow; r <= endRow; r++) {
      rows.push(r);
    }
    return rows;
  }, [startRow, endRow]);

  if (!bytes || bytes.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        <EmptyState />
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--color-surface)',
      }}
    >
      {/* Sticky ruler */}
      <HexRuler />

      {/* Scrollable grid body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
          position: 'relative',
        }}
      >
        {/* Total height spacer */}
        <div style={{ height: totalHeight, position: 'relative' }}>
          {/* Top padding spacer */}
          <div style={{ height: topPad }} />

          {/* Visible rows */}
          {visibleRows.map((rowIndex) => (
            <HexRow
              key={rowIndex}
              rowIndex={rowIndex}
              bytes={bytes}
              selectedRange={selectedRange}
              hoveredByteIndex={hoveredByteIndex}
              onHoverByte={handleHoverByte}
            />
          ))}

          {/* Bottom padding spacer */}
          <div style={{ height: bottomPad }} />
        </div>
      </div>
    </div>
  );
}
