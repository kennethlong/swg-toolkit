/**
 * packages/renderer/src/panels/deploy/StagingPanelBody.tsx
 * Extracted staging body — Phase 04.1 DEPLOY-05/07 + Phase 04.3 DEPLOYUI-05..10.
 *
 * 04.3-07 additions (Task 2):
 *   DEPLOYUI-05/D7: real row selection — click sets selected row → accent bg + inset left bar;
 *                   aria-selected wired (was hardcoded false).
 *   DEPLOYUI-04/D6: working-vs-saved split — "Based on vN" divider + dimmed "Saved in vN" rows.
 *   DEPLOYUI-07/D9: changed-vs-base ●/○ dot per row ("identical to base" when bytes match version).
 *   DEPLOYUI-08/D10: staging footer payload total "… · NNN kB payload" (sum staged file sizes).
 *   DEPLOYUI-09/D11: hover-only × remove (opacity 0→1 on row hover; was always visible).
 *   DEPLOYUI-10/D12: row context-menu parity — editor (DISABLED) / viewport (FUNCTIONAL) /
 *                    reveal-in-TRE (DISABLED) / compare-to-base (DISABLED) alongside existing.
 *   DEPLOYUI-06/D8: ActionBadge restyled as pill + "modify" label (in ActionBadge.tsx).
 *
 * KEEP items (unchanged from prior phase):
 *   - Drag-drop staging, empty-state card, invalid-path/source-missing warnings.
 *   - Panel head "Add…" + "Save version" controls.
 *   - Virtualization: ROW_HEIGHT=30, OVERSCAN=8.
 *   - A11y: role="listbox" + role="option".
 *
 * Context-menu disposition (DEPLOYUI-10/D12):
 *   - "Open in viewport" → FUNCTIONAL (calls openStagedEntry)
 *   - "Reveal in TRE browser" → DISABLED (no existing handler; coming soon)
 *   - "Compare to base…" → DISABLED (no existing handler; coming soon)
 *   - "Open in editor" → DISABLED (no existing handler; coming soon)
 *
 * Source: 04.1-03-PLAN.md Task 2; 04.3-07-PLAN.md Task 2.
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
import { useWorkspaceStore }  from '../../state/workspaceStore';
import { useStagingStore }    from '../../state/stagingStore';
import { openStagedEntry }    from '../../services/openInViewer';

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

function isReplacementPathAbsolute(rp: string): boolean {
  return path.isAbsolute(rp);
}

function computeSha256(filePath: string): string | undefined {
  try {
    const bytes = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(bytes).digest('hex');
  } catch {
    return undefined;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the file size in bytes for the given absolute path.
 * Returns 0 if the file cannot be read.
 */
