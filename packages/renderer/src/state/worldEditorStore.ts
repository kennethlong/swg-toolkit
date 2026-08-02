/**
 * packages/renderer/src/state/worldEditorStore.ts
 * Zustand store for the World panel's data spine: disk-scanned building tree + live-session
 * overlay + session-only persist history (D-06) + attention badge (D-12).
 *
 * Structurally mirrors liveStore.ts's discriminated-status idiom (per-row overlay status) and
 * deleteUndoStore.ts's flat-array idiom (history). `tree` is replaced wholesale by refresh()
 * (calls scanWorldEditorState — the SAME scan the World panel's tree AND mirror-mode's
 * reconcile-on-flip share, per RESEARCH's Pitfall 5 warning against a second scan); everything
 * else (sessionOverlay/history/hasFailureBadge/lastHostCommandResult) is transient renderer-only
 * state, never persisted to disk.
 *
 * PROJECT-SWITCH RESET ORDERING CONTRACT (canonical here; R9 review BB2/BB5 — Plans 13/14 cite
 * this, never restate it): this store is a module-scope singleton that outlives any single
 * project's session, so a project switch resets it via a SYNCHRONOUS module-scope subscription
 * on useWorkspaceStore — registered at the bottom of this file — never via a React effect (an
 * effect-based reset provably runs AFTER React has already re-rendered other project-scoped
 * components against the new studioDir, producing the round-9 false-'restored'-toast race).
 * zustand v5's vanilla `subscribe(listener)` runs synchronously inside the very `set()` call
 * that changes `studioDir` (workspaceStore.ts's `openComplete`/`close`), strictly before React
 * schedules a re-render — reset-before-render.
 */

/// <reference types="vite/client" />

import { create } from 'zustand';

import { scanWorldEditorState, type WorldEditorBuilding } from '../services/worldEditorScan';
import { useWorkspaceStore } from './workspaceStore';

// ─── Row-id helpers (MED-7 — the ONE shared row-id contract Plans 10/14 must use) ─────────────

/** A decoration row's stable composite id — recomputed on each scan, never a bare rowIndex. */
export function worldEditorRowId(buildingId: string, cellName: string, rowIndex: number): string {
  return `${buildingId}:${cellName}:${rowIndex}`;
}

/** A building row's selectedRowId — verbatim buildingId, no colon-delimited suffix. */
export function worldEditorBuildingRowId(buildingId: string): string {
  return buildingId;
}

export type WorldEditorRowId =
  | { kind: 'building'; buildingId: string }
  | { kind: 'decoration'; buildingId: string; cellName: string; rowIndex: number };

/** Splits a row id on ':' — exactly 1 segment = building row, exactly 3 = decoration row
 *  (worldEditorRowId's own format). Anything else (including a non-numeric rowIndex segment)
 *  throws — fail-closed rather than silently guessing. */
export function parseWorldEditorRowId(id: string): WorldEditorRowId {
  const parts = id.split(':');
  if (parts.length === 1) {
    return { kind: 'building', buildingId: parts[0] };
  }
  if (parts.length === 3) {
    const rowIndex = Number(parts[2]);
    if (Number.isNaN(rowIndex)) throw new Error(`worldEditorStore: malformed row id "${id}"`);
    return { kind: 'decoration', buildingId: parts[0], cellName: parts[1], rowIndex };
  }
  throw new Error(`worldEditorStore: malformed row id "${id}"`);
}

// ─── formatPersistMessage (D-10 — the SINGLE App-side full-detail implementation) ──────────────

/**
 * Append D-10's mirror-off hybrid-session detail suffix to a base result label. The single
 * place every persist-result caller (the base edit path's RESULT-channel wiring, Plan 13's
 * Remove, Plan 14's Add) builds a D-10-compliant PersistHistoryEntry.message from — so this
 * warning never gets re-derived/re-worded twice.
 */
export function formatPersistMessage(baseLabel: string, mirrorToStockIlf: boolean): string {
  if (mirrorToStockIlf) return baseLabel;
  return `${baseLabel} — mirror off — not visible on hybrid sessions until reload into an editor scene`;
}

