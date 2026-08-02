/**
 * packages/renderer/src/services/hostCommand.test.ts
 * 05.1-08 Task 1: typed send* wrappers over addon.writeHostCommand + a monotonic epoch counter +
 * a words-only per-action outcome describer (C9).
 *
 * Mocking strategy for the native addon: `vi.mock('@swg/live-inject', ...)` does NOT intercept a
 * bare `require('@swg/live-inject')` (vi.mock hooks ESM import resolution, not CJS require —
 * established pattern, see useCommandWriter.test.ts / decorationPersistOrchestrator.test.ts).
 * Instead: require the REAL (singleton, process-cached) addon object directly in THIS file and
 * monkey-patch `writeHostCommand` with a vi.fn() BEFORE hostCommand.ts is ever loaded (via a
 * dynamic import() inside beforeAll), so its own top-level `require('@swg/live-inject')` resolves
 * to the SAME patched object.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { LIVE_HOST_CMD_ACTION, LIVE_HOST_CMD_LAYOUT } from '@swg/contracts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as { writeHostCommand: ReturnType<typeof vi.fn> };
addon.writeHostCommand = vi.fn();

let sendReloadCurrentScene: typeof import('./hostCommand').sendReloadCurrentScene;
let sendLoadEditorScene: typeof import('./hostCommand').sendLoadEditorScene;
let sendTeleport: typeof import('./hostCommand').sendTeleport;
let sendStartPlacement: typeof import('./hostCommand').sendStartPlacement;
let sendCancelPlacement: typeof import('./hostCommand').sendCancelPlacement;
let sendDespawnNode: typeof import('./hostCommand').sendDespawnNode;
let parseHostCommandResult: typeof import('./hostCommand').parseHostCommandResult;
let describeHostCommandResult: typeof import('./hostCommand').describeHostCommandResult;

beforeAll(async () => {
  const mod = await import('./hostCommand');
  sendReloadCurrentScene = mod.sendReloadCurrentScene;
  sendLoadEditorScene = mod.sendLoadEditorScene;
  sendTeleport = mod.sendTeleport;
  sendStartPlacement = mod.sendStartPlacement;
  sendCancelPlacement = mod.sendCancelPlacement;
  sendDespawnNode = mod.sendDespawnNode;
  parseHostCommandResult = mod.parseHostCommandResult;
  describeHostCommandResult = mod.describeHostCommandResult;
});

const MAPPING = 'Local\\SwgToolkitLive_test';

beforeEach(() => {
  (addon.writeHostCommand as ReturnType<typeof vi.fn>).mockClear();
});

describe('hostCommand send* wrappers', () => {
  it('sendReloadCurrentScene sends RELOAD_CURRENT_SCENE with empty str1/str2/id and zeroed vec3', () => {
    sendReloadCurrentScene(MAPPING);
    const call = (addon.writeHostCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(MAPPING);
    expect(call[2]).toBe(LIVE_HOST_CMD_ACTION.RELOAD_CURRENT_SCENE);
    expect(call[3]).toBe('');
    expect(call[4]).toBe('');
    expect(call[5]).toBe('0');
    expect(Array.from(call[6] as number[])).toEqual([0, 0, 0]);
  });

  it('sendLoadEditorScene sends LOAD_EDITOR_SCENE with str1=terrain, str2=avatarTemplate', () => {
    sendLoadEditorScene(MAPPING, 'tatooine', 'object/creature/player/shared_human_male.iff');
    const call = (addon.writeHostCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toBe(LIVE_HOST_CMD_ACTION.LOAD_EDITOR_SCENE);
    expect(call[3]).toBe('tatooine');
    expect(call[4]).toBe('object/creature/player/shared_human_male.iff');
  });

  it('sendTeleport sends TELEPORT with vec3=[x,y,z]', () => {
    sendTeleport(MAPPING, 1.5, 2.5, 3.5);
    const call = (addon.writeHostCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toBe(LIVE_HOST_CMD_ACTION.TELEPORT);
    expect(Array.from(call[6] as number[])).toEqual([1.5, 2.5, 3.5]);
  });

  it('sendStartPlacement sends START_PLACEMENT with str1=decorationTemplate, str2=cellName, id=buildingId', () => {
    sendStartPlacement(MAPPING, 'object/tangible/furniture/shared_frn_table.iff', 'cell1', '1082878');
    const call = (addon.writeHostCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toBe(LIVE_HOST_CMD_ACTION.START_PLACEMENT);
    expect(call[3]).toBe('object/tangible/furniture/shared_frn_table.iff');
    expect(call[4]).toBe('cell1');
    expect(call[5]).toBe('1082878');
  });

  it('sendCancelPlacement sends CANCEL_PLACEMENT', () => {
    sendCancelPlacement(MAPPING);
    const call = (addon.writeHostCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toBe(LIVE_HOST_CMD_ACTION.CANCEL_PLACEMENT);
  });

  it('sendDespawnNode sends DESPAWN_NODE with id=networkId', () => {
    sendDespawnNode(MAPPING, '9999999999999');
    const call = (addon.writeHostCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toBe(LIVE_HOST_CMD_ACTION.DESPAWN_NODE);
    expect(call[5]).toBe('9999999999999');
  });

  it('consecutive sends across DIFFERENT actions use strictly increasing epochs', () => {
    sendReloadCurrentScene(MAPPING);
    sendTeleport(MAPPING, 0, 0, 0);
    sendCancelPlacement(MAPPING);
    const calls = (addon.writeHostCommand as ReturnType<typeof vi.fn>).mock.calls;
    const epochs = calls.map((c) => c[1] as number);
    expect(epochs[1]).toBeGreaterThan(epochs[0]);
    expect(epochs[2]).toBeGreaterThan(epochs[1]);
  });

  it('sendStartPlacement returns the exact epoch value it just used in that same call', () => {
    sendReloadCurrentScene(MAPPING); // bump the counter first so the assertion isn't trivially epoch===1
    const returnedEpoch = sendStartPlacement(MAPPING, 'tmpl', 'cell1', '42');
    const call = (addon.writeHostCommand as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(returnedEpoch).toBe(call[1]);
  });
});

describe('parseHostCommandResult', () => {
  function makeBuf(epoch: number, code: number): ArrayBuffer {
    const buf = new ArrayBuffer(LIVE_HOST_CMD_LAYOUT.HOST_CMD_RESULT_EPOCH.offset + 4);
    const view = new DataView(buf);
    view.setInt32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_RESULT_CODE.offset, code, true);
    view.setUint32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_RESULT_EPOCH.offset, epoch, true);
    return buf;
  }

  it('reads epoch/code at the documented offsets', () => {
    const buf = makeBuf(7, 1);
    expect(parseHostCommandResult(buf)).toEqual({ epoch: 7, code: 1 });
  });

  it('reads a negative code (signed int32) correctly, e.g. DESPAWN_NODE occupied', () => {
    const buf = makeBuf(3, -1);
    expect(parseHostCommandResult(buf)).toEqual({ epoch: 3, code: -1 });
  });

  it('matches the epoch sendStartPlacement returns for the same synthetic command (ROUND 10/AA4)', () => {
    (addon.writeHostCommand as ReturnType<typeof vi.fn>).mockClear();
    const returnedEpoch = sendStartPlacement(MAPPING, 'tmpl', 'cell1', '1');
    const buf = makeBuf(returnedEpoch, 1);
    expect(parseHostCommandResult(buf).epoch).toBe(returnedEpoch);
  });
});

describe('describeHostCommandResult — words only, never a bare digit matching the code (C9)', () => {
  it('describes RELOAD_CURRENT_SCENE ok/failure', () => {
    expect(describeHostCommandResult(LIVE_HOST_CMD_ACTION.RELOAD_CURRENT_SCENE, 1)).toBe('ok');
    expect(describeHostCommandResult(LIVE_HOST_CMD_ACTION.RELOAD_CURRENT_SCENE, 0)).toBe('endpoint unresolved or failed');
  });

  it('describes LOAD_EDITOR_SCENE/TELEPORT/START_PLACEMENT/CANCEL_PLACEMENT the same generic way', () => {
    for (const action of [
      LIVE_HOST_CMD_ACTION.LOAD_EDITOR_SCENE,
      LIVE_HOST_CMD_ACTION.TELEPORT,
      LIVE_HOST_CMD_ACTION.START_PLACEMENT,
      LIVE_HOST_CMD_ACTION.CANCEL_PLACEMENT,
    ]) {
      expect(describeHostCommandResult(action, 1)).toBe('ok');
      expect(describeHostCommandResult(action, 0)).toBe('endpoint unresolved or failed');
    }
  });

  it('describes DESPAWN_NODE with its OWN 1/0/-1 contract, distinct from the generic mapping', () => {
    expect(describeHostCommandResult(LIVE_HOST_CMD_ACTION.DESPAWN_NODE, 1)).toBe('despawned');
    expect(describeHostCommandResult(LIVE_HOST_CMD_ACTION.DESPAWN_NODE, 0)).toBe('not found (already gone or buildout-provenance)');
    expect(describeHostCommandResult(LIVE_HOST_CMD_ACTION.DESPAWN_NODE, -1)).toBe('occupied — try again');
    expect(describeHostCommandResult(LIVE_HOST_CMD_ACTION.DESPAWN_NODE, 42)).toBe('unknown outcome');
  });

  it('fails closed on an unrecognized action, never throws', () => {
    expect(() => describeHostCommandResult(999, 1)).not.toThrow();
    expect(describeHostCommandResult(999, 1)).toBe('unknown action');
  });

  it('never returns a string containing the bare numeric code (words only)', () => {
    for (const [action, code] of [
      [LIVE_HOST_CMD_ACTION.RELOAD_CURRENT_SCENE, 0],
      [LIVE_HOST_CMD_ACTION.RELOAD_CURRENT_SCENE, 1],
      [LIVE_HOST_CMD_ACTION.DESPAWN_NODE, -1],
      [LIVE_HOST_CMD_ACTION.DESPAWN_NODE, 0],
      [LIVE_HOST_CMD_ACTION.DESPAWN_NODE, 1],
      [999, 7],
    ] as const) {
      const label = describeHostCommandResult(action, code);
      const codeStr = String(code);
      const re = new RegExp(`(^|[^0-9])${codeStr.replace('-', '-?')}([^0-9]|$)`);
      expect(label).not.toMatch(re);
    }
  });
});
