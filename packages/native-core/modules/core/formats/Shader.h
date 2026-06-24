/**
 * modules/core/formats/Shader.h — Engine-free C++20 SSHT/CSHD shader parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 StaticShaderTemplate.cpp:32-565 (SSHT v0004 full load)
 *   swg-client-v2 StaticShaderTemplate.cpp:671-730 (TXMS form / load_texture)
 *   swg-client-v2 TextureList.cpp:336-354 (TextureList::fetch → NAME → read_string)
 *
 * KEY GROUND-TRUTH FACTS (verified against source):
 *   SSHT structure:
 *     FORM SSHT → FORM 0004 (typical) or FORM 0003/0002/0001/0000
 *       MATS (material block — skip; colour/alpha floats; not needed for texture extraction)
 *       TXMS (texture maps form)
 *         FORM TXM  ← iterates via iff.enterForm(TAG_TXM)
 *           FORM 000x ← version dispatch (0000..0004)
 *             DATA chunk: placeholder bool8 + slot tag (int32)
 *             NAME chunk: texture path (char[] via TextureList::fetch)
 *   CSHD: CustomizableShaderTemplate — wraps a base SSHT + customization variables
 *     (see CustomizableShaderTemplate.cpp for full parsing)
 *     For this pass we extract the base SSHT path and customization var list.
 *
 * Decision D-02: C++20, engine-free.
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include "iff/Iff.h"
#include "Mesh.h"  // FormatParseError

namespace swg_core {
namespace formats {

// ─── Shader result structs ────────────────────────────────────────────────────

struct ShaderSlot {
    std::string slotTag;       // e.g. "MAIN", "NRML", "CNRM", "SPEC", "EMIS", "ENVM", "MASK"
    std::string texturePath;   // e.g. "texture/foo.dds"
    uint32_t    uvSet = 0;     // UV set index (from DATA chunk slot encoding; usually 0)
    bool        isPlaceholder = false; // from placeholder bool8 in DATA
};

struct ShaderCustomizationVar {
    std::string name;           // variable name
    std::string pathway;        // 'palette-material-color' | 'palette-texture-swap' | 'palette-texture-factor'
    std::string palettePath;    // optional palette file path
    int32_t     defaultIndex = 0;
    std::string affectedSlot;   // optional slot name this var affects
};

struct ShaderResult {
    std::string                         variant;    // 'SSHT' or 'CSHD'
    std::string                         version;    // e.g. '0004'
    std::string                         effectPath; // the .eft effect path (from EFCT/PIXL/VTXS block)
    std::vector<ShaderSlot>             slots;
    std::vector<ShaderCustomizationVar> customizationVars;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FORM SSHT shader from an already-parsed IFF tree.
 *
 * Extracts texture slot assignments from the TXMS block.
 * Throws FormatParseError on malformed input.
 *
 * Source: StaticShaderTemplate.cpp:32-730.
 */
ShaderResult parseShader(const swg_core::iff::IffNode& root,
                          const uint8_t* srcData, uint32_t srcSize);

} // namespace formats
} // namespace swg_core
