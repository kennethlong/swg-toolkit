/**
 * packages/contracts/src/material.ts — Shader/palette/DDS/LOD contract types.
 *
 * Covers: .sht (SSHT/CSHD), .pal (RIFF PAL), .dds (DDS header+mip table), .lmg/.ldt (MLOD/LDTB).
 *
 * DDS and PAL are NOT IFF formats:
 *   .dds — Microsoft DDS binary (128-byte header + compressed block data, NOT IFF)
 *   .pal — Microsoft RIFF PAL (24-byte header + R,G,B,A entries, NOT IFF)
 * Their roundTrip field documents a PARSER-NATIVE round-trip:
 *   parsePalette/parseDds → in-memory struct → serializePalette/serializeDds → bytes
 * NOT the generic-IFF serializeIff(parseIff(bytes)) round-trip.
 * This distinction is critical: the harness registers parser-native serialize functions
 * for these two formats, not the IFF pair.
 *
 * .sht/.lmg/.ldt ARE IFF formats and use the generic-IFF round-trip in the harness.
 *
 * Ground truth:
 *   .sht SSHT: swg-client-v2 StaticShaderTemplate.cpp:32-36,123-128,482-565
 *   .sht CSHD: swg-client-v2 CustomizableShaderTemplate.cpp:1246-1286
 *   .pal:      swg-client-v2 PaletteArgb.cpp:508-522 (sharedMath, NOT clientGraphics)
 *   .lmg MLOD: swg-client-v2 LodMeshGeneratorTemplate.cpp:210-253
 *   .ldt LDTB: swg-client-v2 LodDistanceTable.cpp:145-168
 *   .dds:      Microsoft DDS spec (do NOT cite Texture.cpp:115-129 — format-conversion table only)
 *
 * Source (pattern): packages/contracts/src/iff.ts
 */

// ─── DDS types ───────────────────────────────────────────────────────────────

/**
 * Known DDS pixel-format FourCCs for compressed textures.
 * DXT1/3/5 upload directly to WebGL via WEBGL_compressed_texture_s3tc.
 * DXT2/4 (premultiplied-alpha) need a CPU-decode fallback (rare).
 * RGBA8 for uncompressed (uncommon in SWG assets).
 *
 * Source: Microsoft DDS spec + synthesis §1.7.
 */
export type DdsFormat = 'DXT1' | 'DXT3' | 'DXT5' | 'DXT2' | 'DXT4' | 'RGBA8';

/**
 * Per-mip-level descriptor from a parsed DDS file.
 *
 * Compressed block data is NOT decoded — it stays binary and the renderer uploads
 * it directly via CompressedTexture. The offset/byteLength pair tells the renderer
 * where to slice the raw DDS file bytes to get each mip's block data.
 *
 * Mip 0 offset = 128 (standard DDS header size).
 * Subsequent mip offsets = previous offset + previous byteLength.
 *
 * Source: Microsoft DDS spec mip-level layout + synthesis §1.7.
 */
export interface DdsMipEntry {
  /** Byte offset of this mip's compressed/uncompressed data within the DDS file bytes. */
  offset: number;
  /** Byte length of this mip's data. */
  byteLength: number;
  /** Mip-level width in pixels (halved each level, minimum 1). */
  width: number;
  /** Mip-level height in pixels (halved each level, minimum 1). */
  height: number;
}

/**
 * Full result of parsing a .dds file via parseDds().
 *
 * PARSER-NATIVE round-trip: roundTrip is computed by
 *   serializeDds(parseDds(bytes)) === bytes
 * NOT by the generic-IFF serializeIff/parseIff pair (DDS is not IFF).
 *
 * Compressed blocks pass through unchanged — parseDds does NOT decode DXT blocks.
 * The renderer builds a THREE.CompressedTexture using the mip table.
 *
 * Source: Microsoft DDS spec; synthesis §1.7.
 */
export interface DdsParseResult {
  /** Width of the base (mip 0) image in pixels. */
  width: number;
  /** Height of the base (mip 0) image in pixels. */
  height: number;
  /** Total mip level count (including mip 0). From the DDS header mipMapCount field. */
  mipCount: number;
  /** Pixel format / compression type (uniform across all mips; from the DDS FourCC). */
  format: DdsFormat;
  /**
   * True when the DDS file is a cube map (dwCaps2 bit DDSCAPS2_CUBEMAP = 0x200).
   * When true, mips[] contains 6*mipCount entries in face-major order.
   * Face order: +X(0), -X(1), +Y(2), -Y(3), +Z(4), -Z(5).
   * Base mip for face i = mips[i * mipCount + 0].
   * Source: Microsoft DDS spec; DDSCAPS2_CUBEMAP = 0x200 in dwCaps2.
   */
  isCubemap: boolean;
  /** Per-mip descriptors (mips[0] = face0 base level; 6*mipCount total for cubemaps). */
  mips: DdsMipEntry[];
  /**
   * PARSER-NATIVE round-trip status.
   * serializeDds(parseDds(bytes)) === bytes (byte-exact).
   * NOT the generic-IFF round-trip (DDS is Microsoft binary, not IFF).
   */
  roundTrip: { passed: boolean; failOffset?: number };
}

