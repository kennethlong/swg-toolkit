/**
 * packages/renderer/src/panels/deploy/VersionHistoryBody.tsx
 * Extracted version-history graph body — Phase 04.1 DEPLOY-05.
 *
 * Moved from ChangesetTimelinePanel.tsx:65-147 (graph body) to its own file.
 * The outer panel wrapper is DROPPED — DeployPanel owns the container.
 *
 * Additions vs original graph body:
 *   D-08: Baseline root node — dashed-square, "0 deltas · shadow ≡ source"
 *     Dedup rule (H2b): if a changeset with id === BASELINE_ID already exists in
 *     changesets[], render that entry as the Baseline row. Only synthesize a
 *     placeholder when no such entry is present. NEVER render both.
 *   M7: per-row ▸ expand state lists node.deltas[] (ActionBadge + virtualPath)
 *
 * Virtualization: not needed here (version count stays small); no ROW_HEIGHT scroll.
 * A11y: branchSet helper preserved; class names preserved.
 *
 * Source: 04.1-03-PLAN.md Task 2; ChangesetTimelinePanel.tsx:65-147; 04.1-PATTERNS.md §VersionHistoryBody.tsx.
 */

import React, { useState } from 'react';

import { useChangesetStore } from '../../state/changesetStore';
import { selectVersion }     from '../../services/changesetService';
import ActionBadge           from './ActionBadge';

import { BASELINE_ID } from '@swg/contracts';
import type { SwgChangeset } from '@swg/contracts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns IDs of branch-start nodes: those whose parentId !== chronological predecessor. */
function branchSet(cs: SwgChangeset[]): Set<string> {
  const sorted = [...cs].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);
  const s = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.parentId !== sorted[i - 1]!.id) s.add(sorted[i]!.id);
  }
  return s;
}

// ─── VersionHistoryBody ────────────────────────────────────────────────────────

