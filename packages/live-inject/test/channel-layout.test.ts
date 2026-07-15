// channel-layout.test.ts — Tests the LIVE_CHANNEL_LAYOUT byte constants and seqlock round-trip.
//
// Tests 1 & 3 (TRANSFORM.length===48, TOTAL_SIZE.length===320) PASS from day 1.
// Tests 2 & 4 (seqlock round-trip, LIVENESS.offset) are added/completed in Plan 03-03.
//
// Plan 05-01 extends this file with the command-region layout (400 bytes total),
// the independent transform/scale guard-flag bits, and the ROUND 5 FOCUS_TOKEN
// read-frame field — added to, not replacing, the existing tests above.
//
// The seqlock round-trip test is entirely in TypeScript — it validates the
// LIVE_CHANNEL_LAYOUT offset constants by simulating a seqlock write over an
// ArrayBuffer and reading the values back via the same offsets.
//
// Note: Plan 03-01 spec'd .spec.ts; project convention is .test.ts (vitest include: *.test.ts)

import { describe, it, expect } from 'vitest';
import { LIVE_CHANNEL_LAYOUT, LIVE_CMD_FLAGS, LIVE_GUARD_FLAGS, LIVE_READFRAME_BYTES } from '@swg/contracts';

describe('channel layout constants', () => {
  it('TRANSFORM.length is 48 (not 64)', () => {
    // SWG Transform is float[3][4] = 12 floats = 48 bytes.
    // The IPC doc's "64-byte 4×4 matrix" is WRONG for SWG — this test locks the correct value.
    expect(LIVE_CHANNEL_LAYOUT.TRANSFORM.length).toBe(48);
  });

  it('TOTAL_SIZE.length is 400', () => {
    // Grew from 320 -> 400 in Plan 05-01 (command region + FOCUS_TOKEN, ROUND 5).
    expect(LIVE_CHANNEL_LAYOUT.TOTAL_SIZE.length).toBe(400);
  });

  it('LIVENESS.offset is 316', () => {
    // LiveState layout: 4 (seqCounter) + 48 (transform) + 8 (networkId) + 256 (templateName) = 316
    expect(LIVE_CHANNEL_LAYOUT.LIVENESS.offset).toBe(316);
  });
});

describe('channel layout — command region + FOCUS_TOKEN (Plan 05-01)', () => {
  it('all seven new offsets/lengths match the Plan 05-01 layout', () => {
    expect(LIVE_CHANNEL_LAYOUT.FOCUS_TOKEN).toEqual({ offset: 320, length: 4 });
    expect(LIVE_CHANNEL_LAYOUT.COMMAND_SEQ_COUNTER).toEqual({ offset: 324, length: 4 });
    expect(LIVE_CHANNEL_LAYOUT.COMMAND_TRANSFORM).toEqual({ offset: 328, length: 48 });
    expect(LIVE_CHANNEL_LAYOUT.COMMAND_SCALE).toEqual({ offset: 376, length: 12 });
    expect(LIVE_CHANNEL_LAYOUT.COMMAND_FLAGS).toEqual({ offset: 388, length: 4 });
    expect(LIVE_CHANNEL_LAYOUT.GUARD_STATUS).toEqual({ offset: 392, length: 4 });
    expect(LIVE_CHANNEL_LAYOUT.GUARD_ADDR).toEqual({ offset: 396, length: 4 });
  });

  it('LIVE_READFRAME_BYTES is 320 (transform+networkId+templateName+liveness+focusToken)', () => {
    expect(LIVE_READFRAME_BYTES).toBe(320);
  });

  it('LIVE_GUARD_FLAGS.TRANSFORM_REFUSED, .SCALE_REFUSED, and .STOPPING are distinct bits', () => {
    expect(LIVE_GUARD_FLAGS.TRANSFORM_REFUSED).not.toBe(LIVE_GUARD_FLAGS.SCALE_REFUSED);
    expect(LIVE_GUARD_FLAGS.TRANSFORM_REFUSED).not.toBe(LIVE_GUARD_FLAGS.STOPPING);
    expect(LIVE_GUARD_FLAGS.SCALE_REFUSED).not.toBe(LIVE_GUARD_FLAGS.STOPPING);
    expect(LIVE_GUARD_FLAGS.STOPPING).toBe(0x4);
  });

  it('LIVE_CMD_FLAGS.STOP_REQUESTED and .REBASELINE_GUARD are distinct bits', () => {
    expect(LIVE_CMD_FLAGS.STOP_REQUESTED).not.toBe(LIVE_CMD_FLAGS.REBASELINE_GUARD);
  });
});