// ─── Palette types ────────────────────────────────────────────────────────────

/**
 * One RGBA entry from a RIFF PAL palette file.
 * Each field is in [0, 255].
 *
 * Source: swg-client-v2 PaletteArgb.cpp:508-522 (entry.setR/setG/setB/setA read order).
 */
export interface PaletteEntry {
  r: number;
  g: number;
  b: number;
  /**
   * Alpha channel. Forced to 255 when versionOrComponentCount !== 4.
   * Source: PaletteArgb.cpp:517-521 ("if (versionOrComponentCount != 4) entry.setA(255)").
   */
  a: number;
}

/**
 * Full result of parsing a .pal (RIFF PAL) file via parsePalette().
 *
 * PARSER-NATIVE round-trip: roundTrip is computed by
 *   serializePalette(parsePalette(bytes)) === bytes
 * NOT by the generic-IFF serializeIff/parseIff pair (RIFF PAL is not IFF).
 *
 * RIFF PAL structure (24-byte header):
 *   [4] 'RIFF' [4] fileSize [4] 'PAL ' [4] 'data' [4] dataChunkSize [2] versionOrComponentCount [2] entryCount
 *   Followed by entryCount × 4 bytes (R, G, B, A).
 *   entryCount = dataChunkSize / 4.
 *
 * Source: swg-client-v2 PaletteArgb.cpp:508-522.
 */
export interface PaletteParseResult {
  /** Number of RGBA entries in this palette. */
  entryCount: number;
  /**
   * The versionOrComponentCount field from the RIFF PAL data chunk header (uint16).
   * When != 4, alpha is forced to 255 for all entries.
   * Source: PaletteArgb.cpp comment: "assume this variable indicates the number of components".
   */
  versionOrComponentCount: number;
  /** All palette entries in order. entries.length === entryCount. */
  entries: PaletteEntry[];
  /**
   * PARSER-NATIVE round-trip status.
   * serializePalette(parsePalette(bytes)) === bytes (byte-exact).
   * NOT the generic-IFF round-trip (RIFF PAL is Microsoft binary, not IFF).
   */
  roundTrip: { passed: boolean; failOffset?: number };
}

// ─── Shader types ─────────────────────────────────────────────────────────────

/**
 * Known texture slot tag names from TXMS/TCSS in a SSHT shader.
 * These map to Three.js ShaderMaterial uniforms:
 *   MAIN  → uDiffuseMap
 *   NRML / CNRM → uNormalMap
 *   SPEC  → uSpecularMap
 *   EMIS  → uEmissiveMap
 *   ENVM  → uEnvMap (forced placeholder = global scene cubemap)
 *   MASK  → uMaskMap
 *
 * Source: swg-client-v2 StaticShaderTemplate.cpp:32-36 (TAG declarations)
 *         + synthesis §1.7 slot semantics.
 */
export type ShaderSlotName = 'MAIN' | 'NRML' | 'CNRM' | 'SPEC' | 'EMIS' | 'ENVM' | 'MASK';

/**
 * Customization pathway discriminator for CSHD variables.
 *
 * Three distinct pathways (do NOT collapse A and C — they affect different downstream properties):
 *   A = palette→material color (MATR/AMCL/DFCL/EMCL): palette index → PaletteArgb → setAmbient/Diffuse/Emissive
 *   B = palette→texture swap (TXTR/TX1D): index selects a DDS from a flat array, replaces a slot
 *   C = palette→texture factor (TFAC/PAL): lookup → packed 0xAARRGGBB → uTexFactor uniform tint
 *
 * Source: swg-client-v2 CustomizableShaderTemplate.cpp:1246-1286.
 */
export type ShaderCustomizationPathway =
  | 'palette-material-color'
  | 'palette-texture-swap'
  | 'palette-texture-factor';

/**
 * One resolved texture slot from a SSHT shader's TXMS form.
 *
 * Parsing path (StaticShaderTemplate.cpp load_texture):
 *   TXMS → FORM TXM → FORM 000x → DATA (placeholder flag + slot tag) → [NAME (filename)]
 *   The slot tag identifies which slot (MAIN/NRML/etc.) this texture occupies.
 *   TextureList::fetch() reads the NAME chunk to get the texture path.
 *
 * ENVM slots have placeholder=true (forced to global scene cubemap at render time).
 *
 * Source: swg-client-v2 StaticShaderTemplate.cpp:482-565 (load_texture + load_0001)
 *         + TextureList.cpp:336-354 (NAME chunk path reading).
 */
export interface ShaderSlot {
  /** Texture slot identifier. */
  slot: ShaderSlotName;
  /**
   * File path to the .dds texture, relative to the TRE VFS root.
   * Null when the slot is a placeholder (e.g. ENVM → global cubemap).
   */
  texturePath: string | null;
  /**
   * UV coordinate set index for this slot (from TCSS chunk, uint8).
   * 0 = first UV set; 1 = second, etc.
   * Source: StaticShaderTemplate.cpp TCSS parsing (tag → tcs mapping).
   */
  uvSet: number;
}

