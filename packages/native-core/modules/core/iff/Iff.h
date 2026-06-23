/**
 * modules/core/iff/Iff.h — Engine-free C++20 IFF FORM/chunk parser and serializer.
 *
 * PORT SOURCE (primary):
 *   swg-client-v2 sharedFile/Iff.cpp:56-84  (calculateRawDataSize / stack model)
 *   swg-client-v2 sharedFile/Iff.cpp:508-555 (BE read via ntohl — getFirstTag/getLength/getSecondTag)
 *   swg-client-v2 sharedFile/Iff.cpp:637-644,713 (htonl write — FORM len + sizeof(Tag))
 *   swg-client-v2 sharedFile/Iff.cpp:1076-1095 (FORM discriminator — isCurrentForm)
 *   swg-client-v2 sharedFile/Iff.cpp:1132-1310 (walk — enterForm/enterChunk/exitForm/exitChunk)
 *
 * CROSS-CHECK (Utinni):
 *   Utinni IffReader.cs:140-210  (FourCC validation, bounds, nested overflow)
 *   Utinni IffReader.cs:307-327  (pad-byte DETECT rule)
 *   Utinni IffWriter.cs:98-187   (hybrid-DOM verbatim re-emit, no pad on write)
 *
 * TOOLKIT INVENTIONS (NOT ported from client):
 *   - Trailing-bytes node: the real client's calculateRawDataSize (Iff.cpp:63-84) only
 *     computes the used IFF size and assumes trailing data is zeroed; it does NOT surface
 *     a trailing-bytes node. We add an explicit IffTrailingInfo when bytes exist beyond the
 *     last top-level block so they are never silently dropped.
 *   - IffNode subType/children JSON serialization for the N-API binding.
 *   - Generic-viewer container set: LIST and 'CAT ' are also recognised as containers
 *     (the client only checks TAG_FORM; we extend for the SIE-successor viewer).
 *
 * KEY GROUND-TRUTH FACTS (verified against source, do NOT re-derive):
 *   - Block framing: [4-byte Tag BE][4-byte BE uint32 length][payload]
 *   - FORM header = 12 bytes: tag(4) + length(4) + subTypeTag(4)
 *     innerLen for a FORM INCLUDES the 4-byte subtype (Iff.cpp:643 writes +sizeof(Tag))
 *   - Leaf header = 8 bytes: tag(4) + length(4); length is payload ONLY (excl header)
 *   - FORM discriminator: first tag == 'FORM' (Iff.cpp:1076-1095)
 *   - Generic viewer also treats 'LIST' and 'CAT ' as containers; 'PROP' is a leaf
 *   - PAD (relabelled): WRITE emits NO pad byte; READ DETECTS a 0x00 pad (consume it
 *     only when actually present, else leave the next TypeID alone — IffReader.cs:307-327)
 *   - Byte-exact serialize: hybrid-DOM verbatim re-emit — clean node writes capturedSlice
 *     verbatim (full declared span, incl. interior gaps); only a dirty node reserializes
 *   - Security caps: per-chunk <= 64 MB; reject childEnd > parentEnd; reject non-printable
 *     FourCC (IffReader.cs:150-158, 174-195)
 *
 * Decision D-02: C++20, engine-free (no N-API, no SOE engine headers).
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include <span>

namespace swg_core {
namespace iff {

// ─── IFF error ─────────────────────────────────────────────────────────────────

/**
 * Thrown when the parser encounters invalid IFF data.
 * The message contains the error type and the absolute byte offset.
 */
class IffParseError : public std::runtime_error {
public:
    explicit IffParseError(const std::string& msg) : std::runtime_error(msg) {}
};

// ─── IFF Node ──────────────────────────────────────────────────────────────────

/**
 * A parsed IFF block node.  Holds metadata + the raw byte slice that covers
 * the FULL declared span (the captured slice for hybrid-DOM re-emit).
 *
 * kind == 'form': tag is 'FORM'/'LIST'/'CAT ', subType holds the name tag,
 *                 children holds child IffNodes, declaredLength = innerLen
 *                 (includes the 4-byte subtype).
 * kind == 'leaf': tag is the TypeID, children is empty, declaredLength =
 *                 payload byte count (excluding the 8-byte header).
 */
struct IffNode {
    /** 4-character ASCII tag, null-terminated for convenience. */
    char tag[5] = {};
    /** Sub-type tag for containers (empty for leaves). */
    char subType[5] = {};
    /**
     * Declared inner length (bytes).
     * FORM: innerLen including the 4-byte subType tag (Iff.cpp:643).
     * Leaf: payload length only (excluding the 8-byte header).
     */
    uint32_t declaredLength = 0;
    /** Absolute byte offset of this block's 8-byte header in the source buffer. */
    uint32_t byteOffset = 0;
    /** 'form' or 'leaf' */
    bool isForm = false;
    /** Whether this node is clean (unedited — capturedSlice is valid). */
    bool isClean = true;

