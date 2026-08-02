/**
 * channel.cpp — seqlock file-mapping channel writer (agent side).
 *
 * The HOST creates the file-mapping (CreateFileMapping) before inject.
 * The agent opens it here (OpenFileMappingA, FILE_MAP_WRITE).
 * Naming convention: "Local\\SwgToolkitLive_<uuid-fragment>"
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
 *   LiveState layout and #pragma pack(push, 4) are defined in channel.h.
 */

#include "channel.h"
#include <cstring>

// Layout verification — keep these in the .cpp to catch packing regressions early.
static_assert(sizeof(LiveState) == 1864,
    "LiveState must match LIVE_CHANNEL_TOTAL_SIZE (1864 bytes — 400-byte frame + decoration "
    "region incl. CAPTURE_KIND/CAPTURE_CELL_NAME + HOST_CMD region, 05.1-03)");
static_assert(offsetof(LiveState, transform) == 4,
    "transform offset must be 4 to match LIVE_CHANNEL_LAYOUT.TRANSFORM.offset");
static_assert(offsetof(LiveState, networkId) == 52,
    "networkId offset must be 52 to match LIVE_CHANNEL_LAYOUT.NETWORK_ID.offset");
static_assert(offsetof(LiveState, templateName) == 60,
    "templateName offset must be 60 to match LIVE_CHANNEL_LAYOUT.TEMPLATE_NAME.offset");
static_assert(offsetof(LiveState, liveness) == 316,
    "liveness offset must be 316 to match LIVE_CHANNEL_LAYOUT.LIVENESS.offset");
static_assert(offsetof(LiveState, focusToken) == 320,
    "focusToken offset must be 320 to match LIVE_CHANNEL_LAYOUT.FOCUS_TOKEN.offset");
static_assert(offsetof(LiveState, cmdSeqCounter) == 324,
    "cmdSeqCounter offset must be 324 to match LIVE_CHANNEL_LAYOUT.COMMAND_SEQ_COUNTER.offset");
static_assert(offsetof(LiveState, cmdTransform) == 328,
    "cmdTransform offset must be 328 to match LIVE_CHANNEL_LAYOUT.COMMAND_TRANSFORM.offset");
static_assert(offsetof(LiveState, cmdScale) == 376,
    "cmdScale offset must be 376 to match LIVE_CHANNEL_LAYOUT.COMMAND_SCALE.offset");
static_assert(offsetof(LiveState, cmdFlags) == 388,
    "cmdFlags offset must be 388 to match LIVE_CHANNEL_LAYOUT.COMMAND_FLAGS.offset");
static_assert(offsetof(LiveState, guardStatus) == 392,
    "guardStatus offset must be 392 to match LIVE_CHANNEL_LAYOUT.GUARD_STATUS.offset");
static_assert(offsetof(LiveState, guardAddr) == 396,
    "guardAddr offset must be 396 to match LIVE_CHANNEL_LAYOUT.GUARD_ADDR.offset");
