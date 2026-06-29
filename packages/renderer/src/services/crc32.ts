/**
 * packages/renderer/src/services/crc32.ts
 * Forward CRC-32 helper — table-based port of packages/native-core/modules/core/tre/Crc.cpp.
 *
 * Algorithm (verified against swg-client-v2/sharedFoundation/src/shared/Crc.cpp):
 *   polynomial  0x04C11DB7 (forward / MSB-first — NOT the reflected Ethernet CRC 0xEDB88320)
 *   init        0xFFFFFFFF
 *   final XOR   0xFFFFFFFF
 *
 * Table generation (per Crc.cpp initCrcTable):
 *   c = i << 24; for 8 rounds: c = (c & 0x80000000) ? ((c << 1) ^ 0x04C11DB7) : (c << 1)
 *
 * Used by tocReader.ts binary search to replicate SearchTOC::localExists
 * (TreeFile_SearchNode.cpp:783-836).
 *
 * Sources:
 *   packages/native-core/modules/core/tre/Crc.cpp  — local port, verified oracle
 *   ../swg-client-v2/.../sharedFoundation/src/shared/Crc.cpp  — ground truth static table
 */

// Build the 256-entry CRC lookup table at module load time.
// Mirrors Crc.cpp initCrcTable() / the static crctable[] in swg-client-v2/Crc.cpp.
// Using Uint32Array keeps all 256 entries in unsigned 32-bit space.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    // Start: i << 24 (MSB position). >>> 0 ensures unsigned 32-bit.
    let c = (i << 24) >>> 0;
    for (let j = 0; j < 8; j++) {
      if ((c & 0x80000000) !== 0) {
        c = (((c << 1) >>> 0) ^ 0x04C11DB7) >>> 0;
      } else {
        c = (c << 1) >>> 0;
      }
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Compute the SWG forward CRC-32 of a virtual-path string.
 *
 * Input convention: each character is treated as a Latin-1 byte (charCode & 0xFF),
 * consistent with how the C++ engine passes filenames to Crc::calculate (ASCII paths,
 * no Unicode normalisation performed here). The caller is responsible for toLowerCase()
 * + forward-slash normalisation before calling crc32 — tocReader.ts applies this in
 * readTocIndex.resolve().
 *
 * Oracle (CONFIRMED against native-core Crc.cpp and swg-client-v2/Crc.cpp):
 *   crc32('appearance/mesh/thm_tato_imprv_building_s09_r0_mesh_l4.msh') === 3830594
 */
export function crc32(input: string): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i) & 0xFF;
    const idx  = ((crc >>> 24) ^ byte) & 0xFF;
    crc = (CRC_TABLE[idx]! ^ ((crc << 8) >>> 0)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
