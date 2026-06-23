/**
 * packages/renderer/src/panels/DataPanel.tsx
 * BOTTOM — Data pane with Structure | Hex | Datatable | Console | Log tabs.
 *
 * Phase 0 seed states: Console + Log + Datatable.
 * Phase 1 (Plan 01-03): added Structure tab (IFF tree) + Hex tab (byte inspector).
 *
 * Structure and Hex tabs are wired to the IFF store (useIffStore):
 *   - When a VFS file is selected (from TreVfsBrowser), IffStructureTree calls parseIff
 *     via Path B require('@swg/native-core') and populates the store.
 *   - HexInspector reads sourceBytes from the store + selected byte range.
 *
 * NO editable IFF fields, NO Save affordance (D-08).
 *
 * Accessibility Rule 5: aria-label + title on all icon-only controls.
 * Source: 01-UI-SPEC.md § "Surface 2 & 3"; 01-CONTEXT.md D-06/D-07/D-08.
 *
 * Path B addon access: require('@swg/native-core') in IffStructureTree.
 */

import React, { useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { useIffStore } from '../state/iffStore.ts';
import type { IffParseResult, SelectedIffNode } from '../state/iffStore.ts';
import type { IffNode } from '@swg/contracts';
import IffStructureTree from './iff/IffStructureTree.tsx';
import HexInspector from './iff/HexInspector.tsx';

// Path B: require the addon directly (nodeIntegration:true in the renderer).
// Used by the Structure tab to call parseIff when a VFS file is selected.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  parseIff: (bytes: ArrayBuffer | Uint8Array) => {
    roots: Array<IffNode & { children?: IffNode[] }>;
    trailingBytes: { offset: number; count: number } | null;
    roundTrip: { passed: boolean; failOffset?: number };
  };
  getChunkBytes: (result: unknown, srcBytes: ArrayBuffer | Uint8Array, nodeIndex: number) => ArrayBuffer;
};

type TabId = 'structure' | 'hex' | 'datatable' | 'console' | 'log';

// Phase 0 Console seed lines (timestamps are fixed for the seed state)
const consoleSeedLines = [
  { ts: '09:30:11', msg: 'native-core addon loaded in renderer process (Path B, pid —)' },
  { ts: '09:30:11', msg: 'cmake-js build: ok · node-addon-api 8 · electron 42 abi' },
  { ts: '09:30:11', msg: 'COOP/COEP set · crossOriginIsolated = true' },
  { ts: '09:30:11', msg: 'SharedArrayBuffer round-trip: PASS (4 bytes, in-process)' },
  { ts: '09:30:11', msg: 'contracts/ types compiled · renderer + backend in sync' },
];

