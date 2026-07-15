/**
 * packages/renderer/src/hooks/useCommandWriter.test.ts
 * TDD tests for the zero-allocation imperative write path (05-07 Task 1).
 *
 * RED phase: useCommandWriter.ts does not exist yet — all imports fail / all
 * assertions fail against a stub.
 * GREEN phase: writeTransform/writeStop/writeRebaselineGuard implemented,
 * reusing two module-level preallocated Float32Array buffers for the whole
 * process lifetime (LIVE-03 SC1, write direction).
 *
 * Source: 05-07-PLAN.md Task 1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

// Mock the native addon (Path B require) — avoids loading the .node binary.
vi.mock('@swg/live-inject', () => ({
  writeCommand: vi.fn(),
}));

// ─── Import under test ────────────────────────────────────────────────────────

import { writeTransform, writeStop, writeRebaselineGuard } from './useCommandWriter';
import { LIVE_CMD_FLAGS } from '@swg/contracts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as { writeCommand: ReturnType<typeof vi.fn> };

const MAPPING = 'Local\\SwgToolkitLive_test';

beforeEach(() => {
  vi.clearAllMocks();
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
      const call = addon.writeCommand.mock.calls[i];
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
    const call = addon.writeCommand.mock.calls[0];
    expect(call[3]).toBe(0);
  });

  it('writeTransform with a non-zero flags argument passes that exact value through, alongside the real (non-zeroed) payload', () => {
    const transform = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const scale = [2, 3, 4];
    writeTransform(MAPPING, transform, scale, LIVE_CMD_FLAGS.REBASELINE_GUARD);

    const call = addon.writeCommand.mock.calls[0];
    expect(call[3]).toBe(LIVE_CMD_FLAGS.REBASELINE_GUARD);
    const transformArg = call[1] as Float32Array;
    const scaleArg = call[2] as Float32Array;
    expect(Array.from(transformArg)).toEqual(transform);
    expect(Array.from(scaleArg)).toEqual(scale);
  });

  it('writeStop sends flags === LIVE_CMD_FLAGS.STOP_REQUESTED exactly', () => {
    writeStop(MAPPING);
    const call = addon.writeCommand.mock.calls[0];
    expect(call[0]).toBe(MAPPING);
    expect(call[3]).toBe(LIVE_CMD_FLAGS.STOP_REQUESTED);
  });

  it('writeRebaselineGuard sends flags === LIVE_CMD_FLAGS.REBASELINE_GUARD exactly (distinct from STOP_REQUESTED and 0)', () => {
    writeRebaselineGuard(MAPPING);
    const call = addon.writeCommand.mock.calls[0];
    expect(call[0]).toBe(MAPPING);
    expect(call[3]).toBe(LIVE_CMD_FLAGS.REBASELINE_GUARD);
    expect(call[3]).not.toBe(LIVE_CMD_FLAGS.STOP_REQUESTED);
    expect(call[3]).not.toBe(0);
  });

  it('writeStop and writeRebaselineGuard reuse the SAME preallocated buffers writeTransform uses', () => {
    writeTransform(MAPPING, [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9], [9, 9, 9]);
    const transformRefFromWrite = addon.writeCommand.mock.calls[0][1];
    const scaleRefFromWrite = addon.writeCommand.mock.calls[0][2];

    writeStop(MAPPING);
    expect(addon.writeCommand.mock.calls[1][1]).toBe(transformRefFromWrite);
    expect(addon.writeCommand.mock.calls[1][2]).toBe(scaleRefFromWrite);

    writeRebaselineGuard(MAPPING);
    expect(addon.writeCommand.mock.calls[2][1]).toBe(transformRefFromWrite);
    expect(addon.writeCommand.mock.calls[2][2]).toBe(scaleRefFromWrite);
  });
});
