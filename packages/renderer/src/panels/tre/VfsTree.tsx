/**
 * packages/renderer/src/panels/tre/VfsTree.tsx — Shadow-resolved VFS path tree.
 *
 * Flat list view of resolved VFS entries with shadow/override indicators:
 *   - Per-file resolved-archive pip + short name (mono --text-xs)
 *   - Overriding files: accent pip + ⧉ glyph (aria-label "Overrides {n} lower archive(s)")
 *   - Tombstones: ⊘ glyph (aria-label "Deleted entry — hides lower archives")
 *   - Selected file from v6000 archive: "🔒 encrypted payload — not extractable" detail
 *   - 16px indent per path depth (inherited from Phase-0 tree-row style)
 *
 * Virtualized: only visible rows (+OVERSCAN) are in the DOM — mirrors HexInspector
 * pattern (ResizeObserver + scrollTop state + fixed ROW_HEIGHT + top/bottom spacers).
 * The selected-entry detail (ShadowChainDetail / encrypted notice) is rendered in a
 * fixed panel OUTSIDE the virtualized list so the list stays uniform-height.
 *
 * Source: 01-UI-SPEC.md § "Surface 1 — VFS path tree" + Shadow / override resolution;
 *         01-02-PLAN.md Task 2 acceptance criteria.
 *
 * Accessibility Rule 5: aria-label + title on all icon-only glyphs (⧉, ⊘).
 * Accessibility Rule 1: state never color alone — glyph + color + caption.
 */

