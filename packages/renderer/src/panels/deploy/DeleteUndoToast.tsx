/**
 * packages/renderer/src/panels/deploy/DeleteUndoToast.tsx
 * Global 8s auto-dismiss undo toast — sketch 017 (Variant B) element #14, plus the round-2
 * post-restore confirmation toast (element #17b).
 *
 * Subscribes to `useDeleteUndoStore((s) => s.pending)` and diffs it against the previous
 * render's array on every change:
 *   - a NEW entry appended  → show the "deleted" toast for it (🗑, or ⚠ when the entry's
 *     restoreErrors is non-empty — this generically covers 04.4-01's server-push-orphan
 *     warning too, no separate variant needed).
 *   - an entry REMOVED      → it was restored (via THIS toast's own Undo button, OR via
 *     ProjectListDialog's dimmed-row Restore button — either path empties the SAME store) →
 *     show the post-restore "restored" toast (element #17b).
 *
 * Mounted once in App.tsx as a global sibling alongside <ProjectListDialog />.
 *
 * Locked undo contract (identical wording in 04.4-01/10/14): the "restored" toast copy below
 * NEVER includes a "deploy re-applied to client" clause — undo restores project bytes only.
 *
 * Source: 04.4-10-PLAN.md Task 3; .planning/sketches/017-delete-project-flow/index.html
 * (#toast, .toast-bar, showToast()/restoreProject() — elements #14/#17b).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useDeleteUndoStore, type TrashEntry } from '../../state/deleteUndoStore';
import { readManifest } from '../../services/changesetService';
import { log } from '../../services/logService';

const TOAST_MS = 8000;

type ToastState =
  | { kind: 'none' }
  | { kind: 'delete'; entry: TrashEntry; undoError?: string; generation: number }
  | { kind: 'restored'; projectName: string; versionCount: number | null; generation: number };

let generationCounter = 0;

/** Best-effort changeset count at studioDir — never throws. */
function safeChangesetCount(studioDir: string): number | null {
  try {
    return readManifest(studioDir).changesets.length;
  } catch {
    return null;
  }
}

