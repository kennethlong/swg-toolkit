/**
 * modules/core/formats/Shader.cpp — Engine-free C++20 SSHT/CSHD shader parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 StaticShaderTemplate.cpp:671-810 (load_texture + versions 0000/0001/0002)
 *   swg-client-v2 StaticShaderTemplate.cpp:354-404 (TXMS form iteration)
 *   swg-client-v2 TextureList.cpp:336-354 (TextureList::fetch → NAME chunk → read_string)
 *
 * STRUCTURE:
 *   FORM SSHT
 *     FORM 0004 (or 0000..0003)
 *       FORM MATS  (material — skip)
 *       FORM TXMS
 *         FORM TXM   (one per texture slot; iterate until end of TXMS)
 *           FORM 0000 | 0001 | 0002
 *             DATA chunk:
 *               v0000: bool8 placeholder + uint32 tag
 *               v0001,0002: uint32 tag + bool8 placeholder + ... sampler state bytes
 *             NAME chunk: char[] texture path (only if !placeholder)
 *       FORM TCSS  (texture coordinate sets — skip for MVP)
 *       ... (other blocks skipped)
 *
 * TAG ENCODING: IFF tags are stored as big-endian 4-byte ASCII.
 * A Tag is a uint32: e.g. "MAIN" = 0x4D41494E, "NRML" = 0x4E524D4C.
 * We decode them as 4 ASCII characters for the slotTag string.
 *
 * Decision D-02: C++20, engine-free.
 */

#include "Shader.h"
#include <cstring>
#include <cctype>

namespace swg_core {
namespace formats {

// ─── Chunk view helper ─────────────────────────────────────────────────────────

struct ShtChunkView {
    const uint8_t* data;
    uint32_t size;
    uint32_t pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }

    uint8_t readU8() {
        if (!canRead(1)) throw FormatParseError("ShtChunkView: unexpected end");
        return data[pos++];
    }
    // Little-endian uint32 — IFF DATA payload Tags are raw LE uint32 on disk
    // (insertChunkData(tag) = raw memcpy on LE Windows; read_uint32() = raw memcpy back).
    // Source: sharedFile/Iff.h insertChunkData + read_uint32 (both are raw memcpy, LE byte order).
    // CONTRAST: IFF structural tags (FORM/chunk headers) go through htonl/ntohl — BUT DATA
    // payload Tags written by insertChunkData(TAG_MAIN) are stored LE on Windows.
    uint32_t readU32LE() {
        if (!canRead(4)) throw FormatParseError("ShtChunkView: unexpected end");
        uint32_t v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
    // Little-endian float32 — MATL colors are raw LE float32 (Iff read_misc = memcpy, no byteswap).
    float readF32LE() {
        if (!canRead(4)) throw FormatParseError("ShtChunkView: unexpected end (f32)");
        float v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
    std::string readString() {
        std::string s;
        while (pos < size) {
            char c = static_cast<char>(data[pos++]);
            if (c == '\0') break;
            s += c;
        }
        return s;
    }
};

static ShtChunkView shtChunkPayload(const swg_core::iff::IffNode& leaf,
                                     const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("shtChunkPayload: called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize) {
        throw FormatParseError("shtChunkPayload: chunk extends beyond source buffer");
    }
    return { srcData + payloadStart, payloadLen, 0 };
}

// Convert big-endian uint32 tag to string ("MAIN", "NRML", etc.)
static std::string tagToString(uint32_t tag) {
    char buf[5];
    buf[0] = static_cast<char>((tag >> 24) & 0xFF);
    buf[1] = static_cast<char>((tag >> 16) & 0xFF);
    buf[2] = static_cast<char>((tag >>  8) & 0xFF);
    buf[3] = static_cast<char>((tag      ) & 0xFF);
    buf[4] = '\0';
    // Trim trailing spaces
    for (int i = 3; i >= 0; --i) {
        if (buf[i] == ' ') buf[i] = '\0';
        else break;
    }
    return std::string(buf);
}

// ─── Parse one FORM TXM slot ──────────────────────────────────────────────────

// Returns a ShaderSlot, or nullopt if malformed / placeholder.
// In all versions the slot tag encodes the semantic (MAIN, NRML, etc.).
//
// v0000: DATA = {bool8 placeholder, uint32 tagBE}; NAME follows if !placeholder
// v0001: DATA = {uint32 tagBE, bool8 placeholder, 6x uint8 sampler state}
// v0002: DATA = {uint32 tagBE, bool8 placeholder, 6x uint8 + uint8 maxAnisotropy}
// NAME chunk immediately follows DATA if !placeholder

static bool parseTxmSlot(
    const swg_core::iff::IffNode& txmVerForm,   // FORM 0000/0001/0002
    const uint8_t* srcData, uint32_t srcSize,
    ShaderSlot& outSlot)
{
    // Determine version
    bool isV0000 = (strncmp(txmVerForm.subType, "0000", 4) == 0);

    // Find DATA chunk
    const swg_core::iff::IffNode* dataNode = nullptr;
    for (const auto& child : txmVerForm.children) {
        if (!child.isForm && strncmp(child.tag, "DATA", 4) == 0) {
            dataNode = &child; break;
        }
    }
    if (!dataNode) return false;

    auto dataCv = shtChunkPayload(*dataNode, srcData, srcSize);
    std::string slotTag;
    bool placeholder;

    if (isV0000) {
        // v0000: bool8 placeholder, uint32 tag
        placeholder = (dataCv.readU8() != 0);
        uint32_t tag = dataCv.readU32LE();
        slotTag = tagToString(tag);
    } else {
        // v0001 / v0002: uint32 tag, bool8 placeholder, sampler state...
        uint32_t tag = dataCv.readU32LE();
        slotTag = tagToString(tag);
        placeholder = (dataCv.readU8() != 0);
    }

    // ENVM tags are always treated as placeholder by the engine.
    // Bug-1 fix: force placeholder=true for ENVM (matching client StaticShaderTemplate.cpp:708-709)
    // BUT preserve the texturePath read below — the env texture path (e.g. "texture/env_theed.dds")
    // IS stored in the NAME chunk and IS needed by the renderer to fetch the cube map.
    // We keep isPlaceholder=true so the client semantics are preserved; we just don't skip the NAME.
    if (slotTag == "ENVM") placeholder = true;

    // Find NAME chunk
    const swg_core::iff::IffNode* nameNode = nullptr;
    for (const auto& child : txmVerForm.children) {
        if (!child.isForm && strncmp(child.tag, "NAME", 4) == 0) {
            nameNode = &child; break;
        }
    }

    std::string texturePath;
    // Bug-1 fix: for ENVM slots, read the NAME chunk even though placeholder=true.
    // The env texture path (e.g. "texture/env_theed.dds") must survive into ShaderSlot.texturePath
    // so the renderer can fetch and build the cube map. For all other placeholder slots, the NAME
    // chunk is genuinely absent from the file, so the existing guard is correct there.
    bool readName = (!placeholder && nameNode) || (slotTag == "ENVM" && nameNode);
    if (readName) {
        auto nameCv = shtChunkPayload(*nameNode, srcData, srcSize);
        texturePath = nameCv.readString();
    }

    outSlot.slotTag       = slotTag;
    outSlot.texturePath   = texturePath;
    outSlot.uvSet         = 0;  // UV set extracted from TCSS block if needed (MVP: default 0)
    outSlot.isPlaceholder = placeholder;
    return true;
}

// ─── MATL material colors ──────────────────────────────────────────────────────
// MATS → FORM 0000 → MATL leaf (68 bytes = 4×VectorArgb[A,R,G,B] + specularPower).
// We keep rgb only (drop each color's alpha). Source: Material.cpp:64-72, Iff.cpp:1732 (A,R,G,B order).
static void readMatl(const swg_core::iff::IffNode& versionForm,
                     const uint8_t* srcData, uint32_t srcSize,
                     ShaderMaterial& out)
{
    const swg_core::iff::IffNode* mats = nullptr;
    for (const auto& c : versionForm.children) {
        if (c.isForm && strncmp(c.subType, "MATS", 4) == 0) { mats = &c; break; }
    }
    if (!mats) return;

    // MATS → FORM 0000 → MATL leaf. Tolerate a flatter layout (MATL directly under MATS).
    auto findMatl = [](const swg_core::iff::IffNode& form) -> const swg_core::iff::IffNode* {
        for (const auto& c : form.children) {
            if (!c.isForm && strncmp(c.tag, "MATL", 4) == 0) return &c;
        }
        return nullptr;
    };
    const swg_core::iff::IffNode* matl = findMatl(*mats);
    if (!matl) {
        for (const auto& sub : mats->children) {
            if (sub.isForm) { matl = findMatl(sub); if (matl) break; }
        }
    }
    if (!matl) return;

    auto cv = shtChunkPayload(*matl, srcData, srcSize);
    // Each VectorArgb = A,R,G,B; discard A, keep rgb.
    auto rgb = [&](float* dst) { cv.readF32LE(); dst[0] = cv.readF32LE(); dst[1] = cv.readF32LE(); dst[2] = cv.readF32LE(); };
    rgb(out.ambient);
    rgb(out.diffuse);
    rgb(out.emissive);
    rgb(out.specular);
    out.specularPower = cv.readF32LE();
    out.present = true;
}

// ─── Parse a FORM SSHT body into result (slots + effectPath + material) ─────────
// Shared by the plain-SSHT path and the CSHD path (whose nested SSHT is delegated here).
static void parseSshtBody(const swg_core::iff::IffNode& sshtRoot,
                          const uint8_t* srcData, uint32_t srcSize,
                          ShaderResult& result)
{
    // Find the version FORM (0000..0004)
    const swg_core::iff::IffNode* versionForm = nullptr;
    for (const auto& child : sshtRoot.children) {
        if (child.isForm) { versionForm = &child; break; }
    }
    if (!versionForm) throw FormatParseError("FORM SSHT: missing version form");
    result.version = std::string(versionForm->subType, 4);

    // Find FORM TXMS inside version form
    const swg_core::iff::IffNode* txmsForm = nullptr;
    for (const auto& child : versionForm->children) {
        if (child.isForm && strncmp(child.subType, "TXMS", 4) == 0) {
            txmsForm = &child; break;
        }
    }

    // TXMS may be absent for shaders with no textures (procedural)
    if (txmsForm) {
        // Iterate TXM children of TXMS
        // Source: StaticShaderTemplate.cpp:354-360:
        //   while (!iff.atEndOfForm()) load_texture(iff);
        // load_texture() calls iff.enterForm(TAG_TXM) then dispatches version
        for (const auto& child : txmsForm->children) {
            if (!child.isForm) continue;
            // child should be FORM TXM
            if (strncmp(child.subType, "TXM ", 4) != 0 &&
                strncmp(child.subType, "TXM\0", 4) != 0 &&
                strncmp(child.subType, "TXM", 3) != 0) continue;

            // TXM contains a version FORM
            for (const auto& txmChild : child.children) {
                if (!txmChild.isForm) continue;
                // version form 0000, 0001, 0002
                ShaderSlot slot;
                if (parseTxmSlot(txmChild, srcData, srcSize, slot)) {
                    result.slots.push_back(std::move(slot));
                }
                break; // only one version form per TXM
            }
        }
    }

    // Bug-2 fix: read effectPath from the NAME chunk (or EFCT FORM) inside the version form.
    //
    // Ground truth (ShaderEffectList::fetch in ShaderEffectList.cpp:172-233):
    //   The method checks iff.getCurrentName():
    //     TAG_NAME → reads a cstring from the NAME chunk (path to .eft file, e.g. "effect/a_envmask_specmap.eft")
    //     TAG_EFCT → the effect is inlined as a FORM EFCT (parse the whole thing)
    //   In SSHT v0000 the effect comes LAST (after all other blocks) per StaticShaderTemplate.cpp:323.
    //   In SSHT v0001 the effect comes FIRST (before MATS/TXMS) per StaticShaderTemplate.cpp:486.
    //
    // Our IFF tree has already parsed all children. Scan the version form's children for:
    //   (a) a leaf NAME chunk   → read the cstring = effectPath
    //   (b) a FORM EFCT         → we don't parse it; just record the tag so we know it was inline
    // We don't need to parse the EFCT itself — the renderer approximates the effect in GLSL.
    result.effectPath = "";
    for (const auto& child : versionForm->children) {
        if (!child.isForm && strncmp(child.tag, "NAME", 4) == 0) {
            // NAME chunk: read the effect path cstring
            auto cv = shtChunkPayload(child, srcData, srcSize);
            result.effectPath = cv.readString();
            break;
        }
        if (child.isForm && strncmp(child.subType, "EFCT", 4) == 0) {
            // Inline EFCT FORM: set a synthetic path token so the renderer knows an effect is present
            // but we do not need to parse the raw HLSL bytecode inside it for our GLSL approximation.
            result.effectPath = "effect/__inline.eft";
            break;
        }
    }

    // Material colors (MATS → MATL). Absent ⇒ material.present stays false (identity defaults).
    readMatl(*versionForm, srcData, srcSize, result.material);
}

// ─── Find a nested FORM SSHT (depth-first) ──────────────────────────────────────
// CSHD wraps a full SSHT: FORM CSHD → FORM 0001 → FORM SSHT → … (Source: CSHD A2).
static const swg_core::iff::IffNode* findNestedSsht(const swg_core::iff::IffNode& node) {
    for (const auto& c : node.children) {
        if (c.isForm && strncmp(c.subType, "SSHT", 4) == 0) return &c;
        if (c.isForm) { if (auto* r = findNestedSsht(c)) return r; }
    }
    return nullptr;
}

// ─── parseShader (public) ─────────────────────────────────────────────────────

ShaderResult parseShader(const swg_core::iff::IffNode& root,
                          const uint8_t* srcData, uint32_t srcSize)
{
    ShaderResult result;

    if (!root.isForm) throw FormatParseError("parseShader: root is not a FORM");

    if (strncmp(root.subType, "SSHT", 4) == 0) {
        result.variant = "SSHT";
        parseSshtBody(root, srcData, srcSize, result);
    } else if (strncmp(root.subType, "CSHD", 4) == 0) {
        // CSHD wraps a full SSHT (material + texture maps) + customization. Delegate to the
        // shared SSHT body so slots/material come through in plain-SSHT shape (the resolver's
        // texture-fetch path needs no change). Keep variant='CSHD'. The CSHD-level palette/
        // texture-factor customization (TFAC/MATR/TXTR) is a tracked follow-up — until wired,
        // the base diffuse renders (no longer a white 1×1 fallback).
        result.variant = "CSHD";
        const swg_core::iff::IffNode* nestedSsht = findNestedSsht(root);
        if (nestedSsht) {
            parseSshtBody(*nestedSsht, srcData, srcSize, result);
        }
    } else {
        throw FormatParseError("parseShader: root is not FORM SSHT or CSHD");
    }

    // CSHD customization vars (CUST/TFAC/MATR) — not parsed yet (tracked follow-up).
    result.customizationVars.clear();

    return result;
}

} // namespace formats
} // namespace swg_core