function getFileSizeBytes(filePath: string | undefined): number {
  if (!filePath) return 0;
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/** Format a byte count as "NNN kB" (rounded, ≥1 kB → NNN kB, else "< 1 kB"). */
function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return '< 1 kB';
  return `${Math.round(kb)} kB`;
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

  // DEPLOYUI-05/D7: selected row path
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

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

  // Extract→Add feedback: scroll the newly-staged (appended) row into view so the
  // flash highlight is visible even when the list is long.
  const flashNonce = useStagingStore((s) => s.flash?.nonce);
  useEffect(() => {
    if (flashNonce === undefined) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [flashNonce]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget as HTMLDivElement).scrollTop);
  }, []);

  // ── DEPLOYUI-04/D6: Working-vs-saved split ─────────────────────────────────
  // Compare staging entries against the active version's flat content.
  // Entries that match the active version = "saved in vN"; rest = "working".
  const manifest    = useChangesetStore((s) => s.manifest);
  const studioDir   = useWorkspaceStore((s) => s.studioDir);
  const activeVersionId = manifest?.activeVersionId ?? null;

  const [savedPaths, setSavedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Try to compute the active version's flat content.
    // We import dynamically to avoid a hard dependency on the real FS in tests
    // (tests mock this module).
    (async () => {
      if (!activeVersionId || !manifest || !studioDir) {
        setSavedPaths(new Set());
        return;
      }
      try {
        const { flatten } = await import('../../services/changesetService');
        const flat = flatten(activeVersionId, manifest, studioDir);
        setSavedPaths(new Set(flat.map((e) => e.virtualPath)));
      } catch {
        setSavedPaths(new Set());
      }
    })().catch(() => { /* ignore */ });
  }, [activeVersionId, manifest, studioDir]);

  // Split entries into working (not in saved version) and saved (in version)
  const workingEntries = useMemo(
    () => entries.filter((e) => !savedPaths.has(e.virtualPath)),
    [entries, savedPaths],
  );
  const savedEntries = useMemo(
    () => entries.filter((e) => savedPaths.has(e.virtualPath)),
    [entries, savedPaths],
  );

  // Compute "based on vN" label for the divider
  const activeVersionLabel = useMemo(() => {
    if (!activeVersionId || !manifest) return null;
    const cs = manifest.changesets.find((c) => c.id === activeVersionId);
    return cs?.label ?? null;
  }, [activeVersionId, manifest]);

  // ── Virtualization ─────────────────────────────────────────────────────────

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

  // DEPLOYUI-08/D10: payload total in kB
  const payloadBytes = useMemo(
    () => entries.reduce((sum, e) => sum + getFileSizeBytes(e.replacementFilePath), 0),
    [entries],
  );

  // ── Button state ───────────────────────────────────────────────────────────

  const isBuilding   = buildStatus.kind === 'building';
  const saveDisabled = entries.length === 0 || isBuilding;

  // Save-version modal state + default label (Version N, from changeset count).
  const [savingOpen, setSavingOpen] = useState(false);
  const changesetCount = useChangesetStore((s) => s.manifest?.changesets.length ?? 0);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
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

  const handleConfirmVirtualPath = useCallback((virtualPath: string) => {
    setPendingFile((pending) => {
      if (!pending) return null;
      if (!isVirtualPathSafe(virtualPath)) return pending;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filePath: string | undefined = (file as any).path;
    if (!filePath || !isReplacementPathAbsolute(filePath)) return;
    setPendingFile({ filePath, defaultVp: path.basename(filePath) });
  }, []);

  // ── Row selection handler (D7) ─────────────────────────────────────────────

  const handleRowSelect = useCallback((virtualPath: string) => {
    setSelectedPath((prev) => (prev === virtualPath ? null : virtualPath));
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Virtual-path modal */}
      {pendingFile && (
        <VirtualPathModal
          defaultValue={pendingFile.defaultVp}
          onConfirm={handleConfirmVirtualPath}
          onCancel={() => setPendingFile(null)}
        />
      )}

      {/* Save-version modal */}
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
        {/* Add… button */}
        <button
          style={secondaryBtnStyle}
          onClick={handleAdd}
          aria-label="Add file to staging list"
          title="Add a replacement file to the patch"
        >
          Add…
        </button>

        {/* Save version button */}
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

      {/* Body: empty state or virtualized list with working-vs-saved split */}
      {entries.length === 0 ? (
        <StagingEmptyState
          containerRef={containerRef}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      ) : (
        <VirtualizedStagingList
          entries={entries}
          workingEntries={workingEntries}
          savedEntries={savedEntries}
          savedPaths={savedPaths}
          activeVersionLabel={activeVersionLabel}
          selectedPath={selectedPath}
          onRowSelect={handleRowSelect}
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

      {/* Footer summary (DEPLOYUI-08/D10: includes kB payload total) */}
      <StagingFooter
        n={totalRows}
        addCount={addCount}
        modifyCount={modifyCount}
        deleteCount={deleteCount}
        payloadBytes={payloadBytes}
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

// ─── Virtualized list with working-vs-saved split ──────────────────────────────

interface VirtualizedStagingListProps {
  entries:            StagingEntry[];
  workingEntries:     StagingEntry[];
  savedEntries:       StagingEntry[];
  savedPaths:         Set<string>;
  activeVersionLabel: string | null;
  selectedPath:       string | null;
  onRowSelect:        (virtualPath: string) => void;
  containerRef:       React.RefObject<HTMLDivElement | null>;
  totalHeight:        number;
  topPad:             number;
  bottomPad:          number;
  visibleRows:        number[];
  onScroll:           (e: React.UIEvent<HTMLDivElement>) => void;
  onDragOver:         (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop:             (e: React.DragEvent<HTMLDivElement>) => void;
}

function VirtualizedStagingList({
  entries,
  workingEntries,
  savedEntries,
  savedPaths,
  activeVersionLabel,
  selectedPath,
  onRowSelect,
  containerRef,
  totalHeight,
  topPad,
  bottomPad,
  visibleRows,
  onScroll,
  onDragOver,
  onDrop,
}: VirtualizedStagingListProps): React.ReactElement {
  const hasSplit = savedEntries.length > 0 && workingEntries.length > 0;

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

          // Insert working-vs-saved divider BEFORE the first saved entry
          const isSaved = savedPaths.has(entry.virtualPath);
          const prevEntry = rowIndex > 0 ? entries[rowIndex - 1] : null;
          const prevIsSaved = prevEntry ? savedPaths.has(prevEntry.virtualPath) : false;
          const showDivider = hasSplit && isSaved && !prevIsSaved;

          return (
            <React.Fragment key={entry.virtualPath}>
              {/* DEPLOYUI-04/D6: Working-vs-saved divider */}
              {showDivider && (
                <div
                  data-testid="working-vs-saved-divider"
                  style={{
                    display:      'flex',
                    alignItems:   'center',
                    gap:          6,
                    padding:      '4px 10px',
                    fontSize:     10,
                    color:        'var(--color-text-faint)',
                    background:   'var(--color-bg)',
                    borderTop:    '1px solid var(--color-border-soft)',
                    borderBottom: '1px solid var(--color-border-soft)',
                    flexShrink:   0,
                  }}
                >
                  Based on{' '}
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>
                    {activeVersionLabel ?? 'current version'}
                  </span>
                  {' · '}
                  {savedEntries.length} {savedEntries.length === 1 ? 'file' : 'files'} from previous version below
                </div>
              )}
              <StagingRow
                entry={entry}
                isSelected={selectedPath === entry.virtualPath}
                isSaved={isSaved && hasSplit}
                onSelect={() => onRowSelect(entry.virtualPath)}
              />
            </React.Fragment>
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
  entry:      StagingEntry;
  isSelected: boolean;
  isSaved:    boolean;
  onSelect:   () => void;
}

function StagingRow({ entry, isSelected, isSaved, onSelect }: StagingRowProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  // Extract→Add feedback: briefly highlight this row when it's the flashed entry.
  const flash = useStagingStore((s) => s.flash);
  const [isFlashing, setIsFlashing] = useState(false);
  useEffect(() => {
    if (flash && flash.virtualPath === entry.virtualPath) {
      setIsFlashing(true);
      const t = setTimeout(() => setIsFlashing(false), 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [flash?.nonce, flash?.virtualPath, entry.virtualPath]);

  const handleRemove = useCallback(() => {
    useStagingStore.getState().removeEntry(entry.virtualPath);
  }, [entry.virtualPath]);

  // Right-click context menu
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const canOpen = entry.action !== 'delete' && !!entry.replacementFilePath;

  // Open in viewport — calls openStagedEntry (FUNCTIONAL)
  const handleOpenViewport = useCallback(() => {
    if (entry.action === 'delete' || !entry.replacementFilePath) return;
    void openStagedEntry(entry.virtualPath, entry.replacementFilePath);
  }, [entry.action, entry.replacementFilePath, entry.virtualPath]);

  // Path-traversal rejection display (T-04-06)
  const pathIsInvalid = !isVirtualPathSafe(entry.virtualPath);

  // Source-file missing check (T-04-08)
  const sourceIsMissing =
    entry.action !== 'delete' &&
    entry.replacementFilePath !== undefined &&
    !fs.existsSync(entry.replacementFilePath);

  // DEPLOYUI-07/D9: changed-vs-base dot
  // A saved row is "identical to base" (it came from the version's flat content).
  // A working row is always "changed" relative to the base.
  const isIdenticalToBase = isSaved;

  // Source kB text
  const sourceKbText = (() => {
    if (entry.action === 'delete') return '(tombstone)';
    if (entry.replacementFilePath) {
      try {
        const stat = fs.statSync(entry.replacementFilePath);
        return `${Math.round(stat.size / 1024)} kB`;
      } catch {
        return path.basename(entry.replacementFilePath);
      }
    }
    return '—';
  })();

  // Row background: selected (D7) > flashing > hovered > saved (dimmed) > default
  const rowBackground = isSelected
    ? 'var(--color-accent-dim)'
    : isFlashing
      ? 'var(--color-accent-dim, rgba(46,160,160,0.22))'
      : hovered
        ? 'var(--color-surface-2)'
        : 'transparent';

  const rowBoxShadow = isSelected ? 'inset 2px 0 0 var(--color-accent)' : undefined;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      data-testid="staging-row"
      onClick={onSelect}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          'var(--space-2)',
        height:       ROW_HEIGHT,
        paddingLeft:  8,
        paddingRight: 6,
        background:   rowBackground,
        boxShadow:    rowBoxShadow,
        transition:   isFlashing ? 'background 0.1s ease' : 'background 0.5s ease',
        boxSizing:    'border-box',
        opacity:      isSaved ? 0.55 : 1,
        cursor:       'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
    >
      {/* DEPLOYUI-10/D12: context menu — parity with TRE view */}
      {menu && (
        <>
          <div
            onClick={(e) => { e.stopPropagation(); setMenu(null); }}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
            style={{ position: 'fixed', inset: 0, zIndex: 2000 }}
          />
          <div
            role="menu"
            data-testid="staging-row-ctx-menu"
            style={{
              position: 'fixed', left: menu.x, top: menu.y, zIndex: 2001,
              minWidth: 170, padding: '3px 0', display: 'flex', flexDirection: 'column',
              background: 'var(--color-header)', border: '1px solid var(--color-border-soft)',
              borderRadius: 'var(--radius-sm)', boxShadow: '0 6px 20px rgba(0,0,0,.55)',
              fontFamily: 'var(--font-sans)', fontSize: 11,
            }}
          >
            {/* Open in editor — DISABLED: no handler yet */}
            <button
              role="menuitem"
              disabled
              aria-disabled="true"
              title="Coming soon"
              data-testid="ctx-open-in-editor"
              style={{
                background: 'transparent', border: 'none', textAlign: 'left',
                color: 'var(--color-text-faint)', cursor: 'not-allowed',
                padding: '5px 9px', fontFamily: 'inherit', fontSize: 'inherit', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ width: 14, textAlign: 'center' }}>◳</span> Open in editor
            </button>

            {/* Open in viewport — FUNCTIONAL */}
            <button
              role="menuitem"
              disabled={!canOpen}
              onClick={(e) => { e.stopPropagation(); setMenu(null); handleOpenViewport(); }}
              title={canOpen ? 'Open the staged file in the viewport' : 'Nothing to open (tombstone)'}
              data-testid="ctx-open-in-viewport"
              style={{
                background: 'transparent', border: 'none', textAlign: 'left',
                color: canOpen ? 'var(--color-text-muted)' : 'var(--color-text-faint)',
                cursor: canOpen ? 'pointer' : 'not-allowed',
                padding: '5px 9px', fontFamily: 'inherit', fontSize: 'inherit', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ width: 14, textAlign: 'center' }}>◉</span> Open in viewport
            </button>

            {/* Reveal in TRE browser — DISABLED: no handler yet */}
            <button
              role="menuitem"
              disabled
              aria-disabled="true"
              title="Coming soon"
              data-testid="ctx-reveal-in-tre"
              style={{
                background: 'transparent', border: 'none', textAlign: 'left',
                color: 'var(--color-text-faint)', cursor: 'not-allowed',
                padding: '5px 9px', fontFamily: 'inherit', fontSize: 'inherit', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ width: 14, textAlign: 'center' }}>⌖</span> Reveal in TRE browser
            </button>

            {/* Compare to base — DISABLED: no handler yet */}
            <button
              role="menuitem"
              disabled
              aria-disabled="true"
              title="Coming soon"
              data-testid="ctx-compare-to-base"
              style={{
                background: 'transparent', border: 'none', textAlign: 'left',
                color: 'var(--color-text-faint)', cursor: 'not-allowed',
                padding: '5px 9px', fontFamily: 'inherit', fontSize: 'inherit', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ width: 14, textAlign: 'center' }}>≢</span> Compare to base…
            </button>

            {/* Separator */}
            <div style={{ height: 1, background: 'var(--color-border-soft)', margin: '3px 2px' }} />

            {/* Unstage / Remove — FUNCTIONAL */}
            <button
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); setMenu(null); handleRemove(); }}
              title="Remove this entry from the patch staging list"
              data-testid="ctx-unstage"
              style={{
                background: 'transparent', border: 'none', textAlign: 'left',
                color: '#e0584f', cursor: 'pointer',
                padding: '5px 9px', fontFamily: 'inherit', fontSize: 'inherit', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ width: 14, textAlign: 'center' }}>×</span> Remove from staging
            </button>
          </div>
        </>
      )}

      {/* DEPLOYUI-07/D9: changed-vs-base indicator */}
      <span
        aria-hidden="true"
        data-testid="change-dot"
        title={isIdenticalToBase ? 'identical to base — no actual change' : 'content differs from base'}
        style={{
          fontSize:    11,
          width:       12,
          textAlign:   'center',
          lineHeight:  1,
          flexShrink:  0,
          color:       isIdenticalToBase
            ? 'var(--color-text-faint)'
            : 'var(--color-success, #43c267)',
        }}
      >
        {isIdenticalToBase ? '○' : '●'}
      </span>

      {/* Action badge (D8 pill styling in ActionBadge.tsx) */}
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

      {/* Source info / kB */}
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
            whiteSpace:   'nowrap',
          }}
          title={entry.replacementFilePath ?? ''}
        >
          {sourceKbText}
        </span>
      )}

      {/* DEPLOYUI-09/D11: hover-only × remove button (opacity 0→1) */}
      <button
        aria-label="Remove from patch"
        title="Remove from patch"
        onClick={(e) => { e.stopPropagation(); handleRemove(); }}
        data-testid="remove-btn"
        style={{
          background:  'transparent',
          border:      'none',
          color:       'var(--color-text-faint)',
          cursor:      'pointer',
          fontFamily:  'var(--font-mono)',
          fontSize:    'var(--text-sm)',
          padding:     '0 var(--space-1)',
          flexShrink:  0,
          lineHeight:  1,
          // D11: hidden until row hover
          opacity:     hovered ? 1 : 0,
          transition:  'opacity 0.1s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#e0584f'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-faint)'; }}
      >
        ×
      </button>
    </div>
  );
}

// ─── Footer summary ────────────────────────────────────────────────────────────

interface StagingFooterProps {
  n:            number;
  addCount:     number;
  modifyCount:  number;
  deleteCount:  number;
  payloadBytes: number;
  buildStatus:  ReturnType<typeof useStagingStore.getState>['buildStatus'];
}

function StagingFooter({
  n,
  addCount,
  modifyCount,
  deleteCount,
  payloadBytes,
  buildStatus,
}: StagingFooterProps): React.ReactElement {
  return (
    <div
      data-testid="staging-footer"
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

      {/* DEPLOYUI-08/D10: kB payload total */}
      {n > 0 && (
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-faint)' }}>
          · {formatKb(payloadBytes)} payload
        </span>
      )}

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
