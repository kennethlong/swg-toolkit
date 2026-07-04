/**
 * packages/renderer/src/panels/ConsolePanel.tsx
 * Bottom-pane Console tab — dockview panel component for the 'console' id.
 *
 * Part of the sketch 008 S8 bottom-pane trio: Datatable | Console | Log.
 * Live console mirror (D-12 "dev stream"): shows mirrored console.log/warn/error
 * output + window error/unhandledrejection events, level-color-coded, autoscroll
 * with pause-on-scroll-up (D-15), Clear, and click-row-to-copy.
 *
 * Console capture is installed at MODULE SCOPE below (not inside a useEffect) so it
 * starts at true app-boot time via the static import chain
 * (main.tsx -> App.tsx -> WorkspaceShell.tsx -> ConsolePanel.tsx), not only when the
 * user opens the Console tab (WorkspaceShell statically imports this file — verified,
 * not React.lazy — so this module executes once at bundle-evaluation time regardless
 * of dockview tab state). This is the fix for the "early boot errors are lost" finding
 * from the 4/4-reviewer round.
 *
 * Source: 04.4-02-PLAN.md Task 3 (round-2 revision).
 */

import React, { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';

import { useLogStore } from '../state/logStore';
import { installConsoleCapture } from '../services/logService';

// Install console capture at module scope — evaluated once, at boot, regardless of
// whether the Console tab is ever opened. Guarded so Vitest (which sets
// process.env.VITEST truthy) doesn't wrap console.* during unit test runs, avoiding
// cross-test console-spy interference.
if (typeof process === 'undefined' || !process.env['VITEST']) {
  installConsoleCapture();
}

const LEVEL_COLOR: Record<string, string> = {
  info:  'var(--color-text-muted)',
  warn:  'var(--color-warn)',
  error: 'var(--color-danger)',
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function ConsolePanel(_props: IDockviewPanelProps): React.ReactElement {
  const entries = useLogStore((s) => s.entries.filter((e) => e.channel === 'console'));
  const containerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !stickToBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [entries, stickToBottom]);

  function handleScroll(): void {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    setStickToBottom(atBottom);
  }

  function handleCopyLine(ts: number, message: string): void {
    void navigator.clipboard.writeText(`[${formatTs(ts)}] ${message}`);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-surface)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          type="button"
          onClick={() => useLogStore.getState().clear()}
          style={{
            background: 'transparent',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            fontSize: 'var(--text-xs)',
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          color: 'var(--color-text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          padding: 'var(--space-3) var(--space-4)',
          lineHeight: 1.7,
          overflow: 'auto',
        }}
      >
        {entries.map((entry, i) => (
          <div
            key={i}
            onClick={() => handleCopyLine(entry.ts, entry.message)}
            title="Click to copy"
            style={{ display: 'flex', gap: 8, cursor: 'pointer' }}
          >
            <span style={{ color: 'var(--color-text-faint)' }}>[{formatTs(entry.ts)}]</span>
            <span style={{ color: LEVEL_COLOR[entry.level] ?? 'var(--color-text-muted)' }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
