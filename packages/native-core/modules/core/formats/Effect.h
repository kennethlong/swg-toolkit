/**
 * modules/core/formats/Effect.h — Engine-free C++20 FORM EFCT (.eft) effect parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 ShaderEffect.cpp:86-179 (ShaderEffect::load, load_0000, load_0001)
 *   swg-client-v2 ShaderImplementation.cpp:180-236 (ShaderImplementation::load + versions)
 *   swg-client-v2 ShaderImplementation.cpp:1692-1738 (ShaderImplementationPass::load_0009, PASS DATA)
 *   swg-client-v2 ShaderImplementation.cpp:2600-2651 (ShaderImplementationPassPixelShader PPSH 0001)
 *   swg-client-v2 ShaderImplementation.cpp:3113-3181 (ShaderImplementationPassPixelShaderTextureSampler PTXM)
 *
 * STRUCTURE (EFCT version 0000 / 0001):
 *   FORM EFCT
 *     FORM 0000 or 0001
 *       DATA { int8 numImpls, bool8 precalcVtxLighting }   (v0001 only; v0000 has different shape)
 *       FORM IMPL ... (one per capability tier, numImpls entries)
 *         FORM 0002..0005
 *           SCAP chunk  (int32 shaderCapability levels)
 *           OPTN chunk  (optional uint32 tags e.g. "DOT3", "HIQL")
 *           DATA chunk  (int8 passCount, uint32 phaseTag; v0005 adds bool8 castsShadows/isCollidable)
 *           FORM PASS (per pass)
 *             FORM 0007..0009
 *               DATA chunk (56B blend state — ShaderImplementationPass::load_0009)
 *               FORM PVSH { 0000: cstring vsh path }
 *               FORM PPSH { FORM 0001: DATA{ int8 nSamplers, cstring psh path }
 *                                       FORM PTXM x nSamplers: {0002: int8 textureIndex, uint32 textureTag(LE)} }
 *               -- OR --
 *               FORM PFFP + FORM STAG (fixed-function path, we also walk it for sampler tags)
 *
 * PTXM tag byte-order (LOCKED — verified vs PTXM load_0002):
 *   The textureTag is read with iff.read_uint32() which is a raw memcpy (LE on Windows).
 *   So bytes 00 4E 49 41 4D are: textureIndex=0x00, then tag bytes 4E 49 41 4D = 'NIAM' as LE uint32
 *   = 0x4D41494E = 'MAIN' in big-endian ASCII. This matches the DATA payload LE convention.
 *
 * IMPL SELECTION RULE (mirrors ShaderEffectList / ShaderImplementationList::fetch):
 *   Iterate all IMPLs. For each: check if SCAP contains a valid level AND PPSH/PTXM samplers exist.
 *   Pick the IMPL with the highest max SCAP value that has readable PTXM samplers.
 *   We don't validate capability at parse time (no GPU context) — we pick the highest-SCAP IMPL
 *   with PTXM entries (the one most likely to have the richest sampler role map).
 *
 * Decision D-02: C++20, engine-free.
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <optional>
#include <stdexcept>
#include "iff/Iff.h"
#include "Mesh.h"  // FormatParseError

namespace swg_core {
namespace formats {

// ─── Effect result structs ────────────────────────────────────────────────────

/**
 * One texture sampler from a PTXM entry.
 * Represents the mapping from a hardware texture slot (textureIndex) to a
 * semantic role (role = e.g. "MAIN", "SPEC", "ENVM", "CNRM", "NRML", "EMIS", "MASK").
 *
 * Source: ShaderImplementationPassPixelShaderTextureSampler::load_0002 (:3175-3181)
 *         textureIndex = int8, textureTag = uint32 (LE raw on Windows)
 */
struct EffectSampler {
    int8_t      index;   // hardware sampler slot index (0-based)
    std::string role;    // semantic role decoded from textureTag ("MAIN", "SPEC", "ENVM", etc.)
};

/**
 * Blend state extracted from the PASS DATA chunk (ShaderImplementationPass::load_0009).
 * We only extract the fields relevant for transparent/opaque/alpha-test classification.
 *
 * Source: ShaderImplementation.cpp:1692-1738 (load_0009 DATA chunk 56-byte layout)
 */
struct EffectBlend {
    bool  alphaBlendEnable   = false;
    int8_t blendOperation    = 0;    // BlendOperation enum (1 = ADD)
    int8_t blendSrc          = 0;    // Blend enum (5 = SRC_ALPHA)
    int8_t blendDst          = 0;    // Blend enum (6 = INV_SRC_ALPHA)
    bool  alphaTestEnable    = false;
    int8_t alphaTestFunc     = 0;    // Compare enum (7 = GREATER)
    uint8_t alphaTestRef     = 0;    // reference value (from ARVS block in .sht — 0 default)
    bool  zWrite             = true; // depth write (true = opaque default)
};

/**
 * One parsed IMPL (capability tier) from the EFCT.
 * Contains the blend state (from the first PASS DATA) and sampler role map (from PTXM entries).
 */
struct EffectImpl {
    /** Raw SCAP values from the SCAP chunk. Used for highest-SCAP selection. */
    std::vector<int32_t> scapValues;
    /** Optional tags (e.g. "DOT3", "HIQL") from OPTN chunk. */
    std::vector<std::string> options;
    /** Blend state from the FIRST PASS DATA chunk (there's usually only one pass). */
    EffectBlend blend;
    /** Sampler role map from all PTXM entries in PPSH. */
    std::vector<EffectSampler> samplers;
};

/**
 * Full result of parseEffect().
 *
 * The "best" IMPL is the one with the highest max SCAP value that has PTXM samplers.
 * bestImplIndex == -1 if no suitable IMPL was found.
 */
struct EffectResult {
    std::string              formatTag;      // "EFCT"
    std::string              version;        // "0000" or "0001"
    std::vector<EffectImpl>  impls;          // all parsed IMPLs (in file order)
    int                      bestImplIndex;  // index into impls[] of the selected IMPL (-1 if none)
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM EFCT (.eft) shader effect from an already-parsed IFF tree.
 *
 * Walks all IMPL capability tiers. For each IMPL: extracts the SCAP levels, OPTN tags,
 * blend state (PASS DATA), and sampler role map (PTXM entries in PPSH).
 * Selects the best IMPL (highest max SCAP with sampler entries).
 *
 * Throws FormatParseError on malformed input.
 *
 * Source: ShaderEffect.cpp:86-179 + ShaderImplementation.cpp (IMPL → PASS → PPSH → PTXM).
 */
EffectResult parseEffect(const swg_core::iff::IffNode& root,
                          const uint8_t* srcData, uint32_t srcSize);

} // namespace formats
} // namespace swg_core