// Decoration region — mirror LIVE_DECORATION_LAYOUT in @swg/contracts/live-inject.ts.
static_assert(offsetof(LiveState, captureSeqCounter)         == 400,  "captureSeqCounter @ 400");
static_assert(offsetof(LiveState, captureEpoch)             == 404,  "captureEpoch @ 404");
static_assert(offsetof(LiveState, captureBuildingId)        == 408,  "captureBuildingId @ 408");
static_assert(offsetof(LiveState, captureOriginalO2p)       == 416,  "captureOriginalO2p @ 416");
static_assert(offsetof(LiveState, captureNewO2p)            == 464,  "captureNewO2p @ 464");
static_assert(offsetof(LiveState, captureDecorationTemplate) == 512, "captureDecorationTemplate @ 512");
static_assert(offsetof(LiveState, captureBuildingTemplate)  == 768,  "captureBuildingTemplate @ 768");
static_assert(offsetof(LiveState, rebindSeqCounter)         == 1024, "rebindSeqCounter @ 1024");
static_assert(offsetof(LiveState, rebindEpoch)             == 1028, "rebindEpoch @ 1028");
static_assert(offsetof(LiveState, rebindFlags)            == 1032, "rebindFlags @ 1032");
static_assert(offsetof(LiveState, rebindBuildingId)       == 1036, "rebindBuildingId @ 1036");
static_assert(offsetof(LiveState, rebindDerivedTemplate)  == 1044, "rebindDerivedTemplate @ 1044");
static_assert(offsetof(LiveState, resultCode)             == 1300, "resultCode @ 1300");
static_assert(offsetof(LiveState, resultEpoch)            == 1304, "resultEpoch @ 1304");
// CAPTURE kind/cellName extension (05.1-03, D-01/C8) — SAME seqlock span as the rest of
// CAPTURE, non-contiguous with captureBuildingTemplate (768) above.
static_assert(offsetof(LiveState, captureKind)             == 1308, "captureKind @ 1308");
static_assert(offsetof(LiveState, captureCellName)         == 1312, "captureCellName @ 1312");
// Unified HOST_CMD region (05.1-03) — mirror LIVE_HOST_CMD_LAYOUT in
// @swg/contracts/live-inject.ts.
static_assert(offsetof(LiveState, hostCmdSeqCounter)       == 1440, "hostCmdSeqCounter @ 1440");
static_assert(offsetof(LiveState, hostCmdEpoch)            == 1444, "hostCmdEpoch @ 1444");
static_assert(offsetof(LiveState, hostCmdAction)           == 1448, "hostCmdAction @ 1448");
static_assert(offsetof(LiveState, hostCmdStr1)             == 1452, "hostCmdStr1 @ 1452");
static_assert(offsetof(LiveState, hostCmdStr2)             == 1708, "hostCmdStr2 @ 1708");
static_assert(offsetof(LiveState, hostCmdId)               == 1836, "hostCmdId @ 1836");
static_assert(offsetof(LiveState, hostCmdVec3)             == 1844, "hostCmdVec3 @ 1844");
static_assert(offsetof(LiveState, hostCmdResultCode)       == 1856, "hostCmdResultCode @ 1856");
static_assert(offsetof(LiveState, hostCmdResultEpoch)      == 1860, "hostCmdResultEpoch @ 1860");

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

    // Copy the read-frame payload: transform, networkId, templateName, liveness, focusToken.
    // Source starts at state->transform (offset 4 in the struct).
    // Destination starts at s_view + sizeof(LONG) (offset 4 in the mapped view).
    // Byte count: LIVE_READFRAME_BYTES - sizeof(LONG) = 316 bytes.
    // LIVE_READFRAME_BYTES is a NAMED CONSTANT (not sizeof(LiveState) arithmetic) so
    // extending LiveState for the command slot can never silently widen this copy
    // span into the command region (T-05-01 — THE BUG this fixes).
    std::memcpy(
        static_cast<char*>(s_view) + sizeof(LONG),
        &state->transform,
        LIVE_READFRAME_BYTES - sizeof(LONG)
    );

    // seq → even: write complete; host reader may proceed
    InterlockedIncrement(seq);
}

// ---------------------------------------------------------------------------
// channelReadCommand — agent-side seqlock retry-read of the command region
// ---------------------------------------------------------------------------

bool channelReadCommand(LiveCommand* out, uint32_t* outCmdSeq) {
    if (!s_view || !out) return false;

    volatile LONG* cmdSeq = reinterpret_cast<volatile LONG*>(
        static_cast<char*>(s_view) + offsetof(LiveState, cmdSeqCounter));

    // Seqlock step 1 — odd seq means the host is mid-write; skip this read.
    LONG seq1 = *cmdSeq;
    if ((seq1 & 1) != 0) return false;

    // Read payload: cmdTransform, cmdScale, cmdFlags (contiguous in the struct).
    const char* cmdTransformPtr = static_cast<const char*>(s_view) + offsetof(LiveState, cmdTransform);
    std::memcpy(out->transform, cmdTransformPtr, sizeof(out->transform));

    const char* cmdScalePtr = static_cast<const char*>(s_view) + offsetof(LiveState, cmdScale);
    std::memcpy(out->scale, cmdScalePtr, sizeof(out->scale));

    const uint32_t* cmdFlagsPtr = reinterpret_cast<const uint32_t*>(
        static_cast<const char*>(s_view) + offsetof(LiveState, cmdFlags));
    out->flags = *cmdFlagsPtr;

    // Seqlock step 2 — torn-read check; reject if seq changed during our read.
    LONG seq2 = *cmdSeq;
    if (seq1 != seq2) return false;

    if (outCmdSeq) *outCmdSeq = static_cast<uint32_t>(seq2);
    return true;
}

// ---------------------------------------------------------------------------
// channelWriteGuardStatus — agent writes its own guard outcome + checked addr
// ---------------------------------------------------------------------------

void channelWriteGuardStatus(uint32_t flags, uint32_t addr) {
    if (!s_view) return;

    volatile LONG* guardStatusPtr = reinterpret_cast<volatile LONG*>(
        static_cast<char*>(s_view) + offsetof(LiveState, guardStatus));
    volatile LONG* guardAddrPtr = reinterpret_cast<volatile LONG*>(
        static_cast<char*>(s_view) + offsetof(LiveState, guardAddr));

    // Single aligned uint32 words — InterlockedExchange each independently,
    // no seqlock needed (a torn read of one stale-but-valid word is harmless).
    InterlockedExchange(guardStatusPtr, static_cast<LONG>(flags));
    InterlockedExchange(guardAddrPtr, static_cast<LONG>(addr));
}

