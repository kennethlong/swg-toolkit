# Material-fidelity fix synthesis (4-AI crew, ground-truth-verified)

All findings cross-verified against real client bytes + ../swg-client-v2. Apply in this order.

## FIX 1 (DOMINANT, ~90% of the gap) — UV bridge array mismatch [NATIVE]
`mesh_binding.cpp:195` (ParseMesh) and `:560` (ParseSkeletalMesh) emit `uvs` as a SINGLE object
(`sliceToJs(grp.uvs)`), but `@swg/contracts mesh.ts` declares `uvs: MeshAttributeSlice[]` and the
views read `group.uvs.length > 0` / `group.uvs[0]`. So `undefined > 0` is false → the `uv`
attribute is NEVER set → vUv=(0,0) → every texture samples the (0,0) corner texel. VERIFIED
headlessly: `group.uvs` isArray=false, has real data {offset:720,elementCount:30}.
FIX: emit a 1-element array at BOTH sites:
```cpp
auto uvsArr = Napi::Array::New(env, 1);
uvsArr.Set(0u, sliceToJs(env, grp.uvs));
gobj.Set("uvs", uvsArr);
```
Update `native-core/index.d.ts:566` to `uvs: MeshAttributeSlice[];`. Rebuild the addon.
This alone restores weathering/scratches, correct color regions, hand color, belt, eye texels.

## FIX 2 — sRGB colorSpace on color maps [RENDERER]
Diffuse `CompressedTexture` colorSpace is unset (linear) but the renderer outputs sRGB →
washed/desaturated. Set `texture.colorSpace = THREE.SRGBColorSpace` for MAIN (diffuse) and EMIS
textures; keep ENVM/SPEC/NRML at NoColorSpace/linear. Set it in the mesh-view slot switch
(StaticMeshView/SkinnedMeshView) after buildDdsTexture, keyed on slot. ALSO add
`#include <colorspace_fragment>` as the LAST line of the fragment main() (ShaderMaterial — not Raw
— so THREE injects linearToOutputTexel; we must call it). Do lighting in linear. Do NOT also
pow(2.2) (double-decode). If a compressed sRGB upload warns (no WEBGL_compressed_texture_s3tc_srgb),
that's acceptable for MVP — the output-encode + identity still improves it; do not over-engineer.

## FIX 3 — Env reflection is a LERP, not additive (the pink wash) [SHADER]
Real HLSL (a_envmask_specmap_ps20.psh, extracted): 
`result.rgb = lerp(diffuseLitSurface, envColor, envMask) + allSpecularLight;`
- envMask = MAIN.alpha (== SPEC.alpha; same dds). Measured mean ~0.27 → subtle.
- Our `finalColor += envCube * specMask` (additive, full strength) is the bug → pink wash.
FIX the swgMaterial fragment color assembly to:
```glsl
vec4  mainSample = texture2D(uDiffuseMap, vUv);
vec3  diffuseColor = mainSample.rgb;
float envMask      = mainSample.a;                 // MAIN.alpha
vec3  allDiffuse   = clamp(uAmbient + NdotL * uLightDiffuse + emisMask, 0.0, 1.0); // see FIX 4
vec3  litSurface   = diffuseColor * allDiffuse;
float specInt      = pow(max(dot(N, H), 0.0), uSpecPower);
vec3  spec         = specInt * uMaterialSpecular * envMask;   // masked by the SAME alpha
vec3  envColor     = bHasEnv ? textureCube(uEnvMap, reflect(-V, N)).rgb : vec3(0.0);
vec3  rgb          = mix(litSurface, envColor * envMask /*only blend in where masked*/, 0.0); // see note
// SWG line: mix(litSurface, envColor, envMask) + spec
rgb = mix(litSurface, envColor, bHasEnv ? envMask : 0.0) + spec;
gl_FragColor = vec4(rgb, 1.0);
```
(Keep H = normalize(L + V). Do NOT add env on top; mix() replaces by envMask.) When bHasEnv is
false (no cube), envMask blend = 0 → pure litSurface.

## FIX 4 — Emissive folded into the diffuse-light term (dark eyes) [SHADER]
Red droid has NO EMIS slot; SWG's emissive is `+ emisMask` INSIDE the saturate of the diffuse
light term (self-illum floor), not a separate add: 
`allDiffuseLight = saturate(NdotL*lightColor + ambient + emisMask)`.
So `emisMask = bHasEmissive ? texture2D(uEmissiveMap,vUv).a : 0.0;` (and for a_specmap-family
shaders, MAIN.alpha can act as emisMask — but for THIS droid there is no EMIS, so the eye glow
comes from bright diffuse RGB lit fully; the self-illum floor + correct UVs + sRGB will brighten
the eye texels). Fold emisMask into allDiffuse (FIX 3 shows the term). Remove the old separate
`finalColor += emisSample` additive.

## FIX 5 — a_simple effect path (black waist/belt) [RENDERER/SHADER]
The gold abdomen group (`c3poabdo_gold_as8.sht`) uses `a_simple.eft` — MAIN only, no ENVM/SPEC.
Ensure that group renders plain `diffuse * lighting` (bHasEnv=false, bHasSpec=false already gate
this once UVs are fixed). Confirm it doesn't go black: it's a dark gold strip by design, but must
sample real UVs (FIX 1) and not force env/spec. No special parser needed.

## NON-FIX — palette (FALSIFIED for red droid)
protocol_droid_red uses SSHT shaders, customizationVars=[], red baked in c3po_red_all.dds
(mean RGB [128,72,84]). Palette/CSHD wiring is a real gap but ONLY for customizable base assets
(protocol_droid_silver CSHD). Codex gave the full CSHD wiring spec — tracked in
eft-parser-completion / a new palette todo, NOT part of this fix.

## Uniforms to add (swgMaterial)
uAmbient (vec3, ~0.3), uLightDiffuse (vec3, ~0.7 dir light color), uMaterialSpecular (vec3),
uSpecPower (~16-32, exists). Keep customization uMaterialColor/uTexFactor identity for now.
