/**
 * packages/renderer/src/panels/deploy/WorkspaceEntry.tsx
 * Empty-state workspace entry surface for the staging / changeset / VCS panels.
 *
 * Shown when no mod workspace is open. Offers [Open Project…] and [New Project…]
 * buttons that invoke the OS folder picker (via ipcRenderer to the main process,
 * which holds the dialog API in this Electron architecture) then call the
 * appropriate workspaceService function.
 *
 * W1 FIX: primaryBtnStyle and secondaryBtnStyle are LOCAL const functions defined
 * here — NOT imported via ExportDialog.tsx (that file does not export them;
 * any such import would cause a TS error).
 *
 * Source: 04-02-PLAN.md Task 1; 04-UI-SPEC.md §Surface 1; 04-PATTERNS.md §WorkspaceEntry.tsx.
 */

import React, { useCallback } from 'react';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { openWorkspace, createWorkspace } from '../../services/workspaceService';
import AsyncProgress from '../../shared/AsyncProgress';

// ─── IPC bridge ────────────────────────────────────────────────────────────────

// Path B: dialog is main-process only — invoke via IPC channel 'workspace:pick-dir'.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcRenderer } = require('electron') as {
  ipcRenderer: {
    invoke(channel: 'workspace:pick-dir'): Promise<string[]>;
  };
};

// ─── Button styles (W1 fix — LOCAL const functions, not pulled in via ExportDialog) ──────

/** Primary accent button (e.g. "Open Project…"). */
const primaryBtnStyle = (): React.CSSProperties => ({
  background:   'var(--color-accent)',
  color:        'var(--color-accent-text)',
  border:       'none',
  borderRadius: 'var(--radius-sm)',
  padding:      '6px 16px',
  fontFamily:   'var(--font-sans)',
  fontSize:     'var(--text-sm)',
  fontWeight:   600,
  cursor:       'pointer',
  transition:   'opacity 0.1s ease',
});

/** Secondary outlined button (e.g. "New Project…"). */
const secondaryBtnStyle = (): React.CSSProperties => ({
  background:   'transparent',
  color:        'var(--color-text-muted)',
  border:       '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding:      '6px 16px',
  fontFamily:   'var(--font-sans)',
  fontSize:     'var(--text-sm)',
  cursor:       'pointer',
  transition:   'opacity 0.1s ease',
});

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Workspace entry / empty-state component.
 *
 * Rendered by StagingPanel, ChangesetTimelinePanel, and VcsPanel when no
 * workspace is open (status.kind !== 'ready'). Shows the Open / New pair of
 * actions and an AsyncProgress spinner while a workspace is opening.
 */
export default function WorkspaceEntry(): React.ReactElement {
  const status = useWorkspaceStore((s) => s.status);

  const handleOpen = useCallback(async () => {
    try {
      const paths = await ipcRenderer.invoke('workspace:pick-dir');
      if (paths.length > 0 && paths[0]) {
        await openWorkspace(paths[0]);
      }
    } catch (err) {
      console.error('[WorkspaceEntry] openWorkspace error:', err);
    }
  }, []);

  const handleNew = useCallback(async () => {
    try {
      const paths = await ipcRenderer.invoke('workspace:pick-dir');
      if (paths.length > 0 && paths[0]) {
        await createWorkspace(paths[0]);
      }
    } catch (err) {
      console.error('[WorkspaceEntry] createWorkspace error:', err);
    }
  }, []);

  // Show progress while a workspace is opening/being scaffolded
  if (status.kind === 'opening') {
    return (
      <div
        style={{
          flex:           1,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          padding:        'var(--space-4)',
        }}
      >
        <AsyncProgress caption="Setting up workspace…" />
      </div>
    );
  }

  return (
    <div
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
      }}
    >
      {/* Heading — UI-SPEC §Surface 1 exact copy */}
      <span
        style={{
          fontWeight: 600,
          fontSize:   'var(--text-md)',
          color:      'var(--color-text-muted)',
        }}
      >
        No mod workspace open
      </span>

      {/* Body — UI-SPEC §Surface 1 exact copy */}
      <span
        style={{
          color:    'var(--color-text-faint)',
          fontSize: 'var(--text-base)',
        }}
      >
        Open or create a project folder to start a mod.
      </span>

      {/* Action buttons */}
      <div
        style={{
          display:   'flex',
          gap:       'var(--space-2)',
          marginTop: 'var(--space-3)',
        }}
      >
        <button
          style={primaryBtnStyle()}
          onClick={() => { void handleOpen(); }}
          aria-label="Open Project"
          title="Open an existing mod workspace folder"
        >
          Open Project…
        </button>
        <button
          style={secondaryBtnStyle()}
          onClick={() => { void handleNew(); }}
          aria-label="New Project"
          title="Create a new mod workspace folder"
        >
          New Project…
        </button>
      </div>
    </div>
  );
}
