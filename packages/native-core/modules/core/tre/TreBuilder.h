/**
 * TreBuilder.h — TRE archive writer (builder primitive, D-04).
 *
 * Ported from:
 *   swg-client-v2 TreeFileBuilder.cpp:558-597  (writeFile — payload compress/write)
 *   swg-client-v2 TreeFileBuilder.cpp:601-634  (writeTableOfContents — TOC in tocOrder)
 *   swg-client-v2 TreeFileBuilder.cpp:638-654  (writeFileNameBlock)
 *   swg-client-v2 TreeFileBuilder.cpp:658-672  (writeMd5Block — numberOfFiles × 16 bytes)
 *   swg-client-v2 TreeFileBuilder.cpp:773-833  (write() — block order + double header write)
 *   swg-client-v2 ZlibCompressor.cpp:169        (deflateInit(&z, Z_DEFAULT_COMPRESSION))
 *   Utinni TreWriter.cs:36-85,166-174           (repack: copy untouched slices verbatim)
 *
 * Block write order (LOCKED — TreeFileBuilder.cpp:773-833):
 *   (1) 36-byte header stub (token "EERT", version ASCII, numberOfFiles — tocOffset etc. 0)
 *   (2) File payloads in RESPONSE-FILE order (each compressed or raw)
 *   (3) TOC (CRC-FIRST 6-field records) in crc/name-sorted tocOrder, maybe compressed
 *   (4) Name block (null-terminated names in tocOrder), maybe compressed
 *   (5) MD5 block (numberOfFiles × 16 bytes, ALWAYS uncompressed)
 *   (6) Seek back to offset 0, re-write the full 36-byte header with correct field values
 *
 * Compression policy (LOCKED — ZlibCompressor.cpp:169):
 *   zlib RFC1950 framing (compressor code 2) ONLY, level Z_DEFAULT_COMPRESSION (6),
 *   wbits 15 (deflateInit default), memLevel 8 (deflateInit default).
 *   Used ONLY when strictly smaller AND input > 1024 bytes (TreeFileBuilder.cpp:682-683).
 *   FORBIDDEN: miniz / mz_deflate / tdefl symbols on the write path — miniz cannot reproduce
 *   zlib's bitstream (read path may use a miniz fallback; write path NEVER does).
 *
 * Determinism contract:
 *   Building the same entry set twice produces BYTE-IDENTICAL output — a regression guard.
 *   Determinism requires: response-file payload order, CRC-sorted tocOrder, pinned zlib
 *   level/wbits/memLevel, deterministic MD5 block, deterministic header re-write.
 *   This is a self-identity claim (build-twice-identical), NOT "matches retail bytes"
 *   (deflate is not bit-stable across zlib builds).
 *
 * v6000 refuse:
 *   isEnumerateOnly(V6000) == true — builder REFUSES to write v6000 payloads (encrypted).
 *   Build / repack of v6000 archives throws std::runtime_error.
 *
 * Repack raw-slice identity contract (TreWriter.cs:166-174):
 *   TreBuilder::repack() copies untouched entries' compressed slices VERBATIM from the
 *   source archive — it NEVER recompresses untouched entries (deflate is not bit-stable).
 *   Only edited entries (marked dirty) are recompressed.
 */

#pragma once

#include "TreArchive.h"
#include "TreVersion.h"
#include <cstdint>
#include <string>
#include <vector>
#include <functional>

namespace swg {

/**
 * One entry supplied to TreBuilder::build().
 *
 * Either `data` contains the raw (uncompressed) payload to store, OR (for repack)
 * `rawCompressedSlice` contains the already-compressed on-disk bytes to copy verbatim.
 * If `rawCompressedSlice` is non-empty, it is used directly (no recompression).
 *
 * The `path` must be ALREADY normalized (lowercase, forward-slash, no leading ./ or ../).
 * TreBuilder::build() computes the CRC from the normalized path.
 */
struct TreBuilderEntry {
    /** Normalized file path (e.g. "appearance/player.apt"). */
    std::string path;

    /**
     * Raw (uncompressed) payload bytes.
     * Used when `rawCompressedSlice` is empty — builder will attempt zlib compression.
     * For tombstone entries: empty + `tombstone` = true.
     */
    std::vector<uint8_t> data;

    /**
     * Pre-compressed bytes to copy verbatim (repack path — raw-slice identity contract).
     * When non-empty, these bytes are written directly; `compressor` records the original
     * compressor code; `uncompressedSize` records the original uncompressed size.
     * NEVER recompressed (TreWriter.cs:166-174 contract).
     */
    std::vector<uint8_t> rawCompressedSlice;

    /** Original compressor code (used with rawCompressedSlice). */
    int compressor = 0;

    /** Original uncompressed size (used with rawCompressedSlice). */
    int uncompressedSize = 0;

