/**
 * packages/renderer/src/panels/deploy/ProjectListDialog.tsx
 * In-app "Open Project" dialog (slice 3) — replaces the OS folder picker.
 *
 * Lists every project in the app store (services/projectList) as cards in the same
 * format as the Welcome screen's Recent projects. Since projects always live under the
 * app store (the user can't set the path), a curated list is tighter than a folder
 * browse. Rendered once at the app root; opened via openProjectStore.
 *
 * Sketch 017 (Variant B — delete-project-flow) additions (04.4-10):
 *   - Per-row ⋯ kebab menu (Open · Reveal studio folder · — · Delete project…).
 *   - Reactive `useDeleteUndoStore` subscription: a project whose folderPath matches a
 *     pending trash entry's originalFolderPath renders as a dimmed, dashed, struck-through
 *     recoverable row (element #15) INSTEAD of its normal row — even if the `projects` list
 *     (loaded once per dialog-open) is stale, so a delete reflects immediately without
 *     closing/reopening the dialog (round-2 fix).
 *   - Global kebab dismiss: click-outside or Escape closes any open kebab menu (element #17).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useOpenProjectStore } from '../../state/openProjectStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useDeleteUndoStore, type TrashEntry } from '../../state/deleteUndoStore';
import { listProjects, type ProjectListEntry } from '../../services/projectList';
import { getRecentProjects } from '../../services/recentProjects';
import { openWorkspace, getStudioDir } from '../../services/workspaceService';
import { readManifest } from '../../services/changesetService';
import { deleteProject } from '../../services/deleteProject';
import { log } from '../../services/logService';
import DeleteProjectConfirmModal from './DeleteProjectConfirmModal';

/** Compact "x ago" for a project's last-opened time (from recents). */
function formatAgo(iso: string): string {
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return 'last week';
    if (weeks < 5) return `${weeks} weeks ago`;
    return `${Math.floor(days / 30) || 1} months ago`;
  } catch {
    return '';
  }
}

/** Best-effort changeset count for a parked trash entry's studio copy — never throws. */
function versionCountFor(studioDir: string): number | null {
  try {
    return readManifest(studioDir).changesets.length;
  } catch {
    return null;
  }
}

