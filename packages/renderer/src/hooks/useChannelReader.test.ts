/**
 * packages/renderer/src/hooks/useChannelReader.test.ts
 * TDD tests for the zero-allocation READ path (05-07 Task 3 — closes the
 * half-met SC1 finding), plus 05.1-08 Task 2 (HOST_CMD result polling,
 * read-before-liveness reorder) and Task 3 (studioDir threading, resolved-
 * mirror threading, decoration edit/add persist RESULT wiring).
 *
 * RED phase: parseChannelView/decodeGuardFields/getRegionView are not
 * exported yet (or do not exist) — imports/assertions fail.
 * GREEN phase: parseChannelView reuses ONE module-level Float32Array(12) via
 * per-element DataView reads (no buf.slice()); getRegionView caches a single
 * Uint8Array view per distinct backing ArrayBuffer (readChannelView returns
 * the SAME ArrayBuffer object for an open channel — confirmed by inspecting
 * channel_binding.cpp's ReadChannelView, which returns `abRef.Value()`, a
 * persistent Napi::Reference to the ArrayBuffer created once at openChannel
 * time — so caching by object identity is a real zero-copy technique here,
 * not just a documented approximation).
 *
 * Source: 05-07-PLAN.md Task 3; 05.1-08-PLAN.md Tasks 2/3.
 *
 * Mocking strategy for the 05.1-08 poll-loop tests below: `@swg/live-inject` is a bare
 * `require()` of a native addon — vi.mock does NOT intercept this (established pattern, see
 * useLiveService.test.ts); monkey-patch the real, process-cached addon object's
 * readChannelView/closeChannel properties directly instead. `../services/decorationPersistOrchestrator`
 * IS a plain ES module (not a native addon), so vi.mock works normally — mocked so these tests
 * exercise the poll loop's OWN wiring (studioDir threading, pendingCapture correlation) without
 * touching the filesystem-heavy real orchestrator.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import {
  LIVE_CHANNEL_LAYOUT,
  LIVE_GUARD_FLAGS,
  LIVE_CHANNEL_TOTAL_SIZE,
  LIVE_DECORATION_LAYOUT,
  LIVE_DECORATION_RESULT,
  LIVE_DECORATION_CAPTURE_KIND,
  LIVE_HOST_CMD_LAYOUT,
} from '@swg/contracts';
import {
  parseChannelView,
  decodeGuardFields,
  getRegionView,
  isPidAlive,
  useChannelReader,
  LIVENESS_CHECK_MS,
  POLL_INTERVAL_MS,
} from './useChannelReader';
import { useLiveStore } from '../state/liveStore';
import { useLogStore } from '../state/logStore';
import { useWorldEditorStore, formatPersistMessage } from '../state/worldEditorStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { handleDecorationCapture } from '../services/decorationPersistOrchestrator';
import { decorationResultLabel } from '../services/decorationChannel';

vi.mock('../services/decorationPersistOrchestrator', () => ({
  handleDecorationCapture: vi.fn(() => ({ mirrorToStockIlf: true })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as {
  readChannelView: ReturnType<typeof vi.fn>;
  closeChannel: ReturnType<typeof vi.fn>;
};

const L = LIVE_CHANNEL_LAYOUT;

/** Builds a valid (even seq, matching seq2) synthetic 400-byte channel buffer. */
function makeBuffer(opts?: {
  transform?: number[];
  networkId?: bigint;
  templateName?: string;
  liveness?: number;
  focusToken?: number;
  guardStatus?: number;
  guardAddr?: number;
}): ArrayBuffer {
  const buf = new ArrayBuffer(L.TOTAL_SIZE.length);
  const view = new DataView(buf);

  view.setUint32(L.SEQ_COUNTER.offset, 2, true); // even = not mid-write

  const transform = opts?.transform ?? new Array(12).fill(0);
  for (let i = 0; i < 12; i++) view.setFloat32(L.TRANSFORM.offset + i * 4, transform[i], true);

  const networkId = opts?.networkId ?? 0n;
  view.setUint32(L.NETWORK_ID.offset, Number(networkId & 0xffffffffn), true);
  view.setUint32(L.NETWORK_ID.offset + 4, Number((networkId >> 32n) & 0xffffffffn), true);

  const nameBytes = new TextEncoder().encode(opts?.templateName ?? 'object/test.iff');
  const nameView = new Uint8Array(buf, L.TEMPLATE_NAME.offset, L.TEMPLATE_NAME.length);
  nameView.set(nameBytes.subarray(0, L.TEMPLATE_NAME.length));

  view.setUint32(L.LIVENESS.offset, opts?.liveness ?? 0x1, true); // player_non_null

  view.setUint32(L.FOCUS_TOKEN.offset, opts?.focusToken ?? 0, true);

  view.setUint32(L.GUARD_STATUS.offset, opts?.guardStatus ?? 0, true);
  view.setUint32(L.GUARD_ADDR.offset, opts?.guardAddr ?? 0, true);

  return buf;
}

