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
 * TWO INDEPENDENT SEQLOCK REGIONS in ONE named file-mapping (05-01, D-02):
 * the pre-existing agent-to-host READ FRAME (seqCounter @ 0, payload through
 * focusToken @ 320) and a NEW host-to-agent COMMAND region (cmdSeqCounter @
 * 324, payload through cmdFlags @ 388). There is deliberately NO second
 * CreateFileMappingA call anywhere in the codebase (mirrors 05-RESEARCH.md
 * "Anti-Patterns to Avoid") — one struct, two independently-seqlocked spans.
 * guardStatus/guardAddr are agent-authoritative single aligned words (no
 * seqlock needed — a torn read of one stale-but-valid word is harmless).
 *
 * Layout (must match LIVE_CHANNEL_LAYOUT in @swg/contracts/live-inject.ts):
 *   seqCounter:    offset   0 (LONG,        4 bytes)  — read-frame seqlock
 *   transform:     offset   4 (float[3][4], 48 bytes — row-major)
 *   networkId:     offset  52 (uint64_t,    8 bytes)
 *   templateName:  offset  60 (char[256],   null-terminated ASCII)
 *   liveness:      offset 316 (uint32_t,    4 bytes — bit0=playerNonNull, bit1=isOver)
 *   focusToken:    offset 320 (uint32_t,    4 bytes — ROUND 5, part of read frame)
 *   cmdSeqCounter: offset 324 (LONG,        4 bytes)  — command-region seqlock
 *   cmdTransform:  offset 328 (float[3][4], 48 bytes — row-major)
 *   cmdScale:      offset 376 (float[3],    12 bytes)
 *   cmdFlags:      offset 388 (uint32_t,    4 bytes)
 *   guardStatus:   offset 392 (uint32_t,    4 bytes — agent-authoritative, no seqlock)
 *   guardAddr:     offset 396 (uint32_t,    4 bytes — agent-authoritative, no seqlock)
 *   TOTAL:                400 bytes
 *
 * LIVE_READFRAME_BYTES (320) is the span channelWrite copies every tick —
 * transform + networkId + templateName + liveness + focusToken. It is a
 * NAMED CONSTANT, not sizeof(LiveState) arithmetic, so growing LiveState for
 * the command slot can never silently widen channelWrite's copy span into the
 * command region (T-05-01).
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
    // --- Read frame (agent -> host), covered by seqCounter's seqlock ---
    LONG      seqCounter;        // offset   0
    float     transform[3][4];   // offset   4
    uint64_t  networkId;         // offset  52
    char      templateName[256]; // offset  60
    uint32_t  liveness;          // offset 316  — bit0=playerNonNull, bit1=isOver
    uint32_t  focusToken;        // offset 320  — ROUND 5: agent's truncated addrOf(focus)

    // --- Command region (host -> agent), covered by cmdSeqCounter's seqlock ---
    LONG      cmdSeqCounter;     // offset 324
    float     cmdTransform[3][4];// offset 328
    float     cmdScale[3];       // offset 376
    uint32_t  cmdFlags;          // offset 388  — LIVE_CMD_FLAGS bits

    // --- Agent-authoritative single-word status (no seqlock needed) ---
    uint32_t  guardStatus;       // offset 392  — LIVE_GUARD_FLAGS bits
    uint32_t  guardAddr;         // offset 396  — x86 ptr of last write-guard-checked object

    // --- Decoration-persist CAPTURE region (agent -> host), seqlocked by captureSeqCounter.
    //     Discrete-event (Live World Editor model D): the agent bumps captureEpoch once per
    //     "Persist" click. Mirrors LIVE_DECORATION_LAYOUT in @swg/contracts/live-inject.ts. ---
    LONG      captureSeqCounter;         // offset  400
    uint32_t  captureEpoch;              // offset  404  — monotonic; 0 = nothing captured
    uint64_t  captureBuildingId;         // offset  408  — .ws node id (collideScreenRay hit)
    float     captureOriginalO2p[3][4];  // offset  416  — o2p at pick time
    float     captureNewO2p[3][4];       // offset  464  — o2p after the move
    char      captureDecorationTemplate[256]; // offset 512
    char      captureBuildingTemplate[256];   // offset 768

    // --- Decoration-persist REBIND region (host -> agent), seqlocked by rebindSeqCounter ---
    LONG      rebindSeqCounter;          // offset 1024
    uint32_t  rebindEpoch;               // offset 1028  — echoes captureEpoch being answered
    uint32_t  rebindFlags;               // offset 1032  — LIVE_DECORATION_REBIND_FLAGS bits
    uint64_t  rebindBuildingId;          // offset 1036  — cross-check vs captureBuildingId
    char      rebindDerivedTemplate[256];// offset 1044  — wsSetNodeTemplateName arg

    // --- Decoration-persist RESULT (agent -> host), single aligned words (no seqlock) ---
    uint32_t  resultCode;                // offset 1300  — LIVE_DECORATION_RESULT; written FIRST
    uint32_t  resultEpoch;               // offset 1304  — echoes applied epoch; published LAST
};
#pragma pack(pop)

static constexpr size_t LIVE_STATE_BYTE_SIZE = sizeof(LiveState);

/** Span (bytes) channelWrite copies every tick — transform through focusToken.
 *  Named constant (not sizeof(LiveState) arithmetic) — see file header. */
static constexpr size_t LIVE_READFRAME_BYTES = 320;

// ---------------------------------------------------------------------------
// Command / guard flag constants (mirror LIVE_CMD_FLAGS / LIVE_GUARD_FLAGS
// in @swg/contracts/live-inject.ts exactly)
// ---------------------------------------------------------------------------

