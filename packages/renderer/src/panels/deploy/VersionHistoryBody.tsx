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
 *                   Per-row Deploy/Revert DROPPED (D-09). "Branch from here" also DROPPED —
 *                   branching is implicit: select the changeset to branch from, then Save
 *                   (sealVersion parents the new version to the selected/active version).
 *
 *   D-04 (SUPERSEDED 2026-07, crew consult): Click row = SELECT (selectVersion — pointer +
 *         staging materialization, NO client mutation). Deploying to the live client is the
 *         explicit "Deploy vN…" action. Rationale: navigate=deploy mutated a real game client
 *         on every click (even expand-to-browse) and threw on unbuilt versions (EISDIR) before
 *         the pointer moved, leaving selection stuck.
 *   D-07:  Confirm fires ONLY when staged (uncommitted) changes would be discarded.
 *   D-08 (REVISED): activeVersionId (selected) and deployedVersionId (live on client) may
 *         legitimately DIVERGE until an explicit Deploy — the lag is meaningful state.
 *         The "live" pip/disc tracks deployedVersionId; the highlight/ring tracks selection.
 *   D-09:  Branching is implicit — select the changeset to branch from, then Save.
 *   VER-04/H5: Undo button + Ctrl+Z re-selects the prior version (snapshots are pushed by
 *         real deploys via syncLiveToVersion, not by navigation).
 *
 *   KEEP: Baseline node (dashed-square, H2b dedup), ▸ per-row delta expansion (M7).
 *   REMOVE: stale banner, inline node ● color hex (nodes now rendered by LaneGutter SVG).
 *
 * vN ordinal: 1-based OLDEST-FIRST (rowIndex+1 from laneLayout.rows). Same derivation
 * feeds the footer "live: vN" and plan 09 statusbar so numbers agree.
 *
 * Source: 04.3-06-PLAN.md; sketch 002-version-graph-timeline/index.html:311-469 (Variant A).
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import path from 'path';

import { useChangesetStore } from '../../state/changesetStore';
import { useStagingStore }   from '../../state/stagingStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useUndoStore }      from '../../state/undoStore';

import { flatten, flatEqual, selectVersion } from '../../services/changesetService';
import { resolveLayout } from '../../services/clientLayout';
import { syncLiveToVersion, type ReconcileCtx } from '../../services/syncLiveToVersion';
import { LaneGutter }        from './LaneGutter';
import { laneLayout, DELTA_ROW_H } from './laneLayout';
import ActionBadge           from './ActionBadge';

