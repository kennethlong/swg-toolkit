/**
 * TreBuilder.cpp — TRE archive writer implementation (builder primitive, D-04).
 *
 * Ported from:
 *   swg-client-v2 TreeFileBuilder.cpp:558-597  (writeFile)
 *   swg-client-v2 TreeFileBuilder.cpp:601-634  (writeTableOfContents — CRC-FIRST 6-field records)
 *   swg-client-v2 TreeFileBuilder.cpp:638-654  (writeFileNameBlock)
 *   swg-client-v2 TreeFileBuilder.cpp:658-672  (writeMd5Block — numberOfFiles × 16 bytes UNCOMPRESSED)
 *   swg-client-v2 TreeFileBuilder.cpp:676-769  (compressAndWrite — zlib ONLY, try CT_zlib, emit code 0 or 2)
 *   swg-client-v2 TreeFileBuilder.cpp:773-833  (write() — block order + double header write)
 *   swg-client-v2 ZlibCompressor.cpp:169        (deflateInit(&z, Z_DEFAULT_COMPRESSION) — level 6 pinned)
 *   Utinni TreWriter.cs:166-174                 (repack: copy untouched slices VERBATIM, only edit recompresses)
 *
 * MINIZ FORBIDDEN ON WRITE PATH:
 *   miniz cannot reproduce zlib's RFC1950 bitstream — a fresh-compressed block from miniz
 *   will not match a block from zlib level 6 even for the same input. The write path MUST
 *   use the vendored zlib 1.2.3. The read path may fall back to miniz for decompression.
 *
 * MD5 BLOCK:
 *   The MD5 block (numberOfFiles × 16 bytes) is written ALWAYS UNCOMPRESSED.
 *   The reader (TreeFile_SearchNode) ignores the MD5 block, but a self-built deterministic
 *   archive must include it to reproduce the builder's output exactly.
 *   Per TreeFileBuilder.cpp:658-672: for each entry in tocOrder, copy the 16-byte MD5 of the
 *   stored (possibly compressed) payload bytes; for untouched repack entries, use zeroes
 *   (the original MD5 is not exposed by TreArchive; determinism only requires stability
 *   across two builds of the SAME inputs, not identity with the retail MD5 block).
 *
 * DETERMINISM CONTRACT:
 *   Build the same input set twice → byte-identical output. Requires:
 *   (a) response-file payload order (entry order in input vector),
 *   (b) CRC-sorted tocOrder (binary-search precondition),
 *   (c) zlib level Z_DEFAULT_COMPRESSION / wbits 15 / memLevel 8 (pinned),
 *   (d) MD5 block present (16 bytes per entry, uncompressed),
 *   (e) deterministic header re-write (all fields computed before seek-back).
 *   This is build-twice-against-OUR-writer identity, NOT "matches retail bytes".
 */

#include "TreBuilder.h"
#include "Crc.h"
#include "TreMount.h"  // fixUpFileName is in TreMount; we reproduce it inline below
#include <zlib.h>      // Vendored zlib 1.2.3 — MUST be included BEFORE any cmake-js headers
                       // so the vendored 1.2.3 header wins over Node's bundled 1.3.1 zlib.h.
                       // See modules/core/CMakeLists.txt (BEFORE PRIVATE ${SWG_ZLIB_DIR}).
#if !defined(ZLIB_VERNUM) || ZLIB_VERNUM != 0x1230
#  error "TreBuilder.cpp must compile against vendored zlib 1.2.3; got wrong version"
#endif
#include <algorithm>
#include <cstring>
#include <stdexcept>
#include <cstdio>
#include <vector>
#include <string>
#include <unordered_map>

// MINIZ GUARD — static assert that no mz_ / tdefl symbols are defined here.
// If miniz.h were accidentally included upstream, mz_deflate would be defined.
// This file must NEVER pull in miniz (it cannot reproduce zlib's bitstream).
#ifdef MZ_VERSION
#  error "miniz.h must NOT be included on the TreBuilder write path (miniz cannot reproduce zlib's RFC1950 bitstream)"
#endif