// ─── PersistHistoryEntry (D-06 session-only log; ROUND 3/R5 widened for D-13's detail card) ────

export type PersistOutcome = 'ok' | 'warn' | 'error';

export interface PersistHistoryEntry {
  timestampISO: string;
  buildingLabel: string;
  decorationLabel: string;
  /** Human words (decorationResultLabel's output, per SC1) — never a raw code. */
  outcome: PersistOutcome;
  message: string;
  /** (ROUND 3, R5 — D-13) The decoration's o2p before/after the move. Undefined for entries
   *  that never had this data (an arm-failure entry, or a legacy caller). */
  beforeTransform?: number[];
  afterTransform?: number[];
  /** (ROUND 3, R5 — D-13) Which .ilf row this persist touched. */
  cellName?: string;
  rowIndex?: number;
}

/** Transient per-row status overlaid on top of the disk-scanned tree while a live session is
 *  attached — set by setArmed/recordPersistResult, cleared by clearArmed/refresh's reconcile. */
export type SessionOverlayStatus = 'armed' | 'saved' | 'failed';

// ─── refresh() reconciliation (ROUND-3-REVIEW R3 — content identity, never stale rowIndex) ────

type OverlayMap = Map<string, SessionOverlayStatus>;

/**
 * Remap ONE row id (decoration or building) from the OLD tree to its NEW tree equivalent by
 * CONTENT identity (buildingId + cellName + objectTemplateName for decorations; buildingId alone
 * for buildings) — never by the numeric rowIndex half of the old composite id. Returns null when
 * the row genuinely no longer resolves (removed, or the id itself is malformed).
 *
 * Ambiguity tiebreak: when more than one NEW-tree row content-matches (two decorations sharing
 * the same template+cellName in the same building), picks the candidate whose NEW rowIndex is
 * numerically closest to the OLD rowIndex — a documented, accepted best-effort limitation for
 * that rare duplicate case (ROUND-3-REVIEW R3).
 */
function remapRowId(
  id: string,
  oldById: Map<string, WorldEditorBuilding>,
  newById: Map<string, WorldEditorBuilding>,
): string | null {
  let parsed: WorldEditorRowId;
  try {
    parsed = parseWorldEditorRowId(id);
  } catch {
    return null;
  }
  if (parsed.kind === 'building') {
    return newById.has(parsed.buildingId) ? id : null;
  }
  const { buildingId, cellName, rowIndex } = parsed;
  const oldBuilding = oldById.get(buildingId);
  if (!oldBuilding) return null;
  const oldDeco = oldBuilding.decorations.find((d) => d.cellName === cellName && d.rowIndex === rowIndex);
  if (!oldDeco) return null;
  const newBuilding = newById.get(buildingId);
  if (!newBuilding) return null;
  const candidates = newBuilding.decorations.filter(
    (d) => d.cellName === cellName && d.objectTemplateName === oldDeco.objectTemplateName,
  );
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDist = Math.abs(best.rowIndex - rowIndex);
  for (const c of candidates.slice(1)) {
    const dist = Math.abs(c.rowIndex - rowIndex);
    if (dist < bestDist) { best = c; bestDist = dist; }
  }
  return worldEditorRowId(buildingId, cellName, best.rowIndex);
}

function reconcileForRefresh(
  oldTree: WorldEditorBuilding[],
  newTree: WorldEditorBuilding[],
  oldOverlay: OverlayMap,
  oldSelectedRowId: string | null,
): { overlay: OverlayMap; selectedRowId: string | null } {
  const oldById = new Map(oldTree.map((b) => [b.buildingId, b]));
  const newById = new Map(newTree.map((b) => [b.buildingId, b]));

  const overlay: OverlayMap = new Map();
  for (const [oldId, status] of oldOverlay) {
    const newId = remapRowId(oldId, oldById, newById);
    if (newId !== null) overlay.set(newId, status);
  }

  const selectedRowId = oldSelectedRowId === null ? null : remapRowId(oldSelectedRowId, oldById, newById);

  return { overlay, selectedRowId };
}

// ─── Store interface ───────────────────────────────────────────────────────────

