/**
 * packages/contracts/src/sab-layout.ts
 * SharedArrayBuffer byte-offset constants for Phase 0 proof region.
 *
 * SAB total byteLength for Phase 0 = 8 (two Int32 slots).
 * These offsets are the assertion anchors for E2E 03-sab-roundtrip.spec.ts (Plan 05).
 * (Corresponds to CONTEXT.md decision D-04)
 */

export const SAB_LAYOUT = {
  /**
   * Int32 at byte 0. Written by C++ (utility process) as 0xDEAD (57005).
   * Renderer reads this to prove the utility->renderer round-trip.
   * (hello sentinel — "the utility filled this slot")
   */
  HELLO_SENTINEL: { offset: 0, length: 4 },

  /**
   * Int32 at byte 4. Written by the RENDERER with a PER-RUN NONCE (never sent over IPC).
   * The utility process re-reads this slot after the renderer writes it, and acks the
   * nonce value in SabCrossWriteAck.value to prove same-memory observability (zero-copy,
   * not a copy or an echo). If the SAB is only copied, the utility sees 0 here.
   * (renderer sentinel — "the renderer wrote a nonce the utility can see")
   */
  RENDERER_SENTINEL: { offset: 4, length: 4 },
} as const;
