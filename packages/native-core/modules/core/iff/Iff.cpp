/**
 * modules/core/iff/Iff.cpp — Engine-free C++20 IFF FORM/chunk parser and serializer.
 *
 * PRIMARY PORT SOURCE:
 *   swg-client-v2 sharedFile/Iff.cpp:56-84    calculateRawDataSize / stack model
 *   swg-client-v2 sharedFile/Iff.cpp:508-555  BE read (getFirstTag/getLength/getSecondTag)
 *   swg-client-v2 sharedFile/Iff.cpp:637-644  htonl write (FORM innerLen + sizeof(Tag))
 *   swg-client-v2 sharedFile/Iff.cpp:713      htonl write (chunk length)
 *   swg-client-v2 sharedFile/Iff.cpp:1076-1095 FORM discriminator (isCurrentForm/Chunk)
 *   swg-client-v2 sharedFile/Iff.cpp:1132-1310 walk (enterForm/enterChunk/exitForm/exitChunk)
 *   swg-client-v2 sharedFile/Iff.cpp:419-429   verbatim write (byte-exact serialize)
 *
 * SECONDARY / CROSS-CHECK:
 *   Utinni IffReader.cs:140-210   FourCC validation, bounds checks, nested-overflow reject
 *   Utinni IffReader.cs:307-327   DETECT-pad rule (consume 0x00 only when present)
 *   Utinni IffWriter.cs:98-187    Hybrid-DOM verbatim re-emit, NO pad on write
 *   Utinni IffWriter.cs:141       Emit NO trailing pad byte (SWG no-pad quirk)
 *
 * TOOLKIT INVENTIONS (clearly labelled — not ported from client):
 *   - [TOOLKIT] Trailing-bytes node: swg-client-v2 calculateRawDataSize (Iff.cpp:63-84)
 *     assumes trailing non-IFF bytes are zeroed and does NOT surface them. We add an
 *     explicit IffTrailingInfo so bytes after the last top-level block are never dropped.
 *   - [TOOLKIT] Generic-viewer container set: 'LIST' and 'CAT ' are also recognised as
 *     containers. The client's isCurrentForm checks only TAG_FORM (Iff.cpp:1076).
 *
 * KEY BYTE-LAYOUT FACTS (verified; do NOT re-derive):
 *   - ALL tags + lengths are BIG-ENDIAN (ntohl on read, htonl on write).
 *   - Block framing: [tag 4B][BE uint32 length 4B][payload]
 *   - FORM header = 12B: tag(4) + length(4) + subTypeTag(4)
 *     innerLen for a FORM INCLUDES the 4-byte subtype (Iff.cpp:643: +sizeof(Tag))
 *   - Leaf header = 8B: tag(4) + length(4); length = payload only (excl header)
 *   - FORM discriminator: firstTag == 'FORM' (also LIST, CAT  for generic viewer)
 *   - WRITE emits NO pad byte; READ DETECTS pad (consume 0x00 only if present)
 *   - Clean-span verbatim re-emit: capturedSlice covers FULL declared span (incl. gaps)
 *
 * Decision D-02: C++20, engine-free.
 */

#include "Iff.h"

#include <cstring>
#include <sstream>
#include <iomanip>
#include <cassert>
#include <algorithm>

// On Windows WinSock2 provides ntohl/htonl; on POSIX, arpa/inet.h.
// For portability in the engine-free lib, implement our own inline BE helpers.
// This avoids the platform-specific header dance and makes the intent explicit.
// Source for BE convention: Iff.cpp:508-555 (ntohl), Iff.cpp:637-643 (htonl).

