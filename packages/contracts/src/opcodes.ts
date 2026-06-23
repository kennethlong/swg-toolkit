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
  // Phase 1 TRE opcodes (added in Plan 01-01):
  MountArchive = 2,
  ListEntries = 3,
  ReadEntry = 4,
  // Phase 1 IFF opcodes (added in Plan 01-01+):
  ParseIff = 5,
  SerializeIff = 6,
}
