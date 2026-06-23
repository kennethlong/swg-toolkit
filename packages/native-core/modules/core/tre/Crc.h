/**
 * Crc.h — SWG forward CRC-32 (Crc::calculate) — engine-free, shared between reader and builder.
 *
 * GROUND TRUTH: swg-client-v2 .../sharedFoundation/src/shared/Crc.cpp
 *   Crc::calculate(name) — forward/MSB-first CRC-32, polynomial 0x04C11DB7,
 *   init 0xFFFFFFFF, final XOR 0xFFFFFFFF, over the lowercased/normalized name.
 *
 *   for (crc = 0xFFFFFFFF; *s; ++s)
 *       crc = table[((crc >> 24) ^ (uint8_t)*s) & 0xFF] ^ (crc << 8);
 *   return crc ^ 0xFFFFFFFF;
 *
 * Table generation: c = i << 24; repeat 8: c = (c & 0x80000000) ? ((c << 1) ^ 0x04C11DB7) : (c << 1);
 *
 * VERIFIED: Crc::calculate(lowercase("appearance/mesh/thm_tato_imprv_building_s09_r0_mesh_l4.msh"))
 *           == 3830594 == crc@offset0 of bottom.tre entry 0.
 *
 * NOTE: The input name MUST already be fixUpFileName-normalized (lowercase, forward-slash).
 *       TreBuilder normalizes via fixUpFileName before calling crcCalculate.
 *       TreArchive::parse already stores normalized names in the name block, so resolve()
 *       also normalizes before calling this.
 */

#pragma once

#include <cstdint>

namespace swg {

/**
 * Compute the forward CRC-32 of a null-terminated, already-normalized filename.
 *
 * Source: swg-client-v2 .../sharedFoundation/src/shared/Crc.cpp Crc::calculate.
 *
 * @param normalizedName  Normalized path (lowercased, forward-slash, no leading ./ or ../).
 * @returns               32-bit forward CRC-32.
 */
uint32_t crcCalculate(const char* normalizedName);

} // namespace swg
