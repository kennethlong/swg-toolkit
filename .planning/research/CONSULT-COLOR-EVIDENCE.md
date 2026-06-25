# "Brown not red" — find the missing color modulation vs the REAL swg-client-v2 renderer

The viewer renders protocol_droid_red with CORRECT geometry, UVs, weathering/detail, eyes, hands
(all fixed). The ONE remaining gap: the body renders **brown/tan**, but Sytner's IFF Editor (SIE)
and the in-game client render it **saturated RED/maroon**. We are missing a color modulation.

## What we've already RULED OUT (treat as given)
- UVs: fixed (textures sample correctly now; detail visible).
- sRGB: diffuse texture is SRGBColorSpace-decoded; output uses `#include <colorspace_fragment>`.
- Env reflection: it is NOT the cause. We changed env from additive→LERP (`mix(lit, env, envMask)`,
  envMask=MAIN.alpha~0.27) AND sRGB-decoded the env cube — neither visibly changed the brown.
- Palette/CSHD: FALSIFIED earlier — protocol_droid_red uses SSHT shaders, customizationVars=[],
  red is baked in c3po_red_all.dds. (Confirmed by 3 prior consults.)

## Our current shading (the approximation that comes out brown)
`packages/renderer/src/panels/viewport/material/swgMaterial.ts` fragment, per shader group:
```glsl
vec3 diffuseColor = texture2D(uDiffuseMap, vUv).rgb;     // sRGB-decoded by GPU
vec3 allDiffuse   = clamp(vec3(0.3) + NdotL*vec3(0.7) + emisMask, 0,1); // ambient+1 dir light
vec3 tinted       = diffuseColor * uMaterialColor.rgb * uTexFactor.rgb;  // BOTH default (1,1,1) = identity
vec3 litSurface   = tinted * allDiffuse;
... spec (masked by MAIN.alpha) ...
rgb = mix(litSurface, envColor, envMask) + spec;
```
- `uMaterialColor` and `uTexFactor` are ALWAYS identity (1,1,1,1) — we apply NO material color and
  NO texture factor. We also apply NO vertex colors. Light is a single hardcoded white directional
  + 0.3 ambient.
- Diffuse texture `c3po_red_all.dds` mean RGB ≈ [128,72,84] (a MUTED maroon). Displaying it
  ~as-is reads brownish. SIE's is clearly more SATURATED/red than this raw texture — so SIE must be
  MULTIPLYING or modulating the texture by something red that we are not.

## THE QUESTION (go to the real renderer)
In ../swg-client-v2, for a body StaticShader (`shader/c3po_red_all_aes17.sht`, SSHT) running effect
`a_envmask_specmap.eft` (pixel program `a_envmask_specmap_ps20.psh`), determine EVERYTHING that
modulates the final surface color, and identify what we're missing that yields RED:
- **Material (MATL) chunk** in the StaticShader: ambient/diffuse/specular/emissive COLORS. Does the
  .sht carry a material with a saturated RED diffuse/material color that multiplies the texture?
  (`StaticShader::setMaterial`, the Material/MATL load, and where materialDiffuseColor feeds the
  pixel-shader constants or fixed-function.)
- **Texture factor (TFAC)** color constants on the shader and how they multiply texture stages.
- **Vertex colors** on the mesh (a color attribute) feeding the shader.
- **The actual pixel-shader constant inputs** (a_envmask_specmap_ps20.psh): which of
  materialDiffuseColor, dot3LightDiffuseColor, vertexDiffuse, lightColor, etc. multiply diffuseColor,
  and at what values? (Check `pixel_program/include/*.inc` constant register assignments and
  `ShaderImplementation`/`StaticShader` constant upload.)
- The **light/material setup** the client uses (Light::getDiffuseColor, ambient, the material
  emissive) — could the client's lighting saturate/redden vs our flat white light?

Output: the SPECIFIC missing modulation (which chunk/constant), its real decoded value for
c3po_red_all, the exact math the client applies (cite swg-client-v2 file:line + real bytes), and the
concrete change to our GLSL/uniforms to reproduce the RED. Tools: `require('D:/Code/SWG-Toolkit/packages/native-core')`
to mount TREs + parse; the blender plugin tre_reader for raw bytes; the .psh HLSL is in the
`PSRC`/`PSHP` chunk of the pixel program (extract + read).
