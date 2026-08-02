/**
 * packages/renderer/src/state/worldEditorStore.test.ts
 * Tree + session overlay + persist history + attention badge (D-05/D-06/D-12/C8).
 */

import fs from 'fs';
import path from 'path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/worldEditorScan', () => ({ scanWorldEditorState: vi.fn() }));

import { scanWorldEditorState, type WorldEditorBuilding } from '../services/worldEditorScan';
import {
  useWorldEditorStore,
  worldEditorRowId,
  worldEditorBuildingRowId,
  parseWorldEditorRowId,
  formatPersistMessage,
  type PersistHistoryEntry,
} from './worldEditorStore';
import { useWorkspaceStore } from './workspaceStore';

const mockScan = vi.mocked(scanWorldEditorState);

// TEST-ISOLATION RECIPE (per the subscription's own comment): seed studioDir FIRST, then this
// store's state — so any reset() the seed triggers runs before the dependent seeding.
beforeEach(() => {
  useWorkspaceStore.setState({
    status: { kind: 'idle' }, folderPath: null, studioDir: null, workspaceName: null,
    clientPath: null, deployModel: null, hasStaleDeployment: false,
  });
  useWorldEditorStore.getState().reset();
  mockScan.mockReset();
});

// ─── worldEditorRowId / parseWorldEditorRowId (MED-7) ──────────────────────────────────────────

describe('row-id helpers', () => {
  it('round-trips a decoration row id', () => {
    const id = worldEditorRowId('1082874', 'alcove1', 3);
    expect(parseWorldEditorRowId(id)).toEqual({ kind: 'decoration', buildingId: '1082874', cellName: 'alcove1', rowIndex: 3 });
  });

  it('round-trips a building row id', () => {
    const id = worldEditorBuildingRowId('1082874');
    expect(parseWorldEditorRowId(id)).toEqual({ kind: 'building', buildingId: '1082874' });
  });

  it('throws on a malformed id (2 segments)', () => {
    expect(() => parseWorldEditorRowId('a:b')).toThrow(/malformed row id/);
  });

  it('throws on a decoration id with a non-numeric rowIndex segment', () => {
    expect(() => parseWorldEditorRowId('b1:cell:x')).toThrow(/malformed row id/);
  });
});

// ─── formatPersistMessage (D-10) ────────────────────────────────────────────────────────────────

describe('formatPersistMessage', () => {
  it('mirrorToStockIlf=true returns baseLabel unchanged', () => {
    expect(formatPersistMessage('saved', true)).toBe('saved');
  });

  it('mirrorToStockIlf=false appends the exact D-10 suffix', () => {
    expect(formatPersistMessage('saved', false)).toBe(
      'saved — mirror off — not visible on hybrid sessions until reload into an editor scene',
    );
  });
});

// ─── refresh() plumbing ─────────────────────────────────────────────────────────────────────────

function building(overrides: Partial<WorldEditorBuilding> = {}): WorldEditorBuilding {
  return {
    buildingId: 'b1',
    displayLabel: 'b1',
    editedIlfPath: '/x/edit_b1.ilf',
    derivedTemplatePath: '/x/edit_b1.iff',
    buildingTemplateVfsPath: '',
    decorations: [],
    ...overrides,
  };
}

