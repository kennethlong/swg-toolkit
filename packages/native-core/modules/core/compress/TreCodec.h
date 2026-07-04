/**
 * TreCodec.h — Pluggable TRE compression codec interface (D-21).
 *
 * This interface governs the FULL TRE read/write path per D-21 — per-entry PAYLOAD
 * compression (codecForCompressor/codecForTreVersion) AND archive TOC/name-block
 * compression (codecForBlockCompressor, a separate header-field-keyed selection axis,
 * since the entry's own compressor is unknown until the TOC is decoded). See 04.4-06's
 * round-3 revision note for the maintainer ruling that widened this seam from an
 * earlier payload-only scoping.
 *
 * Architecture (D-21): "make the TRE read/write path a pluggable codec interface, not
 * hardcoded, so custom compression/encryption can be dropped in" — open-source
 * extensibility for forks like Restoration's proprietary v6000 encryption. This plan
 * does NOT add a fork codec; it only formalizes the registration seam and registers
 * the two stock codecs (StoredCodec, ZlibCodec) that already exist today.
 *
 * Three lookups, all backed by the same internal registration table:
 *   codecForCompressor(int compressor)      — PAYLOAD READ call sites, keyed by the
 *                                              entry's own `compressor` TOC field.
 *   codecForTreVersion(int version)         — PAYLOAD WRITE call site, keyed by the
 *                                              archive's `version` field (today: always
 *                                              dispatches to the stock zlib codec; no
 *                                              codec is registered for V6000 — the
 *                                              existing isEnumerateOnly() blanket-throw
 *                                              in TreBuilder::build stays in place).
 *   codecForBlockCompressor(int compressor) — TOC/name-block READ and WRITE call sites,
 *                                              keyed on the archive's OWN header fields
 *                                              (tocCompressor / blockCompressor on read;
 *                                              the value TreBuilder itself chooses to
 *                                              emit into those fields on write). This is
 *                                              a DIFFERENT selection axis from
 *                                              codecForCompressor: the per-entry
 *                                              compressor value is not knowable until
 *                                              the TOC itself has been decoded, so
 *                                              TOC/name-block codec selection can ONLY
 *                                              ever be keyed on the archive's header
 *                                              fields — a chicken-and-egg constraint on
 *                                              the design, not a reason to exclude these
 *                                              call sites (round-3 maintainer ruling).
 *
 * Registered stock codecs (shared across all three lookups):
 *   compressor code 0 -> StoredCodec (identity passthrough — formalizes the pre-refactor
 *                        `tocCompressor == 0` / `blockCompressor == 0` bypass branches in
 *                        TreArchive::parse as a registered codec instead of a call-site
 *                        special case).
 *   compressor code 2 -> ZlibCodec (wraps the existing treInflate / new treDeflate).
 *
 * Security (T-01-03 / T-04.4-10 / T-04.4-10b): ZlibCodec::inflate delegates verbatim to
 * treInflate(), which enforces the ZLIB_MAX_BLOCK (256 MB) decompression-bomb cap. This
 * codec interface does not remove or weaken that cap for either the payload path or the
 * (round-3-widened) TOC/name-block path — both dispatch through the same capped function.
 *
 * Source: 04.4-06-PLAN.md <interfaces> (round-3); Zlib.h treInflate/treDeflate;
 *         TreArchive.cpp/TreBuilder.cpp call sites this seam replaces.
 */

#pragma once

#include "Zlib.h"
#include <cstdint>
#include <vector>

namespace swg {

/**
 * TreCodec — abstract compression codec used at TRE read/write call sites.
 *
 * A codec is stateless and side-effect-free; instances are process-lifetime singletons
 * returned by reference from the codecFor*() lookups below.
 */
struct TreCodec {
    virtual ~TreCodec() = default;

