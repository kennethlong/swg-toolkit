/**
 * packages/renderer/src/panels/world/WorldPanel.test.tsx
 * Component tests for WorldPanel — 019-A's tree/mirror-toggle/live-strip/detail-card spine
 * (this plan's scope), the D-08 disabled per-instance option, the C12 failure badge, the D-07b
 * mismatch hint, and ROUND 3-6's resolveOverridePair()/refreshTree() correctness fixes.
 *
 * Mocking strategy:
 *   - useWorldEditorStore / useLiveStore / useWorkspaceStore stay REAL (seeded via setState(),
 *     matching this repo's established pattern — see useChannelReader.test.ts).
 *   - worldEditorScan.ts (resolveScanRoot, scanWorldEditorState), decorationPersistOrchestrator.ts
 *     (makeReadVfs, reconcileMirrorMode), and projectBinding.ts (readWorkspaceJson) are partially
 *     mocked (importOriginal spread) so refresh()'s real reconciliation logic still runs, but no
 *     real fs/detectClients work happens.
 */

import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/worldEditorScan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/worldEditorScan')>();
  return { ...actual, resolveScanRoot: vi.fn(), scanWorldEditorState: vi.fn() };
});
vi.mock('../../services/decorationPersistOrchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/decorationPersistOrchestrator')>();
  return {
    ...actual,
    makeReadVfs: vi.fn(),
    reconcileMirrorMode: vi.fn(),
    removeDecorationRow: vi.fn(),
    addBackDecorationRow: vi.fn(),
  };
});
vi.mock('../../services/projectBinding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/projectBinding')>();
  return { ...actual, readWorkspaceJson: vi.fn(), updateWorkspaceMeta: vi.fn() };
});
vi.mock('../../services/logService', () => ({ log: vi.fn() }));
vi.mock('../../services/hostCommand', () => ({
  sendReloadCurrentScene: vi.fn(),
  sendLoadEditorScene: vi.fn(),
  sendTeleport: vi.fn(),
  sendStartPlacement: vi.fn(),
}));

import WorldPanel from './WorldPanel';
import { useWorldEditorStore, worldEditorRowId, worldEditorBuildingRowId } from '../../state/worldEditorStore';
import type { WorldEditorBuilding } from '../../services/worldEditorScan';
import { useLiveStore } from '../../state/liveStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { resolveScanRoot, scanWorldEditorState } from '../../services/worldEditorScan';
import { makeReadVfs, reconcileMirrorMode, removeDecorationRow, addBackDecorationRow } from '../../services/decorationPersistOrchestrator';
import { readWorkspaceJson, updateWorkspaceMeta } from '../../services/projectBinding';
import { log } from '../../services/logService';
import { sendReloadCurrentScene, sendLoadEditorScene, sendTeleport, sendStartPlacement } from '../../services/hostCommand';
import { useTreStore, type VfsEntry } from '../../state/treStore';
import { formatPersistMessage } from '../../state/worldEditorStore';
import { useRemoveUndoStore } from '../../state/removeUndoStore';
import type { WorkspaceBindingMeta } from '@swg/contracts';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BUILDING_1: WorldEditorBuilding = {
  buildingId: '1082874',
  displayLabel: 'Cantina — Mos Eisley',
  editedIlfPath: 'C:/override/interiorlayout/toolkit/edit_1082874.ilf',
  derivedTemplatePath: 'C:/override/object/building/toolkit/edit_1082874.iff',
  buildingTemplateVfsPath: 'object/building/tatooine/shared_cantina_tatooine.iff',
  decorations: [
    {
      cellName: 'alcove1',
      rowIndex: 3,
      objectTemplateName: 'object/tangible/furniture/tatooine/shared_frn_tatt_table_cantina_table_3.iff',
      transform: [1, 0, 0, 15.96, 0, 1, 0, -0.9, 0, 0, 1, -14.33],
    },
    {
      cellName: 'alcove1',
      rowIndex: 7,
      objectTemplateName: 'object/tangible/furniture/tatooine/shared_frn_tatt_chair_small.iff',
      transform: [1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3],
    },
  ],
};

const BUILDING_2: WorldEditorBuilding = {
  buildingId: '1084112',
  displayLabel: 'Guild Hall — Anchorhead',
  editedIlfPath: 'C:/override/interiorlayout/toolkit/edit_1084112.ilf',
  derivedTemplatePath: 'C:/override/object/building/toolkit/edit_1084112.iff',
  buildingTemplateVfsPath: '',
  decorations: [
    {
      cellName: 'main',
      rowIndex: 0,
      objectTemplateName: 'object/tangible/furniture/generic/shared_frn_generic_table.iff',
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    },
  ],
};

function seedTree(): void {
  vi.mocked(scanWorldEditorState).mockReturnValue([BUILDING_1, BUILDING_2]);
}

function defaultMeta(overrides: Partial<WorkspaceBindingMeta> = {}): WorkspaceBindingMeta {
  return {
    kind: 'client',
    clientPath: '/bound/client',
    cfgPath: '/bound/client/swgemu.cfg',
    mirrorToStockIlf: true,
    worldEditorBuildingTemplates: {},
    ...overrides,
  };
}

