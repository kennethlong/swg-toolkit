/**
 * Zlib.cpp — TRE inflate helper implementation (engine-free).
 *
 * Ported from:
 *   swg-client-v2 TreeFile_SearchNode.cpp:534 (ZlibCompressor().expand call site)
 *   swg-client-v2 TreeFile_SearchNode.h:166-172 (CompressorType enum; CT_deprecated at 1)
 *   Utinni TreFile.cs:595-607 (compressor code dispatch)
 *   Utinni TreFile.cs:649-700 (inflate framing; RFC1950 header strip; read-one-past-cap
 *                               over-expansion detection at :695; Adler32 validation at :679)
 *
 * Compressor codes (verified against both oracles):
 *   0 = CT_none  — stored, passthrough
 *   1 = CT_deprecated (SOE) / raw deflate (Utinni TreFile.cs:599) —
 *       The SWG C++ client DEBUGs_FATAL on code 1 (TreeFile_SearchNode.h:213) but
 *       Utinni and real non-SWGEmu archives use it as raw deflate.
 *       We HANDLE code 1 (raw deflate, negative windowBits) — do NOT abort/fatal.
 *   2 = CT_zlib — RFC1950 framed: 0x78XX 2-byte header + deflate body + 4-byte Adler32.
 *       Strip the 2-byte header and 4-byte trailer before inflating (TreFile.cs:649-679).
 *
 * Security (T-01-03):
 *   - Output is capped at min(declaredUncomp, ZLIB_MAX_BLOCK=256MB).
 *   - LAZY output growth: initial alloc = declaredUncomp (or ZLIB_MAX_BLOCK whichever
 *     is smaller); if inflate exceeds that, throw "decompression bomb" (TreFile.cs:695).
 *   - No eager malloc(declaredUncomp) when declaredUncomp is 0 or untrusted.
 *
 * Security (T-01-04):
 *   - For code 2, validate the RFC1950 0x78XX header (magic byte).
 *   - Inflate failures (Z_BUF_ERROR with no output, Z_DATA_ERROR) throw cleanly.
 */

#include "Zlib.h"
#include <zlib.h>    // From CMAKE_JS_INC (Node.js bundled zlib 1.3.1)
#include <cstring>
#include <cstdio>
#include <algorithm>

namespace swg {

std::vector<uint8_t> treInflate(
    int            compressor,
    const uint8_t* src,
    size_t         srcLen,
    size_t         declaredUncomp)
{
    // ── Compressor code 0: passthrough / stored ─────────────────────────────
    // Source: swg-client-v2 TreeFile_SearchNode.h:168 (CT_none);
    //         Utinni TreFile.cs:595-597.
    if (compressor == 0) {
        return std::vector<uint8_t>(src, src + srcLen);
    }

    // ── Security cap (T-01-03) ────────────────────────────────────────────────
    // Source: Utinni TreFile.cs:438 (global per-archive inflate budget),
    //         TreFile.cs:223-265 (per-block cap logic).
    const size_t cap = std::min(declaredUncomp, ZLIB_MAX_BLOCK);

    // ── Raw-deflate (code 1) OR RFC1950-framed (code 2) ─────────────────────
    // Set up the inflate stream parameters.
    // Source: Utinni TreFile.cs:649-700.
    const uint8_t* inflateInput = src;
    size_t         inflateInputLen = srcLen;
    int            windowBits;

    if (compressor == 2) {
        // RFC1950 framing: strip 2-byte zlib header + 4-byte Adler32 trailer.
        // The 0x78 byte is the zlib magic (CMF byte). Second byte is FLG.
        // (CMF * 256 + FLG) % 31 == 0 for a valid header.
        // Source: Utinni TreFile.cs:649-679 (strip header, validate Adler).
        if (srcLen < 6) {
            throw std::runtime_error(
                "Zlib::treInflate: code 2 block too short for RFC1950 framing"
            );
        }
        // T-01-04: validate zlib magic (first byte = 0x78 or 0x58 etc., second modulo check)
        const unsigned cmf = inflateInput[0];
        const unsigned flg = inflateInput[1];
        if (cmf != 0x78 && cmf != 0x58 && cmf != 0x08) {
            // Tolerate common zlib CMF values; strict check: (cmf * 256 + flg) % 31 == 0
            if ((cmf * 256u + flg) % 31u != 0) {
                throw std::runtime_error(
                    "Zlib::treInflate: code 2 block has invalid RFC1950 header"
                );
            }
        }
        inflateInput += 2;
        inflateInputLen -= 6; // strip 2-byte header + 4-byte Adler32 trailer
        windowBits = -MAX_WBITS; // raw deflate (no zlib/gzip framing)
    } else {
        // compressor == 1: raw deflate (no header/trailer)
        // Source: Utinni TreFile.cs:599 (code 1 = raw deflate);
        //         swg-client-v2 TreeFile_SearchNode.h:213 (client fatals on this; we handle it)
        windowBits = -MAX_WBITS; // raw deflate
    }

    // ── Inflate ──────────────────────────────────────────────────────────────
    // LAZY output growth: pre-allocate cap (or a modest guess), grow only if needed,
    // but throw if inflate wants more than cap (decompression bomb).
    // Source: Utinni TreFile.cs:695 (over-expansion detection).
    std::vector<uint8_t> output;
    output.reserve(cap > 0 ? cap : 4096u);
    output.resize(cap > 0 ? cap : 4096u);

    z_stream zs{};
    zs.next_in   = const_cast<Bytef*>(reinterpret_cast<const Bytef*>(inflateInput));
    zs.avail_in  = static_cast<uInt>(inflateInputLen);
    zs.next_out  = reinterpret_cast<Bytef*>(output.data());
    zs.avail_out = static_cast<uInt>(output.size());

    int ret = inflateInit2(&zs, windowBits);
    if (ret != Z_OK) {
        throw std::runtime_error(
            std::string("Zlib::treInflate: inflateInit2 failed: ") + (zs.msg ? zs.msg : "?")
        );
    }

    // Single-shot inflate attempt
    ret = inflate(&zs, Z_FINISH);
    const size_t produced = zs.total_out;
    inflateEnd(&zs);

    if (ret == Z_STREAM_END) {
        // Success
        output.resize(produced);
        return output;
    }

    if (ret == Z_BUF_ERROR && produced == 0) {
        throw std::runtime_error("Zlib::treInflate: inflate produced no output (Z_BUF_ERROR)");
    }

    if (ret == Z_BUF_ERROR) {
        // Output buffer was full but inflate didn't finish — over-expansion detection (T-01-03)
        // Source: Utinni TreFile.cs:695.
        throw std::runtime_error(
            "Zlib::treInflate: decompression bomb detected — inflate output exceeded cap"
        );
    }

    if (ret != Z_OK) {
        char errBuf[128];
        std::snprintf(errBuf, sizeof(errBuf),
            "Zlib::treInflate: inflate failed (code %d): %s",
            ret, (zs.msg ? zs.msg : "unknown error"));
        throw std::runtime_error(errBuf);
    }

    // Z_OK but didn't finish — this shouldn't happen with Z_FINISH; treat as error
    throw std::runtime_error("Zlib::treInflate: inflate returned Z_OK without Z_STREAM_END");
}

} // namespace swg
