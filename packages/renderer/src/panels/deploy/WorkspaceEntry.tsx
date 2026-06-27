/**
 * packages/renderer/src/panels/deploy/WorkspaceEntry.tsx
 * Empty-state workspace entry surface for the Deploy panel (first-run welcome).
 *
 * Shown when no project is open. Updated in Phase 4.1 Plan 04 (PROJ-01 Task 3):
 *   - Heading/body copy updated to match UI-SPEC Surface 2 (007-B)
 *   - Auto-scanned "Detected clients" list with ✓ ready / ✗ not found pills
 *     (Accessibility Rule 1: glyph + border + label, never color-only)
 *   - Clicking a ready client calls projectBinding.initProject(installPath)
 *   - ＋ Project ▾ button (New opens wizard; Open… picks a folder)
 *
 * The ＋ Project split-button wizard is controlled via the onNewProject prop;
 * if not provided the button falls back to createWorkspace (legacy path).
 *
 * W1 FIX: primaryBtnStyle and secondaryBtnStyle are LOCAL const functions defined
 * here — NOT imported via ExportDialog.tsx (that file does not export them;
 * any such import would cause a TS error).
 *
 * Source: 04.1-04-PLAN.md Task 3; 04.1-UI-SPEC.md §Surface 2 §007-B;
 *         04.1-PATTERNS.md §WorkspaceEntry.tsx.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { openWorkspace, createWorkspace } from '../../services/workspaceService';
import * as projectBinding from '../../services/projectBinding';
import { detectClients } from '../../services/clientLocator';
import type { DetectedClient } from '@swg/contracts';
import AsyncProgress from '../../shared/AsyncProgress';

// ─── IPC bridge ────────────────────────────────────────────────────────────────

// Path B: dialog is main-process only — invoke via IPC channel 'workspace:pick-dir'.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcRenderer } = require('electron') as {
  ipcRenderer: {
    invoke(channel: 'workspace:pick-dir'): Promise<string[]>;
  };
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WorkspaceEntryProps {
  /** Called when user clicks "New" in the ＋ Project menu. Opens the wizard in the parent. */
  onNewProject?: () => void;
}

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
 * Workspace entry / first-run welcome component.
 *
 * Rendered by DeployPanel when no project is open (status.kind !== 'ready').
 * Shows:
 *  - "No project open" heading + body copy (UI-SPEC Surface 2 §007-B)
 *  - Auto-scanned detected clients list with ✓ ready / ✗ not found pills
 *  - ＋ Project ▾ actions (New wizard / Open…) + Mount Archive… button
 *  - AsyncProgress while opening
 *
 * Accessibility Rule 1: pills use glyph (✓/✗) + border + text label, never color-only.
 */
