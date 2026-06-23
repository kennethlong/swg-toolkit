/**
 * Zlib.h — TRE inflate helper interface (engine-free).
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

} // namespace swg
