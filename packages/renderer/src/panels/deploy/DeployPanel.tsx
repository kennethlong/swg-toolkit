/**
 * packages/renderer/src/panels/deploy/DeployPanel.tsx
 * ONE combined deploy surface — Phase 04.1 DEPLOY-05.
 *
 * Replaces the 3-tab split (StagingPanel + ChangesetTimelinePanel + VcsPanel) with
 * the approved sketch 005-B/006-D single surface. Vertically stacks:
 *
 *   1. StagingPanelBody  — working changes (Add… + Save version + virtualized list)
 *   2. Resizable splitter
 *   3. VersionHistoryBody — Baseline root node + ▸-expandable version graph
 *   4. Sticky footer CTA  — Deploy <version>… button → DeployDialog
 *
 * Workspace gate (matches StagingPanel pattern):
 *   - status.kind !== 'ready' → renders <WorkspaceEntry />
 *   - status.kind === 'ready' → full surface
 *
 * Deploy CTA logic (D-12):
 *   - ENABLED by default when a bound client is present (clientPath != null)
 *   - "Deploy Baseline…" stays ENABLED for a bound client (H1 — Baseline = reset-to-stock)
 *   - DISABLED only when project kind is 'mod-project' (status.info.kind) or no clientPath
 *   - Reads kind via workspaceStore.status.info.kind — NEVER workspaceStore.kind (H4)
 *
 * Source: 04.1-03-PLAN.md Task 3; 04.1-PATTERNS.md §DeployPanel.tsx; 04.1-UI-SPEC.md Surface 1.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview';

import StagingPanelBody  from './StagingPanelBody';
import VersionHistoryBody from './VersionHistoryBody';
import { DeployDialog }  from './DeployDialog';

import { useStagingStore }   from '../../state/stagingStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useChangesetStore } from '../../state/changesetStore';

import { BASELINE_ID } from '@swg/contracts';

// ─── Button styles (W1 fix — LOCAL, NOT shared via ExportDialog) ──────────────

function deployBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background:   disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    border:       'none',
    color:        disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    borderRadius: 'var(--radius-sm)',
    padding:      '4px 14px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontSize:     'var(--text-sm)',
    fontWeight:   600,
    opacity:      disabled ? 0.6 : 1,
    transition:   'opacity 0.1s ease',
    flexShrink:   0,
  };
}

// ─── DeployPanel ──────────────────────────────────────────────────────────────

/**
 * One combined deploy surface (IDockviewPanelProps — dockview registration in plan 05).
 * When workspace is not ready, renders WorkspaceEntry gated surface.
 */
