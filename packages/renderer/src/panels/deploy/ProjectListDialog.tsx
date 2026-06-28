/**
 * packages/renderer/src/panels/deploy/ProjectListDialog.tsx
 * In-app "Open Project" dialog (slice 3) — replaces the OS folder picker.
 *
 * Lists every project in the app store (services/projectList) as cards in the same
 * format as the Welcome screen's Recent projects. Since projects always live under the
 * app store (the user can't set the path), a curated list is tighter than a folder
 * browse. Rendered once at the app root; opened via openProjectStore.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOpenProjectStore } from '../../state/openProjectStore';
import { listProjects, type ProjectListEntry } from '../../services/projectList';
import { getRecentProjects } from '../../services/recentProjects';
import { openWorkspace } from '../../services/workspaceService';

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

export default function ProjectListDialog(): React.ReactElement | null {
  const isOpen = useOpenProjectStore((s) => s.isOpen);
  const close  = useOpenProjectStore((s) => s.close);

  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [error, setError]       = useState<string | null>(null);

  // Map projectFolder → last-opened ISO (from recents) for the "ago" label.
  const agoByFolder = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of getRecentProjects()) m.set(r.folderPath, r.lastOpenedISO);
    return m;
  }, [isOpen]);

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

  const handleOpen = useCallback(async (folder: string) => {
    setError(null);
    try {
      await openWorkspace(folder);
      close();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, [close]);

  if (!isOpen) return null;

  return (
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

          {projects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-2)', color: 'var(--color-text-muted)' }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>No projects yet</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: 'var(--space-1)' }}>
                Create one with ＋ Project on the Welcome screen.
              </div>
            </div>
          ) : (
            projects.map((p) => {
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
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
