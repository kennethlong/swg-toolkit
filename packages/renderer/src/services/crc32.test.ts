// @vitest-environment node
/**
 * packages/renderer/src/services/crc32.test.ts
 * Direct CRC-32 oracle test (W3) — CI-runnable without any real .toc file.
 *
 * Validates that the TypeScript CRC port in crc32.ts matches the native-core
 * Crc.cpp implementation byte-for-byte. The oracle value was:
 *   CONFIRMED against packages/native-core/modules/core/tre/Crc.cpp (line 16):
 *     "VERIFIED byte-exact: crcCalculate("appearance/mesh/...msh") == 3830594"
 *   CONFIRMED against ../swg-client-v2/.../sharedFoundation/src/shared/Crc.cpp:
 *     static crctable[] with polynomial 0x04C11DB7 (MSB-first forward CRC-32)
 */

import { describe, it, expect } from 'vitest';
import { crc32 } from './crc32';

describe('crc32', () => {
  it('byte-exact CRC-port oracle (W3)', () => {
    // CONFIRM this value against native-core Crc.cpp before executing — byte-exact CRC-port gate
    // oracle source: packages/native-core/modules/core/tre/Crc.cpp line 16
    //   "VERIFIED byte-exact: crcCalculate(...msh) == 3830594"
    //   "This equals crc@offset0 of bottom.tre entry 0 (real retail archive, v5000, stride 24)."
    expect(crc32('appearance/mesh/thm_tato_imprv_building_s09_r0_mesh_l4.msh')).toBe(3830594);
  });

  it('empty string returns crcNull (0)', () => {
    // Crc::crcNull = Crc::calculate("") = 0xFFFFFFFF ^ 0xFFFFFFFF = 0
    // Verified: loop never executes, crc stays 0xFFFFFFFF, final XOR → 0
    expect(crc32('')).toBe(0);
  });

  it('result is always a non-negative 32-bit integer', () => {
    const val = crc32('test/path/file.txt');
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});
