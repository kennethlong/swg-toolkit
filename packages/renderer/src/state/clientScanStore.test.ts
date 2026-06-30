/**
 * packages/renderer/src/state/clientScanStore.test.ts
 * Wave-0 RED gate for clientScanStore (Plan 04.3-02 Task 2).
 *
 * Tests FAIL in RED because setMessage is a no-op stub.
 * Wave-1 plan 08 implements the real setter; tests go GREEN.
 *
 * Test inventory:
 *   (1) setClientScanMessage then read back returns the message   — RED: stub no-op → stays null
 *   (2) setClientScanMessage(null) clears a prior message         — RED: stub no-op → not cleared
 *   (3) initial message is null                                    — always GREEN (invariant)
 *
 * Source: 04.3-02-PLAN.md Task 2; 04.3-RESEARCH.md §clientScanStore contract (P9).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useClientScanStore, setClientScanMessage } from './clientScanStore';

// ---------------------------------------------------------------------------
// Reset store state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  useClientScanStore.setState({ message: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('clientScanStore — Wave-0 RED (stub: setMessage is a no-op)', () => {

  it('(1) setClientScanMessage sets message readable via store (RED: stub → message stays null)', () => {
    setClientScanMessage('Scanning client files…');
    // RED: setMessage is a no-op → message stays null → FAIL
    expect(useClientScanStore.getState().message).toBe('Scanning client files…');
  });

  it('(2) setClientScanMessage(null) clears a prior message (RED: stub → old value remains)', () => {
    // Seed a message directly (bypassing the no-op setter)
    useClientScanStore.setState({ message: 'Prior scan result' });
    setClientScanMessage(null);
    // RED: setMessage is a no-op → 'Prior scan result' remains → FAIL
    expect(useClientScanStore.getState().message).toBeNull();
  });

  it('(3) initial message is null (always GREEN — store starts with message:null)', () => {
    expect(useClientScanStore.getState().message).toBeNull();
  });

});