export interface WorldEditorStore {
  tree: WorldEditorBuilding[];
  selectedRowId: string | null;
  sessionOverlay: OverlayMap;
  /** Session-only (D-06) — append-only, never persisted; cleared by reset() on a project switch
   *  (a disclosed narrowing of D-06's literal "clears on app restart" wording — Plan 15 gap
   *  ledger item (l), R9 review BB21). */
  history: PersistHistoryEntry[];
  /** D-12's "attention badge" — set by a failed recordPersistResult/recordArmFailure, cleared by
   *  acknowledgeFailures() (called when the World tab becomes active — never steals focus). Also
   *  cleared by reset() on a project switch (a disclosed narrowing of D-12's badge-waits-for-the-
   *  user contract, including a switch-away-and-back to the SAME project — R10 review CC4, Plan
   *  15 gap ledger item (m)). */
  hasFailureBadge: boolean;
  /** (ROUND 10, AA4) HOST_CMD ack-correlation landing field — Plan 08's useChannelReader.ts is
   *  the only writer, Plan 14's WorldPanel the only reader (per Plan 08's HOST_CMD ACK PROTOCOL). */
  lastHostCommandResult: { epoch: number; code: number } | null;

  /** Re-scans overrideDir and replaces `tree`, reconciling sessionOverlay/selectedRowId against
   *  the new tree by content identity first (ROUND-3-REVIEW R3). `buildingTemplates` threads
   *  straight through to scanWorldEditorState — a caller that omits it silently gets
   *  buildingTemplateVfsPath: '' on every building (ROUND 3, R3). */
  refresh: (overrideDir: string, buildingTemplates?: Record<string, string>) => void;
  select: (rowId: string | null) => void;
  /**
   * Pushes `entry` to history and sets hasFailureBadge on a failure. `rowId`, when supplied by
   * the caller (Plan 08/13/14, which resolve the affected row at persist-result time), updates
   * sessionOverlay for that row to 'saved' (ok/warn) or 'failed' (error) — this store has no
   * other way to know which row a bare PersistHistoryEntry describes.
   */
  recordPersistResult: (entry: PersistHistoryEntry, rowId?: string) => void;
  setArmed: (rowId: string) => void;
  clearArmed: (rowId: string) => void;
  /** Clears hasFailureBadge — called when the World tab becomes active (D-12: passive until the
   *  user looks, never steals focus). */
  acknowledgeFailures: () => void;
  /** (C8) An arm-attempt failure — before any building/decoration is confirmed, so there is no
   *  richer identity than the caller's already-human-readable reason string (verbatim, never
   *  reformatted — SC1-clean by the caller's contract). */
  recordArmFailure: (reason: string) => void;
  /** (ROUND 10, AA5; R9 review BB2/BB5) Restores ALL SIX state fields to their module-initial
   *  values. Invoked SOLELY by this store's own module-scope workspaceStore subscription below —
   *  never call this from a component. */
  reset: () => void;
  /** (ROUND 10, AA4) Replaces lastHostCommandResult with a NEW object every call — never mutates
   *  in place, so a selector subscribed to it re-renders. */
  setLastHostCommandResult: (epoch: number, code: number) => void;
}

// ─── Shared history+badge helper (recordPersistResult and recordArmFailure both call this — no
//     duplicated badge-setting logic) ────────────────────────────────────────────────────────

function pushHistoryEntry(
  set: (partial: Partial<WorldEditorStore> | ((s: WorldEditorStore) => Partial<WorldEditorStore>)) => void,
  entry: PersistHistoryEntry,
): void {
  set((state) => ({
    history: [...state.history, entry],
    hasFailureBadge: state.hasFailureBadge || entry.outcome === 'error',
  }));
}

// ─── Module-initial state (also reset()'s target — kept as one literal, never duplicated) ─────

function initialState(): Pick<
  WorldEditorStore,
  'tree' | 'selectedRowId' | 'sessionOverlay' | 'history' | 'hasFailureBadge' | 'lastHostCommandResult'