export default function DeleteUndoToast(): React.ReactElement | null {
  const pending = useDeleteUndoStore((s) => s.pending);
  const [toast, setToast] = useState<ToastState>({ kind: 'none' });
  const prevRef = useRef<TrashEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const armTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => setToast({ kind: 'none' }), TOAST_MS);
  }, [clearTimer]);

  // Diff pending against the previous render's snapshot — detects both new deletes (append)
  // and restores (removal), regardless of which UI surface triggered the restore.
  useEffect(() => {
    const prev = prevRef.current;
    const prevIds = new Set(prev.map((e) => e.id));
    const currIds = new Set(pending.map((e) => e.id));

    const removed = prev.filter((e) => !currIds.has(e.id));
    const added = pending.filter((e) => !prevIds.has(e.id));

    if (removed.length > 0) {
      // Round-2 element #17b: EVERY restore (Undo-from-toast or Restore-from-dimmed-row)
      // fires this second toast. Locked undo contract: copy never mentions a re-deploy.
      const entry = removed[removed.length - 1];
      const versionCount = safeChangesetCount(entry.originalStudioDir);
      generationCounter += 1;
      setToast({ kind: 'restored', projectName: entry.projectName, versionCount, generation: generationCounter });
      armTimer();
    } else if (added.length > 0) {
      const entry = added[added.length - 1];
      generationCounter += 1;
      setToast({ kind: 'delete', entry, generation: generationCounter });
      armTimer();
    }

    prevRef.current = pending;
  }, [pending, armTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const handleUndo = useCallback((entry: TrashEntry) => {
    try {
      useDeleteUndoStore.getState().restore(entry.id);
      log('info', 'log', `Undo restored project ${entry.projectName}`);
      // Success — the pending-diff effect above detects the removal and shows the
      // post-restore toast; nothing else to do here.
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      log('warn', 'log', `Undo failed for ${entry.projectName}: ${message}`);
      // Round-2: keep the toast visible on failure — swap its content to show the error
      // rather than dismissing; the entry stays in `pending` for a retry.
      generationCounter += 1;
      setToast({ kind: 'delete', entry, undoError: message, generation: generationCounter });
      armTimer();
    }
  }, [armTimer]);

  const handleClose = useCallback(() => {
    clearTimer();
    setToast({ kind: 'none' });
  }, [clearTimer]);

  if (toast.kind === 'none') return null;

  if (toast.kind === 'restored') {
    return (
      <div data-testid="delete-undo-toast" role="status" style={toastStyle}>
        <div style={toastRowStyle}>
          <span aria-hidden="true" style={{ fontSize: 14 }}>🗑</span>
          <span style={toastMsgStyle}>
            <Bold>{toast.projectName}</Bold> restored
            <span style={toastSubStyle}>
              {toast.versionCount !== null
                ? `all ${toast.versionCount} versions back, byte-for-byte`
                : 'byte-for-byte'}
            </span>
          </span>
          <button aria-label="Dismiss" onClick={handleClose} style={toastXStyle}>✕</button>
        </div>
        <div key={toast.generation} style={toastBarStyle} />
        <style>{TOAST_BAR_KEYFRAMES}</style>
      </div>
    );
  }

  const { entry, undoError } = toast;
  const isWarn = Boolean(undoError) || entry.restoreErrors.length > 0;
  const subMessage = undoError ?? (entry.restoreErrors.length > 0 ? entry.restoreErrors[0] : null);
  const versionCount = safeChangesetCount(entry.trashStudioPath);

  return (
    <div data-testid="delete-undo-toast" role="status" style={toastStyle}>
      <div style={toastRowStyle}>
        <span aria-hidden="true" style={{ fontSize: 14 }}>{isWarn ? '⚠' : '🗑'}</span>
        <span style={toastMsgStyle}>
          <Bold>{entry.projectName}</Bold> deleted
          <span style={{ ...toastSubStyle, ...(isWarn ? { color: 'var(--color-warn)' } : {}) }}>
            {subMessage ?? (
              versionCount !== null
                ? `${versionCount} versions parked · undo until app close`
                : 'undo until app close'
            )}
          </span>
        </span>
        <button aria-label="Undo delete" onClick={() => handleUndo(entry)} style={toastUndoStyle}>Undo</button>
        <button aria-label="Dismiss" onClick={handleClose} style={toastXStyle}>✕</button>
      </div>
      <div key={toast.generation} style={toastBarStyle} />
      <style>{TOAST_BAR_KEYFRAMES}</style>
    </div>
  );
}

// ─── Bold ───────────────────────────────────────────────────────────────────────

function Bold({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={{ fontWeight: 700 }}>{children}</span>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const toastStyle: React.CSSProperties = {
  position: 'fixed', right: 16, bottom: 40, zIndex: 9500,
  minWidth: 300, maxWidth: 380,
  background: 'var(--color-header)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  overflow: 'hidden', fontFamily: 'var(--font-sans)',
};

const toastRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
};

const toastMsgStyle: React.CSSProperties = {
  flex: 1, fontSize: 'var(--text-sm)', color: 'var(--color-text)',
};

const toastSubStyle: React.CSSProperties = {
  display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: 2,
};

const toastUndoStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--color-accent)', color: 'var(--color-accent)',
  borderRadius: 'var(--radius-sm)', fontWeight: 700, fontSize: 'var(--text-xs)',
  padding: '5px 10px', cursor: 'pointer',
};

const toastXStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--color-text-faint)',
  cursor: 'pointer', fontSize: 13, padding: 2,
};

const toastBarStyle: React.CSSProperties = {
  height: 2, background: 'var(--color-accent)', width: '100%', transformOrigin: 'left',
  animation: `swg-toast-shrink ${TOAST_MS}ms linear forwards`,
};

const TOAST_BAR_KEYFRAMES = `
  @keyframes swg-toast-shrink {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }
`;
