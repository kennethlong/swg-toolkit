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
import { sendReloadCurrentScene, sendLoadEditorScene, sendTeleport } from '../../services/hostCommand';
import { useRemoveUndoStore, type RemovedRowEntry } from '../../state/removeUndoStore';
import RemoveUndoToast from './RemoveUndoToast';

type WorldEditorBookmark = NonNullable<WorkspaceBindingMeta['worldEditorBookmarks']>[number];

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
        <button type="button" onClick={() => handleStubClick('+ Add decoration…')} style={primaryBtnStyle}>
          + Add decoration…
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => handleStubClick('Stage to project')} style={stubBtnStyle}>
          Stage to project
        </button>
      </div>

      {/* D-03: panel-scoped (NOT globally mounted like DeleteUndoToast, ROUND 6/X5/Z17) — a
          project switch (key={studioDir}) forces a full unmount/remount, reusing this
          component's own mount-time reconstruction (ROUND 10/AA2) instead of a bespoke reset. */}
      <RemoveUndoToast key={studioDir ?? 'no-project'} onUndo={handleUndo} />
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
