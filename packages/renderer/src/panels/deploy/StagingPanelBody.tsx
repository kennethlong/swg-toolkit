/**
 * packages/renderer/src/panels/deploy/StagingPanelBody.tsx
 * Extracted staging body — Phase 04.1 DEPLOY-05/07.
 *
 * Moved from StagingPanel.tsx:186-454 (inner StagingPanelBody function) to its
 * own file as a default export. Consumed by DeployPanel (plan 03) which owns the
 * outer panel wrapper.
 *
 * Key differences from the original inner function:
 *   - DEFAULT export (was inner function in StagingPanel.tsx)
 *   - Panel-head title "Staging" DROPPED — DeployPanel owns the section header
 *   - Add… + Save version controls KEPT (moved to head without the title)
 *   - isVirtualPathSafe imported from pathSafety.ts (M1 — do NOT inline a second copy)
 *   - Dead handlePackPatch removed
 *   - primaryBtnStyle/secondaryBtnStyle defined locally (W1 fix)
 *
 * Virtualization (mandatory — match VfsTree, HexInspector):
 *   ROW_HEIGHT = 30   OVERSCAN = 8   (never change)
 *
 * A11y: role="listbox" + role="option" preserved.
 *
 * Source: 04.1-03-PLAN.md Task 2; StagingPanel.tsx:186-454; 04.1-PATTERNS.md §StagingPanelBody.tsx.
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import ActionBadge from './ActionBadge';

import { useChangesetStore } from '../../state/changesetStore';
import { useStagingStore }   from '../../state/stagingStore';

import { sealVersion } from '../../services/changesetService';
import { isVirtualPathSafe } from '../../services/pathSafety';

import type { StagingEntry, TypedIpcRenderer } from '@swg/contracts';

// ─── Virtualization constants (mandatory — match VfsTree, HexInspector) ────────

/** Fixed row height in pixels — same as VfsTree. NEVER change. */
const ROW_HEIGHT = 30;

/** Rows above/below the visible area to keep rendered for smooth scroll. */
const OVERSCAN = 8;

// ─── Button styles (W1 fix — LOCAL const functions, NOT shared via ExportDialog) ──────────

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background:   disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    border:       'none',
    color:        disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    borderRadius: 'var(--radius-sm)',
    padding:      '4px 12px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontSize:     'var(--text-sm)',
    fontWeight:   600,
    opacity:      disabled ? 0.6 : 1,
    transition:   'opacity 0.1s ease',
    flexShrink:   0,
  };
}

const secondaryBtnStyle: React.CSSProperties = {
  background:   'transparent',
  border:       '1px solid var(--color-border)',
  color:        'var(--color-text-muted)',
  borderRadius: 'var(--radius-sm)',
  padding:      '4px 10px',
  cursor:       'pointer',
  fontSize:     'var(--text-xs)',
  flexShrink:   0,
};

// ─── Path security helpers (local, non-exported) ──────────────────────────────

/**
 * Returns true when replacementFilePath is a safe absolute path to an existing file.
 * T-04-07: replacement file path must be absolute.
 */
function isReplacementPathAbsolute(rp: string): boolean {
  return path.isAbsolute(rp);
}

/**
 * Compute the SHA-256 hex digest of a file at the given absolute path.
 * R2-W5: stored in entry.sha256 for drift detection in changesetService.
 * Returns undefined if the file cannot be read.
 */
function computeSha256(filePath: string): string | undefined {
  try {
    const bytes = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(bytes).digest('hex');
  } catch {
    return undefined;
  }
}

// ─── StagingPanelBody ─────────────────────────────────────────────────────────

export interface StagingPanelBodyProps {
  entries:       StagingEntry[];
  buildStatus:   ReturnType<typeof useStagingStore.getState>['buildStatus'];
  workspaceName: string | null;
}

/**
 * Extracted staging body. Does NOT render a panel-head title.
 * DeployPanel (consumer) owns the outer container and section headers.
 */