describe('useChannelReader zero-allocation read path (05-07 Task 3)', () => {
  it('parseChannelView reuses the SAME Float32Array reference across 100 calls (zero-allocation, write direction of the read path)', () => {
    let firstRef: Float32Array | null = null;
    for (let i = 0; i < 100; i++) {
      const buf = makeBuffer({ transform: new Array(12).fill(i) });
      const state = parseChannelView(buf);
      expect(state).not.toBeNull();
      if (firstRef === null) {
        firstRef = state!.transform;
      } else {
        expect(state!.transform).toBe(firstRef);
      }
    }
  });

  it('parseChannelView returns null on an odd (mid-write) seq counter', () => {
    const buf = makeBuffer();
    new DataView(buf).setUint32(L.SEQ_COUNTER.offset, 3, true); // odd
    expect(parseChannelView(buf)).toBeNull();
  });

  it('getRegionView returns the SAME Uint8Array reference for the SAME backing ArrayBuffer across 100 calls', () => {
    const buf = makeBuffer();
    let firstRef: Uint8Array | null = null;
    for (let i = 0; i < 100; i++) {
      const view = getRegionView(buf);
      if (firstRef === null) {
        firstRef = view;
      } else {
        expect(view).toBe(firstRef);
      }
    }
  });

  it('getRegionView returns a NEW view when the backing ArrayBuffer identity changes', () => {
    const bufA = makeBuffer();
    const bufB = makeBuffer();
    const viewA = getRegionView(bufA);
    const viewB = getRegionView(bufB);
    expect(viewA).not.toBe(viewB);
  });

  it('a consumer .slice() of the returned (reused) transform produces an INDEPENDENT copy unaffected by a later parseChannelView call', () => {
    const bufFirst = makeBuffer({ transform: new Array(12).fill(7) });
    const state1 = parseChannelView(bufFirst)!;
    const captured = state1.transform.slice(); // what captureSnapshotIfNeeded does

    const bufSecond = makeBuffer({ transform: new Array(12).fill(999) });
    parseChannelView(bufSecond); // mutates the SAME reused buffer state1.transform aliases

    expect(Array.from(captured)).toEqual(new Array(12).fill(7));
  });

  it('decodes hasTarget/targetUnavailableOnBuild/scaleUnavailableOnBuild from LIVENESS bits 2/3/4', () => {
    // bit0 (player_non_null) | bit2 (hasTarget) | bit4 (scaleUnavailableOnBuild)
    const liveness = 0x1 | 0x4 | 0x10;
    const state = parseChannelView(makeBuffer({ liveness }))!;
    expect(state.hasTarget).toBe(true);
    expect(state.targetUnavailableOnBuild).toBe(false);
    expect(state.scaleUnavailableOnBuild).toBe(true);
  });

  it('with LIVENESS bit4 clear, scaleUnavailableOnBuild decodes to false', () => {
    const state = parseChannelView(makeBuffer({ liveness: 0x1 }))!;
    expect(state.scaleUnavailableOnBuild).toBe(false);
  });

  it('decodes FOCUS_TOKEN (offset 320) into VerifiedObjectState.focusToken', () => {
    const state = parseChannelView(makeBuffer({ focusToken: 0x12345678 }))!;
    expect(state.focusToken).toBe(0x12345678);
  });

  it('decodeGuardFields reads GUARD_ADDR (offset 396) — a real, wired decode, not a stub', () => {
    const buf = makeBuffer({ guardAddr: 0xdeadbeef });
    const guard = decodeGuardFields(buf);
    expect(guard.guardAddr).toBe(0xdeadbeef);
  });

  it('decodeGuardFields returns guardAddr: null when GUARD_ADDR is 0 (none checked yet)', () => {
    const buf = makeBuffer({ guardAddr: 0 });
    expect(decodeGuardFields(buf).guardAddr).toBeNull();
  });

  it('decodeGuardFields decodes TRANSFORM_REFUSED/SCALE_REFUSED independently from GUARD_STATUS', () => {
    const both = decodeGuardFields(
      makeBuffer({ guardStatus: LIVE_GUARD_FLAGS.TRANSFORM_REFUSED | LIVE_GUARD_FLAGS.SCALE_REFUSED }),
    );
    expect(both.transformBlocked).toBe(true);
    expect(both.scaleBlocked).toBe(true);

    const transformOnly = decodeGuardFields(makeBuffer({ guardStatus: LIVE_GUARD_FLAGS.TRANSFORM_REFUSED }));
    expect(transformOnly.transformBlocked).toBe(true);
    expect(transformOnly.scaleBlocked).toBe(false);

    const neither = decodeGuardFields(makeBuffer({ guardStatus: 0 }));
    expect(neither.transformBlocked).toBe(false);
    expect(neither.scaleBlocked).toBe(false);
  });

  it('does not assign a value derived from LIVENESS bit5 (scaleGuardUnavailableOnBuild) — deliberately agent-only telemetry this round', () => {
    const liveness = 0x1 | 0x20; // bit5 set
    const state = parseChannelView(makeBuffer({ liveness })) as unknown as Record<string, unknown>;
    expect(state['scaleGuardUnavailableOnBuild']).toBeUndefined();
  });
});