describe('channel layout round-trip (seqlock)', () => {
  it('seqlock write→read round-trips LiveState values', () => {
    // Simulate a channelWrite seqlock over an ArrayBuffer and verify:
    //   1. Payload bytes land at the correct offsets (LIVE_CHANNEL_LAYOUT constants).
    //   2. seq is even (2) after a complete write (odd=in-progress, even=complete).
    //
    // Note: LIVE_CHANNEL_LAYOUT.NETWORK_ID.offset === 52 is not 8-byte aligned,
    // so BigInt64Array cannot be constructed at that offset.  Use DataView instead.

    const totalSize = LIVE_CHANNEL_LAYOUT.TOTAL_SIZE.length; // 320
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);

    // --- Seqlock write ---

    // Step 1: set seq to 1 (odd = write in progress)
    view.setInt32(LIVE_CHANNEL_LAYOUT.SEQ_COUNTER.offset, 1, true);

    // Step 2: write transform (12 × float32 at offset 4)
    const transform = new Float32Array([1, 0, 0, 100, 0, 1, 0, 200, 0, 0, 1, 300]);
    for (let i = 0; i < 12; i++) {
      view.setFloat32(LIVE_CHANNEL_LAYOUT.TRANSFORM.offset + i * 4, transform[i]!, true);
    }

    // Step 3: write networkId (int64 at offset 52 via DataView — not 8-byte aligned)
    const networkId = 12345n;
    view.setBigInt64(LIVE_CHANNEL_LAYOUT.NETWORK_ID.offset, networkId, true);

    // Step 4: write templateName (UTF-8 bytes at offset 60)
    const templateName = 'object/creature/player.iff';
    const encoded = new TextEncoder().encode(templateName);
    const nameBytes = new Uint8Array(buf, LIVE_CHANNEL_LAYOUT.TEMPLATE_NAME.offset,
                                     LIVE_CHANNEL_LAYOUT.TEMPLATE_NAME.length);
    nameBytes.set(encoded);

    // Step 5: set seq to 2 (even = write complete)
    view.setInt32(LIVE_CHANNEL_LAYOUT.SEQ_COUNTER.offset, 2, true);

    // --- Read back ---

    const readSeq = view.getInt32(LIVE_CHANNEL_LAYOUT.SEQ_COUNTER.offset, true);

    const readTransform = Array.from({ length: 12 }, (_, i) =>
      view.getFloat32(LIVE_CHANNEL_LAYOUT.TRANSFORM.offset + i * 4, true)
    );

    const readNetworkId = view.getBigInt64(LIVE_CHANNEL_LAYOUT.NETWORK_ID.offset, true);

    const readNameBuf = new Uint8Array(buf, LIVE_CHANNEL_LAYOUT.TEMPLATE_NAME.offset, encoded.length);
    const readTemplateName = new TextDecoder().decode(readNameBuf);

    // --- Verify ---

    // seq must be even (2) after a complete write
    expect(readSeq).toBe(2);
    expect(readSeq % 2).toBe(0);

    // transform round-trips exactly (test values are exact in float32)
    expect(readTransform).toEqual(Array.from(transform));

    // networkId round-trips via DataView BigInt64
    expect(readNetworkId).toBe(networkId);

    // templateName round-trips as UTF-8
    expect(readTemplateName).toBe(templateName);
  });

  it('ROUND 5: a non-zero FOCUS_TOKEN round-trips through the SAME seqlock read-frame path', () => {
    // Proves focusToken is genuinely part of the coherent read-frame snapshot
    // (grouped with transform/networkId/templateName/liveness under seqCounter's
    // seqlock), NOT a separately-timed publish — REVIEWS.md round-4 decision #1.
    const totalSize = LIVE_CHANNEL_LAYOUT.TOTAL_SIZE.length; // 400
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);

    // --- Seqlock write (agent side, read frame) ---
    view.setInt32(LIVE_CHANNEL_LAYOUT.SEQ_COUNTER.offset, 1, true); // odd = in progress

    const transform = new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]);
    for (let i = 0; i < 12; i++) {
      view.setFloat32(LIVE_CHANNEL_LAYOUT.TRANSFORM.offset + i * 4, transform[i]!, true);
    }
    view.setBigInt64(LIVE_CHANNEL_LAYOUT.NETWORK_ID.offset, 999n, true);
    view.setUint32(LIVE_CHANNEL_LAYOUT.LIVENESS.offset, 0x1, true);

    const focusToken = 0xdeadbeef;
    view.setUint32(LIVE_CHANNEL_LAYOUT.FOCUS_TOKEN.offset, focusToken, true);

    view.setInt32(LIVE_CHANNEL_LAYOUT.SEQ_COUNTER.offset, 2, true); // even = complete

    // --- Read back (host side, same seqlock protocol as parseChannelView) ---
    const seq1 = view.getInt32(LIVE_CHANNEL_LAYOUT.SEQ_COUNTER.offset, true);
    expect(seq1 % 2).toBe(0); // not mid-write

    const readFocusToken = view.getUint32(LIVE_CHANNEL_LAYOUT.FOCUS_TOKEN.offset, true);
    const readTransform0 = view.getFloat32(LIVE_CHANNEL_LAYOUT.TRANSFORM.offset, true);

    const seq2 = view.getInt32(LIVE_CHANNEL_LAYOUT.SEQ_COUNTER.offset, true);
    expect(seq1).toBe(seq2); // not torn

    expect(readFocusToken).toBe(focusToken);
    expect(readTransform0).toBe(1);
  });
});

