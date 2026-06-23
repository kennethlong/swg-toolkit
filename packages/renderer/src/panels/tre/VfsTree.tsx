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
 * Source: 01-UI-SPEC.md § "Surface 1 — VFS path tree" + Shadow / override resolution;
 *         01-02-PLAN.md Task 2 acceptance criteria.
 *
 * Accessibility Rule 5: aria-label + title on all icon-only glyphs (⧉, ⊘).
 * Accessibility Rule 1: state never color alone — glyph + color + caption.
 */

import React, { useCallback, useState } from 'react';
import type { VfsEntry, ShadowChainDisplay } from '../../state/treStore.ts';
import type { MountedArchive } from '../../state/treStore.ts';
import ShadowChainDetail from './ShadowChainDetail.tsx';

interface VfsTreeProps {
  entries: VfsEntry[];
  archives: MountedArchive[];
  selectedPath: string | null;
  selectedChain: ShadowChainDisplay | null;
  onSelect: (entry: VfsEntry, chain: ShadowChainDisplay | null) => void;
}

export default function VfsTree({
  entries,
  archives,
  selectedPath,
  selectedChain,
  onSelect,
}: VfsTreeProps): React.ReactElement {
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

  return (
    <div
      role="listbox"
      aria-label="Virtual filesystem entries"
      style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
    >
      {entries.map((entry) => (
        <VfsRow
          key={entry.path}
          entry={entry}
          archives={archives}
          isSelected={entry.path === selectedPath}
          selectedChain={entry.path === selectedPath ? selectedChain : null}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function VfsRow({
  entry,
  archives,
  isSelected,
  selectedChain,
  onSelect,
}: {
  entry: VfsEntry;
  archives: MountedArchive[];
  isSelected: boolean;
  selectedChain: ShadowChainDisplay | null;
  onSelect: (entry: VfsEntry, chain: ShadowChainDisplay | null) => void;
}): React.ReactElement {
  const depth = entry.segments.length - 1;
  const indent = depth * 16; // 16px per nesting level per UI-SPEC

  // Find if this entry is in a v6000 archive
  const winnerArchive = archives.find((a) => a.path === entry.winnerArchivePath);
  const isEncrypted = winnerArchive?.isEnumerateOnly ?? false;

  // Build shadow chain for this entry
  const buildChain = useCallback((): ShadowChainDisplay | null => {
    if (entry.shadowCount === 0 && !entry.isTombstone) return null;
    // The chain detail is built from the VfsEntry info
    // For a full chain, we'd call resolveChain() natively — here we show the winner + count
    return null; // Full chain built by TreVfsBrowser via native resolveChain
  }, [entry]);

  const handleClick = () => {
    onSelect(entry, buildChain());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div>
      <div
        role="option"
        aria-selected={isSelected}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          paddingLeft: `calc(var(--space-4) + ${indent}px)`,
          paddingRight: 'var(--space-4)',
          paddingTop: 'var(--space-2)',
          paddingBottom: 'var(--space-2)',
          cursor: 'pointer',
          borderLeft: isSelected ? '2px solid var(--color-accent)' : '2px solid transparent',
          background: isSelected
            ? 'var(--color-accent-dim)'
            : 'transparent',
          transition: 'background 0.1s ease',
          outline: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-2)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
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
      </div>

      {/* Selected file detail area */}
      {isSelected && (
        <div
          style={{
            background: 'var(--color-surface-2)',
            borderLeft: '2px solid var(--color-accent)',
          }}
        >
          {isEncrypted ? (
            /* Encrypted v6000 entry: show not-extractable notice */
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
