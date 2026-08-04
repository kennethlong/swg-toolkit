/**
 * packages/renderer/src/panels/world/WorldPanel.tsx
 * The World dockview tab (sketch 019-A, Variant A — Building Tree). 05.1-10 Task 2.
 *
 * Builds 019-A's full spine: the building-first tree (buildings own the hierarchy, decorations
 * nest under their building), the mirror-mode toggle (wired to Plan 06's per-project
 * reconcileMirrorMode), the live-session strip (mirrors StatusBar.tsx's useLiveStore idiom), and
 * a selection detail card (all 05.1-10 Task 2) — plus (05.1-11) the Activity accordion (D-06
 * session persist history), the Scene accordion (D-07 editor-scene launcher/reload/teleport
 * bookmarks), and the footer's Add-decoration/Stage-to-project buttons (both intentional stubs
 * this plan, per their own behavior specs — see handleStubClick call sites below).
 *
 * resolveOverridePair() (ROUND 4/W3, ROUND 5/V6, ROUND 6/X1) is the ONE shared, null-safe helper
 * every write/refresh call site in this file uses to resolve {overrideDir, readVfs, meta,
 * studioDir}. It is a PLAIN function (never a hook) invoked from event handlers and effects, so
 * it reads studioDir via useWorkspaceStore.getState() — never the hook-selector form, which would
 * throw "Invalid hook call" the first time a user clicks a write action in this panel.
 *
 * Badge derivation (building/decoration status badges) is Claude's discretion, documented inline
 * — see deriveDecorationBadge/deriveBuildingBadge below. This plan's disk-scanned tree has no
 * signal distinguishing "confirmed applied this session" from "always was on disk", so a row not
 * armed/failed this session renders as SAVED (D-05: anything in the tree is, by definition,
 * persisted).
 *
 * NOTE (sketch-vs-reality gap, disclosed per AGENTS.md): 019-A's live-strip mock shows a
 * "scene chip" (e.g. "tatooine"). No field anywhere in this codebase (liveStore, the shared
 * channel contracts, or worldEditorStore) tracks the attached client's current scene/planet name
 * — this plan's own Plan 11 sibling (Scene accordion) doesn't add one either. Rendering a fake
 * value would violate the accuracy_requirement, so the live-strip's scene chip renders an honest
 * "scene: not tracked yet" placeholder rather than a fabricated planet name.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import fs from 'fs';
import path from 'path';

import type { WorkspaceBindingMeta } from '@swg/contracts';
import {
  useWorldEditorStore,
  worldEditorRowId,
  worldEditorBuildingRowId,
  parseWorldEditorRowId,
  formatPersistMessage,
  type SessionOverlayStatus,
  type PersistHistoryEntry,
  type PersistOutcome,
} from '../../state/worldEditorStore';
import type { WorldEditorBuilding, WorldEditorDecoration } from '../../services/worldEditorScan';
import { useLiveStore } from '../../state/liveStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { resolveScanRoot } from '../../services/worldEditorScan';
import {
  makeReadVfs,
  reconcileMirrorMode,
  removeDecorationRow,
  addBackDecorationRow,
} from '../../services/decorationPersistOrchestrator';
import { readWorkspaceJson, updateWorkspaceMeta } from '../../services/projectBinding';
import { readInteriorLayoutFileName } from '../../services/buildingTemplate';
import { log } from '../../services/logService';
import {
  sendReloadCurrentScene,
  sendLoadEditorScene,
  sendTeleport,
  sendStartPlacement,
} from '../../services/hostCommand';
import { useRemoveUndoStore, type RemovedRowEntry } from '../../state/removeUndoStore';
import RemoveUndoToast from './RemoveUndoToast';
import AddDecorationModal from './AddDecorationModal';

type WorldEditorBookmark = NonNullable<WorkspaceBindingMeta['worldEditorBookmarks']>[number];

// ─── HOST_CMD ACK PROTOCOL constants (05.1-08's CANONICAL SPEC — 05.1-14 Task 3) ──────────────
//
// This file is the renderer-side CONSUMER of that protocol, not its definition. Plan 08's
// `HOST_CMD ACK PROTOCOL` section is the single authoritative statement: the state × event table,
// the precedence order, and the late-ack rule all live there. Under its CC8 restatement
// discipline, the strings below are quoted CHARACTER-IDENTICALLY and no rule is implemented here
// that is absent from that section.

/**
 * 11_000 = a 10_000 ms ack-PUBLISH budget (the agent's frame loop answers in ~16 ms when
 * responsive; the budget covers ordinary in-game latency) + a 1_000 ms READ margin, one
 * moderate-throttle poll interval (`useChannelReader.ts` throttles the ~33 ms poll to ~1/s while
 * the game holds the foreground), since the deadline bounds when the RENDERER READS the ack, not
 * when the agent publishes it.
 *
 * The +1 s is NOT a worst-case read-lag bound (Plan 08, R11/EE6): under INTENSIVE background
 * throttling (toolkit occluded by the fullscreen game for ~5+ min) timer wake-ups drop to ~1/min
 * and read lag can reach ~60 s. What keeps this honest there is THROTTLE SYMMETRY, not the
 * margin — this setTimeout is throttled by the SAME clock as the poll loop, so it fires
 * proportionally late too; it can only fire LATE, never early, and the callback's re-check
 * no-ops it whenever the ack already resolved on an earlier wake.
 */
const PLACEMENT_ACK_TIMEOUT_MS = 11_000;

/** Plan 08 Canonical string 1 — refusal (row 6): toast AND history message. */
const PLACEMENT_REFUSED_MESSAGE =
  'Placement request was refused — an edit or placement may already be active in-game, possibly an earlier request that timed out here but was accepted late. Cancel it in-game, then try again.';

/** Plan 08 Canonical string 2 — timeout (row 9): toast AND history message. */
const PLACEMENT_TIMEOUT_MESSAGE =
  'Placement request got no response from the game (it may be loading, zoning, or busy) — if the placement ghost is active in-game, placing and persisting will still work; otherwise try again.';

/** Plan 08 Canonical string 3 — detached (row 10): history message. */
const PLACEMENT_DETACHED_MESSAGE = 'client detached before the placement was acknowledged';

/** Plan 08 Canonical string 4 — local refuse (row 13, self-loop): NAMES the pending request. */
function placementStillWaitingMessage(decorationLabel: string, buildingLabel: string): string {
  return `A placement request for ${decorationLabel} in ${buildingLabel} is still waiting for the game's response — try again in a moment.`;
}

/**
 * 05.1-14 Task 2's success copy (code-1 ack only). Task 2 DEFINES this string; Task 3 alone
 * decides when it renders (R9 review, BB1). The wrong-room warning is C6's mitigation: Plan 12's
 * building-id guard closes the wrong-BUILDING case, but nothing can verify the click landed in
 * the correct ROOM of a multi-cell building — no advertised endpoint resolves a click's cell name.
 * The warning makes that residual an INFORMED risk rather than a silent one.
 */
function placementActiveMessage(cellName: string): string {
  return `Placement mode active in-game — place the object, then Persist. Click ONLY in the SAME ROOM as the decoration you selected in ${cellName} — this building may have other rooms the toolkit can't distinguish yet.`;
}

/** The pending slot (Plan 08: exactly one outstanding request). `studioDir` is captured at SEND
 *  time so every resolution path enforces the switch-abort LOCALLY, independent of React effect
 *  declaration order (R10 review, CC2). */
interface PendingPlacement {
  epoch: number;
  studioDir: string | null;
  buildingId: string;
  buildingLabel: string;
  templatePath: string;
  cellName: string;
}

/** The overlay's own manual-fields defaults (overlay.cpp:1637-1638) — the Scene accordion's
 *  Editor-scene launcher starts from the SAME defaults the in-game ImGui fields use. */
const DEFAULT_EDITOR_TERRAIN = 'terrain/tatooine.trn';
const DEFAULT_EDITOR_AVATAR = 'object/creature/player/shared_human_male.iff';

// ─── Small formatting helpers ───────────────────────────────────────────────────

/** Basename of a VFS-style ('/') or OS-style ('\\') path — never throws. */
function baseNameOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

/** Translation columns (3, 7, 11) of a row-major 3x4 o2p transform, 2 decimals. */
function formatPosition(t: number[]): string {
  const x = (t[3] ?? 0).toFixed(2);
  const y = (t[7] ?? 0).toFixed(2);
  const z = (t[11] ?? 0).toFixed(2);
  return `${x}, ${y}, ${z}`;
}

