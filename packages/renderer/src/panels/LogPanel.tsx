/**
 * packages/renderer/src/panels/LogPanel.tsx
 * Bottom-pane Log tab — dockview panel component for the 'log' id.
 *
 * Part of the sketch 008 S8 bottom-pane trio: Datatable | Console | Log.
 * Live structured app-event log (D-12 "structured app events"): mounts, deploys,
 * reconciles, injections, restores — emitted via logService.log(). Level-color-coded,
 * autoscroll with pause-on-scroll-up (D-15), Clear, click-row-to-copy.
 *
 * Reads the SAME shared logStore as ConsolePanel.tsx (filtered to channel:'log') — a
 * single source of truth, so Clear from either panel empties both. This panel does
 * NOT call installConsoleCapture() itself; ConsolePanel.tsx owns that single module-
 * scope call site.
 *
 * Source: 04.4-02-PLAN.md Task 3 (round-2 revision).
 */

import React, { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';

import { useLogStore } from '../state/logStore';

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

export default function LogPanel(_props: IDockviewPanelProps): React.ReactElement {
  const entries = useLogStore((s) => s.entries.filter((e) => e.channel === 'log'));
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
          color: 'var(--color-text-muted)',
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
