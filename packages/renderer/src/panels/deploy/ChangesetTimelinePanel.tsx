/**
 * packages/renderer/src/panels/deploy/ChangesetTimelinePanel.tsx
 * Graph-aware version history UI for the Deploy tab (Phase 4 DEPLOY-03).
 *
 * Display-only — selectVersion (changesetService) handles all state transitions.
 * R2-B4: file lives at panels/deploy/ (NOT components/).
 * Source: 04-04b-PLAN.md Task 2; 04-CONTEXT.md §D-04-06/07/08; sketch 002 winner A.
 */

import React, { useState } from 'react';
import { useChangesetStore } from '../../state/changesetStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useStagingStore }   from '../../state/stagingStore';
import { selectVersion }     from '../../services/changesetService';
import { DeployDialog }      from './DeployDialog';
import type { SwgChangeset } from '@swg/contracts';

/** Primary button style (local — mirrors the deploy panels). */
function deployBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background:   disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    border:       'none',
    color:        disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    borderRadius: 'var(--radius-sm)',
    padding:      '4px 12px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontSize:     'var(--text-sm)',
    fontWeight:   600,
    opacity:      disabled ? 0.6 : 1,
  };
}

/** Returns IDs of branch-start nodes: those whose parentId !== chronological predecessor. */
function branchSet(cs: SwgChangeset[]): Set<string> {
  const sorted = [...cs].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);
  const s = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].parentId !== sorted[i - 1].id) s.add(sorted[i].id);
  }
  return s;
}

export default function ChangesetTimelinePanel(): React.JSX.Element {
  const manifest          = useChangesetStore((s) => s.manifest);
  const activeVersionId   = manifest?.activeVersionId  ?? null;
  const deployedVersionId = manifest?.deployedVersionId ?? null;
  const changesets        = manifest?.changesets ?? [];

  // Deploy lives here (not on Staging): it deploys the SELECTED version
  // (flatten(activeVersionId)), so its home is the version graph.
  const [deployOpen, setDeployOpen] = useState(false);
  const wsReady      = useWorkspaceStore((s) => s.status.kind === 'ready');
  const stagingCount = useStagingStore((s) => s.entries.length);
  // Enabled when there's a saved version OR uncommitted staging to deploy
  // (DeployDialog auto-seals dirty staging before deploying).
  const deployDisabled = !wsReady || (changesets.length === 0 && stagingCount === 0);

  const stale   = activeVersionId !== null && deployedVersionId !== null
    && activeVersionId !== deployedVersionId;
  const branches = branchSet(changesets);
  const sorted   = [...changesets].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%',
      background:'var(--color-surface)', color:'var(--color-text)',
      fontFamily:'var(--font-sans)', boxSizing:'border-box' }}>

    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-1)',
      padding:'var(--space-2)', overflowY:'auto', flex:1, minHeight:0,
      boxSizing:'border-box' }}>

      {stale && (
        <div className="stale-deploy-warning" style={{ fontSize:'var(--text-xs)',
          color:'var(--color-warn,#facc15)', marginBottom:'var(--space-2)',
          padding:'var(--space-1) var(--space-2)',
          borderLeft:'2px solid var(--color-warn,#facc15)' }}>
          ⚠ Deployed version is not the current edit version
        </div>
      )}

      {sorted.map((node) => {
        const isActive   = node.id === activeVersionId;
        const isDeployed = node.id === deployedVersionId;
        const isBranch   = branches.has(node.id);

        const cls = ['changeset-node',
          isActive   && 'active-version-node',
          isDeployed && 'deployed-version-node',
          isBranch   && 'branch-node',
        ].filter(Boolean).join(' ');

        return (
          <div key={node.id} className={cls}
            data-branch={isBranch ? 'true' : undefined}
            onClick={() => selectVersion(node.id)}
            style={{ display:'flex', flexDirection:'column', gap:'var(--space-1)',
              padding:'var(--space-2)',
              paddingLeft: isBranch ? 'calc(var(--space-4) * 2)' : 'var(--space-4)',
              background: isActive ? 'var(--color-surface-3,rgba(255,255,255,0.08))' : 'transparent',
              borderLeft: isBranch ? '2px solid var(--color-accent)' : '2px solid transparent',
              cursor:'pointer', borderRadius:'var(--radius-sm)',
              transition:'background 0.1s ease', boxSizing:'border-box' }}>

            <div style={{ display:'flex', alignItems:'center', gap:'var(--space-2)' }}>
              {isActive   && <span aria-label="Active version"   style={{ color:'var(--color-success,#22c55e)', lineHeight:1, flexShrink:0 }}>●</span>}
              {isDeployed && <span aria-label="Deployed version" style={{ color:'var(--color-accent,#3b82f6)',  lineHeight:1, flexShrink:0 }}>●</span>}
              <span style={{ fontSize:'var(--text-sm)', flex:1 }}>{node.label}</span>
            </div>
            <div style={{ fontSize:'var(--text-xs)', color:'var(--color-text-faint)',
              fontFamily:'var(--font-mono)' }}>
              {node.timestamp}
            </div>
          </div>
        );
      })}

      {sorted.length === 0 && (
        <div style={{ color:'var(--color-text-faint)', fontSize:'var(--text-sm)',
          padding:'var(--space-4)', textAlign:'center' }}>
          No versions yet — stage changes and Save version to create one.
        </div>
      )}
    </div>

    {/* Bottom action bar — Deploy the selected (active) version */}
    <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center',
      gap:'var(--space-2)', padding:'var(--space-2) var(--space-3)',
      borderTop:'1px solid var(--color-border)', background:'var(--color-header)',
      flexShrink:0 }}>
      <button
        style={deployBtnStyle(deployDisabled)}
        disabled={deployDisabled}
        aria-disabled={deployDisabled}
        onClick={deployDisabled ? undefined : () => setDeployOpen(true)}
        aria-label="Deploy"
        title={deployDisabled
          ? 'Save a version (or stage changes) to deploy'
          : 'Deploy the selected version to the client'}
      >
        Deploy…
      </button>
    </div>

    <DeployDialog open={deployOpen} onClose={() => setDeployOpen(false)} />
    </div>
  );
}
