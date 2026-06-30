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
import { useOpenProjectStore } from '../../state/openProjectStore';
import { resolveLayout } from '../../services/clientLayout';
import { getRecentProjects, type RecentProject } from '../../services/recentProjects';
import { openWorkspace } from '../../services/workspaceService';

// Path B: require() for Node modules (nodeIntegration:true)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require('path') as typeof import('path');

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
  const clientPath      = useWorkspaceStore((s) => s.clientPath);
  const workspaceName   = useWorkspaceStore((s) => s.workspaceName);
  const wsInfo          = useWorkspaceStore((s) => s.status.kind === 'ready' ? s.status.info : null);
  const archives        = useTreStore((s) => s.archives);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentProject[]>([]);
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

  // P3: load recent projects once on mount (powers the live Open Recent links).
  useEffect(() => {
    try { setRecents(getRecentProjects()); } catch { /* ignore — recent list is non-critical */ }
  }, []);

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

  // Open… — show the in-app project list dialog (replaces the OS folder picker).
  const handleOpen = useCallback(() => {
    setMenuOpen(false);
    useOpenProjectStore.getState().open();
  }, []);

  const handleNewProject = useCallback(() => {
    setMenuOpen(false);
    onNewProject();
  }, [onNewProject]);

  // P3: open a recent project by folder path.
  const handleOpenRecent = useCallback(async (folderPath: string) => {
    setMenuOpen(false);
    setError(null);
    try {
      await openWorkspace(folderPath);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, []);

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
            {/* P3: Open Recent — live links when recents exist; disabled label when empty */}
            {recents.length > 0 ? (
              <>
                <div
                  style={{
                    padding:       'var(--space-1) var(--space-4)',
                    fontSize:      'var(--text-xs)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color:         'var(--color-text-faint)',
                    userSelect:    'none',
                  }}
                >
                  Open Recent
                </div>
                {recents.map((r) => (
                  <div
                    key={r.folderPath}
                    role="menuitem"
                    tabIndex={0}
                    style={menuItemStyle(false)}
                    onClick={() => void handleOpenRecent(r.folderPath)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleOpenRecent(r.folderPath); }}
                    title={r.folderPath}
                  >
                    {r.name}
                  </div>
                ))}
              </>
            ) : (
              <div
                role="menuitem"
                aria-disabled="true"
                style={menuItemStyle(true)}
                title="No recent projects"
              >
                Open Recent
              </div>
            )}
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

      {/* Chip area is now rendered in the proj-bar below (P1+P2). */}

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

    {/* ── P1 + P2: proj-bar (sketch 007-A) — shown when a project is bound ──── */}
    {/* P1: project name "◆ projectName"; P2: pill chip "⛁ client · EERTver"   */}
    {/* Accessibility Rule 1: glyph + text + bg + border — never color-only.    */}
    {clientPath && clientName && (
      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            'var(--space-2)',
          padding:        '5px var(--space-4)',
          background:     'var(--color-surface-2)',
          borderBottom:   '1px solid var(--color-border-soft)',
          flexShrink:     0,
        }}
      >
        {/* P1: project name */}
        <div
          style={{
            fontWeight:  600,
            fontSize:    'var(--text-sm)',
            display:     'flex',
            alignItems:  'center',
            gap:         6,
            color:       'var(--color-text)',
            overflow:    'hidden',
            textOverflow:'ellipsis',
            whiteSpace:  'nowrap',
            flex:        1,
            minWidth:    0,
          }}
        >
          <span style={{ color: 'var(--color-accent)' }}>◆</span>
          {wsInfo?.projectName ?? workspaceName ?? '—'}
        </div>

        {/* P2: pill chip — accent-dim bg + accent-line border + radius-full */}
        <span
          title={clientPath}
          style={{
            display:      'inline-flex',
            alignItems:   'center',
            gap:          5,
            padding:      '2px 8px',
            fontSize:     'var(--text-xs)',
            fontFamily:   'var(--font-mono)',
            background:   'var(--color-accent-dim, rgba(46,160,160,.12))',
            border:       '1px solid var(--color-accent-line)',
            borderRadius: 'var(--radius-full, 999px)',
            color:        'var(--color-text)',
            whiteSpace:   'nowrap',
            flexShrink:   0,
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>⛁</span>
          {clientName}
          {treVersion && (
            <span style={{ color: 'var(--color-text-muted)' }}>· EERT{treVersion}</span>
          )}
        </span>
      </div>
    )}

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

        {/* TRE directory. For treDirFromCfg clients (decoupled dev clients like swg-client-v2)
            the .tre data is NOT under the install root — it is resolved from the cfg's
            searchTOC/searchPath at mount time, so the "(install root)" label is misleading. */}
        {treDirBase !== null && (
          <span
            title={
              detectedLayout?.treDirFromCfg
                ? `TRE data resolved from ${cfgFile ?? 'cfg'} (searchTOC/searchPath)`
                : wsInfo?.treDir
            }
          >
            TREs: <span style={{ color: 'var(--color-text)' }}>
              {detectedLayout?.treDirFromCfg
                ? `from ${cfgFile ?? 'cfg'}`
                : (treDirBase === nodePath.basename(clientPath ?? '') || treDirBase === '')
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