describe('refresh()', () => {
  it('threads overrideDir + buildingTemplates straight through to scanWorldEditorState', () => {
    const templates = { b1: 'object/building/tatooine/shared_cantina_tatooine.iff' };
    mockScan.mockReturnValue([building({ buildingTemplateVfsPath: templates.b1 })]);

    useWorldEditorStore.getState().refresh('/override', templates);

    expect(mockScan).toHaveBeenCalledWith('/override', templates);
    expect(useWorldEditorStore.getState().tree[0].buildingTemplateVfsPath).toBe(templates.b1);
  });

  it('replaces tree without clearing session state (history preserved across a tree replacement)', () => {
    mockScan.mockReturnValue([building()]);
    useWorldEditorStore.getState().refresh('/override');
    useWorldEditorStore.getState().recordArmFailure('no building id — hover a decoration, then Arm');
    expect(useWorldEditorStore.getState().history).toHaveLength(1);

    mockScan.mockReturnValue([building({ displayLabel: 'renamed' })]);
    useWorldEditorStore.getState().refresh('/override');
    expect(useWorldEditorStore.getState().history).toHaveLength(1); // preserved
    expect(useWorldEditorStore.getState().tree[0].displayLabel).toBe('renamed'); // tree replaced
  });

  it('reconciles a shifted-index sessionOverlay entry to its new composite id by content identity (ROUND-3-REVIEW R3)', () => {
    const TABLE = 'object/tangible/furniture/shared_frn_table.iff';
    // OLD tree: 'b1' has the SAME decoration surviving at rowIndex=1 and rowIndex=4 (simulating a
    // state after earlier rows 0/2/3 were removed elsewhere).
    const oldTree = [building({
      decorations: [
        { cellName: 'cell', rowIndex: 1, objectTemplateName: TABLE, transform: Array(12).fill(0) },
        { cellName: 'cell', rowIndex: 4, objectTemplateName: TABLE, transform: Array(12).fill(1) },
      ],
    })];
    mockScan.mockReturnValue(oldTree);
    useWorldEditorStore.getState().refresh('/override');

    const oldId = worldEditorRowId('b1', 'cell', 4);
    useWorldEditorStore.setState((s) => {
      const overlay = new Map(s.sessionOverlay);
      overlay.set(oldId, 'saved');
      return { sessionOverlay: overlay, selectedRowId: oldId };
    });

    // NEW scan: one further row removed — the SAME decoration (rowIndex=4 one) is now at rowIndex=1.
    const newTree = [building({
      decorations: [
        { cellName: 'cell', rowIndex: 0, objectTemplateName: 'object/tangible/other.iff', transform: Array(12).fill(9) },
        { cellName: 'cell', rowIndex: 1, objectTemplateName: TABLE, transform: Array(12).fill(1) },
      ],
    })];
    mockScan.mockReturnValue(newTree);
    useWorldEditorStore.getState().refresh('/override');

    const newId = worldEditorRowId('b1', 'cell', 1);
    const state = useWorldEditorStore.getState();
    expect(state.sessionOverlay.get(newId)).toBe('saved');
    expect(state.sessionOverlay.has(oldId)).toBe(false);
    expect(state.selectedRowId).toBe(newId);
  });

  it('drops a sessionOverlay entry whose content is genuinely absent from the new scan (never inherited by an unrelated row at the freed index)', () => {
    const TABLE = 'object/tangible/furniture/shared_frn_table.iff';
    const oldTree = [building({
      decorations: [{ cellName: 'cell', rowIndex: 4, objectTemplateName: TABLE, transform: Array(12).fill(0) }],
    })];
    mockScan.mockReturnValue(oldTree);
    useWorldEditorStore.getState().refresh('/override');

    const oldId = worldEditorRowId('b1', 'cell', 4);
    useWorldEditorStore.setState((s) => {
      const overlay = new Map(s.sessionOverlay);
      overlay.set(oldId, 'saved');
      return { sessionOverlay: overlay, selectedRowId: oldId };
    });

    // NEW scan: an UNRELATED decoration lands at the freed rowIndex=4 slot; the old TABLE is gone.
    const newTree = [building({
      decorations: [{ cellName: 'cell', rowIndex: 4, objectTemplateName: 'object/tangible/other.iff', transform: Array(12).fill(9) }],
    })];
    mockScan.mockReturnValue(newTree);
    useWorldEditorStore.getState().refresh('/override');

    const state = useWorldEditorStore.getState();
    expect(state.sessionOverlay.size).toBe(0); // dropped, not inherited
    expect(state.selectedRowId).toBeNull();
  });
});

// ─── recordPersistResult / acknowledgeFailures / recordArmFailure ─────────────────────────────