describe('isPidAlive — process-liveness client-exit signal', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('is alive when process.kill(pid, 0) does not throw', () => {
    const spy = vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(isPidAlive(1234)).toBe(true);
    expect(spy).toHaveBeenCalledWith(1234, 0); // signal 0 = existence probe, no signal sent
  });

  it('is alive on EPERM (process exists but access is limited)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const e = new Error('operation not permitted') as NodeJS.ErrnoException;
      e.code = 'EPERM';
      throw e;
    });
    expect(isPidAlive(1234)).toBe(true);
  });

  it('is dead on ESRCH (no such process)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const e = new Error('no such process') as NodeJS.ErrnoException;
      e.code = 'ESRCH';
      throw e;
    });
    expect(isPidAlive(1234)).toBe(false);
  });
});

// ─── 05.1-08 Task 2/3: real poll-loop tests ──────────────────────────────────────

const D = LIVE_DECORATION_LAYOUT;
const HC = LIVE_HOST_CMD_LAYOUT;
const PID = 4242;
const MAPPING = 'Local\\SwgToolkitLive_08test';

function writeAsciiz(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  view.setUint8(offset + s.length, 0);
}

/** Builds a full LIVE_CHANNEL_TOTAL_SIZE (1864-byte) synthetic buffer, zeroed by default (all
 *  seqlock counters even, all epochs 0 — nothing captured/resulted yet). */
