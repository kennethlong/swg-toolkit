/**
 * TreCodec.cpp — Registry implementation for the pluggable TRE codec seam (D-21, round-3).
 *
 * See TreCodec.h for the interface contract and the round-3 widened-scope rationale.
 * All three lookups (codecForCompressor, codecForTreVersion, codecForBlockCompressor)
 * share the SAME underlying registration table: compressor code 0 -> StoredCodec,
 * compressor code 2 -> ZlibCodec. Unknown/unregistered codes fall back to ZlibCodec so
 * that existing behavior (which always attempted treInflate for any non-zero compressor,
 * including code 1 = raw deflate) is preserved unchanged.
 */

#include "TreCodec.h"

namespace swg {

namespace {

const StoredCodec& storedCodecInstance() {
    static const StoredCodec instance;
    return instance;
}

const ZlibCodec& zlibCodecInstance() {
    static const ZlibCodec instance;
    return instance;
}

/**
 * Shared dispatch: compressor code 0 -> StoredCodec; everything else (1 = raw deflate,
 * 2 = zlib RFC1950, and any other value) -> ZlibCodec, which delegates to treInflate's
 * own dispatch (treInflate already branches on code 1 vs code 2 internally). This
 * preserves the exact pre-refactor behavior at every call site: only compressor==0 ever
 * bypassed treInflate/zlibCompress; every other value went through the zlib helper.
 */
const TreCodec& lookupCodec(int compressor) {
    if (compressor == 0) {
        return storedCodecInstance();
    }
    return zlibCodecInstance();
}

} // namespace

const TreCodec& codecForCompressor(int compressor) {
    return lookupCodec(compressor);
}

const TreCodec& codecForTreVersion(int /*version*/) {
    // No codec is registered per-version today — the payload write path always uses the
    // stock zlib codec (TreBuilder::build's V6000 refusal fires before this lookup would
    // ever be reached for V6000; see TreBuilder.cpp isEnumerateOnly() blanket-throw).
    return zlibCodecInstance();
}

const TreCodec& codecForBlockCompressor(int compressor) {
    return lookupCodec(compressor);
}

} // namespace swg
