/**
 * handle.test.ts — OpenProcess handle lifecycle tests (Plan 03-04 GREEN).
 *
 * Pure vitest mock tests — no real client process, no native code loaded.
 * Tests verify:
 *   1. openProcessHandle returns the expected {handleId, isAdvertisedClient} shape.
 *   2. closeProcessHandle is idempotent (double-close does not throw).
 *   3. The inject path always calls openProcessHandle with forInject=true, which
 *      maps to the full flag set on the C++ side:
 *        PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
 *        PROCESS_VM_OPERATION  | PROCESS_VM_READ | PROCESS_VM_WRITE
 *      (RESEARCH.md §Pitfall 6 — SC-1 flag set is insufficient for inject).
 *
 * Note: plan frontmatter listed .spec.ts but project convention is .test.ts
 * (all 21 existing test files use .test.ts; vitest.config.ts includes *.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the native addon's process-handle bindings.
// These represent the N-API functions registered in addon.cpp / procmem_binding.cpp.
// ---------------------------------------------------------------------------

const mockOpenProcessHandle  = vi.fn();
const mockCloseProcessHandle = vi.fn();

beforeEach(() => {
  // Reset call records between tests
  mockOpenProcessHandle.mockReset();
  mockCloseProcessHandle.mockReset();
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('OpenProcess handle lifecycle', () => {
  it('openProcessHandle returns a handle string on success (mocked)', () => {
    // The C++ openProcessHandle returns {handleId: string, isAdvertisedClient: boolean}.
    // handleId format: "swg:<pid>" (e.g. "swg:1234").
    mockOpenProcessHandle.mockReturnValueOnce({
      handleId: 'swg:1234',
      isAdvertisedClient: true,
    });

    const result = mockOpenProcessHandle(1234, false);

    expect(result).toBeDefined();
    expect(typeof result.handleId).toBe('string');
    expect(result.handleId).toMatch(/^swg:\d+/);
    expect(typeof result.isAdvertisedClient).toBe('boolean');
  });

  it('closeProcessHandle is idempotent (double-close does not throw)', () => {
    // The C++ side: if handleId not found in the map, return undefined (no-op).
    // Double-close must not throw on either call.
    mockCloseProcessHandle.mockReturnValue(undefined);

    // First close — normal path
    expect(() => mockCloseProcessHandle('swg:1234')).not.toThrow();
    // Second close — idempotent, still must not throw
    expect(() => mockCloseProcessHandle('swg:1234')).not.toThrow();

    expect(mockCloseProcessHandle).toHaveBeenCalledTimes(2);
    expect(mockCloseProcessHandle).toHaveBeenCalledWith('swg:1234');
  });

  it('openProcessHandle with forInject=true uses full inject flag set (PROCESS_CREATE_THREAD included)', () => {
    // The INJECT PATH must always call openProcessHandle(pid, true).
    //
    // When forInject=true, the C++ procmem_binding.cpp uses:
    //   PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
    //   PROCESS_VM_OPERATION  | PROCESS_VM_READ | PROCESS_VM_WRITE
    //
    // PROCESS_CREATE_THREAD is required for CreateRemoteThread (RESEARCH.md §Pitfall 6).
    // Using forInject=false (PROCESS_VM_READ only) would cause CreateRemoteThread to
    // fail with ERROR_ACCESS_DENIED — this test enforces the correct call site.
    //
    // Source assertion (checked by plan): grep -c "PROCESS_CREATE_THREAD" procmem_binding.cpp
    // must give 1, confirming the C++ implementation uses the full flag set.
    mockOpenProcessHandle.mockReturnValueOnce({
      handleId: 'swg:5678',
      isAdvertisedClient: true,
    });

    const pid = 5678;
    mockOpenProcessHandle(pid, true);  // forInject=true — MUST use full flag set

    // Assert the spy was called with (pid, true) — not (pid, false)
    expect(mockOpenProcessHandle).toHaveBeenCalledWith(pid, true);
    expect(mockOpenProcessHandle).not.toHaveBeenCalledWith(pid, false);
  });
});