static constexpr uint32_t CMD_FLAG_STOP_REQUESTED    = 0x1;
static constexpr uint32_t CMD_FLAG_REBASELINE_GUARD  = 0x2;

static constexpr uint32_t GUARD_FLAG_TRANSFORM_REFUSED = 0x1;
static constexpr uint32_t GUARD_FLAG_SCALE_REFUSED      = 0x2;
static constexpr uint32_t GUARD_FLAG_STOPPING           = 0x4;

// Decoration-persist rebind flags / result codes (mirror LIVE_DECORATION_REBIND_FLAGS /
// LIVE_DECORATION_RESULT in @swg/contracts/live-inject.ts exactly).
static constexpr uint32_t DECO_REBIND_FLAG_APPLY = 0x1;
static constexpr uint32_t DECO_REBIND_FLAG_ABORT = 0x2;

static constexpr int32_t DECO_RESULT_OK                   = 0;
static constexpr int32_t DECO_RESULT_SAVE_NO_SNAPSHOT     = 1;
static constexpr int32_t DECO_RESULT_SAVE_NO_LOOSE_PATH   = 2;
static constexpr int32_t DECO_RESULT_SAVE_SHADOWED        = 3;
static constexpr int32_t DECO_RESULT_SAVE_ID_OVERFLOW     = 4;
static constexpr int32_t DECO_RESULT_SAVE_INTEGRITY       = 5;
static constexpr int32_t DECO_RESULT_SAVE_WRITE_FAILURE   = 6;
static constexpr int32_t DECO_RESULT_NODE_NOT_FOUND       = -1;
static constexpr int32_t DECO_RESULT_BUILDING_ID_MISMATCH = -2;
static constexpr int32_t DECO_RESULT_ABORTED              = -3;
static constexpr int32_t DECO_RESULT_NOT_A_WS_NODE        = -4;

// ---------------------------------------------------------------------------
// LiveCommand — plain-data snapshot of one command-region read
// ---------------------------------------------------------------------------

struct LiveCommand {
    float    transform[3][4];
    float    scale[3];
    uint32_t flags;
};

// ---------------------------------------------------------------------------
// Decoration-persist plain-data snapshots (model D round trip)
// ---------------------------------------------------------------------------

/** One captured decoration move the agent publishes to the CAPTURE region. */
struct DecorationCapture {
    uint64_t buildingId;
    float    originalO2p[3][4];
    float    newO2p[3][4];
    char     decorationTemplate[256];
    char     buildingTemplate[256];
};

/** One rebind directive the agent reads from the REBIND region. */
struct DecorationRebind {
    uint32_t epoch;
    uint32_t flags;              // DECO_REBIND_FLAG_*
    uint64_t buildingId;
    char     derivedTemplate[256];
};

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
 * channelWrite — seqlock write of a LiveState read-frame snapshot into the
 * mapped view. Copies exactly LIVE_READFRAME_BYTES bytes (transform through
 * focusToken) — never reaches into the command region.
 * Sequence: InterlockedIncrement (seq→odd) → memcpy payload → InterlockedIncrement (seq→even).
 * Host reader: read seq, read payload, read seq again; retry if odd or changed (torn read).
 */
void channelWrite(const LiveState* state);

/**
 * channelReadCommand — agent-side seqlock retry-read of the command region
 * (cmdSeqCounter, cmdTransform, cmdScale, cmdFlags). Mirrors the read-side
 * retry idiom the RENDERER already uses in useChannelReader.ts's
 * parseChannelView, applied here in C++ against the SAME mapped view.
 * Returns false on torn/mid-write read (out param left untouched); the
 * caller should simply retry on the next poll iteration, never block.
 * outCmdSeq receives the seq value observed at a successful (non-torn) read,
 * so the caller can detect a NEW command vs. re-reading the same one.
 */
bool channelReadCommand(LiveCommand* out, uint32_t* outCmdSeq);

/**
 * channelWriteGuardStatus — agent writes its own guard outcome AND the
 * checked object's address back. Both are single aligned uint32 words,
 * written via InterlockedExchange — no seqlock needed since each is
 * independently a single aligned 32-bit word and a torn read of one
 * stale-but-valid word is harmless (the renderer already tolerates reading
 * guardStatus without a seqlock per the original plan).
 */
void channelWriteGuardStatus(uint32_t flags, uint32_t addr);

/**
 * channelWriteCapture — seqlock write of one captured decoration move into the CAPTURE
 * region, then publish `epoch` (inside the same seqlock span) so the host processes each
 * capture exactly once. Sequence: captureSeq→odd → write epoch+payload → captureSeq→even.
 * The agent calls this once per "Persist" click with a monotonically increasing epoch.
 */
void channelWriteCapture(const DecorationCapture* cap, uint32_t epoch);

/**
 * channelReadRebind — agent-side seqlock retry-read of the REBIND region (same idiom as
 * channelReadCommand). Returns false on a torn/mid-write read (out left untouched — retry
 * next poll). The caller applies each NEW out->epoch once (compare to last-applied).
 */
bool channelReadRebind(DecorationRebind* out);

/**
 * channelWriteResult — agent publishes the rebind outcome. resultCode is written FIRST,
 * resultEpoch LAST (code-before-epoch: the host reads code only once epoch matches the epoch
 * it awaits). Single aligned words via InterlockedExchange — no seqlock (GUARD_STATUS
 * discipline: a torn read of one stale-but-valid word is harmless).
 */
void channelWriteResult(int32_t code, uint32_t epoch);

/**
 * channelClose — unmap the view and release the file-mapping handle.
 */
void channelClose();