function mkEntry(overrides: Partial<PersistHistoryEntry> = {}): PersistHistoryEntry {
  return {
    timestampISO: '2026-08-01T00:00:00.000Z',
    buildingLabel: 'Cantina',
    decorationLabel: 'Table',
    outcome: 'ok',
    message: 'saved',
    ...overrides,
  };
}

describe('recordPersistResult / acknowledgeFailures', () => {
  it('outcome=error sets hasFailureBadge=true; acknowledgeFailures() clears it', () => {
    useWorldEditorStore.getState().recordPersistResult(mkEntry({ outcome: 'error', message: 'failed' }));
    expect(useWorldEditorStore.getState().hasFailureBadge).toBe(true);
    useWorldEditorStore.getState().acknowledgeFailures();
    expect(useWorldEditorStore.getState().hasFailureBadge).toBe(false);
  });

  it('two persists to the SAME row_id accumulate in history (both entries kept, not overwritten)', () => {
    const rowId = worldEditorRowId('b1', 'cell', 0);
    useWorldEditorStore.getState().recordPersistResult(mkEntry({ message: 'first' }), rowId);
    useWorldEditorStore.getState().recordPersistResult(mkEntry({ message: 'second' }), rowId);
    const { history } = useWorldEditorStore.getState();
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.message)).toEqual(['first', 'second']);
  });

  it('updates sessionOverlay for the affected row when a rowId is supplied', () => {
    const rowId = worldEditorRowId('b1', 'cell', 0);
    useWorldEditorStore.getState().recordPersistResult(mkEntry({ outcome: 'ok' }), rowId);
    expect(useWorldEditorStore.getState().sessionOverlay.get(rowId)).toBe('saved');
    useWorldEditorStore.getState().recordPersistResult(mkEntry({ outcome: 'error' }), rowId);
    expect(useWorldEditorStore.getState().sessionOverlay.get(rowId)).toBe('failed');
  });
});

describe('recordArmFailure (C8)', () => {
  it('appends a history entry with the EXACT input reason (verbatim, no reformatting) and sets hasFailureBadge=true', () => {
    const reason = 'no building id — hover a decoration (or click the building), then Arm';
    useWorldEditorStore.getState().recordArmFailure(reason);
    const { history, hasFailureBadge } = useWorldEditorStore.getState();
    expect(history).toHaveLength(1);
    expect(history[0].message).toBe(reason);
    expect(history[0].outcome).toBe('error');
    expect(hasFailureBadge).toBe(true);
  });
});

// ─── setArmed / clearArmed ──────────────────────────────────────────────────────────────────────

describe('setArmed / clearArmed', () => {
  it('sets and clears an armed overlay entry', () => {
    const rowId = worldEditorRowId('b1', 'cell', 0);
    useWorldEditorStore.getState().setArmed(rowId);
    expect(useWorldEditorStore.getState().sessionOverlay.get(rowId)).toBe('armed');
    useWorldEditorStore.getState().clearArmed(rowId);
    expect(useWorldEditorStore.getState().sessionOverlay.has(rowId)).toBe(false);
  });
});

// ─── reset() (ROUND 10 AA5; R9 review BB5 — all SIX fields) ────────────────────────────────────

describe('reset()', () => {
  it('restores all SIX state fields to their module-initial values', () => {
    mockScan.mockReturnValue([building()]);
    useWorldEditorStore.getState().refresh('/override');
    useWorldEditorStore.getState().select(worldEditorBuildingRowId('b1'));
    useWorldEditorStore.getState().setArmed(worldEditorRowId('b1', 'cell', 0));
    useWorldEditorStore.getState().recordArmFailure('boom');
    useWorldEditorStore.getState().setLastHostCommandResult(7, 1);

    const before = useWorldEditorStore.getState();
    expect(before.tree.length).toBeGreaterThan(0);
    expect(before.selectedRowId).not.toBeNull();
    expect(before.sessionOverlay.size).toBeGreaterThan(0);
    expect(before.history.length).toBeGreaterThan(0);
    expect(before.hasFailureBadge).toBe(true);
    expect(before.lastHostCommandResult).not.toBeNull();

    useWorldEditorStore.getState().reset();

    const after = useWorldEditorStore.getState();
    expect(after.tree).toEqual([]);
    expect(after.selectedRowId).toBeNull();
    expect(after.sessionOverlay.size).toBe(0);
    expect(after.history).toEqual([]);
    expect(after.hasFailureBadge).toBe(false);
    expect(after.lastHostCommandResult).toBeNull();
  });
});

