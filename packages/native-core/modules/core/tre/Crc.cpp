/**
 * Crc.cpp — SWG forward CRC-32 (Crc::calculate) implementation.
 *
 * Ported from: swg-client-v2 .../sharedFoundation/src/shared/Crc.cpp
 *
 * This is the FORWARD (non-reflected) CRC-32:
 *   polynomial  0x04C11DB7
 *   init        0xFFFFFFFF
 *   final XOR   0xFFFFFFFF
 *   bit order   MSB-first (NOT reflected/Ethernet CRC which uses 0xEDB88320)
 *
 * Table generation:
 *   c = i << 24; for 8 rounds: c = (c & 0x80000000) ? ((c << 1) ^ 0x04C11DB7) : (c << 1);
 *
 * VERIFIED byte-exact:
 *   crcCalculate("appearance/mesh/thm_tato_imprv_building_s09_r0_mesh_l4.msh") == 3830594
 *   This equals crc@offset0 of bottom.tre entry 0 (real retail archive, v5000, stride 24).
 *
 * NOTE: TreArchive.cpp contains an equivalent static crcCalculate() for the read path.
 *       This standalone translation unit makes the same function available to TreBuilder
 *       without creating a dependency cycle or duplicating the table into the static lib twice
 *       (each TU gets its own crcTable instance; that is acceptable and avoids an ODR issue).
 */

#include "Crc.h"

namespace swg {

// Full 256-entry forward CRC-32 table (polynomial 0x04C11DB7)
// Source: swg-client-v2 Crc.cpp — table init loop.
static uint32_t s_crcTable[256];
static bool     s_crcTableInitialized = false;

static void initCrcTable() {
    if (s_crcTableInitialized) return;
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t c = i << 24;
        for (int j = 0; j < 8; ++j)
            c = (c & 0x80000000u) ? ((c << 1) ^ 0x04C11DB7u) : (c << 1);
        s_crcTable[i] = c;
    }
    s_crcTableInitialized = true;
}

uint32_t crcCalculate(const char* normalizedName) {
    initCrcTable();
    uint32_t crc = 0xFFFFFFFFu;
    for (const char* s = normalizedName; *s; ++s)
        crc = s_crcTable[((crc >> 24) ^ static_cast<uint8_t>(*s)) & 0xFF] ^ (crc << 8);
    return crc ^ 0xFFFFFFFFu;
}

} // namespace swg
