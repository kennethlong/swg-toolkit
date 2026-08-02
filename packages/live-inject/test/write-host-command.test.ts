// write-host-command.test.ts — RED/GREEN coverage for the host-side writeHostCommand
// N-API export (05.1-07 Task 2).
//
// Exercises the REAL native addon (not a TS port), same model as soak.test.ts and
// the existing writeRebind end-to-end pattern: open a real named file-mapping,
// write via writeHostCommand, read back the whole view via readChannelView, and
// parse the HOST_CMD region with a DataView at the LIVE_HOST_CMD_LAYOUT offsets —
// proving the C++ write actually lands at the byte offsets the contract declares,
// not just that the function exists.
//
// Reference: 05.1-07-PLAN.md Task 2 <behavior>/<action>/<acceptance_criteria>.

import { describe, it, expect, afterEach } from 'vitest';
import { LIVE_CHANNEL_TOTAL_SIZE, LIVE_HOST_CMD_LAYOUT, LIVE_HOST_CMD_ACTION } from '@swg/contracts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('../index.js') as {
  openChannel: (name: string) => ArrayBuffer;
  closeChannel: (name: string) => void;
  readChannelView: (name: string) => ArrayBuffer | null;
  writeHostCommand: (
    name: string,
    epoch: number,
    action: number,
    str1: string,
    str2: string,
    id: string,
    vec3: Float32Array | number[],
  ) => void;
};

const CHANNEL_NAME = `Local\\SwgToolkitLive_hostcmd_${process.pid}_${Date.now()}`;

