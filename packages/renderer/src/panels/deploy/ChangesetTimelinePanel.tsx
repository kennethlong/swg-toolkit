/**
 * packages/renderer/src/panels/deploy/ChangesetTimelinePanel.tsx
 * Graph-aware version history UI for the Deploy tab (Phase 4 DEPLOY-03).
 *
 * Display-only — selectVersion (changesetService) handles all state transitions.
 * R2-B4: file lives at panels/deploy/ (NOT components/).
 * Source: 04-04b-PLAN.md Task 2; 04-CONTEXT.md §D-04-06/07/08; sketch 002 winner A.
 */

import React from 'react';
import { useChangesetStore } from '../../state/changesetStore';
import { selectVersion }     from '../../services/changesetService';
import type { SwgChangeset } from '@swg/contracts';

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

  const stale   = activeVersionId !== null && deployedVersionId !== null
    && activeVersionId !== deployedVersionId;
  const branches = branchSet(changesets);
  const sorted   = [...changesets].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-1)',
      padding:'var(--space-2)', overflowY:'auto', height:'100%',
      background:'var(--color-surface)', color:'var(--color-text)',
      fontFamily:'var(--font-sans)', boxSizing:'border-box' }}>

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
    </div>
  );
}