    /** True if this entry is a tombstone (deleted, length == 0 in TOC). */
    bool tombstone = false;
};

/**
 * TreBuilder — pure-C++ TRE archive writer.
 *
 * Engine-free; takes an IOutputStream-like (internal FILE-based) + in-memory builds.
 * The primary API is build(), which returns the archive as a byte vector.
 *
 * Usage (build from scratch):
 *   std::vector<TreBuilderEntry> entries = { ... };
 *   auto bytes = TreBuilder::build(entries, TreVersion::V0005);
 *   // bytes is a complete, parseable .tre archive
 *
 * Usage (repack — raw-slice identity for untouched entries):
 *   auto bytes = TreBuilder::repack(sourceArchive, sourceStream, edits, version);
 *   // edits is a map of entry-index -> new uncompressed payload
 *   // untouched entries are copied verbatim; only edits are recompressed
 */
class TreBuilder {
public:
    /**
     * Build a fresh TRE archive from a set of entries.
     *
     * Entry order determines response-file payload order (LOCKED per TreeFileBuilder.cpp:788).
     * The TOC is written in crc/name-sorted order (binary-search precondition).
     * Compression: zlib level 6 / wbits 15 / memLevel 8, only when strictly smaller and
     * input > 1024 bytes (LOCKED per TreeFileBuilder.cpp:682-683 + ZlibCompressor.cpp:169).
     * An MD5 trailer block is appended (LOCKED per TreeFileBuilder.cpp:658-672).
     * The header is written twice: a stub first, then re-written with final field values.
     *
     * @param entries  Input entries in response-file order (determines payload layout).
     *                 All `path` fields must be already normalized.
     * @param version  TRE version to emit (V0005 is the standard; V6000 is refused).
     * @returns        Complete TRE archive bytes (header + payloads + TOC + names + MD5).
     * @throws         std::runtime_error if version is V6000 (enumerate-only, write refused).
     */
    static std::vector<uint8_t> build(
        const std::vector<TreBuilderEntry>& entries,
        TreVersion version = TreVersion::V0005
    );

    /**
     * Repack a TRE archive: copy untouched entries verbatim, recompress only edited ones.
     *
     * This is the raw-slice identity contract (Utinni TreWriter.cs:166-174):
     *   - Untouched entries: copy the raw compressed slice verbatim from `source`.
     *     Never decompress + recompress (deflate is NOT bit-stable across zlib builds).
     *   - Edited entries: recompress from new payload bytes (zlib level 6 only).
     *
     * Entry order follows the original archive's entry order (RESPONSE-FILE order).
     * TOC is re-sorted by crc/name.
     *
     * @param source       The parsed source archive (provides entry metadata + name block).
     * @param sourceStream Stream over the source archive file (for payload reads).
     * @param edits        Map of entry-index -> new uncompressed payload bytes.
     *                     Entries NOT in the map are untouched (raw-slice copy).
     * @param version      Version to emit (typically same as source; V6000 refused).
     * @returns            Complete repackaged TRE archive bytes.
     * @throws             std::runtime_error if version is V6000.
     */
    static std::vector<uint8_t> repack(
        const TreArchive&               source,
        IInputStream&                   sourceStream,
        const std::vector<int>&         editedIndices,
        const std::vector<std::vector<uint8_t>>& editedData,
        TreVersion version = TreVersion::V0005
    );

private:
    TreBuilder() = delete;

    /**
     * Compress `src` bytes using zlib RFC1950 framing (compressor code 2):
     *   deflateInit(&z, Z_DEFAULT_COMPRESSION) — level 6, wbits 15, memLevel 8.
     * Returns the compressed bytes, or empty if compression is not beneficial.
     * Only applies when src.size() > 1024 (LOCKED: TreeFileBuilder.cpp:682).
     *
     * FORBIDDEN: miniz / mz_deflate / tdefl — miniz cannot reproduce zlib's RFC1950 bitstream.
     *            This function links the vendored zlib 1.2.3 directly.
     *
     * Source: swg-client-v2 ZlibCompressor.cpp:169 (deflateInit(&z, Z_DEFAULT_COMPRESSION)).
     *         swg-client-v2 TreeFileBuilder.cpp:684-718 (compressAndWrite trial-compression).
     *
     * @param src  Input bytes to compress.
     * @returns    RFC1950-framed compressed bytes, or empty if not beneficial / too small.
     */
    static std::vector<uint8_t> zlibCompress(const std::vector<uint8_t>& src);

    /**
     * Write a 36-byte header stub or full header into `out`.
     * Fields that aren't known yet (tocOffset, sizes, compressors) are written as 0.
     * The actual re-write at seek-back time fills in the real values.
     *
     * Source: swg-client-v2 TreeFileBuilder.cpp:773-813 + :803-813 (re-write).
     */
    static void writeHeader(std::vector<uint8_t>& out, size_t headerOffset,
                            TreVersion version, uint32_t numberOfFiles,
                            uint32_t tocOffset, uint32_t tocCompressor,
                            uint32_t sizeOfTOC,
                            uint32_t blockCompressor, uint32_t sizeOfNameBlock,
                            uint32_t uncompSizeOfNameBlock);
};

} // namespace swg