function makeFullBuffer(opts?: {
  capture?: {
    seq?: number;
    epoch: number;
    kind?: 0 | 1 | 2; // LIVE_DECORATION_CAPTURE_KIND
    cellName?: string;
    buildingId?: bigint;
    original?: number[];
    next?: number[];
    deco?: string;
    bldg?: string;
  };
  result?: { epoch: number; code: number };
  hostCmd?: { epoch: number; code: number };
}): ArrayBuffer {
  const buf = new ArrayBuffer(LIVE_CHANNEL_TOTAL_SIZE);
  const view = new DataView(buf);
  view.setUint32(L.SEQ_COUNTER.offset, 0, true);
  view.setUint32(D.CAPTURE_SEQ_COUNTER.offset, opts?.capture?.seq ?? 0, true);

  if (opts?.capture) {
    const c = opts.capture;
    view.setUint32(D.CAPTURE_EPOCH.offset, c.epoch, true);
    const buildingId = c.buildingId ?? 1n;
    view.setUint32(D.CAPTURE_BUILDING_ID.offset, Number(buildingId & 0xffffffffn), true);
    view.setUint32(D.CAPTURE_BUILDING_ID.offset + 4, Number(buildingId >> 32n), true);
    const orig = c.original ?? new Array(12).fill(0);
    const next = c.next ?? new Array(12).fill(0);
    for (let i = 0; i < 12; i++) view.setFloat32(D.CAPTURE_ORIGINAL_O2P.offset + i * 4, orig[i], true);
    for (let i = 0; i < 12; i++) view.setFloat32(D.CAPTURE_NEW_O2P.offset + i * 4, next[i], true);
    writeAsciiz(view, D.CAPTURE_DECORATION_TEMPLATE.offset, c.deco ?? 'object/tangible/furniture/shared_frn_table.iff');
    writeAsciiz(view, D.CAPTURE_BUILDING_TEMPLATE.offset, c.bldg ?? 'object/building/tatooine/shared_cantina.iff');
    view.setUint32(D.CAPTURE_KIND.offset, c.kind ?? LIVE_DECORATION_CAPTURE_KIND.EDIT, true);
    if (c.cellName) writeAsciiz(view, D.CAPTURE_CELL_NAME.offset, c.cellName);
  }

  if (opts?.result) {
    view.setInt32(D.RESULT_CODE.offset, opts.result.code, true);
    view.setUint32(D.RESULT_EPOCH.offset, opts.result.epoch, true);
  }

  if (opts?.hostCmd) {
    view.setInt32(HC.HOST_CMD_RESULT_CODE.offset, opts.hostCmd.code, true);
    view.setUint32(HC.HOST_CMD_RESULT_EPOCH.offset, opts.hostCmd.epoch, true);
  }

  return buf;
}

function attach(): void {
  useLiveStore.getState().beginAttach('C:/TestClient/SwgClient_r.exe');
  useLiveStore.getState().attachComplete(PID, MAPPING);
}

beforeEach(() => {
  useLiveStore.getState().detach();
  useLogStore.getState().clear();
  useWorldEditorStore.setState({ history: [], hasFailureBadge: false, lastHostCommandResult: null });
  useWorkspaceStore.setState({ studioDir: null });
  addon.readChannelView = vi.fn();
  addon.closeChannel = vi.fn();
  vi.mocked(handleDecorationCapture).mockReset();
  vi.mocked(handleDecorationCapture).mockReturnValue({ mirrorToStockIlf: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useChannelReader poll loop — HOST_CMD result (05.1-08 Task 2, C9)', () => {
  it('logs exactly one words-only line per fresh HOST_CMD_RESULT_EPOCH and writes setLastHostCommandResult once', async () => {
    vi.useFakeTimers();
    addon.readChannelView.mockReturnValue(makeFullBuffer({ hostCmd: { epoch: 5, code: 1 } }));
    attach();

    renderHook(() => useChannelReader());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const entries = useLogStore.getState().entries.filter((e) => e.message.startsWith('Host command #5'));
    expect(entries.length).toBe(1);
    const afterColon = entries[0].message.split(': ')[1] ?? '';
    expect(afterColon).not.toMatch(/\d/); // words only — no raw numeric code anywhere after the epoch
    expect(useWorldEditorStore.getState().lastHostCommandResult).toEqual({ epoch: 5, code: 1 });

    // Repeat poll of the SAME epoch → zero additional log emissions / store writes.
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
    const entriesAfter = useLogStore.getState().entries.filter((e) => e.message.startsWith('Host command #5'));
    expect(entriesAfter.length).toBe(1);
  });

  it('zero regression to the pre-existing decoration capture/result handling', async () => {
    vi.useFakeTimers();
    addon.readChannelView.mockReturnValue(
      makeFullBuffer({ result: { epoch: 2, code: LIVE_DECORATION_RESULT.OK } }),
    );
    attach();

    renderHook(() => useChannelReader());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const entries = useLogStore.getState().entries.filter((e) => e.message.startsWith('Decoration rebind #2'));
    expect(entries.length).toBe(1);
  });

  it('a same-tick client-exit case: an ack already sitting in the channel is consumed BEFORE detach fires (R10 review, CC5), proven against the REAL poll loop', async () => {
    vi.useFakeTimers();
    const startTime = Date.now();
    let armed = false;

    addon.readChannelView.mockImplementation(() => {
      const elapsed = Date.now() - startTime;
      if (!armed && elapsed >= LIVENESS_CHECK_MS) {
        armed = true;
        return makeFullBuffer({ hostCmd: { epoch: 9, code: 1 } });
      }
      return makeFullBuffer();
    });
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= LIVENESS_CHECK_MS) {
        const e = new Error('no such process') as NodeJS.ErrnoException;
        e.code = 'ESRCH';
        throw e;
      }
      return true;
    });
    attach();

    renderHook(() => useChannelReader());
    // Advance in POLL_INTERVAL_MS steps well past LIVENESS_CHECK_MS so the throttled liveness
    // check and the armed ack land on the same tick.
    for (let i = 0; i < 40; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
    }

    // The ack was consumed (not discarded) even though client-exit was detected on the same tick.
    expect(useWorldEditorStore.getState().lastHostCommandResult).toEqual({ epoch: 9, code: 1 });
    // ...and the session DID detach (proving the liveness check still ran / fired on that tick).
    expect(useLiveStore.getState().status.kind).toBe('idle');
    expect(addon.closeChannel).toHaveBeenCalledWith(MAPPING);
  });
});

