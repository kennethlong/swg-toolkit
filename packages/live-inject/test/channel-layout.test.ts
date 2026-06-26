// channel-layout.test.ts — Tests the LIVE_CHANNEL_LAYOUT byte constants and seqlock round-trip.
//
// Tests 1 & 3 (TRANSFORM.length===48, TOTAL_SIZE.length===320) PASS from day 1.
// Tests 2 & 4 (seqlock round-trip, LIVENESS.offset) are added/completed in Plan 03-03.
//
// The seqlock round-trip test is entirely in TypeScript — it validates the
// LIVE_CHANNEL_LAYOUT offset constants by simulating a seqlock write over an
// ArrayBuffer and reading the values back via the same offsets.
//
// Note: Plan 03-01 spec'd .spec.ts; project convention is .test.ts (vitest include: *.test.ts)

import { describe, it, expect } from 'vitest';
import { LIVE_CHANNEL_LAYOUT } from '@swg/contracts';

describe('channel layout constants', () => {
  it('TRANSFORM.length is 48 (not 64)', () => {
    // SWG Transform is float[3][4] = 12 floats = 48 bytes.
    // The IPC doc's "64-byte 4×4 matrix" is WRONG for SWG — this test locks the correct value.
    expect(LIVE_CHANNEL_LAYOUT.TRANSFORM.length).toBe(48);
  });

  it('TOTAL_SIZE.length is 320', () => {
    expect(LIVE_CHANNEL_LAYOUT.TOTAL_SIZE.length).toBe(320);
  });

  it('LIVENESS.offset is 316', () => {
    // LiveState layout: 4 (seqCounter) + 48 (transform) + 8 (networkId) + 256 (templateName) = 316
    expect(LIVE_CHANNEL_LAYOUT.LIVENESS.offset).toBe(316);
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
});
