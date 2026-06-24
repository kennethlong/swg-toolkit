/**
 * modules/core/formats/Effect.cpp — Engine-free C++20 FORM EFCT (.eft) shader effect parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 ShaderEffect.cpp:86-179         (load, load_0000, load_0001)
 *   swg-client-v2 ShaderImplementation.cpp:180-236 (ShaderImplementation::load)
 *   swg-client-v2 ShaderImplementation.cpp:1692-1738 (ShaderImplementationPass::load_0009 DATA)
 *   swg-client-v2 ShaderImplementation.cpp:2600-2651 (ShaderImplementationPassPixelShader PPSH 0001)
 *   swg-client-v2 ShaderImplementation.cpp:3113-3181 (PTXM load_0000/0001/0002)
 *
 * Decision D-02: C++20, engine-free (no N-API, no SOE engine headers).
 */

#include "Effect.h"
#include <cstring>
#include <algorithm>

namespace swg_core {
namespace formats {

// ─── Chunk view helper ─────────────────────────────────────────────────────────

struct EfctChunkView {
    const uint8_t* data;
    uint32_t       size;
    uint32_t       pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }

    uint8_t readU8() {
        if (!canRead(1)) throw FormatParseError("EfctChunkView: unexpected end");
        return data[pos++];
    }
    int8_t readI8() {
        return static_cast<int8_t>(readU8());
    }
    bool readBool8() {
        return readU8() != 0;
    }
    // Little-endian uint32 (DATA payload tags on LE Windows)
    uint32_t readU32LE() {
        if (!canRead(4)) throw FormatParseError("EfctChunkView: unexpected end");
        uint32_t v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
    // Big-endian int32 (SCAP capability levels stored with htonl/ntohl)
    int32_t readI32BE() {
        if (!canRead(4)) throw FormatParseError("EfctChunkView: unexpected end");
        uint32_t raw;
        std::memcpy(&raw, data + pos, 4);
        pos += 4;
        // Swap bytes: IFF structural integers are big-endian
        uint32_t be = ((raw & 0xFF000000u) >> 24) |
                      ((raw & 0x00FF0000u) >>  8) |
                      ((raw & 0x0000FF00u) <<  8) |
                      ((raw & 0x000000FFu) << 24);
        return static_cast<int32_t>(be);
    }
    std::string readCString() {
        std::string s;
        while (pos < size) {
            char c = static_cast<char>(data[pos++]);
            if (c == '\0') break;
            s += c;
        }
        return s;
    }
    // Skip N bytes
    void skip(uint32_t n) {
        if (pos + n > size) pos = size;
        else pos += n;
    }
    uint32_t bytesLeft() const { return pos < size ? size - pos : 0; }
};

static EfctChunkView efctChunkPayload(const swg_core::iff::IffNode& leaf,
                                       const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("efctChunkPayload: called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize)
        throw FormatParseError("efctChunkPayload: chunk extends beyond source buffer");
    return { srcData + payloadStart, payloadLen, 0 };
}

// Convert a texture-role tag stored LE uint32 to its canonical BE ASCII string.
//
// Ground-truth (swg-client-v2 ShaderImplementation.cpp:3145-3181):
//   TAG_MAIN = TAG('M','A','I','N') = 0x4D41494E (BE 4-char convention).
//   iff.read_uint32() = memcpy 4 bytes LE → on disk the bytes are 4E 49 41 4D.
//   memcpy LE → CPU register = 0x4D41494E (same value; LE memcpy on LE CPU gives BE value).
//   The high byte (0x4D = 'M') is the FIRST character in the canonical BE tag string.
//
// So: leTag = 0x4D41494E → buf = "MAIN" (read high-byte-first).
static std::string tagToRoleString(uint32_t leTag) {
    char buf[5];
    buf[0] = static_cast<char>((leTag >> 24) & 0xFF);  // high byte = first char ('M' for MAIN)
    buf[1] = static_cast<char>((leTag >> 16) & 0xFF);
    buf[2] = static_cast<char>((leTag >>  8) & 0xFF);
    buf[3] = static_cast<char>((leTag      ) & 0xFF);  // low byte = last char ('N' for MAIN)
    buf[4] = '\0';
    // Trim trailing spaces (some tags are space-padded)
    for (int i = 3; i >= 0; --i) {
        if (buf[i] == ' ') buf[i] = '\0';
        else break;
    }
    return std::string(buf);
}

// Find a direct child chunk (leaf) by 4-char tag
static const swg_core::iff::IffNode* findChunk(
    const swg_core::iff::IffNode& parent, const char* tag4)
{
    for (const auto& child : parent.children) {
        if (!child.isForm && strncmp(child.tag, tag4, 4) == 0)
            return &child;
    }
    return nullptr;
}

// Find a direct child form by subType
static const swg_core::iff::IffNode* findForm(
    const swg_core::iff::IffNode& parent, const char* subType4)
{
    for (const auto& child : parent.children) {
        if (child.isForm && strncmp(child.subType, subType4, 4) == 0)
            return &child;
    }
    return nullptr;
}

// ─── PTXM sampler parser ─────────────────────────────────────────────────────

// Parse one FORM PTXM entry, returning an EffectSampler.
// PTXM dispatches on version: 0000, 0001, 0002.
//   v0002 (most common): DATA{ int8 textureIndex, uint32 textureTag(LE) }
//   v0001: DATA{ int8 textureIndex, uint32 textureTag(LE), uint32 tcSetTag, uint8 tcGen }
//   v0000: DATA{ int8 textureIndex, uint32 textureTag(LE), uint32 tcSetTag,
//                uint8 addrU/V/W, mipFilter, minFilter, magFilter, tcGen }
// Source: ShaderImplementation.cpp:3145-3181

static std::optional<EffectSampler> parsePtxm(
    const swg_core::iff::IffNode& ptxmForm,
    const uint8_t* srcData, uint32_t srcSize)
{
    // PTXM should have one version child form
    for (const auto& verChild : ptxmForm.children) {
        if (!verChild.isForm) continue;

        // Find DATA chunk inside the version form
        const auto* dataNode = findChunk(verChild, "DATA");
        if (!dataNode) continue;

        auto cv = efctChunkPayload(*dataNode, srcData, srcSize);
        int8_t  textureIndex = cv.readI8();
        uint32_t textureTag  = cv.readU32LE();

        EffectSampler sampler;
        sampler.index = textureIndex;
        sampler.role  = tagToRoleString(textureTag);
        return sampler;
    }
    return std::nullopt;
}

// ─── PPSH (pixel shader) parser ──────────────────────────────────────────────

// Parse a FORM PPSH, extracting sampler PTXM entries.
// Structure: PPSH → FORM 0001 → DATA{int8 nSamplers, cstring pshPath} → FORM PTXM x nSamplers
// Source: ShaderImplementationPassPixelShader::load_0001 (:2624-2651)

static std::vector<EffectSampler> parsePpsh(
    const swg_core::iff::IffNode& ppshForm,
    const uint8_t* srcData, uint32_t srcSize)
{
    std::vector<EffectSampler> samplers;

    // Find FORM 0001 inside PPSH
    const auto* ver0001 = findForm(ppshForm, "0001");
    if (!ver0001) return samplers;

    // Find DATA chunk: int8 nSamplers, cstring pshPath
    const auto* dataNode = findChunk(*ver0001, "DATA");
    if (!dataNode) return samplers;

    auto cv = efctChunkPayload(*dataNode, srcData, srcSize);
    const int nSamplers = cv.readI8();
    // Skip psh path cstring (we don't need the HLSL bytecode path)
    (void)cv.readCString();

    // Collect PTXM children
    int found = 0;
    for (const auto& child : ver0001->children) {
        if (found >= nSamplers) break;
        if (!child.isForm || strncmp(child.subType, "PTXM", 4) != 0) continue;
        auto sampler = parsePtxm(child, srcData, srcSize);
        if (sampler) {
            samplers.push_back(std::move(*sampler));
            ++found;
        }
    }

    return samplers;
}

// ─── PASS blend state parser ─────────────────────────────────────────────────

// Parse the DATA chunk from a PASS version form (e.g. FORM 0009).
// Extracts the blend state fields we care about.
// Source: ShaderImplementation.cpp:1692-1738 (load_0009 DATA chunk)
//
// Layout (56 bytes total for 0009):
//  int8  numberOfStages
//  int8  shadeMode
//  int8  fogMode
//  bool8 ditherEnable
//  bool8 zEnable
//  bool8 zWrite
//  int8  zCompare
//  bool8 alphaBlendEnable
//  int8  alphaBlendOperation
//  int8  alphaBlendSource
//  int8  alphaBlendDestination
//  bool8 alphaTestEnable
//  uint32 alphaTestReferenceValueTag (BE IFF structural tag)
//  int8  alphaTestFunction
//  ... (writeEnable, textureFactorTag x2, textureScrollTag, stencil block, materialTag)

static EffectBlend parsePassData(
    const swg_core::iff::IffNode& passVerForm,
    const uint8_t* srcData, uint32_t srcSize)
{
    EffectBlend blend; // defaults: opaque

    const auto* dataNode = findChunk(passVerForm, "DATA");
    if (!dataNode) return blend;

    auto cv = efctChunkPayload(*dataNode, srcData, srcSize);
    if (cv.bytesLeft() < 14) return blend; // too short to be valid

    cv.skip(1);  // int8 numberOfStages
    cv.skip(1);  // int8 shadeMode
    cv.skip(1);  // int8 fogMode
    cv.skip(1);  // bool8 ditherEnable
    cv.skip(1);  // bool8 zEnable

    blend.zWrite = cv.readBool8();   // bool8 zWrite
    cv.skip(1);  // int8 zCompare

    blend.alphaBlendEnable = cv.readBool8();
    blend.blendOperation   = cv.readI8();
    blend.blendSrc         = cv.readI8();
    blend.blendDst         = cv.readI8();

    blend.alphaTestEnable = cv.readBool8();
    cv.skip(4);  // uint32 alphaTestReferenceValueTag (BE IFF tag — we use the .sht ARVS value)
    blend.alphaTestFunc   = cv.readI8();

    return blend;
}

// ─── IMPL parser ─────────────────────────────────────────────────────────────

// Parse one FORM IMPL capability tier.
// IMPL contains a version form (0002..0005), inside which we find:
//   SCAP chunk, optional OPTN chunk, DATA chunk, one or more FORM PASS.
// Source: ShaderImplementation.cpp:180-236, load_0002..load_0005

static EffectImpl parseImpl(
    const swg_core::iff::IffNode& implForm,
    const uint8_t* srcData, uint32_t srcSize)
{
    EffectImpl impl;

    // IMPL has one version form child
    for (const auto& verChild : implForm.children) {
        if (!verChild.isForm) continue;

        // ─── SCAP chunk ───────────────────────────────────────────────────
        const auto* scapNode = findChunk(verChild, "SCAP");
        if (scapNode) {
            auto cv = efctChunkPayload(*scapNode, srcData, srcSize);
            while (cv.bytesLeft() >= 4) {
                impl.scapValues.push_back(cv.readI32BE());
            }
        }

        // ─── OPTN chunk ───────────────────────────────────────────────────
        const auto* optnNode = findChunk(verChild, "OPTN");
        if (optnNode) {
            auto cv = efctChunkPayload(*optnNode, srcData, srcSize);
            while (cv.bytesLeft() >= 4) {
                // OPTN tags are BE (IFF structural, read via ntohl)
                // We read as BE uint32 → convert to string
                if (!cv.canRead(4)) break;
                uint32_t rawBE;
                std::memcpy(&rawBE, cv.data + cv.pos, 4);
                cv.pos += 4;
                // Swap to host order for character extraction (store raw BE as big-endian string)
                char buf[5];
                buf[0] = static_cast<char>((rawBE      ) & 0xFF); // raw BE byte 0 = high byte
                // Actually: rawBE is already in host LE memory order but represents BE on-disk.
                // On LE Windows, ntohl would swap. Since we memcpy'd, rawBE bytes are in disk BE order.
                // Byte 0 of rawBE (lowest address) = high byte of tag.
                buf[0] = static_cast<char>((rawBE >> 24) & 0xFF);
                buf[1] = static_cast<char>((rawBE >> 16) & 0xFF);
                buf[2] = static_cast<char>((rawBE >>  8) & 0xFF);
                buf[3] = static_cast<char>((rawBE      ) & 0xFF);
                buf[4] = '\0';
                impl.options.emplace_back(buf);
            }
        }

        // ─── PASS forms → blend state + samplers ─────────────────────────
        for (const auto& passForm : verChild.children) {
            if (!passForm.isForm || strncmp(passForm.subType, "PASS", 4) != 0) continue;

            // PASS has a version form (0007, 0008, 0009)
            for (const auto& passVerForm : passForm.children) {
                if (!passVerForm.isForm) continue;

                // Extract blend state from DATA chunk (once, from first PASS)
                if (impl.samplers.empty()) {
                    impl.blend = parsePassData(passVerForm, srcData, srcSize);
                }

                // Look for FORM PPSH (pixel shader path)
                const auto* ppshForm = findForm(passVerForm, "PPSH");
                if (ppshForm) {
                    auto samps = parsePpsh(*ppshForm, srcData, srcSize);
                    for (auto& s : samps)
                        impl.samplers.push_back(std::move(s));
                }

                break; // first version form only per PASS
            }
        }

        break; // first version form only per IMPL
    }

    return impl;
}

// ─── parseEffect (public) ─────────────────────────────────────────────────────

EffectResult parseEffect(const swg_core::iff::IffNode& root,
                          const uint8_t* srcData, uint32_t srcSize)
{
    EffectResult result;
    result.bestImplIndex = -1;

    if (!root.isForm || strncmp(root.subType, "EFCT", 4) != 0)
        throw FormatParseError("parseEffect: root is not FORM EFCT");

    result.formatTag = "EFCT";

    // EFCT has one version form child (0000 or 0001)
    const swg_core::iff::IffNode* versionForm = nullptr;
    for (const auto& child : root.children) {
        if (child.isForm) { versionForm = &child; break; }
    }
    if (!versionForm)
        throw FormatParseError("FORM EFCT: missing version form");

    result.version = std::string(versionForm->subType, 4);

    // Both version 0000 and 0001 have IMPL children inside the version form.
    // v0001 also has a leading DATA chunk (numImpls, precalcVtxLighting) — we skip it.
    // v0000 uses numImpls from its DATA chunk too.
    // In both cases, just iterate the FORM IMPL children.
    // Source: ShaderEffect::load_0000/load_0001 — both loop fetching IMPL forms.

    for (const auto& child : versionForm->children) {
        if (!child.isForm || strncmp(child.subType, "IMPL", 4) != 0) continue;
        result.impls.push_back(parseImpl(child, srcData, srcSize));
    }

    // Select best IMPL: highest max SCAP value that has at least one sampler entry.
    // Rationale: matches "pick the highest-SCAP IMPL with a readable PPSH" selection.
    // When no SCAP is present (inline effect), pick the last IMPL with samplers.
    int32_t bestScap = INT32_MIN;
    for (int i = 0; i < static_cast<int>(result.impls.size()); ++i) {
        const auto& impl = result.impls[i];
        // An IMPL must have at least one sampler to be useful
        if (impl.samplers.empty() && !impl.scapValues.empty()) {
            // IMPL with SCAP but no samplers — might be a fixed-function fallback, skip
            continue;
        }
        // Pick IMPL with highest max SCAP, or first one if no SCAP data
        int32_t maxScap = impl.scapValues.empty()
            ? 0
            : *std::max_element(impl.scapValues.begin(), impl.scapValues.end());

        if (result.bestImplIndex == -1 || maxScap >= bestScap) {
            bestScap = maxScap;
            result.bestImplIndex = i;
        }
    }

    // If no IMPL had samplers, pick the highest-SCAP IMPL anyway (may be fixed-function)
    if (result.bestImplIndex == -1 && !result.impls.empty()) {
        int32_t maxSeen = INT32_MIN;
        for (int i = 0; i < static_cast<int>(result.impls.size()); ++i) {
            const auto& impl = result.impls[i];
            int32_t ms = impl.scapValues.empty()
                ? 0
                : *std::max_element(impl.scapValues.begin(), impl.scapValues.end());
            if (ms >= maxSeen) { maxSeen = ms; result.bestImplIndex = i; }
        }
    }

    return result;
}

} // namespace formats
} // namespace swg_core