namespace swg_core {
namespace iff {

// ─── Big-endian helpers ───────────────────────────────────────────────────────

/**
 * Read a 4-byte big-endian unsigned integer from ptr.
 * Equivalent to ntohl() in the client source (Iff.cpp:508-555).
 */
static inline uint32_t readBe32(const uint8_t* ptr) noexcept {
    return (static_cast<uint32_t>(ptr[0]) << 24) |
           (static_cast<uint32_t>(ptr[1]) << 16) |
           (static_cast<uint32_t>(ptr[2]) <<  8) |
            static_cast<uint32_t>(ptr[3]);
}

/**
 * Write a 4-byte big-endian unsigned integer to ptr.
 * Equivalent to htonl() in the client source (Iff.cpp:637,643,713).
 */
static inline void writeBe32(uint8_t* ptr, uint32_t v) noexcept {
    ptr[0] = static_cast<uint8_t>((v >> 24) & 0xFF);
    ptr[1] = static_cast<uint8_t>((v >> 16) & 0xFF);
    ptr[2] = static_cast<uint8_t>((v >>  8) & 0xFF);
    ptr[3] = static_cast<uint8_t>( v        & 0xFF);
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────

static constexpr uint32_t MAKE_TAG(char a, char b, char c, char d) noexcept {
    return (static_cast<uint32_t>(static_cast<uint8_t>(a)) << 24) |
           (static_cast<uint32_t>(static_cast<uint8_t>(b)) << 16) |
           (static_cast<uint32_t>(static_cast<uint8_t>(c)) <<  8) |
            static_cast<uint32_t>(static_cast<uint8_t>(d));
}

static constexpr uint32_t TAG_FORM = MAKE_TAG('F','O','R','M');
static constexpr uint32_t TAG_LIST = MAKE_TAG('L','I','S','T');
static constexpr uint32_t TAG_CAT  = MAKE_TAG('C','A','T',' ');

/**
 * True if the numeric tag value indicates a container block.
 * Client source: Iff.cpp:1076-1095 (isCurrentForm checks TAG_FORM only).
 * [TOOLKIT] We also recognise TAG_LIST and TAG_CAT for the generic viewer.
 * PROP is a leaf even though it could be considered meta-container in some formats.
 */
static inline bool isContainerTag(uint32_t tagVal) noexcept {
    return tagVal == TAG_FORM || tagVal == TAG_LIST || tagVal == TAG_CAT;
}

/** Convert a 4-byte uint32 tag value (already in host byte order) to a 4-char string. */
static inline void tagToChars(uint32_t tagVal, char out[5]) noexcept {
    out[0] = static_cast<char>((tagVal >> 24) & 0xFF);
    out[1] = static_cast<char>((tagVal >> 16) & 0xFF);
    out[2] = static_cast<char>((tagVal >>  8) & 0xFF);
    out[3] = static_cast<char>( tagVal        & 0xFF);
    out[4] = '\0';
}

/** Convert a 4-char string to a uint32 tag value. */
static inline uint32_t charsToTag(const char* t) noexcept {
    return (static_cast<uint32_t>(static_cast<uint8_t>(t[0])) << 24) |
           (static_cast<uint32_t>(static_cast<uint8_t>(t[1])) << 16) |
           (static_cast<uint32_t>(static_cast<uint8_t>(t[2])) <<  8) |
            static_cast<uint32_t>(static_cast<uint8_t>(t[3]));
}

// ─── Security caps ─────────────────────────────────────────────────────────────

static constexpr uint32_t MAX_CHUNK_SIZE = 64u * 1024u * 1024u; // 64 MB (T-01-12)

/**
 * Validate that all 4 FourCC bytes are printable ASCII 0x20–0x7E.
 * Source: Utinni IffReader.cs:150-158 (T-01-11).
 */
static void validateFourCC(uint32_t tagVal, uint32_t offset) {
    for (int i = 3; i >= 0; --i) {
        uint8_t b = static_cast<uint8_t>((tagVal >> (i * 8)) & 0xFF);
        if (b < 0x20 || b > 0x7E) {
            std::ostringstream ss;
            ss << "non-printable FourCC byte 0x"
               << std::hex << std::uppercase << std::setfill('0') << std::setw(2)
               << static_cast<int>(b)
               << " at offset 0x" << std::setw(4) << offset;
            throw IffParseError(ss.str());
        }
    }
}

// ─── Recursive node parser ────────────────────────────────────────────────────

/**
 * Parse one block (FORM or leaf) starting at data[pos], within the window
 * [pos, parentEnd).  parentEnd is an absolute offset.
 *
 * Source: swg-client-v2 Iff.cpp:508-555, 1076-1095, 1132-1310.
 * Cross-check: Utinni IffReader.cs:140-210.
 */
static IffNode parseBlock(const uint8_t* data,
                           uint32_t      pos,
                           uint32_t      parentEnd,
                           uint32_t      totalSize,
                           bool          isTopLevel) {
    const uint32_t blockStart = pos;

    // Need at least 8 bytes for tag + length.
    if (pos + 8 > parentEnd) {
        std::ostringstream ss;
        ss << "truncated block header at offset 0x" << std::hex << pos;
        throw IffParseError(ss.str());
    }

    // Read tag (big-endian, ntohl-style) — Iff.cpp:508-523.
    const uint32_t tagVal = readBe32(data + pos);
    pos += 4;

    // Validate FourCC — Utinni IffReader.cs:150-158 (T-01-11).
    validateFourCC(tagVal, blockStart);

    // Read declared length (big-endian) — Iff.cpp:533-541.
    const uint32_t declLen = readBe32(data + pos);
    pos += 4;

    // Cap check (T-01-12) — Utinni IffReader.cs:174-195.
    if (declLen > MAX_CHUNK_SIZE) {
        std::ostringstream ss;
        ss << "chunk length 0x" << std::hex << declLen
           << " at offset 0x" << blockStart << " exceeds 64 MB cap";
        throw IffParseError(ss.str());
    }

    // Nested-overflow check (T-01-10) — Utinni IffReader.cs:185-195.
    // For a top-level block: its declared end (pos + declLen) may equal totalSize
    // (byte-tight file), but must not exceed it.
    {
        const uint64_t declaredEnd = static_cast<uint64_t>(pos) + declLen;
        const uint64_t limit       = isTopLevel
                                       ? static_cast<uint64_t>(totalSize)
                                       : static_cast<uint64_t>(parentEnd);
        if (declaredEnd > limit) {
            std::ostringstream ss;
            ss << "chunk declared end 0x" << std::hex << declaredEnd
               << " exceeds " << (isTopLevel ? "file" : "parent") << " end 0x"
               << limit << " at offset 0x" << blockStart;
            throw IffParseError(ss.str());
        }
    }

    IffNode node;
    node.byteOffset = blockStart;
    node.declaredLength = declLen;
    tagToChars(tagVal, node.tag);

    if (isContainerTag(tagVal)) {
        // ── Container (FORM / LIST / CAT ) ───────────────────────────────────
        node.isForm = true;

        // Need 4 more bytes for the sub-type tag.
        if (pos + 4 > parentEnd) {
            std::ostringstream ss;
            ss << "truncated subType at offset 0x" << std::hex << pos;
            throw IffParseError(ss.str());
        }

        // Read sub-type tag — Iff.cpp:546-555 (getSecondTag via ntohl).
        const uint32_t subTypeVal = readBe32(data + pos);
        validateFourCC(subTypeVal, pos);
        tagToChars(subTypeVal, node.subType);
        pos += 4;

        // The child span is declLen - 4 (the 4 subtype bytes are already consumed
        // by the innerLen count). Source: Iff.cpp:1144 (s.length = getLength - sizeof(Tag)).
        const uint32_t childSpanLen = (declLen >= 4) ? (declLen - 4) : 0;
        const uint32_t childEnd     = blockStart + 8 + declLen; // = pos + childSpanLen

        // Parse children within [pos, childEnd).
        while (pos < childEnd) {
            // Guard: need at least 8 bytes for a child header.
            if (pos + 8 > childEnd) {
                // Remaining bytes are interior padding/gap — stop parsing children.
                // The capturedSlice will absorb them verbatim (clean-span guarantee).
                break;
            }
            // Quick peek: is there enough data for a full child?
            const uint32_t childTagVal   = readBe32(data + pos);
            const uint32_t childDeclLen  = readBe32(data + pos + 4);
            (void)childTagVal;
            // Compute child end; if it exceeds childEnd, stop (gap case).
            const uint32_t childBodyEnd  = pos + 8 + childDeclLen;
            if (childBodyEnd > childEnd) {
                // childDeclLen extends into the gap — treat the rest as a gap.
                break;
            }
            node.children.push_back(parseBlock(data, pos, childEnd, totalSize, false));
            // Advance pos by the size the child actually consumed.
            // The child's header + declaredLength (for leaf) or innerLen + 8 (for container).
            // Simplest: walk by what we know from the child we just parsed.
            const IffNode& child = node.children.back();
            if (child.isForm) {
                // Container: 8 (hdr) + declLen
                pos = child.byteOffset + 8 + child.declaredLength;
            } else {
                // Leaf: 8 (hdr) + declLen; then DETECT a single 0x00 pad byte if odd len.
                // Source: Utinni IffReader.cs:307-327.
                pos = child.byteOffset + 8 + child.declaredLength;
                if ((child.declaredLength % 2) == 1 && pos < childEnd) {
                    if (data[pos] == 0x00) {
                        ++pos; // consume the actual pad byte
                    }
                    // else: next byte is a TypeID (printable ASCII) — leave it alone.
                }
            }
        }

        // Capture the FULL declared span (tag + length + innerLen bytes).
        // This is the whole slice from the block start through blockStart+8+declLen.
        // It includes any interior gap between the last child and the declared end.
        const uint32_t sliceEnd = blockStart + 8 + declLen;
        if (sliceEnd <= totalSize) {
            node.capturedSlice.assign(data + blockStart, data + sliceEnd);
        }

    } else {
        // ── Leaf ─────────────────────────────────────────────────────────────
        node.isForm = false;

        // Capture slice: full header (8B) + payload (declLen bytes).
        const uint32_t sliceEnd = blockStart + 8 + declLen;
        if (sliceEnd <= totalSize) {
            node.capturedSlice.assign(data + blockStart, data + sliceEnd);
        }

        // PAD DETECT — do NOT advance pos here; the caller handles pad after each leaf.
        // (Container loop above handles the pad step after calling parseBlock for a child.)
    }

    return node;
}

// ─── Public: parseIff ─────────────────────────────────────────────────────────

IffParseResult parseIff(const uint8_t* data, uint32_t size) {
    if (!data || size == 0) {
        throw IffParseError("empty or null IFF buffer");
    }

    IffParseResult result;
    uint32_t pos = 0;

    while (pos < size) {
        // Need at least 8 bytes for a top-level header.
        if (pos + 8 > size) {
            // Remaining bytes can't form a valid block — treat as trailing.
            break;
        }

        // Peek at the tag to see if it's plausibly IFF.
        const uint32_t tagVal = readBe32(data + pos);
        // Quick printability check to avoid wasting work on trailing zeroes etc.
        bool printable = true;
        for (int i = 3; i >= 0; --i) {
            uint8_t b = static_cast<uint8_t>((tagVal >> (i * 8)) & 0xFF);
            if (b < 0x20 || b > 0x7E) { printable = false; break; }
        }
        if (!printable) {
            // Non-printable tag at top level — trailing bytes start here.
            break;
        }

        const uint32_t blockStart = pos;
        IffNode node = parseBlock(data, pos, size, size, /*isTopLevel=*/true);

        // Advance past this top-level block.
        pos = blockStart + 8 + node.declaredLength;

        result.roots.push_back(std::move(node));
    }

    if (result.roots.empty()) {
        throw IffParseError("no valid IFF block found at offset 0x0000");
    }

    // [TOOLKIT] Trailing-bytes detection.
    // Source: NOT ported — the client's calculateRawDataSize (Iff.cpp:63-84) only
    // zeroes/ignores trailing data. We surface them explicitly.
    if (pos < size) {
        result.trailingBytes.offset = pos;
        result.trailingBytes.count  = size - pos;
    }

    return result;
}

// ─── Internal: serialize one node ─────────────────────────────────────────────

/**
 * Serialize one IffNode into output, appending bytes.
 * Hybrid-DOM: clean node → capturedSlice verbatim; dirty → re-serialize.
 * Source: Utinni IffWriter.cs:98-187, IffWriter.cs:141 (no pad on write).
 */
static void serializeNode(const IffNode& node, std::vector<uint8_t>& out) {
    if (node.isClean && !node.capturedSlice.empty()) {
        // Verbatim re-emit — Utinni IffWriter.cs:103-110.
        // This reproduces the FULL declared span including any interior gap.
        out.insert(out.end(), node.capturedSlice.begin(), node.capturedSlice.end());
        return;
    }

    // Dirty path: re-serialize from the node fields.
    const uint32_t tagVal = charsToTag(node.tag);

    if (node.isForm) {
        // Container re-serialization.
        // Serialize children first into a temp buffer (need total size for innerLen).
        std::vector<uint8_t> childBuf;
        for (const auto& child : node.children) {
            serializeNode(child, childBuf);
        }

        // innerLen = 4 (subType) + childBuf.size()
        // Source: Iff.cpp:643 (innerLen includes sizeof(Tag) for subType).
        const uint32_t innerLen = static_cast<uint32_t>(4 + childBuf.size());

        uint8_t header[12];
        writeBe32(header + 0, tagVal);        // tag
        writeBe32(header + 4, innerLen);      // BE innerLen
        writeBe32(header + 8, charsToTag(node.subType)); // subType tag

        out.insert(out.end(), header, header + 12);
        out.insert(out.end(), childBuf.begin(), childBuf.end());

    } else {
        // Leaf re-serialization.
        // Source: Iff.cpp:712-715; no pad byte emitted (IffWriter.cs:141).
        std::vector<uint8_t> payload;
        if (!node.capturedSlice.empty() && node.capturedSlice.size() >= 8) {
            // Extract payload from existing capturedSlice (dirty but slice still valid).
            payload.assign(node.capturedSlice.begin() + 8, node.capturedSlice.end());
        }

        const uint32_t payloadLen = static_cast<uint32_t>(payload.size());

        uint8_t header[8];
        writeBe32(header + 0, tagVal);     // tag
        writeBe32(header + 4, payloadLen); // BE payload length

        out.insert(out.end(), header, header + 8);
        if (!payload.empty()) {
            out.insert(out.end(), payload.begin(), payload.end());
        }
        // NO trailing pad byte — IffWriter.cs:141 (SWG no-pad quirk).
    }
}

// ─── Public: serializeIff ─────────────────────────────────────────────────────

std::vector<uint8_t> serializeIff(const IffParseResult& result,
                                   const uint8_t* srcBuf,
                                   uint32_t srcSize) {
    std::vector<uint8_t> out;
    out.reserve(256);

    for (const auto& root : result.roots) {
        serializeNode(root, out);
    }

    // [TOOLKIT] Append trailing bytes verbatim.
    if (result.trailingBytes.count > 0 && srcBuf &&
        result.trailingBytes.offset + result.trailingBytes.count <= srcSize) {
        const uint8_t* tb = srcBuf + result.trailingBytes.offset;
        out.insert(out.end(), tb, tb + result.trailingBytes.count);
    }

    return out;
}

// ─── Public: getNodeBytes ─────────────────────────────────────────────────────

// Pre-order traversal counter helper.
static bool collectNodeAtIndex(const IffNode& node, uint32_t target, uint32_t& current,
                                std::vector<uint8_t>& out) {
    if (current == target) {
        out = node.capturedSlice;
        return true;
    }
    ++current;
    if (node.isForm) {
        for (const auto& child : node.children) {
            if (collectNodeAtIndex(child, target, current, out)) return true;
        }
    }
    return false;
}

std::vector<uint8_t> getNodeBytes(const IffParseResult& result, uint32_t nodeIndex) {
    uint32_t current = 0;
    std::vector<uint8_t> out;
    for (const auto& root : result.roots) {
        if (collectNodeAtIndex(root, nodeIndex, current, out)) return out;
    }
    throw std::out_of_range("IFF node index out of range: " + std::to_string(nodeIndex));
}

} // namespace iff
} // namespace swg_core