import React, { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import type { VfsEntry, ShadowChainDisplay } from '../../state/treStore.ts';
import type { MountedArchive } from '../../state/treStore.ts';
import ShadowChainDetail from './ShadowChainDetail.tsx';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Fixed row height in pixels.
 *
 * Derived from VfsRow styling:
 *   paddingTop:    var(--space-2) = 6px
 *   paddingBottom: var(--space-2) = 6px
 *   font-size:     var(--text-sm) = 12px  ×  line-height ~1.5  ≈ 18px
 *   Total:         6 + 18 + 6 = 30px
 *
 * All non-selected rows are uniform height; the selected-row detail is rendered
 * OUTSIDE the list so the list stays uniform throughout.
 */
const ROW_HEIGHT = 30;

/** Rows to render above/below the visible area for smooth scroll — mirrors HexInspector. */
const OVERSCAN = 8;

// ─── Props ────────────────────────────────────────────────────────────────────

interface VfsTreeProps {
  entries: VfsEntry[];
  archives: MountedArchive[];
  selectedPath: string | null;
  selectedChain: ShadowChainDisplay | null;
  onSelect: (entry: VfsEntry, chain: ShadowChainDisplay | null) => void;
  /** Called when the user clicks "Extract to staging" on an entry row (plan 08). */
  onExtract?: (entry: VfsEntry) => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VfsTree({
  entries,
  archives,
  selectedPath,
  selectedChain,
  onSelect,
  onExtract,
}: VfsTreeProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);

  // Measure container height via ResizeObserver (mirrors HexInspector).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((resizeEntries) => {
      const h = resizeEntries[0]?.contentRect.height ?? 400;
      setViewHeight(h);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget as HTMLDivElement).scrollTop);
  }, []);

  // Build archive lookup map once per archives change — O(1) per-row lookup.
  const archiveMap = useMemo(() => {
    const map = new Map<string, MountedArchive>();
    for (const a of archives) {
      map.set(a.path, a);
    }
    return map;
  }, [archives]);

  // Derived windowing math (mirrors HexInspector exactly).
  const totalRows   = entries.length;
  const totalHeight = totalRows * ROW_HEIGHT;

  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT);
  const startRow     = Math.max(0, firstVisible - OVERSCAN);
  const endRow       = Math.min(totalRows - 1, firstVisible + visibleCount + OVERSCAN);

  const topPad    = startRow * ROW_HEIGHT;
  const bottomPad = Math.max(0, (totalRows - endRow - 1) * ROW_HEIGHT);

  // Collect the visible row indices (useMemo for referential stability).
  const visibleRows = useMemo(() => {
    const rows: number[] = [];
    for (let r = startRow; r <= endRow; r++) {
      rows.push(r);
    }
    return rows;
  }, [startRow, endRow]);

  // Find the selected entry (needed for the out-of-list detail panel).
  const selectedEntry = selectedPath != null
    ? entries.find((e) => e.path === selectedPath) ?? null
    : null;
  const selectedEntryIsEncrypted = selectedEntry != null
    ? (archiveMap.get(selectedEntry.winnerArchivePath)?.isEnumerateOnly ?? false)
    : false;

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (entries.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-sm)',
          textAlign: 'center',
          padding: 'var(--space-4)',
        }}
      >
        <span>No files match</span>
        <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
          Try a different search term
        </span>
      </div>
    );
  }

  // ── Virtualized list + fixed detail panel ────────────────────────────────────

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/*
       * Scrollable listbox — contains only the windowed rows.
       * The inner spacer has the full totalHeight so the scrollbar thumb
       * correctly represents the entire entry set (mirrors HexInspector).
       */}
      <div
        ref={containerRef}
        role="listbox"
        aria-label="Virtual filesystem entries"
        onScroll={handleScroll}
        style={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {/* Top padding spacer — pushes rendered rows to the correct scroll position */}
          <div style={{ height: topPad }} />

          {/* Only visible rows + overscan are in the DOM */}
          {visibleRows.map((rowIndex) => {
            const entry = entries[rowIndex];
            if (!entry) return null;
            const isSelected = entry.path === selectedPath;
            const winnerArchive = archiveMap.get(entry.winnerArchivePath);
            const isEncrypted   = winnerArchive?.isEnumerateOnly ?? false;
            return (
              <VfsRow
                key={entry.path}
                entry={entry}
                isSelected={isSelected}
                isEncrypted={isEncrypted}
                onSelect={onSelect}
                onExtract={onExtract}
              />
            );
          })}

          {/* Bottom padding spacer */}
          <div style={{ height: bottomPad }} />
        </div>
      </div>

      {/*
       * Selected-entry detail — rendered OUTSIDE the virtualized list.
       * This keeps the list rows uniform height (no variable-height inline expansion).
       * When the selected row scrolls out of view the detail stays visible in this
       * fixed area, which is consistent with a "details pane" UX anyway.
       */}
      {selectedEntry && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            borderTop: '1px solid var(--color-border)',
            borderLeft: '2px solid var(--color-accent)',
            flexShrink: 0,
          }}
        >
          {selectedEntryIsEncrypted ? (
            <div
              style={{
                padding: 'var(--space-2) var(--space-4)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-warn)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}
            >
              <span aria-label="Encrypted" role="img">🔒</span>
              <span>encrypted payload — not extractable</span>
            </div>
          ) : selectedChain ? (
            <ShadowChainDetail chain={selectedChain} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── VfsRow ───────────────────────────────────────────────────────────────────

/**
 * Single VFS entry row.
 *
 * Props are simplified vs. the old version: archive lookup is done ONCE in the parent
 * (via the Map built in VfsTree) and passed as `isEncrypted` rather than passing the
 * full `archives` array and doing archives.find() per row.
 *
 * The selected-row detail expansion has been moved to a fixed panel outside the list,
 * so VfsRow is always ROW_HEIGHT tall regardless of selection state.
 */
function VfsRow({
  entry,
  isSelected,
  isEncrypted: _isEncrypted,
  onSelect,
  onExtract,
}: {
  entry: VfsEntry;
  isSelected: boolean;
  /** Whether the winner archive is enumerate-only (v6000 encrypted). Used only by the
   *  parent's out-of-list detail panel; kept here so the signature is explicit. */
  isEncrypted: boolean;
  onSelect: (entry: VfsEntry, chain: ShadowChainDisplay | null) => void;
  /** Optional: called when the user triggers "Extract to staging" on this row. */
  onExtract?: (entry: VfsEntry) => void;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const depth  = entry.segments.length - 1;
  const indent = depth * 16; // 16px per nesting level per UI-SPEC

  const handleClick = () => {
    onSelect(entry, null); // chain is resolved natively in TreVfsBrowser.handleSelectEntry
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const handleExtractClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // prevent onSelect from firing
    if (onExtract) onExtract(entry);
  };

  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: ROW_HEIGHT,
        paddingLeft: `calc(var(--space-4) + ${indent}px)`,
        paddingRight: 'var(--space-2)',
        cursor: 'pointer',
        borderLeft: isSelected ? '2px solid var(--color-accent)' : '2px solid transparent',
        background: isSelected
          ? 'var(--color-accent-dim)'
          : hovered ? 'var(--color-surface-2)' : 'transparent',
        transition: 'background 0.1s ease',
        outline: 'none',
        boxSizing: 'border-box',
        position: 'relative',
      }}
      onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--focus-ring)'; }}
      onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
    >
      {/* Tombstone indicator */}
      {entry.isTombstone && (
        <span
          aria-label="Deleted entry — hides lower archives"
          title="Deleted entry — hides lower archives"
          style={{ color: 'var(--color-text-faint)', flexShrink: 0 }}
        >
          ⊘
        </span>
      )}

      {/* Filename */}
      <span
        style={{
          flex: 1,
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-sans)',
          color: entry.isTombstone ? 'var(--color-text-faint)' : 'var(--color-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={entry.path}
      >
        {entry.name}
      </span>

      {/* Override indicator */}
      {entry.isOverride && !entry.isTombstone && (
        <span
          aria-label={`Overrides ${entry.shadowCount} lower archive(s)`}
          title={`Overrides ${entry.shadowCount} lower archive(s)`}
          style={{
            color: 'var(--color-accent)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            flexShrink: 0,
          }}
        >
          ⧉
        </span>
      )}

      {/* Winning archive pip */}
      {!entry.isTombstone && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: entry.isOverride ? 'var(--color-accent)' : 'var(--color-text-faint)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 100,
            flexShrink: 0,
          }}
          title={entry.winnerArchivePath}
        >
          {entry.winnerArchiveFilename}
        </span>
      )}

      {/* Extract to staging — visible on hover when onExtract is provided (plan 08).
          Derives the virtual path directly from the VFS entry (no VirtualPathModal).
          Hidden when tombstone (nothing to extract). Keyboard-accessible (tabIndex). */}
      {onExtract && !entry.isTombstone && hovered && (
        <button
          aria-label={`Extract ${entry.name} to staging`}
          title="Extract to staging — adds this file to the patch staging list"
          onClick={handleExtractClick}
          tabIndex={0}
          style={{
            background:   'var(--color-accent)',
            border:       'none',
            borderRadius: 'var(--radius-sm)',
            color:        'var(--color-accent-text)',
            cursor:       'pointer',
            fontFamily:   'var(--font-sans)',
            fontSize:     'var(--text-xs)',
            fontWeight:   600,
            padding:      '1px 6px',
            flexShrink:   0,
            whiteSpace:   'nowrap',
            lineHeight:   '18px',
            outline:      'none',
          }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--focus-ring)'; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
        >
          Extract
        </button>
      )}
    </div>
  );
}
