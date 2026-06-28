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

import React, { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { openWorkspace, createWorkspace, getDefaultProjectsDir, getDefaultProjectFolder, getStudioDir } from '../../services/workspaceService';
import * as projectBinding from '../../services/projectBinding';
import { detectClients } from '../../services/clientLocator';
import { getRecentProjects, pruneRecentProjects, type RecentProject } from '../../services/recentProjects';

// Path B fs — used only to self-heal recents (drop entries whose studio dir is gone).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('fs') as typeof import('fs');
import type { DetectedClient, TypedIpcRenderer } from '@swg/contracts';
import AsyncProgress from '../../shared/AsyncProgress';

// ─── IPC bridge ────────────────────────────────────────────────────────────────

// Path B: dialog is main-process only — invoke via IPC channel 'workspace:pick-dir'.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcRenderer } = require('electron') as { ipcRenderer: TypedIpcRenderer };

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
  ico, name, sub, pill, ago, onClick, title, disabled,
}: {
  ico: string; name: string; sub: string;
  pill?: React.ReactNode; ago?: string;
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
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorkspaceEntry({ onNewProject, onMount }: WorkspaceEntryProps = {}): React.ReactElement {
  const status = useWorkspaceStore((s) => s.status);
  const [detectedClients, setDetectedClients] = useState<DetectedClient[]>([]);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);

  // Auto-scan detected clients + load recents on mount.
  useEffect(() => {
    try { setDetectedClients(detectClients()); } catch (err) { console.error('[WorkspaceEntry] detectClients error:', err); }
    // Self-heal: drop recents whose project studio no longer exists (e.g. after cleanup).
    try {
      setRecents(pruneRecentProjects((r) => nodeFs.existsSync(getStudioDir(r.folderPath))));
    } catch {
      setRecents(getRecentProjects());
    }
  }, []);

  // Open… — pick a folder and bind/open it.
  const handleOpen = useCallback(async () => {
    setClientError(null);
    let picked: string | undefined;
    try {
      // Open the picker at the shared project store so existing projects are right there.
      // Reopen the picked PROJECT folder (preserves its target binding) — do not re-bind.
      const paths = await ipcRenderer.invoke('workspace:pick-dir', getDefaultProjectsDir());
      if (paths.length > 0 && paths[0]) {
        picked = paths[0];
        await openWorkspace(picked);
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      console.error('[WorkspaceEntry] initProject error:', err);
      if (picked && /Not a toolkit workspace/.test(msg)) {
        const create = window.confirm(
          `No toolkit workspace was found in:\n\n${picked}\n\nCreate a new mod workspace here?`,
        );
        if (create) {
          try { await createWorkspace(picked); } catch (cerr) { console.error('[WorkspaceEntry] createWorkspace error:', cerr); }
        }
      } else {
        setClientError(msg);
      }
    }
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

  // Show progress while a workspace is opening / being scaffolded.
  if (status.kind === 'opening') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
        <AsyncProgress caption="Setting up workspace…" />
      </div>
    );
  }

  return (
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
      {recents.length > 0 && (
        <div>
          <div style={secTitleStyle}>Recent projects</div>
          {recents.map((r) => (
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
            />
          ))}
        </div>
      )}

      {/* Detected clients · auto-scan */}
      {detectedClients.length > 0 && (
        <div>
          <div style={secTitleStyle}>
            Detected clients{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--color-text-faint)' }}>· auto-scan</span>
          </div>
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
        {onMount && (
          <button style={btnStyle(false)} onClick={onMount} aria-label="Mount loose archive" title="Mount a .tre archive without binding a project">
            <span aria-hidden="true">🗄 </span>Mount loose archive…
          </button>
        )}
      </div>
    </div>
  );
}
