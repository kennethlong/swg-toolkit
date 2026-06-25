# LOCKED AXIOMS — diffuse lighting model (dark side too dark)

Measured from SWG-Toolkit + `../swg-client-v2`/`../swg-main` (2026-06-25). **Treat as given.** Numbered.

- **A1. Symptom:** Character shaded side looks right, but the **shadowed (dark) side is too dark / crushed**
  vs the in-game look — most obvious on the face now that specular is correctly tempered. It reads as a
  hard light/dark split rather than a soft falloff.
- **A2. Our diffuse model** (`swgMaterial.ts`, verbatim, the only lighting our custom ShaderMaterial does):
  ```glsl
  vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));   // HARDCODED single directional
  float NdotL   = max(dot(N, lightDir), 0.0);
  float emisMask = bHasEmissive ? texture2D(uEmissiveMap, vUv).a : 0.0;
  vec3 allDiffuse = clamp(vec3(0.3) + NdotL*vec3(0.7) + vec3(emisMask), 0.0, 1.0);  // flat 0.3 ambient floor
  vec3 litSurface = (diffuseColor * uMaterialColor.rgb * uTexFactor.rgb) * allDiffuse;
  ```
  So a fragment facing away from `lightDir` gets exactly `0.3 × textureColor`. One hardcoded light, flat floor.
- **A3. Our custom ShaderMaterial IGNORES the scene's THREE.js lights.** `Viewport.tsx` defines a 3-point
  rig (key DirectionalLight (5,5,3) i1.2, fill (-3,3,1) i0.4, rim (0,5,-5) i0.3, ambient 0.3) — but a raw
  `THREE.ShaderMaterial` does NOT receive THREE light uniforms, so that rig has NO effect on our meshes.
  All character shading comes from A2's hardcoded single light + flat floor.
- **A4. Real client diffuse = hemispheric lighting** (`swg-main/serverdata/pixel_program/include/functions.inc`,
  used by `a_specmap_bump_ps20` etc.):
  ```
  float3 calculateHemisphericLighting(float3 direction, float3 normal, float3 vertexDiffuse) {
    float  d = dot(direction, normal);
    float3 light = vertexDiffuse + dot3LightTangentMinusDiffuseColor + dot3LightDiffuseColor
                 + (-max(0.0, d) * dot3LightTangentMinusDiffuseColor)
                 + ( min(0.0, d) * dot3LightTangentMinusBackColor);
    return saturate(light);
  }
  ```
  i.e. a directional gradient between a "tangent"(side) color, the main diffuse color, and a "back"
  (shadow-hemisphere) color — NOT a flat ambient floor. The shadow side is lifted by the back/tangent terms.
- **A5. Engine:** THREE.js r0.184, single Canvas, ACES tonemap, sRGB out. Lighting currently done entirely
  in our fragment shader (no THREE light integration).

## OPEN QUESTION (derive, don't assume)
What is the faithful diffuse-lighting model to replace A2's flat floor so the dark side matches the game,
and how should it be parameterized in our THREE viewport? Candidates to evaluate: (a) implement
`calculateHemisphericLighting` with the real `dot3Light*` constant VALUES (need their source/values + the
LightManager setup); (b) feed our existing THREE 3-point rig into the shader (fill light lifts the dark
side); (c) a hemispheric sky/ground ambient approximation. Determine the most faithful + lowest-regression
approach and the actual constant values / light directions to use. Beware: changing the global diffuse
model affects EVERY asset — must not regress the now-good lit sides.
