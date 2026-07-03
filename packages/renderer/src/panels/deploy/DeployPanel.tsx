/**
 * packages/renderer/src/panels/deploy/DeployPanel.tsx
 * ONE combined deploy surface — Phase 04.1 DEPLOY-05 + Phase 04.3 DEPLOYUI-01..05/11..12.
 *
 * 04.3 additions (plan 07):
 *   DEPLOYUI-01/D3: collapsible Working changes / Version history sections (▾/▸ caret)
 *   DEPLOYUI-02/D4: splitter auto-hidden when a section is collapsed (006-D contract)
 *   DEPLOYUI-03/D5: section headers with file count + "Version History" label
 *   DEPLOYUI-11/D13: deploy footer instructional hint
 *   DEPLOYUI-12/D14: Deploy CTA full-width
 *
 * Vertically stacks:
 *   1. Section header "● Working changes (uncommitted)" — collapsible
 *   2. StagingPanelBody  — body, hidden when staging collapsed
 *   3. Resizable splitter — hidden when either section collapsed (D4)
 *   4. Section header "Version History" — collapsible
 *   5. VersionHistoryBody — body, hidden when history collapsed
 *   6. Sticky footer CTA  — Deploy <version>… button (full-width) + hint
 *
 * Source: 04.1-03-PLAN.md Task 3; 04.3-07-PLAN.md Task 1.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { IDockviewPanelProps } from 'dockview';

import StagingPanelBody  from './StagingPanelBody';
import VersionHistoryBody from './VersionHistoryBody';
import { DeployDialog }  from './DeployDialog';

import { useStagingStore }   from '../../state/stagingStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useChangesetStore } from '../../state/changesetStore';
import { flatten } from '../../services/changesetService';

import { BASELINE_ID } from '@swg/contracts';

// ─── Section header ────────────────────────────────────────────────────────────

interface SectionHeadProps {
  collapsed:  boolean;
  onToggle:   () => void;
  children:   React.ReactNode;
}

function SectionHead({ collapsed, onToggle, children }: SectionHeadProps): React.ReactElement {
  return (
    <div
      onClick={onToggle}
      role="button"
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand section' : 'Collapse section'}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          'var(--space-2)',
        height:       'var(--tabstrip-h)',
        padding:      '0 var(--space-3)',
        background:   'var(--color-header)',
        borderBottom: '1px solid var(--color-border)',
        cursor:       'pointer',
        userSelect:   'none',
        flexShrink:   0,
        fontSize:     'var(--text-xs)',
        fontWeight:   600,
        color:        'var(--color-text-muted)',
      }}
    >
      {/* Caret — rotates when collapsed */}
      <span
        aria-hidden="true"
        style={{
          display:          'inline-block',
          width:            10,
          fontSize:         9,
          color:            'var(--color-text-faint)',
          transition:       'transform 0.12s',
          transform:        collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          transformOrigin:  'center',
        }}
      >
        ▾
      </span>
      {children}
    </div>
  );
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
  const studioDir   = useWorkspaceStore((s) => s.studioDir);
  const manifest    = useChangesetStore((s) => s.manifest);
  const activeVersionId = manifest?.activeVersionId ?? null;

  // # of UNCOMMITTED changes = staging entries that differ from the active version's committed
  // set (new path, changed action, or changed sha). NOT entries.length — after a Save the
  // staging working set equals flatten(active), so this correctly reads 0 and the "uncommitted"
  // dot clears. Falls back to entries.length only if the active flat can't be computed.
  const uncommittedCount = useMemo(() => {
    if (!activeVersionId || !manifest || !studioDir) return entries.length;
    let base;
    try {
      base = new Map(flatten(activeVersionId, manifest, studioDir).map((e) => [e.virtualPath, e]));
    } catch {
      return entries.length;
    }
    return entries.filter((e) => {
      const b = base.get(e.virtualPath);
      if (!b) return true;                    // new path → uncommitted
      if (b.action !== e.action) return true; // action changed → uncommitted
      if (b.sha256 !== undefined && e.sha256 !== undefined) return b.sha256 !== e.sha256;
      return false;                           // same path, no sha to compare → treat as committed
    }).length;
  }, [entries, activeVersionId, manifest, studioDir]);

  const [deployOpen, setDeployOpen] = useState(false);

  // ── DEPLOYUI-01/D3: collapsible section state ──────────────────────────────
  const [stagingCollapsed,  setStagingCollapsed]  = useState(false);
  const [historyCollapsed,  setHistoryCollapsed]  = useState(false);

  // Splitter is only meaningful when BOTH sections are expanded (D4 — 006-D contract).
  const splitterVisible = !stagingCollapsed && !historyCollapsed;

  // ── Resizable splitter ─────────────────────────────────────────────────────
  const [splitterRatio, setSplitterRatio] = useState(0.45);
  const isDragging   = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Flex values for each section:
  //   Both expanded → splitterRatio / (1 - splitterRatio)
  //   Staging collapsed → staging header only; history fills (flex: 1)
  //   History collapsed → history header only; staging fills (flex: 1)
  const stagingFlexGrow = stagingCollapsed ? 0 : (historyCollapsed ? 1 : splitterRatio);
  const historyFlexGrow = historyCollapsed ? 0 : (stagingCollapsed ? 1 : 1 - splitterRatio);

  // ── Deploy CTA logic ───────────────────────────────────────────────────────
  const projectKind       = status.info.kind;
  const isNonClientProject = projectKind === 'mod-project' || clientPath == null;

  // The selected version is ALREADY live and there is nothing uncommitted to seal →
  // deploying it is a no-op, so the CTA disables. deployedVersionId === null means
  // nothing is deployed (client at stock), i.e. Baseline is live — selecting Baseline
  // then is also a no-op. Uncommitted changes re-enable the CTA (Deploy seals + ships
  // a NEW version, which is never a no-op).
  const deployedVersionId = manifest?.deployedVersionId ?? null;
  const selectedIsLive =
    activeVersionId !== null &&
    uncommittedCount === 0 &&
    activeVersionId === (deployedVersionId ?? BASELINE_ID);

  const deployDisabled = isNonClientProject || selectedIsLive;

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
      {/* ── DEPLOYUI-03/D5: "● Working changes (uncommitted)" section ── */}
      <div
        data-testid="staging-section"
        style={{
          display:       'flex',
          flexDirection: 'column',
          flexGrow:      stagingFlexGrow,
          flexShrink:    stagingCollapsed ? 0 : 1,
          flexBasis:     stagingCollapsed ? 'auto' : 0,
          overflow:      'hidden',
          minHeight:     0,
        }}
      >
        <SectionHead
          collapsed={stagingCollapsed}
          onToggle={() => setStagingCollapsed((c) => !c)}
        >
          {/* Dot is "active" (accent) ONLY when there are real uncommitted changes; grey otherwise. */}
          <span aria-hidden="true" style={{ color: uncommittedCount > 0 ? 'var(--color-accent)' : 'var(--color-text-faint)' }}>●</span>
          <span>Working changes (uncommitted)</span>
          <span
            style={{
              marginLeft: 'auto',
              fontWeight: 400,
              color:      'var(--color-text-faint)',
            }}
          >
            {uncommittedCount === 0
              ? 'no changes'
              : `${uncommittedCount} ${uncommittedCount === 1 ? 'file' : 'files'}`}
          </span>
        </SectionHead>

        {!stagingCollapsed && (
          <StagingPanelBody
            entries={entries}
            buildStatus={buildStatus}
            workspaceName={workspaceName}
          />
        )}
      </div>

      {/* ── DEPLOYUI-02/D4: Resizable splitter — hidden when either section collapsed ── */}
      {splitterVisible && (
        <div
          data-testid="section-splitter"
          onMouseDown={handleSplitterMouseDown}
          style={{
            height:     7,
            cursor:     'ns-resize',
            background: 'var(--color-header)',
            borderTop:  '1px solid var(--color-border)',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
            userSelect: 'none',
            position:   'relative',
          }}
          title="Drag to resize"
        >
          {/* Drag handle indicator */}
          <div
            style={{
              position:     'absolute',
              left:         '50%',
              top:          '50%',
              transform:    'translate(-50%, -50%)',
              width:        30,
              height:       2,
              borderRadius: 2,
              background:   'var(--color-text-faint)',
              opacity:      0.5,
            }}
          />
        </div>
      )}

      {/* ── DEPLOYUI-03/D5: "Version History" section ── */}
      <div
        data-testid="history-section"
        style={{
          display:       'flex',
          flexDirection: 'column',
          flexGrow:      historyFlexGrow,
          flexShrink:    historyCollapsed ? 0 : 1,
          flexBasis:     historyCollapsed ? 'auto' : 0,
          overflow:      'hidden',
          minHeight:     0,
        }}
      >
        <SectionHead
          collapsed={historyCollapsed}
          onToggle={() => setHistoryCollapsed((c) => !c)}
        >
          <span>Version History</span>
        </SectionHead>

        {!historyCollapsed && <VersionHistoryBody />}
      </div>

      {/* ── Sticky footer CTA ── */}
      <div
        style={{
          display:       'flex',
          flexDirection: 'column',
          gap:           'var(--space-1)',
          flexShrink:    0,
          padding:       'var(--space-2) var(--space-3)',
          borderTop:     '1px solid var(--color-border)',
          background:    'var(--color-header)',
        }}
      >
        {/* Non-client hint copy (shown ONLY for mod-project / no clientPath) */}
        {isNonClientProject && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color:    'var(--color-text-faint)',
            }}
          >
            No bound client — deploy-to-client is disabled
          </div>
        )}

        {/* DEPLOYUI-12/D14: Full-width Deploy CTA */}
        <button
          style={{
            width:        '100%',
            background:   deployDisabled ? 'var(--color-widget)' : 'var(--color-accent)',
            border:       'none',
            color:        deployDisabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
            borderRadius: 'var(--radius-sm)',
            padding:      '7px 0',
            cursor:       deployDisabled ? 'not-allowed' : 'pointer',
            fontSize:     'var(--text-sm)',
            fontWeight:   600,
            opacity:      deployDisabled ? 0.6 : 1,
            transition:   'opacity 0.1s ease',
          }}
          disabled={deployDisabled}
          aria-disabled={deployDisabled}
          onClick={deployDisabled ? undefined : () => setDeployOpen(true)}
          aria-label={
            isNonClientProject
              ? 'Deploy disabled — no bound client'
              : selectedIsLive
              ? `${versionLabel} is already live`
              : `Deploy ${versionLabel}`
          }
          title={
            isNonClientProject
              ? 'Non-client project — deploy-to-client is not available'
              : selectedIsLive
              ? `${versionLabel} is already live — stage a change or select another version`
              : `Deploy ${versionLabel} to the bound client`
          }
        >
          {selectedIsLive && !isNonClientProject
            ? `${versionLabel} is live ✓`
            : <>Deploy {versionLabel}…</>}
        </button>

        {/* DEPLOYUI-11/D13: footer instructional hint */}
        <div
          data-testid="deploy-hint"
          style={{
            fontSize:   10,
            color:      'var(--color-text-faint)',
            textAlign:  'center',
            fontFamily: 'var(--font-mono)',
          }}
        >
          collapse a section or drag the divider · expand a version (▸) to list its files
        </div>
      </div>

      <DeployDialog open={deployOpen} onClose={() => setDeployOpen(false)} />
    </div>
  );
}
