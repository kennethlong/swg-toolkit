/**
 * channel.cpp — seqlock file-mapping channel writer (agent side).
 *
 * The HOST creates the file-mapping (CreateFileMapping) before inject.
 * The agent opens it here (OpenFileMappingA, FILE_MAP_WRITE).
 * Naming convention: "Local\\SwgToolkitLive_<pid>"
 * (mirrors Utinni main.cpp "Local\\UtinniReady_<pid>")
 *
 * Seqlock write protocol (T-03-03 tamper mitigation):
 *   1. InterlockedIncrement(seq) — seq → odd: write in progress
 *   2. memcpy payload (everything after the seqlock LONG)
 *   3. InterlockedIncrement(seq) — seq → even: write complete
 *
 * Host-side reader: read seq, read payload, read seq again;
 *   retry if seq is odd or the two seq reads disagree.
 *
 * ARCH REQUIREMENT: This file is compiled as part of the x86 agent DLL.
 *   On x86 MSVC, uint64_t has 4-byte natural alignment.  Use #pragma pack(push, 4)
 *   to ensure the LiveState layout matches the contracts/live-inject.ts
 *   LIVE_CHANNEL_LAYOUT constants and its static_asserts.
 */

#include <Windows.h>
#include <cstring>
#include <cstddef>
#include <cstdint>

// ---------------------------------------------------------------------------
// LiveState struct — must match LIVE_CHANNEL_LAYOUT in @swg/contracts/live-inject.ts
//
// Offsets (enforced by static_assert below):
//   seqCounter:    offset   0 (LONG, 4 bytes  — seqlock managed by channelWrite)
//   transform:     offset   4 (float[3][4], 48 bytes — row-major, translation at col 3)
//   networkId:     offset  52 (uint64_t, 8 bytes)
//   templateName:  offset  60 (char[256], null-terminated ASCII)
//   liveness:      offset 316 (uint32_t, 4 bytes — bit0=playerNonNull, bit1=isOver)
//   TOTAL:                320 bytes
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

static_assert(sizeof(LiveState) == 320,
    "LiveState must match LIVE_CHANNEL_LAYOUT.TOTAL_SIZE (320 bytes)");
static_assert(offsetof(LiveState, transform) == 4,
    "transform offset must be 4 to match LIVE_CHANNEL_LAYOUT.TRANSFORM.offset");
static_assert(offsetof(LiveState, networkId) == 52,
    "networkId offset must be 52 to match LIVE_CHANNEL_LAYOUT.NETWORK_ID.offset");
static_assert(offsetof(LiveState, templateName) == 60,
    "templateName offset must be 60 to match LIVE_CHANNEL_LAYOUT.TEMPLATE_NAME.offset");
static_assert(offsetof(LiveState, liveness) == 316,
    "liveness offset must be 316 to match LIVE_CHANNEL_LAYOUT.LIVENESS.offset");

// ---------------------------------------------------------------------------
// Module-global file-mapping handles (one channel per agent instance)
// ---------------------------------------------------------------------------

static HANDLE s_hMap  = nullptr;
static void*  s_view  = nullptr;

// ---------------------------------------------------------------------------
// channelOpen — open the host-created file-mapping for writing
// ---------------------------------------------------------------------------

bool channelOpen(const char* mappingName, size_t byteSize) {
    if (!mappingName) return false;

    s_hMap = OpenFileMappingA(FILE_MAP_WRITE, FALSE, mappingName);
    if (!s_hMap) return false;   // Host hasn't created the mapping yet — normal during early startup

    s_view = MapViewOfFile(s_hMap, FILE_MAP_WRITE, 0, 0, byteSize);
    if (!s_view) {
        CloseHandle(s_hMap);
        s_hMap = nullptr;
        return false;
    }

    // Zero-initialize the view on first open so the host sees a clean state
    std::memset(s_view, 0, byteSize);
    return true;
}

// ---------------------------------------------------------------------------
// channelWrite — seqlock write of a LiveState snapshot
// ---------------------------------------------------------------------------

void channelWrite(const LiveState* state) {
    if (!s_view || !state) return;

    volatile LONG* seq = static_cast<volatile LONG*>(s_view);

    // seq → odd: write in progress; host reader must retry
    InterlockedIncrement(seq);

    // Copy everything after the seqlock LONG: transform, networkId, templateName, liveness.
    // Source starts at state->transform (offset 4 in the struct).
    // Destination starts at s_view + sizeof(LONG) (offset 4 in the mapped view).
    // Byte count: sizeof(LiveState) - sizeof(LONG) = 316 bytes.
    std::memcpy(
        static_cast<char*>(s_view) + sizeof(LONG),
        &state->transform,
        sizeof(LiveState) - sizeof(LONG)
    );

    // seq → even: write complete; host reader may proceed
    InterlockedIncrement(seq);
}

// ---------------------------------------------------------------------------
// channelClose — unmap and release the file-mapping handle
// ---------------------------------------------------------------------------

void channelClose() {
    if (s_view) { UnmapViewOfFile(s_view); s_view = nullptr; }
    if (s_hMap) { CloseHandle(s_hMap);     s_hMap = nullptr; }
}