export default function ProjectListDialog(): React.ReactElement | null {
  const isOpen = useOpenProjectStore((s) => s.isOpen);
  const close  = useOpenProjectStore((s) => s.close);
  const openFolderPath = useWorkspaceStore((s) => s.folderPath);
  const pending = useDeleteUndoStore((s) => s.pending);

  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const [openKebabId, setOpenKebabId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ folder: string; name: string } | null>(null);
  const [restoreErrorByEntryId, setRestoreErrorByEntryId] = useState<Record<string, string>>({});

  // Map projectFolder → last-opened ISO (from recents) for the "ago" label.
  const agoByFolder = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of getRecentProjects()) m.set(r.folderPath, r.lastOpenedISO);
    return m;
  }, [isOpen]);

  // Round-2 fix: derive the DISPLAYED row list from [projects, pending] together — a project
  // whose folderPath matches a pending trash entry's originalFolderPath is excluded from the
  // normal row list (it renders as the dimmed row below instead), even if `projects` (loaded
  // once per dialog-open) hasn't refreshed since the delete.
  const pendingByOriginalFolder = useMemo(() => {
    const m = new Map<string, TrashEntry>();
    for (const e of pending) m.set(e.originalFolderPath, e);
    return m;
  }, [pending]);

  const displayedProjects = useMemo(
    () => projects.filter((p) => !pendingByOriginalFolder.has(p.projectFolder)),
    [projects, pendingByOriginalFolder],
  );

  // Load the project list whenever the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    try { setProjects(listProjects()); } catch { setProjects([]); }
  }, [isOpen]);

  // Esc closes.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  // Round-2 element #17: global kebab dismiss — click anywhere outside an open kebab menu, or
  // Escape, closes it. Menu items themselves stopPropagation + explicitly close, so this only
  // fires for genuine "outside" interactions.
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

  const handleOpen = useCallback(async (folder: string) => {
    setError(null);
    try {
      await openWorkspace(folder);
      close();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, [close]);

  const handleReveal = useCallback((folder: string) => {
    setOpenKebabId(null);
    try {
      // Path B renderer: nodeIntegration:true — electron's shell module usable directly.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shell } = require('electron') as typeof import('electron');
      void shell.openPath(getStudioDir(folder));
    } catch (err) {
      console.error('[ProjectListDialog] Reveal studio folder failed:', err);
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

  const handleRestore = useCallback((entry: TrashEntry) => {
    try {
      useDeleteUndoStore.getState().restore(entry.id);
      setRestoreErrorByEntryId((m) => {
        if (!(entry.id in m)) return m;
        const next = { ...m };
        delete next[entry.id];
        return next;
      });
    } catch (err) {
      setRestoreErrorByEntryId((m) => ({ ...m, [entry.id]: String((err as Error)?.message ?? err) }));
    }
  }, []);

  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Open Project"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 440, maxWidth: '92vw', maxHeight: 'calc(100vh - 120px)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {/* Header */}
          <div style={{
            height: 40, flexShrink: 0, display: 'flex', alignItems: 'center',
            padding: '0 var(--space-4)', background: 'var(--color-header)',
            borderBottom: '1px solid var(--color-border)',
          }}>
            <span style={{ fontSize: 'var(--text-md)', fontWeight: 600, flex: 1, color: 'var(--color-text)' }}>
              Open Project
            </span>
            <button
              onClick={close}
              aria-label="Close"
              style={{
                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', color: 'var(--color-text-faint)',
                cursor: 'pointer', borderRadius: 'var(--radius-sm)', fontSize: 15,
              }}
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)' }}>
            {error && (
              <div role="alert" style={{ marginBottom: 'var(--space-3)', color: 'var(--color-danger, #f87171)', fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap' }}>
                {error}
              </div>
            )}

            {displayedProjects.length === 0 && pending.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-2)', color: 'var(--color-text-muted)' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>No projects yet</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: 'var(--space-1)' }}>
                  Create one with ＋ Project on the Welcome screen.
                </div>
              </div>
            ) : (
              <>
                {displayedProjects.map((p) => {
                  const ago = agoByFolder.get(p.projectFolder);
                  const sub = p.kind === 'client'
                    ? `bound · ${p.clientName ?? 'client'}`
                    : p.kind === 'tre-set' ? 'standalone TRE set' : 'no target';
                  return (
                    <div
                      key={p.projectFolder}
                      onClick={() => void handleOpen(p.projectFolder)}
                      title={p.projectFolder}
                      style={{
                        position: 'relative',
                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                        padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-2)',
                        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-surface-2)', cursor: 'pointer',
                        transition: 'border-color 0.12s ease',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-line)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'; }}
                    >
                      <span aria-hidden="true" style={{ fontSize: 16, flex: '0 0 auto', color: 'var(--color-text-muted)' }}>◆</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.projectName}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
                      </div>
                      {p.kind === 'client' && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px',
                          fontSize: 'var(--text-xs)', borderRadius: 'var(--radius-full, 999px)', whiteSpace: 'nowrap',
                          flex: '0 0 auto', fontFamily: 'var(--font-mono)',
                          background: 'rgba(74,140,255,.12)', border: '1px solid rgba(74,140,255,.40)', color: 'var(--color-info, #4a8cff)',
                        }}>
                          <span aria-hidden="true">⛁</span>bound
                        </span>
                      )}
                      {ago && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', flex: '0 0 auto' }}>{ago}</span>}

                      {/* Sketch 017 element #1/#2 — per-row kebab menu */}
                      <div style={{ position: 'relative', flex: '0 0 auto' }}>
                        <button
                          aria-label={`Project actions for ${p.projectName}`}
                          title="Project actions"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenKebabId((cur) => (cur === p.projectFolder ? null : p.projectFolder));
                          }}
                          style={kebabBtnStyle}
                        >
                          ⋯
                        </button>
                        {openKebabId === p.projectFolder && (
                          <div role="menu" style={kebabMenuStyle} onClick={(e) => e.stopPropagation()}>
                            <div
                              role="menuitem"
                              style={kebabItemStyle}
                              onClick={() => { setOpenKebabId(null); void handleOpen(p.projectFolder); }}
                            >
                              ▸ Open
                            </div>
                            <div
                              role="menuitem"
                              style={kebabItemStyle}
                              onClick={() => handleReveal(p.projectFolder)}
                            >
                              ⛁ Reveal studio folder
                            </div>
                            <div style={kebabSepStyle} />
                            <div
                              role="menuitem"
                              style={kebabDangerItemStyle}
                              onClick={() => {
                                setOpenKebabId(null);
                                setConfirmTarget({ folder: p.projectFolder, name: p.projectName });
                              }}
                            >
                              🗑 Delete project…
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Sketch 017 element #15 — inline dimmed recoverable rows (dialog ONLY). */}
                {pending.map((entry) => (
                  <div key={entry.id} style={dimmedRowStyle}>
                    <span aria-hidden="true" style={{ fontSize: 16, flex: '0 0 auto', color: 'var(--color-text-faint)' }}>◆</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={dimmedNameStyle}>{entry.projectName}</div>
                      <div style={dimmedSubStyle}>
                        deleted just now · {versionCountFor(entry.trashStudioPath) ?? '?'} versions parked
                      </div>
                      {restoreErrorByEntryId[entry.id] && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)', marginTop: 2 }}>
                          Could not restore — {restoreErrorByEntryId[entry.id]}
                        </div>
                      )}
                    </div>
                    <button style={restoreBtnStyle} onClick={() => handleRestore(entry)}>Restore</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {confirmTarget && (
        <DeleteProjectConfirmModal
          projectFolder={confirmTarget.folder}
          projectName={confirmTarget.name}
          isCurrentlyOpen={openFolderPath === confirmTarget.folder}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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

const dimmedRowStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
  padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-2)',
  border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)', opacity: 0.85,
};

const dimmedNameStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-faint)',
  textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const dimmedSubStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const restoreBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--color-accent)', color: 'var(--color-accent)',
  borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: 'var(--text-xs)',
  padding: '4px 9px', cursor: 'pointer', flex: '0 0 auto',
};
