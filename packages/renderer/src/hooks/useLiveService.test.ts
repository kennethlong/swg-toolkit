/**
 * packages/renderer/src/hooks/useLiveService.test.ts
 * Tests for detachUI's bounded stop-signal retry loop (05-07 Task 2, ROUND 4
 * REVIEWS.md round-3 maintainer decision #5).
 *
 * Mocking strategy:
 *   - ./useCommandWriter is a plain local ES module import inside
 *     useLiveService.ts — vi.mock works normally.
 *   - @swg/live-inject is a bare `require()` of a native addon — vi.mock does
 *     NOT intercept this (confirmed in useCommandWriter.test.ts's header
 *     comment); monkey-patch the real, process-cached addon object's
 *     readChannelView/closeChannel/openChannel properties instead, BEFORE
 *     dynamically importing useLiveService.ts.
 *
 * Source: 05-07-PLAN.md Task 2 acceptance criteria (detachUI retry tests).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { LIVE_CHANNEL_LAYOUT, LIVE_GUARD_FLAGS } from '@swg/contracts';

vi.mock('./useCommandWriter', () => ({
  writeStop: vi.fn(),
  writeTransform: vi.fn(),
  writeRebaselineGuard: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as {
  readChannelView: ReturnType<typeof vi.fn>;
  closeChannel: ReturnType<typeof vi.fn>;
  openChannel: ReturnType<typeof vi.fn>;
};
addon.readChannelView = vi.fn();
addon.closeChannel = vi.fn();
addon.openChannel = vi.fn();

let detachUI: typeof import('./useLiveService').detachUI;
let useLiveStore: typeof import('../state/liveStore').useLiveStore;
let writeStopMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const mod = await import('./useLiveService');
  detachUI = mod.detachUI;
  const storeMod = await import('../state/liveStore');
  useLiveStore = storeMod.useLiveStore;
  const cwMod = await import('./useCommandWriter');
  writeStopMock = cwMod.writeStop as ReturnType<typeof vi.fn>;
});

/** Synthetic 400-byte channel buffer with GUARD_STATUS.STOPPING optionally set. */
function makeGuardBuffer(stopping: boolean): ArrayBuffer {
  const buf = new ArrayBuffer(LIVE_CHANNEL_LAYOUT.TOTAL_SIZE.length);
  const view = new DataView(buf);
  view.setUint32(LIVE_CHANNEL_LAYOUT.GUARD_STATUS.offset, stopping ? LIVE_GUARD_FLAGS.STOPPING : 0, true);
  return buf;
}

beforeEach(() => {
  writeStopMock.mockClear();
  addon.readChannelView.mockClear();
  addon.closeChannel.mockClear();
  useLiveStore.getState().detach();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('detachUI stop-signal retry loop (05-07 Task 2, ROUND 4)', () => {
  it('skips writeStop entirely when idle (no channel to signal)', async () => {
    await detachUI();
    expect(writeStopMock).not.toHaveBeenCalled();
    expect(addon.closeChannel).not.toHaveBeenCalled();
  });

  it('calls writeStop at least once, then closeChannel, when a session is attached', async () => {
    useLiveStore.getState().attachComplete(1234, 'Local\\SwgToolkitLive_detach1');
    addon.readChannelView.mockReturnValue(makeGuardBuffer(true)); // acknowledged immediately

    await detachUI();

    expect(writeStopMock).toHaveBeenCalledTimes(1);
    expect(writeStopMock).toHaveBeenCalledWith('Local\\SwgToolkitLive_detach1');
    expect(addon.closeChannel).toHaveBeenCalledWith('Local\\SwgToolkitLive_detach1');
  });

  it('retries writeStop MORE THAN ONCE when GUARD_FLAG_STOPPING is never observed, before the bounded timeout expires', async () => {
    vi.useFakeTimers();
    useLiveStore.getState().attachComplete(1234, 'Local\\SwgToolkitLive_detach2');
    addon.readChannelView.mockReturnValue(makeGuardBuffer(false)); // never acknowledged

    const detachPromise = detachUI();

    // Advance well past the bounded timeout (~750ms) in interval-sized steps.
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(33);
    }
    await detachPromise;

    expect(writeStopMock.mock.calls.length).toBeGreaterThan(1);
    expect(addon.closeChannel).toHaveBeenCalledWith('Local\\SwgToolkitLive_detach2');
  });

  it('closes promptly once STOPPING becomes set after the second writeStop call (not waiting for the full timeout)', async () => {
    vi.useFakeTimers();
    useLiveStore.getState().attachComplete(1234, 'Local\\SwgToolkitLive_detach3');

    let call = 0;
    addon.readChannelView.mockImplementation(() => {
      call += 1;
      return makeGuardBuffer(call >= 2); // acknowledged starting the 2nd read
    });

    const detachPromise = detachUI();
    // A handful of small advances is enough to observe the 2nd read.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(33);
    }
    await detachPromise;

    // Resolved well before the ~750ms bounded timeout would have required ~23 retries.
    expect(writeStopMock.mock.calls.length).toBeLessThan(10);
    expect(addon.closeChannel).toHaveBeenCalledWith('Local\\SwgToolkitLive_detach3');
  });
});
