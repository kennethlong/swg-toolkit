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
    // Big-endian uint32 (IFF tag encoding)
    uint32_t readU32BE() {
        if (!canRead(4)) throw FormatParseError("ShtChunkView: unexpected end");
        uint32_t v = (static_cast<uint32_t>(data[pos+0]) << 24) |
                     (static_cast<uint32_t>(data[pos+1]) << 16) |
                     (static_cast<uint32_t>(data[pos+2]) <<  8) |
                     (static_cast<uint32_t>(data[pos+3])      );
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
        uint32_t tag = dataCv.readU32BE();
        slotTag = tagToString(tag);
    } else {
        // v0001 / v0002: uint32 tag, bool8 placeholder, sampler state...
        uint32_t tag = dataCv.readU32BE();
        slotTag = tagToString(tag);
        placeholder = (dataCv.readU8() != 0);
    }

    // ENVM tags are always treated as placeholder by the engine
    if (slotTag == "ENVM") placeholder = true;

    // Find NAME chunk
    const swg_core::iff::IffNode* nameNode = nullptr;
    for (const auto& child : txmVerForm.children) {
        if (!child.isForm && strncmp(child.tag, "NAME", 4) == 0) {
            nameNode = &child; break;
        }
    }

    std::string texturePath;
    if (!placeholder && nameNode) {
        auto nameCv = shtChunkPayload(*nameNode, srcData, srcSize);
        texturePath = nameCv.readString();
    }

    outSlot.slotTag       = slotTag;
    outSlot.texturePath   = texturePath;
    outSlot.uvSet         = 0;  // UV set extracted from TCSS block if needed (MVP: default 0)
    outSlot.isPlaceholder = placeholder;
    return true;
}

// ─── parseShader (public) ─────────────────────────────────────────────────────

ShaderResult parseShader(const swg_core::iff::IffNode& root,
                          const uint8_t* srcData, uint32_t srcSize)
{
    ShaderResult result;

    // root must be FORM SSHT or FORM CSHD
    if (!root.isForm) throw FormatParseError("parseShader: root is not a FORM");

    if (strncmp(root.subType, "SSHT", 4) == 0) {
        result.variant = "SSHT";
    } else if (strncmp(root.subType, "CSHD", 4) == 0) {
        result.variant = "CSHD";
    } else {
        throw FormatParseError("parseShader: root is not FORM SSHT or CSHD");
    }

    // Find the version FORM (0000..0004 for SSHT; for CSHD may differ)
    const swg_core::iff::IffNode* versionForm = nullptr;
    for (const auto& child : root.children) {
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

    // effectPath: extracted from EFCT/PIXL block — skip for MVP (empty string)
    result.effectPath = "";

    // For CSHD, customization vars would be in a CUST block — skip for MVP
    // (CustomizableShaderTemplate.cpp handles that path)
    result.customizationVars.clear();

    return result;
}

} // namespace formats
} // namespace swg_core