describe('useChannelReader poll loop — studioDir threading + decoration persist RESULT wiring (05.1-08 Task 3, C2/C3/C7)', () => {
  it('(C3) threads the REAL studioDir into handleDecorationCapture ctx, matching a seeded useWorkspaceStore value', async () => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({ studioDir: '/fake/project/.studio' });
    addon.readChannelView.mockReturnValue(makeFullBuffer({ capture: { epoch: 1 } }));
    attach();

    renderHook(() => useChannelReader());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(handleDecorationCapture).toHaveBeenCalledTimes(1);
    const ctxArg = vi.mocked(handleDecorationCapture).mock.calls[0][2];
    expect(ctxArg.studioDir).toBe('/fake/project/.studio');
  });

  it('a fresh edit-kind CAPTURE followed by a matching fresh OK RESULT records recordPersistResult exactly once, words-only, outcome ok', async () => {
    vi.useFakeTimers();
    vi.mocked(handleDecorationCapture).mockReturnValue({ mirrorToStockIlf: true, cellName: 'cell1', rowIndex: 3 });
    let call = 0;
    addon.readChannelView.mockImplementation(() => {
      call += 1;
      if (call === 1) return makeFullBuffer({ capture: { epoch: 1, original: [1], next: [2] } });
      return makeFullBuffer({ capture: { epoch: 1 }, result: { epoch: 1, code: LIVE_DECORATION_RESULT.OK } });
    });
    attach();

    renderHook(() => useChannelReader());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

    const { history, hasFailureBadge } = useWorldEditorStore.getState();
    expect(history.length).toBe(1);
    expect(history[0].outcome).toBe('ok');
    expect(history[0].message).not.toMatch(/-?\d+/); // words only, never a raw result code
    expect(history[0].message).toBe(formatPersistMessage(decorationResultLabel(LIVE_DECORATION_RESULT.OK), true));
    expect(history[0].cellName).toBe('cell1');
    expect(history[0].rowIndex).toBe(3);
    expect(hasFailureBadge).toBe(false);
  });

  it('a nonzero RESULT code sets outcome error + hasFailureBadge, message is EXACTLY decorationResultLabel(code) with NO mirror-off suffix even when mirrorToStockIlf===false (ROUND 3/MED-9)', async () => {
    vi.useFakeTimers();
    vi.mocked(handleDecorationCapture).mockReturnValue({ mirrorToStockIlf: false });
    let call = 0;
    addon.readChannelView.mockImplementation(() => {
      call += 1;
      if (call === 1) return makeFullBuffer({ capture: { epoch: 1 } });
      return makeFullBuffer({ capture: { epoch: 1 }, result: { epoch: 1, code: LIVE_DECORATION_RESULT.NODE_NOT_FOUND } });
    });
    attach();

    renderHook(() => useChannelReader());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

    const { history, hasFailureBadge } = useWorldEditorStore.getState();
    expect(history.length).toBe(1);
    expect(history[0].outcome).toBe('error');
    expect(history[0].message).toBe(decorationResultLabel(LIVE_DECORATION_RESULT.NODE_NOT_FOUND));
    expect(history[0].message).not.toMatch(/mirror off/i);
    expect(hasFailureBadge).toBe(true);
  });

  it('a mirror-off SUCCESS result records the message built from the RETURNED (not re-read) mirrorToStockIlf value (C7)', async () => {
    vi.useFakeTimers();
    vi.mocked(handleDecorationCapture).mockReturnValue({ mirrorToStockIlf: false });
    let call = 0;
    addon.readChannelView.mockImplementation(() => {
      call += 1;
      if (call === 1) return makeFullBuffer({ capture: { epoch: 1 } });
      return makeFullBuffer({ capture: { epoch: 1 }, result: { epoch: 1, code: LIVE_DECORATION_RESULT.OK } });
    });
    attach();

    renderHook(() => useChannelReader());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

    const { history } = useWorldEditorStore.getState();
    expect(history.length).toBe(1);
    expect(history[0].message).toMatch(/mirror off/i);
    expect(history[0].message).toBe(formatPersistMessage(decorationResultLabel(LIVE_DECORATION_RESULT.OK), false));
  });

  it("beforeTransform/afterTransform equal the originating capture's originalO2p/newO2p exactly (ROUND 3/R5)", async () => {
    vi.useFakeTimers();
    const orig = [1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7];
    const next = [1, 0, 0, 50, 0, 1, 0, 60, 0, 0, 1, 70];
    vi.mocked(handleDecorationCapture).mockReturnValue({ mirrorToStockIlf: true });
    let call = 0;
    addon.readChannelView.mockImplementation(() => {
      call += 1;
      if (call === 1) return makeFullBuffer({ capture: { epoch: 1, original: orig, next } });
      return makeFullBuffer({ capture: { epoch: 1, original: orig, next }, result: { epoch: 1, code: LIVE_DECORATION_RESULT.OK } });
    });
    attach();

    renderHook(() => useChannelReader());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

    const { history } = useWorldEditorStore.getState();
    expect(history[0].beforeTransform).toEqual(orig);
    expect(history[0].afterTransform).toEqual(next);
  });

  it('an arm-failed capture does NOT populate pendingCapture — a later unrelated RESULT epoch never spuriously records it', async () => {
    vi.useFakeTimers();
    let call = 0;
    addon.readChannelView.mockImplementation(() => {
      call += 1;
      if (call === 1) return makeFullBuffer({ capture: { epoch: 1, kind: LIVE_DECORATION_CAPTURE_KIND.ARM_FAILED, cellName: 'could not arm' } });
      return makeFullBuffer({ result: { epoch: 1, code: LIVE_DECORATION_RESULT.OK } });
    });
    attach();

    renderHook(() => useChannelReader());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

    // handleDecorationCapture is NEVER called for an arm-failed capture (the orchestrator's own
    // short-circuit is mocked away here; the useChannelReader-level assertion is that no
    // recordPersistResult call happens from a stale pendingCapture).
    const { history } = useWorldEditorStore.getState();
    expect(history.length).toBe(0);
  });

  it('repolling the identical RESULT epoch produces zero additional recordPersistResult calls (idempotent per epoch)', async () => {
    vi.useFakeTimers();
    vi.mocked(handleDecorationCapture).mockReturnValue({ mirrorToStockIlf: true });
    let call = 0;
    addon.readChannelView.mockImplementation(() => {
      call += 1;
      if (call === 1) return makeFullBuffer({ capture: { epoch: 1 } });
      return makeFullBuffer({ capture: { epoch: 1 }, result: { epoch: 1, code: LIVE_DECORATION_RESULT.OK } });
    });
    attach();

    renderHook(() => useChannelReader());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

    expect(useWorldEditorStore.getState().history.length).toBe(1);
  });

  it('a RESULT epoch with no matching pendingCapture calls neither recordPersistResult nor throws', async () => {
    vi.useFakeTimers();
    addon.readChannelView.mockReturnValue(makeFullBuffer({ result: { epoch: 7, code: LIVE_DECORATION_RESULT.OK } }));
    attach();

    expect(() => renderHook(() => useChannelReader())).not.toThrow();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(useWorldEditorStore.getState().history.length).toBe(0);
  });
});