namespace swg {

// ─── LE helpers ──────────────────────────────────────────────────────────────

static void writeLE32(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back(static_cast<uint8_t>(v & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 24) & 0xFF));
}

static void patchLE32(std::vector<uint8_t>& out, size_t offset, uint32_t v) {
    out[offset + 0] = static_cast<uint8_t>(v & 0xFF);
    out[offset + 1] = static_cast<uint8_t>((v >> 8) & 0xFF);
    out[offset + 2] = static_cast<uint8_t>((v >> 16) & 0xFF);
    out[offset + 3] = static_cast<uint8_t>((v >> 24) & 0xFF);
}

// ─── fixUpFileName (inline copy for the build path) ──────────────────────────
// Source: swg-client-v2 TreeFile.cpp:511-601 (fixUpFileName).
// TreMount.cpp owns the definitive port; we replicate the logic here to avoid
// a dependency from TreBuilder on TreMount (which owns parsed TreArchive instances).
static std::string fixUpFileName(const std::string& raw) {
    std::string s = raw;
    // lowercase + backslash -> forward slash
    for (char& c : s) {
        if (c == '\\') c = '/';
        else           c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
    }
    // collapse repeated slashes
    {
        std::string out;
        out.reserve(s.size());
        bool lastSlash = false;
        for (char c : s) {
            if (c == '/') {
                if (!lastSlash) out += c;
                lastSlash = true;
            } else {
                out += c;
                lastSlash = false;
            }
        }
        s = std::move(out);
    }
    // strip leading ./
    while (s.size() >= 2 && s[0] == '.' && s[1] == '/')
        s = s.substr(2);
    // strip leading ../
    while (s.size() >= 3 && s[0] == '.' && s[1] == '.' && s[2] == '/')
        s = s.substr(3);
    return s;
}

// ─── zlib RFC1950 compression (WRITE PATH — zlib only, miniz FORBIDDEN) ──────
//
// Source: swg-client-v2 ZlibCompressor.cpp:169 (deflateInit(&z, Z_DEFAULT_COMPRESSION))
//         swg-client-v2 TreeFileBuilder.cpp:682-718 (compressAndWrite — try CT_zlib only)
//
// Pinned parameters:
//   level   = Z_DEFAULT_COMPRESSION (== 6)
//   wbits   = MAX_WBITS (== 15) — RFC1950 framing (78 9C header + body + 4-byte Adler32)
//   memLevel = DEF_MEM_LEVEL (== 8)
// These are the exact defaults from deflateInit; no explicit deflateInit2 needed.
//
// Returns: compressed bytes (RFC1950 framing), or EMPTY if:
//   (a) input.size() <= 1024 (TreeFileBuilder.cpp:682: "if (!disableCompression && uncompressedSize > 1024)")
//   (b) compressed result is NOT strictly smaller than input
std::vector<uint8_t> TreBuilder::zlibCompress(const std::vector<uint8_t>& src) {
    // (a) size gate: only compress inputs > 1024 bytes (TreeFileBuilder.cpp:682)
    if (src.size() <= 1024) return {};

    const uLong srcLen  = static_cast<uLong>(src.size());
    uLong       dstLen  = compressBound(srcLen);  // upper bound for compressBound

    std::vector<uint8_t> dst(dstLen);

    // Use compress2 (the zlib high-level deflate with level selection).
    // compress2 uses wbits=MAX_WBITS(15) and memLevel=DEF_MEM_LEVEL(8) internally.
    // Z_DEFAULT_COMPRESSION == 6.
    // Source: zlib source compress.c::compress2; ZlibCompressor.cpp:169.
    int ret = compress2(dst.data(), &dstLen,
                        src.data(), srcLen,
                        Z_DEFAULT_COMPRESSION);

    if (ret != Z_OK) return {};  // compression failed — store raw

    // (b) strictly smaller gate (TreeFileBuilder.cpp:705: "if (size < smallestSize)")
    if (static_cast<size_t>(dstLen) >= src.size()) return {};

    dst.resize(dstLen);
    return dst;
}

