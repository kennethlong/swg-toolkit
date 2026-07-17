/**
 * packages/renderer/src/hooks/useChannelReader.test.ts
 * TDD tests for the zero-allocation READ path (05-07 Task 3 — closes the
 * half-met SC1 finding).
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
 * Source: 05-07-PLAN.md Task 3.
 */

import { describe, it, expect } from 'vitest';
import { LIVE_CHANNEL_LAYOUT, LIVE_GUARD_FLAGS } from '@swg/contracts';
import { parseChannelView, decodeGuardFields, getRegionView, stepSeqLiveness, STALE_DISCONNECT_MS } from './useChannelReader';

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

describe('stepSeqLiveness — client-exit watchdog (frozen SEQ_COUNTER)', () => {
  it('is never stale while SEQ_COUNTER keeps advancing (clock resets each change)', () => {
    const s = { lastSeq: -1, lastChangeMs: 0 };
    expect(stepSeqLiveness(s, 10, 1000, STALE_DISCONNECT_MS)).toBe(false);          // seed
    expect(stepSeqLiveness(s, 11, 1000 + STALE_DISCONNECT_MS * 5, STALE_DISCONNECT_MS)).toBe(false); // advanced → reset
    expect(stepSeqLiveness(s, 12, 1000 + STALE_DISCONNECT_MS * 9, STALE_DISCONNECT_MS)).toBe(false);
  });

  it('goes stale once SEQ_COUNTER is frozen past the threshold', () => {
    const s = { lastSeq: -1, lastChangeMs: 0 };
    expect(stepSeqLiveness(s, 42, 1000, STALE_DISCONNECT_MS)).toBe(false);                       // seed @1000
    expect(stepSeqLiveness(s, 42, 1000 + STALE_DISCONNECT_MS, STALE_DISCONNECT_MS)).toBe(false); // exactly at threshold: not yet
    expect(stepSeqLiveness(s, 42, 1000 + STALE_DISCONNECT_MS + 1, STALE_DISCONNECT_MS)).toBe(true); // past → stale
  });

  it('a resumed advance after a partial freeze clears the clock (no false trip)', () => {
    const s = { lastSeq: -1, lastChangeMs: 0 };
    stepSeqLiveness(s, 1, 0, STALE_DISCONNECT_MS);                                    // seed @0
    expect(stepSeqLiveness(s, 1, STALE_DISCONNECT_MS - 1, STALE_DISCONNECT_MS)).toBe(false); // frozen, under threshold
    expect(stepSeqLiveness(s, 2, STALE_DISCONNECT_MS - 1, STALE_DISCONNECT_MS)).toBe(false); // advanced → clock resets to t=1999
    // Must now re-accumulate a FULL threshold from the reset point (t=1999), not from 0.
    expect(stepSeqLiveness(s, 2, (STALE_DISCONNECT_MS - 1) + STALE_DISCONNECT_MS, STALE_DISCONNECT_MS)).toBe(false);     // Δ=2000, not > → false
    expect(stepSeqLiveness(s, 2, (STALE_DISCONNECT_MS - 1) + STALE_DISCONNECT_MS + 1, STALE_DISCONNECT_MS)).toBe(true);  // Δ=2001 → stale
  });
});