export default function StagingPanelBody({
  entries,
  buildStatus,
  workspaceName: _workspaceName,
}: StagingPanelBodyProps): React.ReactElement {
  // ── Virtualization state ───────────────────────────────────────────────────

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop,  setScrollTop]  = useState(0);
  const [viewHeight, setViewHeight] = useState(400);

  // Pending file awaiting a virtual-path before it can be staged.
  const [pendingFile, setPendingFile] =
    useState<{ filePath: string; defaultVp: string } | null>(null);

  // ResizeObserver — mirrors VfsTree.tsx exactly
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

  // Windowing math (mirrors VfsTree.tsx exactly)
  const totalRows   = entries.length;
  const totalHeight = totalRows * ROW_HEIGHT;

  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT);
  const startRow     = Math.max(0, firstVisible - OVERSCAN);
  const endRow       = Math.min(totalRows - 1, firstVisible + visibleCount + OVERSCAN);
  const topPad       = startRow * ROW_HEIGHT;
  const bottomPad    = Math.max(0, (totalRows - endRow - 1) * ROW_HEIGHT);

  const visibleRows = useMemo(() => {
    const rows: number[] = [];
    for (let r = startRow; r <= endRow; r++) {
      rows.push(r);
    }
    return rows;
  }, [startRow, endRow]);

  // ── Derived counts for footer ──────────────────────────────────────────────

  const addCount    = entries.filter((e) => e.action === 'add').length;
  const modifyCount = entries.filter((e) => e.action === 'modify').length;
  const deleteCount = entries.filter((e) => e.action === 'delete').length;

  // ── Button state ───────────────────────────────────────────────────────────

  const isBuilding   = buildStatus.kind === 'building';
  const saveDisabled = entries.length === 0 || isBuilding;

  // Save-version modal state + default label (Version N, from changeset count).
  const [savingOpen, setSavingOpen] = useState(false);
  const changesetCount = useChangesetStore((s) => s.manifest?.changesets.length ?? 0);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    // Open a file picker via IPC — TypedIpcRenderer from @swg/contracts enforces channel type.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ipcRenderer } = require('electron') as { ipcRenderer: TypedIpcRenderer };

    void (async () => {
      try {
        const filePaths = await ipcRenderer.invoke('workspace:pick-file');
        if (filePaths.length === 0 || !filePaths[0]) return;
        const filePath = filePaths[0];

        if (!isReplacementPathAbsolute(filePath)) return;

        setPendingFile({ filePath, defaultVp: path.basename(filePath) });
      } catch (err) {
        console.error('[StagingPanelBody] handleAdd error:', err);
      }
    })();
  }, []);

  // Finalize staging once the user supplies/accepts a virtual path in the modal.
  const handleConfirmVirtualPath = useCallback((virtualPath: string) => {
    setPendingFile((pending) => {
      if (!pending) return null;
      if (!isVirtualPathSafe(virtualPath)) return pending; // modal blocks this, defensive
      // R2-W5: Compute SHA-256 before adding entry
      const sha256 = computeSha256(pending.filePath);
      useStagingStore.getState().addEntry({
        virtualPath,
        action: 'modify',
        replacementFilePath: pending.filePath,
        sha256,
      });
      return null;
    });
  }, []);

  // Seal the current staging set as a new version (changeset).
  const handleSaveVersion = useCallback((label: string) => {
    setSavingOpen(false);
    void sealVersion({ sealedBy: 'manual', entries, label }).catch((err) => {
      const msg = String((err as Error)?.message ?? err);
      window.alert(msg);
      console.error('[StagingPanelBody] saveVersion error:', err);
    });
  }, [entries]);

  // ── Drag-drop ──────────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    // 'path' property is available in Electron with nodeIntegration:true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filePath: string | undefined = (file as any).path;
    if (!filePath || !isReplacementPathAbsolute(filePath)) return;

    setPendingFile({ filePath, defaultVp: path.basename(filePath) });
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Virtual-path modal — replaces unsupported window.prompt() for staging a file */}
      {pendingFile && (
        <VirtualPathModal
          defaultValue={pendingFile.defaultVp}
          onConfirm={handleConfirmVirtualPath}
          onCancel={() => setPendingFile(null)}
        />
      )}

      {/* Save-version modal — collects a label, then seals the staging set as a changeset */}
      {savingOpen && (
        <VirtualPathModal
          title="Save version"
          subtitle="Name this version so you can find it in the timeline."
          confirmLabel="Save version"
          validate={(v) => v.trim().length > 0}
          defaultValue={`Version ${changesetCount + 1}`}
          onConfirm={handleSaveVersion}
          onCancel={() => setSavingOpen(false)}
        />
      )}

      {/* Panel head — Add… + Save version controls (NO title — DeployPanel owns headers) */}
      <div
        style={{
          display:      'flex',
          alignItems:   'center',
          height:       'var(--tabstrip-h)',
          background:   'var(--color-header)',
          borderBottom: '1px solid var(--color-border)',
          paddingLeft:  'var(--space-4)',
          paddingRight: 'var(--space-4)',
          gap:          'var(--space-2)',
          flexShrink:   0,
        }}
      >
        {/* NO title span — DeployPanel owns the section header */}

        {/* Add… button */}
        <button
          style={secondaryBtnStyle}
          onClick={handleAdd}
          aria-label="Add file to staging list"
          title="Add a replacement file to the patch"
        >
          Add…
        </button>

        {/* Save version button — seals the staging set as a changeset */}
        <button
          style={primaryBtnStyle(saveDisabled)}
          disabled={saveDisabled}
          aria-disabled={saveDisabled}
          onClick={saveDisabled ? undefined : () => setSavingOpen(true)}
          aria-label="Save version"
          title={saveDisabled ? 'Stage at least one change to save a version' : 'Seal these changes as a new version'}
        >
          Save version
        </button>
      </div>

      {/* Body: empty state or virtualized list */}
      {entries.length === 0 ? (
        <StagingEmptyState
          containerRef={containerRef}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      ) : (
        <VirtualizedStagingList
          entries={entries}
          containerRef={containerRef}
          totalHeight={totalHeight}
          topPad={topPad}
          bottomPad={bottomPad}
          visibleRows={visibleRows}
          onScroll={handleScroll}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      )}

      {/* Footer summary */}
      <StagingFooter
        n={totalRows}
        addCount={addCount}
        modifyCount={modifyCount}
        deleteCount={deleteCount}
        buildStatus={buildStatus}
      />
    </>
  );
}

