// soak.test.ts — GC-pressure soak test for the command-slot channel binding
// (05-12 Task 1, LIVE-03 SC1).
//
// Proves the command-slot channel binding (channel_binding.cpp) survives
// REPEATED forced V8 garbage collection: the persistent V8-owned copy buffer
// (Napi::Reference refcount=1) is not collected out from under readChannelView,
// its seqlock-validated view->buffer copy keeps returning correct fresh data,
// and the raw mapped view (owned by ChannelState, unmapped only in
// cleanupChannel) is never dangled. Doubles as the regression guard for the
// 05-13 copy-on-read fix (Electron 42 forbids the old external-buffer wrap).
//
// This exercises the REAL native addon (not a TS port) — the point is proving
// the actual native buffer/view lifetime, which a TS simulation cannot exercise.
//
// Requires the vitest process to run with --expose-gc (wired via this
// package's vitest.config.ts poolOptions.forks.execArgv) so global.gc() can
// force a real, synchronous, non-incremental collection each cycle instead of
// relying on incidental GC timing.
//
// Reference: 05-12-PLAN.md Task 1 <action>/<acceptance_criteria>.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LIVE_CHANNEL_LAYOUT, LIVE_CHANNEL_TOTAL_SIZE } from '@swg/contracts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('../index.js') as {
  openChannel: (name: string) => ArrayBuffer;
  closeChannel: (name: string) => void;
  readChannelView: (name: string) => ArrayBuffer | null;
  writeCommand: (
    name: string,
    transformBytes: Float32Array,
    scaleBytes: Float32Array,
    flags?: number,
  ) => void;
};

const CHANNEL_NAME = `Local\\SwgToolkitLive_soak_${process.pid}_${Date.now()}`;
const SOAK_ITERATIONS = 500;
// Whole-mapping size (grows as the channel gains regions — was 400 pre-05-01-decoration,
// then 1308, now 1864 as of 05.1-03's CAPTURE_KIND/CAPTURE_CELL_NAME + HOST_CMD region).
// LIVE_CHANNEL_LAYOUT.TOTAL_SIZE.length stays a FIXED 400 (the original read/command-frame
// span, unrelated to later region growth) — do not use it here.
const TOTAL_SIZE = LIVE_CHANNEL_TOTAL_SIZE;

describe('GC-pressure soak — command-slot channel binding', () => {
  beforeAll(() => {
    if (typeof global.gc !== 'function') {
      throw new Error(
        'soak.test.ts requires --expose-gc (global.gc is not a function) — ' +
          'check packages/live-inject/vitest.config.ts poolOptions.forks.execArgv',
      );
    }
  });

  afterAll(() => {
    // Best-effort cleanup in case an assertion failed mid-loop and left the
    // channel open — closeChannel is idempotent (cleanupChannel no-ops on a
    // missing name).
    addon.closeChannel(CHANNEL_NAME);
  });

  it(
    `survives ${SOAK_ITERATIONS} write+forced-GC+read cycles without dangling the native pointer`,
    () => {
      const opened = addon.openChannel(CHANNEL_NAME);
      expect(opened).toBeInstanceOf(ArrayBuffer);
      expect(opened.byteLength).toBe(TOTAL_SIZE);

      for (let i = 0; i < SOAK_ITERATIONS; i++) {
        // Vary the payload every iteration so a stale/dangling read (a buffer
        // that silently stopped updating) cannot be mistaken for a valid one.
        const tx = i * 1.5;
        const ty = i * 2.5;
        const tz = i * 3.5;
        const transform = new Float32Array([
          1, 0, 0, tx,
          0, 1, 0, ty,
          0, 0, 1, tz,
        ]);
        const scale = new Float32Array([1, 1, 1 + i * 0.01]);

        addon.writeCommand(CHANNEL_NAME, transform, scale, 0);

        // Force a real, synchronous GC cycle — not incidental collection
        // timing. If the Napi::Reference guard (refcount=1, Reset() only in
        // CloseChannel) were absent or broken, this is where the owned copy
        // buffer would be collected out from under the next readChannelView.
        global.gc!();

        const view = addon.readChannelView(CHANNEL_NAME);
        expect(view).not.toBeNull();
        expect(view).toBeInstanceOf(ArrayBuffer);
        expect(view!.byteLength).toBe(TOTAL_SIZE);

        // Confirm the command-region seqlock landed even (write complete, not
        // torn) and the just-written values read back out correctly at the
        // COMMAND_TRANSFORM / COMMAND_SCALE offsets — proves readChannelView's
        // copy reflects the live mapping, not a dangling/zeroed/stale buffer.
        const dv = new DataView(view!);
        const seq = dv.getInt32(LIVE_CHANNEL_LAYOUT.COMMAND_SEQ_COUNTER.offset, true);
        expect(seq % 2).toBe(0);

        for (let k = 0; k < 12; k++) {
          const readVal = dv.getFloat32(LIVE_CHANNEL_LAYOUT.COMMAND_TRANSFORM.offset + k * 4, true);
          expect(readVal).toBe(transform[k]);
        }
        for (let k = 0; k < 3; k++) {
          const readVal = dv.getFloat32(LIVE_CHANNEL_LAYOUT.COMMAND_SCALE.offset + k * 4, true);
          expect(readVal).toBe(scale[k]);
        }
      }

      // Clean teardown: after closeChannel, a subsequent readChannelView must
      // return null (no dangling handle survives Reset()+CloseHandle).
      addon.closeChannel(CHANNEL_NAME);
      expect(addon.readChannelView(CHANNEL_NAME)).toBeNull();
    },
    30000,
  );
});