function makeApi(initialActive = false) {
  let handler: ((e: { isActive: boolean }) => void) | null = null;
  const api = {
    setTitle: vi.fn(),
    isActive: initialActive,
    onDidActiveChange: vi.fn((cb: (e: { isActive: boolean }) => void) => {
      handler = cb;
      return { dispose: vi.fn() };
    }),
  };
  return {
    api,
    fireActiveChange: (isActive: boolean) => handler?.({ isActive }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPanel(api: any = makeApi().api) {
  return render(<WorldPanel api={api} containerApi={{} as never} params={{}} /* eslint-disable-line @typescript-eslint/no-explicit-any */ />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorldEditorStore.setState({
    tree: [],
    selectedRowId: null,
    sessionOverlay: new Map(),
    history: [],
    hasFailureBadge: false,
    lastHostCommandResult: null,
  });
  useLiveStore.setState({ status: { kind: 'idle' }, clientLabel: null });
  useWorkspaceStore.setState({ studioDir: '/fake/studio', clientPath: '/bound/client' });
  useRemoveUndoStore.setState({ pending: [], undoErrors: new Map() });

  vi.mocked(resolveScanRoot).mockReturnValue('/override');
  vi.mocked(scanWorldEditorState).mockReturnValue([]);
  vi.mocked(readWorkspaceJson).mockReturnValue(defaultMeta());
  vi.mocked(makeReadVfs).mockReturnValue(vi.fn(() => Buffer.from('stub')));
  vi.mocked(reconcileMirrorMode).mockReturnValue({ failures: [] });
  vi.mocked(removeDecorationRow).mockReturnValue({
    rowIndex: 0,
    cellName: 'alcove1',
    derivedTemplateVfsPath: 'object/building/toolkit/edit_1082874.iff',
    editedIlfVfsPath: 'interiorlayout/toolkit/edit_1082874.ilf',
    derivedTemplateFilePath: '/override/object/building/toolkit/edit_1082874.iff',
    editedIlfFilePath: '/override/interiorlayout/toolkit/edit_1082874.ilf',
    stagedEntries: [],
  });
  vi.mocked(addBackDecorationRow).mockReturnValue({
    rowIndex: 0,
    cellName: 'alcove1',
    derivedTemplateVfsPath: 'object/building/toolkit/edit_1082874.iff',
    editedIlfVfsPath: 'interiorlayout/toolkit/edit_1082874.ilf',
    derivedTemplateFilePath: '/override/object/building/toolkit/edit_1082874.iff',
    editedIlfFilePath: '/override/interiorlayout/toolkit/edit_1082874.ilf',
    stagedEntries: [],
  });
});

afterEach(() => {
  cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorldPanel — 019-A tree/mirror-toggle/live-strip/detail-card spine', () => {
  it('renders the live-session strip, mirror toggle row + hint, "Edited buildings" count chip, and every building/decoration row', () => {
    seedTree();
    renderPanel();

    expect(screen.getByText('No live session')).not.toBeNull();
    expect(screen.getByText('Mirror to stock layout')).not.toBeNull();
    expect(screen.getByText(/per-template: all buildings with this layout show the edit/)).not.toBeNull();
    expect(screen.getByText('Edited buildings')).not.toBeNull();
    expect(screen.getByText('2')).not.toBeNull(); // count chip

    expect(screen.getByText('Cantina — Mos Eisley')).not.toBeNull();
    expect(screen.getByText('Guild Hall — Anchorhead')).not.toBeNull();
    const decoRows = screen.getAllByTestId('world-decoration-row');
    expect(decoRows).toHaveLength(3);
    expect(screen.getByText('shared_frn_tatt_table_cantina_table_3.iff')).not.toBeNull();
    expect(screen.getByText('shared_frn_tatt_chair_small.iff')).not.toBeNull();
    expect(screen.getByText('shared_frn_generic_table.iff')).not.toBeNull();
  });

  it('selecting a decoration row shows the detail card with Decoration/Cell·row/Position/Last persist/Files', () => {
    seedTree();
    renderPanel();

    fireEvent.click(screen.getByText('shared_frn_tatt_table_cantina_table_3.iff'));

    const card = screen.getByTestId('world-detail-card');
    expect(within(card).getByText('Decoration')).not.toBeNull();
    expect(within(card).getByText('Cell / row')).not.toBeNull();
    expect(within(card).getByText('alcove1 · row 3')).not.toBeNull();
    expect(within(card).getByText('Position')).not.toBeNull();
    expect(within(card).getByText('15.96, -0.90, -14.33')).not.toBeNull();
    expect(within(card).getByText('Last persist')).not.toBeNull();
    expect(within(card).getByText('not yet persisted this session')).not.toBeNull();
    expect(within(card).getByText('Files')).not.toBeNull();
    expect(within(card).getByText(/edit_1082874\.ilf.*edit_1082874\.iff/)).not.toBeNull();
  });

  it('D-08: renders a VISIBLE, DISABLED "Per-instance (server repoint)" option with a "coming later" hint, and clicking it never calls reconcileMirrorMode', () => {
    seedTree();
    renderPanel();

    const perInstance = screen.getByText('Per-instance (server repoint)');
    expect(perInstance).not.toBeNull();
    const control = screen.getByRole('radio');
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText(/coming later/).length).toBeGreaterThan(0);

    fireEvent.click(control);
    expect(reconcileMirrorMode).not.toHaveBeenCalled();
  });

  it('mirror toggle onChange resolves a real overrideDir/readVfs via resolveOverridePair and calls ONLY reconcileMirrorMode (never updateWorkspaceMeta directly)', () => {
    seedTree();
    renderPanel();

    const toggle = screen.getByRole('switch', { name: 'Mirror to stock layout' });
    fireEvent.click(toggle);

    expect(resolveScanRoot).toHaveBeenCalled();
    expect(makeReadVfs).toHaveBeenCalledWith('/override');
    expect(reconcileMirrorMode).toHaveBeenCalledWith('/fake/studio', '/override', expect.any(Function), false);
    expect(updateWorkspaceMeta).not.toHaveBeenCalled();
  });

  it('a failed reconcile (all diskState unchanged) records a durable history entry with the all-or-nothing wording, warns via log(), and the switch stays at its PRE-toggle value', () => {
    seedTree();
    vi.mocked(reconcileMirrorMode).mockReturnValue({
      failures: [{ buildingId: '1082874', error: 'unknown template', diskState: 'unchanged' }],
    });
    renderPanel();

    const toggle = screen.getByRole('switch', { name: 'Mirror to stock layout' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);

    expect(log).toHaveBeenCalledWith('warn', 'log', expect.stringContaining('1082874'));
    const history = useWorldEditorStore.getState().history;
    expect(history).toHaveLength(1);
    expect(history[0].outcome).toBe('error');
    expect(history[0].message).toMatch(/no buildings' mirrors were changed/);
    // refreshTree() re-reads the (unchanged) persisted meta — switch reflects the PRE-toggle value.
    expect(screen.getByRole('switch', { name: 'Mirror to stock layout' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a failed reconcile with a diskState:"uncertain" entry records the HEDGED wording naming the uncertain building, never the unconditional claim', () => {
    seedTree();
    vi.mocked(reconcileMirrorMode).mockReturnValue({
      failures: [
        { buildingId: '1082874', error: 'sibling threw', diskState: 'unchanged' },
        { buildingId: '1084112', error: 'rollback double-fault', diskState: 'uncertain' },
      ],
    });
    renderPanel();

    fireEvent.click(screen.getByRole('switch', { name: 'Mirror to stock layout' }));

    const history = useWorldEditorStore.getState().history;
    expect(history).toHaveLength(1);
    expect(history[0].message).toMatch(/could not be verified after a rollback failure/);
    expect(history[0].message).toContain('1084112');
    expect(history[0].message).not.toMatch(/^mirror mode change blocked — no buildings' mirrors were changed/);
  });

  it('a null resolveScanRoot makes the mirror toggle a no-op (makeReadVfs/reconcileMirrorMode never called)', () => {
    seedTree();
    vi.mocked(resolveScanRoot).mockReturnValue(null);
    renderPanel();

    const toggle = screen.getByRole('switch', { name: 'Mirror to stock layout' });
    fireEvent.click(toggle);

    expect(makeReadVfs).not.toHaveBeenCalled();
    expect(reconcileMirrorMode).not.toHaveBeenCalled();
  });

  it('a null resolveScanRoot on mount renders the words-only disabled state and never calls refresh() (scanWorldEditorState never called)', () => {
    vi.mocked(resolveScanRoot).mockReturnValue(null);
    renderPanel();

    expect(screen.getByText(/no live session \/ project not bound to a client/i)).not.toBeNull();
    expect(scanWorldEditorState).not.toHaveBeenCalled();
  });

  it('a seeded studioDir:null makes resolveOverridePair() return null WITHOUT ever calling readWorkspaceJson, and renders the disabled state', () => {
    useWorkspaceStore.setState({ studioDir: null });
    renderPanel();

    expect(readWorkspaceJson).not.toHaveBeenCalled();
    expect(screen.getByText(/no live session \/ project not bound to a client/i)).not.toBeNull();
  });

  it('exercising the mirror toggle through a real fireEvent click completes without throwing "Invalid hook call" (resolveOverridePair reads studioDir via getState(), never a hook selector)', () => {
    seedTree();
    renderPanel();
    expect(() => {
      fireEvent.click(screen.getByRole('switch', { name: 'Mirror to stock layout' }));
    }).not.toThrow();
  });

  it('clicking a detail-card stub button shows the honest "not yet wired" message, never the sketch mock\'s success-implying copy', () => {
    seedTree();
    renderPanel();
    fireEvent.click(screen.getByText('shared_frn_tatt_table_cantina_table_3.iff'));

    fireEvent.click(screen.getByText('Go to'));
    expect(log).toHaveBeenCalledWith('info', 'log', expect.stringContaining('not yet wired'));
    expect(log).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining('Teleporting'));

    fireEvent.click(screen.getByText('Revert'));
    expect(log).toHaveBeenCalledWith('info', 'log', expect.stringContaining('not yet wired'));
    expect(log).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining('Reverting row 3 to stock transform'));

    fireEvent.click(screen.getByText('Edit in game'));
    expect(log).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining('Row pinned to overlay gizmo'));
  });

  it('D-13: a history entry carrying before/after transforms renders the FULL 12-element readout in the detail card', () => {
    seedTree();
    useWorldEditorStore.setState({
      history: [
        {
          timestampISO: new Date().toISOString(),
          buildingLabel: 'Cantina — Mos Eisley',
          decorationLabel: 'Cantina Table',
          outcome: 'ok',
          message: 'Rebound + saved.',
          cellName: 'alcove1',
          rowIndex: 3,
          beforeTransform: [1, 0, 0, 16.82, 0, 1, 0, -0.9, 0, 0, 1, -14.96],
          afterTransform: [1, 0, 0, 15.96, 0, 1, 0, -0.9, 0, 0, 1, -14.33],
        },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByText('shared_frn_tatt_table_cantina_table_3.iff'));

    const before = screen.getByTestId('world-last-persist-before').textContent ?? '';
    const after = screen.getByTestId('world-last-persist-after').textContent ?? '';
    expect(before).toContain('16.82');
    expect(after).toContain('15.96');
  });

  it('D-13/ROUND-3-REVIEW-R4: a ROTATE-ONLY history entry (same translation, different rotation) renders a VISIBLY DIFFERENT before vs after string', () => {
    seedTree();
    useWorldEditorStore.setState({
      history: [
        {
          timestampISO: new Date().toISOString(),
          buildingLabel: 'Cantina — Mos Eisley',
          decorationLabel: 'Cantina Table',
          outcome: 'ok',
          message: 'Rebound + saved.',
          cellName: 'alcove1',
          rowIndex: 3,
          // Same translation (cols 3/7/11); rotation (the rest) differs.
          beforeTransform: [1, 0, 0, 15.96, 0, 1, 0, -0.9, 0, 0, 1, -14.33],
          afterTransform: [0, -1, 0, 15.96, 1, 0, 0, -0.9, 0, 0, 1, -14.33],
        },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByText('shared_frn_tatt_table_cantina_table_3.iff'));

    const before = screen.getByTestId('world-last-persist-before').textContent ?? '';
    const after = screen.getByTestId('world-last-persist-after').textContent ?? '';
    expect(before).not.toBe(after);
  });

  it('an entry lacking before/after data falls back to outcome-word-only rendering without throwing', () => {
    seedTree();
    useWorldEditorStore.setState({
      history: [
        {
          timestampISO: new Date().toISOString(),
          buildingLabel: 'Cantina — Mos Eisley',
          decorationLabel: 'Cantina Table',
          outcome: 'ok',
          message: 'Legacy entry, no transform data.',
          cellName: 'alcove1',
          rowIndex: 3,
        },
      ],
    });
    expect(() => renderPanel()).not.toThrow();
    fireEvent.click(screen.getByText('shared_frn_tatt_table_cantina_table_3.iff'));
    expect(screen.getByText('Legacy entry, no transform data.')).not.toBeNull();
  });

  it('the live-strip refresh control and the mirror toggle EACH independently call readWorkspaceJson at invocation time (never a cached mount-time meta)', () => {
    seedTree();
    renderPanel();
    const callsAfterMount = vi.mocked(readWorkspaceJson).mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(vi.mocked(readWorkspaceJson).mock.calls.length).toBeGreaterThan(callsAfterMount);

    const afterRefreshClick = vi.mocked(readWorkspaceJson).mock.calls.length;
    fireEvent.click(screen.getByRole('switch', { name: 'Mirror to stock layout' }));
    expect(vi.mocked(readWorkspaceJson).mock.calls.length).toBeGreaterThan(afterRefreshClick);
  });

  it('C12: with hasFailureBadge:true seeded, props.api.setTitle is called with a string containing the modified-dot suffix', () => {
    seedTree();
    const { api } = makeApi();
    useWorldEditorStore.setState({ hasFailureBadge: true });
    renderPanel(api);

    expect(api.setTitle).toHaveBeenCalledWith(expect.stringContaining('●'));
  });

  it('C12: onDidActiveChange firing with isActive:true calls acknowledgeFailures() exactly once', () => {
    seedTree();
    useWorldEditorStore.setState({ hasFailureBadge: true });
    const { api, fireActiveChange } = makeApi(false);
    const ackSpy = vi.spyOn(useWorldEditorStore.getState(), 'acknowledgeFailures');
    renderPanel(api);

    fireActiveChange(true);
    expect(ackSpy).toHaveBeenCalledTimes(1);
  });

  it('C12: a tab already active at mount time (isActive: true) acknowledges immediately, without waiting for a change event', () => {
    seedTree();
    useWorldEditorStore.setState({ hasFailureBadge: true });
    const { api } = makeApi(true);
    const ackSpy = vi.spyOn(useWorldEditorStore.getState(), 'acknowledgeFailures');
    renderPanel(api);

    expect(ackSpy).toHaveBeenCalledTimes(1);
  });

  it('D-07b: an attached client whose exe path differs from the project\'s bound clientPath renders the mismatch hint', () => {
    seedTree();
    useLiveStore.setState({ status: { kind: 'attached', pid: 1234, mappingName: 'm' }, clientLabel: 'D:/OtherClient/SwgClient_r.exe' });
    useWorkspaceStore.setState({ clientPath: '/bound/client' });
    renderPanel();

    expect(screen.getByText(/attached client differs from this project.s bound client/i)).not.toBeNull();
  });

  it('D-07b: an attached client whose exe path MATCHES the bound clientPath renders no mismatch hint', () => {
    seedTree();
    useLiveStore.setState({
      status: { kind: 'attached', pid: 1234, mappingName: 'm' },
      clientLabel: '/bound/client/SwgClient_r.exe',
    });
    useWorkspaceStore.setState({ clientPath: '/bound/client' });
    renderPanel();

    expect(screen.queryByText(/attached client differs/i)).toBeNull();
  });
});

describe('WorldPanel — 019-A Activity accordion (D-06/SC1, D-10)', () => {
  it('is collapsed by default, and expanding renders session persist history most-recent-first, styled by outcome', () => {
    useWorldEditorStore.setState({
      history: [
        {
          timestampISO: '2026-08-01T20:30:00.000Z',
          buildingLabel: 'Cantina — Mos Eisley',
          decorationLabel: 'x',
          outcome: 'warn',
          message: "couldn't match the picked table — recovered against the stock layout",
        },
        {
          timestampISO: '2026-08-01T20:48:00.000Z',
          buildingLabel: 'Guild Hall — Anchorhead',
          decorationLabel: 'x',
          outcome: 'error',
          message: 'rebind failed — building not in the loaded snapshot',
        },
        {
          timestampISO: '2026-08-01T21:07:00.000Z',
          buildingLabel: 'Cantina — Mos Eisley',
          decorationLabel: 'x',
          outcome: 'ok',
          message: 'Cantina Table saved — rebind OK, snapshot written',
        },
      ],
    });
    renderPanel();

    // Collapsed by default — entries not in the DOM yet.
    expect(screen.queryAllByTestId('world-activity-entry')).toHaveLength(0);

    fireEvent.click(screen.getByText('Activity'));

    const entries = screen.getAllByTestId('world-activity-entry');
    expect(entries).toHaveLength(3);
    // Most-recent-first.
    expect(entries[0].textContent).toContain('Cantina Table saved — rebind OK, snapshot written');
    expect(entries[0].getAttribute('data-outcome')).toBe('ok');
    expect(entries[1].getAttribute('data-outcome')).toBe('error');
    expect(entries[1].textContent).toContain('rebind failed — building not in the loaded snapshot');
    expect(entries[2].getAttribute('data-outcome')).toBe('warn');
    expect(entries[2].textContent).toContain("couldn't match the picked table — recovered against the stock layout");
  });

  it('an empty history renders a neutral placeholder line, not a blank expanded section', () => {
    useWorldEditorStore.setState({ history: [] });
    renderPanel();

    fireEvent.click(screen.getByText('Activity'));

    expect(screen.getByText('no activity yet this session')).not.toBeNull();
    expect(screen.queryAllByTestId('world-activity-entry')).toHaveLength(0);
  });

  it('D-10: an entry carrying the full mirror-off hybrid-session detail renders that ENTIRE sentence, untruncated', () => {
    const fullMessage = formatPersistMessage('saved', false);
    useWorldEditorStore.setState({
      history: [
        {
          timestampISO: new Date().toISOString(),
          buildingLabel: 'Cantina — Mos Eisley',
          decorationLabel: 'x',
          outcome: 'ok',
          message: fullMessage,
        },
      ],
    });
    renderPanel();

    fireEvent.click(screen.getByText('Activity'));

    const entries = screen.getAllByTestId('world-activity-entry');
    expect(entries).toHaveLength(1);
    expect(entries[0].textContent).toContain(fullMessage);
    expect(entries[0].textContent).toContain(
      '— mirror off — not visible on hybrid sessions until reload into an editor scene',
    );
  });
});

describe('WorldPanel — 019-A Scene accordion + footer (D-07, ROUND 3 R11a)', () => {
  it('the Editor-scene and Reload-scene buttons are disabled with a "no live session" hint offline, and never call hostCommand.ts on click', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Scene'));

    const loadBtn = screen.getByRole('button', { name: 'Load editor scene' }) as HTMLButtonElement;
    const reloadBtn = screen.getByRole('button', { name: 'Reload scene' }) as HTMLButtonElement;
    expect(loadBtn.disabled).toBe(true);
    expect(reloadBtn.disabled).toBe(true);
    expect(loadBtn.title).toBe('no live session');
    expect(reloadBtn.title).toBe('no live session');

    fireEvent.click(loadBtn);
    fireEvent.click(reloadBtn);
    expect(sendLoadEditorScene).not.toHaveBeenCalled();
    expect(sendReloadCurrentScene).not.toHaveBeenCalled();
  });

  it('when attached, "Editor scene" calls sendLoadEditorScene with the overlay\'s own default terrain/avatar, and "Reload scene" calls sendReloadCurrentScene — both with the live mappingName', () => {
    useLiveStore.setState({
      status: { kind: 'attached', pid: 1234, mappingName: 'm' },
      clientLabel: '/bound/client/SwgClient_r.exe',
    });
    renderPanel();
    fireEvent.click(screen.getByText('Scene'));

    fireEvent.click(screen.getByRole('button', { name: 'Load editor scene' }));
    expect(sendLoadEditorScene).toHaveBeenCalledWith(
      'm',
      'terrain/tatooine.trn',
      'object/creature/player/shared_human_male.iff',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reload scene' }));
    expect(sendReloadCurrentScene).toHaveBeenCalledWith('m');
  });

  it('seeded worldEditorBookmarks render as rows (name + coords) and dispatch sendTeleport with their exact coords when attached', () => {
    vi.mocked(readWorkspaceJson).mockReturnValue(
      defaultMeta({
        worldEditorBookmarks: [
          { name: 'Mos Eisley cantina', scene: '', x: 3428, y: 8, z: -4788 },
          { name: 'Anchorhead', scene: '', x: 62, y: 0, z: -5340 },
        ],
      }),
    );
    useLiveStore.setState({
      status: { kind: 'attached', pid: 1234, mappingName: 'm' },
      clientLabel: '/bound/client/SwgClient_r.exe',
    });
    renderPanel();
    fireEvent.click(screen.getByText('Scene'));

    const rows = screen.getAllByTestId('world-bookmark-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Mos Eisley cantina')).not.toBeNull();
    expect(screen.getByText('Anchorhead')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Teleport to Mos Eisley cantina' }));
    expect(sendTeleport).toHaveBeenCalledWith('m', 3428, 8, -4788);

    fireEvent.click(screen.getByRole('button', { name: 'Teleport to Anchorhead' }));
    expect(sendTeleport).toHaveBeenCalledWith('m', 62, 0, -5340);
  });

  it('a bookmark row never dispatches sendTeleport while offline (no live session)', () => {
    vi.mocked(readWorkspaceJson).mockReturnValue(
      defaultMeta({ worldEditorBookmarks: [{ name: 'Anchorhead', scene: '', x: 62, y: 0, z: -5340 }] }),
    );
    renderPanel();
    fireEvent.click(screen.getByText('Scene'));

    fireEvent.click(screen.getByRole('button', { name: 'Teleport to Anchorhead' }));
    expect(sendTeleport).not.toHaveBeenCalled();
  });

  it('the footer renders "+ Add decoration…" and "Stage to project" with the exact 019-A labels', () => {
    renderPanel();

    expect(screen.getByText('+ Add decoration…')).not.toBeNull();
    expect(screen.getByText('Stage to project')).not.toBeNull();
  });

  it('ROUND 3 R11a: clicking "Stage to project" shows the honest "not yet wired" message, never the sketch mock\'s success-implying staged-count copy', () => {
    renderPanel();

    fireEvent.click(screen.getByText('Stage to project'));

    expect(log).toHaveBeenCalledWith('info', 'log', expect.stringContaining('not yet wired'));
    expect(log).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringMatching(/\d+ files? staged/i),
    );
  });
});

describe('WorldPanel — Remove/Undo (D-02/D-03, 05.1-13)', () => {
  function firstRemoveBtn(): HTMLElement {
    return screen.getAllByTestId('world-remove-decoration-btn')[0];
  }

  it('clicking Remove calls removeDecorationRow with the resolved pair, correct row identity, mappingName:null, and liveNetworkId:null (never a fabricated value); no confirm dialog appears', () => {
    seedTree();
    renderPanel();

    fireEvent.click(firstRemoveBtn());

    expect(removeDecorationRow).toHaveBeenCalledWith(
      '/fake/studio',
      '/override',
      expect.any(Function),
      BUILDING_1,
      'alcove1',
      3,
      null,
      null,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a null resolveOverridePair() (no resolvable scan root) makes Remove a no-op — removeDecorationRow is NEVER called', () => {
    seedTree();
    renderPanel();

    vi.mocked(resolveScanRoot).mockReturnValue(null);
    fireEvent.click(firstRemoveBtn());

    expect(removeDecorationRow).not.toHaveBeenCalled();
  });

  it('mappingName is null while offline, and the exact live mappingName when attached (ROUND 5/V5 narrowed status union)', () => {
    seedTree();
    renderPanel();
    fireEvent.click(firstRemoveBtn());
    expect(removeDecorationRow).toHaveBeenLastCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), null, null,
    );

    cleanup();
    useLiveStore.setState({ status: { kind: 'attached', pid: 1, mappingName: 'x' }, clientLabel: 'c' });
    renderPanel();
    fireEvent.click(firstRemoveBtn());
    expect(removeDecorationRow).toHaveBeenLastCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), null, 'x',
    );
  });

  it('a successful Remove pushes a RemovedRowEntry, records a "warn" history entry via formatPersistMessage, and refreshes the tree (row disappears from the NEXT scan)', () => {
    seedTree();
    renderPanel();

    fireEvent.click(firstRemoveBtn());

    const pending = useRemoveUndoStore.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ buildingId: '1082874', cellName: 'alcove1', rowIndex: 3 });

    const history = useWorldEditorStore.getState().history;
    expect(history).toHaveLength(1);
    expect(history[0].outcome).toBe('warn');
    expect(history[0].message).toBe(formatPersistMessage('removed — reload scene to see it gone', true));

    // refreshTree() re-reads readWorkspaceJson/scanWorldEditorState fresh.
    expect(scanWorldEditorState).toHaveBeenCalledTimes(2); // mount + this refresh
  });

  it('a mirror-OFF project records the D-10 suffix on the removal history message', () => {
    seedTree();
    vi.mocked(readWorkspaceJson).mockReturnValue(defaultMeta({ mirrorToStockIlf: false }));
    renderPanel();

    fireEvent.click(firstRemoveBtn());

    const history = useWorldEditorStore.getState().history;
    expect(history[0].message).toBe(formatPersistMessage('removed — reload scene to see it gone', false));
    expect(history[0].message).toContain('mirror off');
  });

  it('a throwing removeDecorationRow is caught, logged, and never pushes a RemovedRowEntry or records history', () => {
    seedTree();
    vi.mocked(removeDecorationRow).mockImplementationOnce(() => {
      throw new Error("this building's stock template path isn't known yet");
    });
    renderPanel();

    fireEvent.click(firstRemoveBtn());

    expect(log).toHaveBeenCalledWith('error', 'log', expect.stringContaining("isn't known yet"));
    expect(useRemoveUndoStore.getState().pending).toHaveLength(0);
    expect(useWorldEditorStore.getState().history).toHaveLength(0);
  });

  it('the rendered RemoveUndoToast shows an Undo button, and clicking it drives handleUndo end-to-end: add-back BEFORE restore, then clearUndoError, then refreshTree', () => {
    seedTree();
    renderPanel();
    fireEvent.click(firstRemoveBtn());

    const undoBtn = screen.getByRole('button', { name: 'Undo remove' });
    expect(undoBtn).not.toBeNull();

    const callOrder: string[] = [];
    vi.mocked(addBackDecorationRow).mockImplementationOnce((...args) => {
      callOrder.push('addBack');
      return {
        rowIndex: 0, cellName: 'alcove1',
        derivedTemplateVfsPath: 'x', editedIlfVfsPath: 'x',
        derivedTemplateFilePath: 'x', editedIlfFilePath: 'x', stagedEntries: [],
      };
    });
    const restoreSpy = vi.spyOn(useRemoveUndoStore.getState(), 'restore').mockImplementation((id: string) => {
      callOrder.push('restore');
      const entry = useRemoveUndoStore.getState().pending.find((e) => e.id === id);
      useRemoveUndoStore.setState((s) => ({ pending: s.pending.filter((e) => e.id !== id) }));
      return entry;
    });

    const scanCallsBeforeUndo = vi.mocked(scanWorldEditorState).mock.calls.length;
    fireEvent.click(undoBtn);

    expect(addBackDecorationRow).toHaveBeenCalledWith('/fake/studio', '/override', expect.any(Function), BUILDING_1, expect.objectContaining({
      objectTemplateName: BUILDING_1.decorations[0].objectTemplateName,
      cellName: 'alcove1',
    }));
    expect(callOrder).toEqual(['addBack', 'restore']); // ROUND 7/Z1 ordering
    expect(useRemoveUndoStore.getState().pending).toHaveLength(0);
    expect(vi.mocked(scanWorldEditorState).mock.calls.length).toBeGreaterThan(scanCallsBeforeUndo); // ROUND 4/W2 refresh
    restoreSpy.mockRestore();
  });

  it('ROUND 6/X6: a handleUndo whose building is no longer in the tree logs + setUndoError, and calls NEITHER addBackDecorationRow NOR restore()', () => {
    seedTree();
    renderPanel();
    fireEvent.click(firstRemoveBtn());
    const entryId = useRemoveUndoStore.getState().pending[0].id;

    useWorldEditorStore.setState({ tree: [] }); // building fell out of the scanned tree
    const restoreSpy = vi.spyOn(useRemoveUndoStore.getState(), 'restore');

    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }));

    expect(addBackDecorationRow).not.toHaveBeenCalled();
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(useRemoveUndoStore.getState().undoErrors.get(entryId)).toMatch(/no longer in the scanned tree/);
    expect(useRemoveUndoStore.getState().pending).toHaveLength(1); // entry stays for a retry
    restoreSpy.mockRestore();
  });

  it('ROUND 5/V1: a null resolveOverridePair() on Undo is a words-only no-op — leaves the entry in pending, never calls addBackDecorationRow/restore', () => {
    seedTree();
    renderPanel();
    fireEvent.click(firstRemoveBtn());
    const entryId = useRemoveUndoStore.getState().pending[0].id;

    vi.mocked(resolveScanRoot).mockReturnValue(null);
    const restoreSpy = vi.spyOn(useRemoveUndoStore.getState(), 'restore');

    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }));

    expect(addBackDecorationRow).not.toHaveBeenCalled();
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(useRemoveUndoStore.getState().undoErrors.get(entryId)).toBeDefined();
    expect(useRemoveUndoStore.getState().pending).toHaveLength(1);
    restoreSpy.mockRestore();
  });

  it('ROUND 7/Z1: a throwing addBackDecorationRow never calls restore() — the entry stays in pending (no false "restored" success)', () => {
    seedTree();
    renderPanel();
    fireEvent.click(firstRemoveBtn());
    const entryId = useRemoveUndoStore.getState().pending[0].id;

    vi.mocked(addBackDecorationRow).mockImplementationOnce(() => {
      throw new Error('boom — add-back write failed');
    });
    const restoreSpy = vi.spyOn(useRemoveUndoStore.getState(), 'restore');

    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }));

    expect(restoreSpy).not.toHaveBeenCalled();
    expect(useRemoveUndoStore.getState().pending).toHaveLength(1);
    expect(useRemoveUndoStore.getState().undoErrors.get(entryId)).toContain('boom');
    restoreSpy.mockRestore();
  });

  it('ROUND 6/X7 static grep gate: suppressNextDiffRef.current is a spread-append and appears BEFORE refreshTree() inside handleUndo (source order, not runtime — the ref has no observable consequence until Plan 14)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WorldPanel.tsx'), 'utf8');
    const spreadPushIdx = src.indexOf('suppressNextDiffRef.current = [\n      ...suppressNextDiffRef.current');
    const handleUndoIdx = src.indexOf('function handleUndo(');
    const refreshCallIdx = src.indexOf('refreshTree(); // ROUND 4/W2');
    expect(spreadPushIdx).toBeGreaterThan(-1);
    expect(handleUndoIdx).toBeGreaterThan(-1);
    expect(refreshCallIdx).toBeGreaterThan(spreadPushIdx);
    expect(spreadPushIdx).toBeGreaterThan(handleUndoIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 05.1-14 — ADD-decoration flow (Task 2 wiring + "(NEW)" diff, Task 3 ack protocol)
// ═══════════════════════════════════════════════════════════════════════════════

const TPL_TABLE = 'object/tangible/furniture/tatooine/shared_frn_tatt_table_cantina_table_3.iff';
const TPL_LAMP = 'object/tangible/furniture/tatooine/shared_frn_tatt_lamp_floor.iff';

const CANONICAL_REFUSED =
  'Placement request was refused — an edit or placement may already be active in-game, possibly an earlier request that timed out here but was accepted late. Cancel it in-game, then try again.';
const CANONICAL_TIMEOUT =
  'Placement request got no response from the game (it may be loading, zoning, or busy) — if the placement ghost is active in-game, placing and persisting will still work; otherwise try again.';
const CANONICAL_DETACHED = 'client detached before the placement was acknowledged';

function makeVfsEntry(p: string): VfsEntry {
  return {
    path: p,
    name: p.split('/').pop() ?? p,
    segments: p.split('/'),
    winnerArchivePath: 'C:/swg/patch_00.tre',
    winnerArchiveFilename: 'patch_00.tre',
    isOverride: false,
    isTombstone: false,
    shadowCount: 0,
  } as VfsEntry;
}

/** Attach a live session — the ADD flow is live-gated (placement happens in-game). */
function attachLive(): void {
  useLiveStore.setState({ status: { kind: 'attached', pid: 1234, mappingName: 'm' }, clientLabel: null });
}

/** Clone a building with a different decoration set — the shape refreshTree() observes. */
function buildingWith(
  base: WorldEditorBuilding,
  decorations: WorldEditorBuilding['decorations'],
): WorldEditorBuilding {
  return { ...base, decorations };
}

function newDeco(cellName: string, rowIndex: number, objectTemplateName: string) {
  return { cellName, rowIndex, objectTemplateName, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] };
}

