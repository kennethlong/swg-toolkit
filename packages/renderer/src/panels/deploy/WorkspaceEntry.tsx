/**
 * packages/renderer/src/panels/deploy/WorkspaceEntry.tsx
 * First-run Welcome takeover — shown in the Assets panel body when no project is open.
 *
 * Matches Sketch 007 variant B (`.planning/sketches/007-project-entry/index.html` lines
 * 574–671): hero "Open a project", a Recent-projects list, an auto-scanned Detected-clients
 * list (✓ ready pills — glyph + border + label, never colour alone), and an action row
 * (＋ New Project · Open Project… · Mount loose archive…). The sketch is the source of truth.
 *
 * Source: 04.1-04-PLAN.md Task 3; 04.1-11 UAT (full-fidelity 007-B); 04.1-UI-SPEC.md §Surface 2 §007-B.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { openWorkspace, getDefaultProjectFolder, getStudioDir } from '../../services/workspaceService';
import { useOpenProjectStore } from '../../state/openProjectStore';
import { useDeleteUndoStore } from '../../state/deleteUndoStore';
import * as projectBinding from '../../services/projectBinding';
import { detectClients, getKnownClientPaths, type KnownClientPath } from '../../services/clientLocator';
import { setClientScanMessage } from '../../state/clientScanStore';
import { listProjects } from '../../services/projectList';
import { getRecentProjects, pruneRecentProjects, type RecentProject } from '../../services/recentProjects';
import { deleteProject } from '../../services/deleteProject';
import { log } from '../../services/logService';
import DeleteProjectConfirmModal from './DeleteProjectConfirmModal';
import type { DetectedClient } from '@swg/contracts';
import AsyncProgress from '../../shared/AsyncProgress';

// Path B fs/path — used to self-heal recents and to compare bound client install paths.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require('path') as typeof import('path');

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WorkspaceEntryProps {
  /** Called when user clicks "New Project" — opens the wizard in the parent. */
  onNewProject?: () => void;
  /** Called when user clicks "Mount loose archive…" — runs the parent's mount flow. */
  onMount?: () => void;
}

// ─── Relative-time helper ───────────────────────────────────────────────────────

/** Compact "x ago" string for a recent project's last-opened time. */
function formatAgo(iso: string): string {
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return 'last week';
    if (weeks < 5) return `${weeks} weeks ago`;
    const months = Math.floor(days / 30);
    return months <= 1 ? 'last month' : `${months} months ago`;
  } catch {
    return '';
  }
}

/**
 * Which curated popular distros (getKnownClientPaths) were NOT turned up by detection.
 * Matched by normalized name (lowercased, non-alphanumerics stripped) with substring
 * tolerance so a detected "SWGLegends" satisfies the curated "SWG Legends" — detection
 * is content-based, so names come from folder structure and won't match char-for-char.
 */
function computeMissingKnown(detected: DetectedClient[]): KnownClientPath[] {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const detectedNorm = detected.map((c) => norm(c.name));
  return getKnownClientPaths().filter((k) => {
    const kn = norm(k.name);
    return !detectedNorm.some((dn) => dn === kn || dn.includes(kn));
  });
}

// ─── Styles (mirror sketch 007 `.welcome` block) ────────────────────────────────

const secTitleStyle: React.CSSProperties = {
  fontSize:      'var(--text-xs)',
  fontWeight:    600,
  color:         'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom:  'var(--space-2)',
  paddingBottom: 'var(--space-1)',
  borderBottom:  '1px solid var(--color-border)',
};

const rowStyle: React.CSSProperties = {
  display:      'flex',
  alignItems:   'center',
  gap:          'var(--space-3)',
  padding:      'var(--space-2) var(--space-3)',
  border:       '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 'var(--space-2)',
  cursor:       'pointer',
  background:   'var(--color-surface-2)',
  transition:   'border-color 0.12s ease',
  position:     'relative', // anchors an optional kebab menu (04.4-10)
};

// ─── Kebab menu styles (sketch 017 Variant B, elements #1/#2/#17) ──────────────

const kebabBtnStyle: React.CSSProperties = {
  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: '1px solid transparent', borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-faint)', fontSize: 15, cursor: 'pointer',
};

const kebabMenuStyle: React.CSSProperties = {
  position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 60,
  minWidth: 170, padding: 4,
  background: 'var(--color-header)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
};

const kebabItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
  fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
  color: 'var(--color-text)',
};

const kebabDangerItemStyle: React.CSSProperties = {
  ...kebabItemStyle,
  color: 'var(--color-danger)',
};

const kebabSepStyle: React.CSSProperties = {
  height: 1, margin: '4px 6px', background: 'var(--color-border)',
};