export default function VersionHistoryBody(): React.JSX.Element {
  const manifest          = useChangesetStore((s) => s.manifest);
  const activeVersionId   = manifest?.activeVersionId  ?? null;
  const deployedVersionId = manifest?.deployedVersionId ?? null;
  const changesets        = manifest?.changesets ?? [];

  // ▸ Per-row expand state for delta lists (M7)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const stale   = activeVersionId !== null && deployedVersionId !== null
    && activeVersionId !== deployedVersionId;
  const branches = branchSet(changesets);

  // Sort all changesets chronologically (oldest first)
  const sorted = [...changesets].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);

  // H2b: deduplicate Baseline node.
  // If a changeset with id === BASELINE_ID already exists, it appears in sorted[].
  // Only synthesize a placeholder when NO such entry is present.
  const hasSeededBaseline = changesets.some((c) => c.id === BASELINE_ID);

  // Non-baseline changesets (those that are NOT the seeded baseline entry)
  const nonBaselineChangesets = sorted.filter((c) => c.id !== BASELINE_ID);
  // The seeded Baseline entry (if present)
  const seededBaseline = sorted.find((c) => c.id === BASELINE_ID) ?? null;

  const isBaseline = activeVersionId === BASELINE_ID;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
      padding: 'var(--space-2)', overflowY: 'auto', flex: 1, minHeight: 0,
      boxSizing: 'border-box' }}>

      {/* Stale-deployment warning banner */}
      {stale && (
        <div className="stale-deploy-warning" style={{ fontSize: 'var(--text-xs)',
          color: 'var(--color-warn,#facc15)', marginBottom: 'var(--space-2)',
          padding: 'var(--space-1) var(--space-2)',
          borderLeft: '2px solid var(--color-warn,#facc15)' }}>
          ⚠ Deployed version is not the current edit version
        </div>
      )}

      {/* D-08: Baseline root node — dashed-square, 0 deltas */}
      {/* H2b: render from seeded entry when present; synthesize placeholder only when absent */}
      {hasSeededBaseline && seededBaseline ? (
        // Render the seeded Baseline changeset entry as the Baseline row
        <div className="changeset-node baseline-node"
          data-changeset-id={BASELINE_ID}
          onClick={() => {
            selectVersion(BASELINE_ID);
            toggleExpand(BASELINE_ID);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
            padding: 'var(--space-2) var(--space-4)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            background: isBaseline ? 'var(--color-surface-3,rgba(255,255,255,0.08))' : 'transparent' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {isBaseline && <span aria-label="Active version" style={{ color: 'var(--color-success,#22c55e)', lineHeight: 1, flexShrink: 0 }}>●</span>}
            <span style={{ fontSize: 'var(--text-sm)', flex: 1 }}>
              {expanded.has(BASELINE_ID) ? '▾' : '▸'} Baseline (pristine)
            </span>
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)',
            fontFamily: 'var(--font-mono)' }}>0 deltas · shadow ≡ source</span>
        </div>
      ) : !hasSeededBaseline ? (
        // Synthesize placeholder only when no seeded Baseline entry exists
        <div className="changeset-node baseline-node"
          data-changeset-id={BASELINE_ID}
          onClick={() => {
            selectVersion(BASELINE_ID);
            toggleExpand(BASELINE_ID);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
            padding: 'var(--space-2) var(--space-4)',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            background: isBaseline ? 'var(--color-surface-3,rgba(255,255,255,0.08))' : 'transparent' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {isBaseline && <span aria-label="Active version" style={{ color: 'var(--color-success,#22c55e)', lineHeight: 1, flexShrink: 0 }}>●</span>}
            <span style={{ fontSize: 'var(--text-sm)', flex: 1 }}>
              ▸ Baseline (pristine)
            </span>
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)',
            fontFamily: 'var(--font-mono)' }}>0 deltas · shadow ≡ source</span>
        </div>
      ) : null}

      {/* Version history rows — non-baseline changesets with ▸ delta expansion */}
      {nonBaselineChangesets.map((node) => {
        const isActive   = node.id === activeVersionId;
        const isDeployed = node.id === deployedVersionId;
        const isBranch   = branches.has(node.id);
        const isExpanded = expanded.has(node.id);

        const cls = ['changeset-node',
          isActive   && 'active-version-node',
          isDeployed && 'deployed-version-node',
          isBranch   && 'branch-node',
        ].filter(Boolean).join(' ');

        return (
          <div key={node.id}>
            {/* Version row header */}
            <div className={cls}
              data-changeset-id={node.id}
              data-branch={isBranch ? 'true' : undefined}
              onClick={() => {
                selectVersion(node.id);
                toggleExpand(node.id);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
                padding: 'var(--space-2)',
                paddingLeft: isBranch ? 'calc(var(--space-4) * 2)' : 'var(--space-4)',
                background: isActive ? 'var(--color-surface-3,rgba(255,255,255,0.08))' : 'transparent',
                borderLeft: isBranch ? '2px solid var(--color-accent)' : '2px solid transparent',
                cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                transition: 'background 0.1s ease', boxSizing: 'border-box' }}>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {isActive   && <span aria-label="Active version"   style={{ color: 'var(--color-success,#22c55e)', lineHeight: 1, flexShrink: 0 }}>●</span>}
                {isDeployed && <span aria-label="Deployed version" style={{ color: 'var(--color-accent,#3b82f6)',  lineHeight: 1, flexShrink: 0 }}>●</span>}
                {/* ▸/▾ expand indicator */}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                  {node.deltas.length > 0 ? (isExpanded ? '▾' : '▸') : ' '}
                </span>
                <span style={{ fontSize: 'var(--text-sm)', flex: 1 }}>{node.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-faint)' }}>
                  {node.deltas.length} delta{node.deltas.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)',
                fontFamily: 'var(--font-mono)' }}>
                {node.timestamp}
              </div>
            </div>

            {/* Delta sub-rows (M7) — revealed when row is expanded */}
            {isExpanded && node.deltas.map((delta) => (
              <div key={delta.virtualPath}
                style={{ display: 'flex', alignItems: 'center',
                  gap: 'var(--space-2)',
                  paddingLeft: 'calc(var(--space-4) * 2)',
                  height: 30,
                  background: 'var(--color-surface-2,rgba(255,255,255,0.04))' }}>
                <ActionBadge action={delta.action} />
                {/* ●/○ changed-vs-base dot */}
                <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)',
                  flexShrink: 0 }}>
                  {delta.action !== 'delete' ? '●' : '○'}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {delta.virtualPath}
                </span>
              </div>
            ))}
          </div>
        );
      })}

      {/* Empty state (no non-baseline changesets) */}
      {nonBaselineChangesets.length === 0 && (
        <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)',
          padding: 'var(--space-4)', textAlign: 'center' }}>
          No versions yet — stage changes and Save version to create one.
        </div>
      )}
    </div>
  );
}