import { BASELINE_ID } from '@swg/contracts';
import type { SwgChangeset, LooseDeployRecord } from '@swg/contracts';

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
  const stagingEntries = useStagingStore((s) => s.entries);
  const canUndo     = useUndoStore((s) => s.canUndo);
  const undo        = useUndoStore((s) => s.undo);

  // The LIVE version — what is actually deployed to the game client. When NOTHING is
  // deployed (deployedVersionId === null), the client is at STOCK, i.e. Baseline is live —
  // show the live badge/disc on the Baseline row so the live state is ALWAYS visible
  // (a graph with no live marker read as "impossible to tell what's live").
  const liveVersionId = manifest
    ? (manifest.deployedVersionId ?? BASELINE_ID)
    : null;
  // The SELECTED version — the one whose files are open and that the Deploy button targets
  // (Deploy CTA reads activeVersionId). The row highlight tracks THIS so "which version am I
  // on" is always visible, including when nothing is deployed (deployedVersionId === null).
  const selectedVersionId = manifest?.activeVersionId ?? null;
  const changesets    = useMemo(() => manifest?.changesets ?? [], [manifest]);

  // ▸ Per-row expand state for delta lists (M7)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // D-07 confirm dialog state (targetId = what we're about to navigate to)
  const [confirmPending, setConfirmPending] = useState<{ targetId: string | null } | null>(null);

  // In-flight reconcile guard (D-06: rapid clicks must not queue concurrent reconciles)
  const [isReconciling, setIsReconciling] = useState(false);

  // hasUncommittedWork: TRUE only when the staging working set DIFFERS from the active
  // version's committed (flattened) deltas — NOT merely "staging is non-empty".
  //
  // After Save/Deploy, sealVersion sets activeVersionId to the new version and LEAVES the
  // staging store holding that version's working set, so stagingEntries.length > 0 is still
  // true even though nothing is uncommitted. The old length check made the D-07 confirm
  // ("Discard unsaved changes?") fire — and the LaneGutter WIP stub show — right after a
  // clean save. Fix: compare staging against flatten(activeVersion) with flatEqual, the same
  // dirty check DeployDialog uses (changesetService.flatten / flatEqual).
  // Used for: (1) WIP dashed stub above live node in LaneGutter, (2) D-07 confirm trigger.
  const hasUncommittedWork = useMemo(() => {
    if (stagingEntries.length === 0) return false;
    if (!manifest || !studioDir) return true; // can't compare → assume dirty (prompt is safer)
    try {
      const currentFlat = flatten(manifest.activeVersionId, manifest, studioDir);
      const stagingSorted = [...stagingEntries].sort((a, b) =>
        a.virtualPath < b.virtualPath ? -1 : a.virtualPath > b.virtualPath ? 1 : 0,
      );
      return !flatEqual(stagingSorted, currentFlat);
    } catch {
      return true; // comparison failed (e.g. a stored file went missing) → assume dirty, don't crash
    }
  }, [stagingEntries, manifest, studioDir]);

  // Per-row EXTRA height below the 52px header (expanded delta lists) — feeds laneLayout so
  // SVG node Y stays aligned with row headers when rows expand (variable-height rows).
  // MUST mirror the actual expansion render: N deltas × 30px, or a single 30px baseline note.
  const extraHeights = useMemo(() => {
    const m = new Map<string, number>();
    for (const cs of changesets) {
      if (!expanded.has(cs.id)) continue;
      m.set(cs.id, cs.id === BASELINE_ID ? DELTA_ROW_H : cs.deltas.length * DELTA_ROW_H);
    }
    return m;
  }, [changesets, expanded]);

  // Graph layout (topology-based lane assignment via laneLayout from plan 05).
  // deployed (liveVersionId) drives the accent disc; selected drives the ring + WIP anchor.
  const layout = useMemo(
    () => laneLayout(changesets, liveVersionId, selectedVersionId, hasUncommittedWork, extraHeights),
    [changesets, liveVersionId, selectedVersionId, hasUncommittedWork, extraHeights],
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
      // Distinguish "explicitly deployed Baseline" from "nothing deployed → stock":
      // the latter is the liveVersionId fallback (deployedVersionId === null).
      ? (manifest?.deployedVersionId === BASELINE_ID ? 'Baseline (pristine)' : 'stock — client untouched')
      : null;

  // ─── Core selection (DECOUPLED from deploy — crew consult 2026-07) ────────
  //
  // Clicking a version row SELECTS it: move activeVersionId + materialize the staging
  // working set from flatten(id). NO game-client mutation — selectVersion writes only
  // the manifest + stores. Deploying to the live client is the EXPLICIT "Deploy vN…"
  // action (DeployDialog), which is where syncLiveToVersion belongs.
  //
  // This replaces the former navigate=deploy model (D-04/D-08 "selected ≡ live"):
  // every click deployed to the REAL client (even expand-to-browse), and a version
  // with no built patch made the reconcile throw (EISDIR via scanSharedFile on a
  // directory) BEFORE the pointer moved — selection appeared stuck on baseline.
  // New invariant: activeVersionId (selected/viewing) and deployedVersionId (live on
  // client) legitimately diverge until an explicit Deploy; the lag is meaningful state.

  const doSelect = useCallback(
    (targetId: string | null) => {
      if (isReconciling) return;
      setIsReconciling(true);
      try {
        selectVersion(targetId);
      } catch (err) {
        console.error('[VersionHistoryBody] selectVersion failed:', err);
      } finally {
        setIsReconciling(false);
      }
    },
    [isReconciling],
  );

  // ─── Row click → select (D-07 confirm still guards uncommitted work) ──────

  const handleRowClick = useCallback(
    (targetId: string | null) => {
      if (isReconciling) return; // guard re-entrancy
      if (hasUncommittedWork) {
        // D-07: selecting materializes staging from the target — confirm before
        // discarding genuinely-uncommitted staged changes.
        setConfirmPending({ targetId });
      } else {
        // Clean working set: silent selection (no confirm)
        doSelect(targetId);
      }
    },
    [isReconciling, hasUncommittedWork, doSelect],
  );

  // ─── Undo (VER-04 / H5) ──────────────────────────────────────────────────
  // Note: undo snapshots are pushed by syncLiveToVersion (real deploys). With
  // navigation decoupled, row clicks no longer push snapshots — the bar appears
  // only after an actual deploy/revert mutation.
  //
  // 260703-bpu Task 3: when a client is bound, Undo performs a REAL reconcile —
  // restore the PRIOR deployed state on the client via syncLiveToVersion — not
  // merely re-select the prior version (the old doSelect-only behavior left the
  // client's actual files/cfg untouched, so "Undo" didn't undo anything real).
  // When no client is bound, there is no live state to reconcile against — fall
  // back to the honest degraded path (selection only).

  const handleUndo = useCallback(async () => {
    if (isReconciling) return;
    const snapshot = undo();
    if (!snapshot) return;

    const clientPath = useWorkspaceStore.getState().clientPath;
    if (!clientPath) {
      doSelect(snapshot.priorLiveVersionId);
      return;
    }

    const cfgFile = resolveLayout(clientPath)?.cfgFile ?? 'swgemu.cfg';
    const cfgRootPath = path.join(clientPath, cfgFile);
    const priorLoose: LooseDeployRecord | undefined =
      snapshot.priorDeployRecord && 'overrideDir' in snapshot.priorDeployRecord
        ? (snapshot.priorDeployRecord as LooseDeployRecord)
        : undefined;

    const ctx: ReconcileCtx = {
      manifest,
      studioDir: studioDir ?? '',
      cfgPath: cfgRootPath,
      installRoot: clientPath,
      priorLiveLooseRecord: priorLoose,
    };

    try {
      await syncLiveToVersion(snapshot.priorLiveVersionId, ctx);
    } catch (err) {
      // Undo must never crash the panel — log-and-continue matches the doSelect catch style.
      console.error('[VersionHistoryBody] Undo reconcile failed:', err);
    }
  }, [isReconciling, undo, doSelect, manifest, studioDir]);

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
                onClick={() => setConfirmPending(null)}
                style={{
                  background:   'transparent',
                  color:        'var(--color-text-muted)',
                  border:       '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding:      '6px 14px',
                  fontSize:     'var(--text-sm)',
                  cursor:       'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const t = confirmPending.targetId;
                  setConfirmPending(null);
                  doSelect(t);
                }}
                style={{
                  background:   'var(--color-accent)',
                  color:        'var(--color-accent-text)',
                  border:       'none',
                  borderRadius: 'var(--radius-sm)',
                  padding:      '6px 14px',
                  fontSize:     'var(--text-sm)',
                  fontWeight:   600,
                  cursor:       'pointer',
                }}
              >
                Discard and switch
              </button>
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
            const isSelectedRow  = cs.id === selectedVersionId;
            const isRootRow      = !cs.parentId || !csById.has(cs.parentId!);
            const isBaselineRow  = cs.id === BASELINE_ID;
            const isBranchRow    = branches.has(cs.id);
            const isExpandedRow  = expanded.has(cs.id);
            const vN             = ordinalById.get(cs.id) ?? (row.rowIndex + 1);
            const parentOrdinal  = cs.parentId ? (ordinalById.get(cs.parentId) ?? null) : null;
            const dateStr        = fmtTimestamp(cs.timestamp);

            // A13 (updated): the SELECTED (active) version gets the accent highlight — a 2px
            // accent left-border, a full accent outline, and a lighter surface fill — so it is
            // unmistakably the current version (matches the Deploy button target). This tracks
            // activeVersionId, NOT deployedVersionId, so selection is visible even with nothing deployed.
            const rowBorderLeft = isSelectedRow
              ? '2px solid var(--color-accent)'
              : '2px solid transparent';

            const rowBase: React.CSSProperties = {
              height: 52, // GRAPH-08 / A13: 52px row sizing
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              paddingLeft: 'var(--space-2)',
              paddingRight: 'var(--space-2)',
              // `border` first so the 2px accent `borderLeft` below wins the left edge (A13).
              border: isSelectedRow ? '1px solid var(--color-accent)' : '1px solid transparent',
              borderLeft: rowBorderLeft,
              borderRadius: 'var(--radius-sm)',
              background: isSelectedRow ? 'var(--color-surface-2)' : 'transparent',
              cursor: 'pointer',
              boxSizing: 'border-box',
              transition: 'background 0.1s ease',
            };

            if (isBaselineRow) {
              // Baseline node: dashed border, special label, 0 deltas (H2b / D-08)
              return (
                <div key={cs.id}>
                  <div
                    className={['changeset-node', 'baseline-node', isSelectedRow ? 'is-active' : ''].filter(Boolean).join(' ')}
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
                      // Selected → solid accent outline; otherwise the pristine dashed border.
                      border: isSelectedRow ? '1px solid var(--color-accent)' : '1px dashed var(--color-border)',
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
                  className={['changeset-node', isSelectedRow ? 'is-active' : ''].filter(Boolean).join(' ')}
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