// ─── Header write / patch helpers ────────────────────────────────────────────

void TreBuilder::writeHeader(
    std::vector<uint8_t>& out, size_t offset,
    TreVersion version, uint32_t numberOfFiles,
    uint32_t tocOffset, uint32_t tocCompressor,
    uint32_t sizeOfTOC,
    uint32_t blockCompressor, uint32_t sizeOfNameBlock,
    uint32_t uncompSizeOfNameBlock)
{
    // Token "EERT" — little-endian dump of TAG 'TREE'
    // Source: swg-client-v2 TreeFile_SearchNode.h:174-185 (Header struct);
    //         TreeFileBuilder.cpp:777-779.
    out[offset + 0] = 'E'; out[offset + 1] = 'E';
    out[offset + 2] = 'R'; out[offset + 3] = 'T';

    // Version: 4 forward ASCII bytes (e.g. "0005")
    // Source: Utinni TreVersion.cs:60-73; TreeFileBuilder.cpp:144 (TAG_0005).
    const char* vstr = "0005";
    switch (version) {
        case TreVersion::V0004: vstr = "0004"; break;
        case TreVersion::V0005: vstr = "0005"; break;
        case TreVersion::V0006: vstr = "0006"; break;
        case TreVersion::V5000: vstr = "5000"; break;
        case TreVersion::V6000: vstr = "6000"; break;
    }
    out[offset + 4] = vstr[0]; out[offset + 5] = vstr[1];
    out[offset + 6] = vstr[2]; out[offset + 7] = vstr[3];

    // Header fields [8..35] — all uint32 LE
    // Source: swg-client-v2 TreeFile_SearchNode.h:174-185.
    patchLE32(out, offset +  8, numberOfFiles);
    patchLE32(out, offset + 12, tocOffset);
    patchLE32(out, offset + 16, tocCompressor);
    patchLE32(out, offset + 20, sizeOfTOC);
    patchLE32(out, offset + 24, blockCompressor);
    patchLE32(out, offset + 28, sizeOfNameBlock);
    patchLE32(out, offset + 32, uncompSizeOfNameBlock);
}

// ─── TreBuilder::build ───────────────────────────────────────────────────────