/** D-13 FULL 12-element readout, grouped 4/row, 2 decimals — NOT translation-only (ROUND-3-
 *  REVIEW R4): a rotate-only edit changes 9 of these 12 elements, so this renders visibly
 *  different before vs. after even when translation is identical. */
function formatTransform12(t: number[]): string {
  const f = (n: number | undefined) => (n ?? 0).toFixed(2);
  const rows = [t.slice(0, 4), t.slice(4, 8), t.slice(8, 12)];
  return rows.map((row) => row.map(f).join(' ')).join(' / ');
}

// ─── Badge derivation (Claude's discretion — documented) ────────────────────────

interface Badge {
  label: string;
  kind: 'ok' | 'pend' | 'orph';
}

/** A decoration row's badge: 'armed'/'failed' overlay wins; anything else (including no overlay
 *  entry at all) renders SAVED — the disk-scanned tree only ever contains persisted rows. */
function deriveDecorationBadge(status: SessionOverlayStatus | undefined): Badge {
  if (status === 'armed') return { label: 'ARMED', kind: 'pend' };
  if (status === 'failed') return { label: 'FAILED', kind: 'orph' };
  return { label: 'SAVED', kind: 'ok' };
}

/** A building row's badge aggregates its decorations' overlay statuses: any FAILED wins over any
 *  ARMED, which wins over the SAVED default (matching deriveDecorationBadge's own precedence). */
function deriveBuildingBadge(building: WorldEditorBuilding, overlay: Map<string, SessionOverlayStatus>): Badge {
  let armed = 0;
  let failed = 0;
  for (const d of building.decorations) {
    const status = overlay.get(worldEditorRowId(building.buildingId, d.cellName, d.rowIndex));
    if (status === 'armed') armed++;
    else if (status === 'failed') failed++;
  }
  if (failed > 0) return { label: `${failed} FAILED`, kind: 'orph' };
  if (armed > 0) return { label: `${armed} ARMED`, kind: 'pend' };
  return { label: `${building.decorations.length} SAVED`, kind: 'ok' };
}

function badgeColors(kind: Badge['kind']): { background: string; color: string } {
  if (kind === 'orph') return { background: 'rgba(224,88,79,.15)', color: 'var(--color-danger)' };
  if (kind === 'pend') return { background: 'rgba(224,161,58,.15)', color: 'var(--color-warn)' };
  return { background: 'var(--color-accent-dim)', color: 'var(--color-accent)' };
}

// ─── Activity accordion helpers (D-06/SC1) ───────────────────────────────────────

/** Words-only outcome glyph — matches sketch 019-A's ok/err/wrn status-line idiom (never a raw
 *  code, per SC1). */
function outcomeGlyph(outcome: PersistOutcome): string {
  if (outcome === 'ok') return '✓';
  if (outcome === 'warn') return '△';
  return '✗';
}

function outcomeColor(outcome: PersistOutcome): string {
  if (outcome === 'ok') return 'var(--color-accent)';
  if (outcome === 'warn') return 'var(--color-warn)';
  return 'var(--color-danger)';
}

// ─── Shared collapsible-section header (Activity/Scene reuse the SAME primitive "Edited
//     buildings" already established — never a second collapsible implementation) ──────────────

function AccordionHeader({
  label,
  open,
  onToggle,
  chip,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  chip: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        background: 'var(--color-header)',
        borderTop: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 9, color: 'var(--color-text-faint)' }}>
        {open ? '▾' : '▸'}
      </span>
      {label}
      <span
        style={{
          marginLeft: 'auto',
          font: '600 10px/1 var(--font-sans)',
          padding: '3px 7px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-widget)',
          color: 'var(--color-text-muted)',
        }}
      >
        {chip}
      </span>
    </div>
  );
}

// ─── D-07b client-path mismatch check ────────────────────────────────────────────

/** Same longest-prefix, case-insensitive comparison resolveRunningClientOverrideDir already uses
 *  (decorationPersistOrchestrator.ts) — an exe path "matches" a bound install dir when it equals
 *  it or sits under it. */
function isClientPathMismatch(clientExe: string, boundClientPath: string): boolean {
  const exeNorm = clientExe.replace(/\\/g, '/').toLowerCase();
  const boundNorm = boundClientPath.replace(/\\/g, '/').toLowerCase();
  return !(exeNorm === boundNorm || exeNorm.startsWith(`${boundNorm}/`));
}

// ─── Resolved override pair ──────────────────────────────────────────────────────

interface OverridePair {
  overrideDir: string;
  readVfs: (vfsPath: string) => Buffer;
  meta: WorkspaceBindingMeta;
  studioDir: string;
}

// ─── "(NEW)" content-identity diff (05.1-14 Task 2 — ROUND 4/W2, ROUND 5/V2+V3, ROUND 6/X3) ───

/** The content-identity key. Deliberately EXCLUDES rowIndex: a row's numeric position changing
 *  (Plan 13's Undo re-adds at the END of its cell per D-01's append-only mandate, shifting every
 *  later same-cell row's id) is a REINDEX, never a placement. */
function decorationTupleKey(cellName: string, objectTemplateName: string): string {
  return `${cellName}::${objectTemplateName}`;
}

/**
 * Walks the new tree against the previous snapshot and returns the row ids whose CONTENT has no
 * matching occurrence in that snapshot — i.e. genuinely-new placements.
 *
 * Shares ONLY the identity key and the duplicate-ambiguity posture of Plan 04's `refresh()`
 * reconciliation — NOT its routine (ROUND 5/V9): `refresh()` walks SPARSE overlay entries with a
 * positional-nearest tiebreak; this walks the FULL tree against a per-building count map with a
 * consumption-order tiebreak. Different algorithm, different purpose.
 *
 * Two decorations sharing template+cellName in one building are content-ambiguous to any id
 * scheme this phase ships, so a genuine ADD among duplicates may tag the "wrong" one of several
 * identical rows — an accepted limitation, no worse than Plan 04's own documented tiebreak and
 * vastly better than a raw positional diff.
 *
 * @param prevTree The previous snapshot, or `null` for the first pass (marks NOTHING — ROUND
 *   5/V3's null sentinel: a fresh mount's `[] → populated` transition is an observation, not a
 *   placement).
 * @param suppressedByBuilding Pre-credits from Plan 13's `suppressNextDiffRef` QUEUE: extra count
 *   allowances that absorb Undo-restored rows so a restore is never marked "(NEW)" (ROUND 6/X3).
 *   The diff still RUNS — this is never a blanket skip — so any OTHER row landing in the same
 *   refresh window is still diffed and marked normally.
 */
