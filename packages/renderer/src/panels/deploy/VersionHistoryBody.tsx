/**
 * packages/renderer/src/panels/deploy/VersionHistoryBody.tsx
 * Version history graph body — Phase 04.3-06 rework.
 *
 * Rework from Phase 04.1 DEPLOY-05 (flat-list) to Phase 04.3-06 (Git-Graph Lanes):
 *
 *   GRAPH-01 (A1):  Two-column `.graph-container` — 90px `.lane-col` (<LaneGutter/>)
 *                   BESIDE `.graph-rows-col` (independently-laid-out 52px React rows).
 *   GRAPH-06 (A9/A10): `.ver-label` mono vN column; meta line "date · N files · branch from vN".
 *   GRAPH-07 (A11): Bottom status footer "N versions · N branches · live: vN — label".
 *   GRAPH-08 (A13): 52px graph-row, row hover background, is-active accent LEFT-border on
 *                   the LIVE row only (not branch rows — fixes old A13 gap).
 *   VER-08 (A8):    State pip collapses to ONE "live" marker (D-13) + "root" label.
 *                   Per-row Deploy/Revert DROPPED (D-09); "Branch from here" KEPT.
 *
 *   D-04:  Click row = instant silent reconcile (syncLiveToVersion) — version tree IS the deploy control.
 *   D-07:  Confirm fires ONLY when staged (uncommitted) changes would be discarded.
 *   D-08:  Single live pointer; no preview-limbo / no active≠deployed stale concept.
 *   D-09:  Branch-from-here sets parentId intent for NEXT sealVersion — no reconcile.
 *   VER-04/H5: Undo button + Ctrl+Z re-runs syncLiveToVersion to prior version.
 *
 *   KEEP: Baseline node (dashed-square, H2b dedup), ▸ per-row delta expansion (M7).
 *   REMOVE: stale banner (D-08: stale concept gone), selectVersion import (replaced by syncLiveToVersion).
 *   REMOVE: inline node ● color hex (nodes now rendered by LaneGutter SVG).
 *
 * vN ordinal: 1-based OLDEST-FIRST (rowIndex+1 from laneLayout.rows). Same derivation
 * feeds the footer "live: vN" and plan 09 statusbar so numbers agree.
 *
 * Source: 04.3-06-PLAN.md; sketch 002-version-graph-timeline/index.html:311-469 (Variant A).
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import { useChangesetStore } from '../../state/changesetStore';
import { useStagingStore }   from '../../state/stagingStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useUndoStore }      from '../../state/undoStore';

import { syncLiveToVersion } from '../../services/syncLiveToVersion';
import type { ReconcileCtx } from '../../services/syncLiveToVersion';
import { LaneGutter }        from './LaneGutter';
import { laneLayout }        from './laneLayout';
import ActionBadge           from './ActionBadge';

import { BASELINE_ID } from '@swg/contracts';
import type { SwgChangeset } from '@swg/contracts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns IDs of branch-start nodes: those whose parentId differs from their
 * chronological predecessor's id (i.e. they branch off an earlier point, not trunk).
 */
function branchSet(cs: SwgChangeset[]): Set<string> {
  const sorted = [...cs].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
  const s = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.parentId !== sorted[i - 1]!.id) s.add(sorted[i]!.id);
  }
  return s;
}

/**
 * Format a raw ISO timestamp as "YYYY-MM-DD HH:MM" for the meta line.
 * Handles both "Z"-suffix and offset forms by slicing the ISO string directly.
 */
function fmtTimestamp(ts: string): string {
  // ts is an ISO 8601 string: 2026-06-26T14:00:00.000Z
  // Slice to first 16 chars and replace 'T' with ' '.
  return ts.length >= 16 ? ts.slice(0, 10) + ' ' + ts.slice(11, 16) : ts;
}

// ─── VersionHistoryBody ───────────────────────────────────────────────────────