std::vector<uint8_t> TreBuilder::build(
    const std::vector<TreBuilderEntry>& entries,
    TreVersion version)
{
    // V6000 payloads are encrypted — builder refuses to write them.
    // Source: CONTEXT.md D-05; RESEARCH.md "v6000 Restoration payloads encrypted".
    if (isEnumerateOnly(version)) {
        throw std::runtime_error(
            "TreBuilder::build: V6000 is enumerate-only (encrypted payloads) — "
            "builder refuses to write V6000 archives (D-05)"
        );
    }

    const int stride = recordStride(version);
    const uint32_t numberOfFiles = static_cast<uint32_t>(entries.size());

    // ── (1) Write header stub (36 bytes — all fields we don't know yet are 0) ──
    // Source: TreeFileBuilder.cpp:773-779 (write header before payload loop).
    std::vector<uint8_t> out;
    out.resize(36, 0);  // 36-byte header placeholder
    writeHeader(out, 0, version, numberOfFiles,
                /*tocOffset=*/0, /*tocCompressor=*/0, /*sizeOfTOC=*/0,
                /*blockCompressor=*/0, /*sizeOfNameBlock=*/0, /*uncompSizeOfNameBlock=*/0);

    // ── Per-entry working data (collected in response-file order) ────────────
    struct EntryWork {
        uint32_t crc;
        int32_t  length;           // uncompressed size (0 = tombstone)
        int32_t  offset;           // byte offset of payload in the archive
        int32_t  compressor;       // 0 = none, 2 = zlib
        int32_t  compressedLength; // on-disk size
        std::string normalizedPath;
        std::vector<uint8_t> md5; // 16 bytes (zeroed for determinism; reader ignores it)
    };
    std::vector<EntryWork> work(numberOfFiles);

    // ── (2) Write file payloads in RESPONSE-FILE order ────────────────────────
    // Source: TreeFileBuilder.cpp:787-793 (loop over responseFileOrder).
    for (uint32_t i = 0; i < numberOfFiles; ++i) {
        const TreBuilderEntry& e = entries[i];
        EntryWork& w = work[i];

        // Normalize path + compute CRC
        w.normalizedPath = fixUpFileName(e.path);
        w.crc = crcCalculate(w.normalizedPath.c_str());

        w.offset = static_cast<int32_t>(out.size());

        if (e.tombstone) {
            // Tombstone entry: length == 0, no payload written.
            // Source: TreeFileBuilder.cpp:558-566 (writeFile skips deleted entries).
            w.length          = 0;
            w.compressor      = 0;
            w.compressedLength = 0;
            w.md5.assign(16, 0x00);
            continue;
        }

        if (!e.rawCompressedSlice.empty()) {
            // Repack path: copy raw compressed slice verbatim (TreWriter.cs:166-174).
            // NEVER recompress — deflate is not bit-stable across zlib builds.
            out.insert(out.end(), e.rawCompressedSlice.begin(), e.rawCompressedSlice.end());
            w.length          = e.uncompressedSize;
            w.compressor      = e.compressor;
            w.compressedLength = static_cast<int32_t>(e.rawCompressedSlice.size());
            w.md5.assign(16, 0x00);  // MD5 unknown for copied slices — zeroed
            continue;
        }

        // Fresh-build path: attempt zlib compression (zlib ONLY — no miniz).
        // Source: TreeFileBuilder.cpp:682-718 (compressAndWrite).
        const std::vector<uint8_t>& rawData = e.data;
        w.length = static_cast<int32_t>(rawData.size());

        std::vector<uint8_t> compressed = zlibCompress(rawData);
        if (!compressed.empty()) {
            // Compressed is strictly smaller — store zlib code 2 (CT_zlib)
            // Source: TreeFileBuilder.cpp:704-714 (if (size < smallestSize)).
            out.insert(out.end(), compressed.begin(), compressed.end());
            w.compressor      = 2;
            w.compressedLength = static_cast<int32_t>(compressed.size());
            w.md5.assign(16, 0x00);
        } else {
            // Store raw (compressor 0, CT_none)
            // Source: TreeFileBuilder.cpp:733-738 (else store uncompressed).
            out.insert(out.end(), rawData.begin(), rawData.end());
            w.compressor      = 0;
            w.compressedLength = 0;  // compressedLength is irrelevant when compressor==0
            w.md5.assign(16, 0x00);
        }
    }

    // tocOffset is right after all payload bytes
    const uint32_t tocOffset = static_cast<uint32_t>(out.size());

    // ── Build tocOrder (sorted by crc, then by name — binary-search precondition) ──
    // Source: TreeFileBuilder.cpp:302-306 (LessFileEntryCrcNameCompare — CrcLowerString < operator).
    //         The CrcLowerString operator< compares crc first, then name string for ties.
    std::vector<uint32_t> tocOrder(numberOfFiles);
    for (uint32_t i = 0; i < numberOfFiles; ++i) tocOrder[i] = i;
    std::sort(tocOrder.begin(), tocOrder.end(), [&](uint32_t a, uint32_t b) {
        const EntryWork& wa = work[a];
        const EntryWork& wb = work[b];
        if (wa.crc != wb.crc) return wa.crc < wb.crc;
        return wa.normalizedPath < wb.normalizedPath;
    });

    // ── (3) Build + write TOC (CRC-FIRST 6-field records in tocOrder) ────────
    // Source: TreeFileBuilder.cpp:601-634 (writeTableOfContents).
    //         The on-disk record is CRC-FIRST for ALL versions (LOCKED ground truth).
    //         swg-client-v2 TreeFile_SearchNode.h:189 (TableOfContentsEntry struct).
    const uint32_t uncompTocSize = static_cast<uint32_t>(numberOfFiles) * static_cast<uint32_t>(stride);
    std::vector<uint8_t> tocUncomp(uncompTocSize, 0);
    int nameOffsetCursor = 0;
    for (uint32_t ti = 0; ti < numberOfFiles; ++ti) {
        const EntryWork& w = work[tocOrder[ti]];
        uint8_t* r = tocUncomp.data() + static_cast<size_t>(ti) * stride;
        // CRC-FIRST layout (ALL versions): crc, length, offset, compressor, compressedLength, fileNameOffset
        uint32_t crc_u = w.crc;
        std::memcpy(r,      &crc_u,             4);
        int32_t  len = w.length;
        std::memcpy(r +  4, &len,               4);
        int32_t  off = w.offset;
        std::memcpy(r +  8, &off,               4);
        int32_t  comp = w.compressor;
        std::memcpy(r + 12, &comp,              4);
        int32_t  compLen = w.compressedLength;
        std::memcpy(r + 16, &compLen,           4);
        int32_t  nameOff = nameOffsetCursor;
        std::memcpy(r + 20, &nameOff,           4);
        // V6000 8-byte pad at [24..31] — already zeroed by tocUncomp initialization
        nameOffsetCursor += static_cast<int>(w.normalizedPath.size()) + 1;
    }

    // Attempt to compress the TOC block (TreeFileBuilder.cpp:632)
    std::vector<uint8_t> tocCompressed = zlibCompress(tocUncomp);
    uint32_t tocCompressor, sizeOfTOC;
    if (!tocCompressed.empty()) {
        // Compressed TOC is beneficial
        out.insert(out.end(), tocCompressed.begin(), tocCompressed.end());
        tocCompressor = 2;
        sizeOfTOC = static_cast<uint32_t>(tocCompressed.size());
    } else {
        out.insert(out.end(), tocUncomp.begin(), tocUncomp.end());
        tocCompressor = 0;
        sizeOfTOC = uncompTocSize;
    }

    // ── (4) Build + write name block (null-terminated names in tocOrder) ─────
    // Source: TreeFileBuilder.cpp:638-654 (writeFileNameBlock).
    std::vector<uint8_t> nameBlockUncomp;
    for (uint32_t ti = 0; ti < numberOfFiles; ++ti) {
        const EntryWork& w = work[tocOrder[ti]];
        const std::string& name = w.normalizedPath;
        nameBlockUncomp.insert(nameBlockUncomp.end(), name.begin(), name.end());
        nameBlockUncomp.push_back(0);  // null terminator
    }
    const uint32_t uncompSizeOfNameBlock = static_cast<uint32_t>(nameBlockUncomp.size());

    std::vector<uint8_t> nameCompressed = zlibCompress(nameBlockUncomp);
    uint32_t blockCompressor, sizeOfNameBlock;
    if (!nameCompressed.empty()) {
        out.insert(out.end(), nameCompressed.begin(), nameCompressed.end());
        blockCompressor = 2;
        sizeOfNameBlock = static_cast<uint32_t>(nameCompressed.size());
    } else {
        out.insert(out.end(), nameBlockUncomp.begin(), nameBlockUncomp.end());
        blockCompressor = 0;
        sizeOfNameBlock = uncompSizeOfNameBlock;
    }

    // ── (5) Write MD5 block (numberOfFiles × 16 bytes, ALWAYS uncompressed) ──
    // Source: TreeFileBuilder.cpp:658-672 (writeMd5Block).
    // The MD5 values are per the stored (possibly compressed) payload.
    // For our builder, we use zeroes (reader ignores the MD5 block entirely;
    // determinism only requires that we emit EXACTLY numberOfFiles × 16 zero bytes
    // consistently across two builds of the same input).
    // ALWAYS UNCOMPRESSED: TreeFileBuilder.cpp:670 (compressor=0, disableCompression=true).
    for (uint32_t i = 0; i < numberOfFiles; ++i) {
        const EntryWork& w = work[tocOrder[i]];
        out.insert(out.end(), w.md5.begin(), w.md5.end());
    }

    // ── (6) Seek back to offset 0; re-write the full 36-byte header ──────────
    // Source: TreeFileBuilder.cpp:803-813 (SetFilePointer + re-write header).
    // All header fields are now known.
    writeHeader(out, 0, version, numberOfFiles,
                tocOffset, tocCompressor, sizeOfTOC,
                blockCompressor, sizeOfNameBlock, uncompSizeOfNameBlock);

    return out;
}

