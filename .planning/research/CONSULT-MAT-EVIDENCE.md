# Material-fidelity gap analysis — protocol_droid_red, ours vs Sytner's IFF Editor (SIE)

We render the protocol droid textured but the look is far from SIE. The viewer cannot see images;
these are precise visual observations (treat as given) + the code + ground truth. Find the ROOT
CAUSES and fixes.

## Visual diff (observed; treat as given)
SIE (ground-truth reference render):
- Body is a rich, saturated **RED/maroon**, clearly weathered: visible **scratches/scuffs/dirt**
  across torso, arms, legs; darker recessed panel lines; good contrast.
- **Eyes GLOW** (pale yellow/white, emissive).
- Hands are **red like the body** (fingers slightly darker).
- Metallic but fairly matte; reflection is subtle, not a wash.

Ours (current):
- Body is a **pale / faded PINK** — desaturated, too light/washed out.
- **Scratches/weathering NOT visible** — surface looks smooth/clean (low contrast).
- **Eyes are DARK** (no glow).
- **Back of the hands is the WRONG color** (bluish/grey, not red).
- A solid **black band at the waist** (possible group rendering black or unlit).
- Overall low-contrast, washed, pinkish.

## Ground truth (verified earlier; treat as given)
- Body shaders `*_aes17` (protocol_parts, c3po_red_all, …) bind: MAIN (diffuse; its **alpha =
  specular/gloss mask**), SPEC (= same dds as MAIN), ENVM (`env_theed.dds`, a 128² DXT3 cube).
  protocol_parts also binds EMIS (`protocol_parts_e.dds`). Effect: `a_envmask_specmap.eft`.
- **The asset is `protocol_droid_RED` — a CUSTOMIZABLE shader (CSHD/CustomizableShaderTemplate).**
  Its customization variables (palette-material-color / palette-texture-factor) are currently
  NOT wired: our resolver does not store the `.pal` palette bytes (known "palette missing" gap).
  HYPOTHESIS TO TEST: the "red" tint comes from a customization PALETTE applied at runtime, NOT
  baked into the diffuse — so without it our base texture reads pale/pink, and different body
  regions (hands) use different palette entries → wrong hand color.

## Our shading (the suspect)
`packages/renderer/src/panels/viewport/material/swgMaterial.ts` fragment shader (approx):
```glsl
vec3 diffuse = texture2D(uDiffuseMap, vUv).rgb;        // NO sRGB decode
vec3 base = diffuse * uMaterialColor.rgb;              // uMaterialColor defaults (1,1,1,1)
vec3 finalColor = base * uTexFactor.rgb;              // uTexFactor defaults (1,1,1,1)
finalColor *= (0.3 + 0.7 * NdotL);                    // single hardcoded directional light
if (bHasSpec) finalColor += specSample * pow(max(dot(V,R),0),uSpecPower);  // uSpecPower=32
if (bHasEmissive) finalColor += emisSample;           // emissive ADD
if (bHasEnv) finalColor += textureCube(uEnvMap, reflect(-V,N)).rgb * specMask; // specMask from MAIN.a (or SPEC.r)
gl_FragColor = vec4(finalColor, 1.0);                  // NO output gamma handling in-shader
```
- The **diffuse texture colorSpace is NOT set to SRGBColorSpace** (ddsTexture.ts builds
  CompressedTexture with default/linear). Renderer outputColorSpace is Three's default (sRGB).
- The customization uniforms (uMaterialColor/uTexFactor) default to identity (1,1,1,1) and are
  never fed a real palette.

## Files
- `packages/renderer/src/panels/viewport/material/swgMaterial.ts` (shader + uniforms)
- `packages/renderer/src/panels/viewport/material/ddsTexture.ts` (texture build, colorSpace)
- `packages/renderer/src/panels/viewport/resolver/appearanceResolver.ts` (resolveShader, customizationVars, slotBytes — where palette would be wired)
- `packages/renderer/src/panels/viewport/StaticMeshView.tsx` / `SkinnedMeshView.tsx` (per-group material build, customization application)
- Ground truth: `../swg-client-v2` CustomizableShaderTemplate.cpp, StaticShaderTemplate.cpp, ShaderEffect.cpp / ShaderImplementation.cpp (a_envmask_specmap effect), the palette (.pal) loader.
