/**
 * channel.h — LiveState struct and channel function declarations.
 *
 * Shared between channel.cpp (seqlock writer) and agent_main.cpp (poll loop).
 * Defining the struct here avoids redefinition across translation units.
 *
 * ARCH REQUIREMENT: Compiled as part of the x86 agent DLL only.
 *
 * LAYOUT: #pragma pack(push, 4) ensures x86 MSVC aligns uint64_t to 4 bytes,
 * matching the LIVE_CHANNEL_LAYOUT constants in @swg/contracts/live-inject.ts.
 * Without this pragma, MSVC would pad 4 bytes before uint64_t on x86, putting
 * networkId at offset 56 instead of 52 (see 03-03-SUMMARY deviation §D-PRAGMA-PACK).
 *
 * Layout (must match LIVE_CHANNEL_LAYOUT in @swg/contracts/live-inject.ts):
 *   seqCounter:    offset   0 (LONG,     4 bytes)
 *   transform:     offset   4 (float[3][4], 48 bytes — row-major)
 *   networkId:     offset  52 (uint64_t,  8 bytes)
 *   templateName:  offset  60 (char[256], null-terminated ASCII)
 *   liveness:      offset 316 (uint32_t,  4 bytes — bit0=playerNonNull, bit1=isOver)
 *   TOTAL:                320 bytes
 */

#pragma once
#include <Windows.h>
#include <cstdint>
#include <cstddef>

// ---------------------------------------------------------------------------
// LiveState struct
// ---------------------------------------------------------------------------

#pragma pack(push, 4)
struct LiveState {
    LONG      seqCounter;        // offset   0
    float     transform[3][4];   // offset   4
    uint64_t  networkId;         // offset  52
    char      templateName[256]; // offset  60
    uint32_t  liveness;          // offset 316
};
#pragma pack(pop)

static constexpr size_t LIVE_STATE_BYTE_SIZE = sizeof(LiveState);

// ---------------------------------------------------------------------------
// Channel functions (implemented in channel.cpp)
// ---------------------------------------------------------------------------

/**
 * channelOpen — open the host-created file-mapping for agent-side writing.
 * The host (channel_binding.cpp) calls CreateFileMapping BEFORE inject;
 * the agent opens the same named mapping here via OpenFileMappingA.
 * Returns true on success, false on failure (channel unavailable — poll continues).
 */
bool channelOpen(const char* mappingName, size_t byteSize);

/**
 * channelWrite — seqlock write of a LiveState snapshot into the mapped view.
 * Sequence: InterlockedIncrement (seq→odd) → memcpy payload → InterlockedIncrement (seq→even).
 * Host reader: read seq, read payload, read seq again; retry if odd or changed (torn read).
 */
void channelWrite(const LiveState* state);

/**
 * channelClose — unmap the view and release the file-mapping handle.
 */
void channelClose();