// ─── Text-input modal (Electron-safe replacement for window.prompt) ─────────────

interface VirtualPathModalProps {
  defaultValue:    string;
  onConfirm:       (value: string) => void;
  onCancel:        () => void;
  title?:          string;
  subtitle?:       string;
  confirmLabel?:   string;
  validate?:       (value: string) => boolean;
  invalidMessage?: string;
}

function VirtualPathModal({
  defaultValue,
  onConfirm,
  onCancel,
  title          = 'Virtual archive path',
  subtitle       = 'Where this file lands inside the patch — e.g. appearance/armor.mgn',
  confirmLabel   = 'Add to patch',
  validate       = isVirtualPathSafe,
  invalidMessage = 'Invalid path — "..", leading slash, and drive letters are not allowed.',
}: VirtualPathModalProps): React.ReactElement {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const valid = validate(value);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const submit = useCallback(() => {
    if (valid) onConfirm(value);
  }, [valid, value, onConfirm]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      style={{
        position:       'fixed',
        inset:          0,
        background:     'rgba(0,0,0,0.5)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        zIndex:         1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display:       'flex',
          flexDirection: 'column',
          gap:           'var(--space-3)',
          width:         440,
          maxWidth:      '90vw',
          padding:       'var(--space-4)',
          background:    'var(--color-surface)',
          border:        '1px solid var(--color-border)',
          borderRadius:  'var(--radius-md)',
          color:         'var(--color-text)',
          fontFamily:    'var(--font-sans)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>
          {title}
        </span>
        <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
          {subtitle}
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
          spellCheck={false}
          style={{
            fontFamily:   'var(--font-mono)',
            fontSize:     'var(--text-sm)',
            padding:      '6px 8px',
            background:   'var(--color-widget)',
            color:        'var(--color-text)',
            border:       `1px solid ${valid ? 'var(--color-border)' : 'var(--color-danger)'}`,
            borderRadius: 'var(--radius-sm)',
            outline:      'none',
          }}
        />
        {!valid && (
          <span style={{ color: 'var(--color-danger)', fontSize: 'var(--text-xs)' }}>
            {invalidMessage}
          </span>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button style={secondaryBtnStyle} onClick={onCancel}>
            Cancel
          </button>
          <button
            style={primaryBtnStyle(!valid)}
            disabled={!valid}
            aria-disabled={!valid}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

interface StagingEmptyStateProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDragOver:   (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop:       (e: React.DragEvent<HTMLDivElement>) => void;
}

function StagingEmptyState({
  containerRef,
  onDragOver,
  onDrop,
}: StagingEmptyStateProps): React.ReactElement {
  return (
    <div
      ref={containerRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        flex:           1,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            'var(--space-2)',
        color:          'var(--color-text-muted)',
        textAlign:      'center',
        padding:        'var(--space-4)',
        minHeight:      0,
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>
        Nothing staged
      </span>
      <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-base)' }}>
        Right-click a file in the TRE browser → Extract to staging, or drop a replacement file here.
      </span>
    </div>
  );
}

// ─── Virtualized list ──────────────────────────────────────────────────────────

interface VirtualizedStagingListProps {
  entries:      StagingEntry[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  totalHeight:  number;
  topPad:       number;
  bottomPad:    number;
  visibleRows:  number[];
  onScroll:     (e: React.UIEvent<HTMLDivElement>) => void;
  onDragOver:   (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop:       (e: React.DragEvent<HTMLDivElement>) => void;
}

function VirtualizedStagingList({
  entries,
  containerRef,
  totalHeight,
  topPad,
  bottomPad,
  visibleRows,
  onScroll,
  onDragOver,
  onDrop,
}: VirtualizedStagingListProps): React.ReactElement {
  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Staged patch entries"
      onScroll={onScroll}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Top padding spacer */}
        <div style={{ height: topPad }} />

        {/* Visible rows */}
        {visibleRows.map((rowIndex) => {
          const entry = entries[rowIndex];
          if (!entry) return null;
          return (
            <StagingRow
              key={entry.virtualPath}
              entry={entry}
            />
          );
        })}

        {/* Bottom padding spacer */}
        <div style={{ height: bottomPad }} />
      </div>
    </div>
  );
}

// ─── Staging row ───────────────────────────────────────────────────────────────

interface StagingRowProps {
  entry: StagingEntry;
}

function StagingRow({ entry }: StagingRowProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  const handleRemove = useCallback(() => {
    useStagingStore.getState().removeEntry(entry.virtualPath);
  }, [entry.virtualPath]);

  // Path-traversal rejection display (T-04-06)
  const pathIsInvalid = !isVirtualPathSafe(entry.virtualPath);

  // Source-file missing check (T-04-08)
  const sourceIsMissing =
    entry.action !== 'delete' &&
    entry.replacementFilePath !== undefined &&
    !fs.existsSync(entry.replacementFilePath);

  // Source info text
  const sourceText = (() => {
    if (entry.action === 'delete') return '(tombstone — length-0)';
    if (entry.replacementFilePath) {
      const filename = path.basename(entry.replacementFilePath);
      try {
        const stat = fs.statSync(entry.replacementFilePath);
        const kb   = (stat.size / 1024).toFixed(1);
        return `${filename} · ${kb} KB`;
      } catch {
        return filename;
      }
    }
    return '—';
  })();

  return (
    <div
      role="option"
      aria-selected={false}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          'var(--space-2)',
        height:       ROW_HEIGHT,
        paddingLeft:  'var(--space-4)',
        paddingRight: 'var(--space-2)',
        background:   hovered ? 'var(--color-surface-2)' : 'transparent',
        transition:   'background 0.1s ease',
        boxSizing:    'border-box',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Action badge */}
      <ActionBadge action={entry.action} />

      {/* Virtual path */}
      {pathIsInvalid ? (
        <span
          style={{
            flex:         1,
            fontFamily:   'var(--font-mono)',
            fontSize:     'var(--text-xs)',
            color:        'var(--color-danger)',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}
          title={entry.virtualPath}
        >
          ✕ invalid path — ".." not allowed
        </span>
      ) : (
        <span
          style={{
            flex:         1,
            fontFamily:   'var(--font-mono)',
            fontSize:     'var(--text-xs)',
            color:        'var(--color-text)',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}
          title={entry.virtualPath}
        >
          {entry.virtualPath}
        </span>
      )}

      {/* Source info */}
      {sourceIsMissing ? (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   'var(--text-xs)',
            color:      'var(--color-warn)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
          title="Replacement file no longer exists at the staged path"
        >
          ⚠ source missing
        </span>
      ) : (
        <span
          style={{
            fontFamily:   'var(--font-mono)',
            fontSize:     'var(--text-xs)',
            color:        'var(--color-text-faint)',
            flexShrink:   0,
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
            maxWidth:     160,
          }}
          title={entry.replacementFilePath ?? ''}
        >
          {sourceText}
        </span>
      )}

      {/* Remove button */}
      <button
        aria-label="Remove from patch"
        title="Remove from patch"
        onClick={handleRemove}
        style={{
          background: 'transparent',
          border:     'none',
          color:      'var(--color-text-faint)',
          cursor:     'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize:   'var(--text-sm)',
          padding:    '0 var(--space-1)',
          flexShrink: 0,
          lineHeight: 1,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-faint)'; }}
      >
        ×
      </button>
    </div>
  );
}

// ─── Footer summary ────────────────────────────────────────────────────────────

interface StagingFooterProps {
  n:           number;
  addCount:    number;
  modifyCount: number;
  deleteCount: number;
  buildStatus: ReturnType<typeof useStagingStore.getState>['buildStatus'];
}

function StagingFooter({
  n,
  addCount,
  modifyCount,
  deleteCount,
  buildStatus,
}: StagingFooterProps): React.ReactElement {
  return (
    <div
      style={{
        display:    'flex',
        alignItems: 'center',
        gap:        'var(--space-2)',
        padding:    '0 var(--space-4)',
        height:     22,
        borderTop:  '1px solid var(--color-border)',
        background: 'var(--color-header)',
        fontFamily: 'var(--font-mono)',
        fontSize:   'var(--text-xs)',
        color:      'var(--color-text-faint)',
        flexShrink: 0,
        overflow:   'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <span>
        {n} staged · {addCount} add · {modifyCount} modify · {deleteCount} delete
      </span>

      {buildStatus.kind === 'building' && (
        <span style={{ color: 'var(--color-accent)' }}>⟳ building…</span>
      )}
      {buildStatus.kind === 'done' && (
        <span style={{ color: 'var(--color-accent)' }}>✓ packed</span>
      )}
      {buildStatus.kind === 'error' && (
        <span style={{ color: 'var(--color-danger)' }} title={buildStatus.reason}>
          ✕ build error
        </span>
      )}
    </div>
  );
}
