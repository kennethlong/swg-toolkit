// channel-layout.test.ts — Tests the LIVE_CHANNEL_LAYOUT byte constants and seqlock round-trip.
// The TRANSFORM.length===48 sanity check PASSES from day 1 (contracts exist).
// The seqlock round-trip test is a RED STUB — make GREEN in Plan 03-05.
// Note: Plan specified .spec.ts but project convention is .test.ts (vitest include: *.test.ts)

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
});

describe('channel layout round-trip (seqlock)', () => {
  it('seqlock write→read round-trips LiveState values', () => {
    // RED STUB — implement in Plan 03-05 when channelWrite/channelRead land
    expect(true).toBe(false);
  });
});