const pillBase: React.CSSProperties = {
  display:      'inline-flex',
  alignItems:   'center',
  gap:          4,
  padding:      '1px 7px',
  fontSize:     'var(--text-xs)',
  borderRadius: 'var(--radius-full, 999px)',
  whiteSpace:   'nowrap',
  flex:         '0 0 auto',
  fontFamily:   'var(--font-mono)',
};

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    background:   primary ? 'var(--color-accent)' : 'transparent',
    color:        primary ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
    border:       primary ? 'none' : '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding:      '7px 14px',
    fontFamily:   'var(--font-sans)',
    fontSize:     'var(--text-sm)',
    fontWeight:   primary ? 600 : 400,
    cursor:       'pointer',
    transition:   'opacity 0.1s ease',
  };
}

function Row({
  ico, name, sub, pill, ago, onClick, title, disabled, actions,
}: {
  ico: string; name: string; sub: string;
  pill?: React.ReactNode; ago?: string; actions?: React.ReactNode;
  onClick?: () => void; title?: string; disabled?: boolean;
}): React.ReactElement {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      title={title}
      style={{ ...rowStyle, ...(disabled ? { opacity: 0.55, cursor: 'not-allowed' } : {}) }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-line)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'; }}
    >
      <span aria-hidden="true" style={{ fontSize: 16, flex: '0 0 auto', color: 'var(--color-text-muted)' }}>{ico}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
      </div>
      {pill}
      {ago && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', flex: '0 0 auto' }}>{ago}</span>}
      {actions}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorkspaceEntry({ onNewProject, onMount }: WorkspaceEntryProps = {}): React.ReactElement {
  const status = useWorkspaceStore((s) => s.status);
  const [detectedClients, setDetectedClients] = useState<DetectedClient[]>([]);
  const [missingClients, setMissingClients] = useState<KnownClientPath[]>([]);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Sketch 017 (Variant B) delete flow — kebab menu + confirm modal state (04.4-10).
  const [openKebabId, setOpenKebabId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ folder: string; name: string } | null>(null);
  const pending = useDeleteUndoStore((s) => s.pending);

  // Round-2 fix: a just-deleted recent disappears from the list REACTIVELY (no remount
  // required) — filtered by matching a pending trash entry's originalFolderPath, which is
  // always current (updated synchronously by deleteProject/restore), rather than depending on
  // a manually-remembered re-fetch at each mutation call site.
  const pendingFolders = useMemo(
    () => new Set(pending.map((e) => e.originalFolderPath)),
    [pending],
  );
  const recentsToShow = useMemo(
    () => recents.filter((r) => !pendingFolders.has(r.folderPath)),
    [recents, pendingFolders],
  );

  // Round-2 element #17: global kebab dismiss — click anywhere outside an open kebab menu, or
  // Escape, closes it (mirrors the same effect in ProjectListDialog.tsx).
  useEffect(() => {
    if (!openKebabId) return;
    const closeAll = () => setOpenKebabId(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenKebabId(null); };
    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', closeAll);
      document.removeEventListener('keydown', onKey);
    };
  }, [openKebabId]);

  // Auto-scan detected clients + load recents on mount.
  useEffect(() => {
    let detected: ReturnType<typeof detectClients> = [];
    try {
      // Exclude installs already bound to a project — once you open a project against a
      // detected client it should no longer appear in the auto-scan list as bindable.
      const boundPaths = new Set(
        listProjects()
          .filter((p) => p.kind === 'client' && p.clientPath)
          .map((p) => nodePath.resolve(p.clientPath!).toLowerCase()),
      );
      detected = detectClients().filter(
        (c) => !boundPaths.has(nodePath.resolve(c.installPath).toLowerCase()),
      );
      setDetectedClients(detected);
    } catch (err) { console.error('[WorkspaceEntry] detectClients error:', err); }

    // P4: compute not-found rows — curated popular distros not turned up by the
    // content scan. Matched by NAME (detection is content-based now, so a fixed path
    // list would falsely flag installs living in renamed folders).
    try {
      const missing = computeMissingKnown(detected);
      setMissingClients(missing);

      // P9: write first-run scan message to clientScanStore (plan 09 statusbar reads it).
      // Format: "detected: SWG Infinity ✓ · SWGEmu ✗"
      const foundParts   = detected.map((c) => `${c.name} ✓`);
      const missingParts = missing.map((k) => `${k.name} ✗`);
      const all = [...foundParts, ...missingParts];
      if (all.length > 0) {
        setClientScanMessage(`detected: ${all.join(' · ')}`);
      }
    } catch (err) { console.error('[WorkspaceEntry] missing-clients / scan-message error:', err); }

    // Self-heal: drop recents whose project studio no longer exists (e.g. after cleanup).
    try {
      setRecents(pruneRecentProjects((r) => nodeFs.existsSync(getStudioDir(r.folderPath))));
    } catch {
      setRecents(getRecentProjects());
    }
  }, []);

  // Open… — show the in-app project list dialog (replaces the OS folder picker).
  const handleOpen = useCallback(() => {
    useOpenProjectStore.getState().open();
  }, []);

  // Re-open a recent project.
  const handleOpenRecent = useCallback(async (folderPath: string) => {
    setClientError(null);
    try {
      await openWorkspace(folderPath);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      setClientError(msg);
      console.error('[WorkspaceEntry] openWorkspace(recent) error:', err);
    }
  }, []);

  // Sketch 017 (Variant B) kebab actions — "Reveal studio folder" / "Delete project…".
  const handleReveal = useCallback((folderPath: string) => {
    setOpenKebabId(null);
    try {
      // Path B renderer: nodeIntegration:true — electron's shell module usable directly.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shell } = require('electron') as typeof import('electron');
      void shell.openPath(getStudioDir(folderPath));
    } catch (err) {
      console.error('[WorkspaceEntry] Reveal studio folder failed:', err);
    }
  }, []);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!confirmTarget) return;
    const target = confirmTarget;
    try {
      const { restoreErrors } = await deleteProject(target.folder);
      log(restoreErrors.length > 0 ? 'warn' : 'info', 'log', `Deleted project ${target.name}`);
    } finally {
      setConfirmTarget(null);
    }
  }, [confirmTarget]);

  // Click a detected client → quick-create a project named after the client, targeting
  // that install (decouple: the client is the target, not the project identity).
  const handleOpenClient = useCallback(async (client: DetectedClient) => {
    setClientError(null);
    try {
      await projectBinding.initProject(getDefaultProjectFolder(client.name), {
        projectName: client.name,
        targetPath:  client.installPath,
        overrideKind: 'client',
      });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      setClientError(msg);
      console.error('[WorkspaceEntry] initProject(client) error:', err);
    }
  }, []);

  // New — delegate to the wizard.
  const handleNew = useCallback(() => { onNewProject?.(); }, [onNewProject]);

  // "Scan all drives" — exhaustive content scan (opt-in). Deferred via setTimeout so the
  // "Scanning…" state paints before the synchronous fs walk blocks the thread.
  const handleScanAll = useCallback(() => {
    setScanning(true);
    setClientError(null);
    setTimeout(() => {
      try {
        const boundPaths = new Set(
          listProjects()
            .filter((p) => p.kind === 'client' && p.clientPath)
            .map((p) => nodePath.resolve(p.clientPath!).toLowerCase()),
        );
        const deep = detectClients({ deep: true }).filter(
          (c) => !boundPaths.has(nodePath.resolve(c.installPath).toLowerCase()),
        );
        setDetectedClients(deep);
        setMissingClients(computeMissingKnown(deep));
        const parts = [...deep.map((c) => `${c.name} ✓`)];
        if (parts.length > 0) setClientScanMessage(`scanned all drives: ${parts.join(' · ')}`);
      } catch (err) {
        setClientError(String((err as Error)?.message ?? err));
        console.error('[WorkspaceEntry] scan-all-drives error:', err);
      } finally {
        setScanning(false);
      }
    }, 0);
  }, []);

  // Show progress while a workspace is opening / being scaffolded.
  if (status.kind === 'opening') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
        <AsyncProgress caption="Setting up workspace…" />
      </div>
    );
  }

  return (
    <>
    <div
      style={{
        flex:          1,
        minHeight:     0,
        overflow:      'auto',
        display:       'flex',
        flexDirection: 'column',
        gap:           'var(--space-6)',
        padding:       'var(--space-6) var(--space-4)',
        fontFamily:    'var(--font-sans)',
      }}
    >
      {/* Hero — sketch 007-B copy */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>Open a project</h1>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
          A project binds to one client install for deploy. Seed its assets from the client&apos;s TRE set,
          or start empty and mount loose archives.
        </p>
      </div>

      {/* Error feedback */}
      {(status.kind === 'error' || clientError) && (
        <span role="alert" style={{ maxWidth: 420, color: 'var(--color-danger, #f87171)', fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap' }}>
          {status.kind === 'error' ? status.reason : clientError}
        </span>
      )}

      {/* Recent projects */}
      {recentsToShow.length > 0 && (
        <div>
          <div style={secTitleStyle}>Recent projects</div>
          {recentsToShow.map((r) => (
            <Row
              key={r.folderPath}
              ico="◆"
              name={r.name}
              sub={r.kind === 'client' ? `bound · ${r.clientName ?? 'client'}` : r.kind}
              title={r.folderPath}
              onClick={() => void handleOpenRecent(r.folderPath)}
              ago={formatAgo(r.lastOpenedISO)}
              pill={r.kind === 'client' ? (
                <span style={{ ...pillBase, background: 'rgba(74,140,255,.12)', border: '1px solid rgba(74,140,255,.40)', color: 'var(--color-info, #4a8cff)' }}>
                  <span aria-hidden="true">⛁</span>bound
                </span>
              ) : undefined}
              actions={(
                <div style={{ position: 'relative', flex: '0 0 auto' }}>
                  <button
                    aria-label={`Project actions for ${r.name}`}
                    title="Project actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenKebabId((cur) => (cur === r.folderPath ? null : r.folderPath));
                    }}
                    style={kebabBtnStyle}
                  >
                    ⋯
                  </button>
                  {openKebabId === r.folderPath && (
                    <div role="menu" style={kebabMenuStyle} onClick={(e) => e.stopPropagation()}>
                      <div
                        role="menuitem"
                        style={kebabItemStyle}
                        onClick={() => { setOpenKebabId(null); void handleOpenRecent(r.folderPath); }}
                      >
                        ▸ Open
                      </div>
                      <div
                        role="menuitem"
                        style={kebabItemStyle}
                        onClick={() => handleReveal(r.folderPath)}
                      >
                        ⛁ Reveal studio folder
                      </div>
                      <div style={kebabSepStyle} />
                      <div
                        role="menuitem"
                        style={kebabDangerItemStyle}
                        onClick={() => {
                          setOpenKebabId(null);
                          setConfirmTarget({ folder: r.folderPath, name: r.name });
                        }}
                      >
                        🗑 Delete project…
                      </div>
                    </div>
                  )}
                </div>
              )}
            />
          ))}
        </div>
      )}

      {/* Detected clients · auto-scan (P4: shows found + not-found rows) */}
      {(detectedClients.length > 0 || missingClients.length > 0) && (
        <div>
          <div style={secTitleStyle}>
            Detected clients{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--color-text-faint)' }}>· auto-scan</span>
          </div>
          {/* Found clients — clickable (open or bind) */}
          {detectedClients.map((client) => (
            <Row
              key={client.installPath}
              ico="⛁"
              name={client.name}
              sub={client.installPath}
              title={client.installPath}
              onClick={() => void handleOpenClient(client)}
              pill={(
                <span style={{ ...pillBase, background: 'var(--color-accent-dim, rgba(46,160,160,.12))', border: '1px solid var(--color-accent-line)', color: 'var(--color-accent)' }}>
                  <span aria-hidden="true">✓</span>ready
                </span>
              )}
            />
          ))}
          {/* P4: Not-found rows — greyed/disabled, Sketch 007-B "✗ not found" pill */}
          {missingClients.map((client) => (
            <Row
              key={client.name}
              ico="⛁"
              name={client.name}
              sub="not found on disk"
              title={`${client.name} — not detected on any drive`}
              disabled
              pill={(
                <span
                  style={{
                    ...pillBase,
                    background: 'rgba(224,88,79,.12)',
                    border:     '1px solid rgba(224,88,79,.40)',
                    color:      'var(--color-danger, #e0584f)',
                  }}
                >
                  <span aria-hidden="true">✗</span>not found
                </span>
              )}
            />
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button style={btnStyle(true)} onClick={handleNew} aria-label="New Project" title="Create a new project">
          <span aria-hidden="true">＋ </span>New Project
        </button>
        <button style={btnStyle(false)} onClick={() => void handleOpen()} aria-label="Open Project" title="Open an existing project folder">
          <span aria-hidden="true">⌂ </span>Open Project…
        </button>
        <button
          style={{ ...btnStyle(false), ...(scanning ? { opacity: 0.6, cursor: 'wait' } : {}) }}
          onClick={handleScanAll}
          disabled={scanning}
          aria-label="Scan all drives"
          title="Exhaustively scan every drive for client installs (finds installs in any folder)"
        >
          <span aria-hidden="true">🔍 </span>{scanning ? 'Scanning…' : 'Scan all drives'}
        </button>
        {onMount && (
          <button style={btnStyle(false)} onClick={onMount} aria-label="Mount loose archive" title="Mount a .tre archive without binding a project">
            <span aria-hidden="true">🗄 </span>Mount loose archive…
          </button>
        )}
      </div>
    </div>

    {confirmTarget && (
      <DeleteProjectConfirmModal
        projectFolder={confirmTarget.folder}
        projectName={confirmTarget.name}
        // WorkspaceEntry only renders when no workspace is open (the Welcome takeover) —
        // a recent project being deleted here can never be the currently-open workspace.
        isCurrentlyOpen={false}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmTarget(null)}
      />
    )}
    </>
  );
}
