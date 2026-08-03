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
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
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
import { sendReloadCurrentScene, sendLoadEditorScene, sendTeleport } from '../../services/hostCommand';
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