export default function DataPanel(_props: IDockviewPanelProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>('structure');
  const [collapsed, setCollapsed] = useState(false);

  const iffStore = useIffStore();

  // When a VFS file is selected, parse it if it looks like IFF.
  // This is called by an event from VfsTree (see integration note below).
  // For now, DataPanel receives the file bytes via the iffStore from TreVfsBrowser.
  // The IffStructureTree itself also triggers parsing when mounted with bytes.

  // Build the HexInspector byte range from the selected node.
  const hexSelectedRange = iffStore.selectedNode
    ? { start: iffStore.selectedNode.byteStart, end: iffStore.selectedNode.byteEnd }
    : null;

  // Get the source bytes as Uint8Array for HexInspector.
  const hexBytes = iffStore.sourceBytes
    ? new Uint8Array(iffStore.sourceBytes)
    : null;

  // Derive parse status string for IffStructureTree.
  const parseStatusStr: 'idle' | 'parsing' | 'done' | 'error' = (() => {
    switch (iffStore.parseStatus.kind) {
      case 'idle':    return 'idle';
      case 'parsing': return 'parsing';
      case 'done':    return 'done';
      case 'error':   return 'error';
    }
  })();

  const parseErrorDetail =
    iffStore.parseStatus.kind === 'error'
      ? { reason: iffStore.parseStatus.reason, offset: iffStore.parseStatus.offset }
      : undefined;

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
      {/* Panel head: tabs + action buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 'var(--tabstrip-h)',
          background: 'var(--color-header)',
          borderBottom: '1px solid var(--color-border)',
          padding: '0 var(--space-2)',
          gap: 0,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: 'var(--color-text-faint)',
            cursor: 'grab',
            fontSize: 'var(--text-sm)',
            userSelect: 'none',
            width: 18,
            textAlign: 'center',
            marginRight: 'var(--space-2)',
          }}
        >
          ⠿
        </span>

        {/* Tabs */}
        {(['structure', 'hex', 'datatable', 'console', 'log'] as TabId[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? 'var(--color-surface)' : 'transparent',
              border: 'none',
              borderRight: '1px solid var(--color-border)',
              borderBottom: activeTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--color-text)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              padding: '0 var(--space-4)',
              height: 'var(--tabstrip-h)',
              transition: 'background 0.12s ease',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}

        {/* Add tab button */}
        <button
          aria-label="Add tab"
          title="Add tab"
          style={{
            background: 'transparent',
            border: 'none',
            borderRight: '1px solid var(--color-border)',
            color: 'var(--color-text-faint)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            padding: '0 var(--space-3)',
            height: 'var(--tabstrip-h)',
            transition: 'color 0.12s ease',
          }}
          onClick={() => { /* Phase 0: visual chrome */ }}
        >
          +
        </button>

        <div style={{ flex: 1 }} />

        {/* Collapse button */}
        {collapsed ? (
          <button
            aria-label="Expand panel"
            title="Expand panel"
            style={actionBtnStyle}
            onClick={() => setCollapsed(false)}
          >
            ▸
          </button>
        ) : (
          <button
            aria-label="Collapse panel"
            title="Collapse panel"
            style={actionBtnStyle}
            onClick={() => setCollapsed(true)}
          >
            ▾
          </button>
        )}
      </div>

      {/* Panel body */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Structure tab — IFF FORM/chunk tree (Surface 2) */}
          {activeTab === 'structure' && (
            <IffStructureTree
              parseResult={iffStore.parseResult}
              filename={iffStore.filename}
              parseStatus={parseStatusStr}
              parseError={parseErrorDetail}
              selectedNode={iffStore.selectedNode}
              onSelectNode={(node: SelectedIffNode | null) => {
                iffStore.selectNode(node);
                // Auto-switch to Hex tab when a node is selected.
                if (node) setActiveTab('hex');
              }}
            />
          )}

          {/* Hex tab — raw byte inspector (Surface 3) */}
          {activeTab === 'hex' && (
            <HexInspector
              bytes={hexBytes}
              selectedRange={hexSelectedRange}
              onHoverByte={iffStore.setHoveredByte}
              hoveredByteIndex={iffStore.hoveredByteIndex}
            />
          )}

          {/* Datatable tab — Phase 0 seed */}
          {activeTab === 'datatable' && (
            <div
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-faint)',
                padding: 'var(--space-3) var(--space-4)',
              }}
            >
              <div>[no datatable loaded]</div>
              <div>Mount an archive and open a .iff datatable</div>
            </div>
          )}

          {/* Console tab — Phase 0 seed */}
          {activeTab === 'console' && (
            <div
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                padding: 'var(--space-3) var(--space-4)',
                lineHeight: 1.7,
                overflow: 'auto',
              }}
            >
              {consoleSeedLines.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--color-text-faint)' }}>[{line.ts}]</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {highlightSuccessTokens(line.msg)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Log tab — Phase 0 seed */}
          {activeTab === 'log' && (
            <div
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                padding: 'var(--space-3) var(--space-4)',
                lineHeight: 1.7,
                overflow: 'auto',
              }}
            >
              [log]{'  '}contracts/ types compiled · renderer + backend in sync
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Highlight success tokens (ok, true, PASS, addon names) in --color-accent.
 */
function highlightSuccessTokens(text: string): React.ReactNode {
  const accentPattern = /\b(ok|true|PASS|native-core|in sync)\b/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = accentPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} style={{ color: 'var(--color-accent)' }}>
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

const actionBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-faint)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  padding: 0,
  transition: 'background 0.12s ease, color 0.12s ease',
};