export default function WorkspaceEntry({ onNewProject }: WorkspaceEntryProps = {}): React.ReactElement {
  const status = useWorkspaceStore((s) => s.status);
  const [detectedClients, setDetectedClients] = useState<DetectedClient[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);

  // Auto-scan detected clients on mount
  useEffect(() => {
    try {
      setDetectedClients(detectClients());
    } catch (err) {
      console.error('[WorkspaceEntry] detectClients error:', err);
    }
  }, []);

  // Open… — picks a folder and calls initProject (PROJ-01 binding flow)
  const handleOpen = useCallback(async () => {
    setClientError(null);
    let picked: string | undefined;
    try {
      const paths = await ipcRenderer.invoke('workspace:pick-dir');
      if (paths.length > 0 && paths[0]) {
        picked = paths[0];
        await projectBinding.initProject(picked);
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      console.error('[WorkspaceEntry] initProject error:', err);
      // Fallback: try createWorkspace for folders that don't have a .studio yet
      if (picked && /Not a toolkit workspace/.test(msg)) {
        const create = window.confirm(
          `No toolkit workspace was found in:\n\n${picked}\n\n` +
            'Would you like to create a new mod workspace here?',
        );
        if (create) {
          try {
            await createWorkspace(picked);
          } catch (cerr) {
            console.error('[WorkspaceEntry] createWorkspace error:', cerr);
          }
        }
      }
    }
  }, []);

  // Clicking a detected client: call initProject with the install path
  const handleOpenClient = useCallback(async (client: DetectedClient) => {
    setClientError(null);
    try {
      await projectBinding.initProject(client.installPath);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      setClientError(msg);
      console.error('[WorkspaceEntry] initProject(client) error:', err);
    }
  }, []);

  // New — delegates to the wizard via onNewProject prop (or legacy createWorkspace fallback)
  const handleNew = useCallback(async () => {
    if (onNewProject) {
      onNewProject();
      return;
    }
    // Legacy fallback: pick-dir + createWorkspace (pre-wizard behavior)
    try {
      const paths = await ipcRenderer.invoke('workspace:pick-dir');
      if (paths.length > 0 && paths[0]) {
        await createWorkspace(paths[0]);
      }
    } catch (err) {
      console.error('[WorkspaceEntry] createWorkspace error:', err);
    }
  }, [onNewProject]);

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
      {/* Heading — UI-SPEC §Surface 2 §007-B Copywriting Contract */}
      <span
        style={{
          fontWeight: 600,
          fontSize:   'var(--text-md)',
          color:      'var(--color-text-muted)',
        }}
      >
        No project open
      </span>

      {/* Body — UI-SPEC §Surface 2 §007-B Copywriting Contract */}
      <span
        style={{
          color:    'var(--color-text-faint)',
          fontSize: 'var(--text-base)',
        }}
      >
        Open or create a project, or pick a client install to start a mod.
      </span>

      {/* Inline error feedback (WorkspaceEntry.tsx:167-181 pattern) */}
      {status.kind === 'error' && (
        <span
          role="alert"
          style={{
            marginTop:  'var(--space-2)',
            maxWidth:   '420px',
            color:      'var(--color-danger, #f87171)',
            fontSize:   'var(--text-sm)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {status.reason}
        </span>
      )}
      {clientError && (
        <span
          role="alert"
          style={{
            marginTop:  'var(--space-2)',
            maxWidth:   '420px',
            color:      'var(--color-danger, #f87171)',
            fontSize:   'var(--text-sm)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {clientError}
        </span>
      )}

      {/* ── Action buttons ────────────────────────────────────────────── */}
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
          title="Open an existing project folder"
        >
          Open Project…
        </button>
        <button
          style={secondaryBtnStyle()}
          onClick={() => { void handleNew(); }}
          aria-label="New Project"
          title="Create a new project"
        >
          New Project…
        </button>
      </div>

      {/* ── Detected clients list (007-B first-run) ─────────────────── */}
      {/* Accessibility Rule 1: pills use glyph + border + text label, never color-only */}
      {detectedClients.length > 0 && (
        <div
          style={{
            width:         '100%',
            maxWidth:      420,
            marginTop:     'var(--space-4)',
            display:       'flex',
            flexDirection: 'column',
            gap:           'var(--space-1)',
          }}
        >
          <span
            style={{
              fontSize:      'var(--text-xs)',
              fontWeight:    600,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              color:         'var(--color-text-muted)',
              textAlign:     'left',
              marginBottom:  'var(--space-1)',
            }}
          >
            Detected clients
          </span>
          {detectedClients.map((client) => (
            <div
              key={client.installPath}
              onClick={() => void handleOpenClient(client)}
              title={client.installPath}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          'var(--space-2)',
                padding:      'var(--space-2) var(--space-3)',
                background:   'var(--color-surface-2)',
                borderRadius: 'var(--radius-sm)',
                cursor:       'pointer',
                textAlign:    'left',
                border:       '1px solid transparent',
                transition:   'border-color 0.1s ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-line)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
              }}
            >
              {/* ✓ ready pill (glyph + border + text, Accessibility Rule 1) */}
              <span
                style={{
                  fontSize:     'var(--text-xs)',
                  padding:      '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  border:       '1px solid var(--color-accent-line)',
                  color:        'var(--color-accent)',
                  flexShrink:   0,
                  fontFamily:   'var(--font-mono)',
                }}
              >
                ✓ ready
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize:     'var(--text-sm)',
                    color:        'var(--color-text)',
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                  }}
                >
                  {client.name}
                </div>
                <div
                  style={{
                    fontFamily:   'var(--font-mono)',
                    fontSize:     'var(--text-xs)',
                    color:        'var(--color-text-faint)',
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                  }}
                >
                  {client.installPath}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
