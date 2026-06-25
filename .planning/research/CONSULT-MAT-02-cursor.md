Read `.planning/research/CONSULT-MAT-EVIDENCE.md` first (visual gaps + ground truth + code, treat as given). Read the real code in this repo.

YOUR ANGLE: COLOR-SPACE / GAMMA correctness of our custom raw `THREE.ShaderMaterial` with COMPRESSED (S3TC) diffuse textures in Three.js r0.184 — the "faded/washed-out pale" look.

Read `packages/renderer/src/panels/viewport/material/ddsTexture.ts` (2D CompressedTexture build — note `colorSpace` is NOT set), `swgMaterial.ts` (raw GLSL: `texture2D(uDiffuseMap)` with NO sRGB decode, `gl_FragColor` output with no encoding), and how the R3F `<Canvas>` / renderer is configured (`Viewport.tsx`).

Answer precisely for r0.184:
1. With a RAW ShaderMaterial (hand-written GLSL, not MeshStandardMaterial), does Three.js auto-apply input sRGB→linear decode or output linear→sRGB encode? (It does NOT inject the usual `<colorspace_fragment>` for raw ShaderMaterial.) So what is the CORRECT way to handle color space here so an sRGB-authored albedo renders with correct saturation/contrast (not washed)?
2. For a COMPRESSED S3TC diffuse: can we set `texture.colorSpace = SRGBColorSpace` and have the GPU auto-decode? (Requires the `_srgb` S3TC format enum + `WEBGL_compressed_texture_s3tc_srgb` extension — we currently use the non-sRGB enums.) Or must we sRGB-decode in the shader (`pow(c, 2.2)`), do lighting in linear, and rely on `renderer.outputColorSpace = SRGBColorSpace` to re-encode? Give the exact, correct, robust recipe (and confirm whether the env cube + spec/emis maps should stay linear/NoColorSpace).
3. What's the minimal correct change set (texture colorSpace flags + shader decode/encode + renderer config) so the diffuse reads as a rich saturated red instead of faded pink — WITHOUT double-encoding? Provide the corrected GLSL + texture flags for r0.184, citing Three.js r184 behavior (WebGLProgram colorspace handling, getTexelEncodingFunction, outputColorSpace).

Output: the exact colorspace defect, the corrected recipe (texture flags + GLSL decode/encode + renderer setting), with r184 source-backed reasoning.