/**
 * One CSHD customization variable from a CSHD shader.
 *
 * Source: swg-client-v2 CustomizableShaderTemplate.cpp:1246-1286.
 */
export interface ShaderCustomizationVar {
  /** Variable name (palette/customization variable name string). */
  name: string;
  /**
   * Customization pathway:
   *   palette-material-color → affects material ambient/diffuse/emissive color
   *   palette-texture-swap   → replaces a texture slot with a palette-selected DDS
   *   palette-texture-factor → sets uTexFactor uniform for viewport tint (D-06)
   */
  pathway: ShaderCustomizationPathway;
  /** Path to the .pal RIFF PAL file that provides the color/texture options. */
  palettePath: string;
  /** Default palette entry index. */
  defaultIndex: number;
  /** For texture-swap and material-color pathways: which slot is affected. */
  affectedSlot?: ShaderSlotName;
}

/**
 * Full result of parsing a .sht (SSHT or CSHD) shader file.
 *
 * IFF round-trip: uses the generic-IFF pair (serializeIff(parseIff(bytes))).
 * This is an IFF FORM file (unlike .pal/.dds which are non-IFF).
 *
 * Source: swg-client-v2 StaticShaderTemplate.cpp (SSHT)
 *         + CustomizableShaderTemplate.cpp (CSHD).
 */
export interface ShaderParseResult {
  /** SSHT for static shader; CSHD for customizable shader wrapper. */
  variant: 'SSHT' | 'CSHD';
  /**
   * Path to the .eft effect file this shader references.
   * The .eft names the actual HLSL/VS; we don't parse it — we map its slots to GLSL.
   * Source: ShaderEffectList::fetch() call in StaticShaderTemplate.cpp load_0001.
   */
  effectPath: string;
  /**
   * Texture slots parsed from the TXMS form.
   * One entry per texture slot that is present and non-placeholder.
   * Source: StaticShaderTemplate.cpp load_texture (FORM TXM → FORM 000x → DATA/NAME).
   */
  slots: ShaderSlot[];
  /**
   * Customization variables (CSHD only, empty for SSHT).
   * Source: CustomizableShaderTemplate.cpp:1246-1286.
   */
  customizationVars: ShaderCustomizationVar[];
  /** IFF-level round-trip status. .sht IS IFF so uses the generic-IFF pair. */
  roundTrip: { passed: boolean; failOffset?: number };
}

// ─── LOD types ───────────────────────────────────────────────────────────────

/**
 * One LOD level entry from a parsed .lmg/.ldt file pair.
 *
 * .lmg (FORM MLOD) provides the generator paths; .ldt (FORM LDTB) provides the distances.
 * The plan parses both and combines them into LodLevel entries.
 *
 * Distances are stored as-read from disk (NOT pre-squared).
 * The client squares them at runtime: level.m_minDistanceSquared = minDistance * minDistance.
 * Our parseMeshLod() returns the raw float32 values from disk.
 *
 * Source: swg-client-v2 LodDistanceTable.cpp:145-168 (LDTB distances inside INFO).
 *         swg-client-v2 LodMeshGeneratorTemplate.cpp:210-253 (MLOD generator paths).
 */
export interface LodLevel {
  /**
   * Path to the mesh generator for this LOD level (.mgn or .msh path).
   * From the MLOD NAME chunk per level.
   * Source: LodMeshGeneratorTemplate.cpp:246-248 (NAME chunk → pathName string).
   */
  generatorPath: string;
  /**
   * Minimum display distance for this LOD level (raw float32 from disk, NOT pre-squared).
   * The client squares these: m_minDistanceSquared = minDist * minDist.
   * Source: LodDistanceTable.cpp:164 (minDistance float32 read → squared at runtime).
   */
  minDist: number;
  /**
   * Maximum display distance for this LOD level (raw float32 from disk, NOT pre-squared).
   * Source: LodDistanceTable.cpp:167 (maxDistance float32 read → squared at runtime).
   */
  maxDist: number;
}

/**
 * Full result of parsing a .lmg (FORM MLOD) + .ldt (FORM LDTB) LOD file pair.
 *
 * IFF round-trip: uses the generic-IFF pair for BOTH files (both are IFF FORMs).
 *
 * LDTB distances live INSIDE the INFO chunk (not sibling chunks):
 *   FORM LDTB → FORM 0000 → INFO (int16 levelCount + per-level float32 min,max pairs)
 * Source: LodDistanceTable.cpp:145-168.
 *
 * Client caps usable levels at min(4, levelCount).
 */
export interface LodParseResult {
  /** Number of LOD levels declared (from the INFO int16 levelCount field). */
  levelCount: number;
  /**
   * LOD level descriptors combining MLOD paths and LDTB distances.
   * levels.length === levelCount (after capping at min(4, levelCount) if desired).
   */
  levels: LodLevel[];
  /** IFF-level round-trip status (applies to the MLOD or LDTB IFF container). */
  roundTrip: { passed: boolean; failOffset?: number };
}