// ─── TreBuilder::repack ──────────────────────────────────────────────────────

std::vector<uint8_t> TreBuilder::repack(
    const TreArchive&               source,
    IInputStream&                   sourceStream,
    const std::vector<int>&         editedIndices,
    const std::vector<std::vector<uint8_t>>& editedData,
    TreVersion version)
{
    if (isEnumerateOnly(version)) {
        throw std::runtime_error(
            "TreBuilder::repack: V6000 is enumerate-only — repack refused (D-05)"
        );
    }

    if (editedIndices.size() != editedData.size()) {
        throw std::runtime_error(
            "TreBuilder::repack: editedIndices and editedData must have the same length"
        );
    }

    // Build a set of edited indices for O(1) lookup
    std::unordered_map<int, const std::vector<uint8_t>*> editMap;
    for (size_t i = 0; i < editedIndices.size(); ++i) {
        editMap[editedIndices[i]] = &editedData[i];
    }

    const auto& entries = source.entries();
    const int n = static_cast<int>(entries.size());
    const int sourceSrcLen = sourceStream.length();

    std::vector<TreBuilderEntry> builderEntries;
    builderEntries.reserve(n);

    for (int i = 0; i < n; ++i) {
        const TreEntry& e = entries[i];
        const std::string name = source.nameAt(e.fileNameOffset);

        TreBuilderEntry be;
        be.path = name;
        be.tombstone = (e.length == 0);

        auto it = editMap.find(i);
        if (it != editMap.end()) {
            // Edited entry: recompress from new payload
            // Source: TreWriter.cs:154-164 (edits.TryGetValue -> recompress).
            be.data = *it->second;
        } else if (be.tombstone) {
            // Tombstone: no payload
        } else {
            // Untouched: copy raw compressed slice verbatim.
            // Source: TreWriter.cs:166-174 (rawCompressed = original.GetRecordCompressedBytes(i);
            //         storedSlices[i] = rawCompressed; — NEVER recompress).
            const int32_t readLen = (e.compressor != 0) ? e.compressedLength : e.length;
            if (readLen > 0) {
                if (static_cast<int64_t>(e.offset) + readLen > sourceSrcLen) {
                    throw std::runtime_error(
                        "TreBuilder::repack: entry payload out of stream bounds"
                    );
                }
                be.rawCompressedSlice.resize(static_cast<size_t>(readLen));
                if (sourceStream.read(e.offset, be.rawCompressedSlice.data(), readLen) != readLen) {
                    throw std::runtime_error(
                        "TreBuilder::repack: failed to read entry raw compressed slice"
                    );
                }
                be.compressor      = e.compressor;
                be.uncompressedSize = e.length;
            }
        }

        builderEntries.push_back(std::move(be));
    }

    return build(builderEntries, version);
}

} // namespace swg