export function computeNewRowIds(
  tree: WorldEditorBuilding[],
  prevTree: WorldEditorBuilding[] | null,
  suppressedByBuilding: Map<string, Map<string, number>>,
): Set<string> {
  const marked = new Set<string>();
  if (prevTree === null) return marked;

  const prevById = new Map(prevTree.map((b) => [b.buildingId, b]));

  for (const building of tree) {
    const prev = prevById.get(building.buildingId);
    // ROUND 5/V3 — REVERSED absent-building rule: a building absent from the prior snapshot is a
    // whole-building FIRST OBSERVATION (D-05's disk scan surfaces a building all at once on its
    // first-ever edit), never a set of placements. Contributes ZERO "(NEW)" rows.
    if (!prev) continue;

    const counts = new Map<string, number>();
    for (const d of prev.decorations) {
      const k = decorationTupleKey(d.cellName, d.objectTemplateName);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    // Pre-credit every queued suppression for this building. A tuple appearing MORE THAN ONCE in
    // the queue adds ANOTHER credit rather than overwriting a prior one (ROUND 7/Z5's append-only
    // queue), so N content-identical restorations absorb exactly N rows.
    const sup = suppressedByBuilding.get(building.buildingId);
    if (sup) {
      for (const [k, extra] of sup) counts.set(k, (counts.get(k) ?? 0) + extra);
    }

    const ordered = [...building.decorations].sort((a, b) => a.rowIndex - b.rowIndex);
    for (const d of ordered) {
      const k = decorationTupleKey(d.cellName, d.objectTemplateName);
      const remaining = counts.get(k) ?? 0;
      if (remaining > 0) counts.set(k, remaining - 1);
      else marked.add(worldEditorRowId(building.buildingId, d.cellName, d.rowIndex));
    }
  }

  return marked;
}

/** Groups a drained `suppressNextDiffRef` queue into per-building tuple credit counts. */
export function groupSuppressedByBuilding(
  suppressed: Array<{ buildingId: string; cellName: string; objectTemplateName: string }>,
): Map<string, Map<string, number>> {
  const byBuilding = new Map<string, Map<string, number>>();
  for (const s of suppressed) {
    let tuples = byBuilding.get(s.buildingId);
    if (!tuples) {
      tuples = new Map<string, number>();
      byBuilding.set(s.buildingId, tuples);
    }
    const k = decorationTupleKey(s.cellName, s.objectTemplateName);
    tuples.set(k, (tuples.get(k) ?? 0) + 1);
  }
  return byBuilding;
}

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ─── Component ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function WorldPanel(props: IDockviewPanelProps<any>): React.ReactElement {
  const tree = useWorldEditorStore((s) => s.tree);
  const selectedRowId = useWorldEditorStore((s) => s.selectedRowId);
  const sessionOverlay = useWorldEditorStore((s) => s.sessionOverlay);
  const history = useWorldEditorStore((s) => s.history);
  const hasFailureBadge = useWorldEditorStore((s) => s.hasFailureBadge);
  const select = useWorldEditorStore((s) => s.select);
  const refresh = useWorldEditorStore((s) => s.refresh);

  // (ROUND-3-REVIEW R8/M2) TWO SEPARATE selectors — clientLabel is NOT a field on the 'attached'
  // status-union member; liveStatus.clientLabel does not type-check.
  const liveStatus = useLiveStore((s) => s.status);
  const clientLabel = useLiveStore((s) => s.clientLabel);
  // The active project's bound client path (workspaceStore mirrors WorkspaceBindingMeta.clientPath
  // at open time) — a safe hook read for the D-07b mismatch hint, computed during render.
  const boundClientPath = useWorkspaceStore((s) => s.clientPath);
  // (ROUND 10, AA5 — 05.1-13) Used ONLY to key <RemoveUndoToast> so a project switch forces a
  // full unmount/remount of that component's local state — every OTHER read of studioDir in
  // this file still goes through resolveOverridePair()'s imperative getState() form (ROUND 6/X1).
  const studioDir = useWorkspaceStore((s) => s.studioDir);

  const [scanRootAvailable, setScanRootAvailable] = useState(false);
  const [mirrorToStockIlf, setMirrorToStockIlf] = useState(true);
  const [buildingsOpen, setBuildingsOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);

  // ── Scene accordion state (D-07) ────────────────────────────────────────────────────────────
  const [edTerrain, setEdTerrain] = useState(DEFAULT_EDITOR_TERRAIN);
  const [edAvatar, setEdAvatar] = useState(DEFAULT_EDITOR_AVATAR);
  const [bookmarks, setBookmarks] = useState<WorldEditorBookmark[]>([]);
  const [newBookmarkName, setNewBookmarkName] = useState('');
  const [newBookmarkX, setNewBookmarkX] = useState('');
  const [newBookmarkY, setNewBookmarkY] = useState('');
  const [newBookmarkZ, setNewBookmarkZ] = useState('');

  // ── ADD-decoration flow (05.1-14 Tasks 2/3) ─────────────────────────────────────────────────
  const [addModalOpen, setAddModalOpen] = useState(false);
  /** The one placement toast surface. Plan 08's protocol decides WHEN this is ever non-null —
   *  never at send time (R9 review, BB1). */
  const [placementToast, setPlacementToast] = useState<string | null>(null);
  /** CC17's ambient pending signal: a render-visible mirror of slot occupancy driving the
   *  "+ Add decoration…" trigger's disabled state. Cleared on EVERY exit transition (R11/EE1) so
   *  an interrupted request can never wedge the trigger for the session. */
  const [isPlacementPending, setPlacementPending] = useState(false);
  const pendingPlacementRef = useRef<PendingPlacement | null>(null);
  const placementTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ROUND 5/V3 — a NULL SENTINEL, not an empty array, so the very first pass is distinguishable
   *  from "diffed against an empty tree". */
  const prevTreeRef = useRef<WorldEditorBuilding[] | null>(null);
  /** Row ids currently marked "(NEW)" (021-A Frame 3's second confirm surface). */
  const [newRowIds, setNewRowIds] = useState<Set<string>>(() => new Set());
  /** Tracks the PREVIOUS studioDir so the [studioDir] effect can tell a real switch from mount. */
  const prevStudioDirRef = useRef<string | null>(null);
  /** History length observed by the most recent refreshTree() — see its comment. Starts at -1 so
   *  the first genuine growth is never mistaken for "already rescanned". */
  const lastRefreshHistoryLenRef = useRef(-1);
  /** Set once a project switch has been observed, so the mount-run guard cannot be confused by a
   *  studioDir that legitimately returns to its earlier value. */
  const studioDirSeenRef = useRef(false);

  const lastHostCommandResult = useWorldEditorStore((s) => s.lastHostCommandResult);

  /** Clears the pending slot + its timer + the UI mirror. EVERY exit transition (Plan 08 rows
   *  5/6/7/9/10/11/12) funnels through here, which is what makes R11/EE1's "the trigger can never
   *  wedge disabled" property structural rather than six independently-remembered calls. */
  function clearPlacementSlot(): void {
    if (placementTimeoutRef.current !== null) {
      clearTimeout(placementTimeoutRef.current);
      placementTimeoutRef.current = null;
    }
    pendingPlacementRef.current = null;
    setPlacementPending(false);
  }

  /** Plan 08's 'Durable failure surface': rows 6/9/10 record a words-only history entry with
   *  outcome 'error' (which raises the D-12 failure badge — passive, never steals focus). */
  function recordPlacementFailure(pending: PendingPlacement, message: string): void {
    const label =
      useWorldEditorStore.getState().tree.find((b) => b.buildingId === pending.buildingId)
        ?.displayLabel ?? pending.buildingId;
    useWorldEditorStore.getState().recordPersistResult({
      timestampISO: new Date().toISOString(),
      buildingLabel: label,
      decorationLabel: baseNameOf(pending.templatePath),
      outcome: 'error',
      message,
    });
  }

  // ── resolveOverridePair (ROUND 4/W3, ROUND 5/V6, ROUND 6/X1) ────────────────────────────────
  // A PLAIN function (never a hook) — reads studioDir via useWorkspaceStore.getState(), the
  // imperative accessor, NEVER the hook-selector form (this function is invoked from event
  // handlers, where a hook call would throw "Invalid hook call").
  function resolveOverridePair(): OverridePair | null {
    const studioDir = useWorkspaceStore.getState().studioDir;
    if (!studioDir) return null;
    const meta = readWorkspaceJson(studioDir);
    const overrideDir = resolveScanRoot(
      liveStatus.kind === 'attached' ? clientLabel ?? null : null,
      { cfgPath: meta.cfgPath, clientPath: meta.clientPath },
    );
    if (overrideDir === null) return null;
    return { overrideDir, readVfs: makeReadVfs(overrideDir), meta, studioDir };
  }

  // (ROUND-3-REVIEW R2) refreshTree() re-reads readWorkspaceJson FRESH on every call via
  // resolveOverridePair — never a stale mount-time meta.
  //
  // Bookmarks (Plan 11, D-07) are read in this SAME effect/call, per the plan's own instruction
  // ("same effect that already loads the mirror-toggle value"). Unlike the scan-root/tree,
  // bookmarks must stay visible even when overrideDir fails to resolve (e.g. no live session but
  // the project is still bound) — so when resolveOverridePair() already read meta, reuse it
  // (no extra readWorkspaceJson call); only fall back to a direct read when the pair is null but
  // a studioDir is still bound.
  function refreshTree(): void {
    // (05.1-14 Task 2) Stamp the history length this scan observed. The refresh-on-persist effect
    // below uses it to tell "a persist landed that nothing else rescanned for" (the ADD path,
    // where the poll loop's recordPersistResult is the only signal) from "a write path that
    // already rescanned itself" (Remove, which calls this directly) — without it, every Remove
    // pays a second full override-dir scan.
    lastRefreshHistoryLenRef.current = useWorldEditorStore.getState().history.length;
    const pair = resolveOverridePair();
    const studioDir = useWorkspaceStore.getState().studioDir;
    if (studioDir) {
      const meta = pair !== null ? pair.meta : readWorkspaceJson(studioDir);
      setBookmarks(meta.worldEditorBookmarks ?? []);
    } else {
      setBookmarks([]);
    }
    if (pair === null) {
      setScanRootAvailable(false);
      return;
    }
    setScanRootAvailable(true);
    setMirrorToStockIlf(pair.meta.mirrorToStockIlf ?? true);
    refresh(pair.overrideDir, pair.meta.worldEditorBuildingTemplates);
  }

  // Mount + re-run on liveStatus.kind change (attach/detach re-resolves the scan root).
  useEffect(() => {
    refreshTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStatus.kind]);

  // ── C12: failure badge — tab-title modified-dot idiom (DatatableGridEditor.tsx precedent) ────
  useEffect(() => {
    try {
      props.api?.setTitle(`World${hasFailureBadge ? ' ●' : ''}`);
    } catch {
      /* api unavailable in some test envs */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFailureBadge, props.api]);

  // ── C12: acknowledge on activation (never on mount alone) ──────────────────────────────────
  useEffect(() => {
    const api = props.api;
    if (!api) return;
    try {
      // ROUND-3-REVIEW R13: onDidActiveChange only fires on a CHANGE — if this tab is ALREADY
      // active at mount time (e.g. restored as the last-focused tab), check isActive synchronously
      // once too, so an already-visible badge is acknowledged as a real activation would have done.
      if (api.isActive && useWorldEditorStore.getState().hasFailureBadge) {
        useWorldEditorStore.getState().acknowledgeFailures();
      }
      const disposable = api.onDidActiveChange((e: { isActive: boolean }) => {
        if (e.isActive) useWorldEditorStore.getState().acknowledgeFailures();
      });
      return () => disposable.dispose();
    } catch {
      /* api unavailable in some test envs */
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.api]);

  // ── Mirror toggle (ROUND 3 R4/R6/R8; ROUND 4 W1/W3; ROUND 5 V7) ────────────────────────────
  function handleMirrorToggle(): void {
    const nextValue = !mirrorToStockIlf;
    const pair = resolveOverridePair();
    if (pair === null) return; // defense-in-depth no-op — the toggle should already be disabled
    try {
      const result = reconcileMirrorMode(pair.studioDir, pair.overrideDir, pair.readVfs, nextValue);
      if (result.failures.length > 0) {
        const detail = result.failures.map((f) => `${f.buildingId} (${f.error})`).join('; ');
        log('warn', 'log', `Mirror mode change blocked: ${detail}`);
        const allUnchanged = result.failures.every((f) => f.diskState === 'unchanged');
        const message = allUnchanged
          ? `mirror mode change blocked — no buildings' mirrors were changed: ${detail}`
          : `mirror mode change blocked — most buildings' mirrors were not changed, but ` +
            `${result.failures.filter((f) => f.diskState === 'uncertain').map((f) => f.buildingId).join(', ')} ` +
            `could not be verified after a rollback failure — check their mirror files manually: ` +
            `${result.failures.filter((f) => f.diskState === 'uncertain').map((f) => f.error).join('; ')}`;
        useWorldEditorStore.getState().recordPersistResult({
          timestampISO: new Date().toISOString(),
          buildingLabel: 'Mirror mode',
          decorationLabel: '(all edited buildings)',
          outcome: 'error',
          message,
        });
      }
    } catch (e) {
      log('error', 'log', `Mirror mode change threw: ${(e as Error).message}`);
    }
    // Clean, blocked, or rolled-back — refreshTree() re-reads the actually-persisted value, so
    // the switch's rendered state always matches what really landed on disk/settings.
    refreshTree();
  }

  function handleStubClick(label: string): void {
    log('info', 'log', `${label}: not yet wired — coming in a later phase.`);
  }

  function handleRowSelect(rowId: string): void {
    select(rowId);
    // "(NEW)" clears when the row is explicitly selected (Task 2's documented discretion — the
    // alternative offered was a ~2s timeout). Selection is the user ACKNOWLEDGING the row, which
    // is what the sketch's "until acknowledged/refreshed" asks for, and it keeps the marker
    // deterministic in tests rather than racing a timer.
    setNewRowIds((prev) => {
      if (!prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  }

  // ── Remove / Undo (D-02/D-03 — 05.1-13) ─────────────────────────────────────────────────────
  // Forward-looking groundwork FOR Plan 14's content-identity "(NEW)" diff effect (later wave,
  // SAME file): a QUEUE (never a bare boolean, never a single overwritable ref — ROUND 6/X3,
  // ROUND 7/Z5) of restored-row identity keys, drained by that effect so an Undo-restored row is
  // never marked "(NEW)" even on the very next refresh.
  const suppressNextDiffRef = useRef<Array<{ buildingId: string; cellName: string; objectTemplateName: string }>>([]);

  // (ROUND 3/R4-R7; ROUND 4/W3; ROUND 5/V5/V6/V12) Per-row Remove action — no confirm dialog
  // (D-03's guard is the undo toast, not a dialog). ALWAYS resolves overrideDir/readVfs/studioDir
  // via the SAME shared, null-safe resolveOverridePair() every other write action in this file
  // uses (never a second, independently-resolved pair), and ALWAYS passes liveNetworkId: null —
  // no producer in this phase populates a live node id to look up (C4).
  function handleRemove(building: WorldEditorBuilding, deco: WorldEditorDecoration): void {
    const pair = resolveOverridePair();
    if (pair === null) return; // defense-in-depth no-op — the row action should already be absent/disabled
    const st = useLiveStore.getState().status;
    const mappingName = st.kind === 'attached' ? st.mappingName : null;
    try {
      removeDecorationRow(
        pair.studioDir,
        pair.overrideDir,
        pair.readVfs,
        building,
        deco.cellName,
        deco.rowIndex,
        null, // liveNetworkId — ALWAYS null this phase (C4)
        mappingName,
      );
      useRemoveUndoStore.getState().push({
        id: worldEditorRowId(building.buildingId, deco.cellName, deco.rowIndex),
        buildingId: building.buildingId,
        cellName: deco.cellName,
        rowIndex: deco.rowIndex,
        removedNode: {
          objectTemplateName: deco.objectTemplateName,
          cellName: deco.cellName,
          transform: deco.transform,
        },
      });
      useWorldEditorStore.getState().recordPersistResult({
        timestampISO: new Date().toISOString(),
        buildingLabel: building.displayLabel,
        decorationLabel: baseNameOf(deco.objectTemplateName),
        outcome: 'warn',
        message: formatPersistMessage('removed — reload scene to see it gone', pair.meta.mirrorToStockIlf ?? true),
        cellName: deco.cellName,
        rowIndex: deco.rowIndex,
      });
      refreshTree();
    } catch (e) {
      log('error', 'log', `Remove failed: ${(e as Error).message}`);
    }
  }

  // (ROUND 5/V1; ROUND 6/X3/X4/X6; ROUND 7/Z1/Z5; R9 review/BB9) WorldPanel owns the ENTIRE Undo
  // restore end-to-end — RemoveUndoToast has no write-path access of its own. No up-front
  // clearUndoError (BB9): failure branches OVERWRITE via setUndoError (no pre-clear needed); the
  // success branch clears only AFTER restore() confirms.
  function handleUndo(entry: RemovedRowEntry): void {
    const building = useWorldEditorStore.getState().tree.find((b) => b.buildingId === entry.buildingId);
    if (!building) {
      const msg = `Undo failed: building ${entry.buildingId} is no longer in the scanned tree — it may have been removed since this toast appeared.`;
      log('warn', 'log', msg);
      useRemoveUndoStore.getState().setUndoError(entry.id, msg);
      return;
    }
    const pair = resolveOverridePair();
    if (pair === null) {
      const msg = 'Undo failed: no resolvable project/client scan root — attach a live session or bind this project to a client.';
      log('warn', 'log', msg);
      useRemoveUndoStore.getState().setUndoError(entry.id, msg);
      return;
    }
    try {
      // ROUND 7/Z1: the add-back write runs BEFORE restore() pops the entry from pending — a
      // thrown add-back can therefore never present as a false "restored" success.
      addBackDecorationRow(pair.studioDir, pair.overrideDir, pair.readVfs, building, entry.removedNode);
    } catch (e) {
      const msg = `Undo failed: ${(e as Error).message}`;
      log('warn', 'log', msg);
      useRemoveUndoStore.getState().setUndoError(entry.id, msg);
      return;
    }
    useRemoveUndoStore.getState().restore(entry.id);
    useRemoveUndoStore.getState().clearUndoError(entry.id); // R9 review/BB9 — settle-time, id-scoped
    // ROUND 5/V2 groundwork; ROUND 6/X3 — identity-keyed; ROUND 7/Z5 — a spread-append onto the
    // queue, NEVER an overwrite, so a second successful Undo before Plan 14 drains the first can
    // never clobber it.
    suppressNextDiffRef.current = [
      ...suppressNextDiffRef.current,
      { buildingId: entry.buildingId, cellName: entry.cellName, objectTemplateName: entry.removedNode.objectTemplateName },
    ];
    refreshTree(); // ROUND 4/W2 — Undo's own refresh, so the tree is never left stale after a restore
  }

  // ── Scene accordion actions (D-07) ──────────────────────────────────────────────────────────
  function handleLoadEditorScene(): void {
    if (mappingName === null) return; // defense-in-depth no-op — button is already disabled offline
    sendLoadEditorScene(mappingName, edTerrain, edAvatar);
  }

  function handleReloadScene(): void {
    if (mappingName === null) return;
    sendReloadCurrentScene(mappingName);
  }

  function handleTeleportBookmark(bookmark: WorldEditorBookmark): void {
    if (mappingName === null) return;
    sendTeleport(mappingName, bookmark.x, bookmark.y, bookmark.z);
  }

  // T-05.1-11a: x/y/z are parsed as numbers before ever reaching a bookmark — a non-numeric
  // entry is rejected here, never persisted, never passed to sendTeleport.
  function handleAddBookmark(): void {
    const studioDir = useWorkspaceStore.getState().studioDir;
    if (!studioDir) return;
    const name = newBookmarkName.trim();
    const x = Number(newBookmarkX);
    const y = Number(newBookmarkY);
    const z = Number(newBookmarkZ);
    if (name === '' || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      log('warn', 'log', 'Add bookmark: a name and numeric x/y/z are required.');
      return;
    }
    // scene: '' — no field anywhere in this codebase tracks the attached client's current scene
    // (see file header); fabricating one here would violate the accuracy_requirement.
    const next: WorldEditorBookmark[] = [...bookmarks, { name, scene: '', x, y, z }];
    setBookmarks(next);
    updateWorkspaceMeta(studioDir, { worldEditorBookmarks: next });
    setNewBookmarkName('');
    setNewBookmarkX('');
    setNewBookmarkY('');
    setNewBookmarkZ('');
  }

  function handleRemoveBookmark(index: number): void {
    const studioDir = useWorkspaceStore.getState().studioDir;
    if (!studioDir) return;
    const next = bookmarks.filter((_, i) => i !== index);
    setBookmarks(next);
    updateWorkspaceMeta(studioDir, { worldEditorBookmarks: next });
  }

  // ── Selection resolution ────────────────────────────────────────────────────────────────────
  const parsedSelection = useMemo(() => {
    if (!selectedRowId) return null;
    try {
      return parseWorldEditorRowId(selectedRowId);
    } catch {
      return null;
    }
  }, [selectedRowId]);

  const selectedBuilding: WorldEditorBuilding | null = parsedSelection
    ? tree.find((b) => b.buildingId === parsedSelection.buildingId) ?? null
    : null;

  const selectedDecoration: WorldEditorDecoration | null =
    parsedSelection?.kind === 'decoration' && selectedBuilding
      ? selectedBuilding.decorations.find(
          (d) => d.cellName === parsedSelection.cellName && d.rowIndex === parsedSelection.rowIndex,
        ) ?? null
      : null;

  // ── ADD-decoration context (05.1-14 Task 2 — D-04's honest degrade + C6's scope disclosure) ──
  //
  // C6 (Fable facet) — DISCLOSED SCOPE NARROWING, not a silent one: the selectable set is
  // ENTIRELY `worldEditorStore.tree`, which per D-05 only contains buildings with an existing
  // `edit_*.ilf` on disk. A never-edited STOCK building — even one whose stock `.ilf` already has
  // decorations that could supply a borrowable cellName — is simply not in the tree and therefore
  // not selectable here. That is NARROWER than RESEARCH.md's original recommendation (a
  // stock-`.ilf` fallback lookup), deliberately, because the wider scope needs a building-
  // discovery UI this phase does not build. Recorded in Plan 15's sign-off as an observed scope
  // note.
  //
  // D-04 — the cellName is BORROWED from an existing decoration rather than resolved live. A
  // building with zero decorations refuses with words (below), never a silent failure or a
  // guessed cell name.
  const addContext = useMemo(() => {
    if (!selectedBuilding || selectedBuilding.decorations.length === 0) return null;
    const cellName =
      parsedSelection?.kind === 'decoration'
        ? parsedSelection.cellName
        : selectedBuilding.decorations[0].cellName;
    return {
      buildingId: selectedBuilding.buildingId,
      buildingLabel: selectedBuilding.displayLabel,
      cellName,
    };
  }, [selectedBuilding, parsedSelection]);

  const isAttached = liveStatus.kind === 'attached';
  const addDisabled = addContext === null || !isAttached || isPlacementPending;

  /** Words, never a silent no-op — the reason the trigger is unavailable, in the order the user
   *  can act on it. */
  const addDisabledHint: string | null = isPlacementPending
    ? 'waiting for the game to acknowledge the last placement request'
    : !isAttached
      ? 'attach to a running client first — placement happens in-game'
      : addContext === null
        ? "select a decorated building first — placing into a brand-new cell isn't supported yet"
        : null;

  /**
   * Plan 08 row 1 (place-attempt from `idle`) and row 13 (the self-loop local refuse).
   *
   * NO toast at send time (R9 review, BB1): the returned epoch enters the pending slot and the
   * ack effect alone decides which toast, if any, ever shows. The refuse-while-pending check is
   * FIRST and reads a REF, so it is correct even for two clicks batched into one commit — the
   * slot can never be overwritten while occupied (row 13), which is what makes a single slot
   * sufficient and keeps the round-9 double-click ack inversion structurally unreachable.
   */
  function handlePlaceDecoration(templatePath: string): void {
    const pending = pendingPlacementRef.current;
    if (pending !== null) {
      setPlacementToast(
        placementStillWaitingMessage(baseNameOf(pending.templatePath), pending.buildingLabel),
      );
      return; // row 13: never call sendStartPlacement, leave slot + timer untouched
    }
    if (addContext === null) return;
    const st = useLiveStore.getState().status;
    const mappingName = st.kind === 'attached' ? st.mappingName : null;
    if (mappingName === null) return;

    const epoch = sendStartPlacement(
      mappingName,
      templatePath,
      addContext.cellName,
      addContext.buildingId,
    );
    pendingPlacementRef.current = {
      epoch,
      studioDir: useWorkspaceStore.getState().studioDir ?? null,
      buildingId: addContext.buildingId,
      buildingLabel: addContext.buildingLabel,
      templatePath,
      cellName: addContext.cellName,
    };
    setPlacementPending(true);
    setAddModalOpen(false);

    placementTimeoutRef.current = setTimeout(() => {
      // Plan 08 row 9 — re-check slot non-null AND epoch match AND studioDir match, else no-op.
      const slot = pendingPlacementRef.current;
      if (slot === null || slot.epoch !== epoch) return;
      if (slot.studioDir !== (useWorkspaceStore.getState().studioDir ?? null)) {
        clearPlacementSlot();
        return; // switch happened first — silent abort, no toast, no record
      }
      clearPlacementSlot();
      setPlacementToast(PLACEMENT_TIMEOUT_MESSAGE);
      recordPlacementFailure(slot, PLACEMENT_TIMEOUT_MESSAGE);
    }, PLACEMENT_ACK_TIMEOUT_MS);
  }

  // Plan 08 rows 5/6/7/8 — ack correlation.
  useEffect(() => {
    const pending = pendingPlacementRef.current;
    if (pending === null || lastHostCommandResult === null) return;
    if (lastHostCommandResult.epoch !== pending.epoch) return; // row 8: unrelated ack, self-loop

    // Row 7 (CC2) — the slot carries its issuing project, so ack-vs-switch resolves LOCALLY,
    // independent of effect declaration order. An overdue ~1 Hz poll tick landing project A's
    // result in project B's just-reset store self-converts to an abort here.
    if (pending.studioDir !== (useWorkspaceStore.getState().studioDir ?? null)) {
      clearPlacementSlot();
      return; // NO toast, NO record
    }

    clearPlacementSlot();
    if (lastHostCommandResult.code === 1) {
      setPlacementToast(placementActiveMessage(pending.cellName)); // row 5
    } else {
      setPlacementToast(PLACEMENT_REFUSED_MESSAGE); // row 6
      recordPlacementFailure(pending, PLACEMENT_REFUSED_MESSAGE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastHostCommandResult]);

  // Plan 08 row 10 — detach. The client exiting stops the poll loop entirely, so no ack can ever
  // arrive; without this row a pending request would wait forever.
  useEffect(() => {
    if (liveStatus.kind === 'attached') return;
    const pending = pendingPlacementRef.current;
    if (pending === null) return;
    const switched = pending.studioDir !== (useWorkspaceStore.getState().studioDir ?? null);
    clearPlacementSlot();
    // R11/EE2 — detach is store-writing too, so it carries the SAME slot-studioDir guard as rows
    // 7/9. A post-switch detach records nothing: a 'detached' entry would land in the NEW
    // project's freshly-reset history.
    if (switched) return;
    recordPlacementFailure(pending, PLACEMENT_DETACHED_MESSAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStatus.kind]);

  // Plan 08 row 11 — project switch (AA5 re-derived; R9 review BB2/BB5/BB11).
  //
  // This effect does NOT call worldEditorStore.reset()/removeUndoStore.reset(): both stores reset
  // THEMSELVES synchronously inside the studioDir-changing set(), via their own module-scope
  // subscriptions (Plan 04's PROJECT-SWITCH RESET ORDERING CONTRACT). The round-8 effect-based
  // design provably ran AFTER RemoveUndoToast's key-remount initializers had read the old
  // project's state. By effect timing, the refreshTree() below runs strictly after those
  // synchronous resets, so "reset before the first refreshTree()" holds by construction.
  useEffect(() => {
    const next = studioDir ?? null;
    if (!studioDirSeenRef.current) {
      studioDirSeenRef.current = true;
      prevStudioDirRef.current = next;
      return; // a fresh mount is not a switch
    }
    if (prevStudioDirRef.current === next) return;
    prevStudioDirRef.current = next;

    prevTreeRef.current = null; // re-arm the null-sentinel first-pass rule for the new tree
    suppressNextDiffRef.current = []; // discard stale, undrained keys from the OLD project
    setNewRowIds(new Set());
    clearPlacementSlot(); // aborted-switch: NO toast, NO history entry
    setPlacementToast(null);
    setAddModalOpen(false);
    refreshTree(); // BB11 — nothing else schedules the new project's first scan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioDir]);

  // Plan 08 row 12 (CC1) — aborted-unmount. Without this, WorldPanel's deliberate panel-scoped
  // remountability orphans the armed setTimeout; if the user then switches projects, the orphan
  // callback fires at deadline and writes outcome:'error' + a failure badge into the NEW
  // project's freshly-reset history through the module-scope store. The callback's own re-check
  // is defense-in-depth behind this cleanup, not a substitute for it.
  useEffect(
    () => () => {
      if (placementTimeoutRef.current !== null) clearTimeout(placementTimeoutRef.current);
      placementTimeoutRef.current = null;
      pendingPlacementRef.current = null;
      setPlacementPending(false);
    },
    [],
  );

  // ── Refresh on persist (05.1-14 Task 2) ─────────────────────────────────────────────────────
  // Plan 08 Task 3's useChannelReader -> recordPersistResult wiring grows history when an ADD's
  // RESULT lands; this pulls the freshly-written row into the tree without a manual tab reopen.
  // Calls the SHARED refreshTree() (which re-reads readWorkspaceJson FRESH), never Plan 10's
  // mount-time meta/overrideDir pair — that snapshot PREDATES the persist this reacts to, so its
  // worldEditorBuildingTemplates would be missing the very entry this ADD just wrote
  // (ROUND-3-REVIEW R2).
  const historyLength = history.length;
  const prevHistoryLenRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevHistoryLenRef.current;
    prevHistoryLenRef.current = historyLength;
    if (prev === null || historyLength <= prev) return; // mount, or no growth
    // A local write path (Remove) calls refreshTree() itself AFTER recording its entry, so it has
    // already rescanned for this growth — refreshing again would be a redundant full disk scan.
    if (lastRefreshHistoryLenRef.current >= historyLength) return;
    refreshTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLength]);

  // ── "(NEW)" content-identity diff (ROUND 4/W2; ROUND 5/V2+V3; ROUND 6/X3; ROUND 7/Z5) ────────
  //
  // Keyed on the `tree` VALUE, not history.length growth (V2): EVERY refreshTree()-triggered
  // update — mount, manual refresh, mirror toggle, Remove, Undo, ADD-confirm — advances
  // prevTreeRef, so it can never go stale between refreshes. The ROUND 4 design keyed on history
  // growth alone; Remove grows history but Undo does not, so Undo's own refresh never advanced
  // the baseline and a LATER unrelated event then mislabeled the already-restored row "(NEW)".
  useEffect(() => {
    const suppressed = suppressNextDiffRef.current;
    let marked: Set<string>;

    if (suppressed.length > 0) {
      // Branch 1 (X3/Z5) — drain the WHOLE queue, then run the SAME count-map diff with those
      // tuples pre-credited. Never a blanket skip: an unrelated genuinely-new row landing in the
      // same refresh window is still diffed and marked.
      suppressNextDiffRef.current = [];
      marked = computeNewRowIds(tree, prevTreeRef.current, groupSuppressedByBuilding(suppressed));
    } else if (prevTreeRef.current === null) {
      // Branch 2 (V3) — first pass after mount: seed the baseline, mark NOTHING.
      prevTreeRef.current = tree;
      setNewRowIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    } else {
      // Branch 3 — the ordinary diff.
      marked = computeNewRowIds(tree, prevTreeRef.current, new Map());
    }

    prevTreeRef.current = tree;
    setNewRowIds((prev) => (sameIdSet(prev, marked) ? prev : marked));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const matchingHistoryEntry: PersistHistoryEntry | null = useMemo(() => {
    if (!selectedDecoration) return null;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry.cellName === selectedDecoration.cellName && entry.rowIndex === selectedDecoration.rowIndex) {
        return entry;
      }
    }
    return null;
  }, [history, selectedDecoration]);

  // Best-effort: does a stock-path mirror file exist for the selected building? Never throws.
  const hasMirror = useMemo(() => {
    if (!selectedBuilding || !selectedBuilding.buildingTemplateVfsPath) return false;
    const pair = resolveOverridePair();
    if (!pair) return false;
    try {
      const stockIff = pair.readVfs(selectedBuilding.buildingTemplateVfsPath);
      const stockIlfVfs = readInteriorLayoutFileName(stockIff);
      if (!stockIlfVfs) return false;
      return fs.existsSync(path.join(pair.overrideDir, stockIlfVfs));
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBuilding, liveStatus.kind, clientLabel]);

  // ── D-07b mismatch hint ─────────────────────────────────────────────────────────────────────
  const attached = liveStatus.kind === 'attached';
  const mappingName = liveStatus.kind === 'attached' ? liveStatus.mappingName : null;
  const clientMismatch =
    attached && clientLabel !== null && boundClientPath !== null && isClientPathMismatch(clientLabel, boundClientPath);

  // ── Render ───────────────────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        overflowY: 'auto',
      }}
    >
      {/* ── Live-session strip ──────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          background: 'var(--color-surface-2)',
          borderBottom: '1px solid var(--color-border-soft)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: attached ? 'var(--color-accent)' : 'var(--color-text-faint)',
            flex: 'none',
          }}
        />
        {attached && liveStatus.kind === 'attached' ? (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {clientLabel ?? 'attached'} · pid {liveStatus.pid}
          </span>
        ) : (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', flex: 1 }}>
            No live session
          </span>
        )}
        {/* D-07b: informational, never blocking — the attached client still wins for scanning. */}
        {clientMismatch && (
          <span
            role="alert"
            title="attached client differs from this project's bound client"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warn)' }}
          >
            △ attached client differs from this project&rsquo;s bound client
          </span>
        )}
        {/* Sketch-vs-reality gap (see file header): no data source tracks the current scene. */}
        <span
          title="scene tracking not available yet"
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-faint)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          scene: not tracked yet
        </span>
        <button
          type="button"
          aria-label="Refresh the World tab's building tree"
          title="Refresh"
          onClick={refreshTree}
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border-soft)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            padding: '2px 6px',
          }}
        >
          ⟳
        </button>
      </div>

      {/* ── Mirror-mode toggle row (D-08, D-09) ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '8px 12px',
          background: 'rgba(74,140,255,.06)',
          borderBottom: '1px solid var(--color-border-soft)',
        }}
      >
        <button
          type="button"
          role="switch"
          aria-checked={mirrorToStockIlf}
          aria-label="Mirror to stock layout"
          disabled={!scanRootAvailable}
          onClick={handleMirrorToggle}
          style={{
            width: 30,
            height: 16,
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--color-border-soft)',
            background: mirrorToStockIlf ? 'var(--color-accent)' : 'var(--color-widget)',
            cursor: scanRootAvailable ? 'pointer' : 'not-allowed',
            opacity: scanRootAvailable ? 1 : 0.5,
            flex: 'none',
          }}
        />
        <div style={{ flex: 1 }}>
          <div>Mirror to stock layout</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
            {mirrorToStockIlf
              ? 'per-template: all buildings with this layout show the edit'
              : 'per-instance: edits are visible in editor scenes, not on hybrid live servers'}
          </div>
        </div>
        <span
          style={{
            font: '600 10px/1 var(--font-sans)',
            padding: '3px 7px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(74,140,255,.13)',
            color: 'var(--color-info)',
          }}
        >
          PER-TEMPLATE
        </span>
      </div>

      {/* D-08 (LOCKED): visible, disabled per-instance scope option — not omittable. */}
      <div
        role="radio"
        aria-checked={false}
        aria-disabled="true"
        title="server-side per-instance repoint — coming later"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '6px 12px 10px',
          background: 'rgba(74,140,255,.06)',
          borderBottom: '1px solid var(--color-border-soft)',
          color: 'var(--color-text-faint)',
          cursor: 'not-allowed',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 30,
            height: 16,
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--color-border-soft)',
            background: 'var(--color-widget)',
            opacity: 0.5,
            flex: 'none',
          }}
        />
        <div style={{ flex: 1 }}>
          <div>Per-instance (server repoint)</div>
          <div style={{ fontSize: 'var(--text-xs)' }}>server-side per-instance repoint — coming later</div>
        </div>
      </div>

      {/* ── Edited buildings ─────────────────────────────────────────────────────────────────── */}
      <AccordionHeader
        label="Edited buildings"
        open={buildingsOpen}
        onToggle={() => setBuildingsOpen((v) => !v)}
        chip={tree.length}
      />

      {!scanRootAvailable && (
        <div style={{ padding: '10px 12px', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
          No live session / project not bound to a client — nothing to scan yet.
        </div>
      )}

      {scanRootAvailable && buildingsOpen && (
        <div>
          {tree.map((building) => {
            const buildingRowId = worldEditorBuildingRowId(building.buildingId);
            const badge = deriveBuildingBadge(building, sessionOverlay);
            const colors = badgeColors(badge.kind);
            return (
              <React.Fragment key={building.buildingId}>
                <div
                  role="option"
                  aria-selected={selectedRowId === buildingRowId}
                  data-testid="world-building-row"
                  onClick={() => handleRowSelect(buildingRowId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 12px',
                    borderBottom: '1px solid var(--color-border-soft)',
                    cursor: 'pointer',
                    background: selectedRowId === buildingRowId ? 'var(--color-accent-dim)' : undefined,
                  }}
                >
                  <span aria-hidden="true" style={{ width: 16, color: 'var(--color-text-faint)' }}>
                    ⌂
                  </span>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {building.displayLabel}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-faint)',
                      }}
                    >
                      {baseNameOf(building.derivedTemplatePath)} · node {building.buildingId}
                    </div>
                  </div>
                  <span
                    style={{
                      font: '600 10px/1 var(--font-sans)',
                      padding: '3px 7px',
                      borderRadius: 'var(--radius-full)',
                      ...colors,
                    }}
                  >
                    {badge.label}
                  </span>
                </div>
                {building.decorations.map((deco) => {
                  const rowId = worldEditorRowId(building.buildingId, deco.cellName, deco.rowIndex);
                  const decoBadge = deriveDecorationBadge(sessionOverlay.get(rowId));
                  const decoColors = badgeColors(decoBadge.kind);
                  return (
                    <div
                      key={rowId}
                      role="option"
                      aria-selected={selectedRowId === rowId}
                      data-testid="world-decoration-row"
                      onClick={() => handleRowSelect(rowId)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                        padding: '7px 12px',
                        paddingLeft: 30,
                        borderBottom: '1px solid var(--color-border-soft)',
                        cursor: 'pointer',
                        background: selectedRowId === rowId ? 'var(--color-accent-dim)' : undefined,
                      }}
                    >
                      <span aria-hidden="true" style={{ width: 16, color: 'var(--color-text-faint)' }}>
                        ▦
                      </span>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {baseNameOf(deco.objectTemplateName)}
                          {/* 021-A Frame 3's second confirm surface. Content-identity keyed, so a
                              pure reindex (Plan 13's append-only Undo) can never trigger it. */}
                          {newRowIds.has(rowId) && (
                            <b data-testid="world-decoration-new-marker" style={newMarkerStyle}>
                              (NEW)
                            </b>
                          )}
                        </div>
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-faint)',
                          }}
                        >
                          {deco.cellName} · row {deco.rowIndex}
                        </div>
                      </div>
                      <span
                        style={{
                          font: '600 10px/1 var(--font-sans)',
                          padding: '3px 7px',
                          borderRadius: 'var(--radius-full)',
                          ...decoColors,
                        }}
                      >
                        {decoBadge.label}
                      </span>
                      {/* D-02/D-03 — no confirm dialog; the undo toast is the guard. */}
                      <button
                        type="button"
                        aria-label={`Remove ${baseNameOf(deco.objectTemplateName)}`}
                        data-testid="world-remove-decoration-btn"
                        title="Remove (undo within 8s)"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(building, deco);
                        }}
                        style={removeDecorationBtnStyle}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* ── Selection detail card (decoration rows only) ────────────────────────────────────── */}
      {selectedDecoration && (
        <div
          data-testid="world-detail-card"
          style={{
            margin: 10,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-soft)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
          }}
        >
          <DetailRow k="Decoration" v={baseNameOf(selectedDecoration.objectTemplateName)} />
          <DetailRow k="Cell / row" v={`${selectedDecoration.cellName} · row ${selectedDecoration.rowIndex}`} />
          <DetailRow k="Position" v={formatPosition(selectedDecoration.transform)} />
          <DetailRow
            k="Last persist"
            v={renderLastPersist(matchingHistoryEntry)}
          />
          <DetailRow
            k="Files"
            v={
              selectedBuilding
                ? [baseNameOf(selectedBuilding.editedIlfPath), baseNameOf(selectedBuilding.derivedTemplatePath), hasMirror ? 'mirror' : null]
                    .filter((s): s is string => s !== null)
                    .join(' · ')
                : '—'
            }
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
            <button type="button" onClick={() => handleStubClick('Go to')} style={stubBtnStyle}>
              Go to
            </button>
            <button type="button" onClick={() => handleStubClick('Revert')} style={stubBtnStyle}>
              Revert
            </button>
            <button type="button" onClick={() => handleStubClick('Edit in game')} style={stubBtnStyle}>
              Edit in game
            </button>
          </div>
        </div>
      )}

      {/* ── Activity accordion (D-06/SC1, D-10) ─────────────────────────────────────────────── */}
      <AccordionHeader
        label="Activity"
        open={activityOpen}
        onToggle={() => setActivityOpen((v) => !v)}
        chip={history.length}
      />
      {activityOpen && (
        <div style={{ padding: '6px 12px 10px' }}>
          {history.length === 0 ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', padding: '4px 0' }}>
              no activity yet this session
            </div>
          ) : (
            [...history].reverse().map((entry, i) => (
              <div
                key={i}
                data-testid="world-activity-entry"
                data-outcome={entry.outcome}
                style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'flex-start' }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-faint)',
                    flex: 'none',
                  }}
                >
                  {entry.timestampISO.slice(11, 16)}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: outcomeColor(entry.outcome), overflowWrap: 'anywhere' }}>
                  {outcomeGlyph(entry.outcome)} {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Scene accordion (D-07) ───────────────────────────────────────────────────────────── */}
      <AccordionHeader label="Scene" open={sceneOpen} onToggle={() => setSceneOpen((v) => !v)} chip="editor" />
      {sceneOpen && (
        <div style={{ padding: '8px 12px 12px' }}>
          {!attached && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginBottom: 8 }}>
              no live session — scene actions unavailable
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input
              aria-label="Editor scene terrain"
              value={edTerrain}
              onChange={(e) => setEdTerrain(e.target.value)}
              style={sceneInputStyle}
            />
            <input
              aria-label="Editor scene avatar template"
              value={edAvatar}
              onChange={(e) => setEdAvatar(e.target.value)}
              style={sceneInputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              aria-label="Load editor scene"
              title={!attached ? 'no live session' : undefined}
              disabled={!attached}
              onClick={handleLoadEditorScene}
              style={{ ...stubBtnStyle, opacity: attached ? 1 : 0.5, cursor: attached ? 'pointer' : 'not-allowed' }}
            >
              Editor scene ▸ {edTerrain}
            </button>
            <button
              type="button"
              aria-label="Reload scene"
              title={!attached ? 'no live session' : undefined}
              disabled={!attached}
              onClick={handleReloadScene}
              style={{ ...stubBtnStyle, opacity: attached ? 1 : 0.5, cursor: attached ? 'pointer' : 'not-allowed' }}
            >
              Reload scene
            </button>
          </div>

          {bookmarks.map((bookmark, i) => (
            <div
              key={`${bookmark.name}-${i}`}
              role="button"
              data-testid="world-bookmark-row"
              aria-label={`Teleport to ${bookmark.name}`}
              title={!attached ? 'no live session' : undefined}
              onClick={() => attached && handleTeleportBookmark(bookmark)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 0',
                borderBottom: '1px solid var(--color-border-soft)',
                cursor: attached ? 'pointer' : 'not-allowed',
                opacity: attached ? 1 : 0.6,
              }}
            >
              <span aria-hidden="true" style={{ color: 'var(--color-text-faint)' }}>
                ◎
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bookmark.name}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-faint)',
                }}
              >
                {bookmark.x.toFixed(1)}, {bookmark.y.toFixed(1)}, {bookmark.z.toFixed(1)}
              </span>
              <button
                type="button"
                aria-label={`Remove bookmark ${bookmark.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveBookmark(i);
                }}
                style={removeBookmarkBtnStyle}
              >
                ×
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <input
              aria-label="New bookmark name"
              placeholder="name"
              value={newBookmarkName}
              onChange={(e) => setNewBookmarkName(e.target.value)}
              style={{ ...sceneInputStyle, flex: 1 }}
            />
            <input
              aria-label="New bookmark x"
              placeholder="x"
              value={newBookmarkX}
              onChange={(e) => setNewBookmarkX(e.target.value)}
              style={{ ...sceneInputStyle, width: 48 }}
            />
            <input
              aria-label="New bookmark y"
              placeholder="y"
              value={newBookmarkY}
              onChange={(e) => setNewBookmarkY(e.target.value)}
              style={{ ...sceneInputStyle, width: 48 }}
            />
            <input
              aria-label="New bookmark z"
              placeholder="z"
              value={newBookmarkZ}
              onChange={(e) => setNewBookmarkZ(e.target.value)}
              style={{ ...sceneInputStyle, width: 48 }}
            />
            <button type="button" aria-label="Add bookmark" onClick={handleAddBookmark} style={stubBtnStyle}>
              + bookmark
            </button>
          </div>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderTop: '1px solid var(--color-border)',
          marginTop: 'auto',
        }}
      >
        <button
          type="button"
          data-testid="world-add-decoration-btn"
          onClick={() => setAddModalOpen(true)}
          disabled={addDisabled}
          title={addDisabledHint ?? undefined}
          style={primaryBtnStyle}
        >
          + Add decoration…
        </button>
        {addDisabledHint !== null && (
          <span data-testid="world-add-decoration-hint" style={addHintStyle}>
            {addDisabledHint}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => handleStubClick('Stage to project')} style={stubBtnStyle}>
          Stage to project
        </button>
      </div>

      {/* D-03: panel-scoped (NOT globally mounted like DeleteUndoToast, ROUND 6/X5/Z17) — a
          project switch (key={studioDir}) forces a full unmount/remount, reusing this
          component's own mount-time reconstruction (ROUND 10/AA2) instead of a bespoke reset. */}
      <RemoveUndoToast key={studioDir ?? 'no-project'} onUndo={handleUndo} />

      {/* 021-A Frame 1 — the wizard modal. Presentation + selection only; the send, the pending
          slot, and every toast belong to this panel (R9 review, BB1). */}
      {addModalOpen && addContext !== null && (
        <AddDecorationModal
          buildingLabel={addContext.buildingLabel}
          cellName={addContext.cellName}
          buildingId={addContext.buildingId}
          onCancel={() => setAddModalOpen(false)}
          onPlace={handlePlaceDecoration}
        />
      )}

      {/* The ONE placement toast surface. Never rendered at send time — only an ack, a timeout,
          or a local refuse ever populates it (Plan 08's protocol). */}
      {placementToast !== null && (
        <div role="status" data-testid="world-placement-toast" style={placementToastStyle}>
          <span style={{ flex: 1 }}>{placementToast}</span>
          <button
            type="button"
            aria-label="Dismiss placement message"
            onClick={() => setPlacementToast(null)}
            style={dismissBtnStyle}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Small render helpers ────────────────────────────────────────────────────────

const stubBtnStyle: React.CSSProperties = {
  background: 'var(--color-widget)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-soft)',
  borderRadius: 'var(--radius-sm)',
  font: '600 var(--text-xs)/1 var(--font-sans)',
  padding: '4px 9px',
  cursor: 'pointer',
};

/** Footer's primary "+ Add decoration…" CTA — sketch 019-A's `.btn.primary` (accent-filled,
 *  the one non-neutral button in this panel). */
const primaryBtnStyle: React.CSSProperties = {
  ...stubBtnStyle,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-text)',
  border: '1px solid transparent',
};

/** 021-A Frame 3's "(NEW)" row marker. */
const newMarkerStyle: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 10,
  color: 'var(--color-accent)',
};

const addHintStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
  maxWidth: 260,
};

/** Panel-scoped placement toast — same posture as RemoveUndoToast (never a global overlay). */
const placementToastStyle: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  right: 12,
  bottom: 58,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '8px 10px',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
  font: 'var(--text-xs)/1.45 var(--font-sans)',
  color: 'var(--color-text)',
  zIndex: 20,
};

const dismissBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--color-text-faint)',
  border: 'none',
  cursor: 'pointer',
  padding: '0 2px',
  lineHeight: 1,
  flex: 'none',
};

const sceneInputStyle: React.CSSProperties = {
  background: 'var(--color-widget)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-soft)',
  borderRadius: 'var(--radius-sm)',
  font: 'var(--text-xs)/1 var(--font-mono)',
  padding: '4px 6px',
};

const removeDecorationBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--color-text-faint)',
  border: 'none',
  cursor: 'pointer',
  padding: '0 4px',
  fontSize: 'var(--text-sm)',
  lineHeight: 1,
  flex: 'none',
};

const removeBookmarkBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--color-text-faint)',
  border: 'none',
  cursor: 'pointer',
  padding: '0 4px',
  fontSize: 'var(--text-sm)',
  lineHeight: 1,
};

function DetailRow({ k, v }: { k: string; v: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
      <span style={{ width: 92, color: 'var(--color-text-faint)', flex: 'none' }}>{k}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text)',
          overflowWrap: 'anywhere',
        }}
      >
        {v}
      </span>
    </div>
  );
}

/** ROUND-3-REVIEW R4 (D-13): the FULL 12-element before/after readout when the matching history
 *  entry carries it; the outcome-word-only fallback when it doesn't (an older/incomplete entry);
 *  "not yet persisted this session" when no matching entry exists at all. Never throws. */
function renderLastPersist(entry: PersistHistoryEntry | null): React.ReactElement | string {
  if (!entry) return 'not yet persisted this session';
  if (entry.beforeTransform && entry.afterTransform) {
    return (
      <>
        <div data-testid="world-last-persist-before">before: [{formatTransform12(entry.beforeTransform)}]</div>
        <div data-testid="world-last-persist-after">after: [{formatTransform12(entry.afterTransform)}]</div>
      </>
    );
  }
  return entry.message;
}
