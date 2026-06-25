# LOCKED AXIOMS — medium-zoom face pattern (normal-map / uncompressed-DDS / mip aliasing)

Measured from SWG-Toolkit + real asset bytes (2026-06-25). **Treat as given.** Numbered.

- **A1. Symptom (distance-dependent):** Han Solo's face shows a **weird mottled/blotchy pattern at MEDIUM
  zoom**. Zoomed in close = perfect; zoomed far = was a line/pattern (now mostly fixed by a normal-map
  LOD fade). The medium transition band still aliases. Body is fine. This is a minification/aliasing
  signature, not a UV seam (which would be distance-independent) and not lighting.
- **A2. The face normal map** `texture/han_solo_face_n.dds` = **RGBA8 UNCOMPRESSED, 256×256, mipCount=9**
  (9 mip levels stored IN the file). Body normal `hum_m_body_n.dds` = RGBA8 256×512 mip=10. Face diffuse
  `han_solo_face.dds` = DXT1 256×256 mip=9.
- **A3. `ddsTexture.ts` `buildDdsTexture` paths (verbatim structure):**
  1. `dds.isCubemap` → `buildCubeTexture`.
  2. `s3tc && S3TC_FORMATS.has(format)` (DXT1/3/5) → `THREE.CompressedTexture` with **all mips**;
     `minFilter = mipCount>1 ? LinearMipmapLinearFilter : LinearFilter`. (the GOOD path)
  3. else (CPU fallback): if `format ∈ {DXT1..5}` → `decodeDxt(mip0 only)` → `DataTexture`,
     `minFilter = LinearFilter` (NO mips); **else → `makeMagenta1x1()`** (1×1 magenta).
  - There is **NO uncompressed-RGBA8 branch.** An RGBA8 DDS matches neither S3TC nor the DXT-CPU list, so
    by this code it would return **magenta 1×1** — yet the face clearly shows normal-map-like detail up
    close, so the actual runtime behavior must be confirmed (CONSULT open question).
  - No `anisotropy` is set anywhere. The DXT CPU path uploads only mip 0.
- **A4. Our normal-mapping** (`swgMaterial.ts`): `tangentSpaceNormal = texture2D(uNormalMap, vUv).xyz*2-1`,
  TBN from screen-space derivatives (`dFdx/dFdy`, hasDot3=false), then `N = normalize(TBN * tsNormal)`.
  We just added a **normal-map LOD fade**: `bumpFade = 1 - smoothstep(0.006, 0.025, max(len(dFdx(uv)),
  len(dFdy(uv)))); N = normalize(mix(geoN, N, bumpFade))` — fixed close+far, medium band still aliases.
  `uNormalMap` default (when unbound) is a white 1×1 DataTexture.
- **A5. Engine:** THREE.js r0.184, WebGL2. `DataTexture` defaults `generateMipmaps=false` unless set;
  mipmap minFilter without a mip chain falls back / errors. ACES tonemap, sRGB out.

## OPEN QUESTIONS (derive, don't assume)
1. What does `buildDdsTexture` ACTUALLY return for the RGBA8 normal map — magenta 1×1, or is it handled
   elsewhere / does parseDds report it as something that takes another branch? Is the face normal map
   even rendering, or is `uNormalMap` the white/magenta default (so the "detail" up close is the DIFFUSE)?
2. Root cause of the MEDIUM-zoom pattern: normal-map minification with NO mip chain / wrong filter / no
   anisotropy; the derivative-TBN aliasing; or mip-averaged-non-renormalized normals?
3. The faithful fix: add an uncompressed-RGBA8 upload path that USES the DDS's 9 stored mips +
   LinearMipmapLinear + anisotropy + renormalize-after-sample? And/or tune the LOD fade for the band?