export default function DeployPanel(_props?: IDockviewPanelProps): React.ReactElement {
  const status      = useWorkspaceStore((s) => s.status);
  const clientPath  = useWorkspaceStore((s) => s.clientPath);

  // ── Workspace gate ─────────────────────────────────────────────────────────

  if (status.kind !== 'ready') {
    // No project: a brief hint — the first-run Welcome lives in the Assets panel, so the
    // Deploy panel must NOT duplicate it (and must not steal focus on startup).
    return (
      <div
        style={{
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            'var(--space-1)',
          height:         '100%',
          padding:        'var(--space-4)',
          textAlign:      'center',
          background:     'var(--color-surface)',
          color:          'var(--color-text-muted)',
          fontFamily:     'var(--font-sans)',
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>No project open</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
          Open or create a project to deploy.
        </span>
      </div>
    );
  }

  // ── Ready — full surface ───────────────────────────────────────────────────

  return (
    <DeployPanelReady status={status} clientPath={clientPath} />
  );
}

// ─── DeployPanelReady (inner — avoids hooks-after-conditional-return) ─────────

interface DeployPanelReadyProps {
  status:     { kind: 'ready'; info: import('@swg/contracts').WorkspaceInfo };
  clientPath: string | null;
}

function DeployPanelReady({ status, clientPath }: DeployPanelReadyProps): React.ReactElement {
  const entries     = useStagingStore((s) => s.entries);
  const buildStatus = useStagingStore((s) => s.buildStatus);
  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const manifest    = useChangesetStore((s) => s.manifest);
  const activeVersionId = manifest?.activeVersionId ?? null;

  const [deployOpen, setDeployOpen] = useState(false);

  // Resizable splitter state
  const [splitterRatio, setSplitterRatio] = useState(0.45); // 45% staging / 55% history
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Deploy CTA logic ───────────────────────────────────────────────────────
  // DISABLED only for non-client project kind (status.info.kind === 'mod-project')
  // or no clientPath. NEVER disabled just because Baseline is active (H1).
  // NEVER reads workspaceStore.kind (does not exist — H4).

  const projectKind = status.info.kind;
  const isNonClientProject = projectKind === 'mod-project' || clientPath == null;
  const deployDisabled = isNonClientProject;

  // ── Active version label for CTA ──────────────────────────────────────────

  const versionLabel = (() => {
    if (!activeVersionId) return '…';
    if (activeVersionId === BASELINE_ID) return 'Baseline';
    const changesets = manifest?.changesets ?? [];
    const node = changesets.find((c) => c.id === activeVersionId);
    return node?.label ?? activeVersionId.slice(0, 8);
  })();

  // ── Splitter drag handling ─────────────────────────────────────────────────

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = Math.max(0.2, Math.min(0.8, (ev.clientY - rect.top) / rect.height));
      setSplitterRatio(ratio);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      isDragging.current = false;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
        background:    'var(--color-surface)',
        color:         'var(--color-text)',
        fontFamily:    'var(--font-sans)',
        overflow:      'hidden',
      }}
    >
      {/* ── Staging section (top) ── */}
      <div style={{ flex: splitterRatio, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <StagingPanelBody
          entries={entries}
          buildStatus={buildStatus}
          workspaceName={workspaceName}
        />
      </div>

      {/* ── Resizable splitter ── */}
      <div
        onMouseDown={handleSplitterMouseDown}
        style={{
          height:     4,
          cursor:     'ns-resize',
          background: 'var(--color-border)',
          flexShrink: 0,
          userSelect: 'none',
        }}
        title="Drag to resize"
      />

      {/* ── Version history section (bottom) ── */}
      <div style={{ flex: 1 - splitterRatio, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <VersionHistoryBody />
      </div>

      {/* ── Sticky footer CTA ── */}
      <div
        style={{
          display:        'flex',
          flexDirection:  'column',
          gap:            'var(--space-1)',
          flexShrink:     0,
        }}
      >
        {/* Non-client hint copy (shown ONLY for mod-project / no clientPath) */}
        {isNonClientProject && (
          <div
            style={{
              fontSize:   'var(--text-xs)',
              color:      'var(--color-text-faint)',
              padding:    '0 var(--space-4)',
              paddingTop: 'var(--space-1)',
            }}
          >
            No bound client — deploy-to-client is disabled
          </div>
        )}

        <div
          style={{
            display:     'flex',
            justifyContent: 'flex-end',
            alignItems:  'center',
            gap:         'var(--space-2)',
            padding:     'var(--space-2) var(--space-3)',
            borderTop:   '1px solid var(--color-border)',
            background:  'var(--color-header)',
          }}
        >
          <button
            style={deployBtnStyle(deployDisabled)}
            disabled={deployDisabled}
            aria-disabled={deployDisabled}
            onClick={deployDisabled ? undefined : () => setDeployOpen(true)}
            aria-label={deployDisabled ? 'Deploy disabled — no bound client' : `Deploy ${versionLabel}`}
            title={
              deployDisabled
                ? 'Non-client project — deploy-to-client is not available'
                : `Deploy ${versionLabel} to the bound client`
            }
          >
            Deploy {versionLabel}…
          </button>
        </div>
      </div>

      <DeployDialog open={deployOpen} onClose={() => setDeployOpen(false)} />
    </div>
  );
}
