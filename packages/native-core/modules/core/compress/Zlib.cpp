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
 *   - Output is capped at min(declaredUncomp, ZLIB_MAX_BLOCK=256MB) (the `ceiling`);
 *     0-declared falls back to ZLIB_MAX_BLOCK so it stays bounded.
 *   - TRUE lazy output growth: the buffer starts at min(ceiling, 64KiB) and DOUBLES on
 *     demand up to `ceiling` — it is NEVER eagerly sized to declaredUncomp. This defeats
 *     the "tiny block declares 256MB" amplified-allocation DoS (declaredUncomp is an
 *     attacker-controlled int32 from the TOC).
 *   - If inflate would exceed `ceiling`, throw "decompression bomb" (TreFile.cs:695).
 *
 * Security (T-01-04):
 *   - For code 2, validate the RFC1950 0x78XX header (magic byte).
 *   - Inflate failures (Z_BUF_ERROR with no output, Z_DATA_ERROR) throw cleanly.
 */

#include "Zlib.h"
#include <zlib.h>    // Vendored zlib 1.2.3 (compress/zlib/) — placed BEFORE CMAKE_JS_INC
                     // on swg_core's include path so this resolves to the static, host-
                     // independent copy, NOT Node's bundled zlib.h (1.3.1).
#if !defined(ZLIB_VERNUM) || ZLIB_VERNUM != 0x1230
#  error "Zlib.cpp must compile against the vendored zlib 1.2.3 (compress/zlib/zlib.h); got a different zlib.h on the include path"
#endif
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

    // ── Inflate (incremental, T-01-03) ───────────────────────────────────────
    // TRUE lazy output growth: start small and double up to the cap, instead of
    // eagerly allocating the full cap. `declaredUncomp` is an attacker-controlled
    // int32 from the TOC, so a tiny compressed block can declare length=256MB and
    // force a 256MB zero-fill per inflate — an amplifiable memory DoS. Growing on
    // demand keeps the allocation proportional to what is *actually* produced, while
    // the over-expansion throw at the cap preserves bomb detection.
    // Source: Utinni TreFile.cs:695 (over-expansion detection).
    //
    // `ceiling` is the hard upper bound. When `declaredUncomp` is 0 (size unknown),
    // fall back to the global ZLIB_MAX_BLOCK ceiling rather than a tiny guess — still
    // bounded, but lets a 0-declared entry inflate up to the same hard limit.
    const size_t ceiling   = (cap > 0) ? cap : ZLIB_MAX_BLOCK;
    const size_t kGrowStep = 65536u; // 64 KiB seed / minimum grow step

    std::vector<uint8_t> output;
    output.resize(std::min(ceiling, kGrowStep));

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

    for (;;) {
        ret = inflate(&zs, Z_NO_FLUSH);

        if (ret == Z_STREAM_END) {
            break; // success — total_out holds the real produced size
        }

        if ((ret == Z_OK || ret == Z_BUF_ERROR) && zs.avail_out == 0) {
            // Output buffer is full but the stream isn't done — grow on demand,
            // bounded by `ceiling`. Hitting the ceiling = decompression bomb.
            const size_t oldSize = output.size();
            if (oldSize >= ceiling) {
                inflateEnd(&zs);
                throw std::runtime_error(
                    "Zlib::treInflate: decompression bomb detected — inflate output exceeded cap"
                );
            }
            const size_t newSize = (oldSize <= ceiling / 2) ? (oldSize * 2) : ceiling;
            output.resize(newSize);
            zs.next_out  = reinterpret_cast<Bytef*>(output.data() + oldSize);
            zs.avail_out = static_cast<uInt>(newSize - oldSize);
            continue;
        }

        // Not finished and output space remains → truncated/incomplete input
        // (Z_BUF_ERROR = no progress possible; Z_OK with all input consumed = same),
        // or a hard decode error (Z_DATA_ERROR / Z_MEM_ERROR) → clean throw (T-01-04).
        const size_t producedSoFar = zs.total_out;
        if (ret == Z_BUF_ERROR || ret == Z_OK) {
            inflateEnd(&zs);
            if (producedSoFar == 0) {
                throw std::runtime_error(
                    "Zlib::treInflate: inflate produced no output (truncated input)");
            }
            throw std::runtime_error(
                "Zlib::treInflate: incomplete deflate stream (truncated input)");
        }

        char errBuf[160];
        std::snprintf(errBuf, sizeof(errBuf),
            "Zlib::treInflate: inflate failed (code %d): %s",
            ret, (zs.msg ? zs.msg : "unknown error"));
        inflateEnd(&zs);
        throw std::runtime_error(errBuf);
    }

    const size_t produced = zs.total_out;
    inflateEnd(&zs);
    output.resize(produced);
    return output;
}

} // namespace swg