    /**
     * Decompress (or pass through) a block of bytes.
     *
     * @param compressor     Compressor code (0, 1, or 2) — passed through to treInflate
     *                       for codecs that delegate to it; StoredCodec ignores it.
     * @param src            Pointer to the on-disk (possibly compressed) bytes.
     * @param srcLen         Number of bytes at `src`.
     * @param declaredUncomp Declared/expected uncompressed size (used as the output cap
     *                       hint by ZlibCodec; ignored by StoredCodec).
     * @returns              Decompressed (or passthrough) bytes.
     */
    virtual std::vector<uint8_t> inflate(
        int            compressor,
        const uint8_t* src,
        size_t         srcLen,
        size_t         declaredUncomp
    ) const = 0;

    /**
     * Compress (or pass through) a block of bytes.
     *
     * @param src  Input bytes.
     * @returns    Compressed (or passthrough) bytes. For ZlibCodec, an EMPTY result means
     *             "compression not beneficial / input too small" (matches the existing
     *             TreBuilder::zlibCompress contract) — callers fall back to storing raw.
     */
    virtual std::vector<uint8_t> deflate(const std::vector<uint8_t>& src) const = 0;
};

/**
 * StoredCodec — identity passthrough (compressor code 0, CT_none).
 *
 * Formalizes the pre-refactor `tocCompressor == 0` / `blockCompressor == 0` bypass
 * branches in TreArchive::parse as a registered codec. `inflate` returns the input bytes
 * unchanged; `deflate` also returns the input bytes unchanged (the "store raw" case is a
 * caller-side decision at the payload call sites — for the TOC/name-block call sites,
 * StoredCodec is only selected when the caller has already decided to store uncompressed).
 */
struct StoredCodec final : TreCodec {
    std::vector<uint8_t> inflate(
        int /*compressor*/,
        const uint8_t* src,
        size_t         srcLen,
        size_t /*declaredUncomp*/
    ) const override {
        return std::vector<uint8_t>(src, src + srcLen);
    }

    std::vector<uint8_t> deflate(const std::vector<uint8_t>& src) const override {
        return src;
    }
};

/**
 * ZlibCodec — zlib-backed codec (compressor code 2, CT_zlib; also handles code 1,
 * CT_deprecated raw-deflate, on the read side — treInflate already dispatches both).
 *
 * `inflate` delegates verbatim to the existing treInflate() (Zlib.h) — unchanged
 * behavior, including the ZLIB_MAX_BLOCK bomb cap (T-01-03).
 * `deflate` delegates to the shared treDeflate() free function (Zlib.h/.cpp), the same
 * function TreBuilder::zlibCompress now wraps — avoiding a TreCodec.cpp <-> TreBuilder.cpp
 * circular include in either direction.
 */
struct ZlibCodec final : TreCodec {
    std::vector<uint8_t> inflate(
        int            compressor,
        const uint8_t* src,
        size_t         srcLen,
        size_t         declaredUncomp
    ) const override {
        return treInflate(compressor, src, srcLen, declaredUncomp);
    }

    std::vector<uint8_t> deflate(const std::vector<uint8_t>& src) const override {
        return treDeflate(src.data(), src.size());
    }
};

/**
 * codecForCompressor(compressor) — PAYLOAD READ lookup, keyed by the entry's own
 * `compressor` TOC field. Used at TreArchive::extractEntry / extractAt.
 */
const TreCodec& codecForCompressor(int compressor);

/**
 * codecForTreVersion(version) — PAYLOAD WRITE lookup, keyed by the archive's `version`
 * field. Used at TreBuilder::build's per-entry fresh-build compress call.
 *
 * No codec is registered for V6000 — TreBuilder::build's existing isEnumerateOnly(version)
 * blanket-throw fires before this lookup would ever be reached for V6000.
 */
const TreCodec& codecForTreVersion(int version);

/**
 * codecForBlockCompressor(compressor) — TOC/name-block READ+WRITE lookup (round-3, NEW),
 * keyed on the archive's OWN header fields (tocCompressor / blockCompressor on read; the
 * value TreBuilder itself chooses to emit on write) — a DIFFERENT selection axis from
 * codecForCompressor, since the entry's own compressor is unknown until the TOC has been
 * decoded. Used at TreArchive::parse's TOC/name-block inflate call sites and
 * TreBuilder::build's TOC/name-block deflate call sites.
 */
const TreCodec& codecForBlockCompressor(int compressor);

} // namespace swg