    /**
     * Captured byte slice covering the full declared span of this block.
     * For a clean FORM: spans from the tag byte through tag+4+length bytes
     * (the FULL declared length, including any interior padding/gaps).
     * For a clean leaf: spans the full 8-byte header + declaredLength payload.
     * Populated by the parser; used by the serializer for verbatim re-emit.
     */
    std::vector<uint8_t> capturedSlice;

    /** Child nodes (empty for leaves). */
    std::vector<IffNode> children;
};

// ─── Trailing-bytes info ───────────────────────────────────────────────────────

/**
 * Bytes after the last top-level block — NEW TOOLKIT BEHAVIOR.
 *
 * The SWG client's calculateRawDataSize (Iff.cpp:63-84) assumes trailing
 * non-IFF bytes are zeroed out and does NOT surface them. This toolkit
 * explicitly surfaces them as a separate record so they are never silently
 * dropped. Interior gaps within a FORM are handled by capturedSlice, not here.
 */
struct IffTrailingInfo {
    uint32_t offset = 0; ///< Absolute offset of the first trailing byte.
    uint32_t count  = 0; ///< Number of trailing bytes.
};

// ─── Parse result ─────────────────────────────────────────────────────────────

/**
 * Full result of parsing an IFF buffer.
 */
struct IffParseResult {
    /** Top-level FORM/chunk roots (usually one). */
    std::vector<IffNode> roots;
    /**
     * Non-zero count when bytes remain after the last top-level block.
     * Toolkit-invented; set trailingBytes.count == 0 when none.
     */
    IffTrailingInfo trailingBytes;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse an IFF buffer into a tree of IffNodes.
 *
 * Reads big-endian tags + lengths (via readBe32 which applies ntohl-style
 * byte-swap).  Discriminates a FORM by first-tag == 'FORM' (Iff.cpp:1076);
 * also treats 'LIST' and 'CAT ' as containers.
 *
 * Security caps (T-01-11, T-01-12, T-01-10):
 *   - Non-printable FourCC bytes rejected (IffReader.cs:150-158)
 *   - Per-chunk declaredLength > 64 MB rejected (IffReader.cs:174-195)
 *   - childEnd > parentEnd rejected (IffReader.cs:185-195)
 *
 * Pad handling (IffReader.cs:307-327):
 *   Consume a trailing 0x00 byte after an odd-length leaf ONLY when the byte
 *   is actually 0x00 (DETECT-don't-assume).  Never require it.
 *
 * Trailing bytes (toolkit invention):
 *   Bytes after the last top-level block surface in result.trailingBytes.
 *
 * @param data  Pointer to buffer start.
 * @param size  Buffer byte length.
 * @returns     IffParseResult with roots + optional trailingBytes.
 * @throws      IffParseError on any structural violation.
 *
 * Port: swg-client-v2 Iff.cpp:508-555, 1076-1095, 1132-1310.
 * Cross-check: Utinni IffReader.cs:140-210.
 */
IffParseResult parseIff(const uint8_t* data, uint32_t size);

/**
 * Serialize an IFF node tree back to bytes.
 *
 * Hybrid-DOM verbatim re-emit (IffWriter.cs:98-187):
 *   - A clean node (isClean == true) writes its capturedSlice verbatim.
 *     This reproduces the FULL declared span including interior gaps.
 *   - A dirty node reserializes: leaf → tag + BE(length) + payload (NO pad);
 *     container → tag + BE(innerLen) + subType + children bytes.
 *
 * Trailing bytes (from IffParseResult.trailingBytes) are appended verbatim
 * after the last root's bytes.
 *
 * NO pad byte is emitted (IffWriter.cs:141 — SWG no-pad quirk).
 *
 * @param result  The parsed IFF result (roots + trailing bytes).
 * @param srcBuf  Original source buffer (used to extract trailingBytes verbatim).
 * @returns       Serialized bytes.
 *
 * Port: swg-client-v2 Iff.cpp:419-429 (verbatim write).
 * Cross-check: Utinni IffWriter.cs:98-187.
 */
std::vector<uint8_t> serializeIff(const IffParseResult& result,
                                   const uint8_t* srcBuf,
                                   uint32_t srcSize);

/**
 * Extract the raw bytes of a specific IFF node's captured slice.
 *
 * Returns a copy of capturedSlice for the node at the given pre-order index
 * (index 0 = first root, traversal order matches the UI tree order).
 *
 * @param result     Parsed IFF result.
 * @param nodeIndex  Pre-order index of the desired node (0-based).
 * @returns          Byte vector of the captured slice.
 * @throws           std::out_of_range if nodeIndex is out of bounds.
 */
std::vector<uint8_t> getNodeBytes(const IffParseResult& result, uint32_t nodeIndex);

} // namespace iff
} // namespace swg_core
