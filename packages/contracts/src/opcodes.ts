/**
 * packages/contracts/src/opcodes.ts
 * Opcode enum seed for native ↔ backend communication.
 * Phase 1 will add TRE/IFF opcodes.
 * No runtime code — const enum compiles away entirely.
 */

// eslint-disable-next-line @typescript-eslint/prefer-enum-initializers
export const enum NativeOpcode {
  Hello = 0,
  AllocSab = 1,
  // Phase 1 will add TRE/IFF opcodes here
}
