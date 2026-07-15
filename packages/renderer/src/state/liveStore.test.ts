/**
 * packages/renderer/src/state/liveStore.test.ts
 * Tests for the D-03 COW snapshot / write-log / per-channel guard state /
 * per-identity cache / gate-on-blocked coalesced revert (05-07 Task 2).
 *
 * Source: 05-07-PLAN.md Task 2 acceptance criteria.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VerifiedObjectState } from '@swg/contracts';
import { LIVE_CMD_FLAGS } from '@swg/contracts';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// useCommandWriter.ts is a plain local ES module (no native require at this
// call site) — vi.mock works normally here, unlike the bare require() of the
// native addon inside useCommandWriter.ts itself (see its own test file).
vi.mock('../hooks/useCommandWriter', () => ({
  writeTransform: vi.fn(),
}));

import { useLiveStore, computeDeltaLabel, formatAddr } from './liveStore';
import { writeTransform } from '../hooks/useCommandWriter';

const mockWriteTransform = writeTransform as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeState(overrides?: Partial<VerifiedObjectState>): VerifiedObjectState {
  return {
    networkId: 0n,
    templateName: 'object/tangible/deed/base.iff',
    transform: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
    playerAlive: true,
    hasTarget: true,
    targetUnavailableOnBuild: false,
    scaleUnavailableOnBuild: false,
    focusToken: 1,
    ...overrides,
  };
}

function attach(mappingName = 'Local\\SwgToolkitLive_test'): void {
  useLiveStore.getState().attachComplete(1234, mappingName);
}

beforeEach(() => {
  mockWriteTransform.mockClear();
  useLiveStore.getState().detach();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('liveStore COW snapshot / identity cache (05-07 Task 2)', () => {
  it('captures cowSnapshot from the FIRST updateState call only — a second call with the SAME focusToken does not overwrite it', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1, transform: new Float32Array(12).fill(1) }));
    const firstSnapshot = useLiveStore.getState().cowSnapshot;
    expect(firstSnapshot).not.toBeNull();
    expect(Array.from(firstSnapshot!.transform)).toEqual(new Array(12).fill(1));

    useLiveStore.getState().updateState(makeState({ focusToken: 1, transform: new Float32Array(12).fill(99) }));
    const secondSnapshot = useLiveStore.getState().cowSnapshot;
    expect(Array.from(secondSnapshot!.transform)).toEqual(new Array(12).fill(1));
  });

  it('a DIFFERENT focusToken with no existing identityCache entry creates a fresh slot', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1, transform: new Float32Array(12).fill(1) }));
    useLiveStore.getState().updateState(makeState({ focusToken: 2, transform: new Float32Array(12).fill(2) }));

    const state = useLiveStore.getState();
    expect(state.currentFocusToken).toBe(2);
    expect(Array.from(state.cowSnapshot!.transform)).toEqual(new Array(12).fill(2));
    expect(state.writeLog).toEqual([]);
    expect(state.guardState).toEqual({ transform: 'ok', scale: 'ok' });
    expect(state.lastDiscardedChange).toBeNull();
  });

  it('token-key grep: captureSnapshotIfNeeded compares focusToken, never networkId/templateName, for identity', () => {
    // Two objects sharing the SAME templateName/networkId but DIFFERENT
    // focusToken must be treated as DISTINCT identities.
    attach();
    useLiveStore.getState().updateState(
      makeState({ focusToken: 1, templateName: 'rock.iff', networkId: 0n, transform: new Float32Array(12).fill(1) }),
    );
    useLiveStore.getState().updateState(
      makeState({ focusToken: 2, templateName: 'rock.iff', networkId: 0n, transform: new Float32Array(12).fill(2) }),
    );
    expect(useLiveStore.getState().currentFocusToken).toBe(2);
    expect(Array.from(useLiveStore.getState().cowSnapshot!.transform)).toEqual(new Array(12).fill(2));
  });

  it('two-same-template-object revert test: revertAll on object-2 sends object-2\'s OWN snapshot, never object-1\'s', () => {
    attach('Local\\SwgToolkitLive_revert2');
    // Object-1: focusToken 1, edited pose.
    useLiveStore.getState().updateState(
      makeState({ focusToken: 1, templateName: 'rock.iff', networkId: 0n, transform: new Float32Array(12).fill(1) }),
    );
    useLiveStore.getState().appendWriteLog({
      id: 1,
      atMs: Date.now(),
      deltaLabel: 'drag',
      resultingTransform: new Float32Array(12).fill(11),
      resultingScale: new Float32Array([1, 1, 1]),
    });

    // Object-2: SAME templateName/networkId, DIFFERENT focusToken (same-template collision case).
    useLiveStore.getState().updateState(
      makeState({ focusToken: 2, templateName: 'rock.iff', networkId: 0n, transform: new Float32Array(12).fill(2) }),
    );

    useLiveStore.getState().revertAll();

    expect(mockWriteTransform).toHaveBeenCalledTimes(1);
    const [, sentTransform] = mockWriteTransform.mock.calls[0];
    expect(Array.from(sentTransform as Float32Array)).toEqual(new Array(12).fill(2));
  });

  it('flip-A-to-B-to-A test: flipping back to A restores its ORIGINAL baseline and write-log, not a fresh re-capture', () => {
    attach('Local\\SwgToolkitLive_flip');
    useLiveStore.getState().updateState(makeState({ focusToken: 1, transform: new Float32Array(12).fill(1) }));
    useLiveStore.getState().appendWriteLog({
      id: 1,
      atMs: Date.now(),
      deltaLabel: 'drag',
      resultingTransform: new Float32Array(12).fill(11),
      resultingScale: new Float32Array([1, 1, 1]),
    });
    const originalASnapshot = useLiveStore.getState().cowSnapshot;
    const originalAWriteLog = useLiveStore.getState().writeLog;

    // Flip to B — fresh capture.
    useLiveStore.getState().updateState(makeState({ focusToken: 2, transform: new Float32Array(12).fill(2) }));
    expect(useLiveStore.getState().writeLog).toEqual([]);

    // Flip BACK to A (still transform=99 live now — should NOT matter, restore is verbatim).
    useLiveStore.getState().updateState(makeState({ focusToken: 1, transform: new Float32Array(12).fill(99) }));

    const restored = useLiveStore.getState();
    expect(restored.currentFocusToken).toBe(1);
    expect(Array.from(restored.cowSnapshot!.transform)).toEqual(Array.from(originalASnapshot!.transform));
    expect(restored.writeLog).toEqual(originalAWriteLog);
    expect(restored.writeLog.length).toBe(1);
  });

  it('cross-check-recreates test: a focusToken HIT whose stored templateName differs from the CURRENT state recreates rather than restores', () => {
    attach('Local\\SwgToolkitLive_xcheck');
    useLiveStore.getState().updateState(
      makeState({ focusToken: 1, templateName: 'rock.iff', networkId: 0n, transform: new Float32Array(12).fill(1) }),
    );
    useLiveStore.getState().appendWriteLog({
      id: 1,
      atMs: Date.now(),
      deltaLabel: 'drag',
      resultingTransform: new Float32Array(12).fill(11),
      resultingScale: new Float32Array([1, 1, 1]),
    });
    // Flip away to a fresh identity.
    useLiveStore.getState().updateState(makeState({ focusToken: 2, templateName: 'crate.iff', networkId: 0n }));

    // focusToken 1 again, but the object now presenting it is a DIFFERENT template
    // (despawn-then-address-reuse case).
    useLiveStore.getState().updateState(
      makeState({ focusToken: 1, templateName: 'crate.iff', networkId: 0n, transform: new Float32Array(12).fill(77) }),
    );

    const state = useLiveStore.getState();
    expect(state.cowSnapshot!.templateName).toBe('crate.iff');
    expect(Array.from(state.cowSnapshot!.transform)).toEqual(new Array(12).fill(77));
    expect(state.writeLog).toEqual([]); // NOT object-1's original log with its prior entry
  });

  it('LRU-eviction test: 65 distinct focusTokens never exceed a cache size of 64; the first-seen token is evicted', () => {
    attach('Local\\SwgToolkitLive_lru');
    for (let i = 1; i <= 65; i++) {
      useLiveStore.getState().updateState(makeState({ focusToken: i, templateName: `t${i}.iff` }));
      expect(useLiveStore.getState().identityCache.size).toBeLessThanOrEqual(64);
    }
    expect(useLiveStore.getState().identityCache.has(1)).toBe(false);
    expect(useLiveStore.getState().identityCache.size).toBe(64);
  });

  it('setGuardState is independently settable per channel', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1 }));
    useLiveStore.getState().setGuardState('scale', 'blocked');
    expect(useLiveStore.getState().guardState).toEqual({ transform: 'ok', scale: 'blocked' });
  });

  it('expectedTransform returns cowSnapshot.transform when writeLog is empty, and the last write-log entry after an append', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1, transform: new Float32Array(12).fill(5) }));
    expect(Array.from(useLiveStore.getState().expectedTransform()!)).toEqual(new Array(12).fill(5));

    useLiveStore.getState().appendWriteLog({
      id: 1,
      atMs: Date.now(),
      deltaLabel: 'drag',
      resultingTransform: new Float32Array(12).fill(42),
      resultingScale: new Float32Array([1, 1, 1]),
    });
    expect(Array.from(useLiveStore.getState().expectedTransform()!)).toEqual(new Array(12).fill(42));
  });

  it('revertAll with both guard channels ok sends ONE writeTransform call with flags=0 and lastDiscardedChange=null', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1 }));
    useLiveStore.getState().revertAll();

    expect(mockWriteTransform).toHaveBeenCalledTimes(1);
    const flags = mockWriteTransform.mock.calls[0][3];
    expect(flags === 0 || flags === undefined).toBe(true);
    expect(useLiveStore.getState().lastDiscardedChange).toBeNull();
  });

  it('revertAll with guardState.transform blocked sends ONE coalesced call with REBASELINE_GUARD and populates lastDiscardedChange.transform (scale undefined)', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1 }));
    useLiveStore.getState().setGuardState('transform', 'blocked');

    useLiveStore.getState().revertAll();

    expect(mockWriteTransform).toHaveBeenCalledTimes(1);
    expect(mockWriteTransform.mock.calls[0][3]).toBe(LIVE_CMD_FLAGS.REBASELINE_GUARD);
    const discarded = useLiveStore.getState().lastDiscardedChange;
    expect(discarded).not.toBeNull();
    expect(discarded!.transform).toBeDefined();
    expect(discarded!.scale).toBeUndefined();
  });

  it('a SCALE-only blocked revert discloses lastDiscardedChange.scale while transform stays undefined', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1 }));
    useLiveStore.getState().setGuardState('scale', 'blocked');

    useLiveStore.getState().revertAll();

    const discarded = useLiveStore.getState().lastDiscardedChange;
    expect(discarded!.scale).toBeDefined();
    expect(discarded!.transform).toBeUndefined();
  });

  it('lastDiscardedChange.scale.gotVerified is always false (no live-scale reader exists this round)', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1 }));
    useLiveStore.getState().setGuardState('scale', 'blocked');
    useLiveStore.getState().revertAll();
    expect(useLiveStore.getState().lastDiscardedChange!.scale!.gotVerified).toBe(false);
  });

  it('lastDiscardedChange.addr is sourced from liveStore.guardAddr', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1 }));
    useLiveStore.getState().setGuardAddr(0xdeadbeef);
    useLiveStore.getState().setGuardState('transform', 'blocked');
    useLiveStore.getState().revertAll();
    expect(useLiveStore.getState().lastDiscardedChange!.addr).toBe('0x' + (0xdeadbeef >>> 0).toString(16).toUpperCase());
  });

  it('revertWrite/revertAll use the write-log/snapshot HISTORICAL scale, never the current verifiedState scale', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1 }));
    useLiveStore.getState().appendWriteLog({
      id: 1,
      atMs: Date.now(),
      deltaLabel: 'scale',
      resultingTransform: new Float32Array(12).fill(3),
      resultingScale: new Float32Array([2, 2, 2]),
    });
    useLiveStore.getState().revertWrite(1);
    // Reverting entry 1 (the only entry) should target cowSnapshot (index 0, no prev entry).
    const [, , sentScale] = mockWriteTransform.mock.calls[0];
    // cowSnapshot.scale is null (never captured) — falls back to identity scale, not
    // the write-log's resultingScale (2,2,2) and not any "current" value.
    expect(Array.from(sentScale as Float32Array)).toEqual([1, 1, 1]);
  });
});

// ─── recordWrite / computeDeltaLabel (05-11 Task 1 — Rule 2 deviation) ────────
// Closes the gap where TransformGizmo.tsx (05-10) called writeTransform
// directly and NEVER appended to the write log — the client card's "every
// live write appends a row" contract could never be observed from a real
// drag. recordWrite is the ONE call site both TransformGizmo.tsx and
// TransformReadoutBar.tsx now invoke.

describe('liveStore.recordWrite (05-11 Task 1)', () => {
  it('does nothing while not attached', () => {
    useLiveStore.getState().recordWrite(new Float32Array(12), new Float32Array([1, 1, 1]));
    expect(useLiveStore.getState().writeLog).toEqual([]);
  });

  it('appends a new entry when the log is empty, sourcing the delta from cowSnapshot', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1, transform: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]) }));
    const t = new Float32Array([1, 0, 0, 0.5, 0, 1, 0, 0, 0, 0, 1, 0]);
    useLiveStore.getState().recordWrite(t, new Float32Array([1, 1, 1]));

    const log = useLiveStore.getState().writeLog;
    expect(log.length).toBe(1);
    expect(log[0]!.deltaLabel).toBe('pos.x +0.50m');
    expect(Array.from(log[0]!.resultingTransform)).toEqual(Array.from(t));
  });

  it('coalesces a SECOND recordWrite call within the debounce window into the SAME row (not a new one)', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ focusToken: 1 }));
    const t1 = new Float32Array([1, 0, 0, 0.5, 0, 1, 0, 0, 0, 0, 1, 0]);
    const t2 = new Float32Array([1, 0, 0, 0.9, 0, 1, 0, 0, 0, 0, 1, 0]);
    useLiveStore.getState().recordWrite(t1, new Float32Array([1, 1, 1]));
    useLiveStore.getState().recordWrite(t2, new Float32Array([1, 1, 1]));

    const log = useLiveStore.getState().writeLog;
    expect(log.length).toBe(1);
    expect(Array.from(log[0]!.resultingTransform)).toEqual(Array.from(t2));
  });

  it('appends a distinct SECOND row once the coalesce window has elapsed', () => {
    vi.useFakeTimers();
    try {
      attach();
      useLiveStore.getState().updateState(makeState({ focusToken: 1 }));
      const t1 = new Float32Array([1, 0, 0, 0.5, 0, 1, 0, 0, 0, 0, 1, 0]);
      useLiveStore.getState().recordWrite(t1, new Float32Array([1, 1, 1]));
      vi.advanceTimersByTime(600);
      const t2 = new Float32Array([1, 0, 0, 1.5, 0, 1, 0, 0, 0, 0, 1, 0]);
      useLiveStore.getState().recordWrite(t2, new Float32Array([1, 1, 1]));

      expect(useLiveStore.getState().writeLog.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('computeDeltaLabel (05-11 Task 1)', () => {
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

  it('prefers a scale delta when scale changed', () => {
    const label = computeDeltaLabel(identity, identity, new Float32Array([1, 1, 1]), new Float32Array([2, 1, 1]));
    expect(label).toBe('scale.x ×2.00');
  });

  it('prefers a position delta when position changed and scale did not', () => {
    const newT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0.75, 0, 0, 1, 0]);
    const label = computeDeltaLabel(identity, newT, null, new Float32Array([1, 1, 1]));
    expect(label).toBe('pos.y +0.75m');
  });

  it('falls back to a rotation-angle delta when neither position nor scale changed', () => {
    // 90-degree rotation about Z: [0,-1,0 / 1,0,0 / 0,0,1] row-major, translation 0.
    const rotated = new Float32Array([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    const label = computeDeltaLabel(identity, rotated, null, new Float32Array([1, 1, 1]));
    expect(label).toMatch(/^rot Δ\+90\.0°$/);
  });
});

describe('formatAddr (05-11 Task 1 — exported for LiveSyncClientCard reuse)', () => {
  it('formats null as 0x0', () => {
    expect(formatAddr(null)).toBe('0x0');
  });

  it('formats a real pointer as uppercase hex', () => {
    expect(formatAddr(0xdeadbeef)).toBe('0xDEADBEEF');
  });
});