/** Grow history the way Plan 08 Task 3's poll-loop wiring does. */
function recordPersist(buildingLabel: string, decorationLabel: string): void {
  useWorldEditorStore.getState().recordPersistResult({
    timestampISO: new Date().toISOString(),
    buildingLabel,
    decorationLabel,
    outcome: 'ok',
    message: 'saved',
  });
}

/** Select a decoration row so addContext resolves, then open the modal and pick a template. */
function openModalAndPlace(templatePath = TPL_TABLE): void {
  fireEvent.click(screen.getAllByTestId('world-decoration-row')[0]);
  fireEvent.click(screen.getByTestId('world-add-decoration-btn'));
  const tile = screen
    .getAllByTestId('add-decoration-tile')
    .find((t) => t.textContent?.includes(templatePath));
  fireEvent.click(tile as HTMLElement);
  fireEvent.click(screen.getByRole('button', { name: 'Place in game' }));
}

function addBtn(): HTMLButtonElement {
  return screen.getByTestId('world-add-decoration-btn') as HTMLButtonElement;
}

describe('WorldPanel — ADD trigger gating (D-04 honest degrade, C6 scope disclosure)', () => {
  beforeEach(() => {
    useTreStore.setState({ vfsEntries: [makeVfsEntry(TPL_TABLE), makeVfsEntry(TPL_LAMP)] });
  });
  afterEach(() => {
    useTreStore.setState({ vfsEntries: [] });
  });

  it('disables the trigger with a words-only hint when nothing is selected', () => {
    seedTree();
    attachLive();
    renderPanel();

    expect(addBtn().disabled).toBe(true);
    expect(screen.getByTestId('world-add-decoration-hint').textContent).toBe(
      "select a decorated building first — placing into a brand-new cell isn't supported yet",
    );
  });

  it('disables the trigger when a building with ZERO decorations is selected (D-04)', () => {
    vi.mocked(scanWorldEditorState).mockReturnValue([buildingWith(BUILDING_2, [])]);
    attachLive();
    renderPanel();

    fireEvent.click(screen.getByText('Guild Hall — Anchorhead'));
    expect(addBtn().disabled).toBe(true);
    expect(screen.getByTestId('world-add-decoration-hint').textContent).toMatch(
      /select a decorated building first/,
    );
  });

  it('disables the trigger with a live-gating hint when no client is attached', () => {
    seedTree();
    renderPanel(); // liveStore stays 'idle'

    fireEvent.click(screen.getAllByTestId('world-decoration-row')[0]);
    expect(addBtn().disabled).toBe(true);
    expect(screen.getByTestId('world-add-decoration-hint').textContent).toMatch(
      /attach to a running client first/,
    );
  });

  it('enables the trigger and opens the modal with the resolved building/cell context', () => {
    seedTree();
    attachLive();
    renderPanel();

    fireEvent.click(screen.getAllByTestId('world-decoration-row')[0]);
    expect(addBtn().disabled).toBe(false);
    expect(screen.queryByTestId('world-add-decoration-hint')).toBeNull();

    fireEvent.click(addBtn());
    expect(screen.getByTestId('add-decoration-modal')).not.toBeNull();
    expect(screen.getByTestId('add-decoration-context').textContent).toBe(
      'to Cantina — Mos Eisley (alcove1)',
    );
  });

  it('borrows the FIRST decoration cellName when a BUILDING row (not a decoration) is selected', () => {
    seedTree();
    attachLive();
    renderPanel();

    fireEvent.click(screen.getByText('Cantina — Mos Eisley'));
    fireEvent.click(addBtn());
    expect(screen.getByTestId('add-decoration-context').textContent).toBe(
      'to Cantina — Mos Eisley (alcove1)',
    );
  });
});

