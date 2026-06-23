/**
 * packages/renderer/src/panels/tre/VfsSearchField.tsx — VFS path/name search field.
 *
 * Full-width input with:
 *   - Mono placeholder "Search path or name…"
 *   - Glob toggle [*] (aria-label "Toggle glob matching")
 *   - Live "{n} matches" count (mono)
 *   - Debounce ~120ms before calling native search
 *
 * Source: 01-UI-SPEC.md § "Surface 1 — Search field" + § "Accessibility Contract".
 * Tokens: var(--color-widget), var(--text-xs) mono.
 * Copy: placeholder "Search path or name…", "{n} matches".
 */

import React, { useCallback, useRef, useState } from 'react';
import { useTreStore } from '../../state/treStore.ts';

interface VfsSearchFieldProps {
  /** Called with debounced query text and mode to trigger native search. */
  onSearch: (text: string, mode: 'substring' | 'glob') => void;
  /** Current match count to display. */
  matchCount: number;
}

export default function VfsSearchField({
  onSearch,
  matchCount,
}: VfsSearchFieldProps): React.ReactElement {
  const search = useTreStore((s) => s.search);
  const [localText, setLocalText] = useState(search.text);
  const [globMode, setGlobMode] = useState(search.mode === 'glob');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      setLocalText(text);

      // Debounce ~120ms per UI-SPEC
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch(text, globMode ? 'glob' : 'substring');
      }, 120);
    },
    [globMode, onSearch],
  );

  const handleGlobToggle = useCallback(() => {
    const newGlob = !globMode;
    setGlobMode(newGlob);
    onSearch(localText, newGlob ? 'glob' : 'substring');
  }, [globMode, localText, onSearch]);

  const handleClear = useCallback(() => {
    setLocalText('');
    onSearch('', globMode ? 'glob' : 'substring');
  }, [globMode, onSearch]);

  const hasText = localText.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: 'var(--space-2)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    >
      {/* Search input */}
      <input
        type="text"
        value={localText}
        onChange={handleTextChange}
        placeholder="Search path or name…"
        style={{
          flex: 1,
          background: 'var(--color-widget)',
          border: '1px solid var(--color-border-soft)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          padding: 'var(--space-1) var(--space-2)',
          outline: 'none',
          minWidth: 0,
        }}
        onFocus={(e) => { (e.target as HTMLInputElement).style.boxShadow = 'var(--focus-ring)'; }}
        onBlur={(e) => { (e.target as HTMLInputElement).style.boxShadow = 'none'; }}
      />

      {/* Clear button (only shown when there is text) */}
      {hasText && (
        <button
          aria-label="Clear search"
          title="Clear search"
          onClick={handleClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-faint)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}

      {/* Glob toggle [*] */}
      {/* Accessibility Rule 5: aria-label + title on icon-only control */}
      <button
        aria-label="Toggle glob matching"
        title="Toggle glob matching"
        onClick={handleGlobToggle}
        style={{
          background: globMode ? 'var(--color-accent-dim)' : 'transparent',
          border: globMode ? '1px solid var(--color-accent-line)' : '1px solid var(--color-border-soft)',
          borderRadius: 'var(--radius-sm)',
          color: globMode ? 'var(--color-accent)' : 'var(--color-text-faint)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          padding: '1px var(--space-1)',
          flexShrink: 0,
          lineHeight: 1.4,
        }}
      >
        [*]
      </button>

      {/* Match count */}
      {hasText && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-faint)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {matchCount} matches
        </span>
      )}
    </div>
  );
}
