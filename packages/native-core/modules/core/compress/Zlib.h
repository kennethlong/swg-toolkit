/**
 * Zlib.h — TRE inflate/deflate helper interface (engine-free).
 *
 * Handles the three compressor codes used in TRE archives:
 *   code 0 = stored/passthrough (no compression)
 *   code 1 = raw deflate (no zlib framing) — handle; do NOT fatal (CT_deprecated)
 *   code 2 = zlib RFC1950 framed (0x78XX header + body + 4-byte Adler32 trailer)
 *
 * Source: swg-client-v2 TreeFile_SearchNode.h:166-172 (CompressorType enum),
 *         TreeFile_SearchNode.cpp:534 (ZlibCompressor().expand call site);
 *         Utinni TreFile.cs:595-679 (code 1 = raw deflate; code 2 = RFC1950 framed;
 *         read-one-past-cap over-expansion detection at :695).
 *
 * Security (T-01-03): inflate output is capped at min(declaredUncompressed, MaxBlock=256MB).
 * Read-one-past-cap detection: if inflate wants to produce more than cap, throw.
 * LAZY/streaming output growth: no eager malloc(cap) for the full declared size.
 *
 * treDeflate (plan 04.4-06 Step 1): the write-path zlib compress2 body, extracted from
 * TreBuilder::zlibCompress into a free function here so both TreBuilder::zlibCompress
 * (now a thin wrapper) and TreCodec's ZlibCodec::deflate can call the SAME implementation
 * without a TreCodec.cpp <-> TreBuilder.cpp circular include in either direction.
 */

#pragma once

#include <cstdint>
#include <vector>
#include <stdexcept>

namespace swg {

/** Maximum per-record/block inflate output (256 MB). Security cap T-01-03. */
static constexpr size_t ZLIB_MAX_BLOCK = 256u * 1024u * 1024u;

/**
 * Inflate a TRE-compressed block.
 *
 * @param compressor        Compressor code from the TOC record (0, 1, or 2).
 * @param src               Pointer to the compressed (or stored) bytes on disk.
 * @param srcLen            Number of compressed bytes to read.
 * @param declaredUncomp    The declared uncompressed size from the TOC record.
 *                          Used as the output cap hint: output is capped at
 *                          min(declaredUncomp, ZLIB_MAX_BLOCK).
 * @returns                 Decompressed bytes (or a view of the raw stored block
 *                          for compressor==0).
 * @throws std::runtime_error on inflate failure, bad Adler32, or cap exceeded.
 */
std::vector<uint8_t> treInflate(
    int                  compressor,
    const uint8_t*       src,
    size_t               srcLen,
    size_t               declaredUncomp
);

/**
 * Compress `src` bytes using zlib RFC1950 framing (compressor code 2):
 *   compress2(..., Z_DEFAULT_COMPRESSION) — level 6, wbits 15 (MAX_WBITS), memLevel 8
 *   (compress2's internal defaults).
 *
 * Returns the compressed bytes, or EMPTY if:
 *   (a) srcLen <= 1024 (TreeFileBuilder.cpp:682 gate — not worth compressing tiny blocks)
 *   (b) the compressed result is NOT strictly smaller than the input (store raw instead)
 *   (c) compress2() fails
 *
 * FORBIDDEN: miniz / mz_deflate / tdefl — miniz cannot reproduce zlib's RFC1950 bitstream.
 *            This function links the vendored zlib 1.2.3 directly (see Zlib.cpp guards).
 *
 * Source: swg-client-v2 ZlibCompressor.cpp:169 (deflateInit(&z, Z_DEFAULT_COMPRESSION));
 *         swg-client-v2 TreeFileBuilder.cpp:682-718 (compressAndWrite trial-compression);
 *         extracted (plan 04.4-06 Step 1) from TreBuilder::zlibCompress, moved verbatim,
 *         so both TreBuilder::zlibCompress (thin wrapper) and TreCodec's ZlibCodec::deflate
 *         call this same implementation.
 *
 * @param src     Pointer to input bytes to compress.
 * @param srcLen  Number of bytes at `src`.
 * @returns       RFC1950-framed compressed bytes, or empty if not beneficial / too small.
 */
std::vector<uint8_t> treDeflate(const uint8_t* src, size_t srcLen);

} // namespace swg