describe('WorldPanel — placement send (Task 2: no toast at send time, R9 BB1)', () => {
  beforeEach(() => {
    useTreStore.setState({ vfsEntries: [makeVfsEntry(TPL_TABLE), makeVfsEntry(TPL_LAMP)] });
    vi.mocked(sendStartPlacement).mockReturnValue(7);
  });
  afterEach(() => {
    useTreStore.setState({ vfsEntries: [] });
  });

  it('calls sendStartPlacement with the BORROWED cellName and buildingId, never a fabricated one', () => {
    seedTree();
    attachLive();
    renderPanel();

    openModalAndPlace(TPL_LAMP);

    expect(sendStartPlacement).toHaveBeenCalledTimes(1);
    expect(sendStartPlacement).toHaveBeenCalledWith('m', TPL_LAMP, 'alcove1', '1082874');
  });

  it('shows NO toast at send time — display timing belongs to the ack correlation', () => {
    seedTree();
    attachLive();
    renderPanel();

    openModalAndPlace();

    expect(screen.queryByTestId('world-placement-toast')).toBeNull();
    expect(screen.queryByTestId('add-decoration-modal')).toBeNull(); // modal closed on send
  });
});

describe('WorldPanel — HOST_CMD ACK PROTOCOL consumer (Task 3, Plan 08 canonical spec)', () => {
  beforeEach(() => {
    useTreStore.setState({ vfsEntries: [makeVfsEntry(TPL_TABLE), makeVfsEntry(TPL_LAMP)] });
    vi.mocked(sendStartPlacement).mockReturnValue(7);
  });
  afterEach(() => {
    useTreStore.setState({ vfsEntries: [] });
    vi.useRealTimers();
  });

  it('row 5 — a matching epoch with code 1 shows the success + wrong-room-warning copy', () => {
    seedTree();
    attachLive();
    renderPanel();
    openModalAndPlace();

    act(() => {
      useWorldEditorStore.setState({ lastHostCommandResult: { epoch: 7, code: 1 } });
    });

    const toast = screen.getByTestId('world-placement-toast');
    expect(toast.textContent).toContain('Placement mode active in-game');
    expect(toast.textContent).toContain('SAME ROOM as the decoration you selected in alcove1');
    // Row 5 records NO history entry — the eventual persist RESULT records its own.
    expect(useWorldEditorStore.getState().history).toHaveLength(0);
  });

  it('row 6 — any other code shows canonical string 1 EXACTLY and records a durable failure', () => {
    seedTree();
    attachLive();
    renderPanel();
    openModalAndPlace();

    act(() => {
      useWorldEditorStore.setState({ lastHostCommandResult: { epoch: 7, code: 0 } });
    });

    // CC8 — full-string equality, so cross-plan wording drift is caught.
    const toast = screen.getByTestId('world-placement-toast');
    expect(toast.textContent).toContain(CANONICAL_REFUSED);
    // Never the false "active" claim on a silent agent-side refusal.
    expect(toast.textContent).not.toContain('Placement mode active in-game');

    const st = useWorldEditorStore.getState();
    expect(st.history).toHaveLength(1);
    expect(st.history[0].outcome).toBe('error');
    expect(st.history[0].message).toBe(CANONICAL_REFUSED);
    expect(st.history[0].buildingLabel).toBe('Cantina — Mos Eisley');
    expect(st.history[0].decorationLabel).toBe('shared_frn_tatt_table_cantina_table_3.iff');
    expect(st.hasFailureBadge).toBe(true);
  });

  it('row 8 — an UNRELATED epoch never triggers any toast', () => {
    seedTree();
    attachLive();
    renderPanel();
    openModalAndPlace();

    act(() => {
      useWorldEditorStore.setState({ lastHostCommandResult: { epoch: 999, code: 1 } });
    });

    expect(screen.queryByTestId('world-placement-toast')).toBeNull();
    expect(useWorldEditorStore.getState().history).toHaveLength(0);
  });

  it('row 13 (BB7) — a second Place in the same commit refuses locally and never re-sends', () => {
    seedTree();
    attachLive();
    renderPanel();

    fireEvent.click(screen.getAllByTestId('world-decoration-row')[0]);
    fireEvent.click(addBtn());
    fireEvent.click(
      screen.getAllByTestId('add-decoration-tile').find((t) => t.textContent?.includes(TPL_TABLE)) as HTMLElement,
    );
    const placeBtn = screen.getByRole('button', { name: 'Place in game' });

    // A real fast double-click: both native events dispatch before React re-renders. The pending
    // slot is a REF, so the first handler occupies it synchronously.
    act(() => {
      placeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      placeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(sendStartPlacement).toHaveBeenCalledTimes(1);
    // Descriptive reference to canonical string 4 (it NAMES the pending request).
    const toast = screen.getByTestId('world-placement-toast');
    expect(toast.textContent).toContain('shared_frn_tatt_table_cantina_table_3.iff');
    expect(toast.textContent).toContain('Cantina — Mos Eisley');
    expect(toast.textContent).toContain('still waiting');

    // The slot was never overwritten — the FIRST request's ack still resolves.
    act(() => {
      useWorldEditorStore.setState({ lastHostCommandResult: { epoch: 7, code: 1 } });
    });
    expect(screen.getByTestId('world-placement-toast').textContent).toContain(
      'Placement mode active in-game',
    );
  });

  it('CC17 — the trigger is disabled while pending and re-enables after the ack resolves', () => {
    seedTree();
    attachLive();
    renderPanel();
    openModalAndPlace();

    expect(addBtn().disabled).toBe(true);
    expect(screen.getByTestId('world-add-decoration-hint').textContent).toBe(
      'waiting for the game to acknowledge the last placement request',
    );

    act(() => {
      useWorldEditorStore.setState({ lastHostCommandResult: { epoch: 7, code: 1 } });
    });
    expect(addBtn().disabled).toBe(false);
  });

  it('row 9 (BB6) — an un-acked request times out with canonical string 2, a durable entry, and a re-enabled trigger; a LATE ack shows nothing', () => {
    vi.useFakeTimers();
    seedTree();
    attachLive();
    renderPanel();
    openModalAndPlace();

    act(() => {
      vi.advanceTimersByTime(11_000);
    });

    expect(screen.getByTestId('world-placement-toast').textContent).toContain(CANONICAL_TIMEOUT);
    const st = useWorldEditorStore.getState();
    expect(st.history).toHaveLength(1);
    expect(st.history[0].outcome).toBe('error');
    expect(st.history[0].message).toBe(CANONICAL_TIMEOUT);
    expect(st.hasFailureBadge).toBe(true);
    expect(addBtn().disabled).toBe(false);

    // Late-ack rule (Plan 08 rows 2/12): the slot is gone, so nothing resolves.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss placement message' }));
    act(() => {
      useWorldEditorStore.setState({ lastHostCommandResult: { epoch: 7, code: 1 } });
    });
    expect(screen.queryByTestId('world-placement-toast')).toBeNull();
    expect(useWorldEditorStore.getState().history).toHaveLength(1); // no second entry
  });

  it('row 10 (BB6) — a detach records the durable detached entry and clears the pending lock', () => {
    seedTree();
    attachLive();
    renderPanel();
    openModalAndPlace();

    act(() => {
      useLiveStore.setState({ status: { kind: 'idle' } });
    });

    const st = useWorldEditorStore.getState();
    expect(st.history).toHaveLength(1);
    expect(st.history[0].message).toBe(CANONICAL_DETACHED);
    expect(st.history[0].outcome).toBe('error');
    // The live-gate disables the trigger now, but the PENDING lock is cleared — proven by
    // re-attaching and finding it enabled rather than wedged.
    act(() => {
      attachLive();
    });
    expect(addBtn().disabled).toBe(false);
  });

  it('row 7 (CC2) — a matching ack observed after a same-commit project switch aborts silently', () => {
    seedTree();
    attachLive();
    renderPanel();
    openModalAndPlace();

    act(() => {
      // The overdue ~1 Hz poll tick lands project A's refusal in the just-reset store BEFORE the
      // passive-effect flush — CC2's exact sequence.
      useWorkspaceStore.setState({ studioDir: '/fake/studio-b' });
      useWorldEditorStore.setState({ lastHostCommandResult: { epoch: 7, code: 0 } });
    });

    expect(screen.queryByTestId('world-placement-toast')).toBeNull();
    expect(useWorldEditorStore.getState().history).toHaveLength(0);
    expect(useWorldEditorStore.getState().hasFailureBadge).toBe(false);
    // The switch reset selectedRowId, so re-select before asserting the trigger — otherwise this
    // would pass on "nothing is selected" rather than on the pending lock being cleared.
    fireEvent.click(screen.getAllByTestId('world-decoration-row')[0]);
    expect(addBtn().disabled).toBe(false);
  });

  it('row 10 + EE2 — a detach observed AFTER a project switch records nothing in the new project', () => {
    seedTree();
    attachLive();
    renderPanel();
    openModalAndPlace();

    act(() => {
      useWorkspaceStore.setState({ studioDir: '/fake/studio-b' });
      useLiveStore.setState({ status: { kind: 'idle' } });
    });

    expect(useWorldEditorStore.getState().history).toHaveLength(0);
    expect(useWorldEditorStore.getState().hasFailureBadge).toBe(false);
    expect(screen.queryByTestId('world-placement-toast')).toBeNull();
  });

  it('row 12 (CC1) — an unmount mid-pending clears the orphan timer; a post-remount late ack shows nothing', () => {
    vi.useFakeTimers();
    seedTree();
    attachLive();
    const view = renderPanel();
    openModalAndPlace();

    view.unmount();
    act(() => {
      vi.advanceTimersByTime(11_000);
    });

    // The orphan callback never ran — nothing recorded, nothing thrown.
    expect(useWorldEditorStore.getState().history).toHaveLength(0);
    expect(useWorldEditorStore.getState().hasFailureBadge).toBe(false);

    renderPanel();
    act(() => {
      useWorldEditorStore.setState({ lastHostCommandResult: { epoch: 7, code: 1 } });
    });
    expect(screen.queryByTestId('world-placement-toast')).toBeNull();
    // The pending lock never survives the component — the remount's fresh state re-enables it.
    fireEvent.click(screen.getAllByTestId('world-decoration-row')[0]);
    expect(addBtn().disabled).toBe(false);
  });
});

describe('WorldPanel — project-switch lifecycle (AA5, BB2/BB5/BB11)', () => {
  beforeEach(() => {
    useTreStore.setState({ vfsEntries: [makeVfsEntry(TPL_TABLE)] });
    vi.mocked(sendStartPlacement).mockReturnValue(7);
  });
  afterEach(() => {
    useTreStore.setState({ vfsEntries: [] });
  });

  it('aborts a pending placement with NO record, re-enables the trigger, and refreshes for the new project', () => {
    seedTree();
    attachLive();
    renderPanel();
    openModalAndPlace();

    const scansBefore = vi.mocked(scanWorldEditorState).mock.calls.length;

    act(() => {
      useWorkspaceStore.setState({ studioDir: '/fake/studio-b' });
    });

    // BB5 — aborted-switch: no toast, no cross-project history entry.
    expect(screen.queryByTestId('world-placement-toast')).toBeNull();
    expect(useWorldEditorStore.getState().history).toHaveLength(0);
    // BB11 — the new project's first scan is issued by THIS effect (nothing else schedules it).
    expect(vi.mocked(scanWorldEditorState).mock.calls.length).toBeGreaterThan(scansBefore);
    // R11/EE1 — the trigger starts the new project enabled, never wedged.
    fireEvent.click(screen.getAllByTestId('world-decoration-row')[0]);
    expect(addBtn().disabled).toBe(false);

    // A late ack for the aborted request resolves nothing.
    act(() => {
      useWorldEditorStore.setState({ lastHostCommandResult: { epoch: 7, code: 0 } });
    });
    expect(screen.queryByTestId('world-placement-toast')).toBeNull();
  });

  it('does NOT fire the switch behavior on initial mount', () => {
    seedTree();
    attachLive();
    renderPanel();
    // Mount performs exactly one scan (Plan 10's mount effect) — the switch effect adds none.
    expect(vi.mocked(scanWorldEditorState)).toHaveBeenCalledTimes(1);
  });
});

describe('WorldPanel — "(NEW)" content-identity marker (W2, V2, V3, X3, X7, Z5)', () => {
  beforeEach(() => {
    useTreStore.setState({ vfsEntries: [makeVfsEntry(TPL_TABLE)] });
  });
  afterEach(() => {
    useTreStore.setState({ vfsEntries: [] });
  });

  it('V3 — a fresh mount over a non-empty tree marks NOTHING', () => {
    seedTree(); // 2 buildings, 3 decorations
    renderPanel();
    expect(screen.queryAllByTestId('world-decoration-new-marker')).toHaveLength(0);
  });

  it('marks a genuinely-new row after a persist-triggered refresh', () => {
    seedTree();
    renderPanel();

    const withNewRow = buildingWith(BUILDING_1, [
      ...BUILDING_1.decorations,
      newDeco('alcove1', 21, TPL_LAMP),
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([withNewRow, BUILDING_2]);

    // Simulate Plan 08 Task 3's recordPersistResult wiring firing (history growth).
    act(() => {
      recordPersist('Cantina — Mos Eisley', 'lamp');
    });

    const markers = screen.getAllByTestId('world-decoration-new-marker');
    expect(markers).toHaveLength(1);
    // The marker sits on the NEW row, not on a pre-existing one.
    expect(markers[0].closest('[data-testid="world-decoration-row"]')?.textContent).toContain(
      'shared_frn_tatt_lamp_floor.iff',
    );
  });

  it('W2 — a PURE REINDEX (same content, shifted rowIndex) marks NOTHING', () => {
    seedTree();
    renderPanel();

    // Identical content, different row numbers — exactly the shape Plan 13's append-only Undo
    // produces. A raw positional-id diff would mislabel both of these.
    const reindexed = buildingWith(BUILDING_1, [
      { ...BUILDING_1.decorations[0], rowIndex: 11 },
      { ...BUILDING_1.decorations[1], rowIndex: 12 },
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([reindexed, BUILDING_2]);

    act(() => {
      recordPersist('Cantina — Mos Eisley', 'x');
    });

    expect(screen.queryAllByTestId('world-decoration-new-marker')).toHaveLength(0);
  });

  it('W2 — a reindex ALONGSIDE a genuine add marks ONLY the genuinely-new row', () => {
    seedTree();
    renderPanel();

    const mixed = buildingWith(BUILDING_1, [
      { ...BUILDING_1.decorations[0], rowIndex: 11 }, // reindexed, not new
      { ...BUILDING_1.decorations[1], rowIndex: 12 }, // reindexed, not new
      newDeco('alcove1', 13, TPL_LAMP),
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([mixed, BUILDING_2]);

    act(() => {
      recordPersist('Cantina — Mos Eisley', 'x');
    });

    const markers = screen.getAllByTestId('world-decoration-new-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0].closest('[data-testid="world-decoration-row"]')?.textContent).toContain(
      'shared_frn_tatt_lamp_floor.iff',
    );
  });

  it('V3 — a BRAND-NEW building appearing whole marks ZERO rows (first observation, not placements)', () => {
    vi.mocked(scanWorldEditorState).mockReturnValue([BUILDING_1]);
    renderPanel();
    expect(screen.queryAllByTestId('world-decoration-new-marker')).toHaveLength(0);

    // BUILDING_2 was absent from the prior snapshot — its whole row set surfaces at once.
    vi.mocked(scanWorldEditorState).mockReturnValue([BUILDING_1, BUILDING_2]);
    act(() => {
      recordPersist('Guild Hall — Anchorhead', 'x');
    });

    expect(screen.queryAllByTestId('world-decoration-new-marker')).toHaveLength(0);
  });

  it('V2 — the diff advances on a tree update with NO history growth (mirror toggle)', () => {
    seedTree();
    renderPanel();

    // A mirror toggle triggers refreshTree() without growing history. If the diff were keyed on
    // history growth, prevTreeRef would go stale here and the NEXT unrelated event would
    // misattribute these rows.
    const withNewRow = buildingWith(BUILDING_1, [
      ...BUILDING_1.decorations,
      newDeco('alcove1', 21, TPL_LAMP),
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([withNewRow, BUILDING_2]);
    fireEvent.click(screen.getByLabelText('Mirror to stock layout'));

    // The mirror-toggle refresh itself observed the new row and marked it.
    expect(screen.getAllByTestId('world-decoration-new-marker')).toHaveLength(1);

    // A LATER, unrelated refresh adds a row in the OTHER building. If prevTreeRef had gone stale
    // at the mirror toggle (the ROUND 4 history-growth-keyed design), the lamp row would be
    // diffed against the pre-toggle baseline and re-marked here. It must not be: only the
    // genuinely-new BUILDING_2 row is marked.
    const b2WithNew = buildingWith(BUILDING_2, [
      ...BUILDING_2.decorations,
      newDeco('main', 9, TPL_LAMP),
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([withNewRow, b2WithNew]);
    act(() => {
      recordPersist('Guild Hall — Anchorhead', 'x');
    });

    const markers = screen.getAllByTestId('world-decoration-new-marker');
    expect(markers).toHaveLength(1);
    const markedRow = markers[0].closest('[data-testid="world-decoration-row"]');
    expect(markedRow?.textContent).toContain('main · row 9');
  });

  it('X7 — a REAL Undo through the rendered toast marks ZERO rows for the restored row', () => {
    seedTree();
    renderPanel();

    // Remove a row (drives the real handleRemove -> push -> toast).
    fireEvent.click(screen.getAllByTestId('world-remove-decoration-btn')[0]);

    // The restored tree: the removed row comes back APPENDED (D-01's append-only mandate), so its
    // rowIndex differs from where it was.
    const restored = buildingWith(BUILDING_1, [
      BUILDING_1.decorations[1],
      { ...BUILDING_1.decorations[0], rowIndex: 21 },
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([restored, BUILDING_2]);

    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }));

    expect(screen.queryAllByTestId('world-decoration-new-marker')).toHaveLength(0);
  });

  it('X3 — a genuinely-new row landing in the refresh AFTER an Undo is still marked', () => {
    seedTree();
    renderPanel();

    fireEvent.click(screen.getAllByTestId('world-remove-decoration-btn')[0]);
    const restored = buildingWith(BUILDING_1, [
      BUILDING_1.decorations[1],
      { ...BUILDING_1.decorations[0], rowIndex: 21 },
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([restored, BUILDING_2]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }));
    expect(screen.queryAllByTestId('world-decoration-new-marker')).toHaveLength(0);

    // A SECOND, unrelated refresh adds a genuinely-new row in a DIFFERENT building.
    const b2WithNew = buildingWith(BUILDING_2, [
      ...BUILDING_2.decorations,
      newDeco('main', 9, TPL_LAMP),
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([restored, b2WithNew]);
    act(() => {
      recordPersist('Guild Hall — Anchorhead', 'lamp');
    });

    // The suppression pre-consumed ONLY the restored row's tuple — it never blanket-skipped the
    // diff, so this unrelated new row is still caught.
    const markers = screen.getAllByTestId('world-decoration-new-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0].closest('[data-testid="world-decoration-row"]')?.textContent).toContain(
      'shared_frn_tatt_lamp_floor.iff',
    );
  });

  it('AA8 — the suppression generalizes across SEQUENTIAL Undos in different buildings', () => {
    seedTree();
    renderPanel();

    // First Undo (BUILDING_1).
    fireEvent.click(screen.getAllByTestId('world-remove-decoration-btn')[0]);
    const restored1 = buildingWith(BUILDING_1, [
      BUILDING_1.decorations[1],
      { ...BUILDING_1.decorations[0], rowIndex: 21 },
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([restored1, BUILDING_2]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }));
    expect(screen.queryAllByTestId('world-decoration-new-marker')).toHaveLength(0);

    // Second Undo (BUILDING_2) — its own remove/restore cycle.
    vi.mocked(removeDecorationRow).mockReturnValue({
      rowIndex: 0,
      cellName: 'main',
      derivedTemplateVfsPath: 'object/building/toolkit/edit_1084112.iff',
      editedIlfVfsPath: 'interiorlayout/toolkit/edit_1084112.ilf',
      derivedTemplateFilePath: '/override/object/building/toolkit/edit_1084112.iff',
      editedIlfFilePath: '/override/interiorlayout/toolkit/edit_1084112.ilf',
      stagedEntries: [],
    });
    const removeBtns = screen.getAllByTestId('world-remove-decoration-btn');
    fireEvent.click(removeBtns[removeBtns.length - 1]);

    const restored2 = buildingWith(BUILDING_2, [{ ...BUILDING_2.decorations[0], rowIndex: 14 }]);
    vi.mocked(scanWorldEditorState).mockReturnValue([restored1, restored2]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }));

    expect(screen.queryAllByTestId('world-decoration-new-marker')).toHaveLength(0);
  });

  it('clears an individual "(NEW)" marker when its row is explicitly selected', () => {
    seedTree();
    renderPanel();

    const withNewRow = buildingWith(BUILDING_1, [
      ...BUILDING_1.decorations,
      newDeco('alcove1', 21, TPL_LAMP),
    ]);
    vi.mocked(scanWorldEditorState).mockReturnValue([withNewRow, BUILDING_2]);
    act(() => {
      recordPersist('Cantina — Mos Eisley', 'lamp');
    });
    expect(screen.getAllByTestId('world-decoration-new-marker')).toHaveLength(1);

    const markedRow = screen
      .getAllByTestId('world-decoration-row')
      .find((r) => r.textContent?.includes('shared_frn_tatt_lamp_floor.iff'));
    fireEvent.click(markedRow as HTMLElement);

    expect(screen.queryAllByTestId('world-decoration-new-marker')).toHaveLength(0);
  });
});