describe('writeHostCommand — host-side N-API export', () => {
  afterEach(() => {
    // Idempotent best-effort cleanup — closeChannel no-ops on a missing name.
    addon.closeChannel(CHANNEL_NAME);
  });

  it('is exported as a function', () => {
    expect(typeof addon.writeHostCommand).toBe('function');
  });

  it('throws the documented TypeError on malformed arguments', () => {
    addon.openChannel(CHANNEL_NAME);
    expect(() => {
      // @ts-expect-error — deliberately wrong shape (missing args) for the RED case.
      addon.writeHostCommand(CHANNEL_NAME, 'not-a-number');
    }).toThrowError(
      /writeHostCommand: \(name: string, epoch: number, action: number, str1: string, str2: string, id: string, vec3: Float32Array\(3\)\) required/,
    );
  });

  it('throws "channel not open" when called before openChannel', () => {
    const neverOpenedName = `Local\\SwgToolkitLive_hostcmd_never_${process.pid}_${Date.now()}`;
    expect(() => {
      addon.writeHostCommand(
        neverOpenedName,
        1,
        LIVE_HOST_CMD_ACTION.TELEPORT,
        '',
        '',
        '0',
        [0, 0, 0],
      );
    }).toThrowError(/writeHostCommand: channel not open — call openChannel first/);
  });

  it('round-trips epoch/action/str1/str2/id/vec3 through the real shared-memory view', () => {
    const opened = addon.openChannel(CHANNEL_NAME);
    expect(opened).toBeInstanceOf(ArrayBuffer);
    expect(opened.byteLength).toBe(LIVE_CHANNEL_TOTAL_SIZE);

    const epoch = 7;
    const action = LIVE_HOST_CMD_ACTION.START_PLACEMENT;
    const str1 = 'object/tangible/decoration/lamp.iff';
    const str2 = 'testCell';
    const idStr = '123456789';
    const vec3 = new Float32Array([1.5, -2.25, 3.75]);

    addon.writeHostCommand(CHANNEL_NAME, epoch, action, str1, str2, idStr, vec3);

    const view = addon.readChannelView(CHANNEL_NAME);
    expect(view).not.toBeNull();
    expect(view!.byteLength).toBe(LIVE_CHANNEL_TOTAL_SIZE);
    const dv = new DataView(view!);

    // Seqlock landed even (write complete, not torn).
    const seq = dv.getInt32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_SEQ_COUNTER.offset, true);
    expect(seq % 2).toBe(0);
    expect(seq).toBeGreaterThan(0);

    expect(dv.getUint32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_EPOCH.offset, true)).toBe(epoch);
    expect(dv.getUint32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_ACTION.offset, true)).toBe(action);

    const str1Bytes = new Uint8Array(
      view!,
      LIVE_HOST_CMD_LAYOUT.HOST_CMD_STR1.offset,
      LIVE_HOST_CMD_LAYOUT.HOST_CMD_STR1.length,
    );
    const str1Nul = str1Bytes.indexOf(0);
    const str1Read = new TextDecoder('ascii').decode(str1Bytes.subarray(0, str1Nul));
    expect(str1Read).toBe(str1);

    const str2Bytes = new Uint8Array(
      view!,
      LIVE_HOST_CMD_LAYOUT.HOST_CMD_STR2.offset,
      LIVE_HOST_CMD_LAYOUT.HOST_CMD_STR2.length,
    );
    const str2Nul = str2Bytes.indexOf(0);
    const str2Read = new TextDecoder('ascii').decode(str2Bytes.subarray(0, str2Nul));
    expect(str2Read).toBe(str2);

    // hostCmdId is a raw little-endian uint64_t (2x uint32 halves) — same crossing
    // pattern the layout comment documents for HOST_CMD_ID.
    const idLo = dv.getUint32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_ID.offset, true);
    const idHi = dv.getUint32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_ID.offset + 4, true);
    const idRead = (BigInt(idHi) << 32n) | BigInt(idLo);
    expect(idRead).toBe(BigInt(idStr));

    for (let k = 0; k < 3; k++) {
      const readVal = dv.getFloat32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_VEC3.offset + k * 4, true);
      expect(readVal).toBeCloseTo(vec3[k]!, 5);
    }

    // writeHostCommand must NEVER touch the agent-authoritative result words
    // (hostCmdResultCode/hostCmdResultEpoch) — they stay zero (never written by the agent
    // in this test, and channelOpen zero-fills on open).
    expect(dv.getInt32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_RESULT_CODE.offset, true)).toBe(0);
    expect(dv.getUint32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_RESULT_EPOCH.offset, true)).toBe(0);
  });

  it('accepts a plain number[] for vec3 (not just Float32Array)', () => {
    addon.openChannel(CHANNEL_NAME);
    expect(() => {
      addon.writeHostCommand(
        CHANNEL_NAME,
        1,
        LIVE_HOST_CMD_ACTION.TELEPORT,
        '',
        '',
        '0',
        [10, 20, 30],
      );
    }).not.toThrow();

    const view = addon.readChannelView(CHANNEL_NAME);
    const dv = new DataView(view!);
    expect(dv.getFloat32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_VEC3.offset, true)).toBeCloseTo(10, 5);
    expect(dv.getFloat32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_VEC3.offset + 4, true)).toBeCloseTo(20, 5);
    expect(dv.getFloat32(LIVE_HOST_CMD_LAYOUT.HOST_CMD_VEC3.offset + 8, true)).toBeCloseTo(30, 5);
  });

  it('truncates str1/str2 rather than overflowing the fixed 256/128-byte slots', () => {
    addon.openChannel(CHANNEL_NAME);
    const longStr1 = 'a'.repeat(400);
    const longStr2 = 'b'.repeat(200);

    expect(() => {
      addon.writeHostCommand(
        CHANNEL_NAME,
        1,
        LIVE_HOST_CMD_ACTION.LOAD_EDITOR_SCENE,
        longStr1,
        longStr2,
        '0',
        [0, 0, 0],
      );
    }).not.toThrow();

    const view = addon.readChannelView(CHANNEL_NAME);
    const str1Bytes = new Uint8Array(
      view!,
      LIVE_HOST_CMD_LAYOUT.HOST_CMD_STR1.offset,
      LIVE_HOST_CMD_LAYOUT.HOST_CMD_STR1.length,
    );
    // Last byte of the fixed slot must be NUL — never an overflowing non-NUL byte.
    expect(str1Bytes[str1Bytes.length - 1]).toBe(0);

    const str2Bytes = new Uint8Array(
      view!,
      LIVE_HOST_CMD_LAYOUT.HOST_CMD_STR2.offset,
      LIVE_HOST_CMD_LAYOUT.HOST_CMD_STR2.length,
    );
    expect(str2Bytes[str2Bytes.length - 1]).toBe(0);
  });
});
