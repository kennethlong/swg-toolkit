/**
 * packages/renderer/src/panels/deploy/SnapshotImportToast.tsx
 * "Auto-detect and confirm" prompt for in-game world edits.
 *
 * Subscribes to useSnapshotImportStore.pending (populated by the snapshot watcher when the
 * in-game editor saves a `.ws` into the override dir). Shows the most recent detection with
 * Import / Dismiss; Import routes through stageSnapshot into the normal stage→seal→deploy
 * flow (it then appears in Working changes). Unlike the delete-undo toast this does NOT
 * auto-dismiss — an unconfirmed edit stays until the user acts (deliberate-staging ethos).
 *
 * Mounted once in App.tsx alongside <DeleteUndoToast />. Mirrors that toast's chrome.
 */

import React, { useCallback } from 'react';

import { useSnapshotImportStore, type PendingSnapshotImport } from '../../state/snapshotImportStore';
import { stageSnapshot } from '../../services/stageSnapshot';
import { log } from '../../services/logService';

export default function SnapshotImportToast(): React.ReactElement | null {
  const pending = useSnapshotImportStore((s) => s.pending);

  const handleImport = useCallback((entry: PendingSnapshotImport) => {
    try {
      stageSnapshot({ wsFilePath: entry.wsFilePath, virtualPath: entry.virtualPath });
      log('info', 'log', `Imported in-game edit ${entry.sceneId}.ws into Working changes`);
    } catch (e) {
      log('warn', 'log', `Import failed for ${entry.sceneId}.ws: ${String((e as Error)?.message ?? e)}`);
    } finally {
      useSnapshotImportStore.getState().remove(entry.wsFilePath);
    }
  }, []);

  const handleDismiss = useCallback((entry: PendingSnapshotImport) => {
    useSnapshotImportStore.getState().remove(entry.wsFilePath);
  }, []);

  if (pending.length === 0) return null;

  const entry = pending[pending.length - 1];
  const more = pending.length - 1;

  return (
    <div data-testid="snapshot-import-toast" role="status" style={toastStyle}>
      <div style={toastRowStyle}>
        <span aria-hidden="true" style={{ fontSize: 14 }}>🌍</span>
        <span style={toastMsgStyle}>
          In-game world edit: <Bold>{entry.sceneId}.ws</Bold>
          <span style={toastSubStyle}>
            {more > 0
              ? `Import into Working changes · +${more} more pending`
              : 'Import into Working changes?'}
          </span>
        </span>
        <button aria-label="Import world edit" onClick={() => handleImport(entry)} style={toastImportStyle}>
          Import
        </button>
        <button aria-label="Dismiss" onClick={() => handleDismiss(entry)} style={toastXStyle}>✕</button>
      </div>
    </div>
  );
}

function Bold({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={{ fontWeight: 700 }}>{children}</span>;
}

// ─── Styles (mirror DeleteUndoToast's chrome) ────────────────────────────────
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
const toastImportStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--color-accent)', color: 'var(--color-accent)',
  borderRadius: 'var(--radius-sm)', fontWeight: 700, fontSize: 'var(--text-xs)',
  padding: '5px 10px', cursor: 'pointer',
};
const toastXStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--color-text-faint)',
  cursor: 'pointer', fontSize: 13, padding: 2,
};