export default function VersionHistoryBody(): React.JSX.Element {
  const manifest    = useChangesetStore((s) => s.manifest);
  const studioDir   = useWorkspaceStore((s) => s.studioDir);
  const clientPath  = useWorkspaceStore((s) => s.clientPath);
  const stagingEntries = useStagingStore((s) => s.entries);
  const canUndo     = useUndoStore((s) => s.canUndo);
  const undo        = useUndoStore((s) => s.undo);

  const liveVersionId = manifest?.deployedVersionId ?? null;
  const changesets    = useMemo(() => manifest?.changesets ?? [], [manifest]);

  // ▸ Per-row expand state for delta lists (M7)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // D-07 confirm dialog state (targetId = what we're about to navigate to)
  const [confirmPending, setConfirmPending] = useState<{ targetId: string | null } | null>(null);

  // Branch-from intent state (for the next sealVersion call — D-09)
  const [branchFromId, setBranchFromId] = useState<string | null>(null);

  // In-flight reconcile guard (D-06: rapid clicks must not queue concurrent reconciles)
  const [isReconciling, setIsReconciling] = useState(false);

  // hasUncommittedWork: true when staging area has staged (unsaved) changes.
  // Used for: (1) WIP dashed stub above live node in LaneGutter, (2) D-07 confirm trigger.
  // Computed ONCE per render — same value used by both laneLayout and the D-07 guard.
  const hasUncommittedWork = stagingEntries.length > 0;

  // Graph layout (topology-based lane assignment via laneLayout from plan 05)
  const layout = useMemo(
    () => laneLayout(changesets, liveVersionId, hasUncommittedWork),
    [changesets, liveVersionId, hasUncommittedWork],
  );

  // Changeset lookup map (O(1) by id)
  const csById = useMemo(
    () => new Map<string, SwgChangeset>(changesets.map((c) => [c.id, c])),
    [changesets],
  );

  // vN ordinal by changeset id (1-based, oldest-first per layout.rows order)
  const ordinalById = useMemo(() => {
    const m = new Map<string, number>();
    layout.rows.forEach((r) => m.set(r.id, r.rowIndex + 1));
    return m;
  }, [layout.rows]);

  // Branch detection: nodes that start a visual branch (parentId ≠ chronological predecessor)
  const branches = useMemo(() => branchSet(changesets), [changesets]);

  // Footer counts
  const versionCount = layout.rows.length;
  const branchCount  = branches.size;
  const liveOrdinal  = liveVersionId ? (ordinalById.get(liveVersionId) ?? null) : null;
  const liveLabel    =
    liveVersionId && liveVersionId !== BASELINE_ID
      ? (csById.get(liveVersionId)?.label ?? null)
      : liveVersionId === BASELINE_ID
      ? 'Baseline (pristine)'
      : null;

  // ─── Reconcile context builder ────────────────────────────────────────────

  const buildCtx = useCallback((): ReconcileCtx | null => {
    if (!manifest || !studioDir) return null;
    return {
      manifest,
      studioDir,
      // Best-effort: clientPath works for both loose-override (searchPath dir detection)
      // and cfg-model (auto-detect layout from dir). Falls back to studioDir when absent.
      cfgPath:     clientPath ?? studioDir,
      installRoot: clientPath ?? studioDir,
    };
  }, [manifest, studioDir, clientPath]);

  // ─── Core reconcile ──────────────────────────────────────────────────────

  const doReconcile = useCallback(
    async (targetId: string | null) => {
      if (isReconciling) return;
      const ctx = buildCtx();
      if (!ctx) return;
      setIsReconciling(true);
      try {
        await syncLiveToVersion(targetId, ctx);
        // setLiveVersion is called inside syncLiveToVersion (D-08 single pointer).
      } finally {
        setIsReconciling(false);
      }
    },
    [isReconciling, buildCtx],
  );

  // ─── Row click → reconcile (D-04 / D-07) ─────────────────────────────────

  const handleRowClick = useCallback(
    (targetId: string | null) => {
      if (isReconciling) return; // guard concurrent reconciles
      if (hasUncommittedWork) {
        // D-07: confirm before discarding uncommitted staged changes
        setConfirmPending({ targetId });
      } else {
        // Clean working set: silent reconcile (no confirm)
        void doReconcile(targetId);
      }
    },
    [isReconciling, hasUncommittedWork, doReconcile],
  );

  // ─── Undo (VER-04 / H5) ──────────────────────────────────────────────────

  const handleUndo = useCallback(async () => {
    if (isReconciling) return;
    const snapshot = undo();
    if (!snapshot) return;
    await doReconcile(snapshot.priorLiveVersionId);
  }, [isReconciling, undo, doReconcile]);

  // Ctrl+Z keyboard shortcut for undo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z' && canUndo) {
        void handleUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUndo, handleUndo]);

  // ─── Expand toggle ────────────────────────────────────────────────────────

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Void the branchFromId from lint (it is tracked for plan 09 parentId wiring) ──
  void branchFromId;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* D-07: Unsaved-changes confirm dialog */}
      {confirmPending !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Discard unsaved changes?"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              minWidth: 280,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              {'Discard unsaved changes and switch to '}
              {confirmPending.targetId === BASELINE_ID
                ? 'Baseline'
                : confirmPending.targetId
                ? `v${ordinalById.get(confirmPending.targetId) ?? '?'}`
                : 'Baseline'}
              {'?'}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  const t = confirmPending.targetId;
                  setConfirmPending(null);
                  void doReconcile(t);
                }}
              >
                Discard and switch
              </button>
              <button onClick={() => setConfirmPending(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* VER-04 / H5: Undo affordance — button (Ctrl+Z is the keyboard shortcut) */}
      {canUndo && (
        <div
          style={{
            padding: 'var(--space-1) var(--space-4)',
            borderBottom: '1px solid var(--color-border-soft)',
            display: 'flex',
            gap: 'var(--space-2)',
            alignItems: 'center',
            background: 'var(--color-header)',
            flexShrink: 0,
          }}
        >
          <button
            data-testid="undo-btn"
            onClick={() => void handleUndo()}
            style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              padding: '2px var(--space-2)',
              cursor: 'pointer',
            }}
            title="Undo last version switch (Ctrl+Z)"
          >
            Undo
          </button>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
            Ctrl+Z
          </span>
        </div>
      )}

      {/* GRAPH-01 (A1): Two-column graph container */}
      <div
        className="graph-container"
        style={{
          display: 'flex',
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {/* Lane SVG — 90px wide (or wider for >2 concurrent lanes per laneLayout) */}
        <div
          className="lane-col"
          style={{
            width: layout.width,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'flex-start',
          }}
        >
          <LaneGutter layout={layout} />
        </div>

        {/* Row content — independently laid-out, 52px per row (aligns to SVG node cy) */}
        <div className="graph-rows-col" style={{ flex: 1 }}>
          {layout.rows.map((row) => {
            const cs = csById.get(row.id);
            if (!cs) return null;

            const isLiveRow      = cs.id === liveVersionId;
            const isRootRow      = !cs.parentId || !csById.has(cs.parentId!);
            const isBaselineRow  = cs.id === BASELINE_ID;
            const isBranchRow    = branches.has(cs.id);
            const isExpandedRow  = expanded.has(cs.id);
            const vN             = ordinalById.get(cs.id) ?? (row.rowIndex + 1);
            const parentOrdinal  = cs.parentId ? (ordinalById.get(cs.parentId) ?? null) : null;
            const dateStr        = fmtTimestamp(cs.timestamp);

            // A13: is-active accent LEFT-border on LIVE row only (not branch rows)
            const rowBorderLeft = isLiveRow
              ? '2px solid var(--color-accent)'
              : '2px solid transparent';

            const rowBase: React.CSSProperties = {
              height: 52, // GRAPH-08 / A13: 52px row sizing
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              paddingLeft: 'var(--space-2)',
              paddingRight: 'var(--space-2)',
              borderLeft: rowBorderLeft,
              cursor: 'pointer',
              boxSizing: 'border-box',
              transition: 'background 0.1s ease',
            };

            if (isBaselineRow) {
              // Baseline node: dashed border, special label, 0 deltas (H2b / D-08)
              return (
                <div key={cs.id}>
                  <div
                    className={['changeset-node', 'baseline-node', isLiveRow ? 'is-active' : ''].filter(Boolean).join(' ')}
                    data-changeset-id={BASELINE_ID}
                    role="button"
                    tabIndex={0}
                    aria-label={`Switch to v${vN} Baseline`}
                    onClick={() => {
                      handleRowClick(BASELINE_ID);
                      toggleExpand(BASELINE_ID);
                    }}
                    style={{
                      ...rowBase,
                      border: '1px dashed var(--color-border)',
                      borderLeft: rowBorderLeft,
                      borderRadius: 'var(--radius-sm)',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      justifyContent: 'center',
                      paddingLeft: 'var(--space-2)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%' }}>
                      {/* GRAPH-06 / A9: vN mono label */}
                      <span
                        className="ver-label"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          color: 'var(--color-text-faint)',
                          width: 28,
                          flexShrink: 0,
                          textAlign: 'right',
                        }}
                      >
                        v{vN}
                      </span>
                      {/* VER-08 / A8: pip — live marker or root label (D-13) */}
                      {isLiveRow ? (
                        <span className="ver-pip" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', flexShrink: 0 }}>
                          live
                        </span>
                      ) : (isRootRow && (
                        <span className="ver-pip" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', flexShrink: 0 }}>
                          root
                        </span>
                      ))}
                      <div className="ver-info" style={{ flex: 1, minWidth: 0 }}>
                        {/* ▸ Baseline title (expand indicator) */}
                        <div className="ver-title" style={{ fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {isExpandedRow ? '▾' : '▸'} Baseline (pristine)
                        </div>
                        {/* A10: meta line */}
                        <div
                          className="ver-meta"
                          style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}
                        >
                          0 deltas · shadow ≡ source
                        </div>
                      </div>
                      {/* D-09: Branch from here (no reconcile — sets parentId intent for next sealVersion) */}
                      <div className="row-actions" aria-hidden="true">
                        <button
                          className="act-branch"
                          title="Branch from here"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBranchFromId(cs.id);
                          }}
                        >
                          Branch from here
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* M7: delta expansion — Baseline always has 0 deltas, so none rendered */}
                  {isExpandedRow && cs.deltas.length === 0 && (
                    <div
                      style={{
                        paddingLeft: 'calc(var(--space-4) * 2)',
                        height: 30,
                        display: 'flex',
                        alignItems: 'center',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-faint)',
                        background: 'var(--color-surface-2,rgba(255,255,255,0.04))',
                      }}
                    >
                      No deltas — pristine stock files
                    </div>
                  )}
                </div>
              );
            }

            // Regular version row
            return (
              <div key={cs.id}>
                {/* GRAPH-08 / A13: 52px row, hover background, is-active accent LEFT-border */}
                <div
                  className={['changeset-node', isLiveRow ? 'is-active' : ''].filter(Boolean).join(' ')}
                  data-changeset-id={cs.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Switch to v${vN}`}
                  onClick={() => {
                    handleRowClick(cs.id);
                    toggleExpand(cs.id);
                  }}
                  style={rowBase}
                >
                  {/* GRAPH-06 / A9: vN mono label column */}
                  <span
                    className="ver-label"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-faint)',
                      width: 28,
                      flexShrink: 0,
                      textAlign: 'right',
                    }}
                  >
                    v{vN}
                  </span>

                  {/* VER-08 / A8: ONE state pip — "live" on live row, "root" on root, else nothing */}
                  {isLiveRow ? (
                    <span className="ver-pip" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', flexShrink: 0 }}>
                      live
                    </span>
                  ) : isRootRow ? (
                    <span className="ver-pip" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', flexShrink: 0 }}>
                      root
                    </span>
                  ) : (
                    <span className="ver-pip" style={{ width: 30, flexShrink: 0 }} />
                  )}

                  {/* GRAPH-06 / A10: ver-info block (title + meta line) */}
                  <div className="ver-info" style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="ver-title"
                      style={{
                        fontSize: 'var(--text-sm)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {/* ▸/▾ expand indicator */}
                      <span>{cs.deltas.length > 0 ? (isExpandedRow ? '▾' : '▸') : ' '}</span>
                      {' '}
                      <span>{cs.label}</span>
                    </div>
                    {/* GRAPH-06 / A10: meta line — "date · N files [· branch from vN]" */}
                    <div
                      className="ver-meta"
                      style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}
                    >
                      {dateStr} · {cs.deltas.length} file{cs.deltas.length !== 1 ? 's' : ''}
                      {isBranchRow && parentOrdinal !== null ? ` · branch from v${parentOrdinal}` : ''}
                    </div>
                  </div>

                  {/* D-09: "Branch from here" action only — NO per-row Deploy vN / Revert here */}
                  <div className="row-actions" aria-hidden="true">
                    <button
                      className="act-branch"
                      title="Branch from here"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBranchFromId(cs.id);
                      }}
                    >
                      Branch from here
                    </button>
                  </div>
                </div>

                {/* M7: delta sub-rows — revealed when row is expanded */}
                {isExpandedRow &&
                  cs.deltas.map((delta) => (
                    <div
                      key={delta.virtualPath}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        paddingLeft: 'calc(var(--space-4) * 2)',
                        height: 30,
                        background: 'var(--color-surface-2,rgba(255,255,255,0.04))',
                      }}
                    >
                      <ActionBadge action={delta.action} />
                      {/* ●/○ changed-vs-base dot */}
                      <span
                        style={{
                          color: 'var(--color-text-faint)',
                          fontSize: 'var(--text-xs)',
                          flexShrink: 0,
                        }}
                      >
                        {delta.action !== 'delete' ? '●' : '○'}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {delta.virtualPath}
                      </span>
                    </div>
                  ))}
              </div>
            );
          })}

          {/* Empty state (no versions at all) */}
          {layout.rows.length === 0 && (
            <div
              style={{
                color: 'var(--color-text-faint)',
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-4)',
                textAlign: 'center',
              }}
            >
              No versions yet — stage changes and Save version to create one.
            </div>
          )}
        </div>
      </div>

      {/* GRAPH-07 / A11: Status footer "N versions · N branches · live: vN — label" */}
      <div
        className="graph-status-footer"
        style={{
          padding: 'var(--space-2) var(--space-4)',
          borderTop: '1px solid var(--color-border-soft)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
          display: 'flex',
          gap: 12,
          background: 'var(--color-header)',
          flexShrink: 0,
        }}
      >
        <span>
          {versionCount} version{versionCount !== 1 ? 's' : ''} · {branchCount} branch{branchCount !== 1 ? 'es' : ''}
        </span>
        {liveOrdinal !== null && liveLabel !== null && (
          <span>
            {'live: '}
            <span style={{ color: 'var(--color-accent)' }}>
              v{liveOrdinal} — {liveLabel}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