// ─── lastHostCommandResult / setLastHostCommandResult (ROUND 10 AA4) ───────────────────────────

describe('setLastHostCommandResult', () => {
  it('starts null and replaces with a NEW object each call (reference inequality, no in-place mutation)', () => {
    expect(useWorldEditorStore.getState().lastHostCommandResult).toBeNull();
    useWorldEditorStore.getState().setLastHostCommandResult(1, 0);
    const first = useWorldEditorStore.getState().lastHostCommandResult;
    expect(first).toEqual({ epoch: 1, code: 0 });
    useWorldEditorStore.getState().setLastHostCommandResult(2, 5);
    const second = useWorldEditorStore.getState().lastHostCommandResult;
    expect(second).toEqual({ epoch: 2, code: 5 });
    expect(second).not.toBe(first);
  });
});

// ─── PROJECT-SWITCH RESET ORDERING CONTRACT (R9 review BB2; R10 review CC9/CC15) ───────────────

describe('project-switch reset subscription', () => {
  it('resets this store SYNCHRONOUSLY when studioDir changes from one non-null value to a different one (no component mounted — P2 registration-at-import gate)', () => {
    useWorkspaceStore.setState({ studioDir: 'A' });
    useWorldEditorStore.getState().select(worldEditorBuildingRowId('b1'));
    useWorldEditorStore.getState().setLastHostCommandResult(1, 0);
    expect(useWorldEditorStore.getState().selectedRowId).not.toBeNull();

    useWorkspaceStore.setState({ studioDir: 'B' }); // A -> B: a real switch

    // Synchronously, immediately after that call returns — no render/effect flush in between.
    const state = useWorldEditorStore.getState();
    expect(state.selectedRowId).toBeNull();
    expect(state.lastHostCommandResult).toBeNull();
  });

  it('does NOT fire on the initial null->project transition (not a switch)', () => {
    useWorldEditorStore.getState().select(worldEditorBuildingRowId('b1'));
    useWorkspaceStore.setState({ studioDir: 'A' }); // null -> 'A': initial open, not a switch
    expect(useWorldEditorStore.getState().selectedRowId).not.toBeNull();
  });

  it('DOES fire on a non-null -> null transition (close())', () => {
    useWorkspaceStore.setState({ studioDir: 'A' });
    useWorldEditorStore.getState().select(worldEditorBuildingRowId('b1'));
    useWorkspaceStore.getState().close(); // 'A' -> null
    expect(useWorldEditorStore.getState().selectedRowId).toBeNull();
  });
});

// ─── Standing gates (P1/P2 premises) ───────────────────────────────────────────────────────────

describe('standing gates', () => {
  it('P1: no forced-synchronous React flush API appears anywhere under packages/renderer/src', () => {
    // The needle is built at runtime (never a literal in this file's own source) so this gate
    // test can never trip itself — it must only catch the identifier appearing in APPLICATION
    // code, not in this line describing the search.
    const needle = ['flush', 'Sync'].join('');
    const root = path.join(__dirname, '..');
    const selfPath = path.resolve(__filename);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (path.resolve(full) === selfPath) continue; // this gate's own implementation, not a usage
        const text = fs.readFileSync(full, 'utf8');
        if (text.includes(needle)) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('P2: package.json declares no "sideEffects" field, or lists this store as side-effectful', () => {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { sideEffects?: unknown };
    if (pkg.sideEffects !== undefined) {
      expect(pkg.sideEffects).not.toBe(false);
    } else {
      expect(pkg.sideEffects).toBeUndefined();
    }
  });
});
