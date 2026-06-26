# Angle 2 (repo tracer) — where is the FACE, and what does the live render apply that export misses?

FIRST read `.planning/research/CONSULT-P2-05B-AXIOMS.md` (LOCKED ground truth L1–L5).

You are the repo tracer. The export's BODY reads mostly OK but the FACE is a scrambled "cat face". Trace,
with file:line evidence (this repo + ../swg-client-v2 + ../swg-blender-plugin + ../io_scene_swg_msh):

1. **Where is the face rendered?** In the live SkinnedMeshView.tsx + the appearance resolver, map the
   protocol_droid_red parts → shader groups → textures. Confirm whether the FACE diffuse is inside mesh0's
   512×256 atlas (L1) or a separate part. Identify which shader group / texture the face's visible surface
   actually uses in the LIVE render. Quote the resolver/part code.

2. **Runtime mechanisms the export may miss.** The export reads the live ShaderMaterial UNIFORMS
   (uDiffuseMap etc.) and bakes them. Does the LIVE path apply anything at RUNTIME that is NOT captured by
   reading those uniforms — e.g. a CSHD customization (palette/TFAC/TXTR texture redirect), a per-shader-group
   texture swap, a SECOND UV set / uv "depth", vertex colors, or an alpha/cutout — that would make the live
   face differ from what a uniform-snapshot export produces? Cite swgMaterial.ts, the resolver, and
   swg-client-v2 CustomizableShaderTemplate.cpp / StaticShaderTemplate.cpp. For protocol_droid_red specifically,
   are these identity/absent (so NOT the cause) or active?

3. **DXT decode trust.** The body diffuse (512×256) CPU-decoded to a coherent atlas; the head/detail diffuse
   (128×128) decoded to "metallic pipes". Confirm whether dxtCpuDecode.ts handles ALL the formats/sizes these
   textures use (DXT1 vs DXT5, non-power-of-2, mip0 offset) correctly, or whether any face/head texture is
   mis-decoded. Cite dxtCpuDecode.ts + ddsTexture.ts.

Output: a cited map of face-part → texture → UV, and a list of any runtime inputs the export drops, with a
verdict on whether each is active for protocol_droid_red. State CONFIRMED/REFUTED for "the face is fully
captured by the exported uniforms".