> {
  return {
    tree: [],
    selectedRowId: null,
    sessionOverlay: new Map(),
    history: [],
    hasFailureBadge: false,
    lastHostCommandResult: null,
  };
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useWorldEditorStore = create<WorldEditorStore>((set, get) => ({
  ...initialState(),

  refresh: (overrideDir: string, buildingTemplates?: Record<string, string>) => {
    const newTree = scanWorldEditorState(overrideDir, buildingTemplates);
    const { tree: oldTree, sessionOverlay: oldOverlay, selectedRowId: oldSelectedRowId } = get();
    const { overlay, selectedRowId } = reconcileForRefresh(oldTree, newTree, oldOverlay, oldSelectedRowId);
    set({ tree: newTree, sessionOverlay: overlay, selectedRowId });
  },

  select: (rowId: string | null) => set({ selectedRowId: rowId }),

  recordPersistResult: (entry: PersistHistoryEntry, rowId?: string) => {
    pushHistoryEntry(set, entry);
    if (rowId !== undefined) {
      set((state) => {
        const overlay = new Map(state.sessionOverlay);
        overlay.set(rowId, entry.outcome === 'error' ? 'failed' : 'saved');
        return { sessionOverlay: overlay };
      });
    }
  },

  setArmed: (rowId: string) =>
    set((state) => {
      const overlay = new Map(state.sessionOverlay);
      overlay.set(rowId, 'armed');
      return { sessionOverlay: overlay };
    }),

  clearArmed: (rowId: string) =>
    set((state) => {
      const overlay = new Map(state.sessionOverlay);
      overlay.delete(rowId);
      return { sessionOverlay: overlay };
    }),

  acknowledgeFailures: () => set({ hasFailureBadge: false }),

  recordArmFailure: (reason: string) => {
    pushHistoryEntry(set, {
      timestampISO: new Date().toISOString(),
      buildingLabel: 'unknown',
      decorationLabel: 'unknown',
      outcome: 'error',
      message: reason,
    });
  },

  reset: () => set(initialState()),

  setLastHostCommandResult: (epoch: number, code: number) => set({ lastHostCommandResult: { epoch, code } }),
}));

// ─── PROJECT-SWITCH RESET ORDERING CONTRACT (canonical statement — R9 review BB2/BB5) ─────────
//
// This store resets ITSELF via a module-scope subscription on useWorkspaceStore, registered
// here at the bottom of the module — NOT via a React effect. zustand v5's vanilla
// subscribe(listener) runs the listener SYNCHRONOUSLY inside the very set() call that changes
// studioDir (workspaceStore.ts's openComplete/close), strictly before React schedules a
// re-render — reset-before-render. The rule fires on every non-null->different studioDir
// transition (A->B and A->null both reset; the initial null->A open is not a switch).
//
// PREMISE (P1, R10 review CC15): this derivation relies on no forced-synchronous React flush
// API being used anywhere on the workspaceStore-set path (React's default batching applies) —
// enforced by this file's own test's standing "P1" gate, which scans packages/renderer/src for
// React's forced-synchronous-flush escape hatch and asserts zero occurrences (phrased here
// without the literal identifier so this comment itself can never trip that same gate).
// PREMISE (P2): this module (and removeUndoStore.ts, Plan 13) must be EVALUATED — its bare
// module-scope subscribe() side effect registered — before the first project switch;
// packages/renderer/package.json declares no "sideEffects" field, so bundlers must assume side
// effects and preserve this registration.
//
// TEST-ISOLATION RECIPE (R10 review CC9): suites that seed useWorkspaceStore.setState({
// studioDir: ... }) in beforeEach must seed studioDir FIRST, then seed this store's own state —
// under that ordering any triggered reset runs before the dependent seeding and is harmless;
// never seed this store's state before changing studioDir inside the same setup block.
const unsubscribeProjectSwitchReset = useWorkspaceStore.subscribe((state, prevState) => {
  if (prevState.studioDir !== null && state.studioDir !== prevState.studioDir) {
    useWorldEditorStore.getState().reset();
  }
});
if (import.meta.hot) {
  import.meta.hot.dispose(() => unsubscribeProjectSwitchReset());
}