// ---------------------------------------------------------------------------
// channelWriteCapture — seqlock write of one captured decoration move
// ---------------------------------------------------------------------------

void channelWriteCapture(const DecorationCapture* cap, uint32_t epoch) {
    if (!s_view || !cap) return;

    volatile LONG* seq = reinterpret_cast<volatile LONG*>(
        static_cast<char*>(s_view) + offsetof(LiveState, captureSeqCounter));

    // seq → odd: write in progress; host reader must retry.
    InterlockedIncrement(seq);

    LiveState* ls = static_cast<LiveState*>(s_view);
    ls->captureEpoch      = epoch;                 // published inside the seqlock span
    ls->captureBuildingId = cap->buildingId;
    std::memcpy(ls->captureOriginalO2p, cap->originalO2p, sizeof(ls->captureOriginalO2p));
    std::memcpy(ls->captureNewO2p,      cap->newO2p,      sizeof(ls->captureNewO2p));
    // strncpy-with-guaranteed-NUL into the fixed 256-byte slots.
    std::memcpy(ls->captureDecorationTemplate, cap->decorationTemplate, sizeof(ls->captureDecorationTemplate));
    ls->captureDecorationTemplate[sizeof(ls->captureDecorationTemplate) - 1] = '\0';
    std::memcpy(ls->captureBuildingTemplate, cap->buildingTemplate, sizeof(ls->captureBuildingTemplate));
    ls->captureBuildingTemplate[sizeof(ls->captureBuildingTemplate) - 1] = '\0';
    // captureKind/captureCellName (05.1-03, D-01/C8) — non-contiguous with the fields above
    // (offset 1308/1312 vs 768), but MUST land inside this SAME seqlock span, not a separate
    // unlocked write, so a torn read across the offset gap is impossible.
    ls->captureKind = cap->kind;
    std::memcpy(ls->captureCellName, cap->cellName, sizeof(ls->captureCellName));
    ls->captureCellName[sizeof(ls->captureCellName) - 1] = '\0';

    // seq → even: write complete; host reader may proceed.
    InterlockedIncrement(seq);
}

// ---------------------------------------------------------------------------
// channelReadRebind — agent-side seqlock retry-read of the REBIND region
// ---------------------------------------------------------------------------

bool channelReadRebind(DecorationRebind* out) {
    if (!s_view || !out) return false;

    volatile LONG* seq = reinterpret_cast<volatile LONG*>(
        static_cast<char*>(s_view) + offsetof(LiveState, rebindSeqCounter));

    // Step 1 — odd seq means the host is mid-write; skip this read.
    LONG seq1 = *seq;
    if ((seq1 & 1) != 0) return false;

    const LiveState* ls = static_cast<const LiveState*>(s_view);
    out->epoch      = ls->rebindEpoch;
    out->flags      = ls->rebindFlags;
    out->buildingId = ls->rebindBuildingId;
    std::memcpy(out->derivedTemplate, ls->rebindDerivedTemplate, sizeof(out->derivedTemplate));
    out->derivedTemplate[sizeof(out->derivedTemplate) - 1] = '\0';

    // Step 2 — torn-read check; reject if seq changed during our read.
    LONG seq2 = *seq;
    return seq1 == seq2;
}

// ---------------------------------------------------------------------------
// channelWriteResult — agent publishes the rebind outcome (single words)
// ---------------------------------------------------------------------------

void channelWriteResult(int32_t code, uint32_t epoch) {
    if (!s_view) return;

    volatile LONG* codePtr = reinterpret_cast<volatile LONG*>(
        static_cast<char*>(s_view) + offsetof(LiveState, resultCode));
    volatile LONG* epochPtr = reinterpret_cast<volatile LONG*>(
        static_cast<char*>(s_view) + offsetof(LiveState, resultEpoch));

    // code BEFORE epoch: the host reads code only once epoch matches the epoch it awaits,
    // so publishing epoch last guarantees a matching-epoch host read sees this code.
    InterlockedExchange(codePtr, static_cast<LONG>(code));
    InterlockedExchange(epochPtr, static_cast<LONG>(epoch));
}

// ---------------------------------------------------------------------------
// channelClose — unmap and release the file-mapping handle
// ---------------------------------------------------------------------------

void channelClose() {
    if (s_view) { UnmapViewOfFile(s_view); s_view = nullptr; }
    if (s_hMap) { CloseHandle(s_hMap);     s_hMap = nullptr; }
}
