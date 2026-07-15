/**
 * packages/renderer/src/hooks/useCommandWriter.test.ts
 * TDD tests for the zero-allocation imperative write path (05-07 Task 1).
 *
 * RED phase: useCommandWriter.ts does not exist yet — the dynamic import in
 * beforeAll rejects / all assertions fail.
 * GREEN phase: writeTransform/writeStop/writeRebaselineGuard implemented,
 * reusing two module-level preallocated Float32Array buffers for the whole
 * process lifetime (LIVE-03 SC1, write direction).
 *
 * Mocking strategy: `vi.mock('@swg/live-inject', ...)` does NOT intercept a
 * bare `require('@swg/live-inject')` call (vi.mock hooks ESM import
 * resolution, not CJS require — a real, already-built native addon loads
 * instead, and its writeCommand throws "channel not open" against a mapping
 * name that was never openChannel()'d — confirmed by direct repro against
 * this exact package). Instead: require the REAL (singleton, process-cached)
 * addon object directly in this file and monkey-patch its `writeCommand`
 * property with a vi.fn() BEFORE useCommandWriter.ts is ever loaded (via a
 * dynamic `import()` inside beforeAll, since useCommandWriter.ts's own
 * top-level `require('@swg/live-inject')` resolves to the SAME cached object
 * this file patched, as long as that patch runs first).
 *
 * Source: 05-07-PLAN.md Task 1.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { LIVE_CMD_FLAGS } from '@swg/contracts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as { writeCommand: ReturnType<typeof vi.fn> };
addon.writeCommand = vi.fn();

let writeTransform: typeof import('./useCommandWriter').writeTransform;
let writeStop: typeof import('./useCommandWriter').writeStop;
let writeRebaselineGuard: typeof import('./useCommandWriter').writeRebaselineGuard;

beforeAll(async () => {
  const mod = await import('./useCommandWriter');
  writeTransform = mod.writeTransform;
  writeStop = mod.writeStop;
  writeRebaselineGuard = mod.writeRebaselineGuard;
});

const MAPPING = 'Local\\SwgToolkitLive_test';

beforeEach(() => {
  (addon.writeCommand as ReturnType<typeof vi.fn>).mockClear();
});

describe('useCommandWriter (05-07 Task 1)', () => {
  it('writeTransform reuses the SAME Float32Array object reference across 100 calls', () => {
    let firstTransformRef: Float32Array | null = null;
    let firstScaleRef: Float32Array | null = null;

    for (let i = 0; i < 100; i++) {
      const transform = new Array(12).fill(i);
      const scale = [1, 1, 1];
      // Alternate with/without an explicit flags argument.
      if (i % 2 === 0) {
        writeTransform(MAPPING, transform, scale);
      } else {
        writeTransform(MAPPING, transform, scale, LIVE_CMD_FLAGS.REBASELINE_GUARD);
      }
      const call = (addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[i];
      const transformArg = call[1] as Float32Array;
      const scaleArg = call[2] as Float32Array;
      if (firstTransformRef === null) {
        firstTransformRef = transformArg;
        firstScaleRef = scaleArg;
      } else {
        expect(transformArg).toBe(firstTransformRef);
        expect(scaleArg).toBe(firstScaleRef);
      }
    }

    expect(addon.writeCommand).toHaveBeenCalledTimes(100);
  });

  it('writeTransform with no 4th argument passes flags === 0 (parameter default)', () => {
    writeTransform(MAPPING, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 1]);
    const call = (addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3]).toBe(0);
  });

  it('writeTransform with a non-zero flags argument passes that exact value through, alongside the real (non-zeroed) payload', () => {
    const transform = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const scale = [2, 3, 4];
    writeTransform(MAPPING, transform, scale, LIVE_CMD_FLAGS.REBASELINE_GUARD);

    const call = (addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3]).toBe(LIVE_CMD_FLAGS.REBASELINE_GUARD);
    const transformArg = call[1] as Float32Array;
    const scaleArg = call[2] as Float32Array;
    expect(Array.from(transformArg)).toEqual(transform);
    expect(Array.from(scaleArg)).toEqual(scale);
  });

  it('writeStop sends flags === LIVE_CMD_FLAGS.STOP_REQUESTED exactly', () => {
    writeStop(MAPPING);
    const call = (addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(MAPPING);
    expect(call[3]).toBe(LIVE_CMD_FLAGS.STOP_REQUESTED);
  });

  it('writeRebaselineGuard sends flags === LIVE_CMD_FLAGS.REBASELINE_GUARD exactly (distinct from STOP_REQUESTED and 0)', () => {
    writeRebaselineGuard(MAPPING);
    const call = (addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(MAPPING);
    expect(call[3]).toBe(LIVE_CMD_FLAGS.REBASELINE_GUARD);
    expect(call[3]).not.toBe(LIVE_CMD_FLAGS.STOP_REQUESTED);
    expect(call[3]).not.toBe(0);
  });

  it('writeStop and writeRebaselineGuard reuse the SAME preallocated buffers writeTransform uses', () => {
    writeTransform(MAPPING, [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9], [9, 9, 9]);
    const transformRefFromWrite = (addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const scaleRefFromWrite = (addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[0][2];

    writeStop(MAPPING);
    expect((addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[1][1]).toBe(transformRefFromWrite);
    expect((addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[1][2]).toBe(scaleRefFromWrite);

    writeRebaselineGuard(MAPPING);
    expect((addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[2][1]).toBe(transformRefFromWrite);
    expect((addon.writeCommand as ReturnType<typeof vi.fn>).mock.calls[2][2]).toBe(scaleRefFromWrite);
  });
});