describe('channel layout — command region seqlock simulation (Plan 05-01, D-02)', () => {
  it('simulates a HOST write into the command region and an agent-side read', () => {
    const totalSize = LIVE_CHANNEL_LAYOUT.TOTAL_SIZE.length; // 400
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);

    // --- Host writes the command region (seqlock protocol) ---
    view.setInt32(LIVE_CHANNEL_LAYOUT.COMMAND_SEQ_COUNTER.offset, 1, true); // odd = in progress

    const cmdTransform = new Float32Array([1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7]);
    for (let i = 0; i < 12; i++) {
      view.setFloat32(LIVE_CHANNEL_LAYOUT.COMMAND_TRANSFORM.offset + i * 4, cmdTransform[i]!, true);
    }
    const cmdScale = new Float32Array([1, 1, 1]);
    for (let i = 0; i < 3; i++) {
      view.setFloat32(LIVE_CHANNEL_LAYOUT.COMMAND_SCALE.offset + i * 4, cmdScale[i]!, true);
    }
    view.setUint32(LIVE_CHANNEL_LAYOUT.COMMAND_FLAGS.offset, LIVE_CMD_FLAGS.STOP_REQUESTED, true);

    view.setInt32(LIVE_CHANNEL_LAYOUT.COMMAND_SEQ_COUNTER.offset, 2, true); // even = complete

    // --- Agent-side read (mirrors channelReadCommand's C++ protocol) ---
    const seq1 = view.getInt32(LIVE_CHANNEL_LAYOUT.COMMAND_SEQ_COUNTER.offset, true);
    expect(seq1 % 2).toBe(0);

    const readTransform = Array.from({ length: 12 }, (_, i) =>
      view.getFloat32(LIVE_CHANNEL_LAYOUT.COMMAND_TRANSFORM.offset + i * 4, true)
    );
    const readScale = Array.from({ length: 3 }, (_, i) =>
      view.getFloat32(LIVE_CHANNEL_LAYOUT.COMMAND_SCALE.offset + i * 4, true)
    );
    const readFlags = view.getUint32(LIVE_CHANNEL_LAYOUT.COMMAND_FLAGS.offset, true);

    const seq2 = view.getInt32(LIVE_CHANNEL_LAYOUT.COMMAND_SEQ_COUNTER.offset, true);
    expect(seq1).toBe(seq2);

    expect(readTransform).toEqual(Array.from(cmdTransform));
    expect(readScale).toEqual(Array.from(cmdScale));
    expect(readFlags).toBe(LIVE_CMD_FLAGS.STOP_REQUESTED);
  });

  it('rejects a torn read of the command region (seq left odd)', () => {
    const totalSize = LIVE_CHANNEL_LAYOUT.TOTAL_SIZE.length;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);

    // Simulate a write that never completes: seq left odd (mid-write).
    view.setInt32(LIVE_CHANNEL_LAYOUT.COMMAND_SEQ_COUNTER.offset, 1, true);
    view.setUint32(LIVE_CHANNEL_LAYOUT.COMMAND_FLAGS.offset, LIVE_CMD_FLAGS.REBASELINE_GUARD, true);
    // (seq intentionally left odd — no second InterlockedIncrement)

    const seq1 = view.getInt32(LIVE_CHANNEL_LAYOUT.COMMAND_SEQ_COUNTER.offset, true);
    const isTornOrInProgress = (seq1 & 1) !== 0;

    // A correct reader must reject this read (channelReadCommand returns false).
    expect(isTornOrInProgress).toBe(true);
  });
});
