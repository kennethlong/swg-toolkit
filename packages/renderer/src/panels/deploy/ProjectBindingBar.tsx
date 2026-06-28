/**
 * packages/renderer/src/panels/deploy/ProjectBindingBar.tsx
 * PROJ-01 front-door control — Assets panel-head bar (007-A).
 *
 * Contains:
 *   - ＋ Project ▾ split-button (primary CTA) — primary button triggers onNewProject;
 *     ▾ opens a dropdown menu: New | Open… | Open Recent
 *   - Mount Archive… secondary button (delegates to onMount prop)
 *   - Bound-client chip: ⛁ <clientName> · EERT<version>  (when clientPath is set)
 *
 * Mounts in: TreVfsBrowser.tsx (Assets panel-head); replaces the previous mount toolbar.
 *
 * W1 fix: primaryBtnStyle / secondaryBtnStyle are LOCAL const functions — NOT imported
 * from ExportDialog (that file does not export them).
 *
 * Security: Open… paths arrive via workspace:pick-dir IPC (OS dialog in main process) —
 * never free-text shell strings (T-04.1-07).
 *
 * Source: 04.1-04-PLAN.md Task 1; 04.1-UI-SPEC.md Surface 2 §007-A; 04.1-PATTERNS.md §ProjectBindingBar.tsx.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useTreStore } from '../../state/treStore';
import * as projectBinding from '../../services/projectBinding';
import { resolveLayout } from '../../services/clientLayout';
import type { TypedIpcRenderer } from '@swg/contracts';

// Path B: require() for Node modules (nodeIntegration:true)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require('path') as typeof import('path');

// ─── IPC bridge ───────────────────────────────────────────────────────────────

// Path B: dialog is main-process only — invoke via IPC.
// TypedIpcRenderer from @swg/contracts is the single source of truth for channel types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcRenderer } = require('electron') as { ipcRenderer: TypedIpcRenderer };

// ─── Button styles (W1 fix — LOCAL const functions, not shared via ExportDialog) ─

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background:   disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    border:       'none',
    color:        disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)', // flat right edge for split
    padding:      '4px 10px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontSize:     'var(--text-sm)',
    fontWeight:   600,
    opacity:      disabled ? 0.6 : 1,
    transition:   'opacity 0.1s ease',
    flexShrink:   0,
  };
}

const dropdownToggleStyle: React.CSSProperties = {
  background:   'var(--color-accent)',
  border:       'none',
  borderLeft:   '1px solid var(--color-accent-hover, rgba(255,255,255,0.15))',
  color:        'var(--color-accent-text)',
  borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
  padding:      '4px 7px',
  cursor:       'pointer',
  fontSize:     'var(--text-xs)',
  lineHeight:   1,
  flexShrink:   0,
};

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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ProjectBindingBarProps {
  /** Opens the New Project wizard (managed by TreVfsBrowser). */
  onNewProject: () => void;
  /** Delegates to TreVfsBrowser's existing handleMountClick. */
  onMount: () => void;
  /** Archive count — shown as a chip when archives are mounted. */
  archiveCount: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectBindingBar({
  onNewProject,
  onMount,
  archiveCount,
}: ProjectBindingBarProps): React.ReactElement {
  const clientPath  = useWorkspaceStore((s) => s.clientPath);
  const wsInfo      = useWorkspaceStore((s) => s.status.kind === 'ready' ? s.status.info : null);
  const archives    = useTreStore((s) => s.archives);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Derived chip values
  // clientName: basename of installPath — e.g. "SWG Infinity" from "D:\SWG Infinity\SWG Infinity"
  const clientName = clientPath ? nodePath.basename(clientPath) : null;
  // treVersion: strip leading 'v' from archive version tag — e.g. "0005" from "v0005"
  const treVersion = archives.length > 0 ? archives[0].version.replace(/^v/, '') : null;

  // D-13: resolve layout for the current client path (for maxSearchPriority display)
  // useMemo prevents re-probing the fs on every render; only recalculates when clientPath changes
  const detectedLayout = useMemo(
    () => (clientPath ? resolveLayout(clientPath) : null),
    [clientPath],
  );

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Open… — pick-dir IPC then initProject (same async/error pattern as WorkspaceEntry.tsx:73-99)
  const handleOpen = useCallback(async () => {
    setMenuOpen(false);
    setError(null);
    try {
      const paths = await ipcRenderer.invoke('workspace:pick-dir');
      if (paths.length > 0 && paths[0]) {
        await projectBinding.initProject(paths[0]);
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      setError(msg);
      console.error('[ProjectBindingBar] Open error:', err);
    }
  }, []);

  const handleNewProject = useCallback(() => {
    setMenuOpen(false);
    onNewProject();
  }, [onNewProject]);

  // D-13: binding detail fields derived from wsInfo (written by initProject via workspace.json)
  const cfgFile      = wsInfo?.cfgPath  ? nodePath.basename(wsInfo.cfgPath)  : null;
  const treDirBase   = wsInfo?.treDir   ? nodePath.basename(wsInfo.treDir)   : null;
  const pattern      = wsInfo?.pattern  ?? null;
  const mSP          = detectedLayout?.maxSearchPriority ?? null;
  const serverConfig = wsInfo?.serverConfig ?? null;

  return (
    <div
      style={{
        display:      'flex',
        flexDirection:'column',
        background:   'var(--color-header)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink:   0,
      }}
    >
    {/* ── Main button row ──────────────────────────────────────────────── */}
    <div
      style={{
        display:     'flex',
        alignItems:  'center',
        height:      'var(--tabstrip-h)',
        paddingLeft: 'var(--space-4)',
        paddingRight:'var(--space-4)',
        gap:         'var(--space-2)',
      }}
    >
      {/* ── ＋ Project ▾ split-button ────────────────────────────────── */}
      <div ref={menuRef} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        {/* Primary: ＋ Project → New wizard */}
        <button
          style={primaryBtnStyle(false)}
          onClick={handleNewProject}
          aria-label="New project"
          title="Create a new project"
        >
          ＋ Project
        </button>

        {/* Dropdown toggle: ▾ */}
        <button
          style={dropdownToggleStyle}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Project actions menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Project actions"
        >
          ▾
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div
            role="menu"
            style={{
              position:     'absolute',
              top:          'calc(100% + 2px)',
              left:         0,
              minWidth:     140,
              background:   'var(--color-surface)',
              border:       '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              boxShadow:    '0 4px 12px rgba(0,0,0,0.4)',
              zIndex:       2000,
              padding:      'var(--space-1) 0',
            }}
          >
            <div
              role="menuitem"
              tabIndex={0}
              style={menuItemStyle(false)}
              onClick={handleNewProject}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNewProject(); }}
            >
              New
            </div>
            <div
              role="menuitem"
              tabIndex={0}
              style={menuItemStyle(false)}
              onClick={() => void handleOpen()}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleOpen(); }}
            >
              Open…
            </div>
            <div
              role="menuitem"
              aria-disabled="true"
              style={menuItemStyle(true)}
              title="No recent projects"
            >
              Open Recent
            </div>
          </div>
        )}
      </div>

      {/* ── Mount Archive… (secondary) ────────────────────────────────── */}
      <button
        style={secondaryBtnStyle}
        onClick={onMount}
        aria-label="Mount archive"
        title="Mount a .tre archive file"
      >
        Mount Archive…
      </button>

      {/* ── Archive count chip ────────────────────────────────────────── */}
      {archiveCount > 0 && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   'var(--text-xs)',
            color:      'var(--color-text-faint)',
          }}
        >
          {archiveCount} archive{archiveCount !== 1 ? 's' : ''}
        </span>
      )}

      {/* ── Spacer ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1 }} />

      {/* ── Bound-client chip (007-A, glyph + mono text) ─────────────── */}
      {/* Accessibility Rule 1: glyph ⛁ + text + mono color — never color-only */}
      {clientPath && clientName && (
        <span
          title={clientPath}
          style={{
            fontFamily:   'var(--font-mono)',
            fontSize:     'var(--text-xs)',
            color:        'var(--color-text-muted)',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
            maxWidth:     220,
          }}
        >
          ⛁ {clientName}{treVersion ? ` · EERT${treVersion}` : ''}
        </span>
      )}

      {/* ── Inline error feedback ─────────────────────────────────────── */}
      {error && (
        <span
          role="alert"
          style={{
            fontSize:   'var(--text-xs)',
            color:      'var(--color-danger, #f87171)',
            flexShrink: 0,
            maxWidth:   200,
            overflow:   'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={error}
        >
          ✕ {error}
        </span>
      )}
    </div>{/* end main button row */}

    {/* ── D-13: Binding-details sub-row (M4: canonical layout home) ─────── */}
    {/* Shown when a client is bound — pattern, cfg, TRE dir, mSP, serverConfig. */}
    {/* Accessibility Rule 1: all status conveyed by text labels (no color-only). */}
    {clientPath && (cfgFile || pattern || serverConfig) && (
      <div
        style={{
          display:     'flex',
          alignItems:  'center',
          flexWrap:    'wrap',
          gap:         'var(--space-3)',
          paddingLeft: 'var(--space-4)',
          paddingRight:'var(--space-4)',
          paddingBottom:'var(--space-1)',
          fontFamily:  'var(--font-mono)',
          fontSize:    'var(--text-xs)',
          color:       'var(--color-text-muted)',
          borderTop:   '1px solid var(--color-border)',
        }}
      >
        {/* Release pattern */}
        {pattern && (
          <span title="Matched release pattern">
            pattern: <span style={{ color: 'var(--color-text)' }}>{pattern}</span>
          </span>
        )}

        {/* cfg filename */}
        {cfgFile && (
          <span title={wsInfo?.cfgPath}>
            cfg: <span style={{ color: 'var(--color-text)' }}>{cfgFile}</span>
          </span>
        )}

        {/* TRE directory */}
        {treDirBase !== null && (
          <span title={wsInfo?.treDir}>
            TREs: <span style={{ color: 'var(--color-text)' }}>
              {treDirBase === nodePath.basename(clientPath ?? '') || treDirBase === ''
                ? '(install root)'
                : `${treDirBase}/`}
            </span>
          </span>
        )}

        {/* maxSearchPriority (from KNOWN_LAYOUTS, not persisted in workspace.json) */}
        {mSP !== null && (
          <span title="maxSearchPriority from release pattern">
            mSP: <span style={{ color: 'var(--color-text)' }}>{mSP}</span>
          </span>
        )}

        {/* Local-server capture (D-01 — capture-only in Phase 4.1) */}
        {serverConfig && (
          <span title={`Server path: ${serverConfig.path}`}>
            server: <span style={{ color: 'var(--color-text)' }}>
              {serverConfig.type} @ {serverConfig.hostPort}
            </span>
          </span>
        )}
      </div>
    )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function menuItemStyle(disabled: boolean): React.CSSProperties {
  return {
    padding:    'var(--space-1) var(--space-4)',
    fontSize:   'var(--text-sm)',
    color:      disabled ? 'var(--color-text-faint)' : 'var(--color-text)',
    cursor:     disabled ? 'default' : 'pointer',
    opacity:    disabled ? 0.5 : 1,
    userSelect: 'none',
    fontFamily: 'var(--font-sans)',
    lineHeight: '24px',
    background: 'transparent',
    transition: 'background 0.08s ease',
  };
}
